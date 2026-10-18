import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import {
  EARNING_KIND_LABEL,
  PARTNER_RULE_BASIS_LABEL,
  caseFacts,
  earningAdjustmentSchema,
  earningsQuerySchema,
  formatMoney,
  matchPartnerRule,
  partnerRuleSchema,
  type AuthUser,
  type Condition,
  type ConditionFacts,
  type Currency,
  type EarningAdjustmentInput,
  type EarningKind,
  type EarningStatus,
  type Paginated,
  type PartnerEarningView,
  type PartnerRuleBasis,
  type PartnerRuleInput,
  type PartnerRuleView,
  type PartnerTier,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import {
  cases,
  clients,
  commissions,
  financeSettings,
  institutions,
  invoiceItems,
  invoices,
  partnerEarnings,
  partnerRules,
  partners,
  payouts,
  receiptAllocations,
  users,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { CommissionsService, type CommissionEvent } from '../commissions/commissions.service';
import { BillingService, type PaymentEvent } from '../billing/billing.service';
import { liveEntryFor, postEntry, reverseEntry, type Tx } from '../finance/journal';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { staffCan } from '../auth/permissions';
import { iso, isUniqueViolation, page, today, withDocumentNumber } from '../common/db-helpers';
import { qualified } from '../documents/drive-sql';
import { PartnersService, type PartnerRow } from './partners.service';

type EarningRow = typeof partnerEarnings.$inferSelect;
type RuleRow = typeof partnerRules.$inferSelect;

interface NewEarning {
  tenantId: string;
  partner: PartnerRow;
  kind: EarningKind;
  clientId: string | null;
  fromPartnerId?: string | null;
  sourceType: string | null;
  sourceId: string | null;
  relatedEarningId?: string | null;
  ruleId?: string | null;
  description: string;
  basisAmount: number | null;
  basisCurrency: string | null;
  rateBp: number | null;
  amount: number;
  currency: string;
  fxRate: number | null;
  earnedOn: string;
  createdBy: string | null;
}

/**
 * What partners earn, and the rules it is worked out by.
 *
 * Earnings follow the money: a share of university commission as the
 * university pays it (from the commission module's receipts), a fixed
 * amount when a student's enrolment is confirmed, a share of the
 * consultancy's own fees as the student pays them (from billing). Each one
 * is booked as it is made - Dr partner commission, Cr partner payable - and
 * a master partner's override follows its sub-agent's. When the money it came
 * from is voided, refunded or clawed back, an unpaid earning is reversed and
 * a paid one is taken back from the next payout.
 */
@Injectable()
export class PartnerEarningsService implements OnModuleInit {
  private readonly logger = new Logger(PartnerEarningsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly partners: PartnersService,
    private readonly commissions: CommissionsService,
    private readonly billing: BillingService,
  ) {}

  onModuleInit(): void {
    this.commissions.onCommission((e) => this.onCommission(e));
    this.billing.onPayment((e) => this.onPayment(e));
  }

  /* ---------------------------------------------------------------- */
  /* Rules                                                             */
  /* ---------------------------------------------------------------- */

  async rules(actor: AuthUser, includeOld = false): Promise<PartnerRuleView[]> {
    this.partners.assertView(actor);
    return this.ruleViews(tenantOf(actor), includeOld);
  }

  private async ruleViews(tenantId: string, includeOld: boolean, partnerId?: string): Promise<PartnerRuleView[]> {
    const creator = alias(users, 'creator');
    const rows = await this.db
      .select({ r: partnerRules, partnerName: partners.name, institutionName: institutions.name, createdByName: creator.fullName })
      .from(partnerRules)
      .leftJoin(partners, eq(partners.id, partnerRules.partnerId))
      .leftJoin(institutions, eq(institutions.id, partnerRules.institutionId))
      .leftJoin(creator, eq(creator.id, partnerRules.createdBy))
      .where(
        and(
          eq(partnerRules.tenantId, tenantId),
          includeOld ? undefined : isNull(partnerRules.supersededAt),
          partnerId ? sql`(${partnerRules.partnerId} is null or ${partnerRules.partnerId} = ${partnerId})` : undefined,
        ),
      )
      .orderBy(asc(partnerRules.basis), asc(partnerRules.name), desc(partnerRules.version));
    const counts = rows.length
      ? await this.db
          .select({ id: partnerEarnings.ruleId, n: sql<number>`count(*)::int` })
          .from(partnerEarnings)
          .where(inArray(partnerEarnings.ruleId, rows.map((r) => r.r.id)))
          .groupBy(partnerEarnings.ruleId)
      : [];
    return rows.map(({ r, partnerName, institutionName, createdByName }) => ({
      ...ruleData(r),
      id: r.id,
      ruleKey: r.ruleKey,
      version: r.version,
      superseded: Boolean(r.supersededAt),
      partnerName,
      institutionName,
      earnings: counts.find((c) => c.id === r.id)?.n ?? 0,
      createdByName,
      createdAt: iso(r.createdAt),
    }));
  }

  /**
   * Saves a rule. A rule nothing has been earned under is changed in place;
   * once something has, the change is a new version and the old one is kept
   * (superseded) so those earnings still show the terms they were made under.
   */
  async saveRule(actor: AuthUser, raw: PartnerRuleInput, ruleKey?: string): Promise<PartnerRuleView[]> {
    this.partners.assertManage(actor);
    const input = partnerRuleSchema.parse(raw);
    const tenantId = tenantOf(actor);
    if (input.partnerId) await this.partners.find(tenantId, input.partnerId);
    if (input.institutionId) {
      const [i] = await this.db.select({ id: institutions.id }).from(institutions).where(and(eq(institutions.id, input.institutionId), eq(institutions.tenantId, tenantId))).limit(1);
      if (!i) throw new BadRequestException({ message: 'Choose one of your institutions.', fieldErrors: { institutionId: 'Not found' } });
    }
    const values = {
      name: input.name,
      basis: input.basis,
      rateBp: input.basis === 'fixed_per_student' ? 0 : Math.round(input.ratePercent * 100),
      fixedAmount: input.basis === 'fixed_per_student' ? Math.round(input.fixedAmount * 100) : 0,
      currency: input.basis === 'fixed_per_student' ? (input.currency ?? null) : null,
      partnerId: input.partnerId ?? null,
      tier: input.tier ?? null,
      institutionId: input.basis === 'fee_share' ? null : (input.institutionId ?? null),
      feeCategories: input.basis === 'fee_share' ? input.feeCategories : [],
      conditions: input.conditions,
      validFrom: input.validFrom,
      validTo: input.validTo ?? null,
      active: input.active,
    };
    let saved: RuleRow;
    if (!ruleKey) {
      [saved] = (await this.db.insert(partnerRules).values({ tenantId, ruleKey: randomUUID(), version: 1, ...values, createdBy: actor.id }).returning()) as [RuleRow];
    } else {
      const [current] = await this.db
        .select()
        .from(partnerRules)
        .where(and(eq(partnerRules.ruleKey, ruleKey), eq(partnerRules.tenantId, tenantId), isNull(partnerRules.supersededAt)))
        .limit(1);
      if (!current) throw new NotFoundException('Rule not found.');
      if (current.basis !== input.basis) throw new BadRequestException({ message: 'A rule keeps its kind. Add a new rule instead.', fieldErrors: { basis: 'Cannot change' } });
      const [used] = await this.db.select({ id: partnerEarnings.id }).from(partnerEarnings).where(eq(partnerEarnings.ruleId, current.id)).limit(1);
      if (!used) {
        [saved] = (await this.db.update(partnerRules).set(values).where(eq(partnerRules.id, current.id)).returning()) as [RuleRow];
      } else {
        saved = await this.db.transaction(async (tx) => {
          await tx.update(partnerRules).set({ supersededAt: new Date() }).where(eq(partnerRules.id, current.id));
          const [row] = await tx.insert(partnerRules).values({ tenantId, ruleKey, version: current.version + 1, ...values, createdBy: actor.id }).returning();
          return row!;
        });
      }
    }
    await this.audit.record(actor, {
      action: 'partner_rule.saved',
      entityType: 'settings',
      entityId: saved.id,
      metadata: { name: saved.name, basis: saved.basis, version: saved.version, rateBp: saved.rateBp, fixedAmount: saved.fixedAmount, partnerId: saved.partnerId, tier: saved.tier, active: saved.active },
    });
    return this.ruleViews(tenantId, false);
  }

  /** The rule that applies to this partner for this kind of earning, on this day. */
  private async match(tenantId: string, basis: PartnerRuleBasis, partner: PartnerRow, institutionId: string | null, facts: ConditionFacts, day: string): Promise<RuleRow | null> {
    const rows = await this.db.select().from(partnerRules).where(and(eq(partnerRules.tenantId, tenantId), eq(partnerRules.basis, basis), isNull(partnerRules.supersededAt)));
    const candidates = rows.map((r) => ({ ...ruleData(r), row: r }));
    return matchPartnerRule(candidates, basis, { partnerId: partner.id, tier: partner.tier as PartnerTier, institutionId }, facts, day)?.row ?? null;
  }

  /* ---------------------------------------------------------------- */
  /* Listening                                                         */
  /* ---------------------------------------------------------------- */

  async onCommission(e: CommissionEvent): Promise<void> {
    const [c] = await this.db
      .select({ c: commissions, partnerId: clients.partnerId, clientName: clients.fullName })
      .from(commissions)
      .leftJoin(clients, eq(clients.id, commissions.clientId))
      .where(and(eq(commissions.id, e.commissionId), eq(commissions.tenantId, e.tenantId)))
      .limit(1);
    if (!c) return;
    const actorId = e.actor?.id ?? null;

    if (e.type === 'received' || e.type === 'confirmed') {
      // Only a student's commission is anyone's to share; bonuses are the consultancy's.
      if (c.c.kind !== 'student' || !c.partnerId || !c.c.clientId) return;
      const partner = await this.partnerFor(e.tenantId, c.partnerId);
      if (!partner) return;
      const facts = await this.factsOf(c.c.caseId);
      if (e.type === 'received') {
        const rule = await this.match(e.tenantId, 'commission_share', partner, c.c.institutionId, facts, e.on);
        if (!rule) return;
        const converted = await this.inPartnerCurrency(e.tenantId, partner, e.amount, c.c.currency, e.fxRate);
        const earning = await this.earn({
          tenantId: e.tenantId,
          partner,
          kind: 'commission_share',
          clientId: c.c.clientId,
          sourceType: 'receipt_allocation',
          sourceId: e.allocationId,
          ruleId: rule.id,
          description: `${rule.rateBp / 100}% of ${formatMoney(e.amount, c.c.currency)} received on ${c.c.number}`,
          basisAmount: e.amount,
          basisCurrency: c.c.currency,
          rateBp: rule.rateBp,
          amount: Math.round((converted.amount * rule.rateBp) / 10_000),
          currency: converted.currency,
          fxRate: converted.fxRate,
          earnedOn: e.on,
          createdBy: actorId,
        });
        if (earning) await this.override(e.tenantId, partner, earning, converted.amount, actorId);
      } else {
        // Once per student: the first year's commission confirms the enrolment.
        if (c.c.yearNo !== 1) return;
        const rule = await this.match(e.tenantId, 'fixed_per_student', partner, c.c.institutionId, facts, e.on);
        if (!rule || !rule.currency) return;
        const converted = await this.inPartnerCurrency(e.tenantId, partner, rule.fixedAmount, rule.currency, null);
        const earning = await this.earn({
          tenantId: e.tenantId,
          partner,
          kind: 'fixed_per_student',
          clientId: c.c.clientId,
          sourceType: 'commission',
          sourceId: c.c.id,
          ruleId: rule.id,
          description: `${c.clientName ?? 'Student'} enrolled (${c.c.intake ?? c.c.number})`,
          basisAmount: rule.fixedAmount,
          basisCurrency: rule.currency,
          rateBp: null,
          amount: converted.amount,
          currency: converted.currency,
          fxRate: converted.fxRate,
          earnedOn: e.on,
          createdBy: actorId,
        });
        if (earning) await this.override(e.tenantId, partner, earning, converted.amount, actorId);
      }
      return;
    }

    if (e.type === 'receipt_voided') {
      const made = await this.db
        .select()
        .from(partnerEarnings)
        .where(and(eq(partnerEarnings.tenantId, e.tenantId), eq(partnerEarnings.sourceType, 'receipt_allocation'), eq(partnerEarnings.sourceId, e.allocationId), ne(partnerEarnings.status, 'reversed')));
      for (const earning of made) await this.undo(e.tenantId, earning, `The university payment it came from was voided`, actorId);
      return;
    }

    if (e.type === 'cancelled') {
      // Never earned: the student did not enrol after all.
      const made = await this.db
        .select()
        .from(partnerEarnings)
        .where(and(eq(partnerEarnings.tenantId, e.tenantId), eq(partnerEarnings.sourceType, 'commission'), eq(partnerEarnings.sourceId, c.c.id), ne(partnerEarnings.status, 'reversed')));
      for (const earning of made) await this.undo(e.tenantId, earning, `${c.c.number} was cancelled: the student did not enrol`, actorId);
      return;
    }

    if (e.type === 'clawed_back') {
      // The university took back some or all of what it paid: each partner gives back the same share of it.
      const allocations = await this.db.select({ id: receiptAllocations.id, amount: receiptAllocations.amount }).from(receiptAllocations).where(and(eq(receiptAllocations.commissionId, c.c.id), sql`${receiptAllocations.amount} > 0`));
      const shares = allocations.length
        ? await this.db
            .select()
            .from(partnerEarnings)
            .where(and(eq(partnerEarnings.sourceType, 'receipt_allocation'), inArray(partnerEarnings.sourceId, allocations.map((a) => a.id)), ne(partnerEarnings.status, 'reversed')))
        : [];
      const fixed = await this.db
        .select()
        .from(partnerEarnings)
        .where(and(eq(partnerEarnings.sourceType, 'commission'), eq(partnerEarnings.sourceId, c.c.id), ne(partnerEarnings.status, 'reversed')));
      const received = allocations.reduce((n, a) => n + a.amount, 0);
      const ratio = received > 0 ? Math.min(1, e.amount / received) : 1;
      const byPartner = new Map<string, { currency: string; amount: number; fxRate: string | null }>();
      for (const s of shares) {
        const cur = byPartner.get(`${s.partnerId}:${s.currency}`) ?? { currency: s.currency, amount: 0, fxRate: s.fxRate };
        cur.amount += Math.round(s.amount * ratio);
        byPartner.set(`${s.partnerId}:${s.currency}`, cur);
      }
      // A student who left inside the retention period was not, in the end, enrolled.
      for (const f of fixed) {
        const cur = byPartner.get(`${f.partnerId}:${f.currency}`) ?? { currency: f.currency, amount: 0, fxRate: f.fxRate };
        cur.amount += f.amount;
        byPartner.set(`${f.partnerId}:${f.currency}`, cur);
      }
      for (const [key, v] of byPartner) {
        if (v.amount <= 0) continue;
        const partner = await this.partnerFor(e.tenantId, key.split(':')[0]!);
        if (!partner) continue;
        await this.earn({
          tenantId: e.tenantId,
          partner,
          kind: 'clawback',
          clientId: c.c.clientId,
          sourceType: 'commission_clawback',
          sourceId: c.c.id,
          description: `${c.c.number} clawed back by the university (${formatMoney(e.amount, c.c.currency)})`,
          basisAmount: e.amount,
          basisCurrency: c.c.currency,
          rateBp: null,
          amount: -v.amount,
          currency: v.currency,
          fxRate: v.fxRate === null ? null : Number(v.fxRate),
          earnedOn: e.on,
          createdBy: actorId,
        });
      }
    }
  }

  async onPayment(e: PaymentEvent): Promise<void> {
    const [client] = await this.db.select({ partnerId: clients.partnerId }).from(clients).where(and(eq(clients.id, e.clientId), eq(clients.tenantId, e.tenantId))).limit(1);
    const actorId = e.actor?.id ?? null;
    if (e.voided) {
      const made = await this.db
        .select()
        .from(partnerEarnings)
        .where(and(eq(partnerEarnings.tenantId, e.tenantId), inArray(partnerEarnings.sourceType, ['payment', 'refund']), eq(partnerEarnings.sourceId, e.paymentId), ne(partnerEarnings.status, 'reversed')));
      for (const earning of made) await this.undo(e.tenantId, earning, `${e.kind === 'refund' ? 'The refund' : 'The payment'} it came from was voided`, actorId);
      return;
    }
    if (!client?.partnerId) return;
    const partner = await this.partnerFor(e.tenantId, client.partnerId);
    if (!partner) return;
    const [inv] = await this.db.select().from(invoices).where(eq(invoices.id, e.invoiceId)).limit(1);
    if (!inv || inv.total <= 0) return;
    const facts = await this.factsOf(inv.caseId);
    const rule = await this.match(e.tenantId, 'fee_share', partner, null, facts, e.receivedOn);
    if (!rule) return;
    // Only the consultancy's own fees, net of tax: never money passed through to a university or an embassy.
    const items = await this.db.select().from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
    const shareable = items
      .filter((it) => rule.feeCategories.includes(it.category))
      .reduce((n, it) => {
        const priced = it.amount - it.discount;
        return n + (it.taxInclusive ? priced - it.taxAmount : priced);
      }, 0);
    if (shareable <= 0) return;
    const basis = Math.round((e.amount * shareable) / inv.total);
    if (basis <= 0) return;
    const converted = await this.inPartnerCurrency(e.tenantId, partner, basis, e.currency, e.fxRate);
    const amount = Math.round((converted.amount * rule.rateBp) / 10_000);
    if (e.kind === 'refund') {
      // Fees given back: so is the share of them.
      await this.earn({
        tenantId: e.tenantId,
        partner,
        kind: 'clawback',
        clientId: e.clientId,
        sourceType: 'refund',
        sourceId: e.paymentId,
        ruleId: rule.id,
        description: `Refund on ${inv.number}: ${rule.rateBp / 100}% of ${formatMoney(basis, e.currency)} in fees`,
        basisAmount: basis,
        basisCurrency: e.currency,
        rateBp: rule.rateBp,
        amount: -amount,
        currency: converted.currency,
        fxRate: converted.fxRate,
        earnedOn: e.receivedOn,
        createdBy: actorId,
      });
      return;
    }
    const earning = await this.earn({
      tenantId: e.tenantId,
      partner,
      kind: 'fee_share',
      clientId: e.clientId,
      sourceType: 'payment',
      sourceId: e.paymentId,
      ruleId: rule.id,
      description: `${rule.rateBp / 100}% of ${formatMoney(basis, e.currency)} in fees paid on ${inv.number}`,
      basisAmount: basis,
      basisCurrency: e.currency,
      rateBp: rule.rateBp,
      amount,
      currency: converted.currency,
      fxRate: converted.fxRate,
      earnedOn: e.receivedOn,
      createdBy: actorId,
    });
    if (earning) await this.override(e.tenantId, partner, earning, converted.amount, actorId);
  }

  /** The master partner's override on what its sub-agent just earned, worked out on the same basis. */
  private async override(tenantId: string, child: PartnerRow, earning: EarningRow, basis: number, actorId: string | null): Promise<void> {
    if (!child.parentPartnerId || child.overrideBp <= 0) return;
    const parent = await this.partnerFor(tenantId, child.parentPartnerId);
    if (!parent) return;
    const amount = Math.round((basis * child.overrideBp) / 10_000);
    if (amount === 0) return;
    await this.earn({
      tenantId,
      partner: parent,
      kind: 'override',
      clientId: earning.clientId,
      fromPartnerId: child.id,
      sourceType: earning.sourceType,
      sourceId: earning.sourceId,
      relatedEarningId: earning.id,
      description: `${child.overrideBp / 100}% override on ${child.name}: ${EARNING_KIND_LABEL[earning.kind as EarningKind].toLowerCase()}`,
      basisAmount: basis,
      basisCurrency: earning.currency,
      rateBp: child.overrideBp,
      amount,
      currency: earning.currency,
      fxRate: earning.fxRate === null ? null : Number(earning.fxRate),
      earnedOn: earning.earnedOn,
      createdBy: actorId,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Making, undoing and adjusting                                     */
  /* ---------------------------------------------------------------- */

  /** Makes an earning and books it. Null when it was made already (an event heard twice). */
  private async earn(n: NewEarning): Promise<EarningRow | null> {
    if (n.amount === 0) return null;
    if (n.sourceId && n.kind !== 'adjustment') {
      const [dup] = await this.db
        .select({ id: partnerEarnings.id })
        .from(partnerEarnings)
        .where(and(eq(partnerEarnings.partnerId, n.partner.id), eq(partnerEarnings.kind, n.kind), eq(partnerEarnings.sourceType, n.sourceType ?? ''), eq(partnerEarnings.sourceId, n.sourceId)))
        .limit(1);
      if (dup) return null;
    }
    const bookOn = await this.openDay(n.tenantId, n.earnedOn);
    let duplicate = false;
    const row = await withDocumentNumber(this.db, partnerEarnings, n.tenantId, 'PE', async (number) => {
      try {
        return await this.db.transaction(async (tx) => {
          const [r] = await tx
            .insert(partnerEarnings)
            .values({
              tenantId: n.tenantId,
              number,
              partnerId: n.partner.id,
              kind: n.kind,
              clientId: n.clientId,
              fromPartnerId: n.fromPartnerId ?? null,
              sourceType: n.sourceType,
              sourceId: n.sourceId,
              relatedEarningId: n.relatedEarningId ?? null,
              ruleId: n.ruleId ?? null,
              description: n.description,
              basisAmount: n.basisAmount,
              basisCurrency: n.basisCurrency,
              rateBp: n.rateBp,
              amount: n.amount,
              currency: n.currency,
              fxRate: n.fxRate === null ? null : String(n.fxRate),
              status: 'payable',
              earnedOn: bookOn,
              createdBy: n.createdBy,
            })
            .returning();
          await this.book(tx, r!, n.partner.name);
          return r!;
        });
      } catch (err) {
        // The same source earned at the same moment elsewhere: the first one stands.
        if (isUniqueViolation(err) && String((err as { constraint?: string; message?: string }).constraint ?? (err as Error).message).includes('partner_earnings_source_key')) {
          duplicate = true;
          return null;
        }
        throw err;
      }
    });
    if (!row || duplicate) return null;
    await this.audit.record(null, {
      tenantId: n.tenantId,
      action: 'partner_earning.created',
      entityType: 'partner',
      entityId: n.partner.id,
      clientId: n.clientId,
      metadata: { number: row.number, kind: n.kind, amount: n.amount, currency: n.currency, source: n.sourceType },
    });
    if (n.amount > 0 && n.kind !== 'adjustment') {
      await this.partners.tellPartner(n.partner.id, { title: `You earned ${formatMoney(n.amount, n.currency)}`, body: n.description, link: '/partner/commissions' });
    }
    return row;
  }

  private async book(tx: Tx, e: EarningRow, partnerName: string): Promise<void> {
    const n = Math.abs(e.amount);
    await postEntry(tx, {
      tenantId: e.tenantId,
      date: e.earnedOn,
      memo: `${e.number}: ${partnerName} - ${e.description}`,
      currency: e.currency,
      fxRate: e.fxRate === null ? null : Number(e.fxRate),
      sourceType: 'partner_earning',
      sourceId: e.id,
      createdBy: e.createdBy,
      lines:
        e.amount > 0
          ? [
              { account: 'partner_commission', debit: n, clientId: e.clientId },
              { account: 'partner_payable', credit: n },
            ]
          : [
              { account: 'partner_payable', debit: n },
              { account: 'partner_commission', credit: n, clientId: e.clientId },
            ],
    });
  }

  /**
   * Takes an earning back: reversed outright while it is only owed, or - once
   * it is on a payout or paid - by a clawback the next payout nets off. The
   * overrides made on it go the same way.
   */
  private async undo(tenantId: string, e: EarningRow, reason: string, actorId: string | null): Promise<void> {
    const partner = await this.partnerFor(tenantId, e.partnerId);
    if (!partner) return;
    if (e.status === 'payable') {
      const done = await this.db.transaction(async (tx) => {
        const [r] = await tx
          .update(partnerEarnings)
          .set({ status: 'reversed', updatedAt: new Date() })
          .where(and(eq(partnerEarnings.id, e.id), eq(partnerEarnings.status, 'payable')))
          .returning({ id: partnerEarnings.id });
        if (!r) return false;
        const entry = await liveEntryFor(tx, tenantId, 'partner_earning', e.id);
        if (entry) await reverseEntry(tx, entry, { date: await this.openDay(tenantId, today(), tx), memo: `${e.number} reversed: ${reason}`, sourceType: 'reversal', createdBy: actorId });
        return true;
      });
      if (!done) return this.undo(tenantId, (await this.db.select().from(partnerEarnings).where(eq(partnerEarnings.id, e.id)))[0]!, reason, actorId);
      await this.audit.record(null, { tenantId, action: 'partner_earning.reversed', entityType: 'partner', entityId: e.partnerId, clientId: e.clientId, metadata: { number: e.number, amount: e.amount, reason } });
    } else if (e.status === 'on_payout' || e.status === 'paid') {
      await this.earn({
        tenantId,
        partner,
        kind: 'clawback',
        clientId: e.clientId,
        fromPartnerId: e.fromPartnerId,
        sourceType: 'earning',
        sourceId: e.id,
        relatedEarningId: e.id,
        description: `${e.number} taken back: ${reason}`,
        basisAmount: e.amount,
        basisCurrency: e.currency,
        rateBp: null,
        amount: -e.amount,
        currency: e.currency,
        fxRate: e.fxRate === null ? null : Number(e.fxRate),
        earnedOn: today(),
        createdBy: actorId,
      });
    }
    const overrides = await this.db.select().from(partnerEarnings).where(and(eq(partnerEarnings.relatedEarningId, e.id), eq(partnerEarnings.kind, 'override'), ne(partnerEarnings.status, 'reversed')));
    for (const o of overrides) await this.undo(tenantId, o, reason, actorId);
  }

  /** A correction by hand: more owed (positive) or taken back (negative). */
  async adjust(actor: AuthUser, partnerId: string, raw: EarningAdjustmentInput): Promise<PartnerEarningView> {
    if (!staffCan(actor, 'payout.manage')) throw new ForbiddenException('You need “Pay partners” to adjust what a partner is owed.');
    const input = earningAdjustmentSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const partner = await this.partners.find(tenantId, partnerId);
    if (input.clientId) {
      const [c] = await this.db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, input.clientId), eq(clients.tenantId, tenantId))).limit(1);
      if (!c) throw new BadRequestException('Student not found.');
    }
    const base = await this.partners.baseCurrency(tenantId);
    const row = await this.earn({
      tenantId,
      partner,
      kind: 'adjustment',
      clientId: input.clientId ?? null,
      sourceType: null,
      sourceId: null,
      description: input.reason,
      basisAmount: null,
      basisCurrency: null,
      rateBp: null,
      amount: Math.round(input.amount * 100),
      currency: input.currency,
      fxRate: input.currency === base ? 1 : null,
      earnedOn: today(),
      createdBy: actor.id,
    });
    await this.audit.record(actor, { action: 'partner_earning.created', entityType: 'partner', entityId: partnerId, metadata: { number: row!.number, adjustment: true, amount: row!.amount, currency: row!.currency, reason: input.reason } });
    return (await this.views([row!.id]))[0]!;
  }

  /* ---------------------------------------------------------------- */
  /* Reading                                                           */
  /* ---------------------------------------------------------------- */

  async list(actor: AuthUser, raw: Record<string, unknown>): Promise<Paginated<PartnerEarningView>> {
    const q = earningsQuerySchema.parse(raw);
    let partnerIds: string[] | null = null;
    if (actor.role === 'partner') {
      const ctx = await this.partners.context(actor);
      if (!ctx.canManage) throw new ForbiddenException('The owner or an administrator sees what the partnership earns.');
      partnerIds = [ctx.partner.id];
    } else {
      this.partners.assertView(actor);
      if (q.partnerId) partnerIds = [q.partnerId];
    }
    const conds: (SQL | undefined)[] = [eq(partnerEarnings.tenantId, tenantOf(actor))];
    if (partnerIds) conds.push(inArray(partnerEarnings.partnerId, partnerIds));
    if (q.status !== 'all') conds.push(eq(partnerEarnings.status, q.status));
    const where = and(...conds);
    const [[count], ids] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(partnerEarnings).where(where),
      this.db
        .select({ id: partnerEarnings.id })
        .from(partnerEarnings)
        .where(where)
        .orderBy(desc(partnerEarnings.earnedOn), desc(partnerEarnings.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
    ]);
    return page(await this.views(ids.map((i) => i.id)), count?.n ?? 0, q.page, q.pageSize);
  }

  async views(ids: string[]): Promise<PartnerEarningView[]> {
    if (!ids.length) return [];
    const from = alias(partners, 'from_partner');
    const rows = await this.db
      .select({ e: partnerEarnings, partnerName: partners.name, clientName: clients.fullName, fromName: from.name, payoutNumber: payouts.number, ruleName: partnerRules.name })
      .from(partnerEarnings)
      .innerJoin(partners, eq(partners.id, partnerEarnings.partnerId))
      .leftJoin(clients, eq(clients.id, partnerEarnings.clientId))
      .leftJoin(from, eq(from.id, partnerEarnings.fromPartnerId))
      .leftJoin(payouts, eq(payouts.id, partnerEarnings.payoutId))
      .leftJoin(partnerRules, eq(partnerRules.id, partnerEarnings.ruleId))
      .where(inArray(partnerEarnings.id, ids));
    const byId = new Map(rows.map((r) => [r.e.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => ({
        id: r.e.id,
        number: r.e.number,
        partnerId: r.e.partnerId,
        partnerName: r.partnerName,
        kind: r.e.kind as EarningKind,
        clientId: r.e.clientId,
        clientName: r.clientName,
        fromPartnerName: r.fromName,
        description: r.e.description,
        basisAmount: r.e.basisAmount,
        rateBp: r.e.rateBp,
        amount: r.e.amount,
        currency: r.e.currency as Currency,
        status: r.e.status as EarningStatus,
        earnedOn: r.e.earnedOn,
        payoutId: r.e.payoutId,
        payoutNumber: r.payoutNumber,
        ruleName: r.ruleName,
        createdAt: iso(r.e.createdAt),
      }));
  }

  /** What a partner is owed, on payouts and paid this year, per currency. */
  async totals(partnerId: string): Promise<{ currency: Currency; owed: number; onPayout: number; paidThisYear: number }[]> {
    const yearStart = `${today().slice(0, 4)}-01-01`;
    const rows = await this.db
      .select({
        currency: partnerEarnings.currency,
        owed: sql<string>`coalesce(sum(${partnerEarnings.amount}) filter (where ${partnerEarnings.status} = 'payable'), 0)`,
        onPayout: sql<string>`coalesce(sum(${partnerEarnings.amount}) filter (where ${partnerEarnings.status} = 'on_payout'), 0)`,
        paid: sql<string>`coalesce(sum(${partnerEarnings.amount}) filter (where ${partnerEarnings.status} = 'paid' and ${payouts.paidOn} >= ${yearStart}), 0)`,
      })
      .from(partnerEarnings)
      .leftJoin(payouts, eq(payouts.id, partnerEarnings.payoutId))
      .where(eq(partnerEarnings.partnerId, partnerId))
      .groupBy(partnerEarnings.currency);
    return rows
      .map((r) => ({ currency: r.currency as Currency, owed: Number(r.owed), onPayout: Number(r.onPayout), paidThisYear: Number(r.paid) }))
      .filter((r) => r.owed || r.onPayout || r.paidThisYear);
  }

  /** An estimate of the commission share still to come: commission confirmed or expected, not yet received, at today's rule. */
  async expected(tenantId: string, partner: PartnerRow): Promise<{ currency: Currency; amount: number }[]> {
    const rows = await this.db
      .select({
        c: commissions,
        received: sql<string>`coalesce((select sum(ra.amount) from receipt_allocations ra join institution_receipts ir on ir.id = ra.receipt_id where ra.commission_id = ${qualified('commissions', 'id')} and ir.voided_at is null), 0)`,
        k: cases,
      })
      .from(commissions)
      .innerJoin(clients, eq(clients.id, commissions.clientId))
      .leftJoin(cases, eq(cases.id, commissions.caseId))
      .where(and(eq(clients.partnerId, partner.id), eq(commissions.kind, 'student'), inArray(commissions.status, ['expected', 'confirmed', 'claimed', 'disputed'])));
    const out = new Map<string, number>();
    for (const r of rows) {
      const left = r.c.amount - Number(r.received);
      if (left <= 0) continue;
      const facts = r.k ? caseFacts(r.k) : {};
      const rule = await this.match(tenantId, 'commission_share', partner, r.c.institutionId, facts, today());
      if (!rule) continue;
      const share = Math.round((left * rule.rateBp) / 10_000);
      out.set(r.c.currency, (out.get(r.c.currency) ?? 0) + share);
    }
    return [...out].map(([currency, amount]) => ({ currency: currency as Currency, amount }));
  }

  /* ---------------------------------------------------------------- */
  /* Helpers                                                           */
  /* ---------------------------------------------------------------- */

  /** Applicants are not partners yet; everyone else earns what they earned. */
  private async partnerFor(tenantId: string, id: string): Promise<PartnerRow | null> {
    const [p] = await this.db.select().from(partners).where(and(eq(partners.id, id), eq(partners.tenantId, tenantId))).limit(1);
    return p && p.status !== 'applied' ? p : null;
  }

  private async factsOf(caseId: string | null): Promise<ConditionFacts> {
    if (!caseId) return {};
    const [k] = await this.db.select({ k: cases, leadSource: clients.leadSource }).from(cases).innerJoin(clients, eq(clients.id, cases.clientId)).where(eq(cases.id, caseId)).limit(1);
    return k ? caseFacts({ ...k.k, leadSource: k.leadSource }) : {};
  }

  /**
   * In the currency the partner is paid in, when that is the base currency and
   * the rate is known (a commission in pounds becomes rupees at the rate it
   * was received at); otherwise left in its own currency.
   */
  private async inPartnerCurrency(tenantId: string, partner: PartnerRow, amount: number, currency: string, fxRate: number | null): Promise<{ amount: number; currency: string; fxRate: number | null }> {
    const base = await this.partners.baseCurrency(tenantId);
    if (currency === partner.currency) return { amount, currency, fxRate: currency === base ? 1 : fxRate };
    if (partner.currency === base && fxRate) return { amount: Math.round(amount * fxRate), currency: base, fxRate: 1 };
    return { amount, currency, fxRate: currency === base ? 1 : fxRate };
  }

  /** A day the books are open on: the one asked for, or the first after the closed period. */
  private async openDay(tenantId: string, day: string, tx?: Tx): Promise<string> {
    const [s] = await (tx ?? this.db).select({ lockedThrough: financeSettings.lockedThrough }).from(financeSettings).where(eq(financeSettings.tenantId, tenantId)).limit(1);
    if (!s?.lockedThrough || day > s.lockedThrough) return day;
    if (today() > s.lockedThrough) return today();
    const next = new Date(`${s.lockedThrough}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString().slice(0, 10);
  }
}

export function ruleData(r: RuleRow) {
  return {
    name: r.name,
    basis: r.basis as PartnerRuleBasis,
    ratePercent: r.rateBp / 100,
    fixedAmount: r.fixedAmount / 100,
    currency: (r.currency as Currency | null) ?? null,
    partnerId: r.partnerId,
    tier: (r.tier as PartnerTier | null) ?? null,
    institutionId: r.institutionId,
    feeCategories: r.feeCategories as ('service' | 'course' | 'application' | 'visa')[],
    conditions: r.conditions as Condition[],
    validFrom: r.validFrom,
    validTo: r.validTo,
    active: r.active,
  };
}

/** A short label for a rule, for lists. */
export function describeRule(r: { basis: PartnerRuleBasis; ratePercent: number; fixedAmount: number; currency: string | null }): string {
  return r.basis === 'fixed_per_student' ? `${formatMoney(Math.round(r.fixedAmount * 100), r.currency ?? 'PKR')} per enrolled student` : `${r.ratePercent}% - ${PARTNER_RULE_BASIS_LABEL[r.basis].toLowerCase()}`;
}
