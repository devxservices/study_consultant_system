import { z } from 'zod';
import { emailSchema, phoneSchema } from './common';
import type { Entitlements, SubscriptionState, SubscriptionStatus } from './plans';

/**
 * Consultancies (tenants).
 *
 * Every consultancy on the platform is one tenant: its own staff, clients,
 * cases, documents and branding, all sharing one codebase and one database,
 * separated by a tenant id on every row.
 */

/**
 * `suspended` is a pause (unpaid invoice, a dispute) and `deactivated` is the
 * account being closed. Both lock everyone in the consultancy out at once and
 * neither deletes anything - the records are exactly where they were if the
 * consultancy is reactivated.
 */
export const TENANT_STATUSES = ['active', 'suspended', 'deactivated'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const TENANT_STATUS_LABEL: Record<TenantStatus, string> = {
  active: 'Active',
  suspended: 'Suspended',
  deactivated: 'Deactivated',
};

/**
 * Subdomain labels that can never be a consultancy's address, because the
 * platform itself needs them or because they would be mistaken for it.
 */
export const RESERVED_SLUGS = [
  'admin',
  'api',
  'app',
  'assets',
  'auth',
  'cdn',
  'dashboard',
  'docs',
  'help',
  'login',
  'mail',
  'platform',
  'static',
  'status',
  'support',
  'www',
] as const;

/**
 * DNS proves a consultancy controls a domain before it is routed to them: they
 * publish a TXT record at `_crm-verification.<their domain>` containing
 * `crm-verification=<token>`.
 */
export const DOMAIN_VERIFICATION_PREFIX = '_crm-verification';
export const DOMAIN_VERIFICATION_VALUE_PREFIX = 'crm-verification=';

export const tenantSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Use at least 3 characters')
  .max(40, 'Use 40 characters or fewer')
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Lowercase letters, numbers and hyphens only, not starting or ending with a hyphen',
  )
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), 'That address is reserved');

export const brandColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a six-digit hex colour, like #1e88e5')
  .transform((s) => s.toLowerCase());

export const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253, 'That domain is too long')
  .regex(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
    'Enter just the domain, like portal.example.com - no https:// and no path',
  );

const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(200, 'That password is too long');

/**
 * Onboarding. The consultancy and its first manager are created together, in
 * one transaction, so a failure can never leave a consultancy nobody can sign
 * in to - and a retry with the same address is refused rather than duplicated.
 */
export const createTenantSchema = z.object({
  name: z.string().trim().min(2, 'Enter the consultancy’s name').max(120),
  slug: tenantSlugSchema,
  primaryColor: brandColorSchema.optional(),
  contactEmail: emailSchema.optional(),
  contactPhone: phoneSchema.optional(),
  manager: z.object({
    fullName: z.string().trim().min(2, 'Enter the manager’s full name').max(120),
    email: emailSchema,
    /** Left out, the manager is emailed a link to choose their own. */
    password: passwordSchema.optional(),
  }),
  /** The last day of a free trial. Left out or null: no end date. */
  trialEndsOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
    .nullable()
    .optional(),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

/** `null` clears a value; leaving a field out leaves it alone. */
export const updateTenantSchema = z.object({
  name: z.string().trim().min(2, 'Enter the consultancy’s name').max(120).optional(),
  primaryColor: brandColorSchema.nullable().optional(),
  contactEmail: emailSchema.nullable().optional(),
  contactPhone: phoneSchema.nullable().optional(),
});
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;

/** Taking a consultancy offline always says why, for whoever reactivates it. */
export const changeTenantStatusSchema = z
  .object({
    status: z.enum(TENANT_STATUSES),
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status === 'active' || (v.reason?.length ?? 0) >= 5, {
    message: 'Say why, so whoever reactivates it knows what to check.',
    path: ['reason'],
  });
export type ChangeTenantStatusInput = z.infer<typeof changeTenantStatusSchema>;

export const addDomainSchema = z.object({ hostname: hostnameSchema });
export type AddDomainInput = z.infer<typeof addDomainSchema>;

/* ------------------------------------------------------------------ */
/* Wire shapes                                                         */
/* ------------------------------------------------------------------ */

/** What any visitor to a consultancy's address may know about it. */
export interface TenantBranding {
  id: string;
  slug: string;
  name: string;
  primaryColor: string | null;
  /** Public URL of the logo, or null for the lettermark. */
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

/**
 * Which site a request arrived at. `platform` is the admin address; a host
 * that maps to nothing gets a 404 from the API rather than a context.
 *
 * `available` is false while the consultancy is suspended or deactivated. The
 * reason is deliberately not included - a visitor learns that the portal is
 * closed, not why.
 */
export type HostContext =
  | { kind: 'tenant'; tenant: TenantBranding; available: boolean }
  | { kind: 'platform' };

/**
 * One record to add at a DNS provider. `name` is what most providers ask for
 * (the part before the domain, or `@` for the domain itself); `fqdn` is the
 * full name, for the providers that want it spelled out.
 */
export interface DnsRecord {
  type: 'CNAME' | 'A' | 'AAAA' | 'TXT';
  name: string;
  fqdn: string;
  /** Empty when the platform has not been told its own address (PUBLIC_IP). */
  value: string;
}

export interface TenantDomainView {
  id: string;
  hostname: string;
  /** Ownership proven - by the TXT record, or by a CNAME to the consultancy's own address. */
  verifiedAt: string | null;
  /** Public DNS showed it pointing at the platform when last checked. */
  pointsHere: boolean;
  checkedAt: string | null;
  /** Both of the above: people can reach the portal at this address. */
  live: boolean;
  /** The TXT record that proves ownership when a CNAME cannot be used. */
  verification: { type: 'TXT'; name: string; value: string };
  /**
   * What to add, simplest first. A subdomain needs one CNAME, which both
   * points it here and proves ownership. A root domain (example.com) cannot
   * have a CNAME, so it needs an A record and the TXT record.
   */
  setup: { apex: boolean; records: DnsRecord[]; alternative: DnsRecord[] };
  createdAt: string;
}

/** The answer to "Check DNS", in words. */
export interface DomainCheckResult {
  live: boolean;
  message: string;
}

/** A consultancy's own branding and addresses, as its manager edits them. */
export interface BrandingSettings {
  id: string;
  name: string;
  slug: string;
  primaryColor: string | null;
  logoUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  platformHost: string;
  domains: TenantDomainView[];
}

export interface TenantSummary {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  statusReason: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
  /** The platform address it is always reachable at, e.g. acme.example.com. */
  platformHost: string;
  createdAt: string;
  counts: { staff: number; clients: number; activeCases: number; domains: number };
  planName: string | null;
  subscriptionStatus: SubscriptionStatus;
  subscription: SubscriptionState;
}

export interface TenantDetail extends TenantSummary {
  contactEmail: string | null;
  contactPhone: string | null;
  statusChangedAt: string | null;
  domains: TenantDomainView[];
  managers: { id: string; fullName: string; email: string; lastSignInAt: string | null; mfaEnabled: boolean }[];
  planId: string | null;
  entitlements: Entitlements;
}

/** The platform admin's launch checklist: each external service and how it is set. */
export interface PlatformReadiness {
  checks: { key: string; ok: boolean; label: string; detail: string }[];
}
