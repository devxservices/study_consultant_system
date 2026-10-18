import { z } from 'zod';

/**
 * What a member of staff may do, underneath their role.
 *
 * The role still decides the portal someone lands in. Permissions decide, for
 * a consultant, which parts of that portal they can use: a consultancy can let
 * Sana move cases and stop Ahmad from doing so without inventing a new role.
 *
 * Rules the whole system keeps:
 *  - A manager is the consultancy's owner and has every permission, always.
 *    Nobody can lock the owner out of their own data.
 *  - Only a manager changes permissions, so nobody can grant themselves more.
 *  - Clients have no permissions: what they can reach is fixed - their own
 *    record, cases, documents, messages and payments, and nothing else.
 *  - The API enforces every permission. The web app hides what someone cannot
 *    do, but that is a courtesy, never the rule.
 */
export const PERMISSIONS = [
  'client.view_all',
  'client.create',
  'client.edit',
  'client.assign',
  'client.portal_access',
  'case.create',
  'case.edit',
  'case.move',
  'case.approve',
  'document.view',
  'document.upload',
  'document.verify',
  'document.reject',
  'document.comment',
  'document.delete',
  'document.manage',
  'document.share',
  'document.settings',
  'workflow.manage',
  'course.view',
  'course.enroll',
  'course.teach',
  'course.manage',
  'chat.view',
  'chat.send',
  'billing.view',
  'billing.invoice',
  'billing.payment',
  'billing.verify',
  'billing.refund',
  'billing.approve',
  'finance.expenses',
  'finance.ledger',
  'finance.settings',
  'commission.view',
  'commission.manage',
  'institution.manage',
  'partner.view',
  'partner.manage',
  'payout.manage',
  'staff.view',
  'staff.manage',
  'audit.view',
  'data.export',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_EFFECTS = ['allow', 'deny'] as const;
export type PermissionEffect = (typeof PERMISSION_EFFECTS)[number];

export interface PermissionMeta {
  key: Permission;
  label: string;
  description: string;
  /** What a consultant gets when nobody has said otherwise. */
  consultantDefault: boolean;
  /** Widens what someone can see or do beyond their own work - shown with a caution. */
  sensitive?: boolean;
}

export interface PermissionGroup {
  key: string;
  label: string;
  permissions: PermissionMeta[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    key: 'clients',
    label: 'Clients',
    permissions: [
      {
        key: 'client.view_all',
        label: 'See every client',
        description: 'Every client, case and conversation in the consultancy - not just the ones assigned to them.',
        consultantDefault: false,
        sensitive: true,
      },
      { key: 'client.create', label: 'Add clients', description: 'Create new client records.', consultantDefault: true },
      { key: 'client.edit', label: 'Edit clients', description: 'Change contact details and the student profile, and archive clients.', consultantDefault: true },
      {
        key: 'client.assign',
        label: 'Reassign clients',
        description: 'Hand a client to a different consultant.',
        consultantDefault: false,
        sensitive: true,
      },
      { key: 'client.portal_access', label: 'Manage portal logins', description: 'Give a client their login, reset it or switch it off.', consultantDefault: true },
    ],
  },
  {
    key: 'cases',
    label: 'Applications',
    permissions: [
      { key: 'case.create', label: 'Open applications', description: 'Start a new application for a client.', consultantDefault: true },
      { key: 'case.edit', label: 'Edit applications', description: 'Change the programme, intake, key dates, offer details and notes.', consultantDefault: true },
      { key: 'case.move', label: 'Move applications', description: 'Move an application to another stage, and change its status.', consultantDefault: true },
      { key: 'case.approve', label: 'Approve gated stages', description: 'Sign off a stage that needs approval before the application can move on, and move applications through stages only managers may move.', consultantDefault: false },
    ],
  },
  {
    key: 'documents',
    label: 'Documents',
    permissions: [
      { key: 'document.view', label: 'See documents', description: 'Open and download clients’ documents.', consultantDefault: true },
      { key: 'document.upload', label: 'Upload documents', description: 'Upload a document on a client’s behalf.', consultantDefault: true },
      { key: 'document.verify', label: 'Verify documents', description: 'Approve a document. This can move the application on by itself.', consultantDefault: true },
      { key: 'document.reject', label: 'Reject documents', description: 'Send a document back to the client with a reason.', consultantDefault: true },
      { key: 'document.comment', label: 'Ask about documents', description: 'Leave a question on a document for the client.', consultantDefault: true },
      { key: 'document.delete', label: 'Delete documents', description: 'Move documents to the trash, and restore them from it. Approved documents stay.', consultantDefault: true },
      { key: 'document.manage', label: 'Organise documents', description: 'Create, rename and move folders and documents, tag them, and copy them between folders.', consultantDefault: true },
      {
        key: 'document.share',
        label: 'Share documents outside',
        description: 'Send a university or partner a secure, expiring link to a document or folder.',
        consultantDefault: false,
        sensitive: true,
      },
      { key: 'document.settings', label: 'Set up document rules', description: 'Folder templates, document types, required-document checklists and upload limits.', consultantDefault: false },
    ],
  },
  {
    key: 'workflow',
    label: 'Countries and workflows',
    permissions: [
      { key: 'workflow.manage', label: 'Build workflows', description: 'Country data, application pipelines per country, their stages, gates and automations.', consultantDefault: false },
    ],
  },
  {
    key: 'courses',
    label: 'Courses and test preparation',
    permissions: [
      { key: 'course.view', label: 'See courses', description: 'The course catalogue, batches and who is enrolled.', consultantDefault: true },
      { key: 'course.enroll', label: 'Enrol students', description: 'Enrol their clients in courses, move them between batches, freeze or drop them.', consultantDefault: true },
      { key: 'course.teach', label: 'Teach batches', description: 'Take attendance, record scores and grade homework for the batches they teach.', consultantDefault: false },
      { key: 'course.manage', label: 'Manage courses', description: 'Create courses and batches, assign trainers, record official test results.', consultantDefault: false },
    ],
  },
  {
    key: 'chat',
    label: 'Messages',
    permissions: [
      { key: 'chat.view', label: 'Read conversations', description: 'See the message thread on an application.', consultantDefault: true },
      { key: 'chat.send', label: 'Message clients', description: 'Send messages to clients.', consultantDefault: true },
    ],
  },
  {
    key: 'billing',
    label: 'Money',
    permissions: [
      { key: 'billing.view', label: 'See invoices and payments', description: 'What clients have been billed and what they have paid.', consultantDefault: true, sensitive: true },
      { key: 'billing.invoice', label: 'Issue invoices', description: 'Bill a client from the price list.', consultantDefault: true },
      { key: 'billing.payment', label: 'Record payments', description: 'Add money received to the ledger. Refunds and voids stay with managers.', consultantDefault: true },
      {
        key: 'billing.verify',
        label: 'Verify payments',
        description: 'Check proof of payment that clients upload, and approve or reject it.',
        consultantDefault: false,
        sensitive: true,
      },
      { key: 'billing.refund', label: 'Request refunds', description: 'Ask for a refund to be approved. Someone else must approve it.', consultantDefault: false },
      {
        key: 'billing.approve',
        label: 'Approve refunds and discounts',
        description: 'The second pair of eyes: approve refunds and invoices over the discount limit. Never their own request.',
        consultantDefault: false,
        sensitive: true,
      },
      { key: 'finance.expenses', label: 'Record expenses and bills', description: 'The consultancy’s own costs, bills to pay, and money paid on clients’ behalf.', consultantDefault: false },
      {
        key: 'finance.ledger',
        label: 'Accounts and reports',
        description: 'The ledger, bank reconciliation, financial reports and closing a period.',
        consultantDefault: false,
        sensitive: true,
      },
      {
        key: 'finance.settings',
        label: 'Finance settings',
        description: 'Taxes, the fee catalogue, promo codes, late fees, approval limits and online payments.',
        consultantDefault: false,
        sensitive: true,
      },
    ],
  },
  {
    key: 'commissions',
    label: 'University commissions',
    permissions: [
      {
        key: 'commission.view',
        label: 'See commissions',
        description: 'What universities owe the consultancy, by student, claim and receipt.',
        consultantDefault: false,
        sensitive: true,
      },
      {
        key: 'commission.manage',
        label: 'Manage commissions',
        description: 'Raise claims, record what universities pay, and dispute, write off or claw back.',
        consultantDefault: false,
        sensitive: true,
      },
      { key: 'institution.manage', label: 'Manage universities', description: 'Universities, their contacts, agreements and commission rates.', consultantDefault: false },
    ],
  },
  {
    key: 'partners',
    label: 'Partners and sub-agents',
    permissions: [
      { key: 'partner.view', label: 'See partners', description: 'Partners, the students they brought, and how they are doing.', consultantDefault: false },
      {
        key: 'partner.manage',
        label: 'Manage partners',
        description: 'Approve partners, set their tier and commission rules, settle who a student belongs to.',
        consultantDefault: false,
        sensitive: true,
      },
      {
        key: 'payout.manage',
        label: 'Pay partners',
        description: 'Prepare, approve and record partner payouts.',
        consultantDefault: false,
        sensitive: true,
      },
    ],
  },
  {
    key: 'oversight',
    label: 'Team and oversight',
    permissions: [
      { key: 'staff.view', label: 'See the team', description: 'The list of consultants and their workload.', consultantDefault: true },
      {
        key: 'staff.manage',
        label: 'Manage consultants',
        description: 'Add consultants, reset their passwords and switch logins off. Never permissions - those stay with managers.',
        consultantDefault: false,
        sensitive: true,
      },
      {
        key: 'audit.view',
        label: 'See the audit trail',
        description: 'Everything everyone has done, including who viewed which client.',
        consultantDefault: false,
        sensitive: true,
      },
      {
        key: 'data.export',
        label: 'Export data',
        description: 'Download clients, applications, invoices and payments as spreadsheets.',
        consultantDefault: false,
        sensitive: true,
      },
    ],
  },
];

export const PERMISSION_META: Record<Permission, PermissionMeta> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => [p.key, p])),
) as Record<Permission, PermissionMeta>;

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * The effective set for a member of staff, from four layers, most specific
 * first: their own override, then their role (Accountant, Trainer...), then
 * the consultancy's default for consultants, then the built-in default.
 */
