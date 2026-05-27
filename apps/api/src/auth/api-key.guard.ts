import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  Inject,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module';
import { projects } from '../db/schema';
import type { AuthedRequest } from '../types/request';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(@Inject(DB) private readonly db: Db) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const apiKey = req.headers['x-api-key'];

    if (!apiKey || typeof apiKey !== 'string') {
      throw new UnauthorizedException('missing x-api-key header');
    }

    const [project] = await this.db
      .select()
      .from(projects)
      .where(eq(projects.apiKey, apiKey))
      .limit(1);

    if (!project) {
      throw new UnauthorizedException('invalid api key');
    }

    req.project = project;
    return true;
  }
}
