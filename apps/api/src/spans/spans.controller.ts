import {
  Body,
  Controller,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiKeyGuard } from '../auth/api-key.guard';
import { DB, type Db } from '../db/db.module';
import { spans } from '../db/schema';

const KINDS = ['llm_call', 'tool_call', 'retry', 'state_update'] as const;
type Kind = (typeof KINDS)[number];

class IngestSpanDto {
  @IsUUID() id!: string;
  @IsOptional() @IsUUID() parentSpanId?: string;
  @IsEnum(KINDS) kind!: Kind;
  @IsString() @MinLength(1) name!: string;
  @IsString() startedAt!: string; // ISO
  @IsOptional() @IsString() endedAt?: string;
  @IsOptional() @IsObject() input?: Record<string, unknown>;
  @IsOptional() @IsObject() output?: Record<string, unknown>;
  @IsOptional() @IsObject() error?: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) tokensIn?: number;
  @IsOptional() @IsInt() @Min(0) tokensOut?: number;
  @IsOptional() @IsNumber() costUsd?: number;
}

class IngestSpansDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500) // protect ingest from runaway batches
  @ValidateNested({ each: true })
  @Type(() => IngestSpanDto)
  spans!: IngestSpanDto[];
}

@Controller('v1/runs/:runId/spans')
@UseGuards(ApiKeyGuard)
export class SpansController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Post()
  async ingest(
    @Param('runId', new ParseUUIDPipe()) runId: string,
    @Body() dto: IngestSpansDto,
  ) {
    const rows = dto.spans.map((s) => ({
      id: s.id,
      runId,
      parentSpanId: s.parentSpanId,
      kind: s.kind,
      name: s.name,
      startedAt: new Date(s.startedAt),
      endedAt: s.endedAt ? new Date(s.endedAt) : null,
      input: s.input ?? null,
      output: s.output ?? null,
      error: s.error ?? null,
      tokensIn: s.tokensIn ?? null,
      tokensOut: s.tokensOut ?? null,
      costUsd: s.costUsd !== undefined ? String(s.costUsd) : null,
    }));

    await this.db.insert(spans).values(rows).onConflictDoNothing();

    return { ingested: rows.length };
  }
}
