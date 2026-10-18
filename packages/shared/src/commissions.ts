import { z } from 'zod';
import { CURRENCIES, PAYMENT_METHODS, type Currency } from './billing';
import { STAGES, type Stage } from './stages';
import { dateOnlySchema } from './profile';
import { uuidSchema } from './dto/common';
import { conditionSchema, evaluateConditions, type Condition, type ConditionFacts } from './workflow';

/*
 * University commissions.
 *
 * Universities pay recruitment agencies a commission on the students they
 * send, under an agreement: a percentage of tuition (or a fixed amount), for
 * the first year or every year of the course, sometimes more once enough
 * students enrol, sometimes a bonus. It is earned when the student enrols,
 * claimed from the university after the census date, and paid weeks or
 * months later - or not, if the student withdraws inside the retention
 * period.
 *
 * Each commission is a row with its own lifecycle and the terms it was
 * worked out under (copied from the rule when it was created, so changing an
 * agreement never changes a commission already earned). It posts to the
 * books when the enrolment is confirmed; receipts from the university are
 * matched to commissions, with bank charges and exchange differences kept.
 */

const minor = z.coerce.number().int().min(0).max(100_000_000_00);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const reasonSchema = z.string().trim().min(5, 'Say why, so the record explains itself later').max(500);

/* ------------------------------------------------------------------ */
/* Institutions                                                         */
/* ------------------------------------------------------------------ */

export const INSTITUTION_TYPES = ['university', 'college', 'pathway', 'school', 'language_school', 'other'] as const;
export type InstitutionType = (typeof INSTITUTION_TYPES)[number];
export const INSTITUTION_TYPE_LABEL: Record<InstitutionType, string> = {
  university: 'University',
  college: 'College',
  pathway: 'Pathway provider',
  school: 'School',
  language_school: 'Language school',
  other: 'Other',
};

export const institutionContactSchema = z.object({
  name: z.string().trim().min(2, 'Name').max(120),
  role: optionalText(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254).optional().nullable().or(z.literal('').transform(() => null)),
  phone: optionalText(40),
  primary: z.boolean().default(false),
});
export type InstitutionContactInput = z.input<typeof institutionContactSchema>;

export const institutionSchema = z.object({
  name: z.string().trim().min(2, 'Name the institution').max(160),
  country: z.string().trim().min(2, 'Country').max(60),
  city: optionalText(80),
  type: z.enum(INSTITUTION_TYPES).default('university'),
  website: optionalText(200),
  /** The currency it pays commission in. */
  currency: z.enum(CURRENCIES),
  /** When the agency is paid through an aggregator (ApplyBoard, Adventus...) rather than directly. */
  aggregator: optionalText(120),
  notes: optionalText(4000),
  active: z.boolean().default(true),
  contacts: z.array(institutionContactSchema).max(20).default([]),
});
export type InstitutionInput = z.input<typeof institutionSchema>;

export interface InstitutionContactView {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  primary: boolean;
}

export interface InstitutionSummaryView {
  id: string;
  name: string;
  country: string;
  city: string | null;
  type: InstitutionType;
  currency: Currency;
  aggregator: string | null;
  active: boolean;
  /** An agreement in force today. */
  activeAgreement: { id: string; title: string; validTo: string | null } | null;
  applications: number;
  openApplications: number;
  /** Commission still to come in (confirmed, claimed, part-paid), and received this year. */
  outstanding: number;
  receivedThisYear: number;
}

export interface InstitutionView extends InstitutionSummaryView {
  website: string | null;
  notes: string | null;
  contacts: InstitutionContactView[];
  agreements: AgreementView[];
}

export const institutionsQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  country: z.string().trim().max(60).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});
export type InstitutionsQuery = z.output<typeof institutionsQuerySchema>;

/* ------------------------------------------------------------------ */
/* Agreements and their rules                                           */
/* ------------------------------------------------------------------ */

export const COMMISSION_BASES = ['percent', 'fixed'] as const;
export type CommissionBasis = (typeof COMMISSION_BASES)[number];
export const COMMISSION_YEARS = ['first_year', 'each_year'] as const;
export type CommissionYears = (typeof COMMISSION_YEARS)[number];

export const tierSchema = z.object({
  /** From this many confirmed students under the agreement... */
  fromStudents: z.coerce.number().int().min(2).max(10_000),
  /** ...this rate applies (percent). */
  ratePercent: z.coerce.number().min(0).max(100),
});

