import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Request } from 'express';
import type { AuthUser, TenantBranding } from '@crm/shared';
import { env, isProd } from '../config/env';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { tenantDomains, tenants, type TenantRow } from '../db/schema';

/**
 * Which site a request arrived at.
 *
 * - `platform`: the admin address, where only platform admins sign in.
 * - `tenant`: one consultancy, by its platform subdomain or a verified domain.
 * - `unknown`: a host that maps to nothing. It is served nothing.
 */
export type ResolvedHost =
  | { kind: 'platform' }
  | { kind: 'tenant'; tenant: TenantRow }
  | { kind: 'unknown' };

/**
 * The header the web server sets to the host the browser actually asked for.
 *
 * Next's proxy rewrites Host to the API's own address on the way through, so
 * the original has to travel separately. The web middleware overwrites any
 * value a browser sends, and it does not have to be trusted anyway: the host
 * only chooses which consultancy's accounts a sign-in is checked against and
 * must agree with the session afterwards. Identity decides what anyone can
 * read, never the host.
 */
export const TENANT_HOST_HEADER = 'x-tenant-host';

export function requestHost(req: Pick<Request, 'headers'>): string | null {
  const forwarded = req.headers[TENANT_HOST_HEADER];
  const raw = (Array.isArray(forwarded) ? forwarded[0] : forwarded) ?? req.headers.host ?? null;
  return normalizeHost(raw);
}

/** Lower-case, no port, no trailing dot. `null` for anything unusable. */
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let host = raw.split(',')[0]!.trim().toLowerCase();
  if (host.startsWith('[')) {
    // IPv6 literal: [::1]:3000
    const end = host.indexOf(']');
    host = end > 0 ? host.slice(1, end) : host;
  } else {
    host = host.replace(/:\d+$/, '');
  }
  host = host.replace(/\.$/, '');
  return host || null;
}

export function tenancyConfig() {
  const e = env();
  return {
    platformDomain: e.PLATFORM_DOMAIN,
    adminHost: e.ADMIN_HOST ?? `admin.${e.PLATFORM_DOMAIN}`,
    defaultSlug: e.DEFAULT_TENANT_SLUG ?? (isProd() ? null : 'main'),
  };
}

/** The address a consultancy is always reachable at, whatever custom domains it adds. */
export function platformHostFor(slug: string): string {
  return `${slug}.${tenancyConfig().platformDomain}`;
}

export function logoUrlFor(tenant: Pick<TenantRow, 'id' | 'logoKey'>): string | null {
  if (!tenant.logoKey) return null;
  // The key changes on every upload, so a short slice of it busts caches.
  const version = tenant.logoKey.slice(-8);
  return `/api/tenancy/logo/${tenant.id}?v=${version}`;
}

export function toBranding(t: TenantRow): TenantBranding {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    primaryColor: t.primaryColor,
    logoUrl: logoUrlFor(t),
    contactEmail: t.contactEmail,
    contactPhone: t.contactPhone,
  };
}

/**
 * Does this session belong on this site? A consultancy's staff sign in on
 * that consultancy's addresses, platform admins on the admin address, and a
 * session is never honoured anywhere else.
 */
export function sessionMatchesHost(user: AuthUser, host: ResolvedHost): boolean {
  if (user.tenantId === null) return host.kind === 'platform';
  return host.kind === 'tenant' && host.tenant.id === user.tenantId;
}

/**
 * The tenant every query made on an actor's behalf is confined to.
 *
 * Throws instead of returning null, because a query with no tenant condition
 * matches every consultancy's rows. An actor without a tenant reaching
 * consultancy data is a bug, and it stops here rather than widening.
 */
export function tenantOf(actor: AuthUser): string {
  if (!actor.tenantId) {
    throw new ForbiddenException('This is only available inside a consultancy account.');
  }
  return actor.tenantId;
}

@Injectable()
export class TenantResolver {
  /**
   * Host lookups happen on every request, so they are cached briefly. A
   * change made through this process invalidates at once; another API
   * instance catches up within the TTL. Sessions do not depend on this cache
   * for suspension - the signed-in user's tenant status is re-read from the
   * database on every request.
   */
  private readonly cache = new Map<string, { at: number; value: ResolvedHost }>();
  private static readonly TTL_MS = 30_000;
  private static readonly MAX_ENTRIES = 2_000;

  constructor(@Inject(DB) private readonly db: Db) {}

  async resolve(rawHost: string | null | undefined): Promise<ResolvedHost> {
    const host = normalizeHost(rawHost);
    if (!host) return { kind: 'unknown' };

    const hit = this.cache.get(host);
    if (hit && Date.now() - hit.at < TenantResolver.TTL_MS) return hit.value;

    const value = await this.lookup(host);
    // Unknown hosts are cached too, so a scan of random hostnames cannot turn
    // into a database query per request - but the map is bounded.
    if (this.cache.size >= TenantResolver.MAX_ENTRIES) this.cache.clear();
    this.cache.set(host, { at: Date.now(), value });
    return value;
  }

  invalidate(): void {
    this.cache.clear();
  }

  private async lookup(host: string): Promise<ResolvedHost> {
    const { platformDomain, adminHost, defaultSlug } = tenancyConfig();

    if (host === adminHost) return { kind: 'platform' };

    let slug: string | null = null;
    if (host === platformDomain) {
      slug = defaultSlug;
    } else if (host.endsWith(`.${platformDomain}`)) {
      const label = host.slice(0, -(platformDomain.length + 1));
      // Exactly one label: a.b.example.com is not a consultancy address.
      if (label && !label.includes('.')) slug = label;
    }

    if (slug) {
      const [tenant] = await this.db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
      return tenant ? { kind: 'tenant', tenant } : { kind: 'unknown' };
    }

    // A custom domain counts only once its DNS proof has been checked.
    const [row] = await this.db
      .select({ tenant: tenants })
      .from(tenantDomains)
      .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
      .where(and(eq(tenantDomains.hostname, host), isNotNull(tenantDomains.verifiedAt)))
      .limit(1);
    return row ? { kind: 'tenant', tenant: row.tenant } : { kind: 'unknown' };
  }
}
