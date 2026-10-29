import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Queues } from '../../common/queues';
import {
  BeginConnectionInput, BeginConnectionResult, ConnectorCapabilities, ConnectorContext, HealthResult,
  SendInput, SendResult, WhatsAppConnector,
} from './connector.types';

export const QR_TTL_SECONDS = 60;

/**
 * Development/staging connector. Exercises the full QR state machine, pacing,
 * and evidence-based status timeline without contacting WhatsApp.
 * Never enable in production (ENABLED_CONNECTORS).
 */
@Injectable()
export class SandboxConnector implements WhatsAppConnector {
  readonly type = 'sandbox' as const;
  constructor(private readonly queues: Queues) {}

  getCapabilities(): ConnectorCapabilities {
    return {
      qrLinking: true, text: true, templates: false, media: ['image', 'document'],
      deliveryReceipts: true, readReceipts: true, freeformRequiresOpenWindow: false,
      minIntervalMs: 400, serialized: true,
    };
  }

  newQr() {
    return { payload: `wasaas-sandbox://link/${randomBytes(24).toString('base64url')}`, expiresAt: new Date(Date.now() + QR_TTL_SECONDS * 1000) };
  }

  async beginConnection(_: BeginConnectionInput): Promise<BeginConnectionResult> {
    return { status: 'waiting_for_qr', qr: this.newQr() };
  }

  async checkHealth(): Promise<HealthResult> {
    return { ok: true };
  }

  async send(input: SendInput): Promise<SendResult> {
    if (/0000$/.test(input.to)) return { outcome: 'failed', code: 'SANDBOX_RECIPIENT_UNAVAILABLE', retryable: false };
    if (/9999$/.test(input.to)) return { outcome: 'unknown', code: 'PROVIDER_TIMEOUT' };
    const externalRef = `sbx_${randomBytes(10).toString('hex')}`;
    const tenantId = input.ctx.connection.tenantId;
    const failLater = Math.random() < 0.05;
    await this.queues.status.add('apply', { tenantId, externalRef, status: failLater ? 'failed' : 'delivered', errorCode: failLater ? 'SANDBOX_UNDELIVERABLE' : null, occurredAt: null }, { delay: 1500 + Math.random() * 2000 });
    if (!failLater && Math.random() < 0.7) {
      await this.queues.status.add('apply', { tenantId, externalRef, status: 'read', errorCode: null, occurredAt: null }, { delay: 5000 + Math.random() * 6000 });
    }
    return { outcome: 'submitted', externalRef };
  }

  async disconnect(_: ConnectorContext): Promise<void> {}

  async requestPairingCode(): Promise<string> {
    const alphabet = 'ABCDEFGHJKLMNPQRSTVWXYZ23456789';
    return Array.from(randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
  }
}
