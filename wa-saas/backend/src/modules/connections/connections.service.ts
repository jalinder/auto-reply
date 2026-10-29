import { Injectable, Logger } from '@nestjs/common';
import { WhatsappConnection } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { config } from '../../common/config';
import { AppError, Errors } from '../../common/errors';
import { PrismaService } from '../../common/prisma.service';
import { Queues } from '../../common/queues';
import { RedisService } from '../../common/redis';
import { SecretStore } from '../../common/secret-store.service';
import { ConnectorRegistry } from '../connectors/connector.registry';
import { QR_TTL_SECONDS } from '../connectors/sandbox.connector';
import { UsageService } from '../usage/usage.service';
import { normalizePhone } from '../../common/phone';

export type ConnStatus = 'created' | 'waiting_for_qr' | 'linking' | 'connected' | 'qr_expired' | 'disconnected' | 'error' | 'revoked';

export const TRANSITIONS: Record<ConnStatus, ConnStatus[]> = {
  created: ['waiting_for_qr', 'connected', 'error', 'qr_expired', 'revoked'],
  waiting_for_qr: ['linking', 'qr_expired', 'error', 'revoked', 'waiting_for_qr', 'created', 'disconnected'],
  linking: ['connected', 'error', 'qr_expired', 'waiting_for_qr', 'disconnected', 'revoked'],
  connected: ['disconnected', 'error', 'revoked', 'connected'],
  qr_expired: ['waiting_for_qr', 'created', 'revoked'],
  disconnected: ['waiting_for_qr', 'created', 'connected', 'revoked'],
  error: ['waiting_for_qr', 'created', 'connected', 'disconnected', 'revoked', 'error'],
  revoked: [],
};

export function toPublicConnection(c: WhatsappConnection, registry: ConnectorRegistry) {
  return {
    id: c.id,
    label: c.label,
    connectorType: c.connectorType,
    status: c.status,
    maskedAccount: c.maskedAccount,
    connectedAt: c.connectedAt,
    lastSeenAt: c.lastSeenAt,
    lastErrorCode: c.lastErrorCode,
    qrExpiresAt: c.status === 'waiting_for_qr' ? c.qrExpiresAt : null,
    capabilities: registry.capabilities(c.connectorType),
    createdAt: c.createdAt,
  };
}

@Injectable()
export class ConnectionsService {
  private readonly logger = new Logger(ConnectionsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly registry: ConnectorRegistry,
    private readonly secrets: SecretStore,
    private readonly queues: Queues,
    private readonly audit: AuditService,
    private readonly usage: UsageService,
  ) {}

  private qrKey(id: string) {
    return `qr:${id}`;
  }

  async getOwned(tenantId: string, id: string) {
    const c = await this.prisma.whatsappConnection.findFirst({ where: { id, tenantId } });
    if (!c) throw Errors.notFound('Connection');
    return c;
  }

  /** Guarded state transition; emits an event and a realtime update. */
  async transition(c: WhatsappConnection, to: ConnStatus, data: Partial<WhatsappConnection> = {}, meta?: Record<string, unknown>) {
    const from = c.status as ConnStatus;
    if (!TRANSITIONS[from].includes(to)) {
      throw new AppError('INVALID_CONNECTION_STATE', `Connection cannot move from ${from} to ${to}.`, 409);
    }
    const updated = await this.prisma.whatsappConnection.update({ where: { id: c.id }, data: { ...data, status: to } as any });
    await this.prisma.connectionEvent.create({ data: { connectionId: c.id, eventType: `status.${to}`, safeMetadata: (meta ?? { from }) as any } });
    await this.redis.publish(c.tenantId, { type: 'connection.updated', data: { id: c.id, status: to, lastErrorCode: updated.lastErrorCode } });
    return updated;
  }

