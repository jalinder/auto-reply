import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsInt, IsString, Length, Max, Min } from 'class-validator';
import { createHash } from 'crypto';
import { ulid } from 'ulid';
import { AuthUser, CurrentTenant, CurrentUser, MinRole, TenantCtx } from '../../common/access';
import { AppError, Errors } from '../../common/errors';
import { planFor } from '../../common/plans';
import { PrismaService } from '../../common/prisma.service';
import { ALLOWED, sniffMatches } from './file-signature';
import { scanBuffer } from './virus-scan';
import { StorageService } from './storage.service';

class UploadUrlDto {
  @IsString() @Length(1, 200) fileName: string;
  @IsString() mimeType: string;
  @IsInt() @Min(1) @Max(100 * 1024 * 1024) sizeBytes: number;
  @IsIn(['campaign', 'import']) purpose: 'campaign' | 'import';
}

const IMPORT_MAX_BYTES = 20 * 1024 * 1024;

@Controller('v1/media')
export class MediaController {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  @MinRole('editor') @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('upload-url')
  async uploadUrl(@CurrentTenant() t: TenantCtx, @CurrentUser() u: AuthUser, @Body() dto: UploadUrlDto) {
    const rule = ALLOWED[dto.mimeType];
    if (!rule || !rule.purposes.includes(dto.purpose)) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', dto.purpose === 'import' ? 'Upload a CSV or XLSX file.' : 'Upload a JPEG, PNG, WebP, PDF or MP4 file.', 415);
    }
    const max = dto.purpose === 'import' ? IMPORT_MAX_BYTES : planFor(t.planId).limits.mediaMaxBytes;
    if (dto.sizeBytes > max) throw new AppError('FILE_TOO_LARGE', `Files can be up to ${Math.round(max / 1024 / 1024)} MB on your plan.`, 413);
    const used = await this.prisma.mediaAsset.aggregate({ where: { tenantId: t.id, status: { in: ['pending', 'ready'] } }, _sum: { sizeBytes: true } });
    const quota = planFor(t.planId).limits.storageBytes;
    if ((used._sum.sizeBytes ?? 0) + dto.sizeBytes > quota) {
      throw new AppError('STORAGE_QUOTA_REACHED', `Your workspace has used its ${Math.round(quota / 1024 / 1024)} MB of storage. Delete old files or upgrade.`, 402);
    }
    const safeName = dto.fileName.replace(/[^\w.\- ]+/g, '_').slice(0, 200);
    const objectKey = `tenants/${t.id}/${dto.purpose}/${ulid()}`;
    const media = await this.prisma.mediaAsset.create({
      data: {
        tenantId: t.id, objectKey, fileName: safeName, mimeType: dto.mimeType, sizeBytes: dto.sizeBytes, purpose: dto.purpose,
        createdById: u.id, retentionUntil: new Date(Date.now() + (dto.purpose === 'import' ? 7 : 180) * 86_400_000),
      },
    });
    const uploadUrl = await this.storage.presignPut(objectKey, dto.mimeType, dto.sizeBytes, 600);
    return { mediaId: media.id, uploadUrl, method: 'PUT', headers: { 'Content-Type': dto.mimeType }, expiresAt: new Date(Date.now() + 600_000) };
  }

  /** Verifies the uploaded object actually exists, matches the declared size and has a valid file signature. */
  @MinRole('editor')
  @Post(':id/complete')
  async complete(@CurrentTenant() t: TenantCtx, @Param('id') id: string) {
    const m = await this.prisma.mediaAsset.findFirst({ where: { id, tenantId: t.id } });
    if (!m) throw Errors.notFound('File');
    if (m.status === 'ready') return this.toPublic(m);
    const head = await this.storage.head(m.objectKey);
    if (!head) throw new AppError('UPLOAD_NOT_FOUND', 'The upload did not finish. Try uploading again.', 409);
    const reject = async (reason: string, msg: string) => {
      await this.prisma.mediaAsset.update({ where: { id }, data: { status: 'rejected', rejectReason: reason } });
      await this.storage.delete(m.objectKey).catch(() => undefined);
      throw new AppError(reason, msg, 422);
    };
    if (head.size !== m.sizeBytes) await reject('SIZE_MISMATCH', 'The uploaded file size does not match. Try again.');
    const bytes = await this.storage.readRange(m.objectKey, Math.min(m.sizeBytes, 4096));
    if (!sniffMatches(m.mimeType, bytes)) await reject('FILE_SIGNATURE_MISMATCH', 'This file’s contents do not match its type.');
    const full = m.sizeBytes <= 4096 ? bytes : await this.storage.read(m.objectKey);
    let threat: string | null = null;
    try {
      threat = await scanBuffer(full);
    } catch {
      throw new AppError('SCAN_UNAVAILABLE', 'We couldn’t scan this file right now. Try again in a minute.', 503);
    }
    if (threat) await reject('MALWARE_DETECTED', 'This file was blocked because it looks unsafe.');
    const checksum = createHash('sha256').update(full).digest('hex');
    const ready = await this.prisma.mediaAsset.update({ where: { id }, data: { status: 'ready', checksum } });
    return this.toPublic(ready);
  }

  @Get()
  async list(@CurrentTenant() t: TenantCtx, @Query('purpose') purpose = 'campaign') {
    const rows = await this.prisma.mediaAsset.findMany({
      where: { tenantId: t.id, purpose, status: 'ready' }, orderBy: { createdAt: 'desc' }, take: 100,
    });
    return { items: rows.map((r) => this.toPublic(r)) };
  }

  @Get(':id/url')
  async url(@CurrentTenant() t: TenantCtx, @Param('id') id: string) {
    const m = await this.prisma.mediaAsset.findFirst({ where: { id, tenantId: t.id, status: 'ready' } });
    if (!m) throw Errors.notFound('File');
    return { url: await this.storage.presignGet(m.objectKey, m.fileName, 300), expiresIn: 300 };
  }

  private toPublic(m: { id: string; fileName: string; mimeType: string; sizeBytes: number; status: string; createdAt: Date }) {
    return { id: m.id, fileName: m.fileName, mimeType: m.mimeType, sizeBytes: m.sizeBytes, status: m.status, createdAt: m.createdAt };
  }
}
