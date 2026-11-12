import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { performance } from 'node:perf_hooks';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { statsCache } from '../db/schema';

/**
 * A figure this cheap to compute is simply recomputed whenever it may be out
 * of date, so a small or medium consultancy always sees exact numbers.
 */
const SYNC_BUDGET_MS = 40;
/** Even with no recorded change, time-based figures ("stuck", "overdue") drift. */
const MAX_AGE_MS = 60_000;
/** A dear figure is recomputed at most this often... */
const MIN_REFRESH_MS = 5_000;
/** ...and never more than a fifth of the time, however busy the consultancy. */
const REFRESH_COST_MULTIPLE = 5;
const MAX_REFRESH_INTERVAL_MS = 5 * 60_000;

interface Cached {
  marker: Date | null;
  value: unknown;
  computed_at: Date | null;
  marker_at: Date | null;
  compute_ms: number | null;
  now: Date;
}

/**
 * Consultancy-wide figures - dashboard totals, menu badges, plan usage - served
 * from `stats_cache` instead of recomputed on every page.
 *
 * Computing one reads every case or client in scope, so its cost grows with
 * the consultancy: tens of milliseconds for a few thousand records, seconds
 * for millions. Reading it back is one primary-key lookup, whatever the size.
 *
 * - A figure is fresh while nothing in the consultancy has changed since it
 *   was computed (the `tenant_sync` marker every write moves) and it is under
 *   a minute old. Fresh figures are returned as stored.
 * - A stale figure that was cheap last time (under 40 ms) is recomputed there
 *   and then, so a consultancy of normal size sees every change at once.
 * - A stale figure that was dear is returned as it is - at once - and
 *   recomputed in the background, at most once per interval sized to its
 *   cost. A ten-million-row consultancy sees figures a few seconds behind,
 *   and its pages never wait for them.
 *
 * Keys must name everything that changes the answer - the scope (whole
 * consultancy, one consultant, one person) and any parameter - because two
 * callers with the same key are given the same figure. The consultancy is
 * part of the primary key, so nothing ever crosses between consultancies.
 */
@Injectable()
export class StatsCacheService {
  private readonly logger = new Logger('StatsCache');
  /** One computation per figure at a time in this process. */
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(@Inject(DB) private readonly db: Db) {}

  async get<T>(tenantId: string, key: string, compute: () => Promise<T>): Promise<T> {
    // `STATS_CACHE=off` computes every figure live (for checking a figure
    // against the cache, or a test that writes behind the API's back).
    if (process.env.STATS_CACHE === 'off') return compute();

    const result = (await this.db.execute(sql`
      select s.changed_at as marker, c.value, c.computed_at, c.marker_at, c.compute_ms, now() as now
      from (select 1) one
      left join tenant_sync s on s.tenant_id = ${tenantId}
      left join stats_cache c on c.tenant_id = ${tenantId} and c.key = ${key}
    `)) as unknown as { rows: Cached[] };
    const row = result.rows[0]!;
    const marker = toDate(row.marker);

    if (row.computed_at === null || row.computed_at === undefined) {
      return this.refresh(tenantId, key, marker, compute) as Promise<T>;
    }

    const computedAt = toDate(row.computed_at)!;
    const markerAt = toDate(row.marker_at);
    const now = toDate(row.now)!.getTime();
    const age = now - computedAt.getTime();
    const changed = marker !== null && (markerAt === null || marker.getTime() > markerAt.getTime());
    if (!changed && age < MAX_AGE_MS) return row.value as T;

    const cost = row.compute_ms ?? 0;
    if (cost <= SYNC_BUDGET_MS) return this.refresh(tenantId, key, marker, compute) as Promise<T>;

    // Dear: answer now with what we have, and refresh behind it - unless it
    // was refreshed so recently that doing it again would keep the database busy.
    const interval = Math.min(MAX_REFRESH_INTERVAL_MS, Math.max(MIN_REFRESH_MS, cost * REFRESH_COST_MULTIPLE));
    if (age >= interval) {
      this.refresh(tenantId, key, marker, compute).catch((err: unknown) =>
        this.logger.warn(`background refresh of ${key} failed: ${err instanceof Error ? err.message : String(err)}`),
      );
    }
    return row.value as T;
  }

  /**
   * Computes and stores one figure. `marker` is the change marker read before
   * computing, so anything written while it runs makes it stale again rather
   * than being missed. The stored row only moves forward: a slower, older
   * computation finishing late never replaces a newer one.
   */
  private refresh(tenantId: string, key: string, marker: Date | null, compute: () => Promise<unknown>): Promise<unknown> {
    const flight = `${tenantId}|${key}`;
    const running = this.inflight.get(flight);
    if (running) return running;

    const job = (async () => {
      const startedAt = new Date();
      const t0 = performance.now();
      // Stored as JSON, so return it as JSON too: a cached and a fresh answer
      // are then the same shape (dates as strings, no undefined fields).
      const value = JSON.parse(JSON.stringify(await compute())) as unknown;
      const computeMs = Math.round(performance.now() - t0);
      await this.db
        .insert(statsCache)
        .values({ tenantId, key, value: value as object, computedAt: startedAt, markerAt: marker, computeMs })
        .onConflictDoUpdate({
          target: [statsCache.tenantId, statsCache.key],
          set: {
            value: sql`excluded.value`,
            computedAt: sql`excluded.computed_at`,
            markerAt: sql`excluded.marker_at`,
            computeMs: sql`excluded.compute_ms`,
          },
          setWhere: sql`${statsCache.computedAt} <= excluded.computed_at`,
        });
      return value;
    })().finally(() => this.inflight.delete(flight));

    this.inflight.set(flight, job);
    return job;
  }
}

function toDate(v: unknown): Date | null {
  if (v === null || v === undefined) return null;
  return v instanceof Date ? v : new Date(String(v));
}
