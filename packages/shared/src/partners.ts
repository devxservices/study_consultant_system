import { z } from 'zod';
import { CURRENCIES, PAYMENT_METHODS, type Currency, type PaymentMethod } from './billing';
import { dateOnlySchema } from './profile';
import { uuidSchema } from './dto/common';
import { conditionSchema, evaluateConditions, type Condition, type ConditionFacts } from './workflow';

/*
 * Partner consultants: sub-agents and referral partners who bring students to
 * the consultancy and are paid a share for it.
 *
 * A partner applies (or is added by staff), sends its registration papers,
 * signs the partner agreement in the app, and is approved. Its people sign in
 * to their own portal, register students there - the first to register a
 * student keeps them; a clash goes to a queue for staff to decide - and
 * follow those students' applications. What a partner earns comes from
 * versioned rules: a share of the commission the university pays, a fixed
 * amount per enrolled student, or a share of the fees the student pays. Each
 * earning is booked as it falls due; payouts gather them, take off tax
 * withheld and any advance, and are approved by a second person before they
 * are paid. A sub-agent can sit under a master partner, who earns an override
 * on its students.
 */

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const reasonSchema = z.string().trim().min(5, 'Say why, so the record explains itself later').max(500);
const percent = z.coerce.number().min(0).max(100);

/* ------------------------------------------------------------------ */
/* Partners                                                             */
/* ------------------------------------------------------------------ */

export const PARTNER_KINDS = ['sub_agent', 'referral'] as const;
export type PartnerKind = (typeof PARTNER_KINDS)[number];
export const PARTNER_KIND_LABEL: Record<PartnerKind, string> = {
  sub_agent: 'Sub-agent',
  referral: 'Referral partner',
};
export const PARTNER_KIND_HINT: Record<PartnerKind, string> = {
  sub_agent: 'Recruits students and works their applications with you',
  referral: 'Introduces students and leaves the rest to you',
};

/**
 * applied: filled in the public form, not looked at yet.
 * onboarding: being checked - papers, agreement.
 * active: may register students and is paid.
 * suspended: signs in and sees what it has, registers nothing new, is not paid.
 * terminated: the relationship has ended; its people cannot sign in.
 */
export const PARTNER_STATUSES = ['applied', 'onboarding', 'active', 'suspended', 'terminated'] as const;
export type PartnerStatus = (typeof PARTNER_STATUSES)[number];
export const PARTNER_STATUS_LABEL: Record<PartnerStatus, string> = {
  applied: 'Applied',
  onboarding: 'Onboarding',
  active: 'Active',
  suspended: 'Suspended',
  terminated: 'Terminated',
};
export const PARTNER_STATUS_TONE: Record<PartnerStatus, 'ok' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  applied: 'info',
  onboarding: 'warn',
  active: 'ok',
  suspended: 'bad',
  terminated: 'neutral',
};

export const PARTNER_TIERS = ['standard', 'silver', 'gold', 'platinum'] as const;
export type PartnerTier = (typeof PARTNER_TIERS)[number];
export const PARTNER_TIER_LABEL: Record<PartnerTier, string> = {
  standard: 'Standard',
  silver: 'Silver',
  gold: 'Gold',
  platinum: 'Platinum',
};

/** Who a partner's people are to it. */
export const PARTNER_MEMBER_ROLES = ['owner', 'admin', 'counsellor'] as const;
export type PartnerMemberRole = (typeof PARTNER_MEMBER_ROLES)[number];
export const PARTNER_MEMBER_ROLE_LABEL: Record<PartnerMemberRole, string> = {
  owner: 'Owner',
  admin: 'Administrator',
  counsellor: 'Counsellor',
};
/** Owners and administrators manage the team, sign the agreement and see money; counsellors work with students. */
export const partnerMemberCanManage = (role: PartnerMemberRole | null | undefined) => role === 'owner' || role === 'admin';

const ibanSchema = z
  .string()
  .trim()
  .toUpperCase()
  .transform((s) => s.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^[A-Z0-9]{8,34}$/, 'Account number or IBAN, letters and numbers only'));

