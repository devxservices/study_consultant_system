import { z } from 'zod';
import { emailSchema, phoneSchema, uuidSchema } from './common';
import { STAGES } from '../stages';
import { clientProfileSchema } from '../profile';

/**
 * What a client is with the consultancy for. A course-only student (IELTS,
 * spoken English) is not in the study-abroad pipeline until handed over.
 */
export const CLIENT_PROGRAMMES = ['study_abroad', 'course_only'] as const;
export type ClientProgramme = (typeof CLIENT_PROGRAMMES)[number];
export const CLIENT_PROGRAMME_LABEL: Record<ClientProgramme, string> = {
  study_abroad: 'Study abroad',
  course_only: 'Course only',
};

const intakeSchema = z
  .string()
  .trim()
  .max(40)
  .regex(/^[A-Za-z]+\s+\d{4}$/, 'Use a term and year, e.g. "Fall 2026"');

/**
 * A client's target country/university lives on the CASE, not the client,
 * because one client may pursue several countries in parallel. Creating a
 * client optionally opens their first case in the same step.
 */
export const createClientSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter the client\u2019s full name').max(120),
  email: emailSchema,
  phone: phoneSchema,
  city: z.string().trim().max(80).optional(),
  assignedConsultantId: uuidSchema.optional(),
  notes: z.string().trim().max(2000).optional(),
  programme: z.enum(CLIENT_PROGRAMMES).optional(),
  firstApplication: z
    .object({
      targetCountry: z.string().trim().min(2, 'Enter a country').max(60),
      targetUniversity: z.string().trim().max(160).optional(),
      targetProgram: z.string().trim().max(160).optional(),
      intake: intakeSchema.optional(),
    })
    .optional(),
}).merge(clientProfileSchema);
export type CreateClientInput = z.infer<typeof createClientSchema>;

export const updateClientSchema = createClientSchema
  .omit({ firstApplication: true })
  .partial()
  .extend({ archived: z.boolean().optional() });
export type UpdateClientInput = z.infer<typeof updateClientSchema>;

/**
 * Giving a client their portal login. The password is set by staff and shared
 * with the client in person, because the app ships with local email/password
 * auth; with a hosted identity provider this becomes an emailed invite.
 */
export const portalAccessSchema = z.object({
  password: z.string().min(8, 'Use at least 8 characters').max(200, 'That password is too long'),
});
export type PortalAccessInput = z.infer<typeof portalAccessSchema>;

export const listClientsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  /** Free text across name, email and phone. */
  q: z.string().trim().max(120).optional(),
  stage: z.enum(STAGES).optional(),
  consultantId: uuidSchema.optional(),
  // NOT z.coerce.boolean(): that turns the string "false" into `true`, which
  // would quietly expose archived clients on `?includeArchived=false`. Parse
  // the string honestly instead, defaulting to false when absent.
  includeArchived: z
    .union([z.boolean(), z.string()])
    .optional()
    .transform((v) => v === true || v === 'true' || v === '1'),
  /** Filter by when the client was added. Accepts an ISO date or date-time. */
  createdFrom: z.coerce.date().optional(),
  createdTo: z.coerce.date().optional(),
  programme: z.enum(CLIENT_PROGRAMMES).optional(),
  sort: z.enum(['recent', 'name', 'stage', 'stalest']).default('recent'),
});
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
