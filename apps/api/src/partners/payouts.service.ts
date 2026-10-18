import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  advanceSchema,
  createPayoutSchema,
  formatMoney,
  payPayoutSchema,
  payoutFigures,
  type AdvanceInput,
  type AdvanceView,
  type AuthUser,
  type CreatePayoutInput,
  type Currency,
  type PayPayoutInput,
  type PaymentMethod,
  type PayoutStatus,
  type PayoutView,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { advanceRecoveries, ledgerAccounts, partnerAdvances, partnerEarnings, partners, payouts, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PdfService } from '../finance/pdf.service';
import { assertMoneyAccount, assertPeriodOpen, liveEntryFor, postEntry, reverseEntry } from '../finance/journal';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { staffCan } from '../auth/permissions';
import { open } from '../auth/secret-box';
import { iso, isoOrNull, today, withDocumentNumber } from '../common/db-helpers';
import { permissionHolders } from '../common/permission-holders';
import { PartnersService } from './partners.service';
import { PartnerEarningsService } from './earnings.service';

type PayoutRow = typeof payouts.$inferSelect;

/**
 * Paying partners. A payout gathers what a partner is owed in one currency,
 * takes off the tax the consultancy must withhold and any advance it is
 * owed back, and goes to someone else with "Pay partners" to approve before
 * it is paid (unless the consultancy has switched that off). Paying it books
 * Dr partner payable (what was earned), Cr withholding payable, Cr partner
 * advances, Cr the bank (what was sent). Voiding puts the earnings back.
 */
