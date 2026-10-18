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
    const used = await this.activeClientCount(tenantId);
    if (used >= limits.maxActiveClients) {
      throw new ForbiddenException(
        `Your plan allows ${limits.maxActiveClients} active clients. Archive finished clients or upgrade the plan.`,
      );
    }
  }

  async assertStorageFor(tenantId: string, bytes: number): Promise<void> {
    const { limits } = await this.plan(tenantId);
    if (limits.storageGb === null) return;
    const used = await this.storageBytes(tenantId);
    if (used + bytes > limits.storageGb * 1024 ** 3) {
      throw new ForbiddenException(
        `Your consultancy has used its ${limits.storageGb} GB of document storage. Ask the platform administrator for more space.`,
      );
    }
  }

  async entitlements(tenantId: string): Promise<Entitlements> {
    const p = await this.plan(tenantId);
    // Every page asks for this to build its menu, so the three usage figures
    // travel in one round trip - the same three queries, as subqueries.
    const [usage] = await this.db
      .select({
        staff: sql<number>`${this.staffCountQuery(tenantId)}`,
        activeClients: sql<number>`${this.activeClientCountQuery(tenantId)}`,
        storageBytes: sql<number>`${this.storageBytesQuery(tenantId)}`,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    return {
      ...p,
      usage: {
        staff: usage?.staff ?? 0,
        activeClients: usage?.activeClients ?? 0,
        storageBytes: Number(usage?.storageBytes ?? 0),
      },
    };
  }

  private async staffCount(tenantId: string): Promise<number> {
    const [row] = await this.staffCountQuery(tenantId);
    return row?.n ?? 0;
  }

  private async activeClientCount(tenantId: string): Promise<number> {
    const [row] = await this.activeClientCountQuery(tenantId);
    return row?.n ?? 0;
  }

  private async storageBytes(tenantId: string): Promise<number> {
    const [row] = await this.storageBytesQuery(tenantId);
    return Number(row?.n ?? 0);
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
