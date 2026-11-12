import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { STAGE_DEFINITIONS, STAGE_ORDER } from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';

/**
 * "When does this case count as stuck?" - written once, here.
 *
 * A case is stuck when it has sat in its stage past the stage's limit: the
 * limit its workflow copied onto it (`stage_sla_days`), else the built-in one
 * for the stage (`STAGE_DEFINITIONS`). That moment is stored on the case as
 * `stuck_at` by a trigger, so every "is it stuck?" in the product is
 * `stuck_at < now()`: an index range over the stuck cases rather than a test
 * of every live case. The interpolated values are integers and stage names
 * from our own constants, never input.
 */

/** The built-in limits as one comparable line: `inquiry:7,shortlisting:10,...`. */
export const STUCK_THRESHOLDS_FINGERPRINT = STAGE_ORDER.map((s) => `${s}:${STAGE_DEFINITIONS[s].stuckAfterDays}`).join(',');

/** The stage's limit for the row `row` (`NEW` in the trigger, `c` in a query). */
export function stuckLimitExpr(row: string): string {
  const branches = STAGE_ORDER.map((s) => `when '${s}' then interval '${STAGE_DEFINITIONS[s].stuckAfterDays} days'`).join(' ');
  return `coalesce(${row}.stage_sla_days * interval '1 day', (case ${row}.current_stage ${branches} end))`;
}

/**
 * The trigger function. Runs after `cases_fill_workflow` (triggers fire in
 * name order), which may have just changed the stage and its limit. Its
 * comment carries the fingerprint of the limits it was written with.
 */
export function stuckAtFunctionSql(): string {
  return `CREATE OR REPLACE FUNCTION cases_set_stuck_at() RETURNS trigger AS $$
BEGIN
  NEW.stuck_at := NEW.stage_entered_at + ${stuckLimitExpr('NEW')};
  RETURN NEW;
END
$$ LANGUAGE plpgsql`;
}

export function stuckAtCommentSql(): string {
  return `COMMENT ON FUNCTION cases_set_stuck_at() IS 'stuck-thresholds ${STUCK_THRESHOLDS_FINGERPRINT}'`;
}

/**
 * Keeps the database's limits in step with the code's. Migration 0017 wrote
 * the function with the limits of its day; if `STAGE_DEFINITIONS` changes
 * later, the first API to start rewrites the function and recomputes
 * `stuck_at` for the cases whose value moved. When they already match - every
 * other boot - this is one catalogue read.
 */
@Injectable()
export class StuckThresholdsSync implements OnModuleInit {
  private readonly logger = new Logger('StuckThresholds');

  constructor(@Inject(DB) private readonly db: Db) {}

  async onModuleInit(): Promise<void> {
    // Both drivers (PGlite and node-postgres) answer with `rows`.
    const result = (await this.db.execute(
      sql`select to_regprocedure('cases_set_stuck_at()') is not null as present,
                 obj_description(to_regprocedure('cases_set_stuck_at()'), 'pg_proc') as note`,
    )) as unknown as { rows?: { present: boolean; note: string | null }[] };
    const row = result.rows?.[0];
    if (!row?.present) {
      // Started before migration 0017 ran: nothing to keep in step yet.
      this.logger.warn('cases_set_stuck_at() is missing - run the database migrations');
      return;
    }
    if (row.note === `stuck-thresholds ${STUCK_THRESHOLDS_FINGERPRINT}`) return;

    this.logger.log('Stage limits changed - rewriting cases_set_stuck_at and recomputing stuck_at');
    await this.db.execute(sql.raw(stuckAtFunctionSql()));
    await this.db.execute(sql.raw(stuckAtCommentSql()));
    const expr = `c.stage_entered_at + ${stuckLimitExpr('c')}`;
    await this.db.execute(sql.raw(`UPDATE cases c SET stuck_at = ${expr} WHERE c.stuck_at IS DISTINCT FROM ${expr}`));
  }
}
