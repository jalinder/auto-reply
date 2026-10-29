import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { Q, Queues } from './common/queues';
import { appLogger } from './common/json-logger';
import { sendOutcomes, serveMetrics } from './common/metrics';
import { config } from './common/config';
import { createRedis } from './common/redis';
import { CampaignProcessor } from './worker/campaign.processor';
import { ImportProcessor } from './worker/import.processor';
import { MaintenanceProcessor } from './worker/maintenance.processor';
import { RetryableSendError, SendProcessor } from './worker/send.processor';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: appLogger('worker') });
  app.enableShutdownHooks();
  const log = new Logger('Worker');
  const send = app.get(SendProcessor);
  const campaign = app.get(CampaignProcessor);
  const imports = app.get(ImportProcessor);
  const maint = app.get(MaintenanceProcessor);
  const queues = app.get(Queues);
  const conc = Number(process.env.SEND_CONCURRENCY ?? 20);

  const workers = [
    new Worker(Q.send, (j) => send.process(j), { connection: createRedis(), concurrency: conc, lockDuration: 90_000 }),
    new Worker(Q.campaign, (j) => campaign.dispatch(j), { connection: createRedis(), concurrency: 4 }),
    new Worker(Q.imports, (j) => imports.process(j), { connection: createRedis(), concurrency: 2, lockDuration: 300_000 }),
    new Worker(Q.status, (j) => maint.applyStatus(j), { connection: createRedis(), concurrency: 20 }),
    new Worker(Q.connection, (j) => maint.connectionJob(j), { connection: createRedis(), concurrency: 5 }),
    new Worker(Q.maintenance, (j) => maint.maintenance(j), { connection: createRedis(), concurrency: 1 }),
  ];
  for (const w of workers) {
    w.on('failed', async (job, err) => {
      const exhausted = job && job.attemptsMade >= (job.opts.attempts ?? 1);
      if (exhausted) {
        // Dead-letter queue: kept for inspection; the relay_queue_jobs{queue="dead-letter"} metric alerts on growth.
        await queues.deadLetter.add('dead', { queue: w.name, jobId: job!.id, name: job!.name, data: job!.data, reason: err.message.slice(0, 500) })
          .catch(() => undefined);
      }
      if (err instanceof RetryableSendError && !exhausted) return;
      log.error(`${w.name} job ${job?.id} failed${exhausted ? ' (moved to dead-letter)' : ''}: ${err.message}`);
    });
  }
  serveMetrics(config.metricsPort);

  await queues.maintenance.add('recover-leases', {}, { repeat: { every: 60_000 }, jobId: 'recover-leases' });
  await queues.maintenance.add('health-checks', {}, { repeat: { every: 10 * 60_000 }, jobId: 'health-checks' });
  await queues.maintenance.add('retention', {}, { repeat: { pattern: '17 3 * * *' }, jobId: 'retention' });

  log.log(`Worker started (send concurrency ${conc})`);
  const shutdown = async () => {
    log.log('Shutting down workers…');
    await Promise.all(workers.map((w) => w.close()));
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
bootstrap();
