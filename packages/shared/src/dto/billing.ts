import { z } from 'zod';
import {
  CURRENCIES,
  PAYMENT_KINDS,
  PAYMENT_METHODS,
  type Currency,
  type InvoiceStatus,
  type PaymentKind,
  type PaymentMethod,
  type PaymentStatus,
} from '../billing';
import {
  FEE_CATEGORIES,
  billLineSchema,
  installmentPlanSchema,
  type CreditNoteView,
  type FeeCategory,
  type InstallmentView,
  type PaymentSubmissionView,
  type RefundRequestView,
} from '../finance';
import { dateOnlySchema } from '../profile';
import { uuidSchema } from './common';

/**
 * Invoices and the payments ledger.
 *
 * The consultancy's own fees are revenue. Money it pays to a university or
 * an embassy on a student's behalf and invoices back - an application fee, a
 * visa fee - is a *disbursement*: invoiced and tracked like any other line,
 * but booked to "Disbursements recoverable", never to revenue (see
 * finance.ts). Tuition the student pays the university directly never
 * passes through here at all.
 *
 * The ledger is append-only. An invoice's lines are fixed once issued, a
 * payment is never edited, and a mistake is corrected by voiding the entry
 * or issuing a credit note - with a reason - so the original stays on the
 * record.
 */

const minorAmount = z.coerce
  .number()
  .int('Amounts are in whole minor units')
  .min(0)
  .max(100_000_000_00);

export const servicePackageSchema = z.object({
  name: z.string().trim().min(2, 'Name the package').max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  amount: minorAmount,
  currency: z.enum(CURRENCIES).default('PKR'),
  active: z.boolean().default(true),
  /** What kind of fee it is, which decides where it is booked. */
  category: z.enum(FEE_CATEGORIES).default('service'),
  /** Tax charged on it by default. */
  taxRateId: uuidSchema.nullable().optional(),
});
export type ServicePackageInput = z.infer<typeof servicePackageSchema>;

export const createInvoiceSchema = z.object({
  clientId: uuidSchema,
  caseId: uuidSchema.optional(),
  currency: z.enum(CURRENCIES).default('PKR'),
  issueDate: dateOnlySchema.optional(),
  dueDate: dateOnlySchema,
  items: z.array(billLineSchema).min(1, 'Add at least one line').max(30),
  notes: z.string().trim().max(1000).optional(),
  /** A promotion code from the consultancy's list. */
  promoCode: z.string().trim().toUpperCase().max(24).optional().nullable(),
  /** Why a discount was given - shown to whoever approves it. */
  discountReason: z.string().trim().max(500).optional().nullable(),
  /** Pay it in parts. They must add up to the invoice total. */
  installments: installmentPlanSchema.shape.installments.optional(),
  /** Rate to the consultancy's base currency, for an invoice in another currency. */
  fxRate: z.coerce.number().positive().max(1_000_000).optional().nullable(),
  /** Email the invoice (with its PDF) to the student. */
  sendEmail: z.boolean().optional(),
});
export type CreateInvoiceInput = z.input<typeof createInvoiceSchema>;

const reasonSchema = z
  .string()
  .trim()
  .min(5, 'Say why, so the record explains itself later')
  .max(500);

export const voidSchema = z.object({ reason: reasonSchema });
export type VoidInput = z.infer<typeof voidSchema>;

export const recordPaymentSchema = z.object({
  kind: z.enum(PAYMENT_KINDS).default('payment'),
  amount: minorAmount.refine((n) => n > 0, 'Enter an amount above zero'),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120).optional(),
  receivedOn: dateOnlySchema,
  note: z.string().trim().max(500).optional(),
  /** The cash, bank or online account it went into; by method if not given. */
  accountId: uuidSchema.optional().nullable(),
  /** Rate to the base currency on the day, for money in another currency. */
  fxRate: z.coerce.number().positive().max(1_000_000).optional().nullable(),
});
export type RecordPaymentInput = z.input<typeof recordPaymentSchema>;

export const listInvoicesQuerySchema = z.object({
  clientId: uuidSchema.optional(),
  caseId: uuidSchema.optional(),
  status: z.enum(['open', 'overdue', 'paid', 'void', 'pending', 'all']).default('all'),
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;

export interface ServicePackageView {
  id: string;
  name: string;
  description: string | null;
  amount: number;
  currency: Currency;
  active: boolean;
  category: FeeCategory;
  taxRateId: string | null;
}

export interface InvoiceItemView {
  id: string;
  description: string;
  quantity: number;
  unitAmount: number;
  /** quantity x unit price. */
  amount: number;
  discount: number;
  category: FeeCategory;
  taxRateName: string | null;
  taxRateBp: number;
  taxInclusive: boolean;
  tax: number;
  /** What the line adds to the total. */
  total: number;
}

export interface PaymentView {
  id: string;
  number: string;
  invoiceId: string;
  invoiceNumber: string;
  clientName: string;
  kind: PaymentKind;
  amount: number;
  currency: Currency;
  method: PaymentMethod;
  reference: string | null;
  receivedOn: string;
  note: string | null;
  recordedByName: string | null;
  createdAt: string;
  voided: boolean;
  voidReason: string | null;
  voidedAt: string | null;
  voidedByName: string | null;
  accountName: string | null;
}

export interface InvoiceSummaryView {
  id: string;
  number: string;
  clientId: string;
  clientName: string;
  caseId: string | null;
  caseReference: string | null;
  currency: Currency;
  issueDate: string;
  dueDate: string;
  status: InvoiceStatus;
  paymentStatus: PaymentStatus;
  total: number;
  /** Payments less refunds, voided entries excluded. */
  paid: number;
  /** Credit notes issued against it, voided ones excluded. */
  credited: number;
  /** total - credited - paid; zero for a void invoice. */
  balance: number;
  overdue: boolean;
  /** The next installment still to pay, when it is paid in parts. */
  nextDue: { dueDate: string; amount: number } | null;
}

export interface InvoiceView extends InvoiceSummaryView {
  items: InvoiceItemView[];
  payments: PaymentView[];
  notes: string | null;
  voidReason: string | null;
  voidedAt: string | null;
  createdByName: string | null;
  createdById: string | null;
  createdAt: string;
  clientEmail: string;
  clientPhone: string;
  subtotal: number;
  discount: number;
  tax: number;
  promoCode: string | null;
  discountReason: string | null;
  fxRate: number | null;
  approvedByName: string | null;
  approvedAt: string | null;
  quoteNumber: string | null;
  parentInvoice: { id: string; number: string } | null;
  installments: InstallmentView[];
  creditNotes: CreditNoteView[];
  refundRequests: RefundRequestView[];
  submissions: PaymentSubmissionView[];
}

/** Per currency, because adding rupees to pounds is not a number anyone should read. */
export interface BillingTotals {
  currency: Currency;
  invoiced: number;
  collected: number;
  outstanding: number;
  overdue: number;
  collected30: number;
}

export interface ClientBalance {
  clientId: string;
  totals: BillingTotals[];
}
