import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, sql } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  DOMAIN_VERIFICATION_PREFIX,
  DOMAIN_VERIFICATION_VALUE_PREFIX,
  type AddDomainInput,
  type BrandingSettings,
  type DomainCheckResult,
  type PasswordLinkResult,
  type AuthUser,
  type ChangeTenantStatusInput,
  type CreateTenantInput,
  type TenantDetail,
  type TenantDomainView,
  type TenantStatus,
  type TenantSummary,
  type UpdateTenantInput,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { plans, tenantDomains, tenants, users, type TenantDomainRow, type TenantRow } from '../db/schema';
import { seedTenantDefaults } from './tenant-defaults';
import { PasswordLinksService } from '../auth/password-links.service';
import { checkDomain, setupRecords } from './domain-dns';
import { EntitlementsService } from './entitlements.service';
import { addCalendarDays, subscriptionState, type SubscriptionStatus } from '@crm/shared';
import { today } from '../common/db-helpers';
import { PlatformSettingsService } from './platform-settings.service';
import { AuditService } from '../audit/audit.service';
import { hashPassword } from '../auth/local-auth.provider';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { sniffMimeType } from '../documents/file-validation';
import {
  TenantResolver,
  logoUrlFor,
  platformHostFor,
  tenancyConfig,
} from './tenant-resolver.service';

/** Logos are shown on every page, so they are kept small and never SVG (which can carry script). */
const LOGO_MAX_BYTES = 1024 * 1024;
const LOGO_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};
export const LOGO_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
};

/**
 * The outer tenant, named explicitly. In a single-table select Drizzle renders a
 * column interpolated into a select-list fragment unqualified (just "id"), which
 * inside these subqueries would bind to the inner table's own id and count
 * nothing. Spelling it out keeps the correlation on the tenant row.
 */
const TENANT_ID = sql.raw('"tenants"."id"');

const staffSql = sql<number>`(
  select count(*)::int from users u
  where u.tenant_id = ${TENANT_ID} and u.role in ('manager', 'consultant') and u.is_active
)`;
const clientsSql = sql<number>`(
  select count(*)::int from clients c where c.tenant_id = ${TENANT_ID} and c.archived = false
)`;
const activeCasesSql = sql<number>`(
  select count(*)::int from cases k
  where k.tenant_id = ${TENANT_ID} and k.status = 'active' and k.current_stage <> 'closed'
)`;
const domainsSql = sql<number>`(
  select count(*)::int from tenant_domains d where d.tenant_id = ${TENANT_ID}
)`;

/**
 * Platform administration of consultancies: onboarding, branding, domains and
 * status. Only reachable through the super-admin routes.
 *
 * Deliberately absent: anything that reads a consultancy's clients, cases,
 * documents or messages. The platform admin manages the account, and the counts
 * shown here are the most they ever see of what is inside it.
 */