  async create(input: {
    tenantId: string; planId: string; userId: string; connectorType: string; label: string;
    idempotencyKey?: string; ip: string | null; requestId: string | null;
  }) {
    if (input.idempotencyKey) {
      const existing = await this.prisma.whatsappConnection.findUnique({
        where: { tenantId_idempotencyKey: { tenantId: input.tenantId, idempotencyKey: input.idempotencyKey } },
      });
      if (existing) return existing;
    }
    const connector = this.registry.get(input.connectorType);
    await this.usage.assertCanAdd(input.tenantId, input.planId, 'connections');

    let conn = await this.prisma.whatsappConnection.create({
      data: {
        tenantId: input.tenantId, connectorType: input.connectorType, label: input.label, status: 'created',
        idempotencyKey: input.idempotencyKey ?? null, createdById: input.userId,
      },
    });
    await this.audit.log({ tenantId: input.tenantId, actorId: input.userId, action: 'connection.created', resourceType: 'connection', resourceId: conn.id, metadata: { connectorType: input.connectorType }, ip: input.ip, requestId: input.requestId });

    const result = await connector.beginConnection({ tenantId: input.tenantId, connectionId: conn.id });
    if (result.status === 'pending') return conn; // browser worker reports QR / linking progress via events
    if (result.status === 'error') {
      conn = await this.transition(conn, 'error', { lastErrorCode: result.errorCode ?? 'CONNECT_FAILED' });
      return conn;
    }
    const secretRef = result.secret ? await this.secrets.put(input.tenantId, result.secret) : null;
    if (result.status === 'connected') {
      return this.transition(conn, 'connected', {
        secretRef, maskedAccount: result.maskedAccount ?? null, providerAccountId: result.providerAccountId ?? null,
        wabaId: result.wabaId ?? null, connectedAt: new Date(), lastSeenAt: new Date(), lastErrorCode: null,
      });
    }
    return this.storeQr(conn, result.qr!);
  }

  private async storeQr(conn: WhatsappConnection, qr: { payload: string; expiresAt: Date }) {
    const ttl = Math.max(1, Math.round((qr.expiresAt.getTime() - Date.now()) / 1000));
    await this.redis.client.set(this.qrKey(conn.id), qr.payload, 'EX', ttl);
    const updated = await this.transition(conn, 'waiting_for_qr', { qrExpiresAt: qr.expiresAt, lastErrorCode: null });
    await this.queues.connection.add('qr-expire', { connectionId: conn.id, expiresAt: qr.expiresAt.toISOString() }, { delay: ttl * 1000 + 500 });
    await this.redis.publish(conn.tenantId, { type: 'connection.qr', data: { id: conn.id, expiresAt: qr.expiresAt.toISOString() } });
    return updated;
  }

  async getQr(tenantId: string, id: string) {
    const c = await this.getOwned(tenantId, id);
    if (c.status !== 'waiting_for_qr') throw new AppError('QR_NOT_AVAILABLE', 'There is no active QR for this connection.', 409);
    const payload = await this.redis.client.get(this.qrKey(id));
    if (!payload) throw new AppError('QR_EXPIRED', 'This QR has expired. Generate a fresh one.', 410);
    // WhatsApp Web rotates its QR roughly every 20–25s; the sandbox uses a fixed 60s window.
    return { payload, expiresAt: c.qrExpiresAt, ttlSeconds: c.connectorType === 'browser' ? 25 : QR_TTL_SECONDS };
  }

  async refreshQr(tenantId: string, id: string) {
    const c = await this.getOwned(tenantId, id);
    if (!this.registry.capabilities(c.connectorType)?.qrLinking) throw new AppError('QR_NOT_SUPPORTED', 'This connection type does not use QR linking.', 400);
    if (!['created', 'waiting_for_qr', 'qr_expired', 'disconnected', 'error'].includes(c.status)) {
      throw new AppError('INVALID_CONNECTION_STATE', 'This connection is not waiting to be linked.', 409);
    }
    const connector = this.registry.get(c.connectorType);
    await this.redis.client.del(this.qrKey(id));
    const result = await connector.beginConnection({ tenantId, connectionId: c.id });
    if (result.status === 'pending') return this.transition(c, 'created', { qrExpiresAt: null, lastErrorCode: null });
    if (result.status !== 'waiting_for_qr' || !result.qr) return this.transition(c, 'error', { lastErrorCode: result.errorCode ?? 'QR_FAILED' });
    return this.storeQr(c, result.qr);
  }

