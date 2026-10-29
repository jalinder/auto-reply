import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';
import { planFor } from '../common/plans';
import { normalizePhone } from '../common/phone';
import { PrismaService } from '../common/prisma.service';
import { RedisService } from '../common/redis';
import { csvCell, parseSheet } from '../modules/contacts/spreadsheet';
import { StorageService } from '../modules/media/storage.service';

@Injectable()
export class ImportProcessor {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService, private readonly redis: RedisService) {}

  async process(job: Job<{ importId: string }>) {
    const imp = await this.prisma.importJob.findUnique({ where: { id: job.data.importId } });
    if (!imp || imp.status === 'completed') return;
    await this.prisma.importJob.update({ where: { id: imp.id }, data: { status: 'processing' } });
    await this.redis.publish(imp.tenantId, { type: 'import.updated', data: { id: imp.id, status: 'processing' } });
    const mapping = imp.mapping as any;
    try {
      const media = await this.prisma.mediaAsset.findFirstOrThrow({ where: { id: imp.mediaId, tenantId: imp.tenantId } });
      const sheet = await parseSheet(await this.storage.read(media.objectKey), media.mimeType);
      const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: imp.tenantId } });
      const contactLimit = planFor(tenant.planId).limits.contacts;
      let existingCount = await this.prisma.contact.count({ where: { tenantId: imp.tenantId, deletedAt: null } });

      const optOuts = new Set((await this.prisma.optOut.findMany({ where: { tenantId: imp.tenantId }, select: { phoneE164: true } })).map((o) => o.phoneE164));
      const seen = new Set<string>();
      const errors: { row: number; phone: string; reason: string }[] = [];
      let created = 0, updated = 0, invalid = 0, dup = 0, opted = 0;

      for (let i = 0; i < sheet.rows.length; i += 500) {
        const chunk = sheet.rows.slice(i, i + 500);
        for (let j = 0; j < chunk.length; j++) {
          const row = chunk[j];
          const rowNo = i + j + 2;
          const raw = row[mapping.phone] ?? '';
          const phone = normalizePhone(raw, mapping.defaultCountry ?? 'IN');
          if (!phone) { invalid++; errors.push({ row: rowNo, phone: raw, reason: 'Invalid phone number' }); continue; }
          if (seen.has(phone)) { dup++; errors.push({ row: rowNo, phone: raw, reason: 'Duplicate in file' }); continue; }
          seen.add(phone);
          if (optOuts.has(phone)) opted++; // imported but stays suppressed

          const fields: Record<string, string> = {};
          for (const [key, col] of Object.entries((mapping.fields ?? {}) as Record<string, string>)) {
            const k = key.trim().toLowerCase().replace(/[^\w]/g, '_').slice(0, 40);
            if (k && row[col] !== undefined) fields[k] = String(row[col]).slice(0, 500);
          }
          const tags = [
            ...(mapping.addTags ?? []),
            ...(mapping.tags && row[mapping.tags] ? String(row[mapping.tags]).split(/[|,;]/) : []),
          ].map((t: string) => t.trim().toLowerCase().replace(/[^\w-]/g, '-').slice(0, 40)).filter(Boolean);
          const name = mapping.name ? String(row[mapping.name] ?? '').trim().slice(0, 120) || null : null;

          const existing = await this.prisma.contact.findUnique({ where: { tenantId_phoneE164: { tenantId: imp.tenantId, phoneE164: phone } } });
          let contactId: string;
          if (existing) {
            const mergedTags = [...new Set([...(existing.tags as string[]), ...tags])].slice(0, 20);
            await this.prisma.contact.update({
              where: { id: existing.id },
              data: { displayName: name ?? existing.displayName, customFields: { ...(existing.customFields as object), ...fields }, tags: mergedTags, deletedAt: null },
            });
            if (existing.deletedAt) existingCount++;
            contactId = existing.id;
            updated++;
          } else {
            if (existingCount >= contactLimit) { errors.push({ row: rowNo, phone: raw, reason: 'Plan contact limit reached' }); invalid++; continue; }
            const c = await this.prisma.contact.create({ data: { tenantId: imp.tenantId, phoneE164: phone, displayName: name, customFields: fields, tags: [...new Set(tags)].slice(0, 20) } });
            existingCount++;
            contactId = c.id;
            created++;
          }
          if (mapping.consent?.purpose) {
            const has = await this.prisma.contactConsent.findFirst({ where: { contactId, purpose: mapping.consent.purpose, revokedAt: null } });
            if (!has) await this.prisma.contactConsent.create({ data: { tenantId: imp.tenantId, contactId, purpose: mapping.consent.purpose, source: mapping.consent.source ?? 'import', capturedAt: new Date() } });
          }
        }
        await job.updateProgress(Math.round(((i + chunk.length) / Math.max(1, sheet.rows.length)) * 100));
      }

      let errorFileKey: string | null = null;
      if (errors.length) {
        errorFileKey = `tenants/${imp.tenantId}/import-errors/${imp.id}.csv`;
        await this.storage.put(errorFileKey, 'row,phone,reason\n' + errors.map((e) => [e.row, e.phone, e.reason].map(csvCell).join(',')).join('\n'), 'text/csv');
      }
      await this.prisma.importJob.update({
        where: { id: imp.id },
        data: {
          status: 'completed', rowCount: sheet.rows.length, createdCount: created, updatedCount: updated, invalidCount: invalid,
          duplicateCount: dup, optedOutCount: opted, errorFileKey, errorSample: errors.slice(0, 20) as any, completedAt: new Date(),
        },
      });
    } catch (e) {
      await this.prisma.importJob.update({ where: { id: imp.id }, data: { status: 'failed', errorSample: [{ row: 0, phone: '', reason: 'The file could not be read. Check it is a valid CSV or XLSX.' }] as any, completedAt: new Date() } });
    }
    await this.redis.publish(imp.tenantId, { type: 'import.updated', data: { id: imp.id, status: 'done' } });
  }
}
