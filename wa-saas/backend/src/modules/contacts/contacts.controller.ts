import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsObject, IsOptional, IsString, Length, Matches, MaxLength, ValidateNested,
} from 'class-validator';
import { Response } from 'express';
import {
  AuthUser, CurrentTenant, CurrentUser, MinRole, ReqMeta, RequestMeta, RequireStepUp, TenantCtx,
} from '../../common/access';
import { AuditService } from '../../common/audit.service';
import { AppError, Errors } from '../../common/errors';
import { page, PageQuery } from '../../common/pagination';
import { normalizePhone } from '../../common/phone';
import { PrismaService } from '../../common/prisma.service';
import { Queues } from '../../common/queues';
import { StorageService } from '../media/storage.service';
import { UsageService } from '../usage/usage.service';
import { csvCell, parseSheet } from './spreadsheet';

const PURPOSES = ['marketing', 'transactional', 'support'];

class ConsentDto {
  @IsIn(PURPOSES) purpose: string;
  @IsString() @Length(2, 80) source: string;
}
class CreateContactDto {
  @IsString() @Length(4, 30) phone: string;
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
  @IsOptional() @IsObject() customFields?: Record<string, string>;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsString() @Length(2, 2) defaultCountry?: string;
  @IsOptional() @ValidateNested() @Type(() => ConsentDto) consent?: ConsentDto;
}
class UpdateContactDto {
  @IsOptional() @IsString() @MaxLength(120) displayName?: string;
  @IsOptional() @IsObject() customFields?: Record<string, string>;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsIn(['active', 'blocked']) status?: string;
}
class ListQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(80) search?: string;
  @IsOptional() @IsString() @MaxLength(40) tag?: string;
}
class ImportMapping {
  @IsString() phone: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() tags?: string;
  @IsOptional() @IsObject() fields?: Record<string, string>;
}
class ImportDto {
  @IsString() mediaId: string;
  @ValidateNested() @Type(() => ImportMapping) mapping: ImportMapping;
  @IsOptional() @Matches(/^[A-Z]{2}$/) defaultCountry?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) addTags?: string[];
  @IsOptional() @ValidateNested() @Type(() => ConsentDto) consent?: ConsentDto;
}
class OptOutDto {
  @IsString() @Length(4, 30) phone: string;
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
  @IsOptional() @Matches(/^[A-Z]{2}$/) defaultCountry?: string;
}

function cleanTags(tags?: string[]) {
  return [...new Set((tags ?? []).map((t) => t.trim().toLowerCase().replace(/[^\w-]/g, '-').slice(0, 40)).filter(Boolean))];
}
function cleanFields(f?: Record<string, string>) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f ?? {})) {
    const key = k.trim().toLowerCase().replace(/[^\w]/g, '_').slice(0, 40);
    if (key && /^[a-z_]/.test(key)) out[key] = String(v ?? '').slice(0, 500);
  }
  return out;
}