export const partnerBankSchema = z.object({
  accountTitle: z.string().trim().min(2).max(120),
  bankName: z.string().trim().min(2).max(120),
  iban: ibanSchema,
  swift: optionalText(20),
});
export type PartnerBankInput = z.input<typeof partnerBankSchema>;

/** The public "become a partner" form. */
export const partnerApplicationSchema = z.object({
  name: z.string().trim().min(2, 'Your organisation’s name').max(160),
  kind: z.enum(PARTNER_KINDS).default('sub_agent'),
  contactName: z.string().trim().min(2, 'Who we should talk to').max(120),
  email: z.string().trim().toLowerCase().email('A valid email'),
  phone: z.string().trim().min(7, 'A phone number we can reach').max(30),
  country: z.string().trim().min(2).max(80),
  city: optionalText(80),
  website: optionalText(200),
  studentsPerYear: z.coerce.number().int().min(0).max(100_000).optional().nullable(),
  message: optionalText(2000),
  /** Left empty by people; filled by bots. */
  website2: z.string().max(0, 'Leave this empty').optional(),
});
export type PartnerApplicationInput = z.input<typeof partnerApplicationSchema>;

/** Staff adding or editing a partner. */
export const partnerSchema = z.object({
  name: z.string().trim().min(2).max(160),
  kind: z.enum(PARTNER_KINDS).default('sub_agent'),
  contactName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().min(7).max(30),
  country: z.string().trim().min(2).max(80),
  city: optionalText(80),
  address: optionalText(300),
  website: optionalText(200),
  registrationNumber: optionalText(60),
  taxId: optionalText(60),
  tier: z.enum(PARTNER_TIERS).default('standard'),
  /** The member of staff who looks after them. */
  managerUserId: uuidSchema.nullable().optional(),
  /** A sub-agent working under another partner. */
  parentPartnerId: uuidSchema.nullable().optional(),
  /** What the parent earns on this sub-agent's students (percent of what each earning was worked out on). */
  overridePercent: percent.default(0),
  /** Tax withheld from its payouts; empty for the consultancy's default. */
  withholdingPercent: percent.nullable().optional(),
  /** The currency it is paid in. */
  currency: z.enum(CURRENCIES).default('PKR'),
  notes: optionalText(2000),
});
export type PartnerInput = z.input<typeof partnerSchema>;

export const partnersQuerySchema = z.object({
  q: z.string().trim().max(80).optional(),
  status: z.enum([...PARTNER_STATUSES, 'all']).default('all'),
  tier: z.enum(PARTNER_TIERS).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type PartnersQuery = z.output<typeof partnersQuerySchema>;

export const partnerStatusSchema = z.object({
  status: z.enum(['onboarding', 'active', 'suspended', 'terminated']),
  reason: reasonSchema,
});
export const partnerTierSchema = z.object({ tier: z.enum(PARTNER_TIERS), reason: reasonSchema });

export interface PartnerSummaryView {
  id: string;
  number: string;
  name: string;
  kind: PartnerKind;
  status: PartnerStatus;
  tier: PartnerTier;
  country: string;
  city: string | null;
  contactName: string;
  email: string;
  managerName: string | null;
  parentName: string | null;
  students: number;
  enrolled: number;
  payable: { currency: Currency; amount: number }[];
  kycStatus: KycStatus;
  agreementStatus: PartnerAgreementStatus | null;
  createdAt: string;
}

export interface PartnerView extends PartnerSummaryView {
  phone: string;
  address: string | null;
  website: string | null;
  registrationNumber: string | null;
  taxId: string | null;
  managerUserId: string | null;
  parentPartnerId: string | null;
  overridePercent: number;
  withholdingPercent: number | null;
  /** What is actually withheld: its own rate, or the consultancy's default. */
  effectiveWithholdingPercent: number;
  currency: Currency;
  source: 'applied' | 'added';
  application: { studentsPerYear: number | null; message: string | null } | null;
  notes: string | null;
  /** Masked except to those who may pay partners. */
  bank: { accountTitle: string; bankName: string; iban: string; swift: string | null } | null;
  approvedAt: string | null;
  approvedByName: string | null;
  subAgents: { id: string; name: string; status: PartnerStatus }[];
  members: PartnerMemberView[];
  documents: PartnerDocumentView[];
}

/* ------------------------------------------------------------------ */
/* Its people                                                           */
/* ------------------------------------------------------------------ */

export const partnerMemberSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: optionalText(30),
  role: z.enum(PARTNER_MEMBER_ROLES).default('counsellor'),
  /** Their first password; they change it after signing in. */
  password: z.string().min(8, 'Use at least 8 characters').max(200),
});
export type PartnerMemberInput = z.input<typeof partnerMemberSchema>;

