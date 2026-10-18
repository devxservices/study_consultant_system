import { z } from 'zod';

/** Every list endpoint is paginated. Nothing in this system ever returns "all rows". */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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
