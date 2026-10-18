import { relations, sql } from 'drizzle-orm';
import type {
  AutomationAction,
  Condition,
  CountryFee,
  CountryIntake,
  LanguageRequirement,
  ProofOfFunds,
  StageFee,
  StageMessage,
  StageTask,
} from '@crm/shared';
import {
  type AnyPgColumn,
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  caseStatusEnum,
  documentStatusEnum,
  documentTypeEnum,
  notificationTypeEnum,
  roleEnum,
  stageChangeMethodEnum,
  stageEnum,
  tenantStatusEnum,
  audienceEnum,
  invoiceStatusEnum,
  paymentKindEnum,
  paymentMethodEnum,
  subscriptionStatusEnum,
  taskPriorityEnum,
  taskStatusEnum,
  mfaPolicyEnum,
  permissionEffectEnum,
} from './enums';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();

/* ------------------------------------------------------------------ */
/* Tenancy                                                             */
/* ------------------------------------------------------------------ */

/**
 * Subscription plans. Platform-level, so no tenant: every consultancy picks
 * from the same list. `modules` switches optional modules on; a null limit
 * means unlimited.
 */
export const plans = pgTable(
  'plans',
  {
    id: id(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    priceMonthly: bigint('price_monthly', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull().default('USD'),
    maxStaff: integer('max_staff'),
    maxActiveClients: integer('max_active_clients'),
    storageGb: integer('storage_gb'),
    modules: jsonb('modules').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('plans_code_key').on(t.code)],
);

/**
 * One row per consultancy on the platform.
 *
 * Every consultancy-owned row below carries a tenant_id, and every query that
 * reads one filters on the tenant of the person asking. The slug is the
 * consultancy's permanent platform address (<slug>.<platform domain>) and never
 * changes, so links and bookmarks keep working when the name does.
 */
export const tenants = pgTable(
  'tenants',
  {
    id: id(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: tenantStatusEnum('status').notNull().default('active'),
    /** Why it was last suspended or deactivated - for whoever reactivates it. */
    statusReason: text('status_reason'),
    statusChangedAt: timestamp('status_changed_at', { withTimezone: true }),
    /** Hex, e.g. #1e88e5. Null keeps the platform's default palette. */
    primaryColor: text('primary_color'),
    /** Storage key of the uploaded logo. Logos are public, unlike documents. */
    logoKey: text('logo_key'),
    contactEmail: text('contact_email'),
    contactPhone: text('contact_phone'),
    /** Null: no plan assigned, which keeps every module on (the pre-plans behaviour). */
    planId: uuid('plan_id').references(() => plans.id, { onDelete: 'set null' }),
    subscriptionStatus: subscriptionStatusEnum('subscription_status').notNull().default('trialing'),
    /** Who must use two-step verification to sign in here. */
    mfaPolicy: mfaPolicyEnum('mfa_policy').notNull().default('optional'),
    /**
     * Which notification types also go out by email: type -> false switches
     * one off. Absent means on, so a new type emails until someone says not.
     */
    emailNotifications: jsonb('email_notifications')
      .$type<Record<string, boolean>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    currentPeriodEnd: date('current_period_end', { mode: 'string' }),
    /**
     * The last renewal reminder sent, as "<paid-until>:<stage>" - so each
     * reminder (ending soon, in grace, read-only) goes out once per period.
     */
    renewalNoticeKey: text('renewal_notice_key'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('tenants_slug_key').on(t.slug)],
);

/**
 * A consultancy's own domain (portal.globalstudy.pk). It routes to them only
 * once verifiedAt is set, which happens when the TXT record carrying
 * verificationToken is found in DNS - so nobody can point a domain they do not
 * control at someone else's consultancy, or claim someone else's domain.
 */
export const tenantDomains = pgTable(
  'tenant_domains',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    hostname: text('hostname').notNull(),
    verificationToken: text('verification_token').notNull(),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    /**
     * When public DNS last showed the domain pointing at the platform (by
     * CNAME or by address). Ownership and pointing are separate: a domain can
     * be proven but still lead somewhere else, and then nobody can reach it.
     */
    pointsHereAt: timestamp('points_here_at', { withTimezone: true }),
    dnsCheckedAt: timestamp('dns_checked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('tenant_domains_hostname_key').on(t.hostname),
    index('tenant_domains_tenant_idx').on(t.tenantId),
  ],
);

/** The tenant column every consultancy-owned table carries. */
const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

/**
 * One row per person who can sign in, whatever their role.
 * passwordHash is only used by the local auth provider; when this is swapped
 * for Clerk/Supabase the column stays null and externalId holds their id.
 *
 * tenantId is null only for platform admins. An email is unique within a
 * consultancy, not across the platform: a student applying through two
 * consultancies is two separate accounts, one on each consultancy's site.
 */
export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    externalId: text('external_id'),
    fullName: text('full_name').notNull(),
    role: roleEnum('role').notNull(),
    phone: text('phone'),
    avatarColor: text('avatar_color').notNull().default('slate'),
    isActive: boolean('is_active').notNull().default(true),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
    /**
     * Two-step verification. The TOTP secret is stored encrypted (AES-256-GCM),
     * never in the clear; the codes it generates are never stored at all.
     * `mfaPendingSecret` holds a secret during enrolment, until the first code
     * proves the person scanned it. `mfaLastStep` is the 30-second window of
     * the last accepted code, so a code can never be used twice.
     */
    mfaSecret: text('mfa_secret'),
    mfaPendingSecret: text('mfa_pending_secret'),
    mfaEnabledAt: timestamp('mfa_enabled_at', { withTimezone: true }),
    mfaLastStep: integer('mfa_last_step'),
    /** A member of staff's role (staff_roles); null uses the consultancy's defaults alone. */
    staffRoleId: uuid('staff_role_id').references(() => staffRoles.id, { onDelete: 'set null' }),
    /** A partner user's organisation (partners). */
    partnerId: uuid('partner_id'),
    /**
     * Sessions signed before this moment are refused. Moved forward by a
     * password change or reset and by "sign out everywhere", so a session on
     * a lost phone dies with the old password. Whole seconds, like a token's
     * issue time.
     */
    sessionsValidAfter: timestamp('sessions_valid_after', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('users_staff_role_idx').on(t.staffRoleId),
    index('users_partner_idx').on(t.partnerId),
    uniqueIndex('users_tenant_email_key').on(t.tenantId, sql`lower(${t.email})`),
    // Postgres treats NULLs as distinct, so platform admins need their own index.
    uniqueIndex('users_platform_email_key')
      .on(sql`lower(${t.email})`)
      .where(sql`tenant_id IS NULL`),
    index('users_tenant_role_idx').on(t.tenantId, t.role),
    uniqueIndex('users_external_id_key').on(t.externalId),
    index('users_role_idx').on(t.role),
  ],
);

/**
 * Single-use links that let someone choose their own password: "forgot my
 * password" (an hour) and an invitation from staff (a week). Only a SHA-256
 * of the token is kept, so a copy of the database opens nobody's account.
 */
export const passwordTokens = pgTable(
  'password_tokens',
  {
    id: id(),
    /** Null for a platform admin, who belongs to no consultancy. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'reset' | 'invite' */
    purpose: text('purpose').notNull(),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** The member of staff who sent an invitation; null for a self-service reset. */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('password_tokens_hash_key').on(t.tokenHash),
    index('password_tokens_user_idx').on(t.userId),
  ],
);

/**
 * The platform admin's own settings, one row per group ('billing', 'legal'):
 * how consultancies pay for the platform, and the published terms and
 * privacy policy. Validated by the shared schemas on the way in and out.
 */
export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

/**
 * Money the platform received from a consultancy for its subscription. Each
 * one moves the consultancy's paid-until date on by `months`; the period it
 * paid for is kept with it. Append-only: a mistake is put right by setting
 * the date on the consultancy's page, and both stay in the audit trail.
 */
export const subscriptionPayments = pgTable(
  'subscription_payments',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Minor units. */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    months: integer('months').notNull(),
    receivedOn: date('received_on', { mode: 'string' }).notNull(),
    method: paymentMethodEnum('method').notNull(),
    reference: text('reference'),
    note: text('note'),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('subscription_payments_tenant_idx').on(t.tenantId, t.receivedOn)],
);

/**
 * One-time recovery codes for two-step verification, stored as SHA-256 hashes.
 * The codes themselves are shown once, when generated, and never again.
 */
export const mfaRecoveryCodes = pgTable(
  'mfa_recovery_codes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('mfa_recovery_codes_user_idx').on(t.userId)],
);

/**
 * A consultancy's default for a role - today, what consultants may do unless
 * a member has their own override. Absent rows fall back to the built-in
 * defaults in @crm/shared.
 */
export const rolePermissions = pgTable(
  'role_permissions',
  {
    id: id(),
    tenantId: tenantId(),
    role: roleEnum('role').notNull(),
    /** A key from PERMISSIONS in @crm/shared; text so new ones need no migration. */
    permission: text('permission').notNull(),
    effect: permissionEffectEnum('effect').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('role_permissions_key').on(t.tenantId, t.role, t.permission)],
);

/** One member's explicit allow or deny, overriding their consultancy's default. */
export const userPermissions = pgTable(
  'user_permissions',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    effect: permissionEffectEnum('effect').notNull(),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('user_permissions_key').on(t.userId, t.permission),
    index('user_permissions_tenant_idx').on(t.tenantId),
  ],
);

/**
 * A consultancy's named roles for staff - Accountant, Trainer, Senior
 * consultant. Each is a set of allow/deny effects that sits between a
 * member's own overrides and the consultancy's default (see
 * resolvePermissions in @crm/shared). `takesClients` decides whether its
 * members are offered when a client is assigned.
 */
export const staffRoles = pgTable(
  'staff_roles',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    /** Permission -> 'allow' | 'deny'. Text keys, so new permissions need no migration. */
    effects: jsonb('effects').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
    takesClients: boolean('takes_clients').notNull().default(true),
    /** The built-in role it was seeded from, if any. */
    systemKey: text('system_key'),
    updatedBy: uuid('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('staff_roles_tenant_name_key').on(t.tenantId, sql`lower(${t.name})`)],
);

/** Staff profile for a user whose role is consultant. */
export const consultants = pgTable(
  'consultants',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Countries this consultant specialises in, for sensible assignment. */
    countries: jsonb('countries').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** Soft capacity signal used by the manager workload view. */
    maxActiveClients: integer('max_active_clients').notNull().default(60),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('consultants_user_id_key').on(t.userId),
    index('consultants_tenant_idx').on(t.tenantId),
  ],
);

/* ------------------------------------------------------------------ */
/* Clients                                                             */
/* ------------------------------------------------------------------ */

/**
 * A client exists as soon as a consultant adds them, which is usually before
 * they have a login - hence the nullable userId, filled in when invited.
 * Target country/university live on the CASE, because one client may pursue
 * several countries in parallel.
 */
export const clients = pgTable(
  'clients',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    fullName: text('full_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    city: text('city'),
    assignedConsultantId: uuid('assigned_consultant_id').references(() => consultants.id, {
      onDelete: 'set null',
    }),
    notes: text('notes'),
    archived: boolean('archived').notNull().default(false),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),

    // The student profile. Text rather than enums for the pick-lists, whose
    // values are validated by @crm/shared and will grow (a new English test)
    // without needing a migration.
    dateOfBirth: date('date_of_birth', { mode: 'string' }),
    nationality: text('nationality'),
    passportNumber: text('passport_number'),
    passportExpiry: date('passport_expiry', { mode: 'string' }),
    highestQualification: text('highest_qualification'),
    lastInstitution: text('last_institution'),
    lastGrade: text('last_grade'),
    graduationYear: integer('graduation_year'),
    englishTest: text('english_test'),
    englishScore: text('english_score'),
    englishTestDate: date('english_test_date', { mode: 'string' }),
    intendedLevel: text('intended_level'),
    intendedField: text('intended_field'),
    preferredCountries: jsonb('preferred_countries')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    budget: text('budget'),
    leadSource: text('lead_source'),
    emergencyContactName: text('emergency_contact_name'),
    emergencyContactPhone: text('emergency_contact_phone'),
    /** The partner who brought them; null for the consultancy's own students. */
    partnerId: uuid('partner_id').references((): AnyPgColumn => partners.id, { onDelete: 'set null' }),
    /** When that partner was credited with them - what "registered first" compares. */
    partnerAttributedAt: timestamp('partner_attributed_at', { withTimezone: true }),
    /** The partner's member who registered them. */
    partnerRegisteredBy: uuid('partner_registered_by').references(() => users.id, { onDelete: 'set null' }),
    /** study_abroad | course_only - a course-only student is not in the study-abroad pipeline. */
    programme: text('programme').notNull().default('study_abroad'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('clients_partner_idx').on(t.partnerId),
    uniqueIndex('clients_user_id_key').on(t.userId),
    index('clients_consultant_idx').on(t.assignedConsultantId, t.archived),
    index('clients_email_idx').on(sql`lower(${t.email})`),
    index('clients_name_idx').on(sql`lower(${t.fullName})`),
    index('clients_created_at_idx').on(t.createdAt.desc()),
    index('clients_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('clients_tenant_consultant_idx').on(t.tenantId, t.assignedConsultantId),
  ],
);

/* ------------------------------------------------------------------ */
/* Cases                                                               */
/* ------------------------------------------------------------------ */

/** One application: a client pursuing one country/university. */
export const cases = pgTable(
  'cases',
  {
    id: id(),
    tenantId: tenantId(),
    /** Human-readable handle used in conversation, e.g. APP-2026-0042. Unique per consultancy. */
    reference: text('reference').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    consultantId: uuid('consultant_id').references(() => consultants.id, { onDelete: 'set null' }),
    targetCountry: text('target_country').notNull(),
    targetUniversity: text('target_university'),
    targetProgram: text('target_program'),
    /** Bachelor's, Master's... - for this application; the student's profile is the fallback. */
    studyLevel: text('study_level'),
    /** Student visa, dependant, visitor... - picks the checklist and the workflow. */
    visaType: text('visa_type'),
    intake: text('intake'),
    applicationDeadline: date('application_deadline', { mode: 'string' }),
    offerType: text('offer_type'),
    offerConditions: text('offer_conditions'),
    offerDeadline: date('offer_deadline', { mode: 'string' }),
    visaAppointmentAt: timestamp('visa_appointment_at', { withTimezone: true }),
    travelDate: date('travel_date', { mode: 'string' }),
    /** The institution from the catalogue; targetUniversity keeps whatever was typed. */
    institutionId: uuid('institution_id').references(() => institutions.id, { onDelete: 'set null' }),
    /** First-year tuition and any scholarship off it, minor units - what commission is worked out on. */
    tuitionFee: bigint('tuition_fee', { mode: 'number' }),
    tuitionCurrency: text('tuition_currency'),
    scholarship: bigint('scholarship', { mode: 'number' }),
    courseStart: date('course_start', { mode: 'string' }),
    /** The category of the current stage - one of the ten, read by every dashboard. */
    currentStage: stageEnum('current_stage').notNull().default('inquiry'),
    /**
     * The workflow version the application runs on, and where it is in it.
     * Filled by a trigger for code that inserts the original way, so every
     * row has them. Name and limit are copied from the (immutable) version so
     * lists and the stuck-case sweep need no join.
     */
    workflowVersionId: uuid('workflow_version_id').references(() => workflowVersions.id),
    currentStageKey: text('current_stage_key'),
    currentStageName: text('current_stage_name'),
    stageSlaDays: integer('stage_sla_days'),
    /** Sign-off of the current stage, when it needs one. Cleared on every move. */
    stageApprovedAt: timestamp('stage_approved_at', { withTimezone: true }),
    stageApprovedBy: uuid('stage_approved_by').references(() => users.id, { onDelete: 'set null' }),
    status: caseStatusEnum('status').notNull().default('active'),
    notes: text('notes'),
    /** When the case entered its current stage - drives the stuck-case alert. */
    stageEnteredAt: timestamp('stage_entered_at', { withTimezone: true }).notNull().defaultNow(),
    /** Any activity at all: upload, review, message, note. */
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('cases_tenant_reference_key').on(t.tenantId, t.reference),
    index('cases_tenant_status_idx').on(t.tenantId, t.status, t.currentStage),
    index('cases_tenant_created_idx').on(t.tenantId, t.createdAt),
    index('cases_client_idx').on(t.clientId),
    index('cases_consultant_stage_idx').on(t.consultantId, t.currentStage),
    index('cases_stage_idx').on(t.currentStage, t.status),
    index('cases_stage_entered_idx').on(t.stageEnteredAt),
    index('cases_last_activity_idx').on(t.lastActivityAt.desc()),
    index('cases_workflow_stage_idx').on(t.workflowVersionId, t.currentStageKey),
  ],
);

/**
 * Append-only stage history. One row per stage the case has entered;
 * completedAt is stamped when it leaves.
 */
export const caseStageEvents = pgTable(
  'case_stage_events',
  {
    id: id(),
    tenantId: tenantId(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    /** The category of the stage entered. */
    stage: stageEnum('stage').notNull(),
    /** The stage itself, in the workflow version below. */
    stageKey: text('stage_key'),
    workflowVersionId: uuid('workflow_version_id').references(() => workflowVersions.id),
    enteredAt: timestamp('entered_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** How the case got here: satisfied checklist, consultant override, or case creation. */
    method: stageChangeMethodEnum('method').notNull().default('manual'),
    changedBy: uuid('changed_by').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
  },
  (t) => [
    index('stage_events_case_idx').on(t.caseId, t.enteredAt.desc()),
    index('stage_events_open_idx').on(t.caseId).where(sql`completed_at IS NULL`),
  ],
);

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

/**
 * Metadata only - the file itself lives in object storage under fileKey.
 * Rejected documents are kept, not overwritten, so the audit trail survives
 * a re-upload; supersededBy links a rejected file to its replacement.
 */
/**
 * The drive's folders. A student's folders carry their client id; the
 * agency's own (templates, marketing material) have none. `ancestry` is the
 * materialised path of folder ids above it ('/a/b/'), so a grant on a folder
 * reaches everything beneath it in one LIKE.
 */
export const docFolders = pgTable(
  'doc_folders',
  {
    id: id(),
    tenantId: tenantId(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    /** passport, academic... - what uploads of a type are filed into. */
    systemKey: text('system_key'),
    color: text('color'),
    /** Only managers and people granted access see it - not other staff, not the student. */
    restricted: boolean('restricted').notNull().default(false),
    /** The partner portal shows it: marketing material, university updates. */
    sharedWithPartners: boolean('shared_with_partners').notNull().default(false),
    ancestry: text('ancestry').notNull().default('/'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    trashedAt: timestamp('trashed_at', { withTimezone: true }),
    trashedBy: uuid('trashed_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('doc_folders_tenant_client_parent_idx').on(t.tenantId, t.clientId, t.parentId),
    index('doc_folders_parent_idx').on(t.parentId),
    // One system folder of each kind per student, however many requests race.
    uniqueIndex('doc_folders_client_system_key')
      .on(t.clientId, t.systemKey)
      .where(sql`client_id IS NOT NULL AND system_key IS NOT NULL AND trashed_at IS NULL`),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: id(),
    tenantId: tenantId(),
    /** Null when the document is the student's rather than one application's - a passport. */
    caseId: uuid('case_id').references(() => cases.id, { onDelete: 'cascade' }),
    /** Null for the agency's own files: templates, marketing material for partners. */
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    type: documentTypeEnum('type').notNull(),
    /** The type as the consultancy files it: a built-in type, or one of its own (document_types). */
    typeKey: text('type_key').notNull().default('other'),
    folderId: uuid('folder_id').references(() => docFolders.id, { onDelete: 'set null' }),
    /** Every version of one document shares this; the first version's id. */
    versionGroup: uuid('version_group'),
    version: integer('version').notNull().default(1),
    tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    color: text('color'),
    expiresOn: date('expires_on', { mode: 'string' }),
    issuedOn: date('issued_on', { mode: 'string' }),
    /** The smallest reminder window (days before expiry) already sent, so each goes once. */
    expiryNotifiedDays: integer('expiry_notified_days'),
    /** Same bytes as another of this student's documents. */
    duplicateOf: uuid('duplicate_of'),
    /** In the trash: hidden, bytes kept, restorable until the retention period ends. */
    trashedAt: timestamp('trashed_at', { withTimezone: true }),
    trashedBy: uuid('trashed_by').references(() => users.id, { onDelete: 'set null' }),
    /** Storage key, resolved to a signed URL at read time. Never a public URL. */
    fileKey: text('file_key').notNull(),
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull(),
    mimeType: text('mime_type').notNull(),
    checksum: text('checksum'),
    status: documentStatusEnum('status').notNull().default('pending'),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    reviewerComment: text('reviewer_comment'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    supersededBy: uuid('superseded_by'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('documents_case_idx').on(t.caseId).where(sql`deleted_at IS NULL`),
    index('documents_case_status_idx').on(t.caseId, t.status),
    index('documents_client_idx').on(t.clientId),
    index('documents_review_queue_idx')
      .on(t.status, t.uploadedAt)
      .where(sql`status = 'pending' AND deleted_at IS NULL`),
    index('documents_tenant_status_idx').on(t.tenantId, t.status),
    index('documents_client_folder_idx').on(t.tenantId, t.clientId, t.folderId).where(sql`deleted_at IS NULL`),
    index('documents_expiry_idx')
      .on(t.tenantId, t.expiresOn)
      .where(sql`expires_on IS NOT NULL AND deleted_at IS NULL AND trashed_at IS NULL`),
    index('documents_version_group_idx').on(t.versionGroup),
    index('documents_client_checksum_idx').on(t.clientId, t.checksum),
    index('documents_tenant_uploaded_idx').on(t.tenantId, t.uploadedAt.desc()),
  ],
);

/** A consultancy's document types: the built-in ones, renamed if it likes, and its own. */
export const documentTypes = pgTable(
  'document_types',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    label: text('label').notNull(),
    hint: text('hint'),
    folderKey: text('folder_key').notNull().default('other'),
    hasExpiry: boolean('has_expiry').notNull().default(false),
    system: boolean('system').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('document_types_tenant_key').on(t.tenantId, t.key)],
);

/** Which folders a new student's drive starts with - the default, or per country. */
export const folderTemplates = pgTable(
  'folder_templates',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    country: text('country'),
    folders: jsonb('folders').$type<{ key: string; name: string }[]>().notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('folder_templates_tenant_idx').on(t.tenantId)],
);

/**
 * Required-document checklists. The most specific one for an application
 * applies: country + level + visa type beats country alone beats the
 * consultancy's general list.
 */
export const requirementSets = pgTable(
  'requirement_sets',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    country: text('country'),
    studyLevel: text('study_level'),
    visaType: text('visa_type'),
    items: jsonb('items').$type<{ typeKey: string; required: boolean; note?: string | null }[]>().notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('requirement_sets_tenant_idx').on(t.tenantId)],
);

/** One person's stars. Starring is personal: nobody else sees it. */
export const driveStars = pgTable(
  'drive_stars',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemType: text('item_type').notNull(),
    itemId: uuid('item_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('drive_stars_key').on(t.userId, t.itemType, t.itemId)],
);

/**
 * A link that lets someone outside - a university's admissions team - open a
 * document or a folder without an account. Only the token's hash is kept; it
 * expires, can carry a password, can be view-only, and is revocable.
 */
export const shareLinks = pgTable(
  'share_links',
  {
    id: id(),
    tenantId: tenantId(),
    tokenHash: text('token_hash').notNull(),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id').references(() => docFolders.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    passwordHash: text('password_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    viewOnly: boolean('view_only').notNull().default(false),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    views: integer('views').notNull().default(0),
    lastAccessAt: timestamp('last_access_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('share_links_token_key').on(t.tokenHash),
    index('share_links_document_idx').on(t.documentId),
    index('share_links_folder_idx').on(t.folderId),
    index('share_links_tenant_idx').on(t.tenantId, t.createdAt.desc()),
  ],
);

/** Every open, download and refused password on a share link. */
export const shareAccessLog = pgTable(
  'share_access_log',
  {
    id: id(),
    tenantId: tenantId(),
    shareLinkId: uuid('share_link_id')
      .notNull()
      .references(() => shareLinks.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id'),
    action: text('action').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('share_access_log_link_idx').on(t.shareLinkId, t.at.desc())],
);

/**
 * Access beyond the usual rules: a consultant who may open one student's
 * Financial folder, or a restricted folder a manager opened to someone.
 */
export const resourceGrants = pgTable(
  'resource_grants',
  {
    id: id(),
    tenantId: tenantId(),
    resourceType: text('resource_type').notNull(),
    resourceId: uuid('resource_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    access: text('access').notNull().default('view'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('resource_grants_key').on(t.resourceType, t.resourceId, t.userId),
    index('resource_grants_user_idx').on(t.userId),
  ],
);

/** A consultancy's upload rules and document housekeeping. Absent: the defaults. */
export const driveSettings = pgTable('drive_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  acceptedTypes: jsonb('accepted_types').$type<string[]>().notNull(),
  maxFileMb: integer('max_file_mb').notNull().default(15),
  renamePattern: text('rename_pattern').notNull().default('{student}_{type}'),
  retentionDays: integer('retention_days').notNull().default(30),
  expiryReminderDays: jsonb('expiry_reminder_days').$type<number[]>().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

/**
 * A resumable upload in progress: the chunks so far sit in a temporary file,
 * and a dropped connection resumes from `received` instead of starting over.
 */
export const uploadSessions = pgTable(
  'upload_sessions',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fields: jsonb('fields').$type<Record<string, string | undefined>>().notNull(),
    fileName: text('file_name').notNull(),
    size: bigint('size', { mode: 'number' }).notNull(),
    received: bigint('received', { mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('upload_sessions_user_idx').on(t.userId)],
);

/** Clarifying questions on a document that stop short of a rejection. */
export const documentComments = pgTable(
  'document_comments',
  {
    id: id(),
    tenantId: tenantId(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('document_comments_document_idx').on(t.documentId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Chat                                                                */
/* ------------------------------------------------------------------ */

/** One thread per case, between the client and their assigned consultant. */
export const messages = pgTable(
  'messages',
  {
    id: id(),
    tenantId: tenantId(),
    caseId: uuid('case_id')
      .notNull()
      .references(() => cases.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    senderRole: roleEnum('sender_role').notNull(),
    body: text('body').notNull(),
    /** Optionally pins a document into the conversation. */
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [
    index('messages_case_idx').on(t.caseId, t.sentAt.desc()),
    index('messages_unread_idx').on(t.caseId).where(sql`read_at IS NULL`),
  ],
);

/* ------------------------------------------------------------------ */
/* Notifications + audit                                               */
/* ------------------------------------------------------------------ */

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    /** Null for a platform admin's own notifications. */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /** In-app deep link, e.g. /portal/documents. */
    link: text('link'),
    caseId: uuid('case_id').references(() => cases.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_idx').on(t.userId, t.createdAt.desc()),
    index('notifications_unread_idx').on(t.userId).where(sql`read_at IS NULL`),
  ],
);

/**
 * Append-only. Every document action and stage change lands here with an
 * actor and a timestamp, so a dispute months later can be settled from data.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    /**
     * The consultancy the event happened in. Null only for platform-level
     * events with no consultancy behind them.
     */
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'restrict' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: roleEnum('actor_role'),
    /** Values from AUDIT_ACTIONS in @crm/shared; text so new actions need no migration. */
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id'),
    caseId: uuid('case_id').references(() => cases.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    /** Before/after values, reviewer comments, and anything else worth keeping. */
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    /** Where the request came from - see common/request-context for how it is read. */
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_tenant_actor_idx').on(t.tenantId, t.actorId, t.createdAt.desc()),
    index('audit_case_idx').on(t.caseId, t.createdAt.desc()),
    index('audit_client_idx').on(t.clientId, t.createdAt.desc()),
    index('audit_actor_idx').on(t.actorId, t.createdAt.desc()),
    index('audit_entity_idx').on(t.entityType, t.entityId),
    index('audit_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
  ],
);

/**
 * When anything in a consultancy last changed: one row per consultancy, moved
 * forward after every write request and every chat write (sync/).
 *
 * The browser keeps pages it has recently shown, so switching back to a tab
 * is instant. Before trusting one it asks whether anything changed since that
 * page was rendered, and re-renders it if so - this row is what it asks.
 */
export const tenantSync = pgTable('tenant_sync', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/* Billing                                                             */
/* ------------------------------------------------------------------ */

/** What the consultancy sells, with its standard price. Amounts in minor units. */
export const servicePackages = pgTable(
  'service_packages',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('PKR'),
    active: boolean('active').notNull().default(true),
    /** FEE_CATEGORIES: decides the revenue account (or disbursements). */
    category: text('category').notNull().default('service'),
    taxRateId: uuid('tax_rate_id').references(() => taxRates.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('service_packages_tenant_idx').on(t.tenantId)],
);

/**
 * An invoice's lines and total are fixed once issued. Voiding keeps the row
 * and says why; nothing about an issued invoice is ever edited away.
 * Client references RESTRICT: a financial record must outlive anything else.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    tenantId: tenantId(),
    /** INV-2026-0001, numbered per consultancy. */
    number: text('number').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    caseId: uuid('case_id').references(() => cases.id, { onDelete: 'set null' }),
    currency: text('currency').notNull(),
    issueDate: date('issue_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    status: invoiceStatusEnum('status').notNull().default('issued'),
    /** subtotal - discountTotal + tax added on top. */
    total: bigint('total', { mode: 'number' }).notNull(),
    /** Sum of quantity x unit price. */
    subtotal: bigint('subtotal', { mode: 'number' }).notNull().default(0),
    discountTotal: bigint('discount_total', { mode: 'number' }).notNull().default(0),
    taxTotal: bigint('tax_total', { mode: 'number' }).notNull().default(0),
    promoCodeId: uuid('promo_code_id').references(() => promoCodes.id, { onDelete: 'set null' }),
    discountReason: text('discount_reason'),
    /** Rate to the consultancy's base currency when issued. */
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
    quoteId: uuid('quote_id'),
    /** A late fee's original invoice. */
    parentInvoiceId: uuid('parent_invoice_id'),
    /** The late fee charged on it (when it has no installments). */
    lateFeeInvoiceId: uuid('late_fee_invoice_id'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    notes: text('notes'),
    voidReason: text('void_reason'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('invoices_tenant_number_key').on(t.tenantId, t.number),
    index('invoices_tenant_client_idx').on(t.tenantId, t.clientId),
    index('invoices_tenant_status_due_idx').on(t.tenantId, t.status, t.dueDate),
    index('invoices_parent_idx').on(t.parentInvoiceId),
  ],
);

export const invoiceItems = pgTable(
  'invoice_items',
  {
    id: id(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    packageId: uuid('package_id').references(() => servicePackages.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    quantity: integer('quantity').notNull().default(1),
    unitAmount: bigint('unit_amount', { mode: 'number' }).notNull(),
    /** quantity x unit price, before discount and tax. */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    position: integer('position').notNull().default(0),
    category: text('category').notNull().default('service'),
    /** The line's own discount plus its share of a promotion. */
    discount: bigint('discount', { mode: 'number' }).notNull().default(0),
    taxRateId: uuid('tax_rate_id').references(() => taxRates.id, { onDelete: 'set null' }),
    /** Copied from the rate when issued, so a later rate change never alters it. */
    taxRateName: text('tax_rate_name'),
    taxRateBp: integer('tax_rate_bp').notNull().default(0),
    taxInclusive: boolean('tax_inclusive').notNull().default(false),
    taxAmount: bigint('tax_amount', { mode: 'number' }).notNull().default(0),
    /** What the line adds to the invoice total. */
    lineTotal: bigint('line_total', { mode: 'number' }).notNull().default(0),
  },
  (t) => [index('invoice_items_invoice_idx').on(t.invoiceId, t.position)],
);

/**
 * The ledger. Append-only: a payment or refund is never edited, only voided
 * (by a manager, with a reason), and a voided row stays exactly where it is.
 */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    tenantId: tenantId(),
    /** RCT-2026-0001, numbered per consultancy - the receipt number. */
    number: text('number').notNull(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    kind: paymentKindEnum('kind').notNull().default('payment'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    method: paymentMethodEnum('method').notNull(),
    reference: text('reference'),
    receivedOn: date('received_on', { mode: 'string' }).notNull(),
    note: text('note'),
    /** The cash, bank or online account the money went into (or left). */
    accountId: uuid('account_id').references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),
  },
  (t) => [
    uniqueIndex('payments_tenant_number_key').on(t.tenantId, t.number),
    index('payments_tenant_invoice_idx').on(t.tenantId, t.invoiceId),
    // "What has been paid on this invoice" is looked up by invoice alone, on
    // every invoice list, total and detail; the tenant-led index cannot serve it.
    index('payments_invoice_idx').on(t.invoiceId),
    index('payments_tenant_received_idx').on(t.tenantId, t.receivedOn),
  ],
);

/* ------------------------------------------------------------------ */
/* Finance: settings, taxes, promotions                                */
/* ------------------------------------------------------------------ */

/** One row per consultancy. */
export const financeSettings = pgTable('finance_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  baseCurrency: text('base_currency').notNull().default('PKR'),
  bankDetails: text('bank_details'),
  invoiceTerms: text('invoice_terms'),
  /** Basis points; null means discounts never need approval. */
  discountApprovalBp: integer('discount_approval_bp'),
  directRefunds: boolean('direct_refunds').notNull().default(true),
  lateFeeKind: text('late_fee_kind').notNull().default('none'),
  /** Minor units (fixed) or basis points (percent). */
  lateFeeValue: bigint('late_fee_value', { mode: 'number' }).notNull().default(0),
  lateFeeGraceDays: integer('late_fee_grace_days').notNull().default(7),
  reminderOffsets: jsonb('reminder_offsets').$type<number[]>().notNull().default(sql`'[-3,0,7,14]'::jsonb`),
  /** Nothing dated on or before this day can be posted (a trigger enforces it). */
  lockedThrough: date('locked_through', { mode: 'string' }),
  lockedBy: uuid('locked_by').references(() => users.id, { onDelete: 'set null' }),
  /**
   * The last journal number used. Taken with UPDATE ... RETURNING inside the
   * posting transaction, so two entries never get the same number and a
   * rolled-back one leaves no gap behind... other than its own.
   */
  journalSeq: integer('journal_seq').notNull().default(0),
  gatewayProvider: text('gateway_provider').notNull().default('none'),
  /** Sealed with the server's secret box; never sent back to a browser. */
  stripeSecretKey: text('stripe_secret_key'),
  stripeWebhookSecret: text('stripe_webhook_secret'),
  stripePublishableKey: text('stripe_publishable_key'),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

export const taxRates = pgTable(
  'tax_rates',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    rateBp: integer('rate_bp').notNull(),
    inclusive: boolean('inclusive').notNull().default(false),
    isDefault: boolean('is_default').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('tax_rates_tenant_name_key').on(t.tenantId, sql`lower(${t.name})`)],
);

export const promoCodes = pgTable(
  'promo_codes',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    description: text('description'),
    /** percent | fixed */
    kind: text('kind').notNull(),
    /** Basis points (percent) or minor units (fixed). */
    value: bigint('value', { mode: 'number' }).notNull(),
    currency: text('currency'),
    validFrom: date('valid_from', { mode: 'string' }),
    validTo: date('valid_to', { mode: 'string' }),
    maxUses: integer('max_uses'),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('promo_codes_tenant_code_key').on(t.tenantId, t.code)],
);

/* ------------------------------------------------------------------ */
/* Finance: the double-entry journal                                   */
/* ------------------------------------------------------------------ */

export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** asset | liability | equity | income | expense */
    type: text('type').notNull(),
    /** cash | bank | clearing | receivable | payable | tax | contra_income */
    subtype: text('subtype'),
    /** For an account held in one currency (a USD bank account). */
    currency: text('currency'),
    description: text('description'),
    /** The SYSTEM_ACCOUNTS key the system posts to; null for the consultancy's own. */
    systemKey: text('system_key'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ledger_accounts_tenant_code_key').on(t.tenantId, t.code),
    uniqueIndex('ledger_accounts_tenant_system_key').on(t.tenantId, t.systemKey).where(sql`system_key is not null`),
  ],
);

/**
 * A journal entry: one currency, balanced in it. Append-only - triggers
 * refuse updates and deletes, an entry whose lines do not balance cannot be
 * committed, and nothing can be dated inside a locked period. Corrections
 * are reversing entries.
 */
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    tenantId: tenantId(),
    /** JE-000123, per consultancy. */
    number: text('number').notNull(),
    entryDate: date('entry_date', { mode: 'string' }).notNull(),
    memo: text('memo').notNull(),
    currency: text('currency').notNull(),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
    /** JOURNAL_SOURCES: what posted it. */
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id'),
    reversalOf: uuid('reversal_of'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('journal_entries_tenant_number_key').on(t.tenantId, t.number),
    index('journal_entries_tenant_date_idx').on(t.tenantId, t.entryDate),
    index('journal_entries_source_idx').on(t.sourceType, t.sourceId),
    uniqueIndex('journal_entries_reversal_key').on(t.reversalOf).where(sql`reversal_of is not null`),
  ],
);

export const journalLines = pgTable(
  'journal_lines',
  {
    id: id(),
    tenantId: tenantId(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    debit: bigint('debit', { mode: 'number' }).notNull().default(0),
    credit: bigint('credit', { mode: 'number' }).notNull().default(0),
    description: text('description'),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'restrict' }),
  },
  (t) => [
    index('journal_lines_entry_idx').on(t.entryId),
    index('journal_lines_account_idx').on(t.tenantId, t.accountId),
    index('journal_lines_client_idx').on(t.clientId),
  ],
);

/* ------------------------------------------------------------------ */
/* Finance: around invoices                                            */
/* ------------------------------------------------------------------ */

/** An invoice paid in parts. The amounts add up to the invoice total. */
export const installments = pgTable(
  'installments',
  {
    id: id(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    label: text('label'),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    lateFeeInvoiceId: uuid('late_fee_invoice_id'),
  },
  (t) => [
    uniqueIndex('installments_invoice_seq_key').on(t.invoiceId, t.seq),
    index('installments_tenant_due_idx').on(t.tenantId, t.dueDate),
  ],
);

/** Money given back against an invoice without voiding it. CN-2026-0001. */
export const creditNotes = pgTable(
  'credit_notes',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    taxAmount: bigint('tax_amount', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull(),
    reason: text('reason').notNull(),
    issuedOn: date('issued_on', { mode: 'string' }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),
  },
  (t) => [
    uniqueIndex('credit_notes_tenant_number_key').on(t.tenantId, t.number),
    index('credit_notes_invoice_idx').on(t.invoiceId),
  ],
);

/** A quote or proforma invoice. QUO-2026-0001. Becomes an invoice when accepted. */
export const quotes = pgTable(
  'quotes',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    caseId: uuid('case_id').references(() => cases.id, { onDelete: 'set null' }),
    currency: text('currency').notNull(),
    issueDate: date('issue_date', { mode: 'string' }).notNull(),
    validUntil: date('valid_until', { mode: 'string' }).notNull(),
    /** draft | sent | accepted | declined | converted ("expired" is worked out). */
    status: text('status').notNull().default('draft'),
    proforma: boolean('proforma').notNull().default(false),
    /** The priced lines, as PricedLineView plus the ids they came from. */
    items: jsonb('items').$type<Record<string, unknown>[]>().notNull(),
    subtotal: bigint('subtotal', { mode: 'number' }).notNull(),
    discountTotal: bigint('discount_total', { mode: 'number' }).notNull().default(0),
    taxTotal: bigint('tax_total', { mode: 'number' }).notNull().default(0),
    total: bigint('total', { mode: 'number' }).notNull(),
    promoCodeId: uuid('promo_code_id').references(() => promoCodes.id, { onDelete: 'set null' }),
    /** The promotion as it was when quoted, so the invoice matches the quote. */
    promoSnapshot: jsonb('promo_snapshot').$type<{ id: string; kind: 'percent' | 'fixed'; value: number; code: string } | null>(),
    notes: text('notes'),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    decisionNote: text('decision_note'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('quotes_tenant_number_key').on(t.tenantId, t.number),
    index('quotes_tenant_client_idx').on(t.tenantId, t.clientId),
  ],
);

/** A student's "I have paid": the proof, waiting for someone to check it. */
export const paymentSubmissions = pgTable(
  'payment_submissions',
  {
    id: id(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    method: paymentMethodEnum('method').notNull(),
    reference: text('reference'),
    paidOn: date('paid_on', { mode: 'string' }).notNull(),
    note: text('note'),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    /** pending | approved | rejected */
    status: text('status').notNull().default('pending'),
    reviewNote: text('review_note'),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    submittedBy: uuid('submitted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('payment_submissions_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
    index('payment_submissions_invoice_idx').on(t.invoiceId),
  ],
);

/** A checkout started with a payment gateway. Completed once, by the provider's word. */
export const onlinePayments = pgTable(
  'online_payments',
  {
    id: id(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    provider: text('provider').notNull(),
    providerRef: text('provider_ref'),
    url: text('url'),
    /** created | paid | failed | cancelled ("expired" is worked out). */
    status: text('status').notNull().default('created'),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    startedBy: uuid('started_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('online_payments_provider_ref_key').on(t.provider, t.providerRef).where(sql`provider_ref is not null`),
    index('online_payments_invoice_idx').on(t.invoiceId),
  ],
);

/** A refund someone asked for; someone else approves it. */
export const refundRequests = pgTable(
  'refund_requests',
  {
    id: id(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'restrict' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    method: paymentMethodEnum('method').notNull(),
    accountId: uuid('account_id').references(() => ledgerAccounts.id, { onDelete: 'set null' }),
    reason: text('reason').notNull(),
    /** pending | approved | rejected | cancelled */
    status: text('status').notNull().default('pending'),
    requestedBy: uuid('requested_by').references(() => users.id, { onDelete: 'set null' }),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    paymentId: uuid('payment_id').references(() => payments.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('refund_requests_tenant_status_idx').on(t.tenantId, t.status),
    index('refund_requests_invoice_idx').on(t.invoiceId),
  ],
);

/** Reminders already sent, so the hourly sweep sends each one once. */
export const financeReminders = pgTable(
  'finance_reminders',
  {
    id: id(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    /** The installment, or null for the invoice's own due date. */
    installmentId: uuid('installment_id').references(() => installments.id, { onDelete: 'cascade' }),
    /** Days from the due date this reminder was for. */
    offsetDays: integer('offset_days').notNull(),
    sentAt: createdAt(),
  },
  (t) => [
    uniqueIndex('finance_reminders_key').on(t.invoiceId, sql`coalesce(installment_id, '00000000-0000-0000-0000-000000000000'::uuid)`, t.offsetDays),
  ],
);

/* ------------------------------------------------------------------ */
/* Finance: spending                                                   */
/* ------------------------------------------------------------------ */

/** Money spent and paid at once. EXP-2026-0001. */
export const expenses = pgTable(
  'expenses',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    spentOn: date('spent_on', { mode: 'string' }).notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    vendor: text('vendor').notNull(),
    description: text('description').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    taxAmount: bigint('tax_amount', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull(),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
    paidFromAccountId: uuid('paid_from_account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    method: paymentMethodEnum('method').notNull(),
    reference: text('reference'),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'restrict' }),
    caseId: uuid('case_id').references(() => cases.id, { onDelete: 'set null' }),
    receiptKey: text('receipt_key'),
    receiptName: text('receipt_name'),
    receiptMime: text('receipt_mime'),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),
  },
  (t) => [
    uniqueIndex('expenses_tenant_number_key').on(t.tenantId, t.number),
    index('expenses_tenant_date_idx').on(t.tenantId, t.spentOn),
  ],
);

/** A bill to pay later. BIL-2026-0001. */
export const bills = pgTable(
  'bills',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    vendor: text('vendor').notNull(),
    vendorReference: text('vendor_reference'),
    issueDate: date('issue_date', { mode: 'string' }).notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    description: text('description').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    taxAmount: bigint('tax_amount', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull(),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
    /** open | paid | void */
    status: text('status').notNull().default('open'),
    paidOn: date('paid_on', { mode: 'string' }),
    paidFromAccountId: uuid('paid_from_account_id').references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    method: paymentMethodEnum('method'),
    reference: text('reference'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
  },
  (t) => [
    uniqueIndex('bills_tenant_number_key').on(t.tenantId, t.number),
    index('bills_tenant_status_due_idx').on(t.tenantId, t.status, t.dueDate),
  ],
);

/* ------------------------------------------------------------------ */
/* Finance: the bank and the cash drawer                               */
/* ------------------------------------------------------------------ */

export const bankImports = pgTable('bank_imports', {
  id: id(),
  tenantId: tenantId(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
  fileName: text('file_name').notNull(),
  lineCount: integer('line_count').notNull(),
  importedBy: uuid('imported_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
});

/** One line of a bank statement. Positive is money in. */
export const bankLines = pgTable(
  'bank_lines',
  {
    id: id(),
    tenantId: tenantId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    importId: uuid('import_id').references(() => bankImports.id, { onDelete: 'cascade' }),
    lineDate: date('line_date', { mode: 'string' }).notNull(),
    description: text('description').notNull(),
    reference: text('reference'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    /** Date, amount, text and position, so re-importing a statement adds nothing twice. */
    fingerprint: text('fingerprint').notNull(),
    matchedLineId: uuid('matched_line_id').references(() => journalLines.id, { onDelete: 'restrict' }),
    matchedBy: uuid('matched_by').references(() => users.id, { onDelete: 'set null' }),
    matchedAt: timestamp('matched_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('bank_lines_fingerprint_key').on(t.accountId, t.fingerprint),
    uniqueIndex('bank_lines_matched_key').on(t.matchedLineId).where(sql`matched_line_id is not null`),
    index('bank_lines_account_date_idx').on(t.accountId, t.lineDate),
  ],
);

/** The cash counted at the end of a day, against what the books say. */
export const dayCloses = pgTable(
  'day_closes',
  {
    id: id(),
    tenantId: tenantId(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    closeDate: date('close_date', { mode: 'string' }).notNull(),
    currency: text('currency').notNull(),
    expected: bigint('expected', { mode: 'number' }).notNull(),
    counted: bigint('counted', { mode: 'number' }).notNull(),
    note: text('note'),
    entryId: uuid('entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('day_closes_key').on(t.accountId, t.closeDate, t.currency)],
);

/* ------------------------------------------------------------------ */
/* University commissions                                              */
/* ------------------------------------------------------------------ */

export const institutions = pgTable(
  'institutions',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    country: text('country').notNull(),
    city: text('city'),
    type: text('type').notNull().default('university'),
    website: text('website'),
    currency: text('currency').notNull(),
    aggregator: text('aggregator'),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('institutions_tenant_name_key').on(t.tenantId, sql`lower(${t.name})`),
    index('institutions_tenant_country_idx').on(t.tenantId, t.country),
  ],
);

export const institutionContacts = pgTable(
  'institution_contacts',
  {
    id: id(),
    tenantId: tenantId(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role'),
    email: text('email'),
    phone: text('phone'),
    primary: boolean('is_primary').notNull().default(false),
    position: integer('position').notNull().default(0),
  },
  (t) => [index('institution_contacts_institution_idx').on(t.institutionId)],
);

/** An agency agreement with an institution, valid between two dates. */
export const commissionAgreements = pgTable(
  'commission_agreements',
  {
    id: id(),
    tenantId: tenantId(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    title: text('title').notNull(),
    reference: text('reference'),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    currency: text('currency').notNull(),
    claimAfterDays: integer('claim_after_days').notNull().default(30),
    paymentTermsDays: integer('payment_terms_days').notNull().default(45),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    /** Bumped each time its rules change; commissions keep the terms they were earned under. */
    version: integer('version').notNull().default(1),
    documentKey: text('document_key'),
    documentName: text('document_name'),
    documentMime: text('document_mime'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('commission_agreements_institution_idx').on(t.institutionId, t.validFrom)],
);

export const commissionRules = pgTable(
  'commission_rules',
  {
    id: id(),
    tenantId: tenantId(),
    agreementId: uuid('agreement_id')
      .notNull()
      .references(() => commissionAgreements.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    /** percent | fixed */
    basis: text('basis').notNull(),
    rateBp: integer('rate_bp').notNull().default(0),
    fixedAmount: bigint('fixed_amount', { mode: 'number' }).notNull().default(0),
    /** first_year | each_year */
    years: text('years').notNull().default('first_year'),
    yearCount: integer('year_count').notNull().default(1),
    tiers: jsonb('tiers').$type<{ fromStudents: number; ratePercent: number }[]>().notNull().default(sql`'[]'::jsonb`),
    bonusStudents: integer('bonus_students'),
    bonusAmount: bigint('bonus_amount', { mode: 'number' }),
    conditions: jsonb('conditions').$type<Condition[]>().notNull().default(sql`'[]'::jsonb`),
    retentionDays: integer('retention_days').notNull().default(0),
    triggerStage: text('trigger_stage').notNull().default('fee_payment'),
  },
  (t) => [index('commission_rules_agreement_idx').on(t.agreementId, t.position)],
);

/** A claim sent to an institution for a batch of commissions. CLM-2026-0001. */
export const commissionClaims = pgTable(
  'commission_claims',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    currency: text('currency').notNull(),
    periodLabel: text('period_label').notNull(),
    /** draft | submitted | disputed | paid | cancelled */
    status: text('status').notNull().default('draft'),
    submittedOn: date('submitted_on', { mode: 'string' }),
    dueOn: date('due_on', { mode: 'string' }),
    lastFollowUpAt: timestamp('last_follow_up_at', { withTimezone: true }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('commission_claims_tenant_number_key').on(t.tenantId, t.number),
    index('commission_claims_institution_idx').on(t.institutionId, t.status),
  ],
);

/** One commission: a student's year, a bonus, or an adjustment. COM-2026-0001. */
export const commissions = pgTable(
  'commissions',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    /** student | bonus | adjustment */
    kind: text('kind').notNull().default('student'),
    caseId: uuid('case_id').references(() => cases.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'restrict' }),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    agreementId: uuid('agreement_id').references(() => commissionAgreements.id, { onDelete: 'restrict' }),
    ruleId: uuid('rule_id').references(() => commissionRules.id, { onDelete: 'set null' }),
    /** The rule as it was when this was worked out. */
    ruleSnapshot: jsonb('rule_snapshot').$type<Record<string, unknown> | null>(),
    yearNo: integer('year_no').notNull().default(1),
    intake: text('intake'),
    tuition: bigint('tuition', { mode: 'number' }),
    rateBp: integer('rate_bp'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
    /** expected | confirmed | claimed | disputed | written_off | clawed_back | cancelled */
    status: text('status').notNull().default('expected'),
    claimableOn: date('claimable_on', { mode: 'string' }),
    expectedOn: date('expected_on', { mode: 'string' }),
    retentionUntil: date('retention_until', { mode: 'string' }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    claimId: uuid('claim_id').references(() => commissionClaims.id, { onDelete: 'set null' }),
    /** Clawed back or written off: how much. */
    adjustedAmount: bigint('adjusted_amount', { mode: 'number' }).notNull().default(0),
    note: text('note'),
    dueNotifiedAt: timestamp('due_notified_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('commissions_tenant_number_key').on(t.tenantId, t.number),
    // A rule earns once per student per year of the course.
    uniqueIndex('commissions_case_rule_year_key').on(t.caseId, t.agreementId, t.yearNo).where(sql`kind = 'student' and status <> 'cancelled'`),
    index('commissions_tenant_status_idx').on(t.tenantId, t.status),
    index('commissions_institution_idx').on(t.institutionId, t.status),
    index('commissions_case_idx').on(t.caseId),
    index('commissions_claim_idx').on(t.claimId),
  ],
);

/** Money from an institution, matched to the commissions it pays. CRX-2026-0001. */
export const institutionReceipts = pgTable(
  'institution_receipts',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    receivedOn: date('received_on', { mode: 'string' }).notNull(),
    currency: text('currency').notNull(),
    /** Gross: what the institution sent. */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    bankCharges: bigint('bank_charges', { mode: 'number' }).notNull().default(0),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    method: paymentMethodEnum('method').notNull().default('bank_transfer'),
    reference: text('reference'),
    claimId: uuid('claim_id').references(() => commissionClaims.id, { onDelete: 'set null' }),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),
  },
  (t) => [
    uniqueIndex('institution_receipts_tenant_number_key').on(t.tenantId, t.number),
    index('institution_receipts_institution_idx').on(t.institutionId, t.receivedOn),
  ],
);

export const receiptAllocations = pgTable(
  'receipt_allocations',
  {
    id: id(),
    tenantId: tenantId(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => institutionReceipts.id, { onDelete: 'cascade' }),
    commissionId: uuid('commission_id')
      .notNull()
      .references(() => commissions.id, { onDelete: 'restrict' }),
    /** In the commission's currency; negative is a deduction for a clawback. */
    amount: bigint('amount', { mode: 'number' }).notNull(),
    /** (rate received - rate booked) x amount, in the base currency. */
    fxDifference: bigint('fx_difference', { mode: 'number' }).notNull().default(0),
  },
  (t) => [index('receipt_allocations_commission_idx').on(t.commissionId), index('receipt_allocations_receipt_idx').on(t.receiptId)],
);

/** A member of staff's share of a commission: their incentive. */
export const commissionSplits = pgTable(
  'commission_splits',
  {
    id: id(),
    tenantId: tenantId(),
    commissionId: uuid('commission_id')
      .notNull()
      .references(() => commissions.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    shareBp: integer('share_bp').notNull(),
    paidOn: date('paid_on', { mode: 'string' }),
    paidAmount: bigint('paid_amount', { mode: 'number' }),
    paidBy: uuid('paid_by').references(() => users.id, { onDelete: 'set null' }),
    accountId: uuid('account_id').references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
  },
  (t) => [uniqueIndex('commission_splits_key').on(t.commissionId, t.userId), index('commission_splits_user_idx').on(t.userId)],
);

export const commissionSettings = pgTable('commission_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  consultantShareBp: integer('consultant_share_bp').notNull().default(0),
  followUpDays: integer('follow_up_days').notNull().default(14),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Partners (M6)                                                        */
/* ------------------------------------------------------------------ */

/** A sub-agent or referral partner - an organisation or a freelancer. */
export const partners = pgTable(
  'partners',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    name: text('name').notNull(),
    /** sub_agent | referral */
    kind: text('kind').notNull().default('sub_agent'),
    /** applied | onboarding | active | suspended | terminated */
    status: text('status').notNull().default('onboarding'),
    /** standard | silver | gold | platinum */
    tier: text('tier').notNull().default('standard'),
    contactName: text('contact_name').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    country: text('country').notNull(),
    city: text('city'),
    address: text('address'),
    website: text('website'),
    registrationNumber: text('registration_number'),
    taxId: text('tax_id'),
    managerUserId: uuid('manager_user_id').references(() => users.id, { onDelete: 'set null' }),
    parentPartnerId: uuid('parent_partner_id').references((): AnyPgColumn => partners.id, { onDelete: 'set null' }),
    overrideBp: integer('override_bp').notNull().default(0),
    /** Null: the consultancy's default. */
    withholdingBp: integer('withholding_bp'),
    currency: text('currency').notNull().default('PKR'),
    /** Sealed with the server's key (auth/secret-box); shown masked. */
    bankSealed: text('bank_sealed'),
    /** applied | added */
    source: text('source').notNull().default('added'),
    application: jsonb('application').$type<{ studentsPerYear: number | null; message: string | null } | null>(),
    notes: text('notes'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('partners_tenant_number_key').on(t.tenantId, t.number),
    uniqueIndex('partners_tenant_email_key').on(t.tenantId, sql`lower(${t.email})`),
    index('partners_tenant_status_idx').on(t.tenantId, t.status),
    index('partners_parent_idx').on(t.parentPartnerId),
  ],
);

/** A partner's people: each one a `partner` user. */
export const partnerMembers = pgTable(
  'partner_members',
  {
    id: id(),
    tenantId: tenantId(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** owner | admin | counsellor */
    role: text('role').notNull().default('counsellor'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('partner_members_user_key').on(t.userId), index('partner_members_partner_idx').on(t.partnerId)],
);

/** Registration papers (KYC). */
export const partnerDocuments = pgTable(
  'partner_documents',
  {
    id: id(),
    tenantId: tenantId(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    storageKey: text('storage_key').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    /** pending | approved | rejected */
    status: text('status').notNull().default('pending'),
    reviewNote: text('review_note'),
    uploadedBy: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedBy: uuid('reviewed_by').references(() => users.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('partner_documents_partner_idx').on(t.partnerId, t.kind)],
);

/** The partner agreement, signed in the app. */
export const partnerAgreements = pgTable(
  'partner_agreements',
  {
    id: id(),
    tenantId: tenantId(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    title: text('title').notNull(),
    body: text('body').notNull(),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    /** draft | sent | signed | void */
    status: text('status').notNull().default('draft'),
    documentHash: text('document_hash'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentBy: uuid('sent_by').references(() => users.id, { onDelete: 'set null' }),
    signedAt: timestamp('signed_at', { withTimezone: true }),
    signedBy: uuid('signed_by').references(() => users.id, { onDelete: 'set null' }),
    signerName: text('signer_name'),
    signerTitle: text('signer_title'),
    signatureKind: text('signature_kind'),
    signature: text('signature'),
    signerIp: text('signer_ip'),
    signerUserAgent: text('signer_user_agent'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('partner_agreements_partner_idx').on(t.partnerId, t.version)],
);

/** What partners earn. A change makes a new version; earnings keep the one they were made under. */
export const partnerRules = pgTable(
  'partner_rules',
  {
    id: id(),
    tenantId: tenantId(),
    ruleKey: uuid('rule_key').notNull(),
    version: integer('version').notNull().default(1),
    supersededAt: timestamp('superseded_at', { withTimezone: true }),
    name: text('name').notNull(),
    /** commission_share | fixed_per_student | fee_share */
    basis: text('basis').notNull(),
    rateBp: integer('rate_bp').notNull().default(0),
    fixedAmount: bigint('fixed_amount', { mode: 'number' }).notNull().default(0),
    currency: text('currency'),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'cascade' }),
    tier: text('tier'),
    institutionId: uuid('institution_id').references(() => institutions.id, { onDelete: 'set null' }),
    feeCategories: jsonb('fee_categories').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    conditions: jsonb('conditions').$type<Condition[]>().notNull().default(sql`'[]'::jsonb`),
    validFrom: date('valid_from', { mode: 'string' }).notNull(),
    validTo: date('valid_to', { mode: 'string' }),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('partner_rules_tenant_idx').on(t.tenantId, t.basis), uniqueIndex('partner_rules_key_version').on(t.ruleKey, t.version)],
);

/** One amount a partner earned (or gave back). Booked to the ledger when created. */
export const partnerEarnings = pgTable(
  'partner_earnings',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    /** commission_share | fixed_per_student | fee_share | override | adjustment | clawback */
    kind: text('kind').notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    /** The sub-agent whose student it was (overrides). */
    fromPartnerId: uuid('from_partner_id').references(() => partners.id, { onDelete: 'set null' }),
    /** What gave rise to it: commission, receipt allocation, payment, another earning... */
    sourceType: text('source_type'),
    sourceId: uuid('source_id'),
    /** The earning a clawback or override is of. */
    relatedEarningId: uuid('related_earning_id'),
    ruleId: uuid('rule_id').references(() => partnerRules.id, { onDelete: 'set null' }),
    description: text('description').notNull(),
    basisAmount: bigint('basis_amount', { mode: 'number' }),
    /** The currency the basis was in, when the earning was converted into the partner's. */
    basisCurrency: text('basis_currency'),
    rateBp: integer('rate_bp'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: text('currency').notNull(),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
    /** payable | on_payout | paid | reversed */
    status: text('status').notNull().default('payable'),
    earnedOn: date('earned_on', { mode: 'string' }).notNull(),
    payoutId: uuid('payout_id').references((): AnyPgColumn => payouts.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('partner_earnings_tenant_number_key').on(t.tenantId, t.number),
    index('partner_earnings_partner_status_idx').on(t.partnerId, t.status),
    index('partner_earnings_source_idx').on(t.sourceType, t.sourceId),
    index('partner_earnings_payout_idx').on(t.payoutId),
    // One earning of a kind per source per partner: an event delivered twice earns once.
    uniqueIndex('partner_earnings_source_key')
      .on(t.partnerId, t.kind, t.sourceType, t.sourceId)
      .where(sql`source_id is not null and kind <> 'adjustment'`),
  ],
);

export const payouts = pgTable(
  'payouts',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    currency: text('currency').notNull(),
    periodLabel: text('period_label').notNull(),
    /** draft | approved | paid | void */
    status: text('status').notNull().default('draft'),
    gross: bigint('gross', { mode: 'number' }).notNull(),
    withholdingBp: integer('withholding_bp').notNull().default(0),
    withholding: bigint('withholding', { mode: 'number' }).notNull().default(0),
    advanceRecovered: bigint('advance_recovered', { mode: 'number' }).notNull().default(0),
    net: bigint('net', { mode: 'number' }).notNull(),
    notes: text('notes'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    paidOn: date('paid_on', { mode: 'string' }),
    accountId: uuid('account_id').references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    method: paymentMethodEnum('method'),
    reference: text('reference'),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
    paidBy: uuid('paid_by').references(() => users.id, { onDelete: 'set null' }),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: uuid('voided_by').references(() => users.id, { onDelete: 'set null' }),
    voidReason: text('void_reason'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('payouts_tenant_number_key').on(t.tenantId, t.number), index('payouts_partner_idx').on(t.partnerId, t.status)],
);

/** Money paid to a partner ahead of what it earns, taken back from its payouts. */
export const partnerAdvances = pgTable(
  'partner_advances',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    recovered: bigint('recovered', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull(),
    givenOn: date('given_on', { mode: 'string' }).notNull(),
    accountId: uuid('account_id').references(() => ledgerAccounts.id, { onDelete: 'restrict' }),
    fxRate: numeric('fx_rate', { precision: 18, scale: 8 }),
    reason: text('reason').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidReason: text('void_reason'),
  },
  (t) => [uniqueIndex('partner_advances_tenant_number_key').on(t.tenantId, t.number), index('partner_advances_partner_idx').on(t.partnerId)],
);

/** How much of which advance each payout took back - so a void can give it back. */
export const advanceRecoveries = pgTable(
  'advance_recoveries',
  {
    id: id(),
    tenantId: tenantId(),
    advanceId: uuid('advance_id')
      .notNull()
      .references(() => partnerAdvances.id, { onDelete: 'restrict' }),
    payoutId: uuid('payout_id')
      .notNull()
      .references(() => payouts.id, { onDelete: 'cascade' }),
    amount: bigint('amount', { mode: 'number' }).notNull(),
  },
  (t) => [index('advance_recoveries_payout_idx').on(t.payoutId), index('advance_recoveries_advance_idx').on(t.advanceId)],
);

/** A partner registered a student someone else already has. */
export const attributionConflicts = pgTable(
  'attribution_conflicts',
  {
    id: id(),
    tenantId: tenantId(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    currentPartnerId: uuid('current_partner_id').references(() => partners.id, { onDelete: 'set null' }),
    claimantPartnerId: uuid('claimant_partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    claimedBy: uuid('claimed_by').references(() => users.id, { onDelete: 'set null' }),
    matchedOn: jsonb('matched_on').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    submitted: jsonb('submitted').$type<{ fullName: string; email: string; phone: string; passportNumber: string | null; notes: string | null }>().notNull(),
    /** open | kept | transferred */
    status: text('status').notNull().default('open'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionNote: text('decision_note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('attribution_conflicts_tenant_status_idx').on(t.tenantId, t.status),
    // One open claim per student per partner.
    uniqueIndex('attribution_conflicts_open_key').on(t.clientId, t.claimantPartnerId).where(sql`status = 'open'`),
  ],
);

/** A partner's conversation with the consultancy. */
export const partnerMessages = pgTable(
  'partner_messages',
  {
    id: id(),
    tenantId: tenantId(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    fromPartner: boolean('from_partner').notNull(),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('partner_messages_partner_idx').on(t.partnerId, t.createdAt)],
);

export const partnerSettings = pgTable('partner_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  applicationsOpen: boolean('applications_open').notNull().default(true),
  attributionDays: integer('attribution_days').notNull().default(365),
  defaultWithholdingBp: integer('default_withholding_bp').notNull().default(0),
  requireSecondApprover: boolean('require_second_approver').notNull().default(true),
  minimumPayout: bigint('minimum_payout', { mode: 'number' }).notNull().default(0),
  tierThresholds: jsonb('tier_thresholds')
    .$type<{ silver: number; gold: number; platinum: number }>()
    .notNull()
    .default(sql`'{"silver":5,"gold":15,"platinum":40}'::jsonb`),
  agreementTemplate: text('agreement_template').notNull().default(''),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

/* ------------------------------------------------------------------ */
/* Courses and test preparation (M3)                                    */
/* ------------------------------------------------------------------ */

export const courses = pgTable(
  'courses',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    testType: text('test_type').notNull().default('none'),
    level: text('level').notNull().default('any'),
    mode: text('mode').notNull().default('in_person'),
    description: text('description'),
    durationWeeks: integer('duration_weeks').notNull().default(6),
    /** Hundredths of an hour: 7.5 hours is 750. */
    hoursPerWeek: integer('hours_per_week').notNull().default(600),
    fee: bigint('fee', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull().default('PKR'),
    packageId: uuid('package_id').references(() => servicePackages.id, { onDelete: 'set null' }),
    capacity: integer('capacity').notNull().default(20),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('courses_tenant_code_key').on(t.tenantId, t.code)],
);

export const batches = pgTable(
  'batches',
  {
    id: id(),
    tenantId: tenantId(),
    courseId: uuid('course_id')
      .notNull()
      .references(() => courses.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),
    days: jsonb('days').$type<number[]>().notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    location: text('location'),
    onlineLink: text('online_link'),
    capacity: integer('capacity').notNull(),
    /** Null: the course's own fee. */
    fee: bigint('fee', { mode: 'number' }),
    /** planned | enrolling | running | completed | cancelled */
    status: text('status').notNull().default('enrolling'),
    notes: text('notes'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('batches_tenant_code_key').on(t.tenantId, t.code), index('batches_course_idx').on(t.courseId, t.startDate)],
);

export const batchTrainers = pgTable(
  'batch_trainers',
  {
    id: id(),
    tenantId: tenantId(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [uniqueIndex('batch_trainers_key').on(t.batchId, t.userId), index('batch_trainers_user_idx').on(t.userId)],
);

export const classSessions = pgTable(
  'class_sessions',
  {
    id: id(),
    tenantId: tenantId(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    date: date('date', { mode: 'string' }).notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    topic: text('topic'),
    cancelled: boolean('cancelled').notNull().default(false),
  },
  (t) => [index('class_sessions_batch_idx').on(t.batchId, t.date)],
);

export const enrollments = pgTable(
  'enrollments',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'restrict' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    /** waitlisted | enrolled | frozen | transferred | dropped | completed */
    status: text('status').notNull().default('enrolled'),
    /** Order on the waiting list: earlier first. */
    waitlistedAt: timestamp('waitlisted_at', { withTimezone: true }),
    targetScore: numeric('target_score', { precision: 7, scale: 2 }),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'set null' }),
    transferredFromId: uuid('transferred_from_id'),
    frozenFrom: date('frozen_from', { mode: 'string' }),
    frozenUntil: date('frozen_until', { mode: 'string' }),
    freezeReason: text('freeze_reason'),
    droppedAt: timestamp('dropped_at', { withTimezone: true }),
    dropReason: text('drop_reason'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    certificateNumber: text('certificate_number'),
    /** The absence streak last alerted about, so each streak is reported once. */
    absenceAlertedAt: timestamp('absence_alerted_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('enrollments_tenant_number_key').on(t.tenantId, t.number),
    // A student is in a batch once, while that place is live.
    uniqueIndex('enrollments_live_key').on(t.batchId, t.clientId).where(sql`status in ('waitlisted', 'enrolled', 'frozen', 'completed')`),
    index('enrollments_client_idx').on(t.clientId),
    index('enrollments_batch_status_idx').on(t.batchId, t.status),
  ],
);

export const attendance = pgTable(
  'attendance',
  {
    id: id(),
    tenantId: tenantId(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => classSessions.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    /** present | late | absent | excused */
    status: text('status').notNull(),
    note: text('note'),
    markedBy: uuid('marked_by').references(() => users.id, { onDelete: 'set null' }),
    markedAt: timestamp('marked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('attendance_key').on(t.sessionId, t.enrollmentId), index('attendance_enrollment_idx').on(t.enrollmentId)],
);

export const assessments = pgTable(
  'assessments',
  {
    id: id(),
    tenantId: tenantId(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** diagnostic | mock | quiz */
    kind: text('kind').notNull().default('mock'),
    heldOn: date('held_on', { mode: 'string' }).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('assessments_batch_idx').on(t.batchId, t.heldOn)],
);

export const assessmentScores = pgTable(
  'assessment_scores',
  {
    id: id(),
    tenantId: tenantId(),
    assessmentId: uuid('assessment_id')
      .notNull()
      .references(() => assessments.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    scores: jsonb('scores').$type<Record<string, number | null>>().notNull(),
    overall: numeric('overall', { precision: 7, scale: 2 }),
    feedback: text('feedback'),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('assessment_scores_key').on(t.assessmentId, t.enrollmentId)],
);

export const testResults = pgTable(
  'test_results',
  {
    id: id(),
    tenantId: tenantId(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    testType: text('test_type').notNull(),
    /** booked | taken | result | cancelled */
    status: text('status').notNull().default('booked'),
    testDate: date('test_date', { mode: 'string' }).notNull(),
    bookedOn: date('booked_on', { mode: 'string' }),
    venue: text('venue'),
    reference: text('reference'),
    scores: jsonb('scores').$type<Record<string, number | null>>().notNull().default(sql`'{}'::jsonb`),
    overall: numeric('overall', { precision: 7, scale: 2 }),
    expiresOn: date('expires_on', { mode: 'string' }),
    documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
    notes: text('notes'),
    recordedBy: uuid('recorded_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('test_results_client_idx').on(t.clientId, t.testDate)],
);

export const homework = pgTable(
  'homework',
  {
    id: id(),
    tenantId: tenantId(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => batches.id, { onDelete: 'cascade' }),
    /** homework | material */
    kind: text('kind').notNull().default('homework'),
    title: text('title').notNull(),
    instructions: text('instructions'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    maxScore: numeric('max_score', { precision: 7, scale: 2 }),
    fileKey: text('file_key'),
    fileName: text('file_name'),
    fileMime: text('file_mime'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('homework_batch_idx').on(t.batchId, t.createdAt)],
);

export const homeworkSubmissions = pgTable(
  'homework_submissions',
  {
    id: id(),
    tenantId: tenantId(),
    homeworkId: uuid('homework_id')
      .notNull()
      .references(() => homework.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    text: text('text'),
    fileKey: text('file_key'),
    fileName: text('file_name'),
    fileMime: text('file_mime'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    /** submitted | graded | returned */
    status: text('status').notNull().default('submitted'),
    score: numeric('score', { precision: 7, scale: 2 }),
    feedback: text('feedback'),
    gradedBy: uuid('graded_by').references(() => users.id, { onDelete: 'set null' }),
    gradedAt: timestamp('graded_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('homework_submissions_key').on(t.homeworkId, t.enrollmentId)],
);

export const courseSettings = pgTable('course_settings', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  absenceAlertAfter: integer('absence_alert_after').notNull().default(2),
  certificateMinAttendance: integer('certificate_min_attendance').notNull().default(75),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

/**
 * Someone interested in a course who has not enrolled yet: a walk-in, a call,
 * the website form. Followed up until they enrol (and become a student) or
 * are let go with a reason.
 */
export const courseEnquiries = pgTable(
  'course_enquiries',
  {
    id: id(),
    tenantId: tenantId(),
    /** ENQ-2026-0001, numbered per consultancy. */
    number: text('number').notNull(),
    fullName: text('full_name').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    city: text('city'),
    courseId: uuid('course_id').references(() => courses.id, { onDelete: 'set null' }),
    /** The batch they would like, when they have a preference. */
    batchId: uuid('batch_id').references(() => batches.id, { onDelete: 'set null' }),
    /** walk_in | phone | whatsapp | website | social | referral | partner | other */
    source: text('source').notNull().default('walk_in'),
    /** new | contacted | trial_booked | trial_done | enrolled | lost */
    status: text('status').notNull().default('new'),
    /** Also thinking of studying abroad - worth a consultant's call. */
    studyAbroad: boolean('study_abroad').notNull().default(false),
    targetScore: numeric('target_score', { precision: 7, scale: 2 }),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    followUpOn: date('follow_up_on', { mode: 'string' }),
    /** The class they sit in on before deciding. */
    trialSessionId: uuid('trial_session_id').references(() => classSessions.id, { onDelete: 'set null' }),
    /** attended | no_show, once the trial class has happened */
    trialOutcome: text('trial_outcome'),
    lostReason: text('lost_reason'),
    /** Their client record: an existing one, or the one made when they enrolled. */
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    enrollmentId: uuid('enrollment_id').references(() => enrollments.id, { onDelete: 'set null' }),
    notes: text('notes'),
    lastContactAt: timestamp('last_contact_at', { withTimezone: true }),
    /** When the follow-up reminder for followUpOn was sent, so it is sent once. */
    remindedOn: date('reminded_on', { mode: 'string' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('course_enquiries_tenant_number_key').on(t.tenantId, t.number),
    index('course_enquiries_tenant_status_idx').on(t.tenantId, t.status, t.followUpOn),
    index('course_enquiries_assigned_idx').on(t.assignedTo, t.status),
    index('course_enquiries_trial_idx').on(t.trialSessionId),
    index('course_enquiries_client_idx').on(t.clientId),
  ],
);

/** What happened with an enquiry: calls, notes, the trial, the outcome. */
export const courseEnquiryEvents = pgTable(
  'course_enquiry_events',
  {
    id: id(),
    tenantId: tenantId(),
    enquiryId: uuid('enquiry_id')
      .notNull()
      .references(() => courseEnquiries.id, { onDelete: 'cascade' }),
    /** created | note | call | status | trial | enrolled | lost | reopened | assigned */
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('course_enquiry_events_enquiry_idx').on(t.enquiryId, t.createdAt)],
);

/* ------------------------------------------------------------------ */
/* Tasks + announcements                                               */
/* ------------------------------------------------------------------ */

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    notes: text('notes'),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id').references(() => cases.id, { onDelete: 'cascade' }),
    assigneeId: uuid('assignee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    priority: taskPriorityEnum('priority').notNull().default('normal'),
    status: taskStatusEnum('status').notNull().default('open'),
    escalated: boolean('escalated').notNull().default(false),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
    /** Set when the overdue alert goes out, so it goes out once per due date. */
    overdueNotifiedAt: timestamp('overdue_notified_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('tasks_tenant_assignee_idx').on(t.tenantId, t.assigneeId, t.status, t.dueAt),
    index('tasks_tenant_status_due_idx').on(t.tenantId, t.status, t.dueAt),
    index('tasks_case_idx').on(t.caseId),
    index('tasks_client_idx').on(t.clientId),
  ],
);

export const announcements = pgTable(
  'announcements',
  {
    id: id(),
    tenantId: tenantId(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    audience: audienceEnum('audience').notNull().default('everyone'),
    pinned: boolean('pinned').notNull().default(false),
    expiresOn: date('expires_on', { mode: 'string' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('announcements_tenant_created_idx').on(t.tenantId, t.createdAt.desc())],
);

/* ------------------------------------------------------------------ */
/* Relations                                                           */
/* ------------------------------------------------------------------ */
/* Countries, workflows and automations                                */
/* ------------------------------------------------------------------ */

/** What a consultancy knows about a destination: intakes, fees, funds, tests. */
export const countries = pgTable(
  'countries',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    active: boolean('active').notNull().default(true),
    currency: text('currency').notNull(),
    intakes: jsonb('intakes').$type<CountryIntake[]>().notNull().default(sql`'[]'::jsonb`),
    fees: jsonb('fees').$type<CountryFee[]>().notNull().default(sql`'[]'::jsonb`),
    proofOfFunds: jsonb('proof_of_funds').$type<ProofOfFunds | null>(),
    languageRequirements: jsonb('language_requirements').$type<LanguageRequirement[]>().notNull().default(sql`'[]'::jsonb`),
    visaTypes: jsonb('visa_types').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    visaProcessingDays: integer('visa_processing_days'),
    workRights: text('work_rights'),
    postStudyWork: text('post_study_work'),
    notes: text('notes'),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('countries_tenant_name_key').on(t.tenantId, sql`lower(${t.name})`)],
);

/** A named pipeline, aimed at a country (and optionally a level and visa type). */
export const workflowTemplates = pgTable(
  'workflow_templates',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    description: text('description'),
    country: text('country'),
    studyLevel: text('study_level'),
    visaType: text('visa_type'),
    /** The consultancy's fallback - "Standard". Exactly one per consultancy. */
    isDefault: boolean('is_default').notNull().default(false),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('workflow_templates_tenant_idx').on(t.tenantId, t.country),
    uniqueIndex('workflow_templates_default_key').on(t.tenantId).where(sql`is_default`),
    uniqueIndex('workflow_templates_tenant_name_key').on(t.tenantId, sql`lower(${t.name})`),
  ],
);

/**
 * One version of a workflow. A published version is never edited - a trigger
 * refuses changes to its stages - so an application always runs on exactly
 * the stages it started with. At most one draft per workflow.
 */
export const workflowVersions = pgTable(
  'workflow_versions',
  {
    id: id(),
    tenantId: tenantId(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => workflowTemplates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    /** draft | published | retired */
    status: text('status').notNull().default('draft'),
    notes: text('notes'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    publishedBy: uuid('published_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('workflow_versions_template_version_key').on(t.templateId, t.version),
    uniqueIndex('workflow_versions_one_draft_key').on(t.templateId).where(sql`status = 'draft'`),
    index('workflow_versions_tenant_idx').on(t.tenantId),
  ],
);

export const workflowStages = pgTable(
  'workflow_stages',
  {
    id: id(),
    tenantId: tenantId(),
    versionId: uuid('version_id')
      .notNull()
      .references(() => workflowVersions.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    position: integer('position').notNull(),
    name: text('name').notNull(),
    clientLabel: text('client_label').notNull(),
    clientDescription: text('client_description').notNull().default(''),
    category: stageEnum('category').notNull(),
    color: text('color').notNull().default('blue'),
    slaDays: integer('sla_days').notNull(),
    requiredDocuments: jsonb('required_documents').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    autoAdvance: boolean('auto_advance').notNull().default(true),
    approvalRequired: boolean('approval_required').notNull().default(false),
    movableBy: text('movable_by').notNull().default('staff'),
    conditions: jsonb('conditions').$type<Condition[]>().notNull().default(sql`'[]'::jsonb`),
    tasks: jsonb('tasks').$type<StageTask[]>().notNull().default(sql`'[]'::jsonb`),
    fees: jsonb('fees').$type<StageFee[]>().notNull().default(sql`'[]'::jsonb`),
    messages: jsonb('messages').$type<StageMessage[]>().notNull().default(sql`'[]'::jsonb`),
    notifyStudent: boolean('notify_student').notNull().default(true),
  },
  (t) => [
    uniqueIndex('workflow_stages_version_key').on(t.versionId, t.key),
    index('workflow_stages_version_position_idx').on(t.versionId, t.position),
  ],
);

/** When this happens, if these hold, do these things. Soft-deleted. */
export const automationRules = pgTable(
  'automation_rules',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    trigger: text('trigger').notNull(),
    /** Only applications on this workflow (any version). */
    workflowId: uuid('workflow_id').references(() => workflowTemplates.id, { onDelete: 'set null' }),
    stageKey: text('stage_key'),
    documentType: text('document_type'),
    conditions: jsonb('conditions').$type<Condition[]>().notNull().default(sql`'[]'::jsonb`),
    actions: jsonb('actions').$type<AutomationAction[]>().notNull(),
    runCount: integer('run_count').notNull().default(0),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('automation_rules_tenant_trigger_idx').on(t.tenantId, t.trigger).where(sql`deleted_at is null and enabled`)],
);

/**
 * Everything an automation - or a stage's own tasks, fees and messages - did
 * or failed to do, one row per firing. `event_key` makes a firing happen once
 * even if the event is seen twice.
 */
export const automationRuns = pgTable(
  'automation_runs',
  {
    id: id(),
    tenantId: tenantId(),
    /** Null for a stage's own actions. */
    ruleId: uuid('rule_id').references(() => automationRules.id, { onDelete: 'cascade' }),
    /** For a stage's own actions: which stage. */
    stageKey: text('stage_key'),
    caseId: uuid('case_id').references(() => cases.id, { onDelete: 'set null' }),
    trigger: text('trigger').notNull(),
    /** done | partial | failed | skipped */
    status: text('status').notNull(),
    results: jsonb('results').$type<{ action: string; ok: boolean; detail: string }[]>().notNull().default(sql`'[]'::jsonb`),
    eventKey: text('event_key'),
    createdAt: createdAt(),
  },
  (t) => [
    index('automation_runs_tenant_created_idx').on(t.tenantId, t.createdAt.desc()),
    index('automation_runs_rule_idx').on(t.ruleId, t.createdAt.desc()),
    uniqueIndex('automation_runs_event_key').on(t.tenantId, t.eventKey).where(sql`event_key is not null`),
  ],
);

/* ------------------------------------------------------------------ */

export const usersRelations = relations(users, ({ one }) => ({
  consultant: one(consultants, { fields: [users.id], references: [consultants.userId] }),
  clientProfile: one(clients, { fields: [users.id], references: [clients.userId] }),
}));

export const consultantsRelations = relations(consultants, ({ one, many }) => ({
  user: one(users, { fields: [consultants.userId], references: [users.id] }),
  clients: many(clients),
  cases: many(cases),
}));

export const clientsRelations = relations(clients, ({ one, many }) => ({
  user: one(users, { fields: [clients.userId], references: [users.id] }),
  consultant: one(consultants, {
    fields: [clients.assignedConsultantId],
    references: [consultants.id],
  }),
  cases: many(cases),
  documents: many(documents),
}));

export const casesRelations = relations(cases, ({ one, many }) => ({
  client: one(clients, { fields: [cases.clientId], references: [clients.id] }),
  consultant: one(consultants, { fields: [cases.consultantId], references: [consultants.id] }),
  stageEvents: many(caseStageEvents),
  documents: many(documents),
  messages: many(messages),
}));

export const caseStageEventsRelations = relations(caseStageEvents, ({ one }) => ({
  case: one(cases, { fields: [caseStageEvents.caseId], references: [cases.id] }),
  changedByUser: one(users, { fields: [caseStageEvents.changedBy], references: [users.id] }),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  case: one(cases, { fields: [documents.caseId], references: [cases.id] }),
  client: one(clients, { fields: [documents.clientId], references: [clients.id] }),
  uploader: one(users, { fields: [documents.uploadedBy], references: [users.id] }),
  reviewer: one(users, { fields: [documents.reviewedBy], references: [users.id] }),
  comments: many(documentComments),
}));

export const documentCommentsRelations = relations(documentComments, ({ one }) => ({
  document: one(documents, { fields: [documentComments.documentId], references: [documents.id] }),
  author: one(users, { fields: [documentComments.authorId], references: [users.id] }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  case: one(cases, { fields: [messages.caseId], references: [cases.id] }),
  sender: one(users, { fields: [messages.senderId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export type TenantRow = typeof tenants.$inferSelect;
export type PlanRow = typeof plans.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type TenantDomainRow = typeof tenantDomains.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type PasswordTokenRow = typeof passwordTokens.$inferSelect;
export type ConsultantRow = typeof consultants.$inferSelect;
export type ClientRow = typeof clients.$inferSelect;
export type CaseRow = typeof cases.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
