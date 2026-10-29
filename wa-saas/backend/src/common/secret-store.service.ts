import { Injectable } from '@nestjs/common';
import { config } from './config';
import { decrypt, encrypt } from './crypto';
import { PrismaService } from './prisma.service';

/**
 * Stores connector credentials encrypted with AES-256-GCM. The tenantId is bound as AAD,
 * so a ciphertext copied to another tenant's record fails to decrypt.
 */
@Injectable()
export class SecretStore {
  constructor(private readonly prisma: PrismaService) {}

  async put(tenantId: string, value: Record<string, unknown>): Promise<string> {
    const enc = encrypt(JSON.stringify(value), `tenant:${tenantId}`);
    const row = await this.prisma.connectorSecret.create({
      data: { tenantId, ...enc, keyVersion: config.secrets.keyVersion },
    });
    return row.id;
  }

  async get<T = Record<string, unknown>>(tenantId: string, ref: string): Promise<T> {
    const row = await this.prisma.connectorSecret.findFirst({ where: { id: ref, tenantId } });
    if (!row) throw new Error('secret not found');
    return JSON.parse(decrypt(row, `tenant:${tenantId}`)) as T;
  }

  async delete(tenantId: string, ref: string) {
    await this.prisma.connectorSecret.deleteMany({ where: { id: ref, tenantId } });
  }
}
