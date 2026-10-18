import { cache } from 'react';
import type { HostContext, TenantBranding } from '@crm/shared';
import { ApiError, apiFetch } from './api';

/**
 * Which site this request is on:
 *  - `tenant`: a consultancy, with its branding;
 *  - `platform`: the platform admin site;
 *  - `unknown`: an address connected to nothing;
 *  - `offline`: the API did not answer, so we cannot tell. Pages render with
 *    the default look rather than a misleading "not connected".
 */
export type Site = HostContext | { kind: 'unknown' } | { kind: 'offline' };

/** Cached per request: the layout, the shell and the page all ask. */
export const getSite = cache(async (): Promise<Site> => {
  try {
    return await apiFetch<HostContext>('/tenancy/current');
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { kind: 'unknown' };
    return { kind: 'offline' };
  }
});

/** The name to put in the chrome and the tab title. */
export function siteName(site: Site): string {
  if (site.kind === 'tenant') return site.tenant.name;
  if (site.kind === 'platform') return 'Platform admin';
  return 'Consultancy CRM';
}

export function siteBranding(site: Site): TenantBranding | null {
  return site.kind === 'tenant' ? site.tenant : null;
}
