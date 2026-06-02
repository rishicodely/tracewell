import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  Logger,
} from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { eq } from 'drizzle-orm';
import { REDIS, DIFF_QUEUE_NAME } from '../queue/queue.module';
import { DB, type Db } from '../db/db.module';
import { diffs, spans } from '../db/schema';
import { diffSpans } from './diff-spans';

interface DiffJobData {
  diffId: string;
  runAId: string;
  runBId: string;
}

@Injectable()
export class DiffWorker implements OnModuleInit, OnModuleDestroy {
  private worker?: Worker<DiffJobData>;
  private readonly logger = new Logger(DiffWorker.name);

  constructor(
    @Inject(REDIS) private readonly redis: IORedis,
    @Inject(DB) private readonly db: Db,
  ) {}

  onModuleInit() {
    this.worker = new Worker<DiffJobData>(
      DIFF_QUEUE_NAME,
      async (job: Job<DiffJobData>) => this.process(job),
      { connection: this.redis, concurrency: 2 },
    );

    this.worker.on('completed', (job) => {
      this.logger.log(`diff ${job.data.diffId} completed`);
    });
    this.worker.on('failed', (job, err) => {
      this.logger.error(`diff ${job?.data.diffId} failed: ${err.message}`);
    });
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async process(job: Job<DiffJobData>): Promise<void> {
    const { diffId, runAId, runBId } = job.data;

    await this.db
      .update(diffs)
      .set({ status: 'computing' })
      .where(eq(diffs.id, diffId));

    try {
      const [spansA, spansB] = await Promise.all([
        this.db.select().from(spans).where(eq(spans.runId, runAId)),
        this.db.select().from(spans).where(eq(spans.runId, runBId)),
      ]);

      const result = diffSpans(spansA, spansB);

      await this.db
        .update(diffs)
        .set({
          status: 'completed',
          result,
          completedAt: new Date(),
        })
        .where(eq(diffs.id, diffId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await this.db
        .update(diffs)
        .set({
          status: 'failed',
          error: message,
          completedAt: new Date(),
        })
        .where(eq(diffs.id, diffId));
      throw err; // re-throw so BullMQ marks the job failed
    }
  }
}
