'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { hasPermission, type Permission, type Role } from '@crm/shared';

interface PermissionState {
  role: Role;
  permissions: readonly Permission[];
}

const PermissionsContext = createContext<PermissionState | null>(null);

/**
 * The signed-in person's permissions, for client components deciding which
 * buttons to show. Set once by the app shell from the session.
 *
 * Hiding a button is a courtesy: the API refuses the action either way.
 */
export function PermissionsProvider({
  role,
  permissions,
  children,
}: PermissionState & { children: ReactNode }) {
  return <PermissionsContext.Provider value={{ role, permissions }}>{children}</PermissionsContext.Provider>;
}

/**
 * Whether to offer an action. Clients are not subject to staff permissions -
 * the few actions their portal offers are theirs by right, on their own
 * records - so for them this is always true. Outside a provider (a stray
 * render) it offers nothing.
 */
export function useCan(): (permission: Permission) => boolean {
  const state = useContext(PermissionsContext);
  return (permission) => {
    if (!state) return false;
    if (state.role === 'client') return true;
    return hasPermission(state, permission);
  };
}
