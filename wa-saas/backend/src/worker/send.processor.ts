import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis';
import { CampaignsService } from '../modules/campaigns/campaigns.service';
import { ConnectorRegistry } from '../modules/connectors/connector.registry';
import { ConnectorDisabledError, SendResult } from '../modules/connectors/connector.types';
import { kindOf } from '../modules/media/file-signature';
import { StorageService } from '../modules/media/storage.service';
import { UsageService } from '../modules/usage/usage.service';
import { sendOutcomes } from '../common/metrics';

const LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 4;

export class RetryableSendError extends Error {}

@Injectable()
export class SendProcessor {
  private readonly logger = new Logger(SendProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly registry: ConnectorRegistry,
    private readonly usage: UsageService,
    private readonly storage: StorageService,
    private readonly campaigns: CampaignsService,
  ) {}

  private async event(tenantId: string, recipientId: string, eventType: string, extra: { code?: string; externalRef?: string } = {}) {
    await this.prisma.messageEvent.create({
      data: {
        tenantId, recipientId, eventType, source: 'system', externalRef: extra.externalRef ?? null, occurredAt: new Date(),
        safePayload: extra.code ? { code: extra.code } : undefined,
      },
    });
  }

  private async pauseCampaign(campaignId: string, tenantId: string, reason: string) {
    await this.prisma.campaign.updateMany({ where: { id: campaignId, status: { in: ['scheduled', 'running'] } }, data: { status: 'paused', pausedReason: reason } });
    await this.campaigns.publishProgress(tenantId, campaignId);
  }

  /** Serialize sends per connection when the connector requires it (single-writer lease). */
  private async withConnectionLock<T>(connectionId: string, serialized: boolean, fn: () => Promise<T>): Promise<T> {
    if (!serialized) return fn();
    const key = `lock:conn:${connectionId}`;
    const token = `${process.pid}:${Math.random()}`;
    const deadline = Date.now() + 30_000;
    while (!(await this.redis.client.set(key, token, 'PX', 60_000, 'NX'))) {
      if (Date.now() > deadline) throw new RetryableSendError('connection lock busy');
      await new Promise((r) => setTimeout(r, 200));
    }
    try {
      return await fn();
    } finally {
      await this.redis.client.eval(`if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`, 1, key, token);
    }
  }