export const commissionRuleSchema = z
  .object({
    name: z.string().trim().min(2, 'Name the rule, e.g. Postgraduate').max(120),
    basis: z.enum(COMMISSION_BASES).default('percent'),
    /** Of the first year's tuition (or each year's, for `each_year`). */
    ratePercent: z.coerce.number().min(0).max(100).default(0),
    /** For `fixed`: the amount, in the agreement's currency, major units. */
    fixedAmount: z.coerce.number().min(0).max(10_000_000).default(0),
    years: z.enum(COMMISSION_YEARS).default('first_year'),
    /** For `each_year`: how many years of the course earn it. */
    yearCount: z.coerce.number().int().min(1).max(8).default(1),
    /** Higher rates once enough students under the agreement are confirmed. */
    tiers: z.array(tierSchema).max(6).default([]),
    /** A one-off bonus once this many students are confirmed under the agreement. */
    bonusStudents: z.coerce.number().int().min(1).max(10_000).nullable().default(null),
    bonusAmount: z.coerce.number().min(0).max(10_000_000).nullable().default(null),
    /** Which applications it covers: study level, intake, programme... None: all. */
    conditions: z.array(conditionSchema).max(8).default([]),
    /** If the student withdraws within this many days of enrolling, the university takes it back. */
    retentionDays: z.coerce.number().int().min(0).max(730).default(0),
    /** The step at which the commission becomes expected (deposit paid, by default). */
    triggerStage: z.enum(STAGES).default('fee_payment'),
  })
  .superRefine((v, ctx) => {
    if (v.basis === 'percent' && v.ratePercent <= 0) ctx.addIssue({ code: 'custom', path: ['ratePercent'], message: 'Enter the percentage' });
    if (v.basis === 'fixed' && v.fixedAmount <= 0) ctx.addIssue({ code: 'custom', path: ['fixedAmount'], message: 'Enter the amount' });
    if ((v.bonusStudents === null) !== (v.bonusAmount === null || v.bonusAmount === 0)) {
      ctx.addIssue({ code: 'custom', path: ['bonusAmount'], message: 'A bonus needs both the number of students and the amount' });
    }
    v.tiers.forEach((t, i) => {
      if (i > 0 && t.fromStudents <= v.tiers[i - 1]!.fromStudents) ctx.addIssue({ code: 'custom', path: ['tiers', i, 'fromStudents'], message: 'Tiers go upwards' });
    });
  });
export type CommissionRuleInput = z.input<typeof commissionRuleSchema>;
export type CommissionRuleData = z.output<typeof commissionRuleSchema>;

export const agreementSchema = z
  .object({
    title: z.string().trim().min(2, 'e.g. Agency agreement 2026-27').max(160),
    reference: optionalText(80),
    validFrom: dateOnlySchema,
    /** Null: until it is ended. */
    validTo: dateOnlySchema.nullable().optional(),
    currency: z.enum(CURRENCIES),
    /** Claim this many days after the course starts (the census date, usually). */
    claimAfterDays: z.coerce.number().int().min(0).max(365).default(30),
    /** The university pays this many days after a claim. */
    paymentTermsDays: z.coerce.number().int().min(0).max(365).default(45),
    notes: optionalText(4000),
    active: z.boolean().default(true),
    /** First match wins, in this order. */
    rules: z.array(commissionRuleSchema).min(1, 'Add at least one commission rule').max(20),
  })
  .superRefine((v, ctx) => {
    if (v.validTo && v.validTo < v.validFrom) ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'Ends before it starts' });
  });
export type AgreementInput = z.input<typeof agreementSchema>;

export type AgreementStatus = 'upcoming' | 'active' | 'expired' | 'ended';
export const AGREEMENT_STATUS_LABEL: Record<AgreementStatus, string> = {
  upcoming: 'Not started',
  active: 'In force',
  expired: 'Expired',
  ended: 'Ended',
};

export interface CommissionRuleView extends CommissionRuleData {
  id: string;
  position: number;
}

export interface AgreementView {
  id: string;
  institutionId: string;
  title: string;
  reference: string | null;
  validFrom: string;
  validTo: string | null;
  currency: Currency;
  claimAfterDays: number;
  paymentTermsDays: number;
  notes: string | null;
  active: boolean;
  status: AgreementStatus;
  /** A newer version replaced this one (rules changed after commissions were earned). */
  version: number;
  rules: CommissionRuleView[];
  hasDocument: boolean;
  documentName: string | null;
  /** Students confirmed under it so far - what tiers and bonuses count. */
  confirmedStudents: number;
}

