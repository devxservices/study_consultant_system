import { z } from 'zod';
import { TENANT_ROLES, type Role } from '../roles';
import type { Permission } from '../permissions';
import { emailSchema } from './common';

export const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password'),
});
export type SignInInput = z.infer<typeof signInSchema>;

export const inviteUserSchema = z.object({
  email: emailSchema,
  fullName: z.string().trim().min(2, 'Enter a full name').max(120),
  role: z.enum(TENANT_ROLES),
  phone: z.string().trim().max(24).optional(),
});
export type InviteUserInput = z.infer<typeof inviteUserSchema>;

/** The identity every request is resolved to. Never trust a role sent by the browser. */
export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  /**
   * The consultancy this person belongs to. Null only for platform admins.
   * Every tenant-owned query is filtered on it, and it is read from the
   * database on every request - never from anything the browser sent.
   */
  tenantId: string | null;
  /** Set when role === 'consultant' or 'client'; links to the domain row. */
  consultantId: string | null;
  clientId: string | null;
  /** Set when role === 'partner': the partner organisation they act for. */
  partnerId: string | null;
  /** The staff role they hold (Accountant, Trainer...), shown instead of "Consultant". */
  roleTitle: string | null;
  /**
   * Whether they carry a caseload of students. False for roles like Accountant
   * and Trainer: they land on their own work, not on a caseload dashboard.
   * Always false for anyone who is not a consultant.
   */
  takesClients: boolean;
  avatarColor: string;
  /**
   * What this person may do beyond their role's portal. Every permission for a
   * manager; a consultant's resolved set; empty for clients and platform
   * admins. Resolved from the database on every request.
   */
  permissions: Permission[];
  /** Whether they have two-step verification switched on. */
  mfaEnabled: boolean;
  /**
   * Their consultancy requires two-step verification and they have not set it
   * up yet. Until they do, the API refuses everything except setting it up.
   */
  mfaSetupRequired: boolean;
}

export interface SessionResponse {
  user: AuthUser;
  /** Seconds until the access token expires. */
  expiresIn: number;
}
