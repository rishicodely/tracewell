import { Body, Controller, Inject, Post } from '@nestjs/common';
import { IsString, MinLength } from 'class-validator';
import { randomBytes } from 'node:crypto';
import { DB, type Db } from '../db/db.module';
import { projects } from '../db/schema';

class CreateProjectDto {
  @IsString()
  @MinLength(1)
  name!: string;
}

@Controller('v1/projects')
export class ProjectsController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Post()
  async create(@Body() dto: CreateProjectDto) {
    const apiKey = `tw_${randomBytes(24).toString('hex')}`;
    const [project] = await this.db
      .insert(projects)
      .values({ name: dto.name, apiKey })
      .returning();

    // api_key is returned ONCE here. Surface this clearly in the response.
    return {
      id: project.id,
      name: project.name,
      apiKey: project.apiKey,
      warning:
        'Store this api key now. It will not be shown again via the API.',
    };
  }
}