export interface PartnerMemberView {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: PartnerMemberRole;
  active: boolean;
  lastSeenAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Papers (KYC)                                                         */
/* ------------------------------------------------------------------ */

export const KYC_KINDS = ['registration', 'owner_id', 'bank', 'tax', 'office', 'other'] as const;
export type KycKind = (typeof KYC_KINDS)[number];
export const KYC_KIND_LABEL: Record<KycKind, string> = {
  registration: 'Business registration',
  owner_id: 'Owner’s ID (CNIC or passport)',
  bank: 'Bank letter or cheque',
  tax: 'Tax registration (NTN)',
  office: 'Office photo or lease',
  other: 'Other',
};
/** What is needed before a partner can be approved. */
export const KYC_REQUIRED: readonly KycKind[] = ['registration', 'owner_id', 'bank'];

export const KYC_STATUSES = ['missing', 'pending', 'approved', 'rejected'] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];
export const KYC_STATUS_LABEL: Record<KycStatus, string> = {
  missing: 'Papers missing',
  pending: 'Papers to check',
  approved: 'Papers approved',
  rejected: 'Papers rejected',
};

export interface PartnerDocumentView {
  id: string;
  kind: KycKind;
  name: string;
  size: number;
  status: 'pending' | 'approved' | 'rejected';
  reviewNote: string | null;
  uploadedByName: string | null;
  reviewedByName: string | null;
  createdAt: string;
}

export const kycReviewSchema = z
  .object({ decision: z.enum(['approve', 'reject']), note: optionalText(500) })
  .refine((v) => v.decision === 'approve' || (v.note && v.note.length >= 5), { message: 'Say what is wrong with it', path: ['note'] });

/** The overall state of a partner's papers. */
export function kycStatus(docs: { kind: KycKind; status: 'pending' | 'approved' | 'rejected' }[]): KycStatus {
  const live = (k: KycKind) => docs.filter((d) => d.kind === k);
  if (KYC_REQUIRED.some((k) => live(k).length === 0)) return docs.some((d) => d.status === 'rejected') ? 'rejected' : 'missing';
  if (KYC_REQUIRED.every((k) => live(k).some((d) => d.status === 'approved'))) return 'approved';
  if (KYC_REQUIRED.some((k) => live(k).every((d) => d.status === 'rejected'))) return 'rejected';
  return 'pending';
}

/* ------------------------------------------------------------------ */
/* The agreement, signed in the app                                     */
/* ------------------------------------------------------------------ */

export const PARTNER_AGREEMENT_STATUSES = ['draft', 'sent', 'signed', 'void'] as const;
export type PartnerAgreementStatus = (typeof PARTNER_AGREEMENT_STATUSES)[number];
export const PARTNER_AGREEMENT_STATUS_LABEL: Record<PartnerAgreementStatus, string> = {
  draft: 'Draft',
  sent: 'Waiting for signature',
  signed: 'Signed',
  void: 'Withdrawn',
};

export const partnerAgreementSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    /** The terms, as plain text. Blank lines separate paragraphs. */
    body: z.string().trim().min(50, 'The terms of the agreement').max(60_000),
    validFrom: dateOnlySchema,
    validTo: dateOnlySchema.nullable().optional(),
  })
  .refine((v) => !v.validTo || v.validTo > v.validFrom, { message: 'Ends after it starts', path: ['validTo'] });
