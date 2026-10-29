import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { WhatsappConnection } from '@prisma/client';
import { Job, Queue, Worker } from 'bullmq';
import { promises as fs } from 'fs';
import { hostname } from 'os';
import * as path from 'path';
import { Client, LocalAuth, Message, MessageAck, MessageMedia } from 'whatsapp-web.js';
import { config } from '../../common/config';
import { maskPhone } from '../../common/crypto';
import { browserEvents, browserSessions } from '../../common/metrics';
import { normalizePhone } from '../../common/phone';
import { PrismaService } from '../../common/prisma.service';
import { Queues } from '../../common/queues';
import { createRedis, RedisService } from '../../common/redis';
import { ConnectionsService } from '../connections/connections.service';
import { StorageService } from '../media/storage.service';
import {
  acquireLease, ASSIGN_QUEUE, AssignJob, ConnCommand, connQueueName, leaseOwner, releaseLease, renewLease, RESULTS_CHANNEL, SendOutcome,
} from './browser-shared';

const STOP_WORDS = /^\s*(stop|unsubscribe|opt[\s-]?out|cancel|end|quit|band karo|रोकें)\s*$/i;
const QR_ROTATION_SECONDS = 25;
const SAFE_ID = /^[0-9a-f-]{36}$/;

interface Session {
  connectionId: string;
  tenantId: string;
  client: Client;
  consumer: Worker<ConnCommand> | null;
  stopping: boolean;
}

/**
 * Runs inside the browser-worker process. Owns one isolated Chromium profile per linked number
 * (LocalAuth, clientId = connection id), a single-writer Redis lease per session, and the
 * per-connection command queue. Never exposes a debugging port; never logs QR payloads.
 */
