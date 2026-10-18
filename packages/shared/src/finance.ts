import { z } from 'zod';
import { CURRENCIES, PAYMENT_METHODS, formatMoney, type Currency, type PaymentMethod } from './billing';
import { dateOnlySchema } from './profile';
import { uuidSchema } from './dto/common';

/*
 * Finance: the books under the invoices.
 *
 * The invoice and payment rules stay as they were - an issued invoice is
 * fixed, the payments ledger is append-only, "paid" is computed - and
 * underneath them sits a double-entry journal that every money event posts
 * to in the same transaction: invoices, payments, refunds, credit notes,
 * expenses, bills, commissions and partner payouts. Receivables, the cash
 * book, profit and loss and the balance sheet are all reports over that one
 * journal, so they cannot disagree with each other.
 *
 * Each journal entry is in one currency and balances in it. Rupees and
 * pounds are never added together; a report in another currency is a
 * conversion at each transaction's own recorded rate, and says which
 * entries had no rate to convert with.
 */

const minor = z.coerce.number().int('Amounts are in whole minor units').min(0).max(100_000_000_00);
const positiveMinor = minor.refine((n) => n > 0, 'Enter an amount above zero');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));
const reasonSchema = z.string().trim().min(5, 'Say why, so the record explains itself later').max(500);
const currencySchema = z.enum(CURRENCIES);
/** A rate to the consultancy's base currency: 1 GBP = 355.20 PKR is 355.2. */
const fxRateSchema = z.coerce.number().positive('A rate above zero').max(1_000_000).optional().nullable();

/* ------------------------------------------------------------------ */
/* Chart of accounts                                                    */
/* ------------------------------------------------------------------ */

export const ACCOUNT_TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expenses',
};

/** Which side increases it. Assets and expenses grow with debits. */
export const NORMAL_BALANCE: Record<AccountType, 'debit' | 'credit'> = {
  asset: 'debit',
  expense: 'debit',
  liability: 'credit',
  equity: 'credit',
  income: 'credit',
};

/**
 * What an account is for, where the system needs to know: money can be
 * received into and paid out of `cash`, `bank` and `clearing` accounts, and
 * only those can be reconciled against a bank statement.
 */
export const ACCOUNT_SUBTYPES = ['cash', 'bank', 'clearing', 'receivable', 'payable', 'tax', 'contra_income'] as const;
export type AccountSubtype = (typeof ACCOUNT_SUBTYPES)[number];
export const MONEY_SUBTYPES: readonly AccountSubtype[] = ['cash', 'bank', 'clearing'];

export interface SystemAccount {
  key: string;
  code: string;
  name: string;
  type: AccountType;
  subtype?: AccountSubtype;
  description: string;
}

/**
 * The chart every consultancy starts with. A consultancy can rename these,
 * add its own (another bank account, an expense heading) and switch unused
 * ones off; the keys are how the system finds the ones it posts to.
 */
export const SYSTEM_ACCOUNTS: SystemAccount[] = [
  { key: 'cash', code: '1000', name: 'Cash in hand', type: 'asset', subtype: 'cash', description: 'Cash received at the office and not yet banked.' },
  { key: 'bank', code: '1010', name: 'Bank account', type: 'asset', subtype: 'bank', description: 'The main business bank account.' },
  { key: 'online', code: '1020', name: 'Online payments', type: 'asset', subtype: 'clearing', description: 'Card and wallet payments (Stripe, JazzCash, Easypaisa) until they are paid out to the bank.' },
  { key: 'receivable', code: '1100', name: 'Accounts receivable', type: 'asset', subtype: 'receivable', description: 'What students owe on issued invoices.' },
  { key: 'commission_receivable', code: '1150', name: 'Commissions receivable', type: 'asset', description: 'What universities owe in commission.' },
  { key: 'disbursements', code: '1200', name: 'Disbursements recoverable', type: 'asset', description: 'Fees paid on a student’s behalf (application, visa, university) and invoiced back to them. Never revenue.' },
  { key: 'partner_advances', code: '1300', name: 'Advances to partners', type: 'asset', description: 'Money paid to partners ahead of the commission it will be set against.' },
  { key: 'payable', code: '2000', name: 'Accounts payable', type: 'liability', subtype: 'payable', description: 'Bills received and not yet paid.' },
  { key: 'tax_payable', code: '2100', name: 'Sales tax payable', type: 'liability', subtype: 'tax', description: 'Tax charged on invoices, owed to the tax authority.' },
  { key: 'partner_payable', code: '2200', name: 'Partner commissions payable', type: 'liability', description: 'Commission earned by partners and not yet paid out.' },
  { key: 'withholding_payable', code: '2300', name: 'Withholding tax payable', type: 'liability', description: 'Tax withheld from partner payouts, owed to the tax authority.' },
  { key: 'equity', code: '3000', name: 'Owner’s equity', type: 'equity', description: 'Money the owners put in or took out.' },
  { key: 'retained', code: '3100', name: 'Retained earnings', type: 'equity', description: 'Profit kept from earlier periods.' },
  { key: 'fees_service', code: '4000', name: 'Consultancy fees', type: 'income', description: 'Counselling, application and visa service packages.' },
  { key: 'fees_course', code: '4010', name: 'Course fees', type: 'income', description: 'IELTS, PTE and other test preparation and language courses.' },
  { key: 'fees_application', code: '4020', name: 'Application handling fees', type: 'income', description: 'The consultancy’s own fee for handling applications.' },
  { key: 'fees_visa', code: '4030', name: 'Visa service fees', type: 'income', description: 'The consultancy’s own fee for visa filing.' },
  { key: 'commission_income', code: '4100', name: 'University commissions', type: 'income', description: 'Commission earned from universities.' },
  { key: 'late_fees', code: '4200', name: 'Late payment fees', type: 'income', description: 'Fees charged on overdue invoices.' },
  { key: 'other_income', code: '4300', name: 'Other income', type: 'income', description: 'Anything else that comes in.' },
  { key: 'sales_returns', code: '4900', name: 'Discounts and credit notes', type: 'income', subtype: 'contra_income', description: 'Revenue given back through credit notes. Reduces income.' },
  { key: 'partner_commission', code: '5000', name: 'Partner commissions', type: 'expense', description: 'Commission owed to sub-agents and referral partners.' },
  { key: 'salaries', code: '5100', name: 'Salaries and wages', type: 'expense', description: '' },
  { key: 'staff_incentives', code: '5150', name: 'Staff incentives', type: 'expense', description: 'Consultants’ shares of the commissions they bring in.' },
  { key: 'rent', code: '5200', name: 'Rent and utilities', type: 'expense', description: '' },
  { key: 'marketing', code: '5300', name: 'Marketing and advertising', type: 'expense', description: '' },
  { key: 'software', code: '5400', name: 'Software and subscriptions', type: 'expense', description: '' },
  { key: 'travel', code: '5500', name: 'Travel and events', type: 'expense', description: '' },
  { key: 'bank_charges', code: '5600', name: 'Bank and payment charges', type: 'expense', description: 'Bank fees, card and gateway charges.' },
  { key: 'office', code: '5700', name: 'Office and supplies', type: 'expense', description: '' },
  { key: 'professional', code: '5800', name: 'Professional fees', type: 'expense', description: 'Accountants, lawyers, translators.' },
  { key: 'fx_differences', code: '5850', name: 'Exchange differences', type: 'expense', description: 'Gains and losses when money arrives at a different rate than booked.' },
  { key: 'cash_over_short', code: '5880', name: 'Cash over and short', type: 'expense', description: 'Differences found when the cash is counted.' },
  { key: 'bad_debts', code: '5890', name: 'Bad debts written off', type: 'expense', description: 'Commission or fees given up on as uncollectable.' },
  { key: 'other_expense', code: '5900', name: 'Other expenses', type: 'expense', description: '' },
];

