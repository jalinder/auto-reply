import { Injectable } from '@nestjs/common';
import { currentPeriod, planFor } from '../../common/plans';
import { PrismaService } from '../../common/prisma.service';
import { Errors } from '../../common/errors';

export const MESSAGES_METRIC = 'messages_submitted';

@Injectable()
export class UsageService {
  constructor(private readonly prisma: PrismaService) {}

  async messagesUsed(tenantId: string) {
    const { start } = currentPeriod();
    const r = await this.prisma.usageRecord.findUnique({
      where: { tenantId_metric_periodStart: { tenantId, metric: MESSAGES_METRIC, periodStart: start } },
    });
    return r?.quantity ?? 0;
  }

  /** Atomically reserve one message of quota. Returns false when the monthly limit is reached. */
  async tryConsumeMessage(tenantId: string, planId: string): Promise<boolean> {
    const { start, end } = currentPeriod();
    const limit = planFor(planId).limits.messagesPerMonth;
    await this.prisma.usageRecord.upsert({
      where: { tenantId_metric_periodStart: { tenantId, metric: MESSAGES_METRIC, periodStart: start } },
      create: { tenantId, metric: MESSAGES_METRIC, quantity: 0, periodStart: start, periodEnd: end },
      update: {},
    });
    const res = await this.prisma.usageRecord.updateMany({
      where: { tenantId, metric: MESSAGES_METRIC, periodStart: start, quantity: { lt: limit } },
      data: { quantity: { increment: 1 } },
    });
    return res.count === 1;
  }

  async releaseMessage(tenantId: string) {
    const { start } = currentPeriod();
    await this.prisma.usageRecord.updateMany({
      where: { tenantId, metric: MESSAGES_METRIC, periodStart: start, quantity: { gt: 0 } },
      data: { quantity: { decrement: 1 } },
    });
  }

  async assertCanAdd(tenantId: string, planId: string, kind: 'connections' | 'contacts' | 'members', adding = 1) {
    const limits = planFor(planId).limits;
    const current =
      kind === 'connections'
        ? await this.prisma.whatsappConnection.count({ where: { tenantId, status: { notIn: ['revoked'] } } })
        : kind === 'contacts'
          ? await this.prisma.contact.count({ where: { tenantId, deletedAt: null } })
          : await this.prisma.tenantMember.count({ where: { tenantId, status: 'active' } });
    if (current + adding > limits[kind]) {
      throw Errors.planLimit(`Your plan allows ${limits[kind]} ${kind}. Upgrade to add more.`);
    }
  }
}
