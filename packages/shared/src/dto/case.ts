import { z } from 'zod';
import { CASE_STATUSES, STAGES } from '../stages';
import { uuidSchema } from './common';
import { OFFER_TYPES, dateOnlySchema } from '../profile';

const intakeSchema = z
  .string()
  .trim()
  .max(40)
  .regex(/^[A-Za-z]+\s+\d{4}$/, 'Use a term and year, e.g. "Fall 2026"');

export const createCaseSchema = z.object({
  clientId: uuidSchema,
  targetCountry: z.string().trim().min(2, 'Enter a country').max(60),
  targetUniversity: z.string().trim().max(160).optional(),
  targetProgram: z.string().trim().max(160).optional(),
  /** Bachelor's, Master's... - picks the checklist and, later, the workflow. */
  studyLevel: z.string().trim().max(60).optional(),
  /** Student visa, dependant visa... */
  visaType: z.string().trim().max(60).optional(),
  intake: intakeSchema.optional(),
  applicationDeadline: dateOnlySchema.optional(),
  /** Run it on this workflow; otherwise the best match for country, level and visa type. */
  workflowId: uuidSchema.optional(),
});
export type CreateCaseInput = z.infer<typeof createCaseSchema>;

export const updateCaseSchema = z.object({
  targetUniversity: z.string().trim().max(160).nullable().optional(),
  targetProgram: z.string().trim().max(160).nullable().optional(),
  studyLevel: z.string().trim().max(60).nullable().optional(),
  visaType: z.string().trim().max(60).nullable().optional(),
  intake: intakeSchema.nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  /**
   * The dates a study visa case actually runs on. Each one feeds the upcoming
   * deadlines on the dashboards, so nobody has to keep them in their head.
   */
  applicationDeadline: dateOnlySchema.nullable().optional(),
  offerType: z.enum(OFFER_TYPES).nullable().optional(),
  offerConditions: z.string().trim().max(1000).nullable().optional(),
  offerDeadline: dateOnlySchema.nullable().optional(),
  visaAppointmentAt: z.string().datetime({ offset: true }).nullable().optional(),
  travelDate: dateOnlySchema.nullable().optional(),
});
export type UpdateCaseInput = z.infer<typeof updateCaseSchema>;

/**
 * Manual stage override. A reason is required whenever the move is not simply
 * "forward to the next step" - going backwards or skipping ahead of an
 * unfinished checklist is exactly the kind of decision someone will question
 * three months later.
 */
export const changeStageSchema = z
  .object({
    /** One of the ten stages - for applications on the Standard workflow. */
    stage: z.enum(STAGES).optional(),
    /** A stage of the application's own workflow. Wins over `stage`. */
    stageKey: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{1,39}$/)
      .optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => Boolean(v.stage || v.stageKey), { message: 'Choose a stage', path: ['stageKey'] });
export type ChangeStageInput = z.infer<typeof changeStageSchema>;

export const changeCaseStatusSchema = z.object({
  status: z.enum(CASE_STATUSES),
  reason: z.string().trim().max(500).optional(),
});
export type ChangeCaseStatusInput = z.infer<typeof changeCaseStatusSchema>;

export const listCasesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  stage: z.enum(STAGES).optional(),
  status: z.enum(CASE_STATUSES).optional(),
  consultantId: uuidSchema.optional(),
  /** Only cases sitting past their stage's stuck threshold. */
  stuckOnly: z.coerce.boolean().default(false),
  sort: z.enum(['recent', 'stalest', 'stage']).default('recent'),
});
export type ListCasesQuery = z.infer<typeof listCasesQuerySchema>;