/* ------------------------------------------------------------------ */
/* What is being charged for                                           */
/* ------------------------------------------------------------------ */

/**
 * The kind of each invoice line, which decides where it is booked. A
 * disbursement is money the consultancy pays to someone else on the
 * student's behalf (an application fee, a visa fee, a deposit) and recovers
 * from them: it is invoiced and tracked, but it is never revenue.
 */
export const FEE_CATEGORIES = ['service', 'course', 'application', 'visa', 'disbursement', 'late_fee', 'other'] as const;
export type FeeCategory = (typeof FEE_CATEGORIES)[number];
export const FEE_CATEGORY_LABEL: Record<FeeCategory, string> = {
  service: 'Consultancy service',
  course: 'Course / test preparation',
  application: 'Application handling',
  visa: 'Visa service',
  disbursement: 'Paid on the student’s behalf',
  late_fee: 'Late payment fee',
  other: 'Other',
};
export const FEE_CATEGORY_ACCOUNT: Record<FeeCategory, string> = {
  service: 'fees_service',
  course: 'fees_course',
  application: 'fees_application',
  visa: 'fees_visa',
  disbursement: 'disbursements',
  late_fee: 'late_fees',
  other: 'other_income',
};

/** Where money paid by each method lands, unless someone picks an account. */
export const METHOD_ACCOUNT: Record<PaymentMethod, string> = {
  cash: 'cash',
  bank_transfer: 'bank',
  cheque: 'bank',
  card: 'online',
  online: 'online',
  other: 'bank',
};

/* ------------------------------------------------------------------ */
/* Taxes                                                               */
/* ------------------------------------------------------------------ */

export const taxRateSchema = z.object({
  name: z.string().trim().min(2, 'Name the tax, e.g. Sindh sales tax').max(60),
  /** Percent, e.g. 13 or 7.5; stored as basis points. */
  ratePercent: z.coerce.number().min(0).max(100),
  /** Prices already include it (it is taken out of them, not added on top). */
  inclusive: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  active: z.boolean().default(true),
});
export type TaxRateInput = z.input<typeof taxRateSchema>;

export interface TaxRateView {
  id: string;
  name: string;
  rateBp: number;
  ratePercent: number;
  inclusive: boolean;
  isDefault: boolean;
  active: boolean;
}

/* ------------------------------------------------------------------ */
/* The arithmetic of a bill                                             */
/* ------------------------------------------------------------------ */

export interface LineInput {
  quantity: number;
  unitAmount: number;
  /** Discount on this line, in minor units. */
  discount?: number;
  /** The tax on this line, if any. */
  tax?: { rateBp: number; inclusive: boolean } | null;
}

export interface LineResult {
  /** quantity x unit price. */
  amount: number;
  /** Line discount plus its share of the promotion. */
  discount: number;
  /** Tax on the line, whether added on top or contained in the price. */
  tax: number;
  /** What the consultancy keeps: after discount, without any tax. */
  net: number;
  /** What the line adds to the invoice total. */
  total: number;
}

export interface Totals {
  lines: LineResult[];
  /** Sum of quantity x unit price. */
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
}

/**
 * Lines, discounts, an invoice-wide promotion and tax, worked out once, in
 * minor units, with the rounding written down - so the form, the PDF, the
 * invoice row and the journal all show the same number.
 *
 * The promotion is shared over the lines in proportion to what is left of
 * each after its own discount (the last line takes the rounding), so the
 * tax on each line is charged on what the student really pays for it.
 */
