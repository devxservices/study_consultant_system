import { and, eq, sql } from 'drizzle-orm';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { localIsoDate } from '@crm/shared';
import type { Db } from '../db/connection';

/** Postgres unique_violation, from either driver. */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function isoOrNull(value: Date | string | null | undefined): string | null {
  return value ? iso(value) : null;
}

/**
 * Today's date in the server's calendar (TZ), as the date-only columns hold
 * it. Not the UTC date: in Pakistan that is still yesterday until 5 am, which
 * booked a payment taken after midnight on the 1st into the previous month.
 */
export const today = (): string => localIsoDate();

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Inserts a row under the next document number for this consultancy and year
 * - INV-2026-0001, CN-2026-0007 - retrying on the unique index if two people
 * take the same number at once. The table needs `tenant_id` and `number`
 * columns and a unique index over them.
 */
export async function withDocumentNumber<T>(
  db: Db,
  table: PgTable & { tenantId: AnyPgColumn; number: AnyPgColumn },
  tenantId: string,
  prefix: string,
  insert: (number: string) => Promise<T>,
): Promise<T> {
  const year = new Date().getFullYear();
  const stem = `${prefix}-${year}-`;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(table)
    .where(and(eq(table.tenantId, tenantId), sql`${table.number} like ${stem + '%'}`));
  let next = (row?.n ?? 0) + 1;

  for (let attempt = 0; attempt < 8; attempt++, next++) {
    try {
      return await insert(`${stem}${String(next).padStart(4, '0')}`);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new Error('Could not allocate a document number');
}

/** A paginated reply, from the rows of one page and the total. */
export function page<T>(items: T[], total: number, pageNo: number, pageSize: number) {
  return {
    items,
    page: pageNo,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}
