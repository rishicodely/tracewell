import {
  Body,
  Controller,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  MinLength,
} from 'class-validator';
import { eq } from 'drizzle-orm';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DB, type Db } from '../db/db.module';
import { runs } from '../db/schema';
import type { AuthedRequest } from '../types/request';

const STATUSES = ['running', 'succeeded', 'failed'] as const;
type Status = (typeof STATUSES)[number];

class CreateRunDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

class UpdateRunDto {
  @IsOptional()
  @IsEnum(STATUSES)
  status?: Status;

  @IsOptional()
  @IsInt()
  @Min(0)
  totalTokens?: number;

  @IsOptional()
  @IsNumber()
  totalCostUsd?: number;

  @IsOptional()
  @IsString()
  endedAt?: string; // ISO string; if omitted on terminal status we set now()
}

@Controller('v1/runs')
@UseGuards(ApiKeyGuard)
export class RunsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Post()
  async create(@Body() dto: CreateRunDto, @Req() req: AuthedRequest) {
    const project = req.project;

    const [run] = await this.db
      .insert(runs)
      .values({
        projectId: project.id,
        name: dto.name,
        status: 'running',
        model: dto.model,
        metadata: dto.metadata ?? {},
      })
      .returning();

    return run;
  }

  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRunDto,
  ) {
    const patch: Partial<typeof runs.$inferInsert> = {};
    if (dto.status !== undefined) patch.status = dto.status;
    if (dto.totalTokens !== undefined) patch.totalTokens = dto.totalTokens;
    if (dto.totalCostUsd !== undefined) {
      patch.totalCostUsd = String(dto.totalCostUsd);
    }
    if (dto.status === 'succeeded' || dto.status === 'failed') {
      patch.endedAt = dto.endedAt ? new Date(dto.endedAt) : new Date();
    }

    // TODO(multi-project): scope update by req.project.id once we support
    // multiple projects per deployment. Add @Req() req: AuthedRequest back
    // and use .where(and(eq(runs.id, id), eq(runs.projectId, req.project.id))).
    const [run] = await this.db
      .update(runs)
      .set(patch)
      .where(eq(runs.id, id))
      .returning();

    return run;
  }
}
