import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { AuthUser } from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { tenantSync } from '../db/schema';

/**
 * Clocks on two machines (the web server that stamped a page, the database
 * that stamped a change) can disagree by a little. A change this close before
 * a page's stamp still counts as after it: the cost is one unneeded refresh,
 * never a stale page.
 */
const CLOCK_MARGIN_MS = 1_000;

export interface ChangesReply {
  /** Something in the consultancy changed after `since`. */
  changed: boolean;
  /** The server's clock, so the browser can tell how old its pages are. */
  now: number;
}

/**
 * "Has anything changed since this page was rendered?"
 *
 * The browser reuses pages it has recently shown, and asks this before
 * trusting one. The answer comes from one row per consultancy that every write
 * moves forward, so it costs a primary-key read however much data there is.
 * It is deliberately coarse - any change anywhere in the consultancy - because
 * a needless refresh costs one round trip and a missed one shows wrong data.
 */
@Injectable()
export class SyncService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Record that this consultancy's data just changed. GREATEST keeps the row
   * moving forward only, whichever of two simultaneous writers lands last.
   */
  async touch(tenantId: string): Promise<void> {
    await this.db
      .insert(tenantSync)
      .values({ tenantId, changedAt: sql`clock_timestamp()` })
      .onConflictDoUpdate({
        target: tenantSync.tenantId,
        set: { changedAt: sql`GREATEST(${tenantSync.changedAt}, excluded.changed_at)` },
      });
  }

  async changedSince(actor: AuthUser, since: number): Promise<ChangesReply> {
    const now = Date.now();
    // The platform admin's pages count every consultancy; there is no single
    // row to ask, so their cached pages are always re-checked by re-rendering.
    if (!actor.tenantId) return { changed: true, now };
    // The marker moves with anything anyone does in the consultancy. A client
    // polling it would learn when the office is busy - not theirs to know - so
    // they are always told to re-check: their kept pages still show at once,
    // and are re-rendered behind it.
    if (actor.role === 'client') return { changed: true, now };

    const [row] = await this.db
      .select({ at: sql<number>`(extract(epoch from ${tenantSync.changedAt}) * 1000)::float8` })
      .from(tenantSync)
      .where(eq(tenantSync.tenantId, actor.tenantId));

    // No row yet means no write has been recorded for this consultancy since
    // the row was introduced - answer "changed", the answer that cannot be wrong.
    if (!row) return { changed: true, now };
    return { changed: Number(row.at) > since - CLOCK_MARGIN_MS, now };
  }
}
