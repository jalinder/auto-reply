import { PrismaService } from '../../common/prisma.service';

export const RECIPIENT_STATUSES = ['queued', 'attempting', 'submitted', 'delivered', 'read', 'failed', 'unknown', 'skipped', 'cancelled'] as const;

export async function campaignCounts(prisma: PrismaService, campaignId: string) {
  const rows = await prisma.campaignRecipient.groupBy({ by: ['status'], where: { campaignId }, _count: { _all: true } });
  const counts: Record<string, number> = Object.fromEntries(RECIPIENT_STATUSES.map((s) => [s, 0]));
  for (const r of rows) counts[r.status] = r._count._all;
  counts.total = Object.values(counts).reduce((a, b) => a + b, 0);
  return counts;
}
