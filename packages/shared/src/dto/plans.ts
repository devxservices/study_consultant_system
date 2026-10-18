import { z } from 'zod';
import { CURRENCIES, PAYMENT_METHODS, type Currency, type PaymentMethod } from '../billing';

/**
 * Subscription plans. One codebase for every consultancy; what differs is
 * which modules are switched on and how far each one can grow, decided by the
 * plan - never by a fork of the code.
 *
 * The core (clients, cases, documents, chat, dashboards) is in every plan.
 * These are the optional modules on top.
 */
export const MODULES = ['billing', 'tasks', 'announcements'] as const;
export type Module = (typeof MODULES)[number];
export const MODULE_LABEL: Record<Module, string> = {
  billing: 'Invoices & payments',
  tasks: 'Tasks & follow-ups',
  announcements: 'Announcements',
};

export const SUBSCRIPTION_STATUSES = ['trialing', 'active', 'past_due', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
export const SUBSCRIPTION_STATUS_LABEL: Record<SubscriptionStatus, string> = {
  trialing: 'Trial',
  active: 'Active',
  past_due: 'Payment overdue',
  cancelled: 'Cancelled',
};

/** null = unlimited. */
const limit = z.coerce.number().int().min(1).max(1_000_000).nullable();

export const planSchema = z.object({
  code: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,30}$/, 'Lowercase letters, digits and hyphens'),
  name: z.string().trim().min(2).max(60),
  /** Minor units per month. */
  priceMonthly: z.coerce.number().int().min(0),
  currency: z.enum(CURRENCIES).default('USD'),
  maxStaff: limit,
  maxActiveClients: limit,
  storageGb: limit,
  modules: z.array(z.enum(MODULES)).default([]),
  active: z.boolean().default(true),
});
export type PlanInput = z.infer<typeof planSchema>;

export const tenantSubscriptionSchema = z.object({
  planId: z.string().uuid().nullable(),
  subscriptionStatus: z.enum(SUBSCRIPTION_STATUSES),
  currentPeriodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});
export type TenantSubscriptionInput = z.infer<typeof tenantSubscriptionSchema>;

export interface PlanView {
  id: string;
  code: string;
  name: string;
  priceMonthly: number;
  currency: Currency;
  maxStaff: number | null;
  maxActiveClients: number | null;
  storageGb: number | null;
  modules: Module[];
  active: boolean;
  tenantCount: number;
}

/** What a consultancy may use right now, and how close it is to its limits. */
export interface Entitlements {
  planName: string | null;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: string | null;
  subscription: SubscriptionState;
  modules: Module[];
  limits: { maxStaff: number | null; maxActiveClients: number | null; storageGb: number | null };
  usage: { staff: number; activeClients: number; storageBytes: number };
}

/* ------------------------------------------------------------------ */
/* Paying for the platform                                             */
/* ------------------------------------------------------------------ */

/**
 * What a consultancy can do, decided by the date it has paid until:
 *  - open: everything;
 *  - grace: everything, with a reminder on every screen - the date has passed
 *    (or the platform marked the payment overdue) and the grace days run;
 *  - read_only: staff can sign in, see, export and reply to messages, but not
 *    add or change records, until a payment is recorded. Students and
 *    partners are not affected. Suspending a consultancy is the full stop.
 * A consultancy with no date is never restricted by date.
 */
export const SUBSCRIPTION_ACCESS = ['open', 'grace', 'read_only'] as const;
export type SubscriptionAccess = (typeof SUBSCRIPTION_ACCESS)[number];

export interface SubscriptionState {
  access: SubscriptionAccess;
  /** The last day paid for (or of the trial). Null: no end date. */
  paidUntil: string | null;
  /** Days from today to paidUntil, negative once it has passed. */
  daysLeft: number | null;
  /** The last day of the grace period, once paidUntil has passed. */
  graceEndsOn: string | null;
  /** paidUntil is within RENEWAL_WARNING_DAYS: time to remind. */
  endingSoon: boolean;
}

export const RENEWAL_WARNING_DAYS = 7;
export const DEFAULT_GRACE_DAYS = 7;
export const DEFAULT_TRIAL_DAYS = 14;

