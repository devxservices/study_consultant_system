import { ForbiddenException, SetMetadata } from '@nestjs/common';
import { PERMISSION_META, hasPermission, type AuthUser, type Permission } from '@crm/shared';

export const REQUIRES_PERMISSION = 'auth:requires-permission';

/**
 * A route that needs a staff permission. The auth guard checks it for
 * consultants; managers hold every permission; clients are not subject to it
 * because their reach is already fixed to their own records by the service
 * that serves them. (A route that clients must never reach still needs
 * @Roles to say so.)
 */
export const RequirePermission = (...permissions: Permission[]) =>
  SetMetadata(REQUIRES_PERMISSION, permissions);

/**
 * For services: may this member of staff do this? False for clients and
 * platform admins - staff permissions are not theirs to have.
 */
export function staffCan(actor: AuthUser, permission: Permission): boolean {
  return hasPermission(actor, permission);
}

/**
 * For services that are reached without passing the guard (the chat socket)
 * or that decide on something the route cannot see. Clients pass: their own
 * boundary is enforced by the query, not by a permission.
 */
export function assertCan(actor: AuthUser, permission: Permission): void {
  if (actor.role === 'client') return;
  if (!hasPermission(actor, permission)) throw permissionDenied(permission);
}

export function permissionDenied(permission: Permission): ForbiddenException {
  const label = PERMISSION_META[permission]?.label.toLowerCase() ?? permission;
  return new ForbiddenException({
    message: `You do not have permission to ${label.replace(/^see /, 'see ')}. Ask a manager if you need it.`,
    code: 'PERMISSION_DENIED',
    permission,
  });
}

/**
 * Whether a consultant sees the whole consultancy (like a manager) or only
 * what is assigned to them. The one permission that widens every list.
 */
export function seesAll(actor: AuthUser): boolean {
  return actor.role === 'manager' || (actor.role === 'consultant' && hasPermission(actor, 'client.view_all'));
}
