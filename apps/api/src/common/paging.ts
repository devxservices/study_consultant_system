import { sql } from 'drizzle-orm';
import { COUNT_CAP, type Paginated } from '@crm/shared';
import type { Db } from '../db/connection';

/**
 * Paging that costs the same for a hundred rows as for ten million.
 *
 * A list page reads its 25 rows through an index, which is quick at any size;
 * what grew with the consultancy was counting every match for "1-25 of N",
 * and skipping rows to reach a deep page. So a list counts at most
 * COUNT_CAP + 1 matches - enough to say "10,000+" - and a page past the
 * counted range is not served: people narrow a search, they do not page to
 * row nine million, and an OFFSET that size would read nine million rows.
 */

export interface CappedCount {
  total: number;
  capped: boolean;
}

/** The highest page a list serves at this page size. */
export function lastServedPage(pageSize: number): number {
  return Math.max(1, Math.ceil(COUNT_CAP / pageSize));
}

/** A requested page, held inside the counted range. */
export function clampPage(page: number, pageSize: number): number {
  return Math.min(Math.max(1, page), lastServedPage(pageSize));
}

/**
 * Counts the rows a query matches, stopping after COUNT_CAP + 1. Pass the
 * list's own FROM/JOIN/WHERE as a select of anything (`select({ one: sql`1` })`)
 * with no order or limit.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function countCapped(db: Db, rows: { limit(n: number): { as(alias: string): any } }): Promise<CappedCount> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(rows.limit(COUNT_CAP + 1).as('capped'));
  const n = Number(row?.n ?? 0);
  return n > COUNT_CAP ? { total: COUNT_CAP, capped: true } : { total: n, capped: false };
}

/** The page envelope every list returns. */
export function paged<T>(items: T[], page: number, pageSize: number, count: CappedCount): Paginated<T> {
  return {
    items,
    page,
    pageSize,
    total: count.total,
    totalPages: Math.max(1, Math.ceil(count.total / pageSize)),
    ...(count.capped ? { totalCapped: true } : {}),
  };
}