  async process(job: Job<{ recipientId: string }>) {
    const r = await this.prisma.campaignRecipient.findUnique({
      where: { id: job.data.recipientId },
      include: { campaign: { include: { connection: true, tenant: { select: { planId: true, status: true } } } } },
    });
    if (!r || r.status !== 'queued') return;
    const { campaign } = r;
    const tenantId = r.tenantId;

    // --- Pre-send checks, immediately before sending (blueprint §9) ---
    if (campaign.status === 'cancelled' || campaign.tenant.status !== 'active') {
      await this.prisma.campaignRecipient.updateMany({ where: { id: r.id, status: 'queued' }, data: { status: 'cancelled' } });
      return this.afterOutcome(tenantId, campaign.id);
    }
    if (campaign.status !== 'running') return; // paused / scheduled: leave queued; dispatch re-enqueues on resume
    if (campaign.connection.status !== 'connected') return this.pauseCampaign(campaign.id, tenantId, 'CONNECTION_NOT_READY');

    const [optOut, contact] = await Promise.all([
      this.prisma.optOut.findUnique({ where: { tenantId_phoneE164: { tenantId, phoneE164: r.phoneE164 } } }),
      this.prisma.contact.findUnique({ where: { id: r.contactId }, select: { status: true, deletedAt: true } }),
    ]);
    if (optOut || !contact || contact.deletedAt || contact.status !== 'active') {
      const code = optOut ? 'OPTED_OUT' : 'CONTACT_UNAVAILABLE';
      await this.prisma.campaignRecipient.updateMany({ where: { id: r.id, status: 'queued' }, data: { status: 'skipped', lastErrorCode: code } });
      await this.event(tenantId, r.id, 'skipped', { code });
      return this.afterOutcome(tenantId, campaign.id);
    }

    if (!(await this.usage.tryConsumeMessage(tenantId, campaign.tenant.planId))) {
      return this.pauseCampaign(campaign.id, tenantId, 'QUOTA_EXHAUSTED');
    }

    // --- Claim with a lease (atomic) so no two workers send the same recipient ---
    const claimed = await this.prisma.campaignRecipient.updateMany({
      where: { id: r.id, status: 'queued' },
      data: { status: 'attempting', attemptCount: { increment: 1 }, leaseUntil: new Date(Date.now() + LEASE_MS) },
    });
    if (!claimed.count) {
      await this.usage.releaseMessage(tenantId);
      return;
    }
    await this.event(tenantId, r.id, 'attempted');

    const frozen = (campaign.frozenContent ?? {}) as any;
    let result: SendResult;
    try {
      const connector = this.registry.get(campaign.connection.connectorType);
      const caps = connector.getCapabilities();
      const ctx = await this.registry.context(campaign.connection);
      const media = frozen.mediaId ? await this.prisma.mediaAsset.findFirst({ where: { id: frozen.mediaId, tenantId, status: 'ready' } }) : null;
      result = await this.withConnectionLock(campaign.connectionId, caps.serialized, () =>
        connector.send({
          ctx, to: r.phoneE164, idempotencyKey: r.idempotencyKey, recipientId: r.id,
          text: frozen.messageType === 'text' ? r.renderedBody ?? '' : undefined,
          template: frozen.messageType === 'template' ? { name: frozen.templateName, language: frozen.templateLanguage, bodyParams: (r.renderedParams as string[] | null) ?? [] } : undefined,
          media: media ? { mediaId: media.id, kind: kindOf(media.mimeType), mimeType: media.mimeType, fileName: media.fileName, load: () => this.storage.read(media.objectKey) } : undefined,
        }),
      );
    } catch (e) {
      if (e instanceof RetryableSendError) result = { outcome: 'failed', code: 'CONNECTION_BUSY', retryable: true };
      else if (e instanceof ConnectorDisabledError) result = { outcome: 'failed', code: 'CONNECTOR_DISABLED', retryable: false };
      else {
        this.logger.error(`send crashed for recipient ${r.id}: ${(e as Error).message}`);
        result = { outcome: 'unknown', code: 'WORKER_ERROR' };
      }
    }

    if (result.outcome === 'failed' && ['DAILY_LIMIT_REACHED', 'CAMPAIGN_NOT_RUNNING'].includes(result.code)) {
      // Not a recipient failure: put it back in the queue and stop the campaign cleanly.
      await this.usage.releaseMessage(tenantId);
      await this.prisma.campaignRecipient.update({ where: { id: r.id }, data: { status: 'queued', leaseUntil: null, attemptCount: { decrement: 1 } } });
      if (result.code === 'DAILY_LIMIT_REACHED') await this.pauseCampaign(campaign.id, tenantId, 'DAILY_LIMIT_REACHED');
      return;
    }
    sendOutcomes.inc({ connector: campaign.connection.connectorType, outcome: result.outcome === 'failed' ? `failed:${result.code}` : result.outcome });
    await this.applyResult(r.id, tenantId, r.attemptCount + 1, result);
    await this.afterOutcome(tenantId, campaign.id);
    if (result.outcome === 'failed' && result.retryable && r.attemptCount + 1 < MAX_ATTEMPTS) {
      throw new RetryableSendError(result.code); // BullMQ exponential backoff re-runs this job
    }
  }

  private async applyResult(recipientId: string, tenantId: string, attempt: number, result: SendResult) {
    const now = new Date();
    if (result.outcome === 'submitted') {
      await this.prisma.campaignRecipient.update({ where: { id: recipientId }, data: { status: 'submitted', externalRef: result.externalRef, submittedAt: now, leaseUntil: null, lastErrorCode: null } });
      await this.prisma.messageEvent.create({ data: { tenantId, recipientId, eventType: 'submitted', source: 'connector', externalRef: result.externalRef, dedupKey: `${result.externalRef}:submitted`, occurredAt: now } });
    } else if (result.outcome === 'unknown') {
      // Ambiguous: do NOT retry blindly; quota stays consumed; webhooks may reconcile later.
      await this.prisma.campaignRecipient.update({ where: { id: recipientId }, data: { status: 'unknown', lastErrorCode: result.code, leaseUntil: null } });
      await this.event(tenantId, recipientId, 'unknown', { code: result.code });
    } else {
      await this.usage.releaseMessage(tenantId);
      const willRetry = result.retryable && attempt < MAX_ATTEMPTS;
      await this.prisma.campaignRecipient.update({
        where: { id: recipientId },
        data: willRetry
          ? { status: 'queued', lastErrorCode: result.code, leaseUntil: null }
          : { status: 'failed', lastErrorCode: result.code, failedAt: now, leaseUntil: null },
      });
      await this.event(tenantId, recipientId, willRetry ? 'retry_scheduled' : 'failed', { code: result.code });
    }
  }

  /** Throttled progress publishing + completion detection. */
  async afterOutcome(tenantId: string, campaignId: string) {
    const remaining = await this.prisma.campaignRecipient.count({ where: { campaignId, status: { in: ['queued', 'attempting'] } } });
    if (remaining === 0) {
      await this.prisma.campaign.updateMany({ where: { id: campaignId, status: 'running' }, data: { status: 'completed', completedAt: new Date() } });
      await this.campaigns.publishProgress(tenantId, campaignId);
      return;
    }
    if (await this.redis.client.set(`progress:${campaignId}`, '1', 'PX', 1000, 'NX')) {
      await this.campaigns.publishProgress(tenantId, campaignId);
    }
  }
}
