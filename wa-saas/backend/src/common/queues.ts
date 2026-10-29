import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import { createRedis } from './redis';

export const Q = {
  campaign: 'campaign',     // dispatch | finalize
  send: 'send',             // one job per recipient
  imports: 'imports',       // contact import parsing
  status: 'status',         // provider status events (webhook + sandbox simulation)
  connection: 'connection', // qr expiry, sandbox linking, health checks
  maintenance: 'maintenance',
  deadLetter: 'dead-letter',  // exhausted jobs, kept for inspection and alerting
} as const;

export const DEFAULT_JOB: JobsOptions = {
  removeOnComplete: { age: 24 * 3600, count: 10_000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

@Injectable()
export class Queues implements OnModuleDestroy {
  private readonly conn = createRedis();
  readonly campaign = new Queue(Q.campaign, { connection: this.conn, defaultJobOptions: DEFAULT_JOB });
  readonly send = new Queue(Q.send, {
    connection: this.conn,
    defaultJobOptions: { ...DEFAULT_JOB, attempts: 5, backoff: { type: 'exponential', delay: 5_000 } },
  });
  readonly imports = new Queue(Q.imports, { connection: this.conn, defaultJobOptions: { ...DEFAULT_JOB, attempts: 2 } });
  readonly status = new Queue(Q.status, { connection: this.conn, defaultJobOptions: { ...DEFAULT_JOB, attempts: 5, backoff: { type: 'exponential', delay: 2_000 } } });
  readonly connection = new Queue(Q.connection, { connection: this.conn, defaultJobOptions: DEFAULT_JOB });
  readonly maintenance = new Queue(Q.maintenance, { connection: this.conn, defaultJobOptions: DEFAULT_JOB });
  readonly deadLetter = new Queue(Q.deadLetter, { connection: this.conn, defaultJobOptions: { removeOnComplete: false, removeOnFail: false } });
  readonly all = () => [this.campaign, this.send, this.imports, this.status, this.connection, this.maintenance, this.deadLetter];

  async onModuleDestroy() {
    await Promise.all(this.all().map((q) => q.close()));
    await this.conn.quit();
  }
}

@Global()
@Module({ providers: [Queues], exports: [Queues] })
export class QueuesModule {}
