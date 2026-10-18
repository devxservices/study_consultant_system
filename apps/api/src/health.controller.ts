import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { sql } from 'drizzle-orm';
import { DB, DB_HANDLE } from './db/database.module';
import type { Db, DbHandle } from './db/connection';
import { Public } from './auth/auth.guard';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(DB_HANDLE) private readonly handle: DbHandle,
  ) {}

  /**
   * 503 when the database cannot be reached, so an uptime monitor and the
   * container health check - which both look at the status code - notice.
   */
  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    let database = 'down';
    try {
      await this.db.execute(sql`select 1`);
      database = 'up';
    } catch {
      database = 'down';
    }
    if (database !== 'up') res.status(503);
    return {
      status: database === 'up' ? 'ok' : 'degraded',
      database,
      driver: this.handle.driver,
      time: new Date().toISOString(),
    };
  }
}
