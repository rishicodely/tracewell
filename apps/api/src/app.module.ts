import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { AppController } from './app.controller';
import { ProjectsModule } from './projects/projects.module';
import { RunsController } from './runs/runs.controller';
import { SpansController } from './spans/spans.controller';
import { ApiKeyGuard } from './auth/api-key.guard';
import { QueueModule } from './queue/queue.module';
import { DiffsController } from './diffs/diffs.controller';
import { DiffWorker } from './diffs/diff.worker';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DbModule,
    QueueModule,
    ProjectsModule,
  ],
  controllers: [
    AppController,
    RunsController,
    SpansController,
    DiffsController, // ← add
  ],
  providers: [
    ApiKeyGuard,
    DiffWorker, // ← add
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}
