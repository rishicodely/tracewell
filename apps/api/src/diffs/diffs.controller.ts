import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { IsUUID } from 'class-validator';
import { and, eq } from 'drizzle-orm';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DB, type Db } from '../db/db.module';
import { DIFF_QUEUE } from '../queue/queue.module';
import type { Queue } from 'bullmq';
import { diffs, runs } from '../db/schema';
import type { AuthedRequest } from '../types/request';

class CreateDiffDto {
  @IsUUID() runAId!: string;
  @IsUUID() runBId!: string;
}

@Controller('v1/diffs')
@UseGuards(ApiKeyGuard)
export class DiffsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DIFF_QUEUE) private readonly queue: Queue,
  ) {}

  @Post()
  async create(@Body() dto: CreateDiffDto, @Req() req: AuthedRequest) {
    // Verify both runs exist and belong to this project
    const foundRuns = await this.db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.projectId, req.project.id)));

    const foundIds = new Set(foundRuns.map((r) => r.id));
    if (!foundIds.has(dto.runAId) || !foundIds.has(dto.runBId)) {
      throw new NotFoundException(
        'one or both runs not found for this project',
      );
    }

    const [diff] = await this.db
      .insert(diffs)
      .values({
        projectId: req.project.id,
        runAId: dto.runAId,
        runBId: dto.runBId,
        status: 'queued',
      })
      .returning();

    await this.queue.add('diff', {
      diffId: diff.id,
      runAId: dto.runAId,
      runBId: dto.runBId,
    });

    return diff;
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string) {
    const [diff] = await this.db
      .select()
      .from(diffs)
      .where(eq(diffs.id, id))
      .limit(1);
    if (!diff) throw new NotFoundException();
    return diff;
  }
}
