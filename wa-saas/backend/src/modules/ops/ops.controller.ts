import { Controller, Get, Headers, Injectable, NestMiddleware, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { NextFunction, Request, Response } from 'express';
import { Public } from '../../common/access';
import { config } from '../../common/config';
import { safeEqual } from '../../common/crypto';
import { connectionsByStatus, httpDuration, oldestWaiting, queueDepth, registry } from '../../common/metrics';
import { PrismaService } from '../../common/prisma.service';
import { Queues } from '../../common/queues';

/** Records request latency by route template (never by raw URL, which may contain IDs). */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    const end = httpDuration.startTimer();
    res.on('finish', () => {
      const route = (req as any).route?.path ?? 'unmatched';
      end({ method: req.method, route, status: String(res.statusCode) });
    });
    next();
  }
}

@Public() @SkipThrottle()
@Controller()
export class OpsController {
  constructor(private readonly queues: Queues, private readonly prisma: PrismaService) {}

  /** Prometheus scrape endpoint. Requires METRICS_TOKEN; expose only on the internal network. */
  @Get('metrics')
  async metrics(@Headers('authorization') auth: string | undefined, @Res() res: Response) {
    if (!config.metricsToken || !auth || !safeEqual(auth, `Bearer ${config.metricsToken}`)) return res.sendStatus(404);
    for (const q of this.queues.all()) {
      const c = await q.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
      for (const [state, n] of Object.entries(c)) queueDepth.set({ queue: q.name, state }, n);
      const [oldest] = await q.getJobs(['waiting'], 0, 0, true);
      oldestWaiting.set({ queue: q.name }, oldest ? (Date.now() - oldest.timestamp) / 1000 : 0);
    }
    connectionsByStatus.reset();
    const rows = await this.prisma.whatsappConnection.groupBy({ by: ['connectorType', 'status'], _count: { _all: true } });
    for (const r of rows) connectionsByStatus.set({ connector: r.connectorType, status: r.status }, r._count._all);
    res.setHeader('Content-Type', registry.contentType);
    res.send(await registry.metrics());
  }
}