@Injectable()
export class TenantsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly audit: AuditService,
    private readonly resolver: TenantResolver,
    private readonly entitlements: EntitlementsService,
    private readonly links: PasswordLinksService,
    private readonly settings: PlatformSettingsService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Read                                                              */
  /* ---------------------------------------------------------------- */

  async list(): Promise<TenantSummary[]> {
    const rows = await this.db
      .select({
        tenant: tenants,
        staff: staffSql,
        clients: clientsSql,
        activeCases: activeCasesSql,
        domains: domainsSql,
        planName: plans.name,
      })
      .from(tenants)
      .leftJoin(plans, eq(plans.id, tenants.planId))
      .orderBy(asc(sql`lower(${tenants.name})`));

    const { graceDays } = await this.settings.billing();
    return rows.map((r) => toSummary(r.tenant, r, graceDays));
  }

  async get(id: string): Promise<TenantDetail> {
    const [row] = await this.db
      .select({
        tenant: tenants,
        staff: staffSql,
        clients: clientsSql,
        activeCases: activeCasesSql,
        domains: domainsSql,
        planName: plans.name,
      })
      .from(tenants)
      .leftJoin(plans, eq(plans.id, tenants.planId))
      .where(eq(tenants.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Consultancy not found.');

    const [domainRows, managers, entitlements, billing] = await Promise.all([
      this.db
        .select()
        .from(tenantDomains)
        .where(eq(tenantDomains.tenantId, id))
        .orderBy(asc(tenantDomains.createdAt)),
      this.db
        .select({
          id: users.id,
          fullName: users.fullName,
          email: users.email,
          lastSignInAt: users.lastSignInAt,
          mfaEnabledAt: users.mfaEnabledAt,
        })
        .from(users)
        .where(and(eq(users.tenantId, id), eq(users.role, 'manager'), eq(users.isActive, true)))
        .orderBy(asc(users.createdAt)),
      this.entitlements.entitlements(id),
      this.settings.billing(),
    ]);

    return {
      ...toSummary(row.tenant, row, billing.graceDays),
      contactEmail: row.tenant.contactEmail,
      contactPhone: row.tenant.contactPhone,
      statusChangedAt: row.tenant.statusChangedAt ? iso(row.tenant.statusChangedAt) : null,
      domains: domainRows.map((d) => toDomainView(d, platformHostFor(row.tenant.slug))),
      managers: managers.map(({ mfaEnabledAt, ...m }) => ({
        ...m,
        lastSignInAt: m.lastSignInAt ? iso(m.lastSignInAt) : null,
        mfaEnabled: Boolean(mfaEnabledAt),
      })),
      planId: row.tenant.planId,
      entitlements,
    };
  }

  /**
   * A consultancy's own branding and addresses, for its manager. The same
   * edits the platform admin can make, minus the plan, status and address.
   */
  async branding(id: string): Promise<BrandingSettings> {
    const t = await this.findRow(id);
    const rows = await this.db
      .select()
      .from(tenantDomains)
      .where(eq(tenantDomains.tenantId, id))
      .orderBy(asc(tenantDomains.createdAt));
    const platformHost = platformHostFor(t.slug);
    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      primaryColor: t.primaryColor,
      logoUrl: logoUrlFor(t),
      contactEmail: t.contactEmail,
      contactPhone: t.contactPhone,
      platformHost,
      domains: rows.map((d) => toDomainView(d, platformHost)),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Onboarding                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Creates the consultancy and its first manager together.
   *
   * One transaction, so there is never a consultancy with nobody able to sign
   * in to it. Safe to retry: the slug is unique, so a second submission of the
   * same form is refused as a conflict instead of creating a twin.
   */
  async create(actor: AuthUser, input: CreateTenantInput): Promise<TenantDetail & { invite: PasswordLinkResult | null }> {
    this.assertSlugUsable(input.slug);

    const [taken] = await this.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, input.slug))
      .limit(1);
    if (taken) throw slugTaken();

    // Left out, the platform's standard trial applies; null means no end date.
    const { trialDays } = await this.settings.billing();
    const trialEndsOn =
      input.trialEndsOn !== undefined ? input.trialEndsOn : trialDays > 0 ? addCalendarDays(today(), trialDays) : null;

    // No password given: the manager chooses their own from an emailed link.
    const passwordHash = input.manager.password ? await hashPassword(input.manager.password) : null;

    let created: TenantRow;
    let managerId: string;
    try {
      [created, managerId] = await this.db.transaction(async (tx) => {
        const [tenant] = await tx
          .insert(tenants)
          .values({
            slug: input.slug,
            name: input.name,
            primaryColor: input.primaryColor ?? null,
            contactEmail: input.contactEmail ?? null,
            contactPhone: input.contactPhone ?? null,
            subscriptionStatus: 'trialing',
            currentPeriodEnd: trialEndsOn,
          })
          .returning();
        if (!tenant) throw new Error('Tenant insert returned no row');

        const [manager] = await tx
          .insert(users)
          .values({
            tenantId: tenant.id,
            email: input.manager.email,
            passwordHash,
            fullName: input.manager.fullName,
            role: 'manager',
          })
          .returning({ id: users.id });
        // Roles, document types, folders, checklists - ready on day one.
        await seedTenantDefaults(tx, tenant.id);

        return [tenant, manager!.id] as const;
      });
    } catch (err) {
      // Two submissions racing past the check above: the unique index decides.
      if (isUniqueViolation(err)) throw slugTaken();
      throw err;
    }

    this.resolver.invalidate();

    await this.audit.record(actor, {
      action: 'tenant.created',
      entityType: 'tenant',
      entityId: created.id,
      tenantId: created.id,
      metadata: { slug: created.slug, name: created.name, manager: input.manager.email, trialEndsOn },
    });

    const invite = input.manager.password ? null : await this.links.sendLink(actor, managerId, 'invite', input.manager.fullName);
    return { ...(await this.get(created.id)), invite };
  }

  /** A manager locked out (or never set up): an emailed link to choose a password. */
  async managerPasswordLink(actor: AuthUser, id: string, userId: string): Promise<PasswordLinkResult> {
    const [m] = await this.db
      .select({ id: users.id, name: users.fullName, lastSignInAt: users.lastSignInAt })
      .from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, id), eq(users.role, 'manager')))
      .limit(1);
    if (!m) throw new NotFoundException('Manager not found.');
    return this.links.sendLink(actor, m.id, m.lastSignInAt ? 'reset' : 'invite', m.name);
  }

  async update(actor: AuthUser, id: string, input: UpdateTenantInput): Promise<TenantDetail> {
    await this.findRow(id);

    const patch: Partial<typeof tenants.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.primaryColor !== undefined) patch.primaryColor = input.primaryColor;
    if (input.contactEmail !== undefined) patch.contactEmail = input.contactEmail;
    if (input.contactPhone !== undefined) patch.contactPhone = input.contactPhone;

    await this.db.update(tenants).set(patch).where(eq(tenants.id, id));
    this.resolver.invalidate();

    await this.audit.record(actor, {
      action: 'tenant.updated',
      entityType: 'tenant',
      entityId: id,
      tenantId: id,
      metadata: { changed: Object.keys(patch).filter((k) => k !== 'updatedAt') },
    });

    return this.get(id);
  }

  /**
   * Suspend, deactivate or reactivate. Takes effect on everyone's very next
   * request, because the signed-in user's consultancy status is read from the
   * database every time. Nothing is deleted either way.
   */
  async changeStatus(
    actor: AuthUser,
    id: string,
    input: ChangeTenantStatusInput,
  ): Promise<TenantDetail> {
    const current = await this.findRow(id);
    if (current.status === input.status) return this.get(id);

    await this.db
      .update(tenants)
      .set({
        status: input.status,
        statusReason: input.status === 'active' ? null : (input.reason ?? null),
        statusChangedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, id));
    this.resolver.invalidate();

    await this.audit.record(actor, {
      action: 'tenant.status_changed',
      entityType: 'tenant',
      entityId: id,
      tenantId: id,
      metadata: { from: current.status, to: input.status, reason: input.reason ?? null },
    });

    return this.get(id);
  }

  /* ---------------------------------------------------------------- */
  /* Logo                                                              */
  /* ---------------------------------------------------------------- */

  async setLogo(actor: AuthUser, id: string, file: { buffer: Buffer; size: number }) {
    const current = await this.findRow(id);

    if (!file.buffer?.length) throw logoError('That file appears to be empty.');
    if (file.size > LOGO_MAX_BYTES) throw logoError('Logos must be 1 MB or smaller.');

    // Judged by the leading bytes, not the name or the browser's claim.
    const mime = sniffMimeType(file.buffer);
    const ext = mime ? LOGO_TYPES[mime] : undefined;
    if (!mime || !ext) throw logoError('Upload the logo as a PNG, JPG or WEBP image.');

    const key = `tenants/${id}/branding/logo-${randomUUID()}.${ext}`;
    await this.storage.put(key, file.buffer, mime);
    await this.db
      .update(tenants)
      .set({ logoKey: key, updatedAt: new Date() })
      .where(eq(tenants.id, id));
    if (current.logoKey) await this.storage.delete(current.logoKey);
    this.resolver.invalidate();

    await this.audit.record(actor, {
      action: 'tenant.updated',
      entityType: 'tenant',
      entityId: id,
      tenantId: id,
      metadata: { changed: ['logo'] },
    });

    return this.get(id);
  }

  async removeLogo(actor: AuthUser, id: string) {
    const current = await this.findRow(id);
    if (!current.logoKey) return this.get(id);

    await this.db
      .update(tenants)
      .set({ logoKey: null, updatedAt: new Date() })
      .where(eq(tenants.id, id));
    await this.storage.delete(current.logoKey);
    this.resolver.invalidate();

    await this.audit.record(actor, {
      action: 'tenant.updated',
      entityType: 'tenant',
      entityId: id,
      tenantId: id,
      metadata: { changed: ['logo'], removed: true },
    });

    return this.get(id);
  }

  /** Public: a logo is shown on the sign-in page, before anyone is signed in. */
  async logo(tenantId: string): Promise<{ stream: Readable; mimeType: string }> {
    const [row] = await this.db
      .select({ logoKey: tenants.logoKey })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!row?.logoKey) throw new NotFoundException('No logo.');

    const ext = row.logoKey.split('.').pop() ?? '';
    const mimeType = LOGO_MIME_BY_EXT[ext];
    if (!mimeType) throw new NotFoundException('No logo.');

    return { stream: await this.storage.get(row.logoKey), mimeType };
  }

  /* ---------------------------------------------------------------- */
  /* Domains                                                           */
  /* ---------------------------------------------------------------- */

  async addDomain(actor: AuthUser, id: string, input: AddDomainInput): Promise<TenantDetail> {
    await this.findRow(id);

    const { platformDomain, adminHost } = tenancyConfig();
    const host = input.hostname;
    if (host === adminHost || host === platformDomain || host.endsWith(`.${platformDomain}`)) {
      throw new BadRequestException({
        message: 'That address belongs to the platform itself.',
        fieldErrors: {
          hostname: `Addresses under ${platformDomain} are assigned automatically. Enter the consultancy’s own domain.`,
        },
      });
    }

    try {
      await this.db.insert(tenantDomains).values({
        tenantId: id,
        hostname: host,
        verificationToken: randomBytes(16).toString('hex'),
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        // Not saying which consultancy has it: that is not this caller's
        // business even as an admin browsing a different account's page.
        throw new ConflictException({
          message: 'That domain is already registered.',
          fieldErrors: { hostname: 'That domain is already connected to a consultancy.' },
        });
      }
      throw err;
    }

    await this.audit.record(actor, {
      action: 'tenant.domain_added',
      entityType: 'domain',
      entityId: id,
      tenantId: id,
      metadata: { hostname: host },
    });

    return this.get(id);
  }

  /**
   * Looks the TXT record up in public DNS. Only a domain whose owner has
   * published the token is ever routed to a consultancy - otherwise anyone
   * could point someone else's domain at their own account, or squat on a
   * domain a real consultancy will want later.
   */
  async verifyDomain(actor: AuthUser, id: string, domainId: string): Promise<DomainCheckResult> {
    const tenant = await this.findRow(id);
    const domain = await this.findDomain(id, domainId);
    const platformHost = platformHostFor(tenant.slug);
    const found = await checkDomain(domain.hostname, domain.verificationToken, platformHost);

    const now = new Date();
    const newlyOwned = found.owned && !domain.verifiedAt;
    await this.db
      .update(tenantDomains)
      .set({
        dnsCheckedAt: now,
        pointsHereAt: found.pointsHere ? now : null,
        ...(newlyOwned ? { verifiedAt: now } : {}),
      })
      .where(eq(tenantDomains.id, domainId));
    if (newlyOwned) {
      this.resolver.invalidate();
      await this.audit.record(actor, {
        action: 'tenant.domain_verified',
        entityType: 'domain',
        entityId: domainId,
        tenantId: id,
        metadata: { hostname: domain.hostname, by: found.cname.includes(platformHost) ? 'cname' : 'txt' },
      });
    }

    const owned = found.owned || Boolean(domain.verifiedAt);
    const setup = setupRecords(domain.hostname, domain.verificationToken, platformHost);
    const first = setup.records[0]!;
    const pointTo = setup.apex
      ? first.value
        ? `an A record for ${domain.hostname} with the value ${first.value}`
        : `an A record for ${domain.hostname} with the server’s IP address`
      : `a CNAME record for ${domain.hostname} pointing to ${platformHost}`;
    const where = found.addresses.length || found.cname.length ? ` It currently leads to ${[...found.cname, ...found.addresses].join(', ')}.` : '';

    if (owned && found.pointsHere) {
      return { live: true, message: `${domain.hostname} is connected. The secure certificate is issued on the first visit, which can take up to a minute.` };
    }
    if (owned) {
      return { live: false, message: `Ownership is confirmed, but ${domain.hostname} does not lead here yet.${where} Add ${pointTo}. Changes usually show within minutes, sometimes up to a day.` };
    }
    if (found.pointsHere) {
      return { live: false, message: `${domain.hostname} leads here, but ownership is not proven yet. Add the TXT record shown, then check again.` };
    }
    const txt = found.txtFound.length ? ` A TXT record exists at ${DOMAIN_VERIFICATION_PREFIX}.${domain.hostname}, but its value is not the one shown.` : '';
    return { live: false, message: `Nothing is set up for ${domain.hostname} yet.${txt}${where} Add ${pointTo}${setup.apex ? ', and the TXT record shown' : ''}. Changes usually show within minutes, sometimes up to a day.` };
  }

  async removeDomain(actor: AuthUser, id: string, domainId: string): Promise<TenantDetail> {
    const domain = await this.findDomain(id, domainId);

    await this.db.delete(tenantDomains).where(eq(tenantDomains.id, domainId));
    this.resolver.invalidate();

    await this.audit.record(actor, {
      action: 'tenant.domain_removed',
      entityType: 'domain',
      entityId: domainId,
      tenantId: id,
      metadata: { hostname: domain.hostname, wasVerified: Boolean(domain.verifiedAt) },
    });

    return this.get(id);
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  private assertSlugUsable(slug: string): void {
    // A slug whose platform address is the admin address would be unreachable.
    if (platformHostFor(slug) === tenancyConfig().adminHost) {
      throw new BadRequestException({
        message: 'That address is reserved.',
        fieldErrors: { slug: 'That address is reserved for the platform.' },
      });
    }
  }

  private async findRow(id: string): Promise<TenantRow> {
    const [row] = await this.db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
    if (!row) throw new NotFoundException('Consultancy not found.');
    return row;
  }

  private async findDomain(tenantId: string, domainId: string): Promise<TenantDomainRow> {
    const [row] = await this.db
      .select()
      .from(tenantDomains)
      .where(and(eq(tenantDomains.id, domainId), eq(tenantDomains.tenantId, tenantId)))
      .limit(1);
    if (!row) throw new NotFoundException('Domain not found.');
    return row;
  }
}

function toSummary(
  t: TenantRow,
  counts: {
    staff: number;
    clients: number;
    activeCases: number;
    domains: number;
    planName: string | null;
  },
  graceDays: number,
): TenantSummary {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status as TenantStatus,
    statusReason: t.statusReason,
    primaryColor: t.primaryColor,
    logoUrl: logoUrlFor(t),
    platformHost: platformHostFor(t.slug),
    createdAt: iso(t.createdAt),
    counts: {
      staff: counts.staff ?? 0,
      clients: counts.clients ?? 0,
      activeCases: counts.activeCases ?? 0,
      domains: counts.domains ?? 0,
    },
    planName: counts.planName,
    subscriptionStatus: t.subscriptionStatus as SubscriptionStatus,
    subscription: subscriptionState(t.subscriptionStatus as SubscriptionStatus, t.currentPeriodEnd, today(), graceDays),
  };
}

