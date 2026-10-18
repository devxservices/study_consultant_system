import { and, asc, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { tenantDomains, tenants } from '../db/schema';
import { env, isProd } from '../config/env';

export interface TenantIdentity {
  name: string;
  origin: string;
  contactEmail: string | null;
  contactPhone: string | null;
}

/**
 * Where a consultancy's people reach it, for links that leave the app - an
 * email, a share link. A verified custom domain wins; otherwise its platform
 * address, <slug>.PLATFORM_DOMAIN, with the scheme and port the web app is
 * served on (WEB_ORIGIN).
 */
export async function tenantIdentity(db: Db, tenantId: string): Promise<TenantIdentity> {
  const [[tenant], [domain]] = await Promise.all([
    db
      .select({ slug: tenants.slug, name: tenants.name, email: tenants.contactEmail, phone: tenants.contactPhone })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1),
    db
      .select({ hostname: tenantDomains.hostname })
      .from(tenantDomains)
      .where(and(eq(tenantDomains.tenantId, tenantId), isNotNull(tenantDomains.verifiedAt)))
      .orderBy(asc(tenantDomains.createdAt))
      .limit(1),
  ]);

  const web = new URL(env().WEB_ORIGIN);
  let origin: string;
  if (domain) {
    origin = `https://${domain.hostname}`;
  } else {
    const cfg = env();
    const defaultSlug = cfg.DEFAULT_TENANT_SLUG ?? (isProd() ? null : 'main');
    const host = tenant && tenant.slug !== defaultSlug ? `${tenant.slug}.${cfg.PLATFORM_DOMAIN}` : cfg.PLATFORM_DOMAIN;
    origin = `${web.protocol}//${host}${web.port ? `:${web.port}` : ''}`;
  }
  return {
    name: tenant?.name ?? 'Your consultancy',
    origin,
    contactEmail: tenant?.email ?? null,
    contactPhone: tenant?.phone ?? null,
  };
}

/** Where platform admins sign in, for links in their emails. */
export function adminOrigin(): string {
  const cfg = env();
  const web = new URL(cfg.WEB_ORIGIN);
  const host = cfg.ADMIN_HOST ?? `admin.${cfg.PLATFORM_DOMAIN}`;
  return `${web.protocol}//${host}${web.port ? `:${web.port}` : ''}`;
}
