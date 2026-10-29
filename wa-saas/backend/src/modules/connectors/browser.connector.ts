import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { config } from '../../common/config';
import { createRedis, RedisService } from '../../common/redis';
import {
  ASSIGN_QUEUE, AssignJob, ConnCommand, connQueueName, leaseOwner, PairOutcome, RESULTS_CHANNEL, SendOutcome,
} from '../browser/browser-shared';
import { AppError } from '../../common/errors';
import {
  BeginConnectionInput, BeginConnectionResult, ConnectorCapabilities, ConnectorContext, HealthResult,
  SendInput, SendResult, WhatsAppConnector,
} from './connector.types';

/**
 * WhatsApp Web connector (Puppeteer, via whatsapp-web.js), as specified in the blueprint (§6–7).
 *
 * This class runs in the API and send-worker processes and never touches a browser. It routes
 * commands to the browser-worker that holds the connection's lease, through a per-connection
 * queue consumed by exactly one worker, and receives results over Redis pub/sub.
 */
@Injectable()
export class BrowserSessionConnector implements WhatsAppConnector, OnModuleDestroy {
  readonly type = 'browser' as const;
  private readonly logger = new Logger(BrowserSessionConnector.name);
  private readonly queueConn = createRedis();
  private readonly sub = createRedis();
  private readonly assign = new Queue<AssignJob>(ASSIGN_QUEUE, { connection: this.queueConn });
  private readonly connQueues = new Map<string, Queue<ConnCommand>>();
  private readonly waiting = new Map<string, (r: any) => void>();
  private subscribed: Promise<unknown> | null = null;

  constructor(private readonly redis: RedisService) {}

  getCapabilities(): ConnectorCapabilities {
    return {
      qrLinking: true, text: true, templates: false, media: ['image', 'document', 'video'],
      // Evidence comes from WhatsApp Web message acknowledgements (server / device / read).
      deliveryReceipts: true, readReceipts: true, freeformRequiresOpenWindow: false,
      minIntervalMs: config.browser.minIntervalMs,
      serialized: false, // already serialized by the per-connection queue (concurrency 1)
    };
  }

  private connQueue(id: string) {
    let q = this.connQueues.get(id);
    if (!q) {
      q = new Queue<ConnCommand>(connQueueName(id), {
        connection: this.queueConn,
        defaultJobOptions: { attempts: 1, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86_400 } },
      });
      this.connQueues.set(id, q);
    }
    return q;
  }

  private ensureSubscribed() {
    if (!this.subscribed) {
      this.subscribed = this.sub.subscribe(RESULTS_CHANNEL);
      this.sub.on('message', (_ch, raw) => {
        try {
          const { requestId, result } = JSON.parse(raw) as { requestId: string; result: unknown };
          this.waiting.get(requestId)?.(result);
          this.waiting.delete(requestId);
        } catch { /* ignore malformed */ }
      });
    }
    return this.subscribed;
  }

  /** Starts (or restarts) linking. QR codes and status changes arrive asynchronously as connection events. */
  async beginConnection(input: BeginConnectionInput): Promise<BeginConnectionResult> {
    const owner = await leaseOwner(this.redis.client, input.connectionId);
    if (owner) {
      await this.connQueue(input.connectionId).add('restart', { kind: 'restart' });
    } else {
      await this.assign.add('assign', { connectionId: input.connectionId, reason: 'link' },
        { jobId: `link-${input.connectionId}-${Date.now()}`, attempts: 20, backoff: { type: 'fixed', delay: 5000 } });
    }
    return { status: 'pending' };
  }

  async send(input: SendInput): Promise<SendResult> {
    const id = input.ctx.connection.id;
    if (!(await leaseOwner(this.redis.client, id))) {
      return { outcome: 'failed', code: 'SESSION_NOT_RUNNING', retryable: true };
    }
    // Per-number daily limit protects the linked account; the campaign pauses instead of pushing through.
    const day = new Date().toISOString().slice(0, 10);
    const key = `browser:daily:${id}:${day}`;
    const used = await this.redis.client.incr(key);
    if (used === 1) await this.redis.client.expire(key, 2 * 86_400);
    if (used > config.browser.dailyLimitPerNumber) {
      await this.redis.client.decr(key);
      return { outcome: 'failed', code: 'DAILY_LIMIT_REACHED', retryable: false };
    }

    await this.ensureSubscribed();
    const requestId = randomUUID();
    const result = new Promise<SendOutcome>((resolve) => {
      this.waiting.set(requestId, resolve);
      setTimeout(() => {
        if (this.waiting.delete(requestId)) resolve({ outcome: 'unknown', code: 'BROWSER_TIMEOUT' });
      }, config.browser.sendTimeoutMs);
    });
    await this.connQueue(id).add('send', {
      kind: 'send', requestId, recipientId: input.recipientId,
      to: input.to, text: input.text, mediaId: input.media?.mediaId,
    }, { jobId: `send-${input.idempotencyKey.replace(/:/g, '_')}-${requestId}` });
    const r = await result;
    if (r.outcome === 'failed' && r.code === 'DAILY_LIMIT_REACHED') await this.redis.client.decr(key);
    return r;
  }

  /** Asks the live session for an 8-character code the user types into WhatsApp on their phone. */
  async requestPairingCode(ctx: ConnectorContext, phoneE164: string): Promise<string> {
    const id = ctx.connection.id;
    if (!(await leaseOwner(this.redis.client, id))) throw new AppError('SESSION_STARTING', 'The session is still starting. Try again in a few seconds.', 409);
    await this.ensureSubscribed();
    const requestId = randomUUID();
    const result = new Promise<PairOutcome>((resolve) => {
      this.waiting.set(requestId, resolve);
      setTimeout(() => { if (this.waiting.delete(requestId)) resolve({ ok: false, code: 'PAIRING_TIMEOUT' }); }, 30_000);
    });
    await this.connQueue(id).add('pair', { kind: 'pair', requestId, phone: phoneE164 }, { priority: 1 });
    const r = await result;
    if (!r.ok) throw new AppError(r.code, 'We couldn’t get a pairing code. Refresh and try again, or scan the QR instead.', 502);
    return r.code;
  }

  async checkHealth(ctx: ConnectorContext): Promise<HealthResult> {
    return (await leaseOwner(this.redis.client, ctx.connection.id)) ? { ok: true } : { ok: false, code: 'SESSION_NOT_RUNNING' };
  }

  /** Logs the linked device out of WhatsApp and wipes its browser profile. */
  async disconnect(ctx: ConnectorContext): Promise<void> {
    const id = ctx.connection.id;
    if (await leaseOwner(this.redis.client, id)) {
      await this.connQueue(id).add('logout', { kind: 'logout' }, { priority: 1 });
    } else {
      await this.assign.add('purge', { connectionId: id, reason: 'purge' }, { jobId: `purge-${id}`, attempts: 5, backoff: { type: 'fixed', delay: 5000 } });
    }
  }

  async onModuleDestroy() {
    await Promise.all([...this.connQueues.values()].map((q) => q.close()));
    await this.assign.close();
    await this.queueConn.quit();
    await this.sub.quit();
  }
}
