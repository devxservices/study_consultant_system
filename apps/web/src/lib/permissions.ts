import { hasPermission, type AuthUser, type Permission } from '@crm/shared';

/**
 * Server-side: may this member of staff do this? Managers always; a
 * consultant when their permissions say so. Used to decide what a page
 * fetches and shows - the API makes the same decision again on every call.
 */
export function can(user: Pick<AuthUser, 'role' | 'permissions'>, permission: Permission): boolean {
  return hasPermission(user, permission);
}