export function agreementStatus(a: { validFrom: string; validTo: string | null; active: boolean }, today: string): AgreementStatus {
  if (!a.active) return 'ended';
  if (a.validFrom > today) return 'upcoming';
  if (a.validTo && a.validTo < today) return 'expired';
  return 'active';
}

/* ------------------------------------------------------------------ */
/* Working out a commission                                             */
/* ------------------------------------------------------------------ */

/** The facts of an application a rule's conditions look at, plus its programme. */
export type CommissionFacts = ConditionFacts & { program?: string | null };

/** The first rule whose conditions hold, in order. */
export function matchRule<R extends { conditions: Condition[] }>(rules: R[], facts: CommissionFacts): R | null {
  return rules.find((r) => evaluateConditions(r.conditions, facts)) ?? null;
}

/** The rate (basis points) with volume tiers applied for this many confirmed students. */
export function tierRateBp(rule: Pick<CommissionRuleData, 'ratePercent' | 'tiers'>, confirmedStudents: number): number {
  let pct = rule.ratePercent;
  for (const t of rule.tiers) if (confirmedStudents >= t.fromStudents) pct = t.ratePercent;
  return Math.round(pct * 100);
}

/** Commission on one year's tuition, in minor units. */
export function commissionAmount(rule: Pick<CommissionRuleData, 'basis' | 'fixedAmount'>, tuition: number, rateBp: number): number {
  if (rule.basis === 'fixed') return Math.round(rule.fixedAmount * 100);
  return Math.round((tuition * rateBp) / 10_000);
}

/* ------------------------------------------------------------------ */
/* The application's side                                               */
/* ------------------------------------------------------------------ */

export const caseEnrolmentSchema = z.object({
  institutionId: uuidSchema.nullable(),
  /** First-year tuition, minor units. */
  tuitionFee: minor.nullable().optional(),
  tuitionCurrency: z.enum(CURRENCIES).nullable().optional(),
  /** When the course starts - the commission is claimable after the census date that follows. */
  courseStart: dateOnlySchema.nullable().optional(),
  /** Scholarship off the tuition, minor units: commission is usually on the net fee. */
  scholarship: minor.nullable().optional(),
});
export type CaseEnrolmentInput = z.input<typeof caseEnrolmentSchema>;

/* ------------------------------------------------------------------ */
/* Commissions                                                          */
/* ------------------------------------------------------------------ */

/**
 * expected: the student paid the deposit (or reached the trigger step).
 * confirmed: enrolled - earned, and in the books.
 * claimed: on a claim sent to the university.
 * disputed: the university questions it.
 * written_off: given up on (bad debt).
 * clawed_back: the student left within the retention period and the university took it back.
 * cancelled: never earned (did not enrol, visa refused).
 * Received and part-received are worked out from what has been matched to it.
 */
export const COMMISSION_STATUSES = ['expected', 'confirmed', 'claimed', 'disputed', 'written_off', 'clawed_back', 'cancelled'] as const;
export type CommissionStatus = (typeof COMMISSION_STATUSES)[number];
export type CommissionStage = CommissionStatus | 'received' | 'part_received';
export const COMMISSION_STAGE_LABEL: Record<CommissionStage, string> = {
  expected: 'Expected',
  confirmed: 'To claim',
  claimed: 'Claimed',
  part_received: 'Part received',
  received: 'Received',
  disputed: 'Disputed',
  written_off: 'Written off',
  clawed_back: 'Clawed back',
  cancelled: 'Cancelled',
};
export const COMMISSION_STAGE_TONE: Record<CommissionStage, 'ok' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  expected: 'neutral',
  confirmed: 'warn',
  claimed: 'info',
  part_received: 'info',
  received: 'ok',
  disputed: 'bad',
  written_off: 'bad',
  clawed_back: 'bad',
  cancelled: 'neutral',
};

export const COMMISSION_KINDS = ['student', 'bonus', 'adjustment'] as const;
export type CommissionKind = (typeof COMMISSION_KINDS)[number];

export function commissionStage(status: CommissionStatus, amount: number, received: number): CommissionStage {
  if (status === 'confirmed' || status === 'claimed') {
    if (amount > 0 && received >= amount) return 'received';
    if (received > 0) return 'part_received';
  }
  return status;
}

