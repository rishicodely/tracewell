import { Controller, Get, Inject } from '@nestjs/common';
import { DB } from './db/db.module';
import type { Db } from './db/db.module';
import { sql } from 'drizzle-orm';

@Controller()
export class AppController {
  constructor(@Inject(DB) private readonly db: Db) {}

  @Get('db-check')
  async dbCheck() {
    const result = await this.db.execute(
      sql`select now() as now, version() as version`,
    );
    return result.rows[0];
  }
}