export function resolvePermissions(
  consultancyDefaults: Partial<Record<Permission, PermissionEffect>>,
  overrides: Partial<Record<Permission, PermissionEffect>>,
  role: Partial<Record<Permission, PermissionEffect>> = {},
): Permission[] {
  return PERMISSIONS.filter((p) => {
    const own = overrides[p];
    if (own) return own === 'allow';
    const fromRole = role[p];
    if (fromRole) return fromRole === 'allow';
    const firm = consultancyDefaults[p];
    if (firm) return firm === 'allow';
    return PERMISSION_META[p].consultantDefault;
  });
}

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

/**
 * A role is a named set of permissions a consultancy hands to members of staff
 * - Accountant, Trainer, Senior consultant - instead of ticking the same boxes
 * for each person. It sits between the member's own overrides and the
 * consultancy's default, so one person can still differ from their role.
 *
 * `takesClients` decides whether its members are offered when a client is
 * assigned: an accountant or a trainer has no caseload.
 */
export const roleTemplateSchema = z.object({
  name: z.string().trim().min(2, 'Name the role').max(60),
  description: z.string().trim().max(300).nullable().optional(),
  effects: z.record(z.enum(PERMISSIONS), z.enum(PERMISSION_EFFECTS)).default({}),
  takesClients: z.boolean().default(true),
});
export type RoleTemplateInput = z.infer<typeof roleTemplateSchema>;

