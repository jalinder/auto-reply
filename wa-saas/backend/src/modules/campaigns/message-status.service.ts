import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma.service';

export type ProviderStatus = 'sent' | 'submitted' | 'delivered' | 'read' | 'failed';

const RANK: Record<string, number> = { queued: 0, attempting: 1, unknown: 1, submitted: 2, delivered: 3, read: 4 };

/**
 * Applies provider evidence to a recipient. Statuses only move forward; "unknown" can be
 * reconciled by later evidence; "failed" is accepted from submitted/delivered/unknown.
 */
@Injectable()
export class MessageStatusService {
  constructor(private readonly prisma: PrismaService) {}

  async apply(input: { tenantId?: string | null; externalRef: string; status: ProviderStatus; occurredAt?: Date | null; errorCode?: string | null; source: 'webhook' | 'connector' }) {
    const r = await this.prisma.campaignRecipient.findFirst({
      where: { externalRef: input.externalRef, ...(input.tenantId ? { tenantId: input.tenantId } : {}) },
    });
    if (!r) return null;
    const status = input.status === 'sent' ? 'submitted' : input.status;
    const occurredAt = input.occurredAt ?? new Date();
    try {
      await this.prisma.messageEvent.create({
        data: {
          tenantId: r.tenantId, recipientId: r.id, eventType: status, source: input.source, externalRef: input.externalRef,
          dedupKey: `${input.externalRef}:${status}`, occurredAt, safePayload: input.errorCode ? { code: input.errorCode } : undefined,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return r; // duplicate delivery
      throw e;
    }

    const data: Prisma.CampaignRecipientUpdateManyMutationInput = {};
    if (status === 'failed') {
      if (!['submitted', 'delivered', 'unknown', 'attempting'].includes(r.status)) return r;
      Object.assign(data, { status: 'failed', failedAt: occurredAt, lastErrorCode: input.errorCode ?? 'PROVIDER_FAILED' });
    } else {
      if ((RANK[status] ?? 0) <= (RANK[r.status] ?? 99)) {
        // Still record timestamps (e.g. delivered arriving after read).
        if (status === 'delivered' && !r.deliveredAt) data.deliveredAt = occurredAt;
      } else {
        data.status = status;
      }
      if (status === 'submitted' && !r.submittedAt) data.submittedAt = occurredAt;
      if (status === 'delivered' && !r.deliveredAt) data.deliveredAt = occurredAt;
      if (status === 'read') { data.readAt = occurredAt; if (!r.deliveredAt) data.deliveredAt = occurredAt; }
    }
    if (Object.keys(data).length) await this.prisma.campaignRecipient.updateMany({ where: { id: r.id }, data });
    return r;
  }
}
