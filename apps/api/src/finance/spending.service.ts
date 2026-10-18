import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import {
  billSchema,
  expenseSchema,
  payBillSchema,
  type AuthUser,
  type BillInput,
  type BillStatus,
  type BillView,
  type Currency,
  type ExpenseInput,
  type ExpenseView,
  type Paginated,
  type PayBillInput,
  type PaymentMethod,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { bills, clients, expenses, ledgerAccounts, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { staffCan } from '../auth/permissions';
import { iso, page, today, withDocumentNumber } from '../common/db-helpers';
import { STORAGE, type StorageDriver } from '../storage/storage.driver';
import { DocumentsService } from '../documents/documents.service';
import { assertMoneyAccount, liveEntryFor, postEntry, reverseEntry, type PostLine } from './journal';

/**
 * The consultancy's own spending: expenses (paid there and then) and bills
 * (received now, paid later). Both post to the journal; a disbursement - a
 * visa or application fee paid on a student's behalf - goes to
 * "Disbursements recoverable", to be invoiced back, never to expenses.
 */
@Injectable()
export class SpendingService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(STORAGE) private readonly storage: StorageDriver,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
  ) {}

  private assertCan(actor: AuthUser): void {
    if (!staffCan(actor, 'finance.expenses')) throw new ForbiddenException('You do not have permission to record expenses and bills.');
  }

  /** An account money can be spent on: an expense heading, disbursements, or advances to partners. */
  private async assertSpendAccount(tenantId: string, accountId: string): Promise<typeof ledgerAccounts.$inferSelect> {
    const [a] = await this.db
      .select()
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.id, accountId), eq(ledgerAccounts.tenantId, tenantId), eq(ledgerAccounts.active, true)))
      .limit(1);
    if (!a || !(a.type === 'expense' || a.systemKey === 'disbursements' || a.systemKey === 'partner_advances')) {
      throw new BadRequestException({ message: 'Pick an expense heading (or Disbursements).', fieldErrors: { accountId: 'Not an expense heading' } });
    }
    return a;
  }

  /* ---------------------------------------------------------------- */
  /* Expenses                                                          */
  /* ---------------------------------------------------------------- */

  async expenses(actor: AuthUser, q: { from?: string; to?: string; accountId?: string; q?: string; page?: number }): Promise<Paginated<ExpenseView>> {
    this.assertCan(actor);
    const pageNo = Math.max(1, q.page ?? 1);
    const size = 30;
    const conds: (SQL | undefined)[] = [eq(expenses.tenantId, tenantOf(actor))];
    if (q.from) conds.push(gte(expenses.spentOn, q.from));
    if (q.to) conds.push(lte(expenses.spentOn, q.to));
    if (q.accountId) conds.push(eq(expenses.accountId, q.accountId));
    if (q.q) conds.push(or(ilike(expenses.vendor, `%${q.q}%`), ilike(expenses.description, `%${q.q}%`), ilike(expenses.number, `%${q.q}%`)));
    const where = and(...conds);
    const [[count], ids] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(expenses).where(where),
      this.db.select({ id: expenses.id }).from(expenses).where(where).orderBy(desc(expenses.spentOn), desc(expenses.number)).limit(size).offset((pageNo - 1) * size),
    ]);
    const items = await this.expenseRows(ids.map((i) => i.id));
    return page(items, count?.n ?? 0, pageNo, size);
  }

  private async expenseRows(ids: string[]): Promise<ExpenseView[]> {
    if (!ids.length) return [];
    const heading = alias(ledgerAccounts, 'heading');
    const from = alias(ledgerAccounts, 'paid_from');
    const recorder = alias(users, 'recorder');
    const rows = await this.db
      .select({ e: expenses, accountName: heading.name, paidFromName: from.name, clientName: clients.fullName, recordedByName: recorder.fullName })
      .from(expenses)
      .innerJoin(heading, eq(heading.id, expenses.accountId))
      .innerJoin(from, eq(from.id, expenses.paidFromAccountId))
      .leftJoin(clients, eq(clients.id, expenses.clientId))
      .leftJoin(recorder, eq(recorder.id, expenses.recordedBy))
      .where(inArray(expenses.id, ids));
    const byId = new Map(rows.map((r) => [r.e.id, r]));
    return ids
      .map((id) => byId.get(id)!)
      .filter(Boolean)
      .map((r) => ({
        id: r.e.id,
        number: r.e.number,
        spentOn: r.e.spentOn,
        accountId: r.e.accountId,
        accountName: r.accountName,
        vendor: r.e.vendor,
        description: r.e.description,
        amount: r.e.amount,
        taxAmount: r.e.taxAmount,
        currency: r.e.currency as Currency,
        fxRate: r.e.fxRate === null ? null : Number(r.e.fxRate),
        paidFromAccountId: r.e.paidFromAccountId,
        paidFromName: r.paidFromName,
        method: r.e.method as PaymentMethod,
        reference: r.e.reference,
        clientId: r.e.clientId,
        clientName: r.clientName,
        hasReceipt: Boolean(r.e.receiptKey),
        receiptName: r.e.receiptName,
        recordedByName: r.recordedByName,
        voided: Boolean(r.e.voidedAt),
        voidReason: r.e.voidReason,
        createdAt: iso(r.e.createdAt),
      }));
  }

  async recordExpense(actor: AuthUser, raw: ExpenseInput, file?: { buffer: Buffer; originalname: string; size: number }): Promise<ExpenseView> {
    this.assertCan(actor);
    const input = expenseSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const heading = await this.assertSpendAccount(tenantId, input.accountId);
    await assertMoneyAccount(this.db, tenantId, input.paidFromAccountId);
    if (input.taxAmount > input.amount) throw new BadRequestException({ message: 'The tax is more than the amount.', fieldErrors: { taxAmount: 'More than the amount' } });
    if (input.spentOn > today()) throw new BadRequestException({ message: 'That date is in the future.', fieldErrors: { spentOn: 'Record it once it is paid' } });
    if (input.clientId) {
      const [c] = await this.db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, input.clientId), eq(clients.tenantId, tenantId))).limit(1);
      if (!c) throw new BadRequestException({ message: 'That student is not yours.', fieldErrors: { clientId: 'Unknown student' } });
    }
    let receipt: { key: string; name: string; mime: string } | null = null;
    if (file) {
      const valid = await this.documents.accept(actor, file);
      const key = `tenants/${tenantId}/finance/expenses/${randomUUID()}`;
      await this.storage.put(key, valid.buffer, valid.mimeType);
      receipt = { key, name: valid.fileName, mime: valid.mimeType };
    }
    const base = await this.base(tenantId);
    const row = await withDocumentNumber(this.db, expenses, tenantId, 'EXP', (number) =>
      this.db.transaction(async (tx) => {
        const [e] = await tx
          .insert(expenses)
          .values({
            tenantId,
            number,
            spentOn: input.spentOn,
            accountId: input.accountId,
            vendor: input.vendor,
            description: input.description,
            amount: input.amount,
            taxAmount: input.taxAmount,
            currency: input.currency,
            fxRate: input.currency === base ? '1' : input.fxRate ? String(input.fxRate) : null,
            paidFromAccountId: input.paidFromAccountId,
            method: input.method,
            reference: input.reference,
            clientId: input.clientId ?? null,
            caseId: input.caseId ?? null,
            receiptKey: receipt?.key ?? null,
            receiptName: receipt?.name ?? null,
            receiptMime: receipt?.mime ?? null,
            recordedBy: actor.id,
          })
          .returning();
        await postEntry(tx, {
          tenantId,
          date: input.spentOn,
          memo: `${number}: ${input.vendor} - ${input.description}`,
          currency: input.currency,
          fxRate: e!.fxRate,
          sourceType: 'expense',
          sourceId: e!.id,
          createdBy: actor.id,
          lines: spendLines(heading.id, input.amount, input.taxAmount, { id: input.paidFromAccountId }, input.clientId ?? null),
        });
        return e!;
      }),
    );
    await this.audit.record(actor, {
      action: 'expense.recorded',
      entityType: 'expense',
      entityId: row.id,
      clientId: input.clientId ?? null,
      metadata: { number: row.number, vendor: input.vendor, amount: input.amount, currency: input.currency, heading: heading.name },
    });
    return (await this.expenseRows([row.id]))[0]!;
  }

  async voidExpense(actor: AuthUser, id: string, reason: string): Promise<ExpenseView> {
    this.assertCan(actor);
    const tenantId = tenantOf(actor);
    const [e] = await this.db.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantId))).limit(1);
    if (!e) throw new NotFoundException('Expense not found.');
    if (!e.voidedAt) {
      await this.db.transaction(async (tx) => {
        await tx.update(expenses).set({ voidedAt: new Date(), voidedBy: actor.id, voidReason: reason }).where(eq(expenses.id, id));
        const entry = await liveEntryFor(tx, tenantId, 'expense', id);
        if (entry) await reverseEntry(tx, entry, { date: today(), memo: `${e.number} voided: ${reason}`, sourceType: 'expense_void', createdBy: actor.id });
      });
      await this.audit.record(actor, { action: 'expense.voided', entityType: 'expense', entityId: id, metadata: { number: e.number, reason } });
    }
    return (await this.expenseRows([id]))[0]!;
  }

  async receipt(actor: AuthUser, id: string): Promise<{ stream: Readable; name: string; mime: string }> {
    this.assertCan(actor);
    const [e] = await this.db.select().from(expenses).where(and(eq(expenses.id, id), eq(expenses.tenantId, tenantOf(actor)))).limit(1);
    if (!e?.receiptKey) throw new NotFoundException('No receipt is attached.');
    return { stream: await this.storage.get(e.receiptKey), name: e.receiptName ?? 'receipt', mime: e.receiptMime ?? 'application/octet-stream' };
  }

  /* ---------------------------------------------------------------- */
  /* Bills                                                             */
  /* ---------------------------------------------------------------- */

  async bills(actor: AuthUser, q: { status?: string; q?: string }): Promise<BillView[]> {
    this.assertCan(actor);
    const conds: (SQL | undefined)[] = [eq(bills.tenantId, tenantOf(actor))];
    if (q.status === 'overdue') conds.push(eq(bills.status, 'open'), sql`${bills.dueDate} < ${today()}`);
    else if (q.status && q.status !== 'all') conds.push(eq(bills.status, q.status));
    if (q.q) conds.push(or(ilike(bills.vendor, `%${q.q}%`), ilike(bills.description, `%${q.q}%`), ilike(bills.number, `%${q.q}%`)));
    return this.billRows(and(...conds));
  }

  private async billRows(where: SQL | undefined): Promise<BillView[]> {
    const heading = alias(ledgerAccounts, 'heading');
    const from = alias(ledgerAccounts, 'paid_from');
    const rows = await this.db
      .select({ b: bills, accountName: heading.name, paidFromName: from.name })
      .from(bills)
      .innerJoin(heading, eq(heading.id, bills.accountId))
      .leftJoin(from, eq(from.id, bills.paidFromAccountId))
      .where(where)
      .orderBy(asc(sql`case ${bills.status} when 'open' then 0 when 'paid' then 1 else 2 end`), asc(bills.dueDate))
      .limit(300);
    const day = today();
    return rows.map((r) => ({
      id: r.b.id,
      number: r.b.number,
      vendor: r.b.vendor,
      vendorReference: r.b.vendorReference,
      issueDate: r.b.issueDate,
      dueDate: r.b.dueDate,
      accountId: r.b.accountId,
      accountName: r.accountName,
      description: r.b.description,
      amount: r.b.amount,
      taxAmount: r.b.taxAmount,
      currency: r.b.currency as Currency,
      status: r.b.status as BillStatus,
      overdue: r.b.status === 'open' && r.b.dueDate < day,
      paidOn: r.b.paidOn,
      paidFromName: r.paidFromName,
      reference: r.b.reference,
      voidReason: r.b.voidReason,
      createdAt: iso(r.b.createdAt),
    }));
  }

  async saveBill(actor: AuthUser, raw: BillInput): Promise<BillView> {
    this.assertCan(actor);
    const input = billSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const heading = await this.assertSpendAccount(tenantId, input.accountId);
    if (input.taxAmount > input.amount) throw new BadRequestException({ message: 'The tax is more than the amount.', fieldErrors: { taxAmount: 'More than the amount' } });
    const base = await this.base(tenantId);
    const row = await withDocumentNumber(this.db, bills, tenantId, 'BIL', (number) =>
      this.db.transaction(async (tx) => {
        const [b] = await tx
          .insert(bills)
          .values({
            tenantId,
            number,
            vendor: input.vendor,
            vendorReference: input.vendorReference,
            issueDate: input.issueDate,
            dueDate: input.dueDate,
            accountId: input.accountId,
            description: input.description,
            amount: input.amount,
            taxAmount: input.taxAmount,
            currency: input.currency,
            fxRate: input.currency === base ? '1' : input.fxRate ? String(input.fxRate) : null,
            createdBy: actor.id,
          })
          .returning();
        await postEntry(tx, {
          tenantId,
          date: input.issueDate,
          memo: `${number}: ${input.vendor} - ${input.description}`,
          currency: input.currency,
          fxRate: b!.fxRate,
          sourceType: 'bill',
          sourceId: b!.id,
          createdBy: actor.id,
          lines: spendLines(heading.id, input.amount, input.taxAmount, 'payable', null),
        });
        return b!;
      }),
    );
    await this.audit.record(actor, { action: 'bill.saved', entityType: 'bill', entityId: row.id, metadata: { number: row.number, vendor: input.vendor, amount: input.amount, due: input.dueDate } });
    return (await this.billRows(eq(bills.id, row.id)))[0]!;
  }

  async payBill(actor: AuthUser, id: string, raw: PayBillInput): Promise<BillView> {
    this.assertCan(actor);
    const input = payBillSchema.parse(raw);
    const tenantId = tenantOf(actor);
    await assertMoneyAccount(this.db, tenantId, input.paidFromAccountId);
    if (input.paidOn > today()) throw new BadRequestException({ message: 'That date is in the future.', fieldErrors: { paidOn: 'Record it once it is paid' } });
    const [b] = await this.db.select().from(bills).where(and(eq(bills.id, id), eq(bills.tenantId, tenantId))).limit(1);
    if (!b) throw new NotFoundException('Bill not found.');
    if (b.status !== 'open') throw new BadRequestException(`This bill is ${b.status}.`);
    await this.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(bills)
        .set({ status: 'paid', paidOn: input.paidOn, paidFromAccountId: input.paidFromAccountId, method: input.method, reference: input.reference })
        .where(and(eq(bills.id, id), eq(bills.status, 'open')))
        .returning();
      if (!claimed) throw new BadRequestException('This bill has just been paid.');
      await postEntry(tx, {
        tenantId,
        date: input.paidOn,
        memo: `${b.number} paid: ${b.vendor}`,
        currency: b.currency,
        fxRate: b.fxRate,
        sourceType: 'bill_payment',
        sourceId: id,
        createdBy: actor.id,
        lines: [
          { account: 'payable', debit: b.amount },
          { account: { id: input.paidFromAccountId }, credit: b.amount },
        ],
      });
    });
    await this.audit.record(actor, { action: 'bill.paid', entityType: 'bill', entityId: id, metadata: { number: b.number, amount: b.amount, paidOn: input.paidOn } });
    return (await this.billRows(eq(bills.id, id)))[0]!;
  }

  /** An unpaid bill entered by mistake. A paid one stays: its payment is real. */
  async voidBill(actor: AuthUser, id: string, reason: string): Promise<BillView> {
    this.assertCan(actor);
    const tenantId = tenantOf(actor);
    const [b] = await this.db.select().from(bills).where(and(eq(bills.id, id), eq(bills.tenantId, tenantId))).limit(1);
    if (!b) throw new NotFoundException('Bill not found.');
    if (b.status === 'paid') throw new BadRequestException('A paid bill cannot be voided. Record a refund from the supplier as income instead.');
    if (b.status === 'open') {
      await this.db.transaction(async (tx) => {
        await tx.update(bills).set({ status: 'void', voidedAt: new Date(), voidReason: reason }).where(eq(bills.id, id));
        const entry = await liveEntryFor(tx, tenantId, 'bill', id);
        if (entry) await reverseEntry(tx, entry, { date: today(), memo: `${b.number} voided: ${reason}`, sourceType: 'bill_void', createdBy: actor.id });
      });
      await this.audit.record(actor, { action: 'bill.voided', entityType: 'bill', entityId: id, metadata: { number: b.number, reason } });
    }
    return (await this.billRows(eq(bills.id, id)))[0]!;
  }

  private async base(tenantId: string): Promise<string> {
    const r = await this.db.execute<{ c: string }>(sql`select base_currency as c from finance_settings where tenant_id = ${tenantId}`);
    const rows = (r as unknown as { rows?: { c: string }[] }).rows ?? (r as unknown as { c: string }[]);
    return rows[0]?.c ?? 'PKR';
  }
}

/** Spending: the heading takes the cost less recoverable tax, tax payable the tax, and the other side pays. */
function spendLines(headingId: string, amount: number, taxAmount: number, paidFrom: PostLine['account'], clientId: string | null): PostLine[] {
  return [
    { account: { id: headingId }, debit: amount - taxAmount, clientId },
    { account: 'tax_payable', debit: taxAmount },
    { account: paidFrom, credit: amount },
  ];
}

