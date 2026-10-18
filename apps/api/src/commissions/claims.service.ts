import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  claimSchema,
  formatMoney,
  institutionReceiptSchema,
  submitClaimSchema,
  type AuthUser,
  type ClaimInput,
  type ClaimStatus,
  type ClaimView,
  type Currency,
  type InstitutionReceiptInput,
  type InstitutionReceiptView,
} from '@crm/shared';
import { z } from 'zod';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import {
  clients,
  commissionAgreements,
  commissionClaims,
  commissionSplits,
  commissions,
  institutionReceipts,
  institutions,
  ledgerAccounts,
  receiptAllocations,
  users,
} from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { staffCan } from '../auth/permissions';
import { addDays, iso, today, withDocumentNumber } from '../common/db-helpers';
import { assertMoneyAccount, liveEntryFor, postEntry, reverseEntry } from '../finance/journal';
import { LedgerService } from '../finance/ledger.service';
import { PdfService } from '../finance/pdf.service';
import { CommissionsService } from './commissions.service';

/**
 * Claims sent to institutions, and the money they send back. A receipt is
 * matched commission by commission; bank charges are booked as such, and
 * the exchange difference against the rate each commission was booked at is
 * kept on every match.
 */
@Injectable()
export class ClaimsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly commissions: CommissionsService,
    private readonly ledger: LedgerService,
    private readonly pdf: PdfService,
  ) {}

  private assertView(actor: AuthUser): void {
    if (!staffCan(actor, 'commission.view')) throw new ForbiddenException('You do not have permission to see commissions.');
  }

  private assertManage(actor: AuthUser): void {
    if (!staffCan(actor, 'commission.manage')) throw new ForbiddenException('You do not have permission to manage commissions.');
  }

  /* ---------------------------------------------------------------- */
  /* Claims                                                            */
  /* ---------------------------------------------------------------- */

  async list(actor: AuthUser, q: { status?: string; institutionId?: string }): Promise<ClaimView[]> {
    this.assertView(actor);
    const conds: (SQL | undefined)[] = [eq(commissionClaims.tenantId, tenantOf(actor))];
    if (q.institutionId) conds.push(eq(commissionClaims.institutionId, q.institutionId));
    if (q.status && q.status !== 'all' && q.status !== 'overdue') conds.push(eq(commissionClaims.status, q.status));
    if (q.status === 'overdue') conds.push(inArray(commissionClaims.status, ['submitted', 'disputed']), sql`${commissionClaims.dueOn} < ${today()}`);
    const rows = await this.db.select({ id: commissionClaims.id }).from(commissionClaims).where(and(...conds)).orderBy(desc(commissionClaims.createdAt)).limit(200);
    const views = await this.views(rows.map((r) => r.id), false);
    return q.status === 'overdue' ? views.filter((v) => v.outstanding > 0) : views;
  }

  async get(actor: AuthUser, id: string): Promise<ClaimView> {
    this.assertView(actor);
    const [row] = await this.db.select({ id: commissionClaims.id }).from(commissionClaims).where(and(eq(commissionClaims.id, id), eq(commissionClaims.tenantId, tenantOf(actor)))).limit(1);
    if (!row) throw new NotFoundException('Claim not found.');
    return (await this.views([id], true))[0]!;
  }

  /** Claims past their due date and not paid in full - for the dashboard. */
  async overdue(tenantId: string): Promise<ClaimView[]> {
    const rows = await this.db
      .select({ id: commissionClaims.id })
      .from(commissionClaims)
      .where(and(eq(commissionClaims.tenantId, tenantId), inArray(commissionClaims.status, ['submitted', 'disputed']), sql`${commissionClaims.dueOn} < ${today()}`))
      .limit(50);
    return (await this.views(rows.map((r) => r.id), false)).filter((c) => c.outstanding > 0);
  }

  private async views(ids: string[], withCommissions: boolean): Promise<ClaimView[]> {
    if (!ids.length) return [];
    const creator = alias(users, 'claim_creator');
    const rows = await this.db
      .select({ c: commissionClaims, institutionName: institutions.name, createdByName: creator.fullName })
      .from(commissionClaims)
      .innerJoin(institutions, eq(institutions.id, commissionClaims.institutionId))
      .leftJoin(creator, eq(creator.id, commissionClaims.createdBy))
      .where(inArray(commissionClaims.id, ids));
    const members = await this.db.select({ id: commissions.id, claimId: commissions.claimId }).from(commissions).where(inArray(commissions.claimId, ids));
    const memberViews = await this.commissions.views(members.map((m) => m.id));
    const byId = new Map(rows.map((r) => [r.c.id, r]));
    const day = today();
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => {
        const list = memberViews.filter((m) => m.claimId === r.c.id);
        const live = list.filter((m) => m.status !== 'cancelled');
        const total = live.reduce((n, m) => n + m.amount, 0);
        const received = live.reduce((n, m) => n + m.received, 0);
        const outstanding = live.reduce((n, m) => n + m.outstanding, 0);
        let status: ClaimStatus | 'part_paid' = r.c.status as ClaimStatus;
        if (status === 'submitted' || status === 'disputed') {
          if (total > 0 && outstanding === 0) status = 'paid';
          else if (received > 0 && status === 'submitted') status = 'part_paid';
        }
        return {
          id: r.c.id,
          number: r.c.number,
          institutionId: r.c.institutionId,
          institutionName: r.institutionName,
          currency: r.c.currency as Currency,
          periodLabel: r.c.periodLabel,
          status,
          submittedOn: r.c.submittedOn,
          dueOn: r.c.dueOn,
          overdue: (status === 'submitted' || status === 'part_paid' || status === 'disputed') && Boolean(r.c.dueOn && r.c.dueOn < day) && outstanding > 0,
          total,
          received,
          outstanding,
          notes: r.c.notes,
          commissions: withCommissions ? list : [],
          createdByName: r.createdByName,
          createdAt: iso(r.c.createdAt),
        };
      });
  }

  async create(actor: AuthUser, raw: ClaimInput): Promise<ClaimView> {
    this.assertManage(actor);
    const input = claimSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const items = await this.commissions.views(input.commissionIds);
    if (items.length !== input.commissionIds.length) throw new BadRequestException('Some of those commissions are not yours.');
    const [own] = await this.db.select({ n: sql<number>`count(*)::int` }).from(commissions).where(and(inArray(commissions.id, input.commissionIds), eq(commissions.tenantId, tenantId)));
    if ((own?.n ?? 0) !== input.commissionIds.length) throw new NotFoundException('Commission not found.');
    for (const c of items) {
      if (c.institutionId !== input.institutionId) throw new BadRequestException(`${c.number} is with ${c.institutionName}.`);
      if (c.status !== 'confirmed') throw new BadRequestException(`${c.number} is ${c.stage.replace('_', ' ')} - only confirmed commissions are claimed.`);
      if (c.claimId) throw new BadRequestException(`${c.number} is already on claim ${c.claimNumber}.`);
    }
    const currencies = [...new Set(items.map((c) => c.currency))];
    if (currencies.length !== 1) throw new BadRequestException('A claim is in one currency. Make one claim per currency.');
    const claim = await withDocumentNumber(this.db, commissionClaims, tenantId, 'CLM', (number) =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(commissionClaims)
          .values({ tenantId, number, institutionId: input.institutionId, currency: currencies[0]!, periodLabel: input.periodLabel, notes: input.notes, createdBy: actor.id })
          .returning();
        await tx.update(commissions).set({ claimId: row!.id, updatedAt: new Date() }).where(and(inArray(commissions.id, input.commissionIds), isNull(commissions.claimId)));
        return row!;
      }),
    );
    await this.audit.record(actor, { action: 'claim.created', entityType: 'claim', entityId: claim.id, metadata: { number: claim.number, commissions: input.commissionIds.length, total: items.reduce((n, c) => n + c.amount, 0), currency: currencies[0] } });
    return this.get(actor, claim.id);
  }

  async submit(actor: AuthUser, id: string, raw: z.input<typeof submitClaimSchema>): Promise<ClaimView> {
    this.assertManage(actor);
    const input = submitClaimSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const claim = await this.get(actor, id);
    if (claim.status !== 'draft') throw new BadRequestException('It has been sent already.');
    let terms = 45;
    const agreementId = claim.commissions.find((c) => c.agreementId)?.agreementId;
    if (agreementId) {
      const [a] = await this.db.select({ t: commissionAgreements.paymentTermsDays }).from(commissionAgreements).where(eq(commissionAgreements.id, agreementId));
      terms = a?.t ?? terms;
    }
    const dueOn = input.dueOn ?? addDays(input.submittedOn, terms);
    await this.db.transaction(async (tx) => {
      await tx.update(commissionClaims).set({ status: 'submitted', submittedOn: input.submittedOn, dueOn, updatedAt: new Date() }).where(and(eq(commissionClaims.id, id), eq(commissionClaims.tenantId, tenantId)));
      await tx.update(commissions).set({ status: 'claimed', expectedOn: dueOn, updatedAt: new Date() }).where(and(eq(commissions.claimId, id), eq(commissions.status, 'confirmed')));
    });
    await this.audit.record(actor, { action: 'claim.updated', entityType: 'claim', entityId: id, metadata: { number: claim.number, to: 'submitted', submittedOn: input.submittedOn, dueOn } });
    return this.get(actor, id);
  }

  async setDisputed(actor: AuthUser, id: string, disputed: boolean, reason: string): Promise<ClaimView> {
    this.assertManage(actor);
    const claim = await this.get(actor, id);
    if (disputed && claim.status !== 'submitted' && claim.status !== 'part_paid') throw new BadRequestException('Only a sent claim can be disputed.');
    if (!disputed && claim.status !== 'disputed') throw new BadRequestException('It is not disputed.');
    await this.db.update(commissionClaims).set({ status: disputed ? 'disputed' : 'submitted', notes: [claim.notes, `${today()}: ${reason}`].filter(Boolean).join('\n'), updatedAt: new Date() }).where(eq(commissionClaims.id, id));
    await this.audit.record(actor, { action: 'claim.updated', entityType: 'claim', entityId: id, metadata: { number: claim.number, to: disputed ? 'disputed' : 'submitted', reason } });
    return this.get(actor, id);
  }

  /** Withdraws a claim nothing has been paid on; its commissions can be claimed again. */
  async cancel(actor: AuthUser, id: string, reason: string): Promise<ClaimView> {
    this.assertManage(actor);
    const claim = await this.get(actor, id);
    if (claim.received > 0) throw new BadRequestException('Money has been received against it, so it stands.');
    if (claim.status === 'cancelled') return claim;
    await this.db.transaction(async (tx) => {
      await tx.update(commissions).set({ claimId: null, status: sql`case when ${commissions.status} = 'claimed' then 'confirmed' else ${commissions.status} end`, updatedAt: new Date() }).where(eq(commissions.claimId, id));
      await tx.update(commissionClaims).set({ status: 'cancelled', notes: [claim.notes, `Cancelled: ${reason}`].filter(Boolean).join('\n'), updatedAt: new Date() }).where(eq(commissionClaims.id, id));
    });
    await this.audit.record(actor, { action: 'claim.updated', entityType: 'claim', entityId: id, metadata: { number: claim.number, to: 'cancelled', reason } });
    return this.get(actor, id);
  }

  async pdfFor(actor: AuthUser, id: string): Promise<{ file: Buffer; name: string }> {
    const claim = await this.get(actor, id);
    return { file: await this.pdf.claim(tenantOf(actor), claim), name: `${claim.number}.pdf` };
  }

  /* ---------------------------------------------------------------- */
  /* Receipts                                                          */
  /* ---------------------------------------------------------------- */

  async receipts(actor: AuthUser, q: { institutionId?: string }): Promise<InstitutionReceiptView[]> {
    this.assertView(actor);
    const rows = await this.db
      .select({ id: institutionReceipts.id })
      .from(institutionReceipts)
      .where(and(eq(institutionReceipts.tenantId, tenantOf(actor)), q.institutionId ? eq(institutionReceipts.institutionId, q.institutionId) : undefined))
      .orderBy(desc(institutionReceipts.receivedOn), desc(institutionReceipts.createdAt))
      .limit(200);
    return this.receiptViews(rows.map((r) => r.id));
  }

  private async receiptViews(ids: string[]): Promise<InstitutionReceiptView[]> {
    if (!ids.length) return [];
    const creator = alias(users, 'receipt_creator');
    const rows = await this.db
      .select({ r: institutionReceipts, institutionName: institutions.name, accountName: ledgerAccounts.name, claimNumber: commissionClaims.number, createdByName: creator.fullName })
      .from(institutionReceipts)
      .innerJoin(institutions, eq(institutions.id, institutionReceipts.institutionId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, institutionReceipts.accountId))
      .leftJoin(commissionClaims, eq(commissionClaims.id, institutionReceipts.claimId))
      .leftJoin(creator, eq(creator.id, institutionReceipts.createdBy))
      .where(inArray(institutionReceipts.id, ids));
    const allocs = await this.db
      .select({ a: receiptAllocations, number: commissions.number, clientName: clients.fullName })
      .from(receiptAllocations)
      .innerJoin(commissions, eq(commissions.id, receiptAllocations.commissionId))
      .leftJoin(clients, eq(clients.id, commissions.clientId))
      .where(inArray(receiptAllocations.receiptId, ids));
    const byId = new Map(rows.map((r) => [r.r.id, r]));
    return ids
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => Boolean(r))
      .map((r) => {
        const mine = allocs.filter((a) => a.a.receiptId === r.r.id);
        const allocated = mine.reduce((n, a) => n + a.a.amount, 0);
        return {
          id: r.r.id,
          number: r.r.number,
          institutionId: r.r.institutionId,
          institutionName: r.institutionName,
          receivedOn: r.r.receivedOn,
          currency: r.r.currency as Currency,
          amount: r.r.amount,
          bankCharges: r.r.bankCharges,
          net: r.r.amount - r.r.bankCharges,
          allocated,
          unallocated: r.r.amount - allocated,
          fxRate: r.r.fxRate === null ? null : Number(r.r.fxRate),
          accountName: r.accountName,
          reference: r.r.reference,
          claimNumber: r.claimNumber,
          notes: r.r.notes,
          allocations: mine.map((a) => ({ commissionId: a.a.commissionId, commissionNumber: a.number, clientName: a.clientName, amount: a.a.amount, fxDifference: a.a.fxDifference })),
          voided: Boolean(r.r.voidedAt),
          voidReason: r.r.voidReason,
          createdByName: r.createdByName,
          createdAt: iso(r.r.createdAt),
        };
      });
  }

  /**
   * Money from an institution. Into the chosen account it goes net of bank
   * charges (booked as charges); the gross comes off what the institution
   * owes. Each commission matched is checked: same institution and currency,
   * no more than is outstanding - or, against a clawed-back one, a deduction
   * of no more than was taken back.
   */
  async record(actor: AuthUser, raw: InstitutionReceiptInput): Promise<InstitutionReceiptView> {
    this.assertManage(actor);
    const input = institutionReceiptSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const [inst] = await this.db.select().from(institutions).where(and(eq(institutions.id, input.institutionId), eq(institutions.tenantId, tenantId))).limit(1);
    if (!inst) throw new NotFoundException('Institution not found.');
    await assertMoneyAccount(this.db, tenantId, input.accountId);
    if (input.receivedOn > today()) throw new BadRequestException({ message: 'That date is in the future.', fieldErrors: { receivedOn: 'When did it arrive?' } });
    if (input.claimId) {
      const [cl] = await this.db.select({ id: commissionClaims.id }).from(commissionClaims).where(and(eq(commissionClaims.id, input.claimId), eq(commissionClaims.tenantId, tenantId), eq(commissionClaims.institutionId, input.institutionId))).limit(1);
      if (!cl) throw new BadRequestException('That claim is not this institution’s.');
    }
    const amount = Math.round(input.amount * 100);
    const charges = Math.round(input.bankCharges * 100);
    const allocations = input.allocations.map((a) => ({ commissionId: a.commissionId, amount: Math.round(a.amount * 100) }));
    const targets = allocations.length ? await this.commissions.views(allocations.map((a) => a.commissionId)) : [];
    const rates = new Map<string, string | null>();
    if (allocations.length) {
      const rows = await this.db.select({ id: commissions.id, tenantId: commissions.tenantId, fxRate: commissions.fxRate, adjusted: commissions.adjustedAmount }).from(commissions).where(inArray(commissions.id, allocations.map((a) => a.commissionId)));
      if (rows.some((r) => r.tenantId !== tenantId) || rows.length !== new Set(allocations.map((a) => a.commissionId)).size) throw new NotFoundException('Commission not found.');
      for (const r of rows) rates.set(r.id, r.fxRate);
      for (const a of allocations) {
        const c = targets.find((t) => t.id === a.commissionId)!;
        const adjusted = rows.find((r) => r.id === a.commissionId)!.adjusted;
        if (c.institutionId !== input.institutionId) throw new BadRequestException(`${c.number} is with ${c.institutionName}.`);
        if (c.currency !== input.currency) throw new BadRequestException(`${c.number} is in ${c.currency}; this receipt is in ${input.currency}.`);
        if (a.amount > 0) {
          if (!['confirmed', 'claimed', 'disputed'].includes(c.status)) throw new BadRequestException(`${c.number} is ${c.stage.replace('_', ' ')}; confirm it before matching money to it.`);
          if (a.amount > c.outstanding) throw new BadRequestException(`Only ${formatMoney(c.outstanding, c.currency)} is outstanding on ${c.number}.`);
        } else {
          if (c.status !== 'clawed_back') throw new BadRequestException(`A deduction can only be matched to a clawed-back commission, not ${c.number}.`);
          // What has already been deducted for this clawback, on receipts that stand.
          const [done] = await this.db
            .select({ n: sql<string>`coalesce(-sum(${receiptAllocations.amount}), 0)` })
            .from(receiptAllocations)
            .innerJoin(institutionReceipts, eq(institutionReceipts.id, receiptAllocations.receiptId))
            .where(and(eq(receiptAllocations.commissionId, a.commissionId), sql`${receiptAllocations.amount} < 0`, isNull(institutionReceipts.voidedAt)));
          if (-a.amount > adjusted - Number(done?.n ?? 0)) throw new BadRequestException(`The deduction on ${c.number} is more than is left of its clawback.`);
        }
      }
    }
    const base = await this.ledger.baseCurrency(tenantId);
    const fxRate = input.currency === base ? 1 : (input.fxRate ?? null);
    const receipt = await withDocumentNumber(this.db, institutionReceipts, tenantId, 'CRX', (number) =>
      this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(institutionReceipts)
          .values({
            tenantId,
            number,
            institutionId: input.institutionId,
            receivedOn: input.receivedOn,
            currency: input.currency,
            amount,
            bankCharges: charges,
            fxRate: fxRate === null ? null : String(fxRate),
            accountId: input.accountId,
            method: input.method,
            reference: input.reference,
            claimId: input.claimId ?? null,
            notes: input.notes,
            createdBy: actor.id,
          })
          .returning();
        let fxTotal = 0;
        if (allocations.length) {
          await tx.insert(receiptAllocations).values(
            allocations.map((a) => {
              const booked = rates.get(a.commissionId);
              const fxDifference = fxRate !== null && booked !== null && booked !== undefined ? Math.round(a.amount * (fxRate - Number(booked))) : 0;
              fxTotal += fxDifference;
              return { tenantId, receiptId: row!.id, commissionId: a.commissionId, amount: a.amount, fxDifference };
            }),
          );
        }
        await postEntry(tx, {
          tenantId,
          date: input.receivedOn,
          memo: `${number}: ${inst.name}${input.reference ? ` (${input.reference})` : ''}`,
          currency: input.currency,
          fxRate,
          sourceType: 'commission_receipt',
          sourceId: row!.id,
          createdBy: actor.id,
          lines: [
            { account: { id: input.accountId }, debit: amount - charges },
            { account: 'bank_charges', debit: charges },
            { account: 'commission_receivable', credit: amount },
          ],
        });
        // Booked at one rate, paid at another: the difference is a realised
        // exchange gain or loss, in the base currency, so the receivable
        // clears to nothing in base-currency reports too.
        if (fxTotal !== 0) {
          await postEntry(tx, {
            tenantId,
            date: input.receivedOn,
            memo: `${number}: exchange difference on ${inst.name}`,
            currency: base,
            fxRate: 1,
            sourceType: 'commission_receipt',
            sourceId: row!.id,
            createdBy: actor.id,
            lines:
              fxTotal > 0
                ? [
                    { account: 'commission_receivable', debit: fxTotal },
                    { account: 'fx_differences', credit: fxTotal },
                  ]
                : [
                    { account: 'fx_differences', debit: -fxTotal },
                    { account: 'commission_receivable', credit: -fxTotal },
                  ],
          });
        }
        return row!;
      }),
    );
    await this.audit.record(actor, {
      action: 'commission_receipt.recorded',
      entityType: 'commission',
      entityId: receipt.id,
      metadata: { number: receipt.number, institution: inst.name, amount, charges, currency: input.currency, matched: allocations.length },
    });
    // What was received, commission by commission - partners earn their share of it.
    const made = await this.db
      .select({ id: receiptAllocations.id, commissionId: receiptAllocations.commissionId, amount: receiptAllocations.amount })
      .from(receiptAllocations)
      .where(and(eq(receiptAllocations.receiptId, receipt.id), sql`${receiptAllocations.amount} > 0`));
    for (const a of made) {
      await this.commissions.emitCommission({ type: 'received', tenantId, commissionId: a.commissionId, allocationId: a.id, receiptId: receipt.id, amount: a.amount, fxRate, on: input.receivedOn, actor });
    }
    // Anyone whose incentive just became payable hears about it.
    const settled = (await this.commissions.views(allocations.map((a) => a.commissionId))).filter((c) => c.stage === 'received');
    for (const c of settled) {
      for (const s of c.splits.filter((x) => x.payable)) {
        await this.notifications.push({ userId: s.userId, type: 'payout_ready', title: `Your incentive on ${c.clientName ?? c.number} is due: ${formatMoney(s.amount, s.currency)}`, body: `${c.institutionName} paid the commission in full.`, link: '/desk/workload' });
      }
    }
    return (await this.receiptViews([receipt.id]))[0]!;
  }

  async voidReceipt(actor: AuthUser, id: string, reason: string): Promise<InstitutionReceiptView> {
    this.assertManage(actor);
    const tenantId = tenantOf(actor);
    const [r] = await this.db.select().from(institutionReceipts).where(and(eq(institutionReceipts.id, id), eq(institutionReceipts.tenantId, tenantId))).limit(1);
    if (!r) throw new NotFoundException('Receipt not found.');
    if (!r.voidedAt) {
      // Only what this receipt paid towards counts; a deduction settled nothing.
      const touched = await this.db
        .select({ id: receiptAllocations.commissionId })
        .from(receiptAllocations)
        .where(and(eq(receiptAllocations.receiptId, id), sql`${receiptAllocations.amount} > 0`));
      if (touched.length) {
        const [paid] = await this.db
          .select({ n: sql<number>`count(*)::int` })
          .from(commissionSplits)
          .where(and(inArray(commissionSplits.commissionId, touched.map((t) => t.id)), sql`${commissionSplits.paidOn} is not null`));
        if ((paid?.n ?? 0) > 0) throw new BadRequestException('Staff incentives were paid on commissions this receipt settled. It cannot be voided.');
      }
      await this.db.transaction(async (tx) => {
        await tx.update(institutionReceipts).set({ voidedAt: new Date(), voidedBy: actor.id, voidReason: reason }).where(eq(institutionReceipts.id, id));
        // The receipt, and its exchange difference when there was one.
        for (let entry = await liveEntryFor(tx, tenantId, 'commission_receipt', id); entry; entry = await liveEntryFor(tx, tenantId, 'commission_receipt', id)) {
          await reverseEntry(tx, entry, { date: today(), memo: `${r.number} voided: ${reason}`, sourceType: 'reversal', createdBy: actor.id });
        }
      });
      await this.audit.record(actor, { action: 'commission_receipt.recorded', entityType: 'commission', entityId: id, metadata: { number: r.number, voided: true, reason } });
      const undone = await this.db
        .select({ id: receiptAllocations.id, commissionId: receiptAllocations.commissionId, amount: receiptAllocations.amount })
        .from(receiptAllocations)
        .where(and(eq(receiptAllocations.receiptId, id), sql`${receiptAllocations.amount} > 0`));
      for (const a of undone) {
        await this.commissions.emitCommission({ type: 'receipt_voided', tenantId, commissionId: a.commissionId, allocationId: a.id, receiptId: id, amount: a.amount, on: today(), actor });
      }
    }
    return (await this.receiptViews([id]))[0]!;
  }
}