export type PartnerAgreementInput = z.input<typeof partnerAgreementSchema>;

/** Drawn signatures arrive as a PNG data URL from a canvas. */
const drawnSignature = z
  .string()
  .max(400_000, 'That signature is too large')
  .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'Draw your signature');

export const signAgreementSchema = z
  .object({
    signerName: z.string().trim().min(2, 'Your full name').max(120),
    signerTitle: z.string().trim().min(2, 'Your position').max(120),
    kind: z.enum(['typed', 'drawn']),
    /** The typed name, or the drawing. */
    signature: z.string().trim().min(2).max(400_000),
    /** The person ticked "I have read and agree to these terms". */
    agree: z.literal(true, { errorMap: () => ({ message: 'Confirm you agree to the terms' }) }),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'drawn' && !drawnSignature.safeParse(v.signature).success) ctx.addIssue({ code: 'custom', path: ['signature'], message: 'Draw your signature' });
    if (v.kind === 'typed' && v.signature.toLowerCase().replace(/\s+/g, ' ') !== v.signerName.toLowerCase().replace(/\s+/g, ' ')) {
      ctx.addIssue({ code: 'custom', path: ['signature'], message: 'Type your name exactly as above' });
    }
  });
export type SignAgreementInput = z.input<typeof signAgreementSchema>;

export interface PartnerAgreementView {
  id: string;
  partnerId: string;
  version: number;
  title: string;
  body: string;
  validFrom: string;
  validTo: string | null;
  status: PartnerAgreementStatus;
  /** SHA-256 of the terms as sent; the certificate proves these are what was signed. */
  documentHash: string | null;
  sentAt: string | null;
  sentByName: string | null;
  signedAt: string | null;
  signerName: string | null;
  signerTitle: string | null;
  signatureKind: 'typed' | 'drawn' | null;
  /** The typed name or the drawing (a data URL), once signed. */
  signature: string | null;
  signerIp: string | null;
  signerUserAgent: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* What partners earn                                                   */
/* ------------------------------------------------------------------ */

/**
 * commission_share: a percentage of what the university pays on the student,
 *   earned as it is received.
 * fixed_per_student: a fixed amount when the student enrols (the university
 *   commission is confirmed), once per student.
 * fee_share: a percentage of the consultancy's own fees the student pays
 *   (never of money passed through to universities or embassies).
 */
export const PARTNER_RULE_BASES = ['commission_share', 'fixed_per_student', 'fee_share'] as const;
export type PartnerRuleBasis = (typeof PARTNER_RULE_BASES)[number];
export const PARTNER_RULE_BASIS_LABEL: Record<PartnerRuleBasis, string> = {
  commission_share: 'Share of university commission',
  fixed_per_student: 'Fixed amount per enrolled student',
  fee_share: 'Share of the student’s service fees',
};
export const PARTNER_RULE_BASIS_HINT: Record<PartnerRuleBasis, string> = {
  commission_share: 'Earned as the university pays, on what it pays',
  fixed_per_student: 'Earned when the student’s enrolment is confirmed',
  fee_share: 'Earned as the student pays your fees, on the fees only',
};

/** Fee kinds a fee share can be on - pass-through money never is. */
export const SHAREABLE_FEE_CATEGORIES = ['service', 'course', 'application', 'visa'] as const;

export const partnerRuleSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    basis: z.enum(PARTNER_RULE_BASES),
    ratePercent: percent.default(0),
    /** Major units, for a fixed amount. */
    fixedAmount: z.coerce.number().min(0).max(10_000_000).default(0),
    currency: z.enum(CURRENCIES).nullable().optional(),
    /** Who it is for: one partner, a tier, or (both empty) every partner. */
    partnerId: uuidSchema.nullable().optional(),
    tier: z.enum(PARTNER_TIERS).nullable().optional(),
    /** Only students at this institution (commission rules). */
    institutionId: uuidSchema.nullable().optional(),
    feeCategories: z.array(z.enum(SHAREABLE_FEE_CATEGORIES)).max(4).default([...SHAREABLE_FEE_CATEGORIES]),
    conditions: z.array(conditionSchema).max(10).default([]),
    validFrom: dateOnlySchema,
    validTo: dateOnlySchema.nullable().optional(),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.basis !== 'fixed_per_student' && !(v.ratePercent > 0)) ctx.addIssue({ code: 'custom', path: ['ratePercent'], message: 'A rate above 0' });
    if (v.basis === 'fixed_per_student') {
      if (!(v.fixedAmount > 0)) ctx.addIssue({ code: 'custom', path: ['fixedAmount'], message: 'An amount above 0' });
      if (!v.currency) ctx.addIssue({ code: 'custom', path: ['currency'], message: 'The currency it is paid in' });
    }
    if (v.partnerId && v.tier) ctx.addIssue({ code: 'custom', path: ['tier'], message: 'For one partner or a tier, not both' });
    if (v.validTo && v.validTo < v.validFrom) ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'Ends after it starts' });
    if (v.basis === 'fee_share' && v.feeCategories.length === 0) ctx.addIssue({ code: 'custom', path: ['feeCategories'], message: 'At least one kind of fee' });
  });
