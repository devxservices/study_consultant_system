import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import type { AuthUser, Currency, Module, PlanInput, PlanView, TenantSubscriptionInput } from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { plans, tenants, type PlanRow } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { EntitlementsService } from './entitlements.service';

/** The outer plan, named explicitly - see TENANT_ID in tenants.service for why. */
const PLAN_ID = sql.raw('"plans"."id"');
const tenantCountSql = sql<number>`(select count(*)::int from tenants t where t.plan_id = ${PLAN_ID})`;

/** Subscription plans and which consultancy is on which. Platform admin only. */
@Injectable()
export class PlansService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly entitlements: EntitlementsService,
  ) {}

  async list(): Promise<PlanView[]> {
    const rows = await this.db
      .select({ plan: plans, tenantCount: tenantCountSql })
      .from(plans)
      .orderBy(asc(plans.priceMonthly));
    return rows.map((r) => toView(r.plan, r.tenantCount ?? 0));
  }

  async create(input: PlanInput): Promise<PlanView> {
    const [taken] = await this.db.select({ id: plans.id }).from(plans).where(eq(plans.code, input.code));
    if (taken) {
      throw new ConflictException({
        message: 'That code is already used.',
        fieldErrors: { code: 'Another plan uses this code.' },
      });
    }
    const [row] = await this.db.insert(plans).values(input).returning();
    return toView(row!, 0);
  }

  async update(id: string, input: PlanInput): Promise<PlanView> {
    const [row] = await this.db
      .update(plans)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(plans.id, id))
      .returning();
    if (!row) throw new NotFoundException('Plan not found.');
    // Every consultancy on this plan gets the new modules and limits at once.
    this.entitlements.invalidate();
    return (await this.list()).find((p) => p.id === id)!;
  }

  async setSubscription(actor: AuthUser, tenantId: string, input: TenantSubscriptionInput) {
    const [current] = await this.db
      .select({ planId: tenants.planId, status: tenants.subscriptionStatus })
      .from(tenants)
      .where(eq(tenants.id, tenantId));
    if (!current) throw new NotFoundException('Consultancy not found.');
    if (input.planId) {
      const [plan] = await this.db.select({ id: plans.id }).from(plans).where(eq(plans.id, input.planId));
      if (!plan) throw new NotFoundException('Plan not found.');
    }

    await this.db
      .update(tenants)
      .set({
        planId: input.planId,
        subscriptionStatus: input.subscriptionStatus,
        currentPeriodEnd: input.currentPeriodEnd ?? null,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId));
    this.entitlements.invalidate();

    await this.audit.record(actor, {
      action: 'tenant.plan_changed',
      entityType: 'tenant',
      entityId: tenantId,
      tenantId,
      metadata: {
        from: { planId: current.planId, status: current.status },
        to: { planId: input.planId, status: input.subscriptionStatus },
      },
    });
  }
}

function toView(p: PlanRow, tenantCount: number): PlanView {
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    priceMonthly: p.priceMonthly,
    currency: p.currency as Currency,
    maxStaff: p.maxStaff,
    maxActiveClients: p.maxActiveClients,
    storageGb: p.storageGb,
    modules: p.modules as Module[],
    active: p.active,
    tenantCount,
  };
}