export interface CommissionView {
  id: string;
  number: string;
  kind: CommissionKind;
  caseId: string | null;
  caseReference: string | null;
  clientId: string | null;
  clientName: string | null;
  consultantName: string | null;
  institutionId: string;
  institutionName: string;
  agreementId: string | null;
  agreementTitle: string | null;
  ruleName: string | null;
  yearNo: number;
  intake: string | null;
  tuition: number | null;
  rateBp: number | null;
  amount: number;
  currency: Currency;
  received: number;
  outstanding: number;
  status: CommissionStatus;
  stage: CommissionStage;
  /** When it is expected to be paid - course start plus the claim window and payment terms. */
  expectedOn: string | null;
  /** From when it can be claimed. */
  claimableOn: string | null;
  retentionUntil: string | null;
  confirmedAt: string | null;
  claimId: string | null;
  claimNumber: string | null;
  note: string | null;
  splits: CommissionSplitView[];
  /** Exchange difference on what was received, in the base currency. */
  fxDifference: number;
  createdAt: string;
}

export const commissionsQuerySchema = z.object({
  /** expected | to_claim | claimed | received | problems | all */
  view: z.enum(['expected', 'to_claim', 'claimed', 'received', 'problems', 'all']).default('all'),
  institutionId: uuidSchema.optional(),
  caseId: uuidSchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type CommissionsQuery = z.output<typeof commissionsQuerySchema>;

export const manualCommissionSchema = z.object({
  caseId: uuidSchema.nullable().optional(),
  institutionId: uuidSchema,
  kind: z.enum(COMMISSION_KINDS).default('student'),
  /** Major units, in the institution's currency. */
  amount: z.coerce.number().positive().max(10_000_000),
  currency: z.enum(CURRENCIES),
  yearNo: z.coerce.number().int().min(1).max(8).default(1),
  expectedOn: dateOnlySchema.nullable().optional(),
  note: optionalText(500),
});
export type ManualCommissionInput = z.input<typeof manualCommissionSchema>;

export const confirmCommissionSchema = z.object({
  /** The day the student enrolled (or the census date passed). */
  enrolledOn: dateOnlySchema,
  /** Rate to the base currency on that day, for reports in the base currency. */
  fxRate: z.coerce.number().positive().max(1_000_000).nullable().optional(),
  /** What the university confirmed, when it differs from the calculation (major units). */
  amount: z.coerce.number().positive().max(10_000_000).nullable().optional(),
});
export type ConfirmCommissionInput = z.input<typeof confirmCommissionSchema>;

export const commissionReasonSchema = z.object({ reason: reasonSchema });
export const clawbackSchema = z.object({
  reason: reasonSchema,
  /** Major units; by default all that was received. */
  amount: z.coerce.number().positive().max(10_000_000).nullable().optional(),
});
export type ClawbackInput = z.input<typeof clawbackSchema>;

/* ------------------------------------------------------------------ */
/* Claims                                                               */
/* ------------------------------------------------------------------ */

export const CLAIM_STATUSES = ['draft', 'submitted', 'disputed', 'paid', 'cancelled'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];
export const CLAIM_STATUS_LABEL: Record<ClaimStatus | 'part_paid', string> = {
  draft: 'Draft',
  submitted: 'Sent',
  part_paid: 'Part paid',
  disputed: 'Disputed',
  paid: 'Paid',
  cancelled: 'Cancelled',
};

export const claimSchema = z.object({
  institutionId: uuidSchema,
  /** Confirmed commissions to put on it, all in one currency. */
  commissionIds: z.array(uuidSchema).min(1, 'Choose at least one commission').max(500),
  /** e.g. "September 2026 intake". */
  periodLabel: z.string().trim().min(2).max(80),
  notes: optionalText(2000),
});
export type ClaimInput = z.input<typeof claimSchema>;

export const submitClaimSchema = z.object({
  submittedOn: dateOnlySchema,
  /** Defaults to the agreement's payment terms. */
  dueOn: dateOnlySchema.nullable().optional(),
});

export interface ClaimView {
  id: string;
  number: string;
  institutionId: string;
  institutionName: string;
  currency: Currency;
  periodLabel: string;
  status: ClaimStatus | 'part_paid';
  submittedOn: string | null;
  dueOn: string | null;
  overdue: boolean;
  total: number;
  received: number;
  outstanding: number;
  notes: string | null;
  commissions: CommissionView[];
  createdByName: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Receipts from universities                                           */
/* ------------------------------------------------------------------ */

export const receiptAllocationSchema = z.object({
  commissionId: uuidSchema,
  /** Major units. Negative only against a clawed-back commission (a deduction). */
  amount: z.coerce.number().min(-10_000_000).max(10_000_000).refine((n) => n !== 0, 'Not zero'),
});

export const institutionReceiptSchema = z
  .object({
    institutionId: uuidSchema,
    receivedOn: dateOnlySchema,
    currency: z.enum(CURRENCIES),
    /** What the university sent, before the bank's charges (major units). */
    amount: z.coerce.number().positive().max(100_000_000),
    /** Deducted by the banks on the way (major units). */
    bankCharges: z.coerce.number().min(0).max(1_000_000).default(0),
    /** Rate to the base currency on the day. */
    fxRate: z.coerce.number().positive().max(1_000_000).nullable().optional(),
    accountId: uuidSchema,
    method: z.enum(PAYMENT_METHODS).default('bank_transfer'),
    reference: optionalText(120),
    claimId: uuidSchema.nullable().optional(),
    notes: optionalText(1000),
    allocations: z.array(receiptAllocationSchema).max(500).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.bankCharges >= v.amount) ctx.addIssue({ code: 'custom', path: ['bankCharges'], message: 'More than the amount' });
    const allocated = v.allocations.reduce((n, a) => n + a.amount, 0);
    if (Math.round(allocated * 100) > Math.round(v.amount * 100)) {
      ctx.addIssue({ code: 'custom', path: ['allocations'], message: 'More is matched than was received' });
    }
  });
export type InstitutionReceiptInput = z.input<typeof institutionReceiptSchema>;

export interface InstitutionReceiptView {
  id: string;
  number: string;
  institutionId: string;
  institutionName: string;
  receivedOn: string;
  currency: Currency;
  amount: number;
  bankCharges: number;
  net: number;
  allocated: number;
  unallocated: number;
  fxRate: number | null;
  accountName: string;
  reference: string | null;
  claimNumber: string | null;
  notes: string | null;
  allocations: { commissionId: string; commissionNumber: string; clientName: string | null; amount: number; fxDifference: number }[];
  voided: boolean;
  voidReason: string | null;
  createdByName: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Staff incentives                                                     */
/* ------------------------------------------------------------------ */

export const commissionSplitSchema = z.object({
  splits: z
    .array(
      z.object({
        userId: uuidSchema,
        /** Percent of the commission. */
        sharePercent: z.coerce.number().min(0.01).max(100),
      }),
    )
    .max(10)
    .superRefine((list, ctx) => {
      const total = list.reduce((n, s) => n + s.sharePercent, 0);
      if (total > 100) ctx.addIssue({ code: 'custom', message: 'The shares add up to more than 100%' });
      if (new Set(list.map((s) => s.userId)).size !== list.length) ctx.addIssue({ code: 'custom', message: 'Each person once' });
    }),
});
export type CommissionSplitInput = z.input<typeof commissionSplitSchema>;

export interface CommissionSplitView {
  id: string;
  userId: string;
  userName: string;
  shareBp: number;
  /** Their share of the commission. */
  amount: number;
  currency: Currency;
  /** Owed once the commission is received in full. */
  payable: boolean;
  paidOn: string | null;
  paidAmount: number | null;
}

export const payIncentiveSchema = z.object({
  paidOn: dateOnlySchema,
  accountId: uuidSchema,
});
export type PayIncentiveInput = z.input<typeof payIncentiveSchema>;

export const commissionSettingsSchema = z.object({
  /** The consultant's default share of each commission they bring in (percent). */
  consultantSharePercent: z.coerce.number().min(0).max(100).default(0),
  /** Chase a sent claim this many days after it falls due, and every so often after. */
  followUpDays: z.coerce.number().int().min(1).max(90).default(14),
});
export type CommissionSettingsInput = z.input<typeof commissionSettingsSchema>;

export interface CommissionSettingsView {
  consultantSharePercent: number;
  followUpDays: number;
}

/* ------------------------------------------------------------------ */
/* The dashboard                                                        */
/* ------------------------------------------------------------------ */

export interface CommissionTotals {
  currency: Currency;
  expected: number;
  toClaim: number;
  claimed: number;
  received: number;
  receivedThisYear: number;
  overdueClaims: number;
}

export interface CommissionsOverview {
  totals: CommissionTotals[];
  /** By the month it is expected to be paid, per currency: the forecast. */
  forecast: { month: string; currency: Currency; expected: number; confirmed: number }[];
  byInstitution: { institutionId: string; name: string; currency: Currency; outstanding: number; receivedThisYear: number; students: number }[];
  claimsOverdue: ClaimView[];
  disputed: number;
}