export type PartnerRuleInput = z.input<typeof partnerRuleSchema>;
export type PartnerRuleData = z.output<typeof partnerRuleSchema>;

export interface PartnerRuleView extends PartnerRuleData {
  id: string;
  /** Every version of a rule shares this. */
  ruleKey: string;
  version: number;
  /** A newer version replaced it; earnings already made keep these terms. */
  superseded: boolean;
  partnerName: string | null;
  institutionName: string | null;
  earnings: number;
  createdByName: string | null;
  createdAt: string;
}

/** How specific a rule is: one partner beats its tier beats everyone; an institution beats none. */
export function partnerRuleRank(rule: { partnerId?: string | null; tier?: string | null; institutionId?: string | null }): number {
  return (rule.partnerId ? 4 : rule.tier ? 2 : 0) + (rule.institutionId ? 1 : 0);
}

/** The rule that applies: the most specific live one whose scope and conditions fit, oldest first on a tie. */
export function matchPartnerRule<
  R extends { basis: PartnerRuleBasis; partnerId?: string | null; tier?: string | null; institutionId?: string | null; conditions: Condition[]; validFrom: string; validTo?: string | null; active: boolean },
>(rules: R[], basis: PartnerRuleBasis, who: { partnerId: string; tier: PartnerTier; institutionId?: string | null }, facts: ConditionFacts, day: string): R | null {
  const fits = rules.filter(
    (r) =>
      r.active &&
      r.basis === basis &&
      r.validFrom <= day &&
      (!r.validTo || r.validTo >= day) &&
      (!r.partnerId || r.partnerId === who.partnerId) &&
      (!r.tier || r.tier === who.tier) &&
      (!r.institutionId || r.institutionId === who.institutionId) &&
      evaluateConditions(r.conditions, facts),
  );
  return fits.sort((a, b) => partnerRuleRank(b) - partnerRuleRank(a))[0] ?? null;
}

/**
 * pending: worked out but waiting (only manual entries dated ahead).
 * payable: owed, in the books.
 * on_payout: on a payout not yet paid.
 * paid: paid out.
 * reversed: undone before it was paid (the money it came from was voided).
 */
export const EARNING_STATUSES = ['payable', 'on_payout', 'paid', 'reversed'] as const;
export type EarningStatus = (typeof EARNING_STATUSES)[number];
export const EARNING_STATUS_LABEL: Record<EarningStatus, string> = {
  payable: 'Owed',
  on_payout: 'On a payout',
  paid: 'Paid',
  reversed: 'Reversed',
};
export const EARNING_STATUS_TONE: Record<EarningStatus, 'ok' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  payable: 'warn',
  on_payout: 'info',
  paid: 'ok',
  reversed: 'neutral',
};

