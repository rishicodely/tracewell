import { Module, Global, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

export const DIFF_QUEUE = Symbol('DIFF_QUEUE');
export const REDIS = Symbol('REDIS');

export const DIFF_QUEUE_NAME = 'diff';

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return new IORedis(config.getOrThrow<string>('REDIS_URL'), {
          maxRetriesPerRequest: null, // BullMQ requirement
        });
      },
    },
    {
      provide: DIFF_QUEUE,
      inject: [REDIS],
      useFactory: (connection: IORedis) => {
        return new Queue(DIFF_QUEUE_NAME, { connection });
      },
    },
  ],
  exports: [DIFF_QUEUE, REDIS],
})
export class QueueModule implements OnModuleDestroy {
  constructor() {}
  async onModuleDestroy() {
    // BullMQ queues are closed on app shutdown
  }
}
