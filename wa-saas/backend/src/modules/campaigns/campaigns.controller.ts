import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, Equals, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { AuthUser, CurrentTenant, CurrentUser, MinRole, ReqMeta, RequestMeta, TenantCtx } from '../../common/access';
import { AppError, Errors } from '../../common/errors';
import { page, PageQuery } from '../../common/pagination';
import { PrismaService } from '../../common/prisma.service';
import { campaignCounts } from './campaign-stats';
import { Audience, CampaignsService } from './campaigns.service';

class AudienceDto implements Audience {
  @IsIn(['all', 'tags', 'contacts']) type: 'all' | 'tags' | 'contacts';
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(100_000) @IsString({ each: true }) contactIds?: string[];
  @IsOptional() @IsBoolean() requireConsent?: boolean;
  @IsOptional() @IsIn(['marketing', 'transactional', 'support']) consentPurpose?: string;
}
class CampaignDto {
  @IsOptional() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsString() connectionId?: string;
  @IsOptional() @IsIn(['text', 'template']) messageType?: 'text' | 'template';
  @IsOptional() @IsString() @MaxLength(4096) body?: string;
  @IsOptional() @IsString() @MaxLength(120) templateName?: string;
  @IsOptional() @IsString() @MaxLength(20) templateLanguage?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) templateParams?: string[];
  @IsOptional() @IsString() mediaId?: string | null;
  @IsOptional() @ValidateNested() @Type(() => AudienceDto) audience?: AudienceDto;
  @IsOptional() @IsDateString() scheduledAt?: string | null;
}
class CreateCampaignDto extends CampaignDto {
  @IsString() @Length(1, 120) declare name: string;
  @IsString() declare connectionId: string;
}
class LaunchDto {
  @Equals(true, { message: 'Confirm the launch to continue.' }) confirm: boolean;
  @IsInt() @Min(1) expectedRecipientCount: number;
}
class ReportQuery extends PageQuery {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() @MaxLength(30) search?: string;
}

@Controller('v1/campaigns')
export class CampaignsController {
  constructor(private readonly prisma: PrismaService, private readonly svc: CampaignsService) {}

  private async toPublic(c: any, withCounts = false) {
    return {
      id: c.id, name: c.name, status: c.status, pausedReason: c.pausedReason, connectionId: c.connectionId,
      connection: c.connection ? { id: c.connection.id, label: c.connection.label, status: c.connection.status, connectorType: c.connection.connectorType } : undefined,
      messageType: c.messageType, body: c.body, templateName: c.templateName, templateLanguage: c.templateLanguage,
      templateParams: c.templateParams ?? [], mediaId: c.mediaId, audience: c.audience, scheduledAt: c.scheduledAt,
      launchedAt: c.launchedAt, completedAt: c.completedAt, recipientCount: c.recipientCount, version: c.version,
      createdAt: c.createdAt, updatedAt: c.updatedAt,
      ...(withCounts ? { counts: await campaignCounts(this.prisma, c.id) } : {}),
    };
  }

  private async validateRefs(tenantId: string, dto: CampaignDto) {
    if (dto.connectionId) {
      const conn = await this.prisma.whatsappConnection.findFirst({ where: { id: dto.connectionId, tenantId, status: { not: 'revoked' } } });
      if (!conn) throw Errors.notFound('Connection');
    }
    if (dto.mediaId) {
      const m = await this.prisma.mediaAsset.findFirst({ where: { id: dto.mediaId, tenantId, purpose: 'campaign', status: 'ready' } });
      if (!m) throw Errors.notFound('Media');
    }
    if (dto.scheduledAt && new Date(dto.scheduledAt).getTime() < Date.now() - 60_000) {
      throw new AppError('SCHEDULE_IN_PAST', 'Pick a time in the future.');
    }
  }

