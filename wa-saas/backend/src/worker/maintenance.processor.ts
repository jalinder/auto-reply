import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { CampaignsService } from '../modules/campaigns/campaigns.service';
import { MessageStatusService, ProviderStatus } from '../modules/campaigns/message-status.service';
import { ConnectionsService } from '../modules/connections/connections.service';
import { ConnectorRegistry } from '../modules/connectors/connector.registry';
import { StorageService } from '../modules/media/storage.service';
import { config } from '../common/config';
import { SendProcessor } from './send.processor';

@Injectable()
export class MaintenanceProcessor {
  private readonly logger = new Logger(MaintenanceProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly connections: ConnectionsService,
    private readonly registry: ConnectorRegistry,
    private readonly status: MessageStatusService,
    private readonly campaigns: CampaignsService,
    private readonly send: SendProcessor,
    private readonly storage: StorageService,
  ) {}

  async applyStatus(job: Job<{ tenantId: string; externalRef: string; status: string; errorCode: string | null; occurredAt: string | null }>) {
    const d = job.data;
    if (!['sent', 'delivered', 'read', 'failed'].includes(d.status)) return;
    const r = await this.status.apply({
      tenantId: d.tenantId, externalRef: d.externalRef, status: d.status as ProviderStatus,
      occurredAt: d.occurredAt ? new Date(d.occurredAt) : null, errorCode: d.errorCode, source: 'webhook',
    });
    if (r) await this.send.afterOutcome(r.tenantId, r.campaignId);
  }

  async connectionJob(job: Job<any>) {
    if (job.name === 'qr-expire') {
      const c = await this.prisma.whatsappConnection.findUnique({ where: { id: job.data.connectionId } });
      if (c?.status === 'waiting_for_qr' && c.qrExpiresAt && c.qrExpiresAt.getTime() <= Date.now() + 1000) {
        await this.connections.transition(c, 'qr_expired');
      }
    } else if (job.name === 'sandbox-linked') {
      const c = await this.prisma.whatsappConnection.findUnique({ where: { id: job.data.connectionId } });
      if (c?.status === 'linking') {
        const suffix = String(Math.floor(100 + Math.random() * 899));
        await this.connections.transition(c, 'connected', { maskedAccount: `+91••••${suffix}`, connectedAt: new Date(), lastSeenAt: new Date(), lastErrorCode: null });
      }
    }
  }

  /** Retention policy (blueprint §12). Windows are configurable; see README. */
  private async applyRetention() {
    const days = (n: number) => new Date(Date.now() - n * 86_400_000);
    const r = config.retention;
    // Message content: drop rendered text after the window; keep statuses for reporting.
    await this.prisma.campaignRecipient.updateMany({ where: { createdAt: { lt: days(r.messageContentDays) }, renderedBody: { not: null } }, data: { renderedBody: null, renderedParams: undefined } });
    await this.prisma.messageEvent.deleteMany({ where: { occurredAt: { lt: days(r.messageEventDays) } } });
    await this.prisma.connectionEvent.deleteMany({ where: { createdAt: { lt: days(r.messageEventDays) } } });
    await this.prisma.auditLog.deleteMany({ where: { createdAt: { lt: days(r.auditDays) } } });

    // Deleted workspaces: hard-delete everything after the grace period, including browser profiles.
    const doomed = await this.prisma.tenant.findMany({ where: { status: 'deleted', deletedAt: { lt: days(r.deletedTenantDays) } }, take: 20 });
    for (const t of doomed) {
      const conns = await this.prisma.whatsappConnection.findMany({ where: { tenantId: t.id } });
      for (const c of conns) {
        await this.registry.raw(c.connectorType)?.disconnect({ connection: c, secret: null }).catch(() => undefined);
      }
      await this.storage.deletePrefix(`tenants/${t.id}/`);
      await this.prisma.connectorSecret.deleteMany({ where: { tenantId: t.id } });
      await this.prisma.messageEvent.deleteMany({ where: { tenantId: t.id } });
      await this.prisma.campaignRecipient.deleteMany({ where: { tenantId: t.id } });
      await this.prisma.contactConsent.deleteMany({ where: { tenantId: t.id } });
      await this.prisma.importJob.deleteMany({ where: { tenantId: t.id } });
      await this.prisma.usageRecord.deleteMany({ where: { tenantId: t.id } });
      await this.prisma.tenant.delete({ where: { id: t.id } }); // cascades contacts, campaigns, media rows, members…
      await this.prisma.auditLog.create({ data: { action: 'tenant.purged', resourceType: 'tenant', resourceId: t.id } });
      this.logger.log(`Purged deleted workspace ${t.id}`);
    }
  }

  async maintenance(job: Job) {
    if (job.name === 'recover-leases') {
      // Attempts whose worker died mid-send are ambiguous: mark Unknown rather than resend.
      const stale = await this.prisma.campaignRecipient.findMany({ where: { status: 'attempting', leaseUntil: { lt: new Date() } }, take: 500 });
      for (const r of stale) {
        const res = await this.prisma.campaignRecipient.updateMany({ where: { id: r.id, status: 'attempting' }, data: { status: 'unknown', lastErrorCode: 'LEASE_EXPIRED', leaseUntil: null } });
        if (res.count) {
          await this.prisma.messageEvent.create({ data: { tenantId: r.tenantId, recipientId: r.id, eventType: 'unknown', source: 'system', occurredAt: new Date(), safePayload: { code: 'LEASE_EXPIRED' } } });
          await this.send.afterOutcome(r.tenantId, r.campaignId);
        }
      }
      if (stale.length) this.logger.warn(`Recovered ${stale.length} expired leases`);
    } else if (job.name === 'health-checks') {
      const conns = await this.prisma.whatsappConnection.findMany({ where: { status: { in: ['connected', 'error'] }, connectorType: 'browser' }, take: 500 });
      for (const c of conns) {
        const connector = this.registry.raw(c.connectorType);
        if (!connector) continue;
        const h = await connector.checkHealth(await this.registry.context(c)).catch(() => ({ ok: false, code: 'HEALTH_CHECK_FAILED' }));
        await this.connections.markHealth(c, h.ok, h.code);
      }
    } else if (job.name === 'retention') {
      const expired = await this.prisma.mediaAsset.findMany({ where: { retentionUntil: { lt: new Date() } }, take: 500 });
      for (const m of expired) {
        const inUse = await this.prisma.campaign.count({ where: { mediaId: m.id, status: { in: ['draft', 'scheduled', 'running', 'paused'] } } });
        if (inUse) continue;
        await this.storage.delete(m.objectKey).catch(() => undefined);
        await this.prisma.mediaAsset.delete({ where: { id: m.id } });
      }
      await this.prisma.webhookReceipt.deleteMany({ where: { receivedAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } });
      await this.prisma.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
      await this.prisma.loginChallenge.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } });
      await this.prisma.passwordReset.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 7 * 86_400_000) } } });
      await this.applyRetention();
    }
  }
}
