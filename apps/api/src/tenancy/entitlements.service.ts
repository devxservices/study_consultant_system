import { ForbiddenException, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  MODULES,
  MODULE_LABEL,
  subscriptionState,
  type Entitlements,
  type Module,
  type SubscriptionState,
  type SubscriptionStatus,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { clients, documents, plans, tenants, users } from '../db/schema';
import { today } from '../common/db-helpers';
import { PlatformSettingsService } from './platform-settings.service';
import { StatsCacheService } from '../stats/stats-cache.service';

export const REQUIRES_MODULE = 'tenancy:requires-module';

/**
 * Marks a controller or route as part of an optional module. The auth guard
 * refuses it, server-side, to a consultancy whose plan does not include it -
 * hiding the menu item is a courtesy, this is the rule.
 */
export const RequiresModule = (module: Module) => SetMetadata(REQUIRES_MODULE, module);

interface TenantPlan {
  planName: string | null;
  subscriptionStatus: SubscriptionStatus;
  currentPeriodEnd: string | null;
  subscription: SubscriptionState;
  modules: Module[];
  limits: { maxStaff: number | null; maxActiveClients: number | null; storageGb: number | null };
}

/**
 * What a consultancy's plan lets it do.
 *
 * No plan at all means everything is on and nothing is limited - the
 * behaviour every consultancy had before plans existed, so assigning plans is
 * something the platform opts into, never a surprise lock-out.
 */
@Injectable()
export class EntitlementsService {
  private readonly cache = new Map<string, { at: number; value: TenantPlan }>();
  private static readonly TTL_MS = 30_000;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly settings: PlatformSettingsService,
    private readonly stats: StatsCacheService,
  ) {}

  invalidate(): void {
    this.cache.clear();
  }

  async plan(tenantId: string): Promise<TenantPlan> {
    const hit = this.cache.get(tenantId);
    if (hit && Date.now() - hit.at < EntitlementsService.TTL_MS) return hit.value;

    const [row] = await this.db
      .select({
        status: tenants.subscriptionStatus,
        periodEnd: tenants.currentPeriodEnd,
        planName: plans.name,
        modules: plans.modules,
        maxStaff: plans.maxStaff,
        maxActiveClients: plans.maxActiveClients,
        storageGb: plans.storageGb,
        hasPlan: plans.id,
      })
      .from(tenants)
      .leftJoin(plans, eq(plans.id, tenants.planId))
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const status = (row?.status as SubscriptionStatus | undefined) ?? 'active';
    const subscription = subscriptionState(status, row?.periodEnd ?? null, today(), (await this.settings.billing()).graceDays);
    const value: TenantPlan = row?.hasPlan
      ? {
          planName: row.planName,
          subscriptionStatus: status,
          currentPeriodEnd: row.periodEnd,
          subscription,
          modules: (row.modules ?? []).filter((m): m is Module =>
            (MODULES as readonly string[]).includes(m),
          ),
          limits: {
            maxStaff: row.maxStaff,
            maxActiveClients: row.maxActiveClients,
            storageGb: row.storageGb,
          },
        }
      : {
          planName: null,
          subscriptionStatus: status,
          currentPeriodEnd: row?.periodEnd ?? null,
          subscription,
          modules: [...MODULES],
          limits: { maxStaff: null, maxActiveClients: null, storageGb: null },
        };

    this.cache.set(tenantId, { at: Date.now(), value });
    return value;
  }

  /**
   * Whether staff may change records today, by the date the consultancy has
   * paid until. The auth guard asks on every write; see SubscriptionAccess.
   */
  async subscription(tenantId: string): Promise<SubscriptionState> {
    return (await this.plan(tenantId)).subscription;
  }

  async hasModule(tenantId: string, module: Module): Promise<boolean> {
    return (await this.plan(tenantId)).modules.includes(module);
  }

  async assertModule(tenantId: string, module: Module): Promise<void> {
    if (!(await this.hasModule(tenantId, module))) {
      // The code lets the web app show a plain 'not in your plan' page instead of an error.
      throw new ForbiddenException({
        message: `${MODULE_LABEL[module]} is not part of your consultancy’s plan. Ask the platform administrator to upgrade it.`,
        code: 'MODULE_OFF',
        module,
      });
    }
  }

  async assertCanAddStaff(tenantId: string): Promise<void> {
    const { limits } = await this.plan(tenantId);
    if (limits.maxStaff === null) return;
    const used = await this.staffCount(tenantId);
    if (used >= limits.maxStaff) {
      throw new ForbiddenException(
        `Your plan allows ${limits.maxStaff} staff accounts and all of them are in use. Deactivate one or upgrade the plan.`,
      );
    }
  }

  async assertCanAddClient(tenantId: string): Promise<void> {
    const { limits } = await this.plan(tenantId);
    if (limits.maxActiveClients === null) return;
    // Counting stops at the limit: "is it reached?" needs no more than that,
    // whatever the size of the consultancy.
    const used = await this.activeClientCount(tenantId, limits.maxActiveClients);
    if (used >= limits.maxActiveClients) {
      throw new ForbiddenException(
        `Your plan allows ${limits.maxActiveClients} active clients. Archive finished clients or upgrade the plan.`,
      );
    }
  }

  async assertStorageFor(tenantId: string, bytes: number): Promise<void> {
    const { limits } = await this.plan(tenantId);
    if (limits.storageGb === null) return;
    // The figure the menu shows (stats cache): exact for a consultancy of
    // normal size, a few seconds behind for one whose total takes long to add up.
    const used = (await this.usage(tenantId)).storageBytes;
    if (used + bytes > limits.storageGb * 1024 ** 3) {
      throw new ForbiddenException(
        `Your consultancy has used its ${limits.storageGb} GB of document storage. Ask the platform administrator for more space.`,
      );
    }
  }

  async entitlements(tenantId: string): Promise<Entitlements> {
    const [p, usage] = await Promise.all([this.plan(tenantId), this.usage(tenantId)]);
    return { ...p, usage };
  }

  /**
   * What the consultancy uses of its plan. Every page asks for this to build
   * its menu, and two of the three figures count or add up every client and
   * document, so they come through the stats cache: one primary-key read per
   * page, recomputed (in one round trip) only after something changed.
   */
  private usage(tenantId: string): Promise<Entitlements['usage']> {
    return this.stats.get(tenantId, 'usage', async () => {
      const [row] = await this.db
        .select({
          staff: sql<number>`${this.staffCountQuery(tenantId)}`,
          activeClients: sql<number>`${this.activeClientCountQuery(tenantId)}`,
          storageBytes: sql<number>`${this.storageBytesQuery(tenantId)}`,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);
      return {
        staff: row?.staff ?? 0,
        activeClients: row?.activeClients ?? 0,
        storageBytes: Number(row?.storageBytes ?? 0),
      };
    });
  }

  private async staffCount(tenantId: string): Promise<number> {
    const [row] = await this.staffCountQuery(tenantId);
    return row?.n ?? 0;
  }

  /** Active clients, counted up to `upTo` - enough to compare with a limit. */
  private async activeClientCount(tenantId: string, upTo: number): Promise<number> {
    const [row] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(
        this.db
          .select({ one: sql`1` })
          .from(clients)
          .where(and(eq(clients.tenantId, tenantId), eq(clients.archived, false)))
          .limit(Math.max(0, upTo))
          .as('counted'),
      );
    return row?.n ?? 0;
  }

  private staffCountQuery(tenantId: string) {
    return this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(users)
      .where(
        and(
          eq(users.tenantId, tenantId),
          inArray(users.role, ['manager', 'consultant']),
          eq(users.isActive, true),
        ),
      );
  }

  private activeClientCountQuery(tenantId: string) {
    return this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(clients)
      .where(and(eq(clients.tenantId, tenantId), eq(clients.archived, false)));
  }

  private storageBytesQuery(tenantId: string) {
    return this.db
      .select({ n: sql<number>`coalesce(sum(${documents.fileSize}), 0)::bigint` })
      .from(documents)
      .where(and(eq(documents.tenantId, tenantId), isNull(documents.deletedAt)));
  }
}