@Controller('v1')
export class ContactsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly usage: UsageService,
    private readonly storage: StorageService,
    private readonly queues: Queues,
  ) {}

  private async toPublic(tenantId: string, contacts: Array<Prisma.ContactGetPayload<{ include: { consents: true } }>>) {
    const optOuts = await this.prisma.optOut.findMany({ where: { tenantId, phoneE164: { in: contacts.map((c) => c.phoneE164) } }, select: { phoneE164: true } });
    const opted = new Set(optOuts.map((o) => o.phoneE164));
    return contacts.map((c) => ({
      id: c.id, phone: c.phoneE164, displayName: c.displayName, customFields: c.customFields, tags: c.tags, status: c.status,
      optedOut: opted.has(c.phoneE164),
      consents: c.consents.filter((x) => !x.revokedAt).map((x) => ({ id: x.id, purpose: x.purpose, source: x.source, capturedAt: x.capturedAt })),
      createdAt: c.createdAt, updatedAt: c.updatedAt,
    }));
  }

  @Get('contacts')
  async list(@CurrentTenant() t: TenantCtx, @Query() q: ListQuery) {
    const limit = q.limit ?? 50;
    const where: Prisma.ContactWhereInput = { tenantId: t.id, deletedAt: null };
    if (q.search) {
      const s = q.search.trim();
      where.OR = [{ displayName: { contains: s } }, { phoneE164: { contains: s.replace(/[^\d+]/g, '') || s } }];
    }
    if (q.tag) where.tags = { array_contains: q.tag } as any;
    const [rows, total] = await Promise.all([
      this.prisma.contact.findMany({
        where, include: { consents: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
        ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
      }),
      this.prisma.contact.count({ where }),
    ]);
    const p = page(rows, limit);
    return { items: await this.toPublic(t.id, p.items), nextCursor: p.nextCursor, total };
  }

  @Get('contacts/tags')
  async tags(@CurrentTenant() t: TenantCtx) {
    const rows = await this.prisma.$queryRaw<{ tag: string; n: bigint }[]>`
      SELECT jt.tag AS tag, COUNT(*) AS n FROM contacts c,
      JSON_TABLE(c.tags, '$[*]' COLUMNS (tag VARCHAR(40) PATH '$')) jt
      WHERE c.tenantId = ${t.id} AND c.deletedAt IS NULL GROUP BY jt.tag ORDER BY n DESC LIMIT 200`;
    return { items: rows.map((r) => ({ tag: r.tag, count: Number(r.n) })) };
  }

  @MinRole('editor')
  @Post('contacts')
  async create(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body() dto: CreateContactDto) {
    const phone = normalizePhone(dto.phone, dto.defaultCountry ?? 'IN');
    if (!phone) throw new AppError('INVALID_PHONE', 'Enter a valid phone number with country code.');
    const existing = await this.prisma.contact.findUnique({ where: { tenantId_phoneE164: { tenantId: t.id, phoneE164: phone } } });
    if (existing && !existing.deletedAt) throw Errors.conflict('CONTACT_EXISTS', 'A contact with this number already exists.');
    if (!existing) await this.usage.assertCanAdd(t.id, t.planId, 'contacts');
    const data = { displayName: dto.displayName?.trim() || null, customFields: cleanFields(dto.customFields), tags: cleanTags(dto.tags), status: 'active', deletedAt: null };
    const c = existing
      ? await this.prisma.contact.update({ where: { id: existing.id }, data })
      : await this.prisma.contact.create({ data: { tenantId: t.id, phoneE164: phone, ...data } });
    if (dto.consent) {
      await this.prisma.contactConsent.create({ data: { tenantId: t.id, contactId: c.id, purpose: dto.consent.purpose, source: dto.consent.source, capturedAt: new Date() } });
    }
    await this.audit.log({ tenantId: t.id, actorId: u.id, action: 'contact.created', resourceType: 'contact', resourceId: c.id });
    const full = await this.prisma.contact.findUniqueOrThrow({ where: { id: c.id }, include: { consents: true } });
    return (await this.toPublic(t.id, [full]))[0];
  }

  @Get('contacts/:id')
  async get(@CurrentTenant() t: TenantCtx, @Param('id') id: string) {
    const c = await this.prisma.contact.findFirst({ where: { id, tenantId: t.id, deletedAt: null }, include: { consents: true } });
    if (!c) throw Errors.notFound('Contact');
    const recent = await this.prisma.campaignRecipient.findMany({
      where: { contactId: id, tenantId: t.id }, orderBy: { createdAt: 'desc' }, take: 20,
      include: { campaign: { select: { id: true, name: true } } },
    });
    return {
      ...(await this.toPublic(t.id, [c]))[0],
      history: recent.map((r) => ({ campaignId: r.campaign.id, campaignName: r.campaign.name, status: r.status, updatedAt: r.updatedAt })),
    };
  }

  @MinRole('editor')
  @Patch('contacts/:id')
  async update(@CurrentTenant() t: TenantCtx, @Param('id') id: string, @Body() dto: UpdateContactDto) {
    const c = await this.prisma.contact.findFirst({ where: { id, tenantId: t.id, deletedAt: null } });
    if (!c) throw Errors.notFound('Contact');
    await this.prisma.contact.update({
      where: { id },
      data: {
        displayName: dto.displayName !== undefined ? dto.displayName.trim() || null : undefined,
        customFields: dto.customFields ? cleanFields(dto.customFields) : undefined,
        tags: dto.tags ? cleanTags(dto.tags) : undefined,
        status: dto.status,
      },
    });
    return this.get(t, id);
  }

  @MinRole('editor') @HttpCode(204)
  @Delete('contacts/:id')
  async remove(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    const res = await this.prisma.contact.updateMany({
      where: { id, tenantId: t.id, deletedAt: null },
      data: { deletedAt: new Date(), displayName: null, customFields: {}, tags: [] },
    });
    if (!res.count) throw Errors.notFound('Contact');
    await this.audit.log({ tenantId: t.id, actorId: u.id, action: 'contact.deleted', resourceType: 'contact', resourceId: id });
  }

  @MinRole('editor')
  @Post('contacts/:id/consent')
  async addConsent(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: ConsentDto) {
    const c = await this.prisma.contact.findFirst({ where: { id, tenantId: t.id, deletedAt: null } });
    if (!c) throw Errors.notFound('Contact');
    await this.prisma.contactConsent.create({ data: { tenantId: t.id, contactId: id, purpose: dto.purpose, source: dto.source, capturedAt: new Date() } });
    await this.audit.log({ tenantId: t.id, actorId: u.id, action: 'consent.recorded', resourceType: 'contact', resourceId: id, metadata: { purpose: dto.purpose } });
    return this.get(t, id);
  }

  @MinRole('editor')
  @Delete('contacts/:id/consent/:consentId')
  async revokeConsent(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id') id: string, @Param('consentId') consentId: string) {
    const res = await this.prisma.contactConsent.updateMany({ where: { id: consentId, contactId: id, tenantId: t.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!res.count) throw Errors.notFound('Consent');
    await this.audit.log({ tenantId: t.id, actorId: u.id, action: 'consent.revoked', resourceType: 'contact', resourceId: id });
    return this.get(t, id);
  }

  // ---------- Imports ----------

  @MinRole('editor')
  @Post('contacts/import/preview')
  async importPreview(@CurrentTenant() t: TenantCtx, @Body('mediaId') mediaId: string) {
    const m = await this.prisma.mediaAsset.findFirst({ where: { id: String(mediaId), tenantId: t.id, purpose: 'import', status: 'ready' } });
    if (!m) throw Errors.notFound('Upload');
    const sheet = await parseSheet(await this.storage.read(m.objectKey), m.mimeType, 20);
    if (!sheet.headers.length) throw new AppError('EMPTY_FILE', 'This file has no header row.', 422);
    const guess = (re: RegExp) => sheet.headers.find((h) => re.test(h.toLowerCase())) ?? null;
    return {
      headers: sheet.headers,
      sampleRows: sheet.rows.slice(0, 5),
      suggestedMapping: { phone: guess(/phone|mobile|whatsapp|number|contact/), name: guess(/^name$|full.?name|customer|first.?name/), tags: guess(/tag|segment|group/) },
    };
  }

  @MinRole('editor') @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('contacts/import')
  async startImport(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body() dto: ImportDto) {
    const m = await this.prisma.mediaAsset.findFirst({ where: { id: dto.mediaId, tenantId: t.id, purpose: 'import', status: 'ready' } });
    if (!m) throw Errors.notFound('Upload');
    const running = await this.prisma.importJob.count({ where: { tenantId: t.id, status: { in: ['queued', 'processing'] } } });
    if (running >= 2) throw new AppError('IMPORT_BUSY', 'Wait for the current import to finish.', 409);
    const job = await this.prisma.importJob.create({
      data: {
        tenantId: t.id, mediaId: m.id, createdById: u.id,
        mapping: { ...dto.mapping, defaultCountry: dto.defaultCountry ?? 'IN', addTags: cleanTags(dto.addTags), consent: dto.consent ?? null } as any,
      },
    });
    await this.queues.imports.add('import', { importId: job.id }, { jobId: `import-${job.id}` });
    await this.audit.log({ tenantId: t.id, actorId: u.id, action: 'contacts.import_started', resourceType: 'import', resourceId: job.id });
    return this.importToPublic(job);
  }

  @Get('contacts/imports/:id')
  async importStatus(@CurrentTenant() t: TenantCtx, @Param('id') id: string) {
    const j = await this.prisma.importJob.findFirst({ where: { id, tenantId: t.id } });
    if (!j) throw Errors.notFound('Import');
    return this.importToPublic(j);
  }

  @Get('contacts/imports/:id/errors')
  async importErrors(@CurrentTenant() t: TenantCtx, @Param('id') id: string) {
    const j = await this.prisma.importJob.findFirst({ where: { id, tenantId: t.id } });
    if (!j?.errorFileKey) throw Errors.notFound('Error report');
    return { url: await this.storage.presignGet(j.errorFileKey, `import-errors-${id}.csv`, 300) };
  }

  private importToPublic(j: any) {
    return {
      id: j.id, status: j.status, rowCount: j.rowCount, createdCount: j.createdCount, updatedCount: j.updatedCount,
      invalidCount: j.invalidCount, duplicateCount: j.duplicateCount, optedOutCount: j.optedOutCount,
      hasErrorFile: !!j.errorFileKey, errorSample: j.errorSample ?? [], createdAt: j.createdAt, completedAt: j.completedAt,
    };
  }

  // ---------- Export (sensitive) ----------

  @MinRole('admin') @RequireStepUp() @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Get('contacts-export')
  async export(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Res() res: Response, @ReqMeta() meta: RequestMeta) {
    await this.audit.log({ tenantId: t.id, actorId: u.id, action: 'contacts.exported', resourceType: 'tenant', resourceId: t.id, ...meta });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
    res.setHeader('Cache-Control', 'no-store');
    res.write('phone,name,tags,custom_fields,opted_out,created_at\n');
    const optOuts = new Set((await this.prisma.optOut.findMany({ where: { tenantId: t.id }, select: { phoneE164: true } })).map((o) => o.phoneE164));
    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.contact.findMany({
        where: { tenantId: t.id, deletedAt: null }, orderBy: { id: 'asc' }, take: 1000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      if (!batch.length) break;
      for (const c of batch) {
        res.write([c.phoneE164, c.displayName, (c.tags as string[]).join('|'), JSON.stringify(c.customFields), optOuts.has(c.phoneE164) ? 'yes' : 'no', c.createdAt.toISOString()].map(csvCell).join(',') + '\n');
      }
      cursor = batch[batch.length - 1].id;
    }
    res.end();
  }

  // ---------- Opt-outs / suppression list ----------

  @Get('opt-outs')
  async optOuts(@CurrentTenant() t: TenantCtx, @Query() q: PageQuery & { search?: string }) {
    const limit = q.limit ?? 50;
    const rows = await this.prisma.optOut.findMany({
      where: { tenantId: t.id, ...(q.search ? { phoneE164: { contains: String(q.search).replace(/[^\d+]/g, '') } } : {}) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const p = page(rows, limit);
    return { ...p, items: p.items.map((o) => ({ id: o.id, phone: o.phoneE164, reason: o.reason, source: o.source, createdAt: o.createdAt })) };
  }

  @MinRole('editor')
  @Post('opt-outs')
  async addOptOut(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body() dto: OptOutDto) {
    const phone = normalizePhone(dto.phone, dto.defaultCountry ?? 'IN');
    if (!phone) throw new AppError('INVALID_PHONE', 'Enter a valid phone number with country code.');
    const o = await this.prisma.optOut.upsert({
      where: { tenantId_phoneE164: { tenantId: t.id, phoneE164: phone } },
      create: { tenantId: t.id, phoneE164: phone, reason: dto.reason ?? null, source: 'manual' },
      update: { reason: dto.reason ?? undefined },
    });
    // Honor promptly: skip any queued sends to this number.
    await this.prisma.campaignRecipient.updateMany({ where: { tenantId: t.id, phoneE164: phone, status: 'queued' }, data: { status: 'skipped', lastErrorCode: 'OPTED_OUT' } });
    await this.audit.log({ tenantId: t.id, actorId: u.id, action: 'optout.added', resourceType: 'opt_out', resourceId: o.id });
    return { id: o.id, phone: o.phoneE164, reason: o.reason, source: o.source, createdAt: o.createdAt };
  }

  @MinRole('admin') @HttpCode(204)
  @Delete('opt-outs/:id')
  async removeOptOut(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Param('id') id: string) {
    const res = await this.prisma.optOut.deleteMany({ where: { id, tenantId: t.id } });
    if (!res.count) throw Errors.notFound('Opt-out');
    await this.audit.log({ tenantId: t.id, actorId: u.id, action: 'optout.removed', resourceType: 'opt_out', resourceId: id });
  }
}