@Injectable()
export class BrowserSessionManager implements OnModuleDestroy {
  private readonly logger = new Logger(BrowserSessionManager.name);
  readonly workerId = `${hostname()}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  private readonly sessions = new Map<string, Session>();
  private readonly bullConn = createRedis();
  private readonly assignQueue = new Queue<AssignJob>(ASSIGN_QUEUE, { connection: this.bullConn });
  private assignWorker: Worker<AssignJob> | null = null;
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly connections: ConnectionsService,
    private readonly storage: StorageService,
    private readonly queues: Queues,
  ) {}

  async start() {
    await fs.mkdir(config.browser.dataDir, { recursive: true, mode: 0o700 });
    this.assignWorker = new Worker<AssignJob>(ASSIGN_QUEUE, (job) => this.onAssign(job), { connection: createRedis(), concurrency: 1 });
    this.timers.push(setInterval(() => this.heartbeat().catch((e) => this.logger.warn(`heartbeat: ${e.message}`)), 10_000));
    this.timers.push(setInterval(() => this.recoverOrphans().catch((e) => this.logger.warn(`recover: ${e.message}`)), 30_000));
    this.logger.log(`Browser worker ${this.workerId} ready (max ${config.browser.maxSessionsPerWorker} sessions)`);
  }

  // ---------------- Assignment ----------------

  private async onAssign(job: Job<AssignJob>) {
    const { connectionId, reason } = job.data;
    if (!SAFE_ID.test(connectionId)) return;
    if (reason === 'purge') return this.purgeProfile(connectionId);

    const conn = await this.prisma.whatsappConnection.findUnique({ where: { id: connectionId } });
    if (!conn || conn.status === 'revoked' || conn.connectorType !== 'browser') return;
    if (this.sessions.has(connectionId)) return;
    if (this.sessions.size >= config.browser.maxSessionsPerWorker) {
      throw new Error('worker at capacity'); // BullMQ retries; another worker with room can take it
    }
    if (!(await acquireLease(this.redis.client, connectionId, this.workerId))) return; // someone else owns it
    await this.startSession(conn);
  }

  /** Re-assigns sessions whose worker died (lease expired) so they restore from their saved profile. */
  private async recoverOrphans() {
    const candidates = await this.prisma.whatsappConnection.findMany({
      where: { connectorType: 'browser', status: { in: ['connected', 'linking', 'waiting_for_qr', 'created'] } },
      select: { id: true }, take: 500,
    });
    for (const c of candidates) {
      if (this.sessions.has(c.id)) continue;
      if (await leaseOwner(this.redis.client, c.id)) continue;
      await this.assignQueue.add('assign', { connectionId: c.id, reason: 'recover' }, { jobId: `recover-${c.id}`, removeOnComplete: true, removeOnFail: true, attempts: 10, backoff: { type: 'fixed', delay: 10_000 } });
    }
  }

  private async heartbeat() {
    for (const s of this.sessions.values()) {
      if (s.stopping) continue;
      if (!(await renewLease(this.redis.client, s.connectionId, this.workerId))) {
        this.logger.warn(`Lost lease for ${s.connectionId}; stopping local session`);
        await this.stopSession(s.connectionId, { wipe: false, release: false });
        continue;
      }
      const state = await s.client.getState().catch(() => null);
      if (state === 'CONNECTED') {
        await this.prisma.whatsappConnection.updateMany({ where: { id: s.connectionId, status: 'connected' }, data: { lastSeenAt: new Date() } });
      }
    }
  }

  // ---------------- Session lifecycle ----------------

  private async startSession(conn: WhatsappConnection) {
    const client = new Client({
      authStrategy: new LocalAuth({ clientId: conn.id, dataPath: config.browser.dataDir }),
      puppeteer: {
        headless: true,
        executablePath: config.browser.executablePath,
        args: config.browser.extraArgs, // no --remote-debugging-port, ever
      },
      qrMaxRetries: config.browser.qrMaxRetries,
      deviceName: 'Relay',
      takeoverOnConflict: false,
    });
    const s: Session = { connectionId: conn.id, tenantId: conn.tenantId, client, consumer: null, stopping: false };
    this.sessions.set(conn.id, s);
    browserSessions.set(this.sessions.size);
    browserEvents.inc({ event: 'session_start' });
    this.wire(s);
    this.logger.log(`Starting session ${conn.id}`);
    client.initialize().catch(async (e) => {
      this.logger.error(`Session ${conn.id} failed to start: ${e.message}`);
      browserEvents.inc({ event: 'start_failed' });
      await this.setStatus(conn.id, 'error', { lastErrorCode: 'BROWSER_START_FAILED' });
      await this.stopSession(conn.id, { wipe: false, release: true });
    });
  }

  private async current(id: string) {
    return this.prisma.whatsappConnection.findUnique({ where: { id } });
  }

  /** Applies a state transition if it's valid from the current state; ignores stale ones. */
  private async setStatus(id: string, to: any, data: Partial<WhatsappConnection> = {}) {
    const c = await this.current(id);
    if (!c || c.status === 'revoked') return;
    try {
      await this.connections.transition(c, to, data);
    } catch {
      /* invalid transition from current state: ignore */
    }
  }

  private wire(s: Session) {
    const { client, connectionId: id, tenantId } = s;

    client.on('qr', async (qr: string) => {
      const expiresAt = new Date(Date.now() + QR_ROTATION_SECONDS * 1000);
      // QR lives only in Redis with a short TTL; never in MySQL, logs or realtime payloads.
      await this.redis.client.set(`qr:${id}`, qr, 'EX', QR_ROTATION_SECONDS + 5);
      browserEvents.inc({ event: 'qr' });
      await this.setStatus(id, 'waiting_for_qr', { qrExpiresAt: expiresAt, lastErrorCode: null });
      await this.redis.publish(tenantId, { type: 'connection.qr', data: { id, expiresAt: expiresAt.toISOString() } });
    });

    client.on('authenticated', async () => {
      await this.redis.client.del(`qr:${id}`);
      const c = await this.current(id);
      if (c?.status === 'waiting_for_qr') await this.setStatus(id, 'linking');
    });

    client.on('ready', async () => {
      const user = client.info?.wid?.user;
      await this.setStatus(id, 'connected', {
        maskedAccount: user ? maskPhone(`+${user}`) : null, connectedAt: new Date(), lastSeenAt: new Date(), lastErrorCode: null,
      });
      this.openConsumer(s);
      browserEvents.inc({ event: 'ready' });
      this.logger.log(`Session ${id} ready`);
    });

    client.on('auth_failure', async () => {
      browserEvents.inc({ event: 'auth_failure' });
      await this.setStatus(id, 'error', { lastErrorCode: 'AUTH_FAILURE' });
      await this.stopSession(id, { wipe: true, release: true });
    });

    client.on('disconnected', async (reason: string) => {
      if (s.stopping) return;
      const r = String(reason ?? '');
      browserEvents.inc({ event: /max qrcode/i.test(r) ? 'qr_timeout' : /logout/i.test(r) ? 'logged_out' : 'disconnected' });
      this.logger.warn(`Session ${id} disconnected: ${r}`);
      if (/max qrcode retries/i.test(r)) {
        await this.redis.client.del(`qr:${id}`);
        await this.setStatus(id, 'qr_expired');
        await this.stopSession(id, { wipe: false, release: true });
        return;
      }
      const loggedOut = /logout/i.test(r);
      await this.setStatus(id, 'disconnected', { lastErrorCode: loggedOut ? 'LOGGED_OUT_ON_PHONE' : 'SESSION_DISCONNECTED' });
      await this.prisma.campaign.updateMany({ where: { connectionId: id, status: { in: ['running', 'scheduled'] } }, data: { status: 'paused', pausedReason: 'CONNECTION_NOT_READY' } });
      await this.stopSession(id, { wipe: loggedOut, release: true });
    });

    client.on('message_ack', async (msg: Message, ack: MessageAck) => {
      if (!msg.fromMe) return;
      const status = ack === MessageAck.ACK_ERROR ? 'failed' : ack === MessageAck.ACK_SERVER ? 'sent'
        : ack === MessageAck.ACK_DEVICE ? 'delivered' : ack >= MessageAck.ACK_READ ? 'read' : null;
      if (!status) return;
      await this.queues.status.add('apply', {
        tenantId, externalRef: msg.id._serialized, status, occurredAt: new Date().toISOString(),
        errorCode: status === 'failed' ? 'WA_ACK_ERROR' : null,
      }, { jobId: `ack-${msg.id.id}-${status}` });
    });

    client.on('message', async (msg: Message) => {
      if (msg.fromMe || !STOP_WORDS.test(msg.body ?? '')) return;
      const digits = String(msg.from).split('@')[0];
      const phone = normalizePhone(`+${digits}`);
      if (!phone) return;
      await this.prisma.optOut.upsert({
        where: { tenantId_phoneE164: { tenantId, phoneE164: phone } },
        create: { tenantId, phoneE164: phone, reason: 'Replied with opt-out keyword', source: 'inbound_keyword' },
        update: {},
      });
      await this.prisma.campaignRecipient.updateMany({ where: { tenantId, phoneE164: phone, status: 'queued' }, data: { status: 'skipped', lastErrorCode: 'OPTED_OUT' } });
    });
  }

  private openConsumer(s: Session) {
    if (s.consumer) return;
    s.consumer = new Worker<ConnCommand>(connQueueName(s.connectionId), (job) => this.onCommand(s, job), {
      connection: createRedis(), concurrency: 1, lockDuration: config.browser.sendTimeoutMs + 30_000,
    });
  }

  async stopSession(id: string, opts: { wipe: boolean; release: boolean }) {
    const s = this.sessions.get(id);
    if (s) {
      s.stopping = true;
      this.sessions.delete(id);
      browserSessions.set(this.sessions.size);
      await s.consumer?.close().catch(() => undefined);
      await s.client.destroy().catch(() => undefined);
    }
    if (opts.wipe) await this.purgeProfile(id);
    if (opts.release) await releaseLease(this.redis.client, id, this.workerId);
  }

  private async purgeProfile(id: string) {
    if (!SAFE_ID.test(id)) return;
    const dir = path.resolve(config.browser.dataDir, `session-${id}`);
    if (!dir.startsWith(path.resolve(config.browser.dataDir) + path.sep)) return;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }

  // ---------------- Commands ----------------

  private async onCommand(s: Session, job: Job<ConnCommand>) {
    const cmd = job.data;
    if (cmd.kind === 'logout') {
      await s.client.logout().catch(() => undefined);
      await this.stopSession(s.connectionId, { wipe: true, release: true });
      return;
    }
    if (cmd.kind === 'restart') {
      const conn = await this.current(s.connectionId);
      await this.stopSession(s.connectionId, { wipe: false, release: false });
      if (conn && conn.status !== 'revoked') await this.startSession(conn);
      return;
    }
    if (cmd.kind === 'pair') {
      let result: { ok: boolean; code: string };
      try {
        const code = await s.client.requestPairingCode(cmd.phone.replace(/^\+/, ''), true);
        result = { ok: true, code };
        browserEvents.inc({ event: 'pairing_code' });
      } catch {
        result = { ok: false, code: 'PAIRING_FAILED' };
      }
      // Short-lived credential: returned to the requesting admin only, never stored or logged.
      await this.redis.client.publish(RESULTS_CHANNEL, JSON.stringify({ requestId: cmd.requestId, result }));
      return;
    }
    const result = await this.send(s, cmd);
    await this.redis.client.publish(RESULTS_CHANNEL, JSON.stringify({ requestId: cmd.requestId, result }));
  }

  private async send(s: Session, cmd: Extract<ConnCommand, { kind: 'send' }>): Promise<SendOutcome> {
    // Re-check right before sending: this job may have waited in the queue.
    const r = await this.prisma.campaignRecipient.findUnique({ where: { id: cmd.recipientId }, include: { campaign: { select: { status: true } } } });
    if (!r || r.tenantId !== s.tenantId) return { outcome: 'failed', code: 'RECIPIENT_NOT_FOUND', retryable: false };
    if (!['attempting', 'unknown'].includes(r.status)) return { outcome: 'failed', code: 'RECIPIENT_NOT_CLAIMED', retryable: false };
    if (r.campaign.status !== 'running') return { outcome: 'failed', code: 'CAMPAIGN_NOT_RUNNING', retryable: true };
    const opted = await this.prisma.optOut.findUnique({ where: { tenantId_phoneE164: { tenantId: s.tenantId, phoneE164: r.phoneE164 } } });
    if (opted) return { outcome: 'failed', code: 'OPTED_OUT', retryable: false };

    let numberId: string;
    try {
      const n = await s.client.getNumberId(cmd.to.replace(/^\+/, ''));
      if (!n) return { outcome: 'failed', code: 'NOT_ON_WHATSAPP', retryable: false };
      numberId = n._serialized;
    } catch {
      return { outcome: 'failed', code: 'LOOKUP_FAILED', retryable: true }; // nothing was sent yet
    }

    try {
      let msg: Message;
      if (cmd.mediaId) {
        const m = await this.prisma.mediaAsset.findFirst({ where: { id: cmd.mediaId, tenantId: s.tenantId, status: 'ready' } });
        if (!m) return { outcome: 'failed', code: 'MEDIA_NOT_FOUND', retryable: false };
        const bytes = await this.storage.read(m.objectKey);
        const media = new MessageMedia(m.mimeType, bytes.toString('base64'), m.fileName);
        msg = await s.client.sendMessage(numberId, media, cmd.text ? { caption: cmd.text } : undefined);
      } else {
        msg = await s.client.sendMessage(numberId, cmd.text ?? '');
      }
      const externalRef = msg.id._serialized;
      // If the caller already gave up (Unknown), reconcile now that we have proof of submission.
      await this.prisma.campaignRecipient.updateMany({
        where: { id: r.id, status: 'unknown' },
        data: { status: 'submitted', externalRef, submittedAt: new Date(), lastErrorCode: null },
      });
      return { outcome: 'submitted', externalRef };
    } catch (e: any) {
      // Once sendMessage was invoked we can't prove whether WhatsApp received it.
      this.logger.warn(`send on ${s.connectionId} failed: ${String(e?.message ?? e).slice(0, 120)}`);
      return { outcome: 'unknown', code: 'BROWSER_SEND_ERROR' };
    }
  }

  async onModuleDestroy() {
    this.timers.forEach(clearInterval);
    await this.assignWorker?.close();
    for (const id of [...this.sessions.keys()]) await this.stopSession(id, { wipe: false, release: true });
    await this.assignQueue.close();
    await this.bullConn.quit();
  }
}