export function computeTotals(lines: LineInput[], promo?: { kind: PromoKind; value: number } | null): Totals {
  const gross = lines.map((l) => Math.max(0, Math.round(l.quantity * l.unitAmount)));
  const own = lines.map((l, i) => Math.min(gross[i]!, Math.max(0, Math.round(l.discount ?? 0))));
  const after = gross.map((g, i) => g - own[i]!);
  const base = after.reduce((n, v) => n + v, 0);
  let promoTotal = 0;
  if (promo && base > 0) {
    promoTotal = promo.kind === 'percent' ? Math.round((base * promo.value) / 10_000) : Math.min(base, promo.value);
  }
  const shares = after.map(() => 0);
  if (promoTotal > 0) {
    let given = 0;
    const last = after.reduce((best, v, i) => (v > (after[best] ?? 0) ? i : best), 0);
    after.forEach((v, i) => {
      if (i === last) return;
      const s = Math.floor((promoTotal * v) / base);
      shares[i] = s;
      given += s;
    });
    shares[last] = promoTotal - given;
  }
  const results = lines.map((l, i): LineResult => {
    const discount = own[i]! + shares[i]!;
    const priced = gross[i]! - discount;
    let tax = 0;
    let net = priced;
    let total = priced;
    if (l.tax && l.tax.rateBp > 0 && priced > 0) {
      if (l.tax.inclusive) {
        net = Math.round((priced * 10_000) / (10_000 + l.tax.rateBp));
        tax = priced - net;
      } else {
        tax = Math.round((priced * l.tax.rateBp) / 10_000);
        total = priced + tax;
      }
    }
    return { amount: gross[i]!, discount, tax, net, total };
  });
  return {
    lines: results,
    subtotal: gross.reduce((n, v) => n + v, 0),
    discount: results.reduce((n, r) => n + r.discount, 0),
    tax: results.reduce((n, r) => n + r.tax, 0),
    total: results.reduce((n, r) => n + r.total, 0),
  };
}

/** Basis points from a percent typed by a person: 7.5 -> 750. */
export const percentToBp = (p: number): number => Math.round(p * 100);
export const bpToPercent = (bp: number): number => bp / 100;

/* ------------------------------------------------------------------ */
/* Promotions                                                          */
/* ------------------------------------------------------------------ */

export const PROMO_KINDS = ['percent', 'fixed'] as const;
export type PromoKind = (typeof PROMO_KINDS)[number];

export const promoCodeSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9][A-Z0-9_-]{2,23}$/, '3-24 letters, numbers, - or _'),
    description: optionalText(200),
    kind: z.enum(PROMO_KINDS),
    /** Percent (for `percent`) or a major-unit amount (for `fixed`). */
    value: z.coerce.number().positive('Above zero'),
    currency: currencySchema.optional().nullable(),
    validFrom: dateOnlySchema.optional().nullable(),
    validTo: dateOnlySchema.optional().nullable(),
    maxUses: z.coerce.number().int().min(1).max(100_000).optional().nullable(),
    active: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'percent' && v.value > 100) ctx.addIssue({ code: 'custom', path: ['value'], message: 'At most 100%' });
    if (v.kind === 'fixed' && !v.currency) ctx.addIssue({ code: 'custom', path: ['currency'], message: 'A fixed discount needs a currency' });
    if (v.validFrom && v.validTo && v.validTo < v.validFrom) ctx.addIssue({ code: 'custom', path: ['validTo'], message: 'Ends before it starts' });
  });
export type PromoCodeInput = z.input<typeof promoCodeSchema>;

export interface PromoCodeView {
  id: string;
  code: string;
  description: string | null;
  kind: PromoKind;
  /** Basis points for percent, minor units for fixed. */
  value: number;
  currency: Currency | null;
  validFrom: string | null;
  validTo: string | null;
  maxUses: number | null;
  uses: number;
  active: boolean;
}

export function describePromo(p: Pick<PromoCodeView, 'kind' | 'value' | 'currency'>): string {
  return p.kind === 'percent' ? `${bpToPercent(p.value)}% off` : `${formatMoney(p.value, p.currency ?? 'PKR')} off`;
}

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */

export const LATE_FEE_KINDS = ['none', 'fixed', 'percent'] as const;
export type LateFeeKind = (typeof LATE_FEE_KINDS)[number];

export const GATEWAY_PROVIDERS = ['none', 'stripe', 'test'] as const;
export type GatewayProvider = (typeof GATEWAY_PROVIDERS)[number];
export const GATEWAY_LABEL: Record<GatewayProvider, string> = {
  none: 'Off - students pay by transfer or in person',
  stripe: 'Stripe (cards)',
  test: 'Test mode (simulated payments, never in production)',
};

export const financeSettingsSchema = z.object({
  baseCurrency: currencySchema,
  /** Printed on invoices: account title, IBAN, branch. */
  bankDetails: optionalText(600),
  /** Printed at the foot of invoices and quotes. */
  invoiceTerms: optionalText(1000),
  /** Invoices with a discount above this share wait for approval. Null: never. */
  discountApprovalPercent: z.coerce.number().min(0).max(100).nullable().default(null),
  /** Managers may record a refund straight away; off, every refund is requested and approved. */
  directRefunds: z.boolean().default(true),
  lateFeeKind: z.enum(LATE_FEE_KINDS).default('none'),
  /** Major units for `fixed`, percent for `percent`. */
  lateFeeValue: z.coerce.number().min(0).max(1_000_000).default(0),
  lateFeeGraceDays: z.coerce.number().int().min(0).max(365).default(7),
  /** Days from the due date to remind on: -3 is three days before, 7 a week late. */
  reminderOffsets: z.array(z.coerce.number().int().min(-60).max(180)).max(8).default([-3, 0, 7, 14]),
});
export type FinanceSettingsInput = z.input<typeof financeSettingsSchema>;

export interface FinanceSettingsView {
  baseCurrency: Currency;
  bankDetails: string | null;
  invoiceTerms: string | null;
  discountApprovalPercent: number | null;
  directRefunds: boolean;
  lateFeeKind: LateFeeKind;
  /** Minor units for fixed, basis points for percent. */
  lateFeeValue: number;
  lateFeeGraceDays: number;
  reminderOffsets: number[];
  lockedThrough: string | null;
  gateway: {
    provider: GatewayProvider;
    /** Whether the secret key and webhook secret are stored - never the keys themselves. */
    stripeConfigured: boolean;
    stripePublishableKey: string | null;
    webhookUrl: string | null;
    testAllowed: boolean;
  };
}