const dayNumber = (iso: string) => Math.floor(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86_400_000);
const fromDayNumber = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/** `iso` plus `days` calendar days, as YYYY-MM-DD. */
export function addCalendarDays(iso: string, days: number): string {
  return fromDayNumber(dayNumber(iso) + days);
}

/** `iso` plus whole months, clamped to the month's last day (31 Jan + 1 month = 28/29 Feb). */
export function addCalendarMonths(iso: string, months: number): string {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7) - 1 + months;
  const d = +iso.slice(8, 10);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d, last))).toISOString().slice(0, 10);
}

export function subscriptionState(
  status: SubscriptionStatus,
  paidUntil: string | null,
  today: string,
  graceDays: number = DEFAULT_GRACE_DAYS,
): SubscriptionState {
  if (!paidUntil) {
    return {
      access: status === 'cancelled' ? 'read_only' : status === 'past_due' ? 'grace' : 'open',
      paidUntil: null,
      daysLeft: null,
      graceEndsOn: null,
      endingSoon: false,
    };
  }
  const daysLeft = dayNumber(paidUntil) - dayNumber(today);
  if (daysLeft >= 0) {
    return {
      access: status === 'past_due' ? 'grace' : 'open',
      paidUntil,
      daysLeft,
      graceEndsOn: null,
      endingSoon: daysLeft <= RENEWAL_WARNING_DAYS,
    };
  }
  // A cancelled subscription simply ends with what was paid for.
  const graceEndsOn = status === 'cancelled' ? null : addCalendarDays(paidUntil, graceDays);
  return {
    access: graceEndsOn && today <= graceEndsOn ? 'grace' : 'read_only',
    paidUntil,
    daysLeft,
    graceEndsOn,
    endingSoon: false,
  };
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');

/** A payment the platform received from a consultancy: it moves paidUntil on by `months`. */
export const subscriptionPaymentSchema = z.object({
  /** Minor units. */
  amount: z.coerce.number().int().min(1, 'Enter the amount received'),
  currency: z.enum(CURRENCIES),
  months: z.coerce.number().int().min(1).max(36),
  receivedOn: isoDate,
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(500).optional(),
});
export type SubscriptionPaymentInput = z.infer<typeof subscriptionPaymentSchema>;

export interface SubscriptionPaymentView {
  id: string;
  amount: number;
  currency: Currency;
  months: number;
  receivedOn: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  periodFrom: string;
  periodTo: string;
  recordedBy: string | null;
  createdAt: string;
}

/** What a consultancy's manager sees about paying for the platform. */
export interface MySubscriptionView {
  planName: string | null;
  priceMonthly: number | null;
  currency: Currency | null;
  status: SubscriptionStatus;
  state: SubscriptionState;
  paymentInstructions: string;
  operatorName: string;
  payments: SubscriptionPaymentView[];
}

/* ------------------------------------------------------------------ */
/* Platform settings (the platform admin's own)                        */
/* ------------------------------------------------------------------ */

export const platformBillingSchema = z.object({
  /** Shown to managers when payment is due: bank account, wallet number, who to contact. */
  paymentInstructions: z.string().trim().max(2000).default(''),
  graceDays: z.coerce.number().int().min(0).max(60).default(DEFAULT_GRACE_DAYS),
  /** A new consultancy's free trial; 0 leaves it without an end date. */
  trialDays: z.coerce.number().int().min(0).max(365).default(DEFAULT_TRIAL_DAYS),
});
export type PlatformBilling = z.infer<typeof platformBillingSchema>;

export const platformLegalSchema = z.object({
  /** The business that runs the platform, as named in the terms. */
  operatorName: z.string().trim().max(120).default(''),
  terms: z.string().trim().max(60_000).default(''),
  privacy: z.string().trim().max(60_000).default(''),
});
export type PlatformLegal = z.infer<typeof platformLegalSchema>;

export interface PlatformSettingsView {
  billing: PlatformBilling;
  legal: PlatformLegal & { updatedAt: string | null };
}

/** The published terms and privacy policy, for anyone - null when not published. */
export interface LegalDocsView {
  operatorName: string;
  terms: string | null;
  privacy: string | null;
  updatedAt: string | null;
}