function verificationRecord(d: Pick<TenantDomainRow, 'hostname' | 'verificationToken'>) {
  return {
    name: `${DOMAIN_VERIFICATION_PREFIX}.${d.hostname}`,
    value: `${DOMAIN_VERIFICATION_VALUE_PREFIX}${d.verificationToken}`,
  };
}

function toDomainView(d: TenantDomainRow, platformHost: string): TenantDomainView {
  const pointsHere = Boolean(d.pointsHereAt);
  return {
    id: d.id,
    hostname: d.hostname,
    verifiedAt: d.verifiedAt ? iso(d.verifiedAt) : null,
    pointsHere,
    checkedAt: d.dnsCheckedAt ? iso(d.dnsCheckedAt) : null,
    live: Boolean(d.verifiedAt) && pointsHere,
    verification: { type: 'TXT', ...verificationRecord(d) },
    setup: setupRecords(d.hostname, d.verificationToken, platformHost),
    createdAt: iso(d.createdAt),
  };
}

function slugTaken(): ConflictException {
  return new ConflictException({
    message: 'That address is already taken.',
    fieldErrors: { slug: 'Another consultancy already uses this address.' },
  });
}

function logoError(message: string): BadRequestException {
  return new BadRequestException({ message, fieldErrors: { file: message } });
}

/** Postgres unique_violation, from either driver. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

