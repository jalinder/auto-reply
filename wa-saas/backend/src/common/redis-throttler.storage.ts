import { Injectable } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { RedisService } from './redis';

/** Shared rate-limit counters so limits hold across all API instances. */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: RedisService) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    const hitKey = `rl:${throttlerName}:${key}`;
    const blockKey = `${hitKey}:blocked`;
    const [hits, pttl, blockedTtl] = (await this.redis.client.eval(
      `local h = redis.call('incr', KEYS[1])
       if h == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end
       local t = redis.call('pttl', KEYS[1])
       local b = redis.call('pttl', KEYS[2])
       if h > tonumber(ARGV[2]) and b < 0 then redis.call('set', KEYS[2], '1', 'PX', ARGV[3]); b = tonumber(ARGV[3]) end
       return {h, t, b}`,
      2, hitKey, blockKey, String(ttl), String(limit), String(blockDuration || ttl),
    )) as [number, number, number];
    const isBlocked = blockedTtl > 0;
    return {
      totalHits: hits,
      timeToExpire: Math.ceil(Math.max(pttl, 0) / 1000),
      isBlocked,
      timeToBlockExpire: isBlocked ? Math.ceil(blockedTtl / 1000) : 0,
    };
  }
}
