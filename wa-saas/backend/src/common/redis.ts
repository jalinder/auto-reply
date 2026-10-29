import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import IORedis, { Redis } from 'ioredis';
import { config } from './config';

export function createRedis(): Redis {
  return new IORedis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });
}

export type RealtimeEvent =
  | { type: 'connection.updated'; data: { id: string; status: string; lastErrorCode?: string | null } }
  | { type: 'connection.qr'; data: { id: string; expiresAt: string } }
  | { type: 'campaign.progress'; data: { id: string; status: string; counts: Record<string, number> } }
  | { type: 'import.updated'; data: { id: string; status: string } };

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis = createRedis();

  /** Publishes a tenant-scoped realtime event. Never include QR payloads or secrets here. */
  async publish(tenantId: string, event: RealtimeEvent) {
    await this.client.publish(`events:${tenantId}`, JSON.stringify(event));
  }

  async onModuleDestroy() {
    await this.client.quit();
  }
}

@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class RedisModule {}
