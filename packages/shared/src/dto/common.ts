import { z } from 'zod';

/** Every list endpoint is paginated. Nothing in this system ever returns "all rows". */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/**
 * How far a list counts its matches. Counting every row is the one part of a
 * page that grows with the size of the consultancy - ten million clients take
 * seconds to count, however fast the 25 on screen arrive - so a list counts
 * up to this many and says "10,000+" beyond it. No one pages past 400 pages
 * of 25; they narrow the search.
 */
export const COUNT_CAP = 10_000;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  /** Exact up to COUNT_CAP; COUNT_CAP when there are more (see `totalCapped`). */
  total: number;
  totalPages: number;
  /** There are more matches than were counted: read `total` as "at least". */
  totalCapped?: boolean;
}

/** A list's total as people read it: "1,204", or "10,000+" past the cap. */
export function formatTotal(list: Pick<Paginated<unknown>, 'total' | 'totalCapped'>): string {
  return `${list.total.toLocaleString('en-US')}${list.totalCapped ? '+' : ''}`;
}

export const uuidSchema = z.string().uuid('Not a valid identifier');

/** Pakistani mobile numbers dominate here, but keep it permissive for overseas clients. */
export const phoneSchema = z
  .string()
  .trim()
  .min(7, 'Phone number looks too short')
  .max(24, 'Phone number looks too long')
  .regex(/^[+0-9()\-\s]+$/, 'Phone number can only contain digits, spaces, + - ( )');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);