export const gatewaySettingsSchema = z
  .object({
    provider: z.enum(GATEWAY_PROVIDERS),
    stripeSecretKey: z.string().trim().max(200).optional(),
    stripeWebhookSecret: z.string().trim().max(200).optional(),
    stripePublishableKey: z.string().trim().max(200).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.stripeSecretKey && !/^(sk|rk)_(test|live)_[A-Za-z0-9]+$/.test(v.stripeSecretKey)) {
      ctx.addIssue({ code: 'custom', path: ['stripeSecretKey'], message: 'A Stripe secret key starts sk_test_ or sk_live_' });
    }
    if (v.stripeWebhookSecret && !/^whsec_[A-Za-z0-9]+$/.test(v.stripeWebhookSecret)) {
      ctx.addIssue({ code: 'custom', path: ['stripeWebhookSecret'], message: 'A webhook signing secret starts whsec_' });
    }
  });
export type GatewaySettingsInput = z.input<typeof gatewaySettingsSchema>;

export const periodLockSchema = z.object({
  /** Nothing dated on or before this day can be posted or changed. Null unlocks. */
  through: dateOnlySchema.nullable(),
});
export type PeriodLockInput = z.input<typeof periodLockSchema>;

/* ------------------------------------------------------------------ */
/* Installments                                                        */
/* ------------------------------------------------------------------ */

export const installmentPlanSchema = z.object({
  installments: z
    .array(
      z.object({
        dueDate: dateOnlySchema,
        amount: positiveMinor,
        label: optionalText(80),
      }),
    )
    .min(1)
    .max(24)
    .superRefine((list, ctx) => {
      list.forEach((x, i) => {
        if (i > 0 && x.dueDate < list[i - 1]!.dueDate) {
          ctx.addIssue({ code: 'custom', path: [i, 'dueDate'], message: 'Due dates must not go backwards' });
        }
      });
    }),
});
export type InstallmentPlanInput = z.input<typeof installmentPlanSchema>;

export type InstallmentStatus = 'paid' | 'partial' | 'due' | 'overdue';
export const INSTALLMENT_STATUS_LABEL: Record<InstallmentStatus, string> = {
  paid: 'Paid',
  partial: 'Part paid',
  due: 'Due',
  overdue: 'Overdue',
};

export interface InstallmentView {
  id: string;
  seq: number;
  label: string | null;
  dueDate: string;
  amount: number;
  /** What has been applied to it, earliest installment first. */
  paid: number;
  status: InstallmentStatus;
  lateFeeInvoiceId: string | null;
}

/**
 * Applies what has been paid (and credited) to the installments in due-date
 * order: the first is settled before anything counts towards the second.
 */
export function allocateInstallments<T extends { dueDate: string; amount: number }>(
  installments: T[],
  settled: number,
  today: string,
): (T & { paid: number; status: InstallmentStatus })[] {
  let left = Math.max(0, settled);
  return installments.map((i) => {
    const paid = Math.min(i.amount, left);
    left -= paid;
    const status: InstallmentStatus =
      paid >= i.amount ? 'paid' : i.dueDate < today ? 'overdue' : paid > 0 ? 'partial' : 'due';
    return { ...i, paid, status };
  });
}