export const EARNING_KINDS = ['commission_share', 'fixed_per_student', 'fee_share', 'override', 'adjustment', 'clawback'] as const;
export type EarningKind = (typeof EARNING_KINDS)[number];
export const EARNING_KIND_LABEL: Record<EarningKind, string> = {
  commission_share: 'Commission share',
  fixed_per_student: 'Per enrolled student',
  fee_share: 'Fee share',
  override: 'Override on a sub-agent',
  adjustment: 'Adjustment',
  clawback: 'Clawback',
};

export interface PartnerEarningView {
  id: string;
  number: string;
  partnerId: string;
  partnerName: string;
  kind: EarningKind;
  clientId: string | null;
  clientName: string | null;
  /** The sub-agent whose student it was, for an override. */
  fromPartnerName: string | null;
  description: string;
  /** What it was worked out on (commission received, fees paid). */
  basisAmount: number | null;
  rateBp: number | null;
  amount: number;
  currency: Currency;
  status: EarningStatus;
  earnedOn: string;
  payoutId: string | null;
  payoutNumber: string | null;
  ruleName: string | null;
  createdAt: string;
}

export const earningsQuerySchema = z.object({
  partnerId: uuidSchema.optional(),
  status: z.enum([...EARNING_STATUSES, 'all']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

/** A correction staff add by hand: positive owes the partner more, negative takes it back. */
export const earningAdjustmentSchema = z.object({
  amount: z.coerce
    .number()
    .min(-10_000_000)
    .max(10_000_000)
    .refine((n) => n !== 0, 'Not zero'),
  currency: z.enum(CURRENCIES),
  clientId: uuidSchema.nullable().optional(),
  reason: reasonSchema,
});
export type EarningAdjustmentInput = z.input<typeof earningAdjustmentSchema>;

/* ------------------------------------------------------------------ */
/* Payouts and advances                                                 */
/* ------------------------------------------------------------------ */

export const PAYOUT_STATUSES = ['draft', 'approved', 'paid', 'void'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  draft: 'To approve',
  approved: 'Approved, to pay',
  paid: 'Paid',
  void: 'Void',
};
export const PAYOUT_STATUS_TONE: Record<PayoutStatus, 'ok' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  draft: 'warn',
  approved: 'info',
  paid: 'ok',
  void: 'neutral',
};

export const createPayoutSchema = z.object({
  partnerId: uuidSchema,
  currency: z.enum(CURRENCIES),
  /** Earnings up to and including this day; empty for everything owed. */
  through: dateOnlySchema.nullable().optional(),
  periodLabel: z.string().trim().min(2).max(80),
  /** Of an outstanding advance, how much to take back (major units); empty for as much as possible. */
  advanceRecovery: z.coerce.number().min(0).max(10_000_000).nullable().optional(),
  notes: optionalText(1000),
});
export type CreatePayoutInput = z.input<typeof createPayoutSchema>;

export const payPayoutSchema = z.object({
  paidOn: dateOnlySchema,
  accountId: uuidSchema,
  method: z.enum(PAYMENT_METHODS).default('bank_transfer'),
  reference: optionalText(120),
  fxRate: z.coerce.number().positive().max(1_000_000).nullable().optional(),
});
export type PayPayoutInput = z.input<typeof payPayoutSchema>;

export interface PayoutView {
  id: string;
  number: string;
  partnerId: string;
  partnerName: string;
  currency: Currency;
  periodLabel: string;
  status: PayoutStatus;
  gross: number;
  withholdingBp: number;
  withholding: number;
  advanceRecovered: number;
  net: number;
  earnings: PartnerEarningView[];
  createdByName: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  paidOn: string | null;
  accountName: string | null;
  method: PaymentMethod | null;
  reference: string | null;
  notes: string | null;
  voidReason: string | null;
  createdAt: string;
}

export const advanceSchema = z.object({
  partnerId: uuidSchema,
  amount: z.coerce.number().positive().max(10_000_000),
  currency: z.enum(CURRENCIES),
  givenOn: dateOnlySchema,
  accountId: uuidSchema,
  reason: reasonSchema,
});
export type AdvanceInput = z.input<typeof advanceSchema>;

export interface AdvanceView {
  id: string;
  number: string;
  partnerId: string;
  partnerName: string;
  amount: number;
  recovered: number;
  outstanding: number;
  currency: Currency;
  givenOn: string;
  accountName: string | null;
  reason: string;
  createdByName: string | null;
  voided: boolean;
}

/** Withholding, the advance taken back and what is paid, from what is owed. */
export function payoutFigures(gross: number, withholdingBp: number, advanceOutstanding: number, advanceWanted: number | null): { withholding: number; advanceRecovered: number; net: number } {
  const withholding = gross > 0 ? Math.round((gross * withholdingBp) / 10_000) : 0;
  const room = Math.max(0, gross - withholding);
  const advanceRecovered = Math.min(advanceOutstanding, room, advanceWanted === null ? Number.MAX_SAFE_INTEGER : advanceWanted);
  return { withholding, advanceRecovered, net: gross - withholding - advanceRecovered };
}

/* ------------------------------------------------------------------ */
/* Students and who they belong to                                      */
/* ------------------------------------------------------------------ */

export const registerStudentSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  phone: z.string().trim().min(7).max(30),
  city: optionalText(80),
  nationality: optionalText(80),
  passportNumber: optionalText(30),
  dateOfBirth: dateOnlySchema.nullable().optional(),
  intendedLevel: optionalText(40),
  intendedField: optionalText(120),
  englishTest: optionalText(40),
  englishScore: optionalText(20),
  firstApplication: z
    .object({
      targetCountry: z.string().trim().min(2).max(80),
      targetUniversity: optionalText(160),
      targetProgram: optionalText(160),
      intake: optionalText(40),
    })
    .nullable()
    .optional(),
  notes: optionalText(2000),
  /** The student agreed to their details being shared with the consultancy. */
  consent: z.literal(true, { errorMap: () => ({ message: 'The student must agree to their details being shared' }) }),
});
export type RegisterStudentInput = z.input<typeof registerStudentSchema>;