  async cancelLinking(tenantId: string, id: string, userId: string) {
    const c = await this.getOwned(tenantId, id);
    if (!['created', 'waiting_for_qr', 'linking', 'qr_expired', 'error'].includes(c.status)) {
      throw new AppError('INVALID_CONNECTION_STATE', 'Only pending connections can be cancelled.', 409);
    }
    await this.redis.client.del(this.qrKey(id));
    const connector = this.registry.raw(c.connectorType);
    await connector?.disconnect(await this.registry.context(c)).catch(() => undefined);
    await this.audit.log({ tenantId, actorId: userId, action: 'connection.link_cancelled', resourceType: 'connection', resourceId: id });
    return this.transition(c, 'revoked');
  }

  async requestPairingCode(tenantId: string, id: string, userId: string, rawPhone: string) {
    const c = await this.getOwned(tenantId, id);
    if (c.status !== 'waiting_for_qr') throw new AppError('INVALID_CONNECTION_STATE', 'Wait for the QR to appear, then request a pairing code.', 409);
    const connector = this.registry.get(c.connectorType);
    if (!connector.requestPairingCode) throw new AppError('PAIRING_NOT_SUPPORTED', 'This connection type only supports QR linking.', 400);
    const phone = normalizePhone(rawPhone, 'IN');
    if (!phone) throw new AppError('INVALID_PHONE', 'Enter the WhatsApp number with country code.');
    const code = await connector.requestPairingCode(await this.registry.context(c), phone);
    await this.prisma.connectionEvent.create({ data: { connectionId: id, eventType: 'pairing.code_issued', safeMetadata: { by: userId } } });
    return { code, expiresInSeconds: 180 };
  }

  /** Dev-only: simulate the phone scanning the sandbox QR. */
  async sandboxScan(tenantId: string, id: string) {
    if (config.isProd) throw Errors.notFound();
    const c = await this.getOwned(tenantId, id);
    if (c.connectorType !== 'sandbox') throw new AppError('NOT_SANDBOX', 'Only sandbox connections can be simulated.', 400);
    const qr = await this.redis.client.get(this.qrKey(id));
    if (c.status !== 'waiting_for_qr' || !qr) throw new AppError('QR_EXPIRED', 'This QR has expired. Generate a fresh one.', 410);
    await this.redis.client.del(this.qrKey(id));
    const updated = await this.transition(c, 'linking');
    await this.queues.connection.add('sandbox-linked', { connectionId: id }, { delay: 2500 });
    return updated;
  }

  async revoke(tenantId: string, id: string, userId: string, ip: string | null, requestId: string | null) {
    const c = await this.getOwned(tenantId, id);
    if (c.status === 'revoked') return c;
    const connector = this.registry.raw(c.connectorType);
    try {
      if (connector) await connector.disconnect(await this.registry.context(c));
    } catch (e) {
      this.logger.warn(`disconnect failed for ${id}: ${(e as Error).message}`);
    }
    if (c.secretRef) await this.secrets.delete(tenantId, c.secretRef);
    await this.redis.client.del(this.qrKey(id));
    const paused = await this.prisma.campaign.updateMany({
      where: { tenantId, connectionId: id, status: { in: ['scheduled', 'running'] } },
      data: { status: 'paused', pausedReason: 'CONNECTION_REVOKED' },
    });
    await this.audit.log({ tenantId, actorId: userId, action: 'connection.revoked', resourceType: 'connection', resourceId: id, metadata: { campaignsPaused: paused.count }, ip, requestId });
    return this.transition(c, 'revoked', { secretRef: null });
  }

  async markHealth(c: WhatsappConnection, ok: boolean, code?: string) {
    if (ok) {
      if (c.status === 'connected') {
        await this.prisma.whatsappConnection.update({ where: { id: c.id }, data: { lastSeenAt: new Date() } });
        return;
      }
      if (c.status === 'error' || c.status === 'disconnected') await this.transition(c, 'connected', { lastSeenAt: new Date(), lastErrorCode: null });
      return;
    }
    if (c.status === 'connected') {
      await this.transition(c, 'error', { lastErrorCode: code ?? 'HEALTH_CHECK_FAILED' });
      await this.prisma.campaign.updateMany({
        where: { connectionId: c.id, status: 'running' },
        data: { status: 'paused', pausedReason: 'CONNECTION_UNHEALTHY' },
      });
    }
  }
}