  @Get()
  async list(@CurrentTenant() t: TenantCtx, @Query() q: PageQuery & { status?: string }) {
    const limit = q.limit ?? 30;
    const rows = await this.prisma.campaign.findMany({
      where: { tenantId: t.id, kind: 'campaign', ...(q.status ? { status: String(q.status) } : {}) }, include: { connection: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const p = page(rows, limit);
    return { items: await Promise.all(p.items.map((c) => this.toPublic(c, true))), nextCursor: p.nextCursor };
  }

  @MinRole('editor')
  @Post()
  async create(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body() dto: CreateCampaignDto) {
    await this.validateRefs(t.id, dto);
    const c = await this.prisma.campaign.create({
      data: {
        tenantId: t.id, createdById: u.id, name: dto.name.trim(), connectionId: dto.connectionId, messageType: dto.messageType ?? 'text',
        body: dto.body ?? null, templateName: dto.templateName ?? null, templateLanguage: dto.templateLanguage ?? null,
        templateParams: (dto.templateParams ?? []) as any, mediaId: dto.mediaId ?? null,
        audience: (dto.audience ?? { type: 'all', requireConsent: true, consentPurpose: 'marketing' }) as any,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      },
      include: { connection: true },
    });
    return this.toPublic(c);
  }

  @Get(':id')
  async get(@CurrentTenant() t: TenantCtx, @Param('id') id: string) {
    return this.toPublic(await this.svc.getOwned(t.id, id), true);
  }

  @MinRole('editor')
  @Patch(':id')
  async update(@CurrentTenant() t: TenantCtx, @Param('id') id: string, @Body() dto: CampaignDto) {
    const c = await this.svc.getOwned(t.id, id);
    if (c.status !== 'draft') throw new AppError('INVALID_CAMPAIGN_STATE', 'Only drafts can be edited.', 409);
    await this.validateRefs(t.id, dto);
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: {
        name: dto.name?.trim(), connectionId: dto.connectionId, messageType: dto.messageType, body: dto.body,
        templateName: dto.templateName, templateLanguage: dto.templateLanguage,
        templateParams: dto.templateParams as any, mediaId: dto.mediaId === undefined ? undefined : dto.mediaId,
        audience: dto.audience as any,
        scheduledAt: dto.scheduledAt === undefined ? undefined : dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        version: { increment: 1 },
      },
      include: { connection: true },
    });
    return this.toPublic(updated);
  }

  @MinRole('editor') @HttpCode(204)
  @Delete(':id')
  async remove(@CurrentTenant() t: TenantCtx, @Param('id') id: string) {
    const res = await this.prisma.campaign.deleteMany({ where: { id, tenantId: t.id, status: 'draft' } });
    if (!res.count) throw new AppError('INVALID_CAMPAIGN_STATE', 'Only drafts can be deleted. Cancel it instead.', 409);
  }

  @MinRole('editor') @HttpCode(200)
  @Post(':id/preview')
  preview(@CurrentTenant() t: TenantCtx, @Param('id') id: string) {
    return this.svc.preview(t.id, id);
  }

  @MinRole('editor') @Throttle({ default: { limit: 5, ttl: 60_000 } }) @HttpCode(200)
  @Post(':id/launch')
  async launch(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: LaunchDto,
    @Headers('idempotency-key') idem: string | undefined, @ReqMeta() meta: RequestMeta) {
    if (!idem || !/^[\w-]{8,100}$/.test(idem)) throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required.');
    const c = await this.svc.launch(t.id, u.id, id, idem, dto.expectedRecipientCount, meta);
    return this.toPublic(await this.svc.getOwned(t.id, c.id), true);
  }

  @MinRole('editor') @HttpCode(200)
  @Post(':id/pause')
  async pause(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.svc.pause(t.id, u.id, id);
    return this.get(t, id);
  }

  @MinRole('editor') @HttpCode(200)
  @Post(':id/resume')
  async resume(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.svc.resume(t.id, u.id, id);
    return this.get(t, id);
  }

  @MinRole('editor') @HttpCode(200)
  @Post(':id/cancel')
  async cancel(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    await this.svc.cancel(t.id, u.id, id);
    return this.get(t, id);
  }

  @Get(':id/report')
  async report(@CurrentTenant() t: TenantCtx, @Param('id') id: string, @Query() q: ReportQuery) {
    await this.svc.getOwned(t.id, id);
    const limit = q.limit ?? 50;
    const rows = await this.prisma.campaignRecipient.findMany({
      where: { campaignId: id, tenantId: t.id, ...(q.status ? { status: q.status } : {}), ...(q.search ? { phoneE164: { contains: q.search.replace(/[^\d+]/g, '') } } : {}) },
      include: { contact: { select: { displayName: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const p = page(rows, limit);
    return {
      counts: await campaignCounts(this.prisma, id),
      nextCursor: p.nextCursor,
      items: p.items.map((r) => ({
        id: r.id, phone: r.phoneE164, displayName: r.contact.displayName, status: r.status, attemptCount: r.attemptCount,
        lastErrorCode: r.lastErrorCode, submittedAt: r.submittedAt, deliveredAt: r.deliveredAt, readAt: r.readAt, failedAt: r.failedAt, updatedAt: r.updatedAt,
      })),
    };
  }

  @Get(':id/recipients/:rid/events')
  async timeline(@CurrentTenant() t: TenantCtx, @Param('id') id: string, @Param('rid') rid: string) {
    const r = await this.prisma.campaignRecipient.findFirst({ where: { id: rid, campaignId: id, tenantId: t.id } });
    if (!r) throw Errors.notFound('Recipient');
    const events = await this.prisma.messageEvent.findMany({ where: { recipientId: rid }, orderBy: { occurredAt: 'asc' } });
    return {
      recipient: { id: r.id, phone: r.phoneE164, status: r.status, renderedBody: r.renderedBody, renderedParams: r.renderedParams },
      items: events.map((e) => ({ id: e.id, eventType: e.eventType, source: e.source, occurredAt: e.occurredAt, detail: (e.safePayload as any)?.code ?? null })),
    };
  }
}