export interface RoleTemplateView {
  id: string;
  name: string;
  description: string | null;
  effects: Partial<Record<Permission, PermissionEffect>>;
  takesClients: boolean;
  /** Members of staff who hold it. */
  members: number;
  /** Which built-in role it started from, if any. */
  systemKey: string | null;
}

export const assignRoleSchema = z.object({ roleId: z.string().uuid().nullable() });
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

interface DefaultRole {
  key: string;
  name: string;
  description: string;
  takesClients: boolean;
  allow: Permission[];
  deny: Permission[];
}

/** The roles every consultancy starts with. They can be edited or removed like any other. */
export const DEFAULT_ROLE_TEMPLATES: DefaultRole[] = [
  {
    key: 'counsellor',
    name: 'Counsellor',
    description: 'Works their own students from first call to visa. Uses the consultancy’s defaults.',
    takesClients: true,
    allow: [],
    deny: [],
  },
  {
    key: 'senior',
    name: 'Senior consultant',
    description: 'Sees every student, reassigns them, and oversees the team.',
    takesClients: true,
    allow: ['client.view_all', 'client.assign', 'staff.view', 'audit.view', 'data.export', 'document.share', 'workflow.manage', 'case.approve', 'billing.approve', 'commission.view', 'partner.view'],
    deny: [],
  },
  {
    key: 'accountant',
    name: 'Accountant',
    description: 'Runs the money: invoices, verifying payments, refunds, expenses, the books and reports. No caseload.',
    takesClients: false,
    allow: [
      'client.view_all',
      'billing.view',
      'billing.invoice',
      'billing.payment',
      'billing.verify',
      'billing.refund',
      'finance.expenses',
      'finance.ledger',
      'commission.view',
      'commission.manage',
      'payout.manage',
      'partner.view',
    ],
    deny: ['case.move', 'document.verify', 'document.reject', 'document.upload', 'chat.send', 'client.create', 'case.create'],
  },
  {
    key: 'trainer',
    name: 'Trainer',
    description: 'Teaches IELTS, PTE and language batches: attendance, scores and homework. No caseload.',
    takesClients: false,
    allow: ['course.view', 'course.teach'],
    deny: [
      'client.create',
      'client.edit',
      'case.create',
      'case.edit',
      'case.move',
      'document.verify',
      'document.reject',
      'billing.view',
      'billing.invoice',
      'billing.payment',
      'chat.send',
    ],
  },
  {
    key: 'partner_manager',
    name: 'Partner manager',
    description: 'Looks after sub-agents and referral partners, their students and their payouts.',
    takesClients: true,
    allow: ['partner.view', 'partner.manage', 'commission.view', 'client.view_all'],
    deny: [],
  },
];

