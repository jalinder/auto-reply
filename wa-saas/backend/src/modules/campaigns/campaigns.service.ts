import { Injectable } from '@nestjs/common';
import { Campaign, Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit.service';
import { AppError, Errors } from '../../common/errors';
import { planFor } from '../../common/plans';
import { PrismaService } from '../../common/prisma.service';
import { Queues } from '../../common/queues';
import { RedisService } from '../../common/redis';
import { contactVariables, placeholdersIn, render } from '../../common/template';
import { ConnectorRegistry } from '../connectors/connector.registry';
import { UsageService } from '../usage/usage.service';
import { campaignCounts } from './campaign-stats';

export interface Audience {
  type: 'all' | 'tags' | 'contacts';
  tags?: string[];
  contactIds?: string[];
  requireConsent?: boolean;
  consentPurpose?: string;
}

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConnectorRegistry,
    private readonly queues: Queues,
    private readonly redis: RedisService,
    private readonly usage: UsageService,
    private readonly audit: AuditService,
  ) {}

  async getOwned(tenantId: string, id: string) {
    const c = await this.prisma.campaign.findFirst({ where: { id, tenantId }, include: { connection: true } });
    if (!c) throw Errors.notFound('Campaign');
    return c;
  }

  private baseWhere(tenantId: string, a: Audience): Prisma.ContactWhereInput {
    const where: Prisma.ContactWhereInput = { tenantId, deletedAt: null };
    if (a.type === 'tags') where.OR = (a.tags ?? []).map((t) => ({ tags: { array_contains: t } as any }));
    if (a.type === 'contacts') where.id = { in: (a.contactIds ?? []).slice(0, 100_000) };
    return where;
  }

  /** Breaks the selected audience into eligible and excluded groups, with reasons. */
  async resolveAudience(tenantId: string, a: Audience) {
    const base = this.baseWhere(tenantId, a);
    const selected = await this.prisma.contact.findMany({ where: base, select: { id: true, phoneE164: true, status: true } });
    const phones = selected.map((c) => c.phoneE164);
    const opted = new Set(
      (await this.prisma.optOut.findMany({ where: { tenantId, phoneE164: { in: phones } }, select: { phoneE164: true } })).map((o) => o.phoneE164),
    );
    const requireConsent = a.requireConsent !== false;
    const purpose = a.consentPurpose ?? 'marketing';
    const consented = requireConsent
      ? new Set((await this.prisma.contactConsent.findMany({
          where: { tenantId, contactId: { in: selected.map((c) => c.id) }, purpose, revokedAt: null }, select: { contactId: true },
        })).map((c) => c.contactId))
      : null;

    const eligible: string[] = [];
    let optedOut = 0, noConsent = 0, blocked = 0;
    for (const c of selected) {
      if (opted.has(c.phoneE164)) optedOut++;
      else if (c.status !== 'active') blocked++;
      else if (consented && !consented.has(c.id)) noConsent++;
      else eligible.push(c.id);
    }
    return { selected: selected.length, eligibleIds: eligible, excluded: { optedOut, noConsent, blocked } };
  }

  validateContent(c: Pick<Campaign, 'messageType' | 'body' | 'templateName' | 'templateLanguage' | 'templateParams' | 'mediaId'>, connectorType: string) {
    const caps = this.registry.capabilities(connectorType);
    const errors: string[] = [];
    if (c.messageType === 'template') {
      if (!caps?.templates) errors.push('This connection does not support approved templates.');
      if (!c.templateName || !c.templateLanguage) errors.push('Choose an approved template.');
    } else {
      if (!c.body?.trim() && !c.mediaId) errors.push('Write a message or attach a file.');
      if ((c.body ?? '').length > 4096) errors.push('Messages can be up to 4,096 characters.');
    }
    return { errors, caps };
  }

  async preview(tenantId: string, id: string) {
    const c = await this.getOwned(tenantId, id);
    const audience = c.audience as unknown as Audience;
    const resolved = await this.resolveAudience(tenantId, audience);
    const { errors, caps } = this.validateContent(c, c.connection.connectorType);
    const warnings: string[] = [];
    if (c.messageType === 'text' && caps?.freeformRequiresOpenWindow) {
      warnings.push('Free-form text only reaches people who messaged you in the last 24 hours. Use an approved template for marketing.');
    }
    if (c.connection.status !== 'connected') errors.push('Connect WhatsApp before launching this campaign.');
    const plan = planFor((await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).planId);
    const remaining = plan.limits.messagesPerMonth - (await this.usage.messagesUsed(tenantId));
    if (resolved.eligibleIds.length > plan.limits.campaignMaxRecipients) errors.push(`Your plan allows ${plan.limits.campaignMaxRecipients} recipients per campaign.`);
    if (resolved.eligibleIds.length > remaining) errors.push(`Only ${Math.max(0, remaining)} messages left this month.`);
    if (resolved.eligibleIds.length === 0) errors.push('No eligible recipients. Check consent and opt-outs.');

    const sampleContacts = await this.prisma.contact.findMany({ where: { id: { in: resolved.eligibleIds.slice(0, 3) } } });
    const placeholders = c.messageType === 'template' ? ((c.templateParams as string[] | null) ?? []).flatMap(placeholdersIn) : placeholdersIn(c.body);
    const samples = sampleContacts.map((ct) => {
      const vars = contactVariables(ct);
      if (c.messageType === 'template') {
        const params = ((c.templateParams as string[] | null) ?? []).map((p) => render(p, vars));
        return { contact: { id: ct.id, displayName: ct.displayName, phone: ct.phoneE164 }, rendered: params.map((p) => p.text).join(' | '), missing: [...new Set(params.flatMap((p) => p.missing))] };
      }
      const r = render(c.body ?? '', vars);
      return { contact: { id: ct.id, displayName: ct.displayName, phone: ct.phoneE164 }, rendered: r.text, missing: r.missing };
    });
    if (samples.some((s) => s.missing.length)) warnings.push('Some recipients are missing values for placeholders; those parts will be left blank.');

    return {
      audience: { selected: resolved.selected, eligible: resolved.eligibleIds.length, excluded: resolved.excluded },
      placeholders, samples, errors, warnings, canLaunch: errors.length === 0,
      connection: { id: c.connection.id, label: c.connection.label, status: c.connection.status, maskedAccount: c.connection.maskedAccount },
      messagesRemaining: Math.max(0, remaining),
    };
  }

  async launch(tenantId: string, userId: string, id: string, idempotencyKey: string, expectedCount: number, meta: { ip: string | null; requestId: string | null }, opts: { auditAction?: string } = {}) {
    const prior = await this.prisma.campaign.findUnique({ where: { tenantId_launchIdempotencyKey: { tenantId, launchIdempotencyKey: idempotencyKey } } });
    if (prior) {
      if (prior.id !== id) throw new AppError('IDEMPOTENCY_KEY_REUSED', 'This launch key was used for another campaign.', 409);
      return prior;
    }
    const preview = await this.preview(tenantId, id);
    if (!preview.canLaunch) throw new AppError('CAMPAIGN_NOT_READY', preview.errors[0], 409, { errors: preview.errors });
    if (preview.audience.eligible !== expectedCount) {
      throw new AppError('AUDIENCE_CHANGED', 'The audience changed since your preview. Review the new count and confirm again.', 409, { eligible: preview.audience.eligible });
    }

    const c = await this.getOwned(tenantId, id);
    if (c.status !== 'draft') throw new AppError('INVALID_CAMPAIGN_STATE', 'Only drafts can be launched.', 409);
    const resolved = await this.resolveAudience(tenantId, c.audience as unknown as Audience);
    const version = c.version;
    const frozen = { messageType: c.messageType, body: c.body, templateName: c.templateName, templateLanguage: c.templateLanguage, templateParams: c.templateParams, mediaId: c.mediaId, version };

    // Claim the draft first so two concurrent launches cannot both proceed.
    const claimed = await this.prisma.campaign.updateMany({
      where: { id, tenantId, status: 'draft' },
      data: { status: 'scheduled', launchIdempotencyKey: idempotencyKey, frozenContent: frozen as any, launchedAt: new Date(), recipientCount: resolved.eligibleIds.length },
    });
    if (!claimed.count) throw new AppError('INVALID_CAMPAIGN_STATE', 'Only drafts can be launched.', 409);

    for (let i = 0; i < resolved.eligibleIds.length; i += 1000) {
      const ids = resolved.eligibleIds.slice(i, i + 1000);
      const contacts = await this.prisma.contact.findMany({ where: { id: { in: ids } } });
      await this.prisma.campaignRecipient.createMany({
        skipDuplicates: true,
        data: contacts.map((ct) => {
          const vars = contactVariables(ct);
          return {
            campaignId: id, tenantId, contactId: ct.id, phoneE164: ct.phoneE164,
            renderedBody: c.messageType === 'text' ? render(c.body ?? '', vars).text : null,
            renderedParams: c.messageType === 'template' ? (((c.templateParams as string[] | null) ?? []).map((p) => render(p, vars).text) as any) : undefined,
            idempotencyKey: `${id}:v${version}:${ct.id}`,
          };
        }),
      });
    }

    const delay = c.scheduledAt ? Math.max(0, c.scheduledAt.getTime() - Date.now()) : 0;
    await this.queues.campaign.add('dispatch', { campaignId: id, runId: Date.now() }, { delay, jobId: `dispatch-${id}-initial` });
    await this.audit.log({ tenantId, actorId: userId, action: opts.auditAction ?? 'campaign.launched', resourceType: 'campaign', resourceId: id, metadata: { recipients: resolved.eligibleIds.length, scheduledAt: c.scheduledAt }, ...meta });
    await this.publishProgress(tenantId, id);
    return this.prisma.campaign.findUniqueOrThrow({ where: { id } });
  }

  async pause(tenantId: string, userId: string, id: string) {
    const res = await this.prisma.campaign.updateMany({ where: { id, tenantId, status: { in: ['scheduled', 'running'] } }, data: { status: 'paused', pausedReason: 'USER_PAUSED' } });
    if (!res.count) throw new AppError('INVALID_CAMPAIGN_STATE', 'Only scheduled or running campaigns can be paused.', 409);
    await this.audit.log({ tenantId, actorId: userId, action: 'campaign.paused', resourceType: 'campaign', resourceId: id });
    await this.publishProgress(tenantId, id);
  }

  async resume(tenantId: string, userId: string, id: string) {
    const c = await this.getOwned(tenantId, id);
    if (c.status !== 'paused') throw new AppError('INVALID_CAMPAIGN_STATE', 'Only paused campaigns can be resumed.', 409);
    if (c.connection.status !== 'connected') throw new AppError('CONNECTION_NOT_READY', 'Reconnect WhatsApp before resuming.', 409);
    await this.prisma.campaign.update({ where: { id }, data: { status: 'running', pausedReason: null } });
    await this.queues.campaign.add('dispatch', { campaignId: id, runId: Date.now() });
    await this.audit.log({ tenantId, actorId: userId, action: 'campaign.resumed', resourceType: 'campaign', resourceId: id });
    await this.publishProgress(tenantId, id);
  }

  async cancel(tenantId: string, userId: string, id: string) {
    const res = await this.prisma.campaign.updateMany({ where: { id, tenantId, status: { in: ['draft', 'scheduled', 'running', 'paused'] } }, data: { status: 'cancelled', completedAt: new Date() } });
    if (!res.count) throw new AppError('INVALID_CAMPAIGN_STATE', 'This campaign has already finished.', 409);
    await this.prisma.campaignRecipient.updateMany({ where: { campaignId: id, status: 'queued' }, data: { status: 'cancelled' } });
    await this.audit.log({ tenantId, actorId: userId, action: 'campaign.cancelled', resourceType: 'campaign', resourceId: id });
    await this.publishProgress(tenantId, id);
  }

  async publishProgress(tenantId: string, id: string) {
    const c = await this.prisma.campaign.findUnique({ where: { id }, select: { status: true } });
    if (!c) return;
    await this.redis.publish(tenantId, { type: 'campaign.progress', data: { id, status: c.status, counts: await campaignCounts(this.prisma, id) } });
  }
}
