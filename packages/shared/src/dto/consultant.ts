import { z } from 'zod';
import { emailSchema, phoneSchema } from './common';

/**
 * Creating a consultant account. Manager-only on the server.
 *
 * A password is set here because the app ships with the local email/password
 * provider; when that is swapped for a hosted identity provider this becomes an
 * invite instead, and the field falls away. The countries and capacity feed the
 * assignment and workload views.
 */
export const createConsultantSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the consultant’s full name').max(120),
  email: emailSchema,
  phone: phoneSchema.optional(),
  /** Left out, they are emailed a link to choose their own. */
  password: z
    .string()
    .min(8, 'Use at least 8 characters')
    .max(200, 'That password is too long')
    .optional(),
  countries: z.array(z.string().trim().min(2).max(60)).max(20).default([]),
  maxActiveClients: z.coerce.number().int().min(1).max(500).default(60),
  /** Their role - Counsellor, Accountant, Trainer. A manager's choice only. */
  roleId: z.string().uuid().nullable().optional(),
});
export type CreateConsultantInput = z.infer<typeof createConsultantSchema>;
