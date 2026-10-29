import { Injectable } from '@nestjs/common';
import { Prisma, WhatsappConnection } from '@prisma/client';
import { AppError, Errors } from '../../common/errors';
import { normalizePhone } from '../../common/phone';
import { PrismaService } from '../../common/prisma.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { ConnectorRegistry } from '../connectors/connector.registry';
import { kindOf } from '../media/file-signature';
import { UsageService } from '../usage/usage.service';

export interface SendMessageInput {
  tenantId: string;
  planId: string;
  userId: string;
  to: string;
  text?: string;
  mediaId?: string;
  connectionId?: string;
  defaultCountry?: string;
  idempotencyKey?: string;
  ip: string | null;
  requestId: string | null;
}

/**
 * One-off sends. A direct message is a campaign of exactly one recipient (kind = 'direct'), so it
 * inherits every guard the campaign pipeline already applies: opt-out checks, monthly quota, the
 * per-connection pacing and daily cap, acknowledgement tracking and the Unknown-outcome rules.
 * Nothing here talks to a browser: the send worker routes it to the session that holds the lease.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly campaigns: CampaignsService,
    private readonly registry: ConnectorRegistry,
    private readonly usage: UsageService,
  ) {}

  async send(input: SendMessageInput) {
    const { tenantId, userId } = input;
    const phone = normalizePhone(input.to, input.defaultCountry ?? 'IN');
    if (!phone) throw new AppError('INVALID_PHONE', 'Enter a valid phone number with country code.');
    const text = input.text?.trim() || undefined;
    if (!text && !input.mediaId) throw new AppError('EMPTY_MESSAGE', 'Write a message or attach a file.');

    // A replayed Idempotency-Key returns the original message instead of sending a second one.
    const key = input.idempotencyKey ? `direct:${input.idempotencyKey}` : null;
    if (key) {
      const prior = await this.byKey(tenantId, key);
      if (prior) return prior;
    }

    const connection = await this.resolveConnection(tenantId, input.connectionId);
    const media = input.mediaId ? await this.loadMedia(tenantId, input.mediaId, connection.connectorType) : null;

    const optOut = await this.prisma.optOut.findUnique({ where: { tenantId_phoneE164: { tenantId, phoneE164: phone } } });
    if (optOut) throw new AppError('OPTED_OUT', 'This number opted out of messages from you.', 409);

    const contact = await this.contactFor(tenantId, input.planId, phone);

    const campaign = await this.prisma.campaign.create({
      data: {
        tenantId, createdById: userId, kind: 'direct', name: `Direct message to ${phone}`,
        connectionId: connection.id, messageType: 'text', body: text ?? null, mediaId: media?.id ?? null,
        // Consent is not required: a one-off send is the caller's own decision, and opt-outs still apply.
        audience: { type: 'contacts', contactIds: [contact.id], requireConsent: false } as unknown as Prisma.InputJsonValue,
      },
    });

    try {
      await this.campaigns.launch(tenantId, userId, campaign.id, key ?? `direct:${campaign.id}`, 1,
        { ip: input.ip, requestId: input.requestId }, { auditAction: 'message.sent' });
    } catch (e) {
      // Never leave a half-made draft behind; a launched one is already 'scheduled' and is kept.
      await this.prisma.campaign.deleteMany({ where: { id: campaign.id, status: 'draft' } });
      // Two requests raced on the same key: return whichever one won.
      if (key && (this.isKeyConflict(e))) {
        const prior = await this.byKey(tenantId, key);
        if (prior) return prior;
      }
      throw e;
    }

    return this.messageOf(tenantId, campaign.id);
  }

  async get(tenantId: string, id: string) {
    const r = await this.prisma.campaignRecipient.findFirst({
      where: { id, tenantId, campaign: { kind: 'direct' } },
      include: { campaign: true },
    });
    if (!r) throw Errors.notFound('Message');
    return this.toPublic(r, r.campaign);
  }

  // ---------------- internals ----------------

  private isKeyConflict(e: unknown) {
    return (e instanceof AppError && e.code === 'IDEMPOTENCY_KEY_REUSED')
      || (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002');
  }

  /**
   * Null while the winning request is still between claiming the key and writing its recipient, so the
   * caller sees the key conflict rather than a 404 and can retry into the finished message.
   */
  private async byKey(tenantId: string, launchIdempotencyKey: string) {
    const prior = await this.prisma.campaign.findUnique({ where: { tenantId_launchIdempotencyKey: { tenantId, launchIdempotencyKey } } });
    return prior ? this.findMessage(tenantId, prior.id) : null;
  }

  private async findMessage(tenantId: string, campaignId: string) {
    const r = await this.prisma.campaignRecipient.findFirst({ where: { campaignId, tenantId }, include: { campaign: true } });
    return r ? this.toPublic(r, r.campaign) : null;
  }

  private async messageOf(tenantId: string, campaignId: string) {
    const m = await this.findMessage(tenantId, campaignId);
    if (!m) throw Errors.notFound('Message');
    return m;
  }

  /** With one connected number we pick it; with several the caller has to say which one sends. */
  private async resolveConnection(tenantId: string, id?: string): Promise<WhatsappConnection> {
    if (id) {
      const c = await this.prisma.whatsappConnection.findFirst({ where: { id, tenantId, status: { not: 'revoked' } } });
      if (!c) throw Errors.notFound('Connection');
      if (c.status !== 'connected') throw new AppError('CONNECTION_NOT_READY', 'That number is not connected right now.', 409);
      return c;
    }
    const connected = await this.prisma.whatsappConnection.findMany({ where: { tenantId, status: 'connected' }, orderBy: { connectedAt: 'asc' }, take: 2 });
    if (!connected.length) throw new AppError('NO_CONNECTED_NUMBER', 'Connect a WhatsApp number before sending.', 409);
    if (connected.length > 1) throw new AppError('CONNECTION_REQUIRED', 'More than one number is connected. Pass connectionId to choose which one sends.');
    return connected[0];
  }

  private async loadMedia(tenantId: string, mediaId: string, connectorType: string) {
    const m = await this.prisma.mediaAsset.findFirst({ where: { id: mediaId, tenantId, purpose: 'campaign', status: 'ready' } });
    if (!m) throw Errors.notFound('Media');
    const caps = this.registry.capabilities(connectorType);
    if (!caps?.media.includes(kindOf(m.mimeType))) throw new AppError('MEDIA_NOT_SUPPORTED', 'This number cannot send that kind of file.');
    return m;
  }

  /** Direct sends still go through a contact, so history, opt-outs and reporting stay in one place. */
  private async contactFor(tenantId: string, planId: string, phoneE164: string) {
    const existing = await this.prisma.contact.findUnique({ where: { tenantId_phoneE164: { tenantId, phoneE164 } } });
    if (existing && !existing.deletedAt) {
      if (existing.status !== 'active') throw new AppError('CONTACT_BLOCKED', 'This contact is blocked. Unblock them before sending.', 409);
      return existing;
    }
    if (!existing) await this.usage.assertCanAdd(tenantId, planId, 'contacts');
    return existing
      ? this.prisma.contact.update({ where: { id: existing.id }, data: { status: 'active', deletedAt: null } })
      : this.prisma.contact.create({ data: { tenantId, phoneE164, customFields: {}, tags: [] } });
  }

  private toPublic(r: any, campaign: { id: string; connectionId: string; body: string | null; mediaId: string | null }) {
    return {
      id: r.id, campaignId: campaign.id, connectionId: campaign.connectionId,
      to: r.phoneE164, text: campaign.body, mediaId: campaign.mediaId,
      status: r.status, attemptCount: r.attemptCount, lastErrorCode: r.lastErrorCode,
      submittedAt: r.submittedAt, deliveredAt: r.deliveredAt, readAt: r.readAt, failedAt: r.failedAt,
      createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
  }
}