/** An even split, the remainder on the first installment, due a month apart. */
export function splitInstallments(total: number, count: number, firstDue: string, everyMonths = 1): { dueDate: string; amount: number }[] {
  const n = Math.max(1, Math.min(24, Math.floor(count)));
  const each = Math.floor(total / n);
  const first = total - each * (n - 1);
  const start = new Date(`${firstDue}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i * everyMonths, start.getUTCDate()));
    // 31 January + 1 month is the last day of February, not 3 March.
    if (d.getUTCDate() !== start.getUTCDate()) d.setUTCDate(0);
    return { dueDate: d.toISOString().slice(0, 10), amount: i === 0 ? first : each };
  });
}

/* ------------------------------------------------------------------ */
/* Credit notes                                                         */
/* ------------------------------------------------------------------ */

export const creditNoteSchema = z.object({
  /** Including any tax it gives back. */
  amount: positiveMinor,
  reason: reasonSchema,
  issuedOn: dateOnlySchema.optional(),
});
export type CreditNoteInput = z.input<typeof creditNoteSchema>;

export interface CreditNoteView {
  id: string;
  number: string;
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  amount: number;
  taxAmount: number;
  currency: Currency;
  reason: string;
  issuedOn: string;
  createdByName: string | null;
  voided: boolean;
  voidReason: string | null;
}

/* ------------------------------------------------------------------ */
/* Quotes                                                               */
/* ------------------------------------------------------------------ */

export const QUOTE_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired', 'converted'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];
export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  declined: 'Declined',
  expired: 'Expired',
  converted: 'Invoiced',
};
export const QUOTE_STATUS_TONE: Record<QuoteStatus, 'ok' | 'warn' | 'bad' | 'neutral' | 'info'> = {
  draft: 'neutral',
  sent: 'info',
  accepted: 'ok',
  declined: 'bad',
  expired: 'neutral',
  converted: 'ok',
};

export const billLineSchema = z.object({
  description: z.string().trim().min(2, 'Describe the charge').max(200),
  packageId: uuidSchema.optional().nullable(),
  quantity: z.coerce.number().int().min(1).max(100).default(1),
  unitAmount: minor,
  category: z.enum(FEE_CATEGORIES).optional(),
  taxRateId: uuidSchema.optional().nullable(),
  /** Discount on this line, minor units. */
  discount: minor.optional(),
});
export type BillLineInput = z.input<typeof billLineSchema>;

export const quoteSchema = z.object({
  clientId: uuidSchema,
  caseId: uuidSchema.optional().nullable(),
  currency: currencySchema.default('PKR'),
  issueDate: dateOnlySchema.optional(),
  validUntil: dateOnlySchema,
  items: z.array(billLineSchema).min(1, 'Add at least one line').max(30),
  promoCode: z.string().trim().toUpperCase().max(24).optional().nullable(),
  notes: optionalText(1000),
  /** Proforma: a quote laid out as an invoice, for a bank or an embassy. */
  proforma: z.boolean().default(false),
  /** Send it to the student now; otherwise it stays a draft. */
  send: z.boolean().default(true),
});
export type QuoteInput = z.input<typeof quoteSchema>;

export const quoteDecisionSchema = z.object({ note: optionalText(500) });
export const convertQuoteSchema = z.object({
  dueDate: dateOnlySchema,
  installments: installmentPlanSchema.shape.installments.optional(),
});
export type ConvertQuoteInput = z.input<typeof convertQuoteSchema>;

export interface PricedLineView {
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  discount: number;
  taxRateName: string | null;
  taxRateBp: number;
  taxInclusive: boolean;
  tax: number;
  total: number;
  category: FeeCategory;
}

export interface QuoteView {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  clientEmail: string | null;
  caseId: string | null;
  caseReference: string | null;
  currency: Currency;
  issueDate: string;
  validUntil: string;
  status: QuoteStatus;
  proforma: boolean;
  items: PricedLineView[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  promoCode: string | null;
  notes: string | null;
  invoiceId: string | null;
  invoiceNumber: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  createdByName: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Students' proof of payment                                           */
/* ------------------------------------------------------------------ */

export const SUBMISSION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

/** Multipart text fields, so numbers arrive as strings. */
export const submitPaymentSchema = z.object({
  amount: positiveMinor,
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(120),
  paidOn: dateOnlySchema,
  note: optionalText(500),
});
export type SubmitPaymentInput = z.input<typeof submitPaymentSchema>;

export const reviewSubmissionSchema = z
  .object({
    approve: z.boolean(),
    /** What actually arrived, when it differs from what the student typed. */
    amount: positiveMinor.optional(),
    receivedOn: dateOnlySchema.optional(),
    accountId: uuidSchema.optional().nullable(),
    note: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (!v.approve && (!v.note || v.note.length < 5)) {
      ctx.addIssue({ code: 'custom', path: ['note'], message: 'Tell the student what is wrong, so they can fix it' });
    }
  });
export type ReviewSubmissionInput = z.input<typeof reviewSubmissionSchema>;

export interface PaymentSubmissionView {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  reference: string | null;
  paidOn: string;
  note: string | null;
  status: SubmissionStatus;
  documentId: string | null;
  fileName: string | null;
  reviewNote: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  paymentId: string | null;
  receiptNumber: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Paying online                                                        */
/* ------------------------------------------------------------------ */

export const ONLINE_PAYMENT_STATUSES = ['created', 'paid', 'failed', 'cancelled', 'expired'] as const;
export type OnlinePaymentStatus = (typeof ONLINE_PAYMENT_STATUSES)[number];

export const startOnlinePaymentSchema = z.object({
  /** `next`: the next installment due; `balance`: everything owed. */
  what: z.enum(['next', 'balance']).default('balance'),
});
export type StartOnlinePaymentInput = z.input<typeof startOnlinePaymentSchema>;

export interface OnlinePaymentView {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  amount: number;
  currency: Currency;
  provider: GatewayProvider;
  status: OnlinePaymentStatus;
  url: string | null;
  paymentId: string | null;
  receiptNumber: string | null;
  createdAt: string;
  completedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* Refunds                                                              */
/* ------------------------------------------------------------------ */

export const REFUND_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
export const REFUND_STATUS_TONE: Record<RefundStatus, 'ok' | 'warn' | 'bad' | 'neutral'> = {
  pending: 'warn',
  approved: 'ok',
  rejected: 'bad',
  cancelled: 'neutral',
};

export const refundRequestSchema = z.object({
  amount: positiveMinor,
  method: z.enum(PAYMENT_METHODS),
  accountId: uuidSchema.optional().nullable(),
  reason: reasonSchema,
});
export type RefundRequestInput = z.input<typeof refundRequestSchema>;

export const decideSchema = z
  .object({ approve: z.boolean(), note: optionalText(500) })
  .superRefine((v, ctx) => {
    if (!v.approve && (!v.note || v.note.length < 5)) ctx.addIssue({ code: 'custom', path: ['note'], message: 'Say why it is turned down' });
  });
export type DecideInput = z.input<typeof decideSchema>;

export interface RefundRequestView {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  clientId: string;
  clientName: string;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  reason: string;
  status: RefundStatus;
  requestedById: string | null;
  requestedByName: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  paymentId: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Approvals                                                            */
/* ------------------------------------------------------------------ */

export const approveInvoiceSchema = z.object({ note: optionalText(500) });
export const rejectInvoiceSchema = z.object({ reason: reasonSchema });

/* ------------------------------------------------------------------ */
/* Expenses and bills                                                   */
/* ------------------------------------------------------------------ */

export const expenseSchema = z.object({
  spentOn: dateOnlySchema,
  /** The expense heading (an expense account), or Disbursements for money paid on a student's behalf. */
  accountId: uuidSchema,
  vendor: z.string().trim().min(2, 'Who was paid?').max(120),
  description: z.string().trim().min(2, 'What was it for?').max(300),
  amount: positiveMinor,
  /** Recoverable tax included in the amount, if any. */
  taxAmount: minor.default(0),
  currency: currencySchema,
  fxRate: fxRateSchema,
  paidFromAccountId: uuidSchema,
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(120),
  /** For a disbursement: whose behalf it was paid on. */
  clientId: uuidSchema.optional().nullable(),
  caseId: uuidSchema.optional().nullable(),
});
export type ExpenseInput = z.input<typeof expenseSchema>;

export interface ExpenseView {
  id: string;
  number: string;
  spentOn: string;
  accountId: string;
  accountName: string;
  vendor: string;
  description: string;
  amount: number;
  taxAmount: number;
  currency: Currency;
  fxRate: number | null;
  paidFromAccountId: string;
  paidFromName: string;
  method: PaymentMethod;
  reference: string | null;
  clientId: string | null;
  clientName: string | null;
  hasReceipt: boolean;
  receiptName: string | null;
  recordedByName: string | null;
  voided: boolean;
  voidReason: string | null;
  createdAt: string;
}

export const BILL_STATUSES = ['open', 'paid', 'void'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];

export const billSchema = z
  .object({
    vendor: z.string().trim().min(2, 'Who sent the bill?').max(120),
    vendorReference: optionalText(80),
    issueDate: dateOnlySchema,
    dueDate: dateOnlySchema,
    accountId: uuidSchema,
    description: z.string().trim().min(2, 'What is it for?').max(300),
    amount: positiveMinor,
    taxAmount: minor.default(0),
    currency: currencySchema,
    fxRate: fxRateSchema,
  })
  .superRefine((v, ctx) => {
    if (v.dueDate < v.issueDate) ctx.addIssue({ code: 'custom', path: ['dueDate'], message: 'Due before it was issued' });
  });
export type BillInput = z.input<typeof billSchema>;

export const payBillSchema = z.object({
  paidOn: dateOnlySchema,
  paidFromAccountId: uuidSchema,
  method: z.enum(PAYMENT_METHODS),
  reference: optionalText(120),
});
export type PayBillInput = z.input<typeof payBillSchema>;

export interface BillView {
  id: string;
  number: string;
  vendor: string;
  vendorReference: string | null;
  issueDate: string;
  dueDate: string;
  accountId: string;
  accountName: string;
  description: string;
  amount: number;
  taxAmount: number;
  currency: Currency;
  status: BillStatus;
  overdue: boolean;
  paidOn: string | null;
  paidFromName: string | null;
  reference: string | null;
  voidReason: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Ledger                                                               */
/* ------------------------------------------------------------------ */

export const ledgerAccountSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{3,6}$/, '3-6 digits, e.g. 1015'),
  name: z.string().trim().min(2, 'Name the account').max(80),
  type: z.enum(ACCOUNT_TYPES),
  subtype: z.enum(ACCOUNT_SUBTYPES).nullable().optional(),
  /** For a bank or cash account held in one currency. */
  currency: currencySchema.nullable().optional(),
  description: optionalText(300),
  active: z.boolean().default(true),
});
export type LedgerAccountInput = z.input<typeof ledgerAccountSchema>;

export interface AccountBalance {
  currency: Currency;
  debit: number;
  credit: number;
  /** In the account's normal direction: positive is an asset held, income earned... */
  balance: number;
}

export interface LedgerAccountView {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  subtype: AccountSubtype | null;
  currency: Currency | null;
  description: string | null;
  systemKey: string | null;
  active: boolean;
  balances: AccountBalance[];
}

export const journalLineSchema = z
  .object({
    accountId: uuidSchema,
    debit: minor.default(0),
    credit: minor.default(0),
    description: optionalText(200),
  })
  .superRefine((v, ctx) => {
    if ((v.debit > 0) === (v.credit > 0)) ctx.addIssue({ code: 'custom', path: ['debit'], message: 'Either a debit or a credit' });
  });

export const manualJournalSchema = z
  .object({
    entryDate: dateOnlySchema,
    memo: z.string().trim().min(3, 'Explain the entry').max(300),
    currency: currencySchema,
    fxRate: fxRateSchema,
    lines: z.array(journalLineSchema).min(2, 'At least two lines').max(40),
  })
  .superRefine((v, ctx) => {
    const d = v.lines.reduce((n, l) => n + (l.debit ?? 0), 0);
    const c = v.lines.reduce((n, l) => n + (l.credit ?? 0), 0);
    if (d !== c) ctx.addIssue({ code: 'custom', path: ['lines'], message: `Debits (${d / 100}) and credits (${c / 100}) must be equal` });
  });
export type ManualJournalInput = z.input<typeof manualJournalSchema>;

export const JOURNAL_SOURCES = [
  'invoice',
  'invoice_void',
  'payment',
  'payment_void',
  'credit_note',
  'credit_note_void',
  'expense',
  'expense_void',
  'bill',
  'bill_payment',
  'bill_void',
  'manual',
  'reversal',
  'bank',
  'cash_count',
  'commission',
  'commission_receipt',
  'incentive',
  'payout',
  'partner_earning',
  'partner_advance',
  'opening',
] as const;
export type JournalSource = (typeof JOURNAL_SOURCES)[number];
export const JOURNAL_SOURCE_LABEL: Record<JournalSource, string> = {
  invoice: 'Invoice',
  invoice_void: 'Invoice voided',
  payment: 'Payment',
  payment_void: 'Payment voided',
  credit_note: 'Credit note',
  credit_note_void: 'Credit note voided',
  expense: 'Expense',
  expense_void: 'Expense voided',
  bill: 'Bill',
  bill_payment: 'Bill paid',
  bill_void: 'Bill voided',
  manual: 'Manual entry',
  reversal: 'Reversal',
  bank: 'From bank statement',
  cash_count: 'Cash count',
  commission: 'Commission',
  commission_receipt: 'Commission received',
  incentive: 'Staff incentive paid',
  payout: 'Partner payout',
  partner_earning: 'Partner earning',
  partner_advance: 'Advance to a partner',
  opening: 'Opening balance',
};

export interface JournalLineView {
  id: string;
  accountId: string;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string | null;
  clientName: string | null;
}

export interface JournalEntryView {
  id: string;
  number: string;
  entryDate: string;
  memo: string;
  currency: Currency;
  fxRate: number | null;
  sourceType: JournalSource;
  sourceId: string | null;
  reversalOfId: string | null;
  reversedById: string | null;
  createdByName: string | null;
  createdAt: string;
  total: number;
  lines: JournalLineView[];
}

export const journalQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  accountId: uuidSchema.optional(),
  sourceType: z.enum(JOURNAL_SOURCES).optional(),
  currency: currencySchema.optional(),
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});
export type JournalQuery = z.output<typeof journalQuerySchema>;

export interface GeneralLedgerRow {
  lineId: string;
  entryId: string;
  entryNumber: string;
  entryDate: string;
  memo: string;
  sourceType: JournalSource;
  description: string | null;
  debit: number;
  credit: number;
  /** After this line, in the account's normal direction. */
  running: number;
  reconciled: boolean;
}

export interface GeneralLedgerView {
  account: LedgerAccountView;
  currency: Currency;
  from: string;
  to: string;
  opening: number;
  closing: number;
  rows: GeneralLedgerRow[];
  /** More lines than shown in the period. */
  truncated: boolean;
}

/* ------------------------------------------------------------------ */
/* Bank statements                                                      */
/* ------------------------------------------------------------------ */

export const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const bankImportSchema = z
  .object({
    csv: z.string().min(10, 'The file looks empty').max(2_000_000, 'Import at most 2 MB at a time'),
    fileName: z.string().trim().max(200).default('statement.csv'),
    dateColumn: z.coerce.number().int().min(0).max(50),
    descriptionColumn: z.coerce.number().int().min(0).max(50),
    /** One signed amount column, or separate money-out and money-in columns. */
    amountColumn: z.coerce.number().int().min(0).max(50).nullable().optional(),
    debitColumn: z.coerce.number().int().min(0).max(50).nullable().optional(),
    creditColumn: z.coerce.number().int().min(0).max(50).nullable().optional(),
    referenceColumn: z.coerce.number().int().min(0).max(50).nullable().optional(),
    dateFormat: z.enum(DATE_FORMATS).default('YYYY-MM-DD'),
    hasHeader: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    const single = v.amountColumn !== null && v.amountColumn !== undefined;
    const split = v.debitColumn !== null && v.debitColumn !== undefined && v.creditColumn !== null && v.creditColumn !== undefined;
    if (!single && !split) ctx.addIssue({ code: 'custom', path: ['amountColumn'], message: 'Pick the amount column, or the money-out and money-in columns' });
  });
export type BankImportInput = z.input<typeof bankImportSchema>;

/** RFC 4180-ish: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

function parseStatementDate(raw: string, format: DateFormat): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  if (format === 'YYYY-MM-DD') {
    const r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
    if (!r) return null;
    [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  } else {
    const r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
    if (!r) return null;
    const a = Number(r[1]);
    const b = Number(r[2]);
    y = Number(r[3]);
    if (y < 100) y += 2000;
    [d, m] = format === 'DD/MM/YYYY' ? [a, b] : [b, a];
  }
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** "1,250.50", "(300.00)", "-75" -> signed minor units. */
function parseStatementAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw.trim().replace(/[,\s]/g, '').replace(/^[A-Za-z$£€₨]+/, '');
  if (!s) return 0;
  let sign = 1;
  if (/^\(.*\)$/.test(s)) {
    sign = -1;
    s = s.slice(1, -1);
  }
  if (s.endsWith('-')) {
    sign = -1;
    s = s.slice(0, -1);
  }
  if (s.toUpperCase().endsWith('DR')) {
    sign = -1;
    s = s.slice(0, -2);
  } else if (s.toUpperCase().endsWith('CR')) s = s.slice(0, -2);
  if (!/^-?\d+(\.\d{1,4})?$/.test(s)) return null;
  return sign * Math.round(Number(s) * 100);
}

export interface ParsedBankLine {
  row: number;
  date: string;
  description: string;
  /** Positive is money in, negative money out. */
  amount: number;
  reference: string | null;
}

export function parseBankStatement(input: z.output<typeof bankImportSchema>): { lines: ParsedBankLine[]; errors: { row: number; message: string }[] } {
  const rows = parseCsv(input.csv);
  const body = input.hasHeader ? rows.slice(1) : rows;
  const offset = input.hasHeader ? 2 : 1;
  const lines: ParsedBankLine[] = [];
  const errors: { row: number; message: string }[] = [];
  body.forEach((cells, i) => {
    const row = i + offset;
    const date = parseStatementDate(cells[input.dateColumn] ?? '', input.dateFormat);
    if (!date) {
      errors.push({ row, message: `“${cells[input.dateColumn] ?? ''}” is not a ${input.dateFormat} date` });
      return;
    }
    let amount: number | null;
    if (input.amountColumn !== null && input.amountColumn !== undefined) {
      amount = parseStatementAmount(cells[input.amountColumn]);
    } else {
      const out = parseStatementAmount(cells[input.debitColumn!]);
      const inn = parseStatementAmount(cells[input.creditColumn!]);
      amount = out === null || inn === null ? null : Math.abs(inn) - Math.abs(out);
    }
    if (amount === null) {
      errors.push({ row, message: 'The amount is not a number' });
      return;
    }
    if (amount === 0) return;
    const ref = input.referenceColumn !== null && input.referenceColumn !== undefined ? (cells[input.referenceColumn] ?? '').trim() : '';
    lines.push({ row, date, description: (cells[input.descriptionColumn] ?? '').trim().slice(0, 300), amount, reference: ref || null });
  });
  return { lines, errors };
}

export interface BankLineView {
  id: string;
  lineDate: string;
  description: string;
  reference: string | null;
  amount: number;
  matchedLineId: string | null;
  matchedEntryNumber: string | null;
  matchedMemo: string | null;
  matchedAt: string | null;
}

export interface UnmatchedLedgerLine {
  lineId: string;
  entryNumber: string;
  entryDate: string;
  memo: string;
  /** Positive: money into the account. */
  amount: number;
}

export interface BankAccountView {
  account: LedgerAccountView;
  currency: Currency;
  /** The account's balance in the books. */
  ledgerBalance: number;
  /** Ledger balance counting only lines matched to the statement. */
  reconciledBalance: number;
  statementTotal: number;
  unmatchedBank: BankLineView[];
  unmatchedLedger: UnmatchedLedgerLine[];
  matched: BankLineView[];
  /** bank line id -> the ledger lines that look like it. */
  suggestions: Record<string, string[]>;
  imports: { id: string; fileName: string; lineCount: number; createdAt: string; importedByName: string | null }[];
}

export const matchBankLineSchema = z.object({ journalLineId: uuidSchema });
export const bankEntrySchema = z.object({
  /** The other side: bank charges, interest, owner's money... */
  accountId: uuidSchema,
  memo: z.string().trim().min(3).max(300),
});
export type BankEntryInput = z.input<typeof bankEntrySchema>;

/* ------------------------------------------------------------------ */
/* Closing the day                                                      */
/* ------------------------------------------------------------------ */

export const dayCloseSchema = z.object({
  accountId: uuidSchema,
  date: dateOnlySchema,
  currency: currencySchema,
  /** What was counted, minor units. */
  counted: minor,
  note: optionalText(500),
  /** Book any difference to "Cash over and short", so the books match the drawer. */
  postDifference: z.boolean().default(true),
});
export type DayCloseInput = z.input<typeof dayCloseSchema>;

export interface DayCloseView {
  id: string;
  date: string;
  accountId: string;
  accountName: string;
  currency: Currency;
  expected: number;
  counted: number;
  difference: number;
  note: string | null;
  closedByName: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Reports                                                              */
/* ------------------------------------------------------------------ */

export const REPORTS = ['pnl', 'balance-sheet', 'trial-balance', 'aging', 'collections', 'revenue', 'tax', 'cash-flow', 'payables'] as const;
export type ReportName = (typeof REPORTS)[number];
export const REPORT_LABEL: Record<ReportName, string> = {
  pnl: 'Profit and loss',
  'balance-sheet': 'Balance sheet',
  'trial-balance': 'Trial balance',
  aging: 'Receivables aging',
  collections: 'Collections vs dues',
  revenue: 'Revenue',
  tax: 'Tax',
  'cash-flow': 'Cash flow',
  payables: 'Payables',
};
export const REPORT_DESCRIPTION: Record<ReportName, string> = {
  pnl: 'Income less expenses for a period.',
  'balance-sheet': 'What the consultancy owns and owes on a date.',
  'trial-balance': 'Every account’s debits and credits; they always agree.',
  aging: 'What students owe, by how late it is.',
  collections: 'What fell due each month against what came in.',
  revenue: 'Income by kind of fee and by month.',
  tax: 'Tax charged on invoices and paid on bills and expenses.',
  'cash-flow': 'Money in and out of cash and bank accounts, by month.',
  payables: 'Bills still to pay, by how late they are.',
};

/** `base`: every currency converted at each entry's own rate. */
export const reportQuerySchema = z.object({
  from: dateOnlySchema.optional(),
  to: dateOnlySchema.optional(),
  currency: z.union([currencySchema, z.literal('base')]).optional(),
  format: z.enum(['json', 'csv']).default('json'),
});
export type ReportQuery = z.output<typeof reportQuerySchema>;

export interface ReportRow {
  label: string;
  /** Indent level, for sections. */
  level?: number;
  code?: string;
  accountId?: string;
  values: (number | string | null)[];
  emphasis?: boolean;
}

export interface ReportView {
  name: ReportName;
  title: string;
  subtitle: string;
  currency: Currency | 'base';
  baseCurrency: Currency;
  from: string | null;
  to: string;
  columns: string[];
  /** Which columns hold money (formatted as currency). */
  moneyColumns: number[];
  rows: ReportRow[];
  /** Entries left out of a converted report because they had no rate. */
  unconverted: number;
  /** Plain-language checks: "Debits equal credits". */
  checks: { label: string; ok: boolean }[];
}

export const exportJournalSchema = z.object({
  from: dateOnlySchema,
  to: dateOnlySchema,
  currency: currencySchema.optional(),
  format: z.enum(['csv', 'xero', 'quickbooks']).default('csv'),
});
export type ExportJournalInput = z.output<typeof exportJournalSchema>;

/* ------------------------------------------------------------------ */
/* The workspace                                                        */
/* ------------------------------------------------------------------ */

export interface AgingBuckets {
  currency: Currency;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90plus: number;
  total: number;
}

export function agingBucket(daysLate: number): keyof Omit<AgingBuckets, 'currency' | 'total'> {
  if (daysLate <= 0) return 'current';
  if (daysLate <= 30) return 'd1_30';
  if (daysLate <= 60) return 'd31_60';
  if (daysLate <= 90) return 'd61_90';
  return 'd90plus';
}

export interface FinanceOverview {
  baseCurrency: Currency;
  /** Money accounts (cash, bank, online) with their balances. */
  money: { accountId: string; name: string; subtype: AccountSubtype; balances: AccountBalance[] }[];
  receivables: AgingBuckets[];
  payablesDue: { currency: Currency; open: number; overdue: number }[];
  thisMonth: { currency: Currency; income: number; expenses: number; profit: number }[];
  queues: {
    proofsToVerify: number;
    refundsToApprove: number;
    invoicesToApprove: number;
    billsOverdue: number;
    unmatchedBankLines: number;
  };
  lockedThrough: string | null;
  recentEntries: JournalEntryView[];
}

export interface StatementLine {
  date: string;
  kind: 'invoice' | 'payment' | 'refund' | 'credit_note';
  reference: string;
  description: string;
  debit: number;
  credit: number;
  balance: number;
  link: string | null;
}

export interface StatementView {
  clientId: string;
  clientName: string;
  currency: Currency;
  currencies: Currency[];
  from: string | null;
  to: string;
  opening: number;
  closing: number;
  lines: StatementLine[];
}
