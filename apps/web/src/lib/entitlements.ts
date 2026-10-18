import { cache } from 'react';
import { MODULES, type Entitlements, type Module } from '@crm/shared';
import { apiFetch } from './api';

/**
 * The consultancy's plan, as the API sees it. Menus are built from this; the
 * API refuses the same modules server-side, so a hidden item is never the
 * only thing standing in the way. Cached per request.
 */
export const getEntitlements = cache(async (): Promise<Entitlements | null> => {
  try {
    return await apiFetch<Entitlements>('/tenancy/entitlements');
  } catch {
    return null;
  }
});

/** When the plan cannot be read, show everything and let the API decide. */
export async function enabledModules(): Promise<Set<Module>> {
  const e = await getEntitlements();
  return new Set(e?.modules ?? MODULES);
}