@Injectable()
export class PayoutsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly pdf: PdfService,
    private readonly partners: PartnersService,
    private readonly earnings: PartnerEarningsService,
  ) {}

  private assertPay(actor: AuthUser): void {
    if (!staffCan(actor, 'payout.manage')) throw new ForbiddenException('You need “Pay partners” to do this.');
  }

  /* ---------------------------------------------------------------- */
  /* Reading                                                           */
  /* ---------------------------------------------------------------- */

  async list(actor: AuthUser, q: { partnerId?: string; status?: string }): Promise<PayoutView[]> {
    let partnerId = q.partnerId;
    if (actor.role === 'partner') {
      const ctx = await this.partners.context(actor);
      if (!ctx.canManage) throw new ForbiddenException('The owner or an administrator sees payouts.');
      partnerId = ctx.partner.id;
    } else this.partners.assertView(actor);
    const conds: (SQL | undefined)[] = [eq(payouts.tenantId, tenantOf(actor))];
    if (partnerId) conds.push(eq(payouts.partnerId, partnerId));
    if (q.status && q.status !== 'all') conds.push(eq(payouts.status, q.status));
    // Partners see payouts once they are approved; drafts are the consultancy's own.
    if (actor.role === 'partner') conds.push(inArray(payouts.status, ['approved', 'paid']));
    const rows = await this.db.select({ id: payouts.id }).from(payouts).where(and(...conds)).orderBy(desc(payouts.createdAt)).limit(200);
    return this.views(rows.map((r) => r.id), false);
  }

  async get(actor: AuthUser, id: string): Promise<PayoutView> {
    const p = await this.row(actor, id);
    if (actor.role === 'partner' && !['approved', 'paid'].includes(p.status)) throw new NotFoundException('Payout not found.');
    return (await this.views([id], true))[0]!;
  }

  private async row(actor: AuthUser, id: string): Promise<PayoutRow> {
    const [p] = await this.db.select().from(payouts).where(and(eq(payouts.id, id), eq(payouts.tenantId, tenantOf(actor)))).limit(1);
    if (!p) throw new NotFoundException('Payout not found.');
    if (actor.role === 'partner') {
      const ctx = await this.partners.context(actor);
      if (!ctx.canManage || ctx.partner.id !== p.partnerId) throw new NotFoundException('Payout not found.');
    } else this.partners.assertView(actor);
    return p;
  }

  private async views(ids: string[], withEarnings: boolean): Promise<PayoutView[]> {
    if (!ids.length) return [];
    const creator = alias(users, 'creator');
    const approver = alias(users, 'approver');
    const rows = await this.db
      .select({ p: payouts, partnerName: partners.name, createdByName: creator.fullName, approvedByName: approver.fullName, accountName: ledgerAccounts.name })
      .from(payouts)
      .innerJoin(partners, eq(partners.id, payouts.partnerId))
      .leftJoin(creator, eq(creator.id, payouts.createdBy))
      .leftJoin(approver, eq(approver.id, payouts.approvedBy))
      .leftJoin(ledgerAccounts, eq(ledgerAccounts.id, payouts.accountId))
      .where(inArray(payouts.id, ids));
    const lines = withEarnings
      ? await this.db.select({ id: partnerEarnings.id, payoutId: partnerEarnings.payoutId }).from(partnerEarnings).where(inArray(partnerEarnings.payoutId, ids)).orderBy(asc(partnerEarnings.earnedOn))
      : [];
    const earningViews = await this.earnings.views(lines.map((l) => l.id));
    const byId = new Map(rows.map((r) => [r.p.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => ({
        id: r.p.id,
        number: r.p.number,
        partnerId: r.p.partnerId,
        partnerName: r.partnerName,
        currency: r.p.currency as Currency,
        periodLabel: r.p.periodLabel,
        status: r.p.status as PayoutStatus,
        gross: r.p.gross,
        withholdingBp: r.p.withholdingBp,
        withholding: r.p.withholding,
        advanceRecovered: r.p.advanceRecovered,
        net: r.p.net,
        earnings: earningViews.filter((e) => e.payoutId === r.p.id),
        createdByName: r.createdByName,
        approvedByName: r.approvedByName,
        approvedAt: isoOrNull(r.p.approvedAt),
        paidOn: r.p.paidOn,
        accountName: r.accountName,
        method: (r.p.method as PaymentMethod | null) ?? null,
        reference: r.p.reference,
        notes: r.p.notes,
        voidReason: r.p.voidReason,
        createdAt: iso(r.p.createdAt),
      }));
  }

  /* ---------------------------------------------------------------- */
  /* Preparing, approving, paying                                      */
  /* ---------------------------------------------------------------- */

  async create(actor: AuthUser, raw: CreatePayoutInput): Promise<PayoutView> {
    this.assertPay(actor);
    const input = createPayoutSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const partner = await this.partners.view(tenantId, input.partnerId, false);
    if (partner.status === 'suspended') throw new BadRequestException('The partner is suspended. Payouts wait until it is active again.');
    if (partner.status === 'applied') throw new BadRequestException('Not a partner yet.');
    if (partner.kycStatus !== 'approved') throw new BadRequestException('Approve the partner’s registration papers before paying it.');
    const settings = await this.partners.settings(tenantId);
    const through = input.through ?? today();
    const owed = await this.db
      .select({ id: partnerEarnings.id, amount: partnerEarnings.amount })
      .from(partnerEarnings)
      .where(and(eq(partnerEarnings.partnerId, input.partnerId), eq(partnerEarnings.currency, input.currency), eq(partnerEarnings.status, 'payable'), lte(partnerEarnings.earnedOn, through), isNull(partnerEarnings.payoutId)));
    const gross = owed.reduce((n, e) => n + e.amount, 0);
    if (!owed.length) throw new BadRequestException(`Nothing is owed in ${input.currency} up to ${through}.`);
    if (gross <= 0) throw new BadRequestException(`What is owed nets to ${formatMoney(gross, input.currency)} after clawbacks - nothing to pay yet.`);
    if (gross < Math.round(settings.minimumPayout * 100) && partner.currency === input.currency) {
      throw new BadRequestException(`${formatMoney(gross, input.currency)} is below the minimum payout of ${formatMoney(Math.round(settings.minimumPayout * 100), input.currency)}.`);
    }
    const withholdingBp = Math.round(partner.effectiveWithholdingPercent * 100);
    const outstanding = await this.advanceOutstanding(input.partnerId, input.currency);
    const figures = payoutFigures(gross, withholdingBp, outstanding, input.advanceRecovery === null || input.advanceRecovery === undefined ? null : Math.round(input.advanceRecovery * 100));
    const created = await withDocumentNumber(this.db, payouts, tenantId, 'PO', (number) =>
      this.db.transaction(async (tx) => {
        const [p] = await tx
          .insert(payouts)
          .values({
            tenantId,
            number,
            partnerId: input.partnerId,
            currency: input.currency,
            periodLabel: input.periodLabel,
            status: 'draft',
            gross,
            withholdingBp,
            ...figures,
            notes: input.notes,
            createdBy: actor.id,
          })
          .returning();
        const taken = await tx
          .update(partnerEarnings)
          .set({ status: 'on_payout', payoutId: p!.id, updatedAt: new Date() })
          .where(and(inArray(partnerEarnings.id, owed.map((e) => e.id)), eq(partnerEarnings.status, 'payable'), isNull(partnerEarnings.payoutId)))
          .returning({ id: partnerEarnings.id });
        if (taken.length !== owed.length) throw new BadRequestException('Those earnings changed while the payout was being prepared. Try again.');
        return p!;
      }),
    );
    await this.audit.record(actor, {
      action: 'payout.created',
      entityType: 'partner',
      entityId: input.partnerId,
      metadata: { number: created.number, partner: partner.name, gross, net: figures.net, withholding: figures.withholding, advance: figures.advanceRecovered, currency: input.currency, earnings: owed.length },
    });
    if (settings.requireSecondApprover) {
      const others = (await permissionHolders(this.db, tenantId, 'payout.manage')).filter((id) => id !== actor.id);
      await this.notifications.pushMany(others, {
        type: 'approval_needed',
        title: `Payout ${created.number} to ${partner.name} needs approving`,
        body: `${formatMoney(figures.net, input.currency)} to pay (${formatMoney(gross, input.currency)} earned).`,
        link: `/overview/partners/payouts/${created.id}`,
      });
    }
    return (await this.views([created.id], true))[0]!;
  }

  async approve(actor: AuthUser, id: string): Promise<PayoutView> {
    this.assertPay(actor);
    const p = await this.row(actor, id);
    if (p.status !== 'draft') throw new BadRequestException('Only a payout waiting for approval can be approved.');
    const settings = await this.partners.settings(p.tenantId);
    if (settings.requireSecondApprover && p.createdBy === actor.id) throw new ForbiddenException('Someone other than whoever prepared it approves a payout.');
    await this.db.update(payouts).set({ status: 'approved', approvedBy: actor.id, approvedAt: new Date(), updatedAt: new Date() }).where(and(eq(payouts.id, id), eq(payouts.status, 'draft')));
    await this.audit.record(actor, { action: 'payout.approved', entityType: 'partner', entityId: p.partnerId, metadata: { number: p.number, net: p.net, currency: p.currency } });
    return (await this.views([id], true))[0]!;
  }

  async pay(actor: AuthUser, id: string, raw: PayPayoutInput): Promise<PayoutView> {
    this.assertPay(actor);
    const input = payPayoutSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const p = await this.row(actor, id);
    if (p.status !== 'approved') throw new BadRequestException(p.status === 'draft' ? 'Approve it first.' : 'It is not waiting to be paid.');
    if (input.paidOn > today()) throw new BadRequestException({ message: 'That date is in the future.', fieldErrors: { paidOn: 'Record it once the money has gone' } });
    await assertMoneyAccount(this.db, tenantId, input.accountId);
    const partner = await this.partners.find(tenantId, p.partnerId);
    if (input.method === 'bank_transfer' && !partner.bankSealed) throw new BadRequestException('The partner has no bank account on record. Add it before paying by transfer.');
    const base = await this.partners.baseCurrency(tenantId);
    const fxRate = p.currency === base ? 1 : (input.fxRate ?? null);
    // The advances it takes back, oldest first.
    const advances = p.advanceRecovered
      ? await this.db
          .select()
          .from(partnerAdvances)
          .where(and(eq(partnerAdvances.partnerId, p.partnerId), eq(partnerAdvances.currency, p.currency), isNull(partnerAdvances.voidedAt), sql`${partnerAdvances.recovered} < ${partnerAdvances.amount}`))
          .orderBy(asc(partnerAdvances.givenOn), asc(partnerAdvances.createdAt))
      : [];
    if (advances.reduce((n, a) => n + a.amount - a.recovered, 0) < p.advanceRecovered) {
      throw new BadRequestException('The advance it takes back has changed since it was prepared. Void it and prepare it again.');
    }
    await this.db.transaction(async (tx) => {
      await assertPeriodOpen(tx, tenantId, input.paidOn);
      const [done] = await tx
        .update(payouts)
        .set({ status: 'paid', paidOn: input.paidOn, accountId: input.accountId, method: input.method, reference: input.reference, fxRate: fxRate === null ? null : String(fxRate), paidBy: actor.id, updatedAt: new Date() })
        .where(and(eq(payouts.id, id), eq(payouts.status, 'approved')))
        .returning({ id: payouts.id });
      if (!done) throw new BadRequestException('It has just been paid or voided. Reload the page.');
      await tx.update(partnerEarnings).set({ status: 'paid', updatedAt: new Date() }).where(eq(partnerEarnings.payoutId, id));
      let left = p.advanceRecovered;
      for (const a of advances) {
        if (left <= 0) break;
        const take = Math.min(left, a.amount - a.recovered);
        await tx.insert(advanceRecoveries).values({ tenantId, advanceId: a.id, payoutId: id, amount: take });
        await tx.update(partnerAdvances).set({ recovered: a.recovered + take }).where(eq(partnerAdvances.id, a.id));
        left -= take;
      }
      await postEntry(tx, {
        tenantId,
        date: input.paidOn,
        memo: `${p.number}: payout to ${partner.name} (${p.periodLabel})${input.reference ? `, ref ${input.reference}` : ''}`,
        currency: p.currency,
        fxRate,
        sourceType: 'payout',
        sourceId: id,
        createdBy: actor.id,
        lines: [
          { account: 'partner_payable', debit: p.gross },
          { account: 'withholding_payable', credit: p.withholding },
          { account: 'partner_advances', credit: p.advanceRecovered },
          { account: { id: input.accountId }, credit: p.net },
        ],
      });
    });
    await this.audit.record(actor, { action: 'payout.paid', entityType: 'partner', entityId: p.partnerId, metadata: { number: p.number, net: p.net, currency: p.currency, paidOn: input.paidOn, reference: input.reference } });
    const view = (await this.views([id], true))[0]!;
    const statement = await this.statementFor(tenantId, view).catch(() => null);
    await this.partners.tellPartner(p.partnerId, {
      title: `Payout ${p.number} of ${formatMoney(p.net, p.currency)} has been paid`,
      body: `${p.periodLabel}. The statement is attached.`,
      link: '/partner/payouts',
      email: true,
      ...(statement ? { attachments: [{ filename: `${p.number}.pdf`, content: statement, contentType: 'application/pdf' }] } : {}),
    });
    return view;
  }

  /** Before it is paid: the earnings go back to owed. After: the payment is reversed too, and the advance is owed again. */
  async void(actor: AuthUser, id: string, reason: string): Promise<PayoutView> {
    this.assertPay(actor);
    const tenantId = tenantOf(actor);
    const p = await this.row(actor, id);
    if (p.status === 'void') return (await this.views([id], true))[0]!;
    await this.db.transaction(async (tx) => {
      await tx.update(payouts).set({ status: 'void', voidedAt: new Date(), voidedBy: actor.id, voidReason: reason, updatedAt: new Date() }).where(eq(payouts.id, id));
      await tx.update(partnerEarnings).set({ status: 'payable', payoutId: null, updatedAt: new Date() }).where(eq(partnerEarnings.payoutId, id));
      if (p.status === 'paid') {
        const back = await tx.select().from(advanceRecoveries).where(eq(advanceRecoveries.payoutId, id));
        for (const r of back) await tx.update(partnerAdvances).set({ recovered: sql`${partnerAdvances.recovered} - ${r.amount}` }).where(eq(partnerAdvances.id, r.advanceId));
        await tx.delete(advanceRecoveries).where(eq(advanceRecoveries.payoutId, id));
        const entry = await liveEntryFor(tx, tenantId, 'payout', id);
        if (entry) await reverseEntry(tx, entry, { date: today(), memo: `${p.number} voided: ${reason}`, sourceType: 'reversal', createdBy: actor.id });
      }
    });
    await this.audit.record(actor, { action: 'payout.voided', entityType: 'partner', entityId: p.partnerId, metadata: { number: p.number, was: p.status, reason } });
    if (p.status === 'paid' || p.status === 'approved') await this.partners.tellPartner(p.partnerId, { title: `Payout ${p.number} was cancelled`, body: reason, link: '/partner/payouts' });
    return (await this.views([id], true))[0]!;
  }

  async statement(actor: AuthUser, id: string): Promise<{ pdf: Buffer; name: string }> {
    const view = await this.get(actor, id);
    return { pdf: await this.statementFor(tenantOf(actor), view), name: `${view.number}.pdf` };
  }

  private async statementFor(tenantId: string, view: PayoutView): Promise<Buffer> {
    const partner = await this.partners.find(tenantId, view.partnerId);
    let bankLine: string | null = null;
    if (partner.bankSealed) {
      try {
        const b = JSON.parse(open(partner.bankSealed)) as { bankName: string; iban: string };
        bankLine = `${b.bankName}, account ending ${b.iban.slice(-4)}`;
      } catch {
        bankLine = null;
      }
    }
    return this.pdf.payoutStatement(tenantId, view, { name: partner.name, number: partner.number, taxId: partner.taxId, bankLine });
  }

  /* ---------------------------------------------------------------- */
  /* Advances                                                          */
  /* ---------------------------------------------------------------- */

  async advanceOutstanding(partnerId: string, currency: string): Promise<number> {
    const [r] = await this.db
      .select({ n: sql<string>`coalesce(sum(${partnerAdvances.amount} - ${partnerAdvances.recovered}), 0)` })
      .from(partnerAdvances)
      .where(and(eq(partnerAdvances.partnerId, partnerId), eq(partnerAdvances.currency, currency), isNull(partnerAdvances.voidedAt)));
    return Number(r?.n ?? 0);
  }

  async advances(actor: AuthUser, partnerId?: string): Promise<AdvanceView[]> {
    if (actor.role === 'partner') {
      const ctx = await this.partners.context(actor);
      if (!ctx.canManage) throw new ForbiddenException('The owner or an administrator sees advances.');
      partnerId = ctx.partner.id;
    } else this.partners.assertView(actor);
    const creator = alias(users, 'creator');
    const rows = await this.db
      .select({ a: partnerAdvances, partnerName: partners.name, accountName: ledgerAccounts.name, createdByName: creator.fullName })
      .from(partnerAdvances)
      .innerJoin(partners, eq(partners.id, partnerAdvances.partnerId))
      .leftJoin(ledgerAccounts, eq(ledgerAccounts.id, partnerAdvances.accountId))
      .leftJoin(creator, eq(creator.id, partnerAdvances.createdBy))
      .where(and(eq(partnerAdvances.tenantId, tenantOf(actor)), partnerId ? eq(partnerAdvances.partnerId, partnerId) : undefined))
      .orderBy(desc(partnerAdvances.givenOn))
      .limit(200);
    return rows.map((r) => ({
      id: r.a.id,
      number: r.a.number,
      partnerId: r.a.partnerId,
      partnerName: r.partnerName,
      amount: r.a.amount,
      recovered: r.a.recovered,
      outstanding: r.a.voidedAt ? 0 : r.a.amount - r.a.recovered,
      currency: r.a.currency as Currency,
      givenOn: r.a.givenOn,
      accountName: r.accountName,
      reason: r.a.reason,
      createdByName: r.createdByName,
      voided: Boolean(r.a.voidedAt),
    }));
  }

  /** Money paid ahead of earnings: Dr partner advances, Cr the bank. */
  async giveAdvance(actor: AuthUser, raw: AdvanceInput): Promise<AdvanceView[]> {
    this.assertPay(actor);
    const input = advanceSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const partner = await this.partners.view(tenantId, input.partnerId, false);
    if (partner.status !== 'active') throw new BadRequestException('Advances are for active partners.');
    if (input.givenOn > today()) throw new BadRequestException({ message: 'That date is in the future.', fieldErrors: { givenOn: 'When was it paid?' } });
    await assertMoneyAccount(this.db, tenantId, input.accountId);
    const base = await this.partners.baseCurrency(tenantId);
    const amount = Math.round(input.amount * 100);
    const row = await withDocumentNumber(this.db, partnerAdvances, tenantId, 'ADV', (number) =>
      this.db.transaction(async (tx) => {
        const [a] = await tx
          .insert(partnerAdvances)
          .values({ tenantId, number, partnerId: input.partnerId, amount, currency: input.currency, givenOn: input.givenOn, accountId: input.accountId, fxRate: input.currency === base ? '1' : null, reason: input.reason, createdBy: actor.id })
          .returning();
        await postEntry(tx, {
          tenantId,
          date: input.givenOn,
          memo: `${number}: advance to ${partner.name} - ${input.reason}`,
          currency: input.currency,
          fxRate: input.currency === base ? 1 : null,
          sourceType: 'partner_advance',
          sourceId: a!.id,
          createdBy: actor.id,
          lines: [
            { account: 'partner_advances', debit: amount },
            { account: { id: input.accountId }, credit: amount },
          ],
        });
        return a!;
      }),
    );
    await this.audit.record(actor, { action: 'advance.recorded', entityType: 'partner', entityId: input.partnerId, metadata: { number: row.number, amount, currency: input.currency, reason: input.reason } });
    await this.partners.tellPartner(input.partnerId, { title: `An advance of ${formatMoney(amount, input.currency)} was paid to you`, body: 'It will be taken back from your next payouts.', link: '/partner/payouts' });
    return this.advances(actor, input.partnerId);
  }

  async voidAdvance(actor: AuthUser, id: string, reason: string): Promise<AdvanceView[]> {
    this.assertPay(actor);
    const tenantId = tenantOf(actor);
    const [a] = await this.db.select().from(partnerAdvances).where(and(eq(partnerAdvances.id, id), eq(partnerAdvances.tenantId, tenantId))).limit(1);
    if (!a) throw new NotFoundException('Advance not found.');
    if (a.voidedAt) return this.advances(actor, a.partnerId);
    if (a.recovered > 0) throw new BadRequestException('Part of it has been taken back through a payout. Void that payout first.');
    const [pending] = await this.db
      .select({ id: payouts.id })
      .from(payouts)
      .where(and(eq(payouts.partnerId, a.partnerId), eq(payouts.currency, a.currency), inArray(payouts.status, ['draft', 'approved']), sql`${payouts.advanceRecovered} > 0`))
      .limit(1);
    if (pending) throw new BadRequestException('A payout waiting to be paid takes back an advance. Void it first.');
    await this.db.transaction(async (tx) => {
      await tx.update(partnerAdvances).set({ voidedAt: new Date(), voidReason: reason }).where(eq(partnerAdvances.id, id));
      const entry = await liveEntryFor(tx, tenantId, 'partner_advance', id);
      if (entry) await reverseEntry(tx, entry, { date: today(), memo: `${a.number} voided: ${reason}`, sourceType: 'reversal', createdBy: actor.id });
    });
    await this.audit.record(actor, { action: 'advance.voided', entityType: 'partner', entityId: a.partnerId, metadata: { number: a.number, reason } });
    return this.advances(actor, a.partnerId);
  }

  /** For the payouts screen: who is owed what, ready to pay. */
  async owed(actor: AuthUser): Promise<{ partnerId: string; partnerName: string; currency: Currency; amount: number; earnings: number }[]> {
    this.partners.assertView(actor);
    const rows = await this.db
      .select({ partnerId: partners.id, partnerName: partners.name, currency: partnerEarnings.currency, amount: sql<string>`sum(${partnerEarnings.amount})`, n: sql<number>`count(*)::int` })
      .from(partnerEarnings)
      .innerJoin(partners, eq(partners.id, partnerEarnings.partnerId))
      .where(and(eq(partnerEarnings.tenantId, tenantOf(actor)), eq(partnerEarnings.status, 'payable'), ne(partners.status, 'applied')))
      .groupBy(partners.id, partners.name, partnerEarnings.currency)
      .orderBy(asc(partners.name));
    return rows.filter((r) => Number(r.amount) !== 0).map((r) => ({ partnerId: r.partnerId, partnerName: r.partnerName, currency: r.currency as Currency, amount: Number(r.amount), earnings: r.n }));
  }
}