/** Same person: the same email, phone (last ten digits) or passport. */
export const ATTRIBUTION_MATCHES = ['email', 'phone', 'passport'] as const;
export type AttributionMatch = (typeof ATTRIBUTION_MATCHES)[number];
export const ATTRIBUTION_MATCH_LABEL: Record<AttributionMatch, string> = { email: 'email', phone: 'phone', passport: 'passport number' };

export const phoneKey = (phone: string | null | undefined) => {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : null;
};
export const passportKey = (passport: string | null | undefined) => {
  const s = (passport ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length >= 5 ? s : null;
};

export const CONFLICT_STATUSES = ['open', 'kept', 'transferred'] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];
export const CONFLICT_STATUS_LABEL: Record<ConflictStatus, string> = {
  open: 'To decide',
  kept: 'Stayed with the first',
  transferred: 'Moved to the claimant',
};

export interface AttributionConflictView {
  id: string;
  clientId: string;
  clientName: string;
  /** Who has the student now: a partner, or the consultancy itself. */
  currentPartnerId: string | null;
  currentPartnerName: string | null;
  registeredAt: string;
  claimantPartnerId: string;
  claimantPartnerName: string;
  claimedByName: string | null;
  matchedOn: AttributionMatch[];
  /** What the claimant entered. */
  submitted: { fullName: string; email: string; phone: string; passportNumber: string | null; notes: string | null };
  /** No live application and registered longer ago than the attribution window. */
  lapsed: boolean;
  status: ConflictStatus;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
}

export const resolveConflictSchema = z.object({ decision: z.enum(['keep', 'transfer']), note: reasonSchema });

export const assignStudentSchema = z.object({ partnerId: uuidSchema.nullable(), reason: reasonSchema });

