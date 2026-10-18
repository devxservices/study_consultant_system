/**
 * The actors in the system. Every API request resolves to exactly one.
 *
 * `super_admin` is the platform owner. It is the only role that belongs to no
 * consultancy (its users have no tenant), and the only one that can see more
 * than one consultancy - but it sees them as accounts to administer, never
 * their clients, cases or documents.
 *
 * `partner` is someone outside the consultancy - a sub-agent or referral
 * partner - who brings students to it. They have a portal of their own and
 * see only the students they registered, never the consultancy's own.
 */
export const ROLES = ['client', 'consultant', 'manager', 'super_admin', 'partner'] as const;
export type Role = (typeof ROLES)[number];

/** The roles that live inside a consultancy. */
export const TENANT_ROLES = ['client', 'consultant', 'manager', 'partner'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];

/** People who work for the consultancy - as opposed to clients and partners. */
export const STAFF_ROLES = ['consultant', 'manager'] as const;

export const ROLE_LABEL: Record<Role, string> = {
  client: 'Client',
  consultant: 'Consultant',
  manager: 'Manager',
  super_admin: 'Platform admin',
  partner: 'Partner',
};

/** Where each role lands after signing in. */
export const ROLE_HOME: Record<Role, string> = {
  client: '/portal',
  consultant: '/desk',
  manager: '/overview',
  super_admin: '/admin',
  partner: '/partner',
};

/** Route prefix each role is permitted to enter. Enforced in middleware AND server-side. */
export const ROLE_ROUTE_PREFIX: Record<Role, string> = {
  client: '/portal',
  consultant: '/desk',
  manager: '/overview',
  super_admin: '/admin',
  partner: '/partner',
};

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function isStaffRole(role: string): boolean {
  return role === 'consultant' || role === 'manager';
}
