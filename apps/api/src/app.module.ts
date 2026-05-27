import { Module, ValidationPipe } from '@nestjs/common';
import { APP_PIPE } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { DbModule } from './db/db.module';
import { AppController } from './app.controller';
import { ProjectsModule } from './projects/projects.module';
import { RunsController } from './runs/runs.controller';
import { SpansController } from './spans/spans.controller';
import { ApiKeyGuard } from './auth/api-key.guard';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), DbModule, ProjectsModule],
  controllers: [AppController, RunsController, SpansController],
  providers: [
    ApiKeyGuard,
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
