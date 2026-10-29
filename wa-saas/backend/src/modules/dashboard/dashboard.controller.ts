import { Controller, Get } from '@nestjs/common';
import { CurrentTenant, Public, TenantCtx } from '../../common/access';
import { planFor } from '../../common/plans';
import { PrismaService } from '../../common/prisma.service';
import { UsageService } from '../usage/usage.service';

@Controller('v1')
export class DashboardController {
  constructor(private readonly prisma: PrismaService, private readonly usage: UsageService) {}

  @Get('dashboard')
  async dashboard(@CurrentTenant() t: TenantCtx) {
    const since = new Date(Date.now() - 7 * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const [connections, contacts, optOuts, activeCampaigns, used, recent, daily] = await Promise.all([
      this.prisma.whatsappConnection.findMany({ where: { tenantId: t.id, status: { not: 'revoked' } }, select: { status: true } }),
      this.prisma.contact.count({ where: { tenantId: t.id, deletedAt: null } }),
      this.prisma.optOut.count({ where: { tenantId: t.id } }),
      this.prisma.campaign.count({ where: { tenantId: t.id, kind: 'campaign', status: { in: ['scheduled', 'running', 'paused'] } } }),
      this.usage.messagesUsed(t.id),
      this.prisma.campaign.findMany({ where: { tenantId: t.id, kind: 'campaign' }, orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, name: true, status: true, recipientCount: true, createdAt: true } }),
      this.prisma.$queryRaw<{ day: Date; eventType: string; n: bigint }[]>`
        SELECT DATE(occurredAt) AS day, eventType, COUNT(*) AS n FROM message_events
        WHERE tenantId = ${t.id} AND occurredAt >= ${since}
          AND eventType IN ('submitted','delivered','read','failed','unknown')
        GROUP BY DATE(occurredAt), eventType ORDER BY day`,
    ]);
    const days: Record<string, Record<string, number>> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(since.getTime() + (i + 1) * 86_400_000).toISOString().slice(0, 10);
      days[d] = { submitted: 0, delivered: 0, read: 0, failed: 0, unknown: 0 };
    }
    for (const r of daily) {
      const d = new Date(r.day).toISOString().slice(0, 10);
      if (days[d]) days[d][r.eventType] = Number(r.n);
    }
    return {
      connections: { total: connections.length, connected: connections.filter((c) => c.status === 'connected').length, needsAttention: connections.filter((c) => ['error', 'disconnected', 'qr_expired'].includes(c.status)).length },
      contacts, optOuts, activeCampaigns,
      messages: { used, limit: planFor(t.planId).limits.messagesPerMonth },
      last7Days: Object.entries(days).map(([day, counts]) => ({ day, ...counts })),
      recentCampaigns: recent,
    };
  }

  @Public()
  @Get('health')
  async health() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}
