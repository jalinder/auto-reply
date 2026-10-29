import { Controller, Injectable, MessageEvent, OnModuleDestroy, OnModuleInit, Sse } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { interval, map, merge, Observable, Subject, filter, finalize } from 'rxjs';
import { CurrentTenant, TenantCtx } from '../../common/access';
import { createRedis } from '../../common/redis';

@Injectable()
export class RealtimeHub implements OnModuleInit, OnModuleDestroy {
  private readonly sub = createRedis();
  private readonly stream = new Subject<{ tenantId: string; payload: string }>();

  async onModuleInit() {
    await this.sub.psubscribe('events:*');
    this.sub.on('pmessage', (_p, channel, payload) => this.stream.next({ tenantId: channel.slice(7), payload }));
  }
  async onModuleDestroy() {
    await this.sub.quit();
  }
  forTenant(tenantId: string) {
    return this.stream.pipe(filter((e) => e.tenantId === tenantId), map((e) => e.payload));
  }
}

@SkipThrottle()
@Controller('v1/events')
export class RealtimeController {
  constructor(private readonly hub: RealtimeHub) {}

  /** Server-Sent Events stream for the current workspace (connection, QR, campaign, import updates). */
  @Sse()
  stream(@CurrentTenant() t: TenantCtx): Observable<MessageEvent> {
    const events = this.hub.forTenant(t.id).pipe(map((payload) => ({ data: payload }) as MessageEvent));
    const heartbeat = interval(20_000).pipe(map(() => ({ data: JSON.stringify({ type: 'ping' }) }) as MessageEvent));
    return merge(events, heartbeat).pipe(finalize(() => undefined));
  }
}
