import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  bpToPercent,
  financeSettingsSchema,
  gatewaySettingsSchema,
  percentToBp,
  promoCodeSchema,
  taxRateSchema,
  type AuthUser,
  type Currency,
  type FinanceSettingsInput,
  type FinanceSettingsView,
  type GatewayProvider,
  type GatewaySettingsInput,
  type LateFeeKind,
  type PromoCodeInput,
  type PromoCodeView,
  type PromoKind,
  type TaxRateInput,
  type TaxRateView,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { financeSettings, promoCodes, taxRates } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { tenantIdentity } from '../tenancy/tenant-links';
import { isUniqueViolation, today } from '../common/db-helpers';
import { open, seal } from '../auth/secret-box';
import { isProd } from '../config/env';
import { staffCan } from '../auth/permissions';

type SettingsRow = typeof financeSettings.$inferSelect;

/**
 * The consultancy's money rules: base currency, what invoices say, when a
 * discount needs a second pair of eyes, late fees and reminders, taxes,
 * promotion codes, the payment gateway, and the period lock.
 */
@Injectable()
export class FinanceSettingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /** The row, created on first use for a consultancy that predates it. */
  async row(tenantId: string): Promise<SettingsRow> {
    const [row] = await this.db.select().from(financeSettings).where(eq(financeSettings.tenantId, tenantId)).limit(1);
    if (row) return row;
    await this.db.insert(financeSettings).values({ tenantId }).onConflictDoNothing();
    const [created] = await this.db.select().from(financeSettings).where(eq(financeSettings.tenantId, tenantId)).limit(1);
    return created!;
  }

  async view(actor: AuthUser): Promise<FinanceSettingsView> {
    const tenantId = tenantOf(actor);
    const row = await this.row(tenantId);
    const site = await tenantIdentity(this.db, tenantId);
    return {
      baseCurrency: row.baseCurrency as Currency,
      bankDetails: row.bankDetails,
      invoiceTerms: row.invoiceTerms,
      discountApprovalPercent: row.discountApprovalBp === null ? null : bpToPercent(row.discountApprovalBp),
      directRefunds: row.directRefunds,
      lateFeeKind: row.lateFeeKind as LateFeeKind,
      lateFeeValue: row.lateFeeValue,
      lateFeeGraceDays: row.lateFeeGraceDays,
      reminderOffsets: row.reminderOffsets,
      lockedThrough: row.lockedThrough,
      gateway: {
        provider: row.gatewayProvider as GatewayProvider,
        stripeConfigured: Boolean(row.stripeSecretKey && row.stripeWebhookSecret),
        stripePublishableKey: row.stripePublishableKey,
        webhookUrl: `${site.origin}/api/billing/online/stripe/${tenantId}/webhook`,
        testAllowed: !isProd(),
      },
    };
  }

  async save(actor: AuthUser, raw: FinanceSettingsInput): Promise<FinanceSettingsView> {
    const input = financeSettingsSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const before = await this.row(tenantId);
    if (input.baseCurrency !== before.baseCurrency) {
      const [used] = await this.db.execute<{ n: number }>(sql`select count(*)::int as n from journal_entries where tenant_id = ${tenantId} and source_type <> 'opening'`).then(
        (r) => ((r as unknown as { rows?: { n: number }[] }).rows ?? (r as unknown as { n: number }[])),
      );
      if ((used?.n ?? 0) > 0 && actor.role !== 'manager') {
        throw new ForbiddenException('Only a manager can change the base currency once the books have entries.');
      }
    }
    await this.db
      .update(financeSettings)
      .set({
        baseCurrency: input.baseCurrency,
        bankDetails: input.bankDetails,
        invoiceTerms: input.invoiceTerms,
        discountApprovalBp: input.discountApprovalPercent === null ? null : percentToBp(input.discountApprovalPercent),
        directRefunds: input.directRefunds,
        lateFeeKind: input.lateFeeKind,
        lateFeeValue: input.lateFeeKind === 'percent' ? percentToBp(input.lateFeeValue) : Math.round(input.lateFeeValue * 100),
        lateFeeGraceDays: input.lateFeeGraceDays,
        reminderOffsets: [...new Set(input.reminderOffsets)].sort((a, b) => a - b),
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(financeSettings.tenantId, tenantId));
    await this.audit.record(actor, {
      action: 'finance.settings_changed',
      entityType: 'finance_settings',
      entityId: tenantId,
      metadata: {
        before: { baseCurrency: before.baseCurrency, discountApprovalBp: before.discountApprovalBp, lateFeeKind: before.lateFeeKind, directRefunds: before.directRefunds },
        after: { baseCurrency: input.baseCurrency, discountApprovalPercent: input.discountApprovalPercent, lateFeeKind: input.lateFeeKind, directRefunds: input.directRefunds },
      },
    });
    return this.view(actor);
  }

  async saveGateway(actor: AuthUser, raw: GatewaySettingsInput): Promise<FinanceSettingsView> {
    const input = gatewaySettingsSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const row = await this.row(tenantId);
    if (input.provider === 'test' && isProd()) {
      throw new BadRequestException('Test payments are switched off on a live server.');
    }
    const secret = input.stripeSecretKey ? seal(input.stripeSecretKey) : row.stripeSecretKey;
    const webhook = input.stripeWebhookSecret ? seal(input.stripeWebhookSecret) : row.stripeWebhookSecret;
    if (input.provider === 'stripe' && (!secret || !webhook)) {
      throw new BadRequestException({
        message: 'Stripe needs your secret key and the webhook signing secret.',
        fieldErrors: { [!secret ? 'stripeSecretKey' : 'stripeWebhookSecret']: 'Required for Stripe' },
      });
    }
    await this.db
      .update(financeSettings)
      .set({
        gatewayProvider: input.provider,
        stripeSecretKey: secret,
        stripeWebhookSecret: webhook,
        stripePublishableKey: input.stripePublishableKey ?? row.stripePublishableKey,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(financeSettings.tenantId, tenantId));
    await this.audit.record(actor, {
      action: 'finance.settings_changed',
      entityType: 'finance_settings',
      entityId: tenantId,
      // Never the keys themselves - only that they changed.
      metadata: { gateway: input.provider, secretKeyChanged: Boolean(input.stripeSecretKey), webhookSecretChanged: Boolean(input.stripeWebhookSecret) },
    });
    return this.view(actor);
  }

  /** The gateway and its opened secrets, for the payments service only. */
  async gatewayFor(tenantId: string): Promise<{ provider: GatewayProvider; stripeSecretKey: string | null; stripeWebhookSecret: string | null }> {
    const row = await this.row(tenantId);
    return {
      provider: row.gatewayProvider as GatewayProvider,
      stripeSecretKey: row.stripeSecretKey ? open(row.stripeSecretKey) : null,
      stripeWebhookSecret: row.stripeWebhookSecret ? open(row.stripeWebhookSecret) : null,
    };
  }

  /**
   * Closes the books up to a date (or reopens them). Moving the lock forward
   * is the accountant's month-end; moving it back reopens a closed period and
   * is a manager's call only.
   */
  async lock(actor: AuthUser, through: string | null): Promise<FinanceSettingsView> {
    const tenantId = tenantOf(actor);
    const row = await this.row(tenantId);
    const reopening = row.lockedThrough !== null && (through === null || through < row.lockedThrough);
    if (reopening && actor.role !== 'manager') throw new ForbiddenException('Only a manager can reopen a closed period.');
    if (through && through >= today()) {
      throw new BadRequestException({ message: 'Close a period that has ended - up to yesterday at the latest.', fieldErrors: { through: 'Must be before today' } });
    }
    await this.db
      .update(financeSettings)
      .set({ lockedThrough: through, lockedBy: actor.id, updatedAt: new Date() })
      .where(eq(financeSettings.tenantId, tenantId));
    await this.audit.record(actor, {
      action: 'period.locked',
      entityType: 'finance_settings',
      entityId: tenantId,
      metadata: { from: row.lockedThrough, to: through, reopened: reopening },
    });
    return this.view(actor);
  }

  /* ---------------------------------------------------------------- */
  /* Taxes                                                             */
  /* ---------------------------------------------------------------- */

  async taxes(actor: AuthUser, includeInactive = true): Promise<TaxRateView[]> {
    const rows = await this.db
      .select()
      .from(taxRates)
      .where(and(eq(taxRates.tenantId, tenantOf(actor)), includeInactive ? undefined : eq(taxRates.active, true)))
      .orderBy(asc(taxRates.name));
    return rows.map(toTax);
  }

  async saveTax(actor: AuthUser, raw: TaxRateInput, id?: string): Promise<TaxRateView> {
    const input = taxRateSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const values = {
      name: input.name,
      rateBp: percentToBp(input.ratePercent),
      inclusive: input.inclusive,
      isDefault: input.isDefault && input.active,
      active: input.active,
      updatedAt: new Date(),
    };
    try {
      const row = await this.db.transaction(async (tx) => {
        if (values.isDefault) {
          await tx
            .update(taxRates)
            .set({ isDefault: false })
            .where(and(eq(taxRates.tenantId, tenantId), id ? ne(taxRates.id, id) : undefined));
        }
        if (id) {
          const [r] = await tx.update(taxRates).set(values).where(and(eq(taxRates.id, id), eq(taxRates.tenantId, tenantId))).returning();
          if (!r) throw new NotFoundException('Tax rate not found.');
          return r;
        }
        const [r] = await tx.insert(taxRates).values({ tenantId, ...values }).returning();
        return r!;
      });
      await this.audit.record(actor, { action: 'tax.saved', entityType: 'tax_rate', entityId: row.id, metadata: { name: row.name, rateBp: row.rateBp, inclusive: row.inclusive } });
      return toTax(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ message: 'There is already a tax with that name.', fieldErrors: { name: 'Already used' } });
      throw err;
    }
  }

  /** Tax rates by id, this consultancy's own and active - for pricing lines. */
  async ratesById(tenantId: string, ids: string[]): Promise<Map<string, typeof taxRates.$inferSelect>> {
    if (!ids.length) return new Map();
    const rows = await this.db
      .select()
      .from(taxRates)
      .where(and(eq(taxRates.tenantId, tenantId), inArray(taxRates.id, ids)));
    const map = new Map(rows.map((r) => [r.id, r]));
    for (const id of ids) {
      const r = map.get(id);
      if (!r || !r.active) throw new BadRequestException({ message: 'One of those tax rates is not in your list (or is switched off).', fieldErrors: { items: 'Unknown tax rate' } });
    }
    return map;
  }

  /* ---------------------------------------------------------------- */
  /* Promotion codes                                                   */
  /* ---------------------------------------------------------------- */

  async promos(actor: AuthUser): Promise<PromoCodeView[]> {
    const tenantId = tenantOf(actor);
    const rows = await this.db
      .select({
        p: promoCodes,
        uses: sql<number>`(select count(*)::int from invoices i where i.promo_code_id = ${promoCodes.id} and i.status <> 'void')`,
      })
      .from(promoCodes)
      .where(eq(promoCodes.tenantId, tenantId))
      .orderBy(asc(promoCodes.code));
    return rows.map((r) => toPromo(r.p, r.uses));
  }

  async savePromo(actor: AuthUser, raw: PromoCodeInput, id?: string): Promise<PromoCodeView> {
    const input = promoCodeSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const values = {
      code: input.code,
      description: input.description,
      kind: input.kind,
      value: input.kind === 'percent' ? percentToBp(input.value) : Math.round(input.value * 100),
      currency: input.kind === 'fixed' ? (input.currency ?? null) : null,
      validFrom: input.validFrom ?? null,
      validTo: input.validTo ?? null,
      maxUses: input.maxUses ?? null,
      active: input.active,
      updatedAt: new Date(),
    };
    try {
      let row: typeof promoCodes.$inferSelect | undefined;
      if (id) {
        [row] = await this.db.update(promoCodes).set(values).where(and(eq(promoCodes.id, id), eq(promoCodes.tenantId, tenantId))).returning();
        if (!row) throw new NotFoundException('Promotion not found.');
      } else {
        [row] = await this.db.insert(promoCodes).values({ tenantId, createdBy: actor.id, ...values }).returning();
      }
      await this.audit.record(actor, { action: 'promo.saved', entityType: 'promo_code', entityId: row!.id, metadata: { code: row!.code, kind: row!.kind, value: row!.value } });
      return (await this.promos(actor)).find((p) => p.id === row!.id)!;
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ message: 'That code is already in use.', fieldErrors: { code: 'Already used' } });
      throw err;
    }
  }

  /**
   * Whether a code can be used on an invoice now, and its discount. A
   * refusal says why in words the person at the counter can repeat.
   */
  async resolvePromo(
    tenantId: string,
    code: string,
    currency: string,
    on: string = today(),
  ): Promise<{ id: string; kind: PromoKind; value: number; code: string }> {
    const [p] = await this.db
      .select({
        p: promoCodes,
        uses: sql<number>`(select count(*)::int from invoices i where i.promo_code_id = ${promoCodes.id} and i.status <> 'void')`,
      })
      .from(promoCodes)
      .where(and(eq(promoCodes.tenantId, tenantId), eq(promoCodes.code, code.trim().toUpperCase())))
      .limit(1);
    const fail = (message: string) => new BadRequestException({ message, fieldErrors: { promoCode: message } });
    if (!p || !p.p.active) throw fail('That promotion code is not valid.');
    if (p.p.validFrom && on < p.p.validFrom) throw fail(`That code starts on ${p.p.validFrom}.`);
    if (p.p.validTo && on > p.p.validTo) throw fail(`That code ended on ${p.p.validTo}.`);
    if (p.p.maxUses !== null && p.uses >= p.p.maxUses) throw fail('That code has been used as many times as it allows.');
    if (p.p.kind === 'fixed' && p.p.currency !== currency) throw fail(`That code is for ${p.p.currency} invoices.`);
    return { id: p.p.id, kind: p.p.kind as PromoKind, value: p.p.value, code: p.p.code };
  }

  /** Who may change these: managers and holders of the finance settings permission. */
  assertSettings(actor: AuthUser): void {
    if (!staffCan(actor, 'finance.settings')) throw new ForbiddenException('You do not have permission to change finance settings.');
  }
}


function toTax(r: typeof taxRates.$inferSelect): TaxRateView {
  return { id: r.id, name: r.name, rateBp: r.rateBp, ratePercent: bpToPercent(r.rateBp), inclusive: r.inclusive, isDefault: r.isDefault, active: r.active };
}

function toPromo(p: typeof promoCodes.$inferSelect, uses: number): PromoCodeView {
  return {
    id: p.id,
    code: p.code,
    description: p.description,
    kind: p.kind as PromoKind,
    value: p.value,
    currency: (p.currency as Currency | null) ?? null,
    validFrom: p.validFrom,
    validTo: p.validTo,
    maxUses: p.maxUses,
    uses: Number(uses),
    active: p.active,
  };
}

