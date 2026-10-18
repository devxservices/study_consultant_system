import { redirect } from 'next/navigation';
import { ROLE_HOME, type AuthUser, type Role } from '@crm/shared';
import { apiFetch } from './api';

/** The signed-in user, or null. Never throws. */
export async function getSession(): Promise<AuthUser | null> {
  try {
    const { user } = await apiFetch<{ user: AuthUser }>('/auth/me');
    return user;
  } catch {
    return null;
  }
}

/**
 * Gate a page on a role.
 *
 * This is UX, not security - it decides what to render and where to send
 * someone who wandered into the wrong portal. The real boundary is in the API,
 * which re-checks the role and scopes every query regardless of what the
 * browser asks for.
 */
export async function requireRole(...allowed: Role[]): Promise<AuthUser> {
  const user = await getSession();
  if (!user) redirect('/sign-in');
  // The consultancy requires two-step verification and this person has not
  // set it up: the API refuses them everything else until they do.
  if (user.mfaSetupRequired) redirect('/security/setup');
  if (allowed.length && !allowed.includes(user.role)) redirect(ROLE_HOME[user.role]);
  return user;
}

export async function requireUser(): Promise<AuthUser> {
  return requireRole();
}