export function defaultRoleEffects(r: DefaultRole): Partial<Record<Permission, PermissionEffect>> {
  const effects: Partial<Record<Permission, PermissionEffect>> = {};
  for (const p of r.allow) effects[p] = 'allow';
  for (const p of r.deny) effects[p] = 'deny';
  return effects;
}

/**
 * Whether this person may do something. Managers may do everything; a
 * consultant exactly what their permissions say; clients and platform admins
 * have no staff permissions at all - their access is structural.
 */
export function hasPermission(
  user: { role: string; permissions?: readonly string[] | null },
  permission: Permission,
): boolean {
  if (user.role === 'manager') return true;
  if (user.role === 'consultant') return Boolean(user.permissions?.includes(permission));
  return false;
}

/* ------------------------------------------------------------------ */
/* Editing                                                             */
/* ------------------------------------------------------------------ */

/** `inherit` removes the override, so the default applies again. */
export const PERMISSION_CHOICES = ['allow', 'deny', 'inherit'] as const;
export type PermissionChoice = (typeof PERMISSION_CHOICES)[number];

export const setPermissionsSchema = z.object({
  changes: z.record(z.enum(PERMISSIONS), z.enum(PERMISSION_CHOICES)),
});
export type SetPermissionsInput = z.infer<typeof setPermissionsSchema>;

