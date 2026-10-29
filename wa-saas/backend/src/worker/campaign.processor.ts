import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../common/prisma.service';
import { Queues } from '../common/queues';
import { CampaignsService } from '../modules/campaigns/campaigns.service';
import { ConnectorRegistry } from '../modules/connectors/connector.registry';

@Injectable()
export class CampaignProcessor {
  private readonly logger = new Logger(CampaignProcessor.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: Queues,
    private readonly registry: ConnectorRegistry,
    private readonly campaigns: CampaignsService,
  ) {}

  /** Enqueues one paced job per queued recipient. Safe to run repeatedly (claims are idempotent). */
  async dispatch(job: Job<{ campaignId: string; runId: number }>) {
    const c = await this.prisma.campaign.findUnique({ where: { id: job.data.campaignId }, include: { connection: true } });
    if (!c || !['scheduled', 'running'].includes(c.status)) return;
    if (c.connection.status !== 'connected') {
      await this.prisma.campaign.update({ where: { id: c.id }, data: { status: 'paused', pausedReason: 'CONNECTION_NOT_READY' } });
      return this.campaigns.publishProgress(c.tenantId, c.id);
    }
    if (c.status === 'scheduled') await this.prisma.campaign.update({ where: { id: c.id }, data: { status: 'running' } });
    const interval = this.registry.capabilities(c.connection.connectorType)?.minIntervalMs ?? 1000;

    let cursor: string | undefined;
    let index = 0;
    for (;;) {
      const batch = await this.prisma.campaignRecipient.findMany({
        where: { campaignId: c.id, status: 'queued' }, select: { id: true, idempotencyKey: true },
        orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!batch.length) break;
      await this.queues.send.addBulk(batch.map((r) => ({
        name: 'send',
        data: { recipientId: r.id },
        opts: { jobId: `${r.idempotencyKey}:r${job.data.runId}`.replace(/:/g, '_'), delay: index++ * interval },
      })));
      cursor = batch[batch.length - 1].id;
    }
    this.logger.log(`Dispatched ${index} recipients for campaign ${c.id}`);
    if (index === 0) {
      await this.prisma.campaign.updateMany({ where: { id: c.id, status: 'running' }, data: { status: 'completed', completedAt: new Date() } });
    }
    await this.campaigns.publishProgress(c.tenantId, c.id);
  }
}