export interface PartnerStudentView {
  clientId: string;
  fullName: string;
  email: string;
  phone: string;
  attributedAt: string | null;
  registeredByName: string | null;
  consultantName: string | null;
  applications: { id: string; reference: string; country: string; university: string | null; program: string | null; intake: string | null; stage: string; stageLabel: string; status: string }[];
  documents: number;
  /** Under a sub-agent of this partner, rather than its own. */
  viaPartnerName: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Messages, settings, performance, the portal                           */
/* ------------------------------------------------------------------ */

export const partnerMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  clientId: uuidSchema.nullable().optional(),
});

export interface PartnerMessageView {
  id: string;
  fromPartner: boolean;
  authorName: string;
  body: string;
  clientId: string | null;
  clientName: string | null;
  readAt: string | null;
  createdAt: string;
}

export const partnerSettingsSchema = z.object({
  /** The public "become a partner" form takes applications. */
  applicationsOpen: z.boolean().default(true),
  /** A student registered longer ago than this, with no live application, can be claimed again. */
  attributionDays: z.coerce.number().int().min(30).max(1095).default(365),
  defaultWithholdingPercent: percent.default(0),
  /** A payout is approved by someone other than whoever prepared it. */
  requireSecondApprover: z.boolean().default(true),
  /** Payouts below this (major units, in the partner's currency) wait for more. */
  minimumPayout: z.coerce.number().min(0).max(1_000_000).default(0),
  /** Enrolled students in the last 12 months to reach each tier. */
  tierThresholds: z
    .object({ silver: z.coerce.number().int().min(1).max(10_000), gold: z.coerce.number().int().min(1).max(10_000), platinum: z.coerce.number().int().min(1).max(10_000) })
    .refine((t) => t.silver < t.gold && t.gold < t.platinum, 'Each tier needs more students than the one below')
    .default({ silver: 5, gold: 15, platinum: 40 }),
  /** The text new agreements start from. */
  agreementTemplate: z.string().trim().max(60_000).default(''),
});
export type PartnerSettingsInput = z.input<typeof partnerSettingsSchema>;
export type PartnerSettingsView = z.output<typeof partnerSettingsSchema>;

/** The tier a number of enrolments reaches. */
export function tierFor(enrolled: number, t: PartnerSettingsView['tierThresholds']): PartnerTier {
  if (enrolled >= t.platinum) return 'platinum';
  if (enrolled >= t.gold) return 'gold';
  if (enrolled >= t.silver) return 'silver';
  return 'standard';
}

export interface PartnerPerformanceRow {
  partnerId: string;
  name: string;
  tier: PartnerTier;
  status: PartnerStatus;
  students: number;
  applications: number;
  offers: number;
  visas: number;
  enrolled: number;
  /** Enrolled out of students registered in the period. */
  conversionPercent: number;
  earned: { currency: Currency; amount: number }[];
  rank: number;
}

export interface PartnerDashboard {
  partner: { id: string; name: string; status: PartnerStatus; tier: PartnerTier; kind: PartnerKind; currency: Currency };
  me: { role: PartnerMemberRole; canManage: boolean };
  counts: { students: number; activeApplications: number; offers: number; visas: number; enrolledThisYear: number };
  earnings: { currency: Currency; owed: number; onPayout: number; paidThisYear: number }[];
  /** An estimate from commission the universities have not paid yet. */
  expected: { currency: Currency; amount: number }[];
  nextTier: { tier: PartnerTier; needed: number; enrolledLast12Months: number } | null;
  agreement: { id: string; status: PartnerAgreementStatus; title: string } | null;
  kyc: KycStatus;
  recent: { clientId: string; clientName: string; text: string; at: string }[];
  announcements: { id: string; title: string; body: string; pinned: boolean; createdAt: string }[];
  unreadMessages: number;
}

/** A partner's earnings matched to rules, for the dashboard's estimate. */
export function estimateShare(amount: number, rateBp: number): number {
  return Math.round((amount * rateBp) / 10_000);
}