export interface PermissionRow {
  key: Permission;
  /** What applies right now. */
  allowed: boolean;
  /** Where that came from. */
  source: 'member' | 'role' | 'consultancy' | 'default';
  /** This member's own override, if they have one. */
  override: PermissionEffect | null;
  /** What they would get without their override. */
  inherited: boolean;
}

export interface MemberPermissions {
  userId: string;
  name: string;
  email: string;
  role: 'manager' | 'consultant';
  active: boolean;
  /** Managers always have everything; their rows are informational. */
  fixed: boolean;
  /** Their role (Accountant, Trainer...), if they have one. */
  roleId: string | null;
  roleName: string | null;
  rows: PermissionRow[];
}

/** One row of the owner's team list. */
export interface TeamMember {
  userId: string;
  name: string;
  email: string;
  role: 'manager' | 'consultant';
  active: boolean;
  mfaEnabled: boolean;
  lastSignInAt: string | null;
  /** How many permissions differ from the consultancy's defaults for this person. */
  overrides: number;
  /** Their role's name (Accountant, Trainer...), if they have one. */
  roleTitle: string | null;
}

export interface ConsultancyDefaults {
  rows: { key: Permission; allowed: boolean; source: 'consultancy' | 'default' }[];
}

/* ------------------------------------------------------------------ */
/* Two-step verification                                               */
/* ------------------------------------------------------------------ */

export const MFA_POLICIES = ['optional', 'staff', 'everyone'] as const;
export type MfaPolicy = (typeof MFA_POLICIES)[number];
export const MFA_POLICY_LABEL: Record<MfaPolicy, string> = {
  optional: 'Optional for everyone',
  staff: 'Required for staff',
  everyone: 'Required for staff and clients',
};

export function mfaRequiredFor(policy: MfaPolicy, role: string): boolean {
  if (policy === 'everyone') return role !== 'super_admin';
  // Partners handle students' passports and money like staff do.
  if (policy === 'staff') return role === 'manager' || role === 'consultant' || role === 'partner';
  return false;
}

const code = z
  .string()
  .trim()
  .transform((s) => s.replace(/\s+/g, ''))
  .pipe(z.string().regex(/^\d{6}$/, 'Enter the 6-digit code from your authenticator app'));

const recoveryCode = z
  .string()
  .trim()
  .toUpperCase()
  .transform((s) => s.replace(/[^A-Z0-9]/g, ''))
  .pipe(z.string().length(10, 'Recovery codes are 10 letters and numbers'));

export const mfaCodeSchema = z.object({ code });
export type MfaCodeInput = z.infer<typeof mfaCodeSchema>;

export const mfaVerifySchema = z
  .object({
    challenge: z.string().min(10),
    code: code.optional(),
    recoveryCode: recoveryCode.optional(),
  })
  .refine((v) => Boolean(v.code) !== Boolean(v.recoveryCode), {
    message: 'Enter either a code from your app or a recovery code.',
    path: ['code'],
  });
export type MfaVerifyInput = z.infer<typeof mfaVerifySchema>;

export const mfaPolicySchema = z.object({ policy: z.enum(MFA_POLICIES) });
export type MfaPolicyInput = z.infer<typeof mfaPolicySchema>;

export interface MfaStatus {
  enabled: boolean;
  enabledAt: string | null;
  recoveryCodesLeft: number;
  /** Whether the consultancy requires it for this person. */
  required: boolean;
  policy: MfaPolicy | null;
}

export interface MfaSetup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

/** What sign-in returns when a second step is needed instead of a session. */
export interface MfaChallengeResponse {
  mfaRequired: true;
  challenge: string;
}
