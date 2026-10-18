import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from 'drizzle-orm';
import {
  JOURNAL_SOURCE_LABEL,
  NORMAL_BALANCE,
  REPORT_LABEL,
  agingBucket,
  allocateInstallments,
  type AccountType,
  type AgingBuckets,
  type AuthUser,
  type Currency,
  type ExportJournalInput,
  type FinanceOverview,
  type JournalSource,
  type ReportName,
  type ReportQuery,
  type ReportRow,
  type ReportView,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import {
  bankLines,
  bills,
  clients,
  creditNotes,
  installments,
  invoiceItems,
  invoices,
  journalEntries,
  journalLines,
  ledgerAccounts,
  payments,
  paymentSubmissions,
  refundRequests,
} from '../db/schema';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { staffCan } from '../auth/permissions';
import { today } from '../common/db-helpers';
import { LedgerService, toAccount } from './ledger.service';
import { AuditService } from '../audit/audit.service';

type Sums = Map<string, { debit: number; credit: number }>;
type AccountRow = typeof ledgerAccounts.$inferSelect;

const BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90plus'] as const;
const BUCKET_LABEL = ['Current', '1–30 days', '31–60 days', '61–90 days', 'Over 90 days'];

/** Which money movements a cash-flow line belongs to. */
const FLOW_GROUP: Partial<Record<JournalSource, string>> = {
  payment: 'Student payments and refunds',
  payment_void: 'Student payments and refunds',
  expense: 'Expenses',
  expense_void: 'Expenses',
  bill_payment: 'Bills paid',
  commission_receipt: 'University commissions',
  payout: 'Partner payouts',
  cash_count: 'Cash counts',
  bank: 'Bank (charges, interest, transfers)',
  manual: 'Other entries',
  reversal: 'Other entries',
  opening: 'Opening balances',
};

/**
 * Reports over the journal (and, for what students owe, over the invoices
 * the journal was posted from - the two agree, and a test keeps them so).
 * Every report is per currency; "base" converts each entry at its own rate
 * and says how many entries had no rate.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly ledger: LedgerService,
    private readonly audit: AuditService,
  ) {}

  private assertCan(actor: AuthUser): void {
    if (!staffCan(actor, 'finance.ledger')) throw new ForbiddenException('You do not have permission to see the financial reports.');
  }

  /* ---------------------------------------------------------------- */
  /* Sums                                                              */
  /* ---------------------------------------------------------------- */

  private async sums(tenantId: string, cur: Currency | 'base', opts: { from?: string; to?: string; byMonth?: boolean }): Promise<{ sums: Sums; months: Map<string, Sums>; unconverted: number }> {
    const conds: (SQL | undefined)[] = [eq(journalLines.tenantId, tenantId)];
    if (opts.from) conds.push(gte(journalEntries.entryDate, opts.from));
    if (opts.to) conds.push(lte(journalEntries.entryDate, opts.to));
    const base = cur === 'base';
    if (base) conds.push(sql`${journalEntries.fxRate} is not null`);
    else conds.push(eq(journalEntries.currency, cur));
    const debit = base ? sql<string>`sum(round(${journalLines.debit} * ${journalEntries.fxRate}))` : sql<string>`sum(${journalLines.debit})`;
    const credit = base ? sql<string>`sum(round(${journalLines.credit} * ${journalEntries.fxRate}))` : sql<string>`sum(${journalLines.credit})`;
    const month = sql<string>`to_char(${journalEntries.entryDate}, 'YYYY-MM')`;
    const rows = await this.db
      .select({ accountId: journalLines.accountId, month: opts.byMonth ? month : sql<string>`''`, debit, credit })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(and(...conds))
      .groupBy(journalLines.accountId, ...(opts.byMonth ? [month] : []));
    const sums: Sums = new Map();
    const months = new Map<string, Sums>();
    for (const r of rows) {
      const d = Number(r.debit);
      const c = Number(r.credit);
      const s = sums.get(r.accountId) ?? { debit: 0, credit: 0 };
      s.debit += d;
      s.credit += c;
      sums.set(r.accountId, s);
      if (opts.byMonth) {
        const m = months.get(r.month) ?? new Map();
        m.set(r.accountId, { debit: d, credit: c });
        months.set(r.month, m);
      }
    }
    let unconverted = 0;
    if (base) {
      const [u] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(journalEntries)
        .where(
          and(
            eq(journalEntries.tenantId, tenantId),
            sql`${journalEntries.fxRate} is null`,
            opts.from ? gte(journalEntries.entryDate, opts.from) : undefined,
            opts.to ? lte(journalEntries.entryDate, opts.to) : undefined,
          ),
        );
      unconverted = u?.n ?? 0;
    }
    return { sums, months, unconverted };
  }

  private async accounts(tenantId: string): Promise<AccountRow[]> {
    return this.db.select().from(ledgerAccounts).where(eq(ledgerAccounts.tenantId, tenantId)).orderBy(asc(ledgerAccounts.code));
  }

  /* ---------------------------------------------------------------- */
  /* Reports                                                           */
  /* ---------------------------------------------------------------- */

  async report(actor: AuthUser, name: ReportName, q: ReportQuery): Promise<ReportView> {
    this.assertCan(actor);
    const tenantId = tenantOf(actor);
    const baseCurrency = await this.ledger.baseCurrency(tenantId);
    const currency = q.currency ?? baseCurrency;
    const to = q.to ?? today();
    const yearStart = `${to.slice(0, 4)}-01-01`;
    const shell = (title: string, subtitle: string, from: string | null, columns: string[], moneyColumns: number[]): ReportView => ({
      name,
      title,
      subtitle,
      currency,
      baseCurrency,
      from,
      to,
      columns,
      moneyColumns,
      rows: [],
      unconverted: 0,
      checks: [],
    });

    switch (name) {
      case 'trial-balance': {
        const r = shell(REPORT_LABEL[name], `As at ${to}`, null, ['Code', 'Account', 'Debit', 'Credit'], [2, 3]);
        const [accts, s] = await Promise.all([this.accounts(tenantId), this.sums(tenantId, currency, { to })]);
        let td = 0;
        let tc = 0;
        for (const a of accts) {
          const x = s.sums.get(a.id);
          if (!x || x.debit === x.credit) continue;
          const net = x.debit - x.credit;
          const d = net > 0 ? net : 0;
          const c = net < 0 ? -net : 0;
          td += d;
          tc += c;
          r.rows.push({ label: a.name, code: a.code, accountId: a.id, values: [a.code, a.name, d || null, c || null] });
        }
        r.rows.push({ label: 'Total', values: ['', 'Total', td, tc], emphasis: true });
        r.unconverted = s.unconverted;
        r.checks.push(
          currency === 'base'
            ? { label: `Debits and credits agree (to within ${Math.abs(td - tc) / 100} from converting at each entry’s rate)`, ok: Math.abs(td - tc) <= 100 }
            : { label: 'Debits equal credits', ok: td === tc },
        );
        return r;
      }

      case 'pnl': {
        const from = q.from ?? yearStart;
        const r = shell(REPORT_LABEL[name], `${from} to ${to}`, from, ['Account', 'Amount'], [1]);
        const [accts, s] = await Promise.all([this.accounts(tenantId), this.sums(tenantId, currency, { from, to })]);
        const income = section(r.rows, 'Income', accts.filter((a) => a.type === 'income'), s.sums, (x) => x.credit - x.debit);
        const expenses = section(r.rows, 'Expenses', accts.filter((a) => a.type === 'expense'), s.sums, (x) => x.debit - x.credit);
        r.rows.push({ label: income - expenses >= 0 ? 'Net profit' : 'Net loss', values: ['Net profit', income - expenses], emphasis: true });
        r.unconverted = s.unconverted;
        return r;
      }

      case 'balance-sheet': {
        const r = shell(REPORT_LABEL[name], `As at ${to}`, null, ['Account', 'Amount'], [1]);
        const [accts, s] = await Promise.all([this.accounts(tenantId), this.sums(tenantId, currency, { to })]);
        const assets = section(r.rows, 'Assets', accts.filter((a) => a.type === 'asset'), s.sums, (x) => x.debit - x.credit);
        const liabilities = section(r.rows, 'Liabilities', accts.filter((a) => a.type === 'liability'), s.sums, (x) => x.credit - x.debit);
        const equityRows: ReportRow[] = [];
        const equity = section(equityRows, 'Equity', accts.filter((a) => a.type === 'equity'), s.sums, (x) => x.credit - x.debit, false);
        const profit = accts
          .filter((a) => a.type === 'income' || a.type === 'expense')
          .reduce((n, a) => {
            const x = s.sums.get(a.id);
            return x ? n + (x.credit - x.debit) : n;
          }, 0);
        r.rows.push(...equityRows, { label: 'Profit to date (not yet closed to retained earnings)', level: 1, values: ['Profit to date', profit] });
        r.rows.push({ label: 'Total equity', values: ['Total equity', equity + profit], emphasis: true });
        r.rows.push({ label: 'Total liabilities and equity', values: ['Total liabilities and equity', liabilities + equity + profit], emphasis: true });
        r.unconverted = s.unconverted;
        r.checks.push({
          label: 'Assets equal liabilities plus equity',
          ok: currency === 'base' ? Math.abs(assets - (liabilities + equity + profit)) <= 100 : assets === liabilities + equity + profit,
        });
        return r;
      }

      case 'aging': {
        const cur = currency === 'base' ? baseCurrency : currency;
        const r = shell(REPORT_LABEL[name], `What students owe in ${cur}, as at ${today()}`, null, ['Student', ...BUCKET_LABEL, 'Total'], [1, 2, 3, 4, 5, 6]);
        r.currency = cur;
        const rows = await this.receivablesAging(tenantId, cur);
        const total: AgingBuckets = { currency: cur, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
        for (const row of rows) {
          r.rows.push({ label: row.name, values: [row.name, ...BUCKETS.map((b) => row.buckets[b] || null), row.buckets.total] });
          for (const b of [...BUCKETS, 'total'] as const) total[b] += row.buckets[b];
        }
        r.rows.push({ label: 'Total', values: ['Total', ...BUCKETS.map((b) => total[b]), total.total], emphasis: true });
        const ar = await this.receivableBalance(tenantId, cur);
        r.checks.push({ label: 'Agrees with the receivables account in the books', ok: ar === total.total });
        return r;
      }

      case 'collections': {
        const cur = currency === 'base' ? baseCurrency : currency;
        const from = q.from ?? monthsBack(to, 5);
        const r = shell(REPORT_LABEL[name], `${cur}, ${from.slice(0, 7)} to ${to.slice(0, 7)}`, from, ['Month', 'Fell due', 'Collected', 'Credited', 'Collected less due'], [1, 2, 3, 4]);
        r.currency = cur;
        const [planned, unplanned, collected, credited] = await Promise.all([
          this.db
            .select({ m: sql<string>`to_char(${installments.dueDate}, 'YYYY-MM')`, n: sql<string>`sum(${installments.amount})` })
            .from(installments)
            .innerJoin(invoices, eq(invoices.id, installments.invoiceId))
            .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'issued'), eq(invoices.currency, cur), gte(installments.dueDate, from), lte(installments.dueDate, to)))
            .groupBy(sql`1`),
          this.db
            .select({ m: sql<string>`to_char(${invoices.dueDate}, 'YYYY-MM')`, n: sql<string>`sum(${invoices.total})` })
            .from(invoices)
            .where(
              and(
                eq(invoices.tenantId, tenantId),
                eq(invoices.status, 'issued'),
                eq(invoices.currency, cur),
                gte(invoices.dueDate, from),
                lte(invoices.dueDate, to),
                sql`not exists (select 1 from installments x where x.invoice_id = ${invoices.id})`,
              ),
            )
            .groupBy(sql`1`),
          this.db
            .select({ m: sql<string>`to_char(${payments.receivedOn}, 'YYYY-MM')`, n: sql<string>`sum(case when ${payments.kind} = 'payment' then ${payments.amount} else -${payments.amount} end)` })
            .from(payments)
            .where(and(eq(payments.tenantId, tenantId), eq(payments.currency, cur), isNull(payments.voidedAt), gte(payments.receivedOn, from), lte(payments.receivedOn, to)))
            .groupBy(sql`1`),
          this.db
            .select({ m: sql<string>`to_char(${creditNotes.issuedOn}, 'YYYY-MM')`, n: sql<string>`sum(${creditNotes.amount})` })
            .from(creditNotes)
            .where(and(eq(creditNotes.tenantId, tenantId), eq(creditNotes.currency, cur), isNull(creditNotes.voidedAt), gte(creditNotes.issuedOn, from), lte(creditNotes.issuedOn, to)))
            .groupBy(sql`1`),
        ]);
        const by = (rows: { m: string; n: string }[]) => new Map(rows.map((x) => [x.m, Number(x.n)]));
        const p = by(planned);
        const u = by(unplanned);
        const c = by(collected);
        const k = by(credited);
        const totals = [0, 0, 0, 0];
        for (const m of monthList(from, to)) {
          const due = (p.get(m) ?? 0) + (u.get(m) ?? 0);
          const vals = [due, c.get(m) ?? 0, k.get(m) ?? 0, (c.get(m) ?? 0) - due];
          vals.forEach((v, i) => (totals[i]! += v));
          r.rows.push({ label: m, values: [monthLabel(m), ...vals] });
        }
        r.rows.push({ label: 'Total', values: ['Total', ...totals], emphasis: true });
        return r;
      }

      case 'revenue': {
        const from = q.from ?? yearStart;
        const months = monthList(from, to).slice(-12);
        const r = shell(REPORT_LABEL[name], `${from} to ${to}, from the income accounts`, from, ['Account', ...months.map(monthLabel), 'Total'], [...months.map((_, i) => i + 1), months.length + 1]);
        const [accts, s] = await Promise.all([this.accounts(tenantId), this.sums(tenantId, currency, { from, to, byMonth: true })]);
        const colTotals = months.map(() => 0);
        let grand = 0;
        for (const a of accts.filter((x) => x.type === 'income')) {
          const vals = months.map((m) => {
            const x = s.months.get(m)?.get(a.id);
            return x ? x.credit - x.debit : 0;
          });
          const total = vals.reduce((n, v) => n + v, 0);
          if (!vals.some(Boolean)) continue;
          vals.forEach((v, i) => (colTotals[i]! += v));
          grand += total;
          r.rows.push({ label: a.name, code: a.code, accountId: a.id, values: [a.name, ...vals.map((v) => v || null), total] });
        }
        r.rows.push({ label: 'Total income', values: ['Total income', ...colTotals, grand], emphasis: true });
        r.unconverted = s.unconverted;
        return r;
      }

      case 'tax': {
        const from = q.from ?? yearStart;
        const cur = currency === 'base' ? baseCurrency : currency;
        const r = shell(REPORT_LABEL[name], `${cur}, ${from} to ${to}`, from, ['', 'Taxable amount', 'Tax'], [1, 2]);
        r.currency = cur;
        const [byRate, payable] = await Promise.all([
          this.db
            .select({
              name: sql<string>`coalesce(${invoiceItems.taxRateName}, 'No tax')`,
              bp: invoiceItems.taxRateBp,
              taxable: sql<string>`sum(${invoiceItems.amount} - ${invoiceItems.discount} - case when ${invoiceItems.taxInclusive} then ${invoiceItems.taxAmount} else 0 end)`,
              tax: sql<string>`sum(${invoiceItems.taxAmount})`,
            })
            .from(invoiceItems)
            .innerJoin(invoices, eq(invoices.id, invoiceItems.invoiceId))
            .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'issued'), eq(invoices.currency, cur), gte(invoices.issueDate, from), lte(invoices.issueDate, to)))
            .groupBy(sql`1`, invoiceItems.taxRateBp)
            .orderBy(desc(invoiceItems.taxRateBp)),
          this.db
            .select({ source: journalEntries.sourceType, d: sql<string>`sum(${journalLines.debit})`, c: sql<string>`sum(${journalLines.credit})` })
            .from(journalLines)
            .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
            .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
            .where(and(eq(journalLines.tenantId, tenantId), eq(ledgerAccounts.systemKey, 'tax_payable'), eq(journalEntries.currency, cur), gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to)))
            .groupBy(journalEntries.sourceType),
        ]);
        r.rows.push({ label: 'Charged on invoices, by rate', values: ['Charged on invoices, by rate', null, null], emphasis: true });
        for (const x of byRate) r.rows.push({ label: x.name, level: 1, values: [x.bp ? `${x.name} (${x.bp / 100}%)` : x.name, Number(x.taxable), Number(x.tax) || null] });
        r.rows.push({ label: 'Movements on tax payable', values: ['Movements on tax payable', null, null], emphasis: true });
        let net = 0;
        for (const x of payable) {
          const v = Number(x.c) - Number(x.d);
          net += v;
          r.rows.push({ label: JOURNAL_SOURCE_LABEL[x.source as JournalSource] ?? x.source, level: 1, values: [JOURNAL_SOURCE_LABEL[x.source as JournalSource] ?? x.source, null, v] });
        }
        r.rows.push({ label: 'Net tax owed for the period', values: ['Net tax owed for the period (charged less reclaimed)', null, net], emphasis: true });
        return r;
      }

      case 'cash-flow': {
        const from = q.from ?? yearStart;
        const r = shell(REPORT_LABEL[name], `Cash, bank and online accounts, ${from} to ${to}`, from, ['', 'Money in', 'Money out', 'Net'], [1, 2, 3]);
        const conv = currency === 'base';
        const amt = (col: typeof journalLines.debit | typeof journalLines.credit) => (conv ? sql<string>`sum(round(${col} * ${journalEntries.fxRate}))` : sql<string>`sum(${col})`);
        const money = and(
          eq(journalLines.tenantId, tenantId),
          inArray(ledgerAccounts.subtype, ['cash', 'bank', 'clearing']),
          conv ? sql`${journalEntries.fxRate} is not null` : eq(journalEntries.currency, currency),
        );
        const [opening, flows] = await Promise.all([
          this.db
            .select({ d: amt(journalLines.debit), c: amt(journalLines.credit) })
            .from(journalLines)
            .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
            .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
            .where(and(money, sql`${journalEntries.entryDate} < ${from}`)),
          this.db
            .select({ source: journalEntries.sourceType, d: amt(journalLines.debit), c: amt(journalLines.credit) })
            .from(journalLines)
            .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
            .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
            .where(and(money, gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to)))
            .groupBy(journalEntries.sourceType),
        ]);
        const open = Number(opening[0]?.d ?? 0) - Number(opening[0]?.c ?? 0);
        r.rows.push({ label: 'Opening balance', values: ['Opening balance', null, null, open], emphasis: true });
        const grouped = new Map<string, { in: number; out: number }>();
        for (const f of flows) {
          const g = FLOW_GROUP[f.source as JournalSource] ?? 'Other entries';
          const cur = grouped.get(g) ?? { in: 0, out: 0 };
          cur.in += Number(f.d ?? 0);
          cur.out += Number(f.c ?? 0);
          grouped.set(g, cur);
        }
        let tin = 0;
        let tout = 0;
        for (const [g, v] of [...grouped.entries()].sort((a, b) => b[1].in + b[1].out - (a[1].in + a[1].out))) {
          tin += v.in;
          tout += v.out;
          r.rows.push({ label: g, level: 1, values: [g, v.in || null, v.out || null, v.in - v.out] });
        }
        r.rows.push({ label: 'Total movement', values: ['Total movement', tin, tout, tin - tout], emphasis: true });
        r.rows.push({ label: 'Closing balance', values: ['Closing balance', null, null, open + tin - tout], emphasis: true });
        return r;
      }

      case 'payables': {
        const cur = currency === 'base' ? baseCurrency : currency;
        const r = shell(REPORT_LABEL[name], `Unpaid bills in ${cur}, as at ${today()}`, null, ['Supplier', ...BUCKET_LABEL, 'Total'], [1, 2, 3, 4, 5, 6]);
        r.currency = cur;
        const open = await this.db
          .select({ vendor: bills.vendor, dueDate: bills.dueDate, amount: bills.amount })
          .from(bills)
          .where(and(eq(bills.tenantId, tenantId), eq(bills.status, 'open'), eq(bills.currency, cur)));
        const day = today();
        const byVendor = new Map<string, Record<string, number>>();
        for (const b of open) {
          const row = byVendor.get(b.vendor) ?? { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
          row[agingBucket(daysLate(b.dueDate, day))]! += b.amount;
          row.total! += b.amount;
          byVendor.set(b.vendor, row);
        }
        const total: Record<string, number> = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
        for (const [vendor, row] of [...byVendor.entries()].sort((a, b) => b[1].total! - a[1].total!)) {
          r.rows.push({ label: vendor, values: [vendor, ...BUCKETS.map((b) => row[b] || null), row.total!] });
          for (const k of Object.keys(total)) total[k]! += row[k]!;
        }
        r.rows.push({ label: 'Total', values: ['Total', ...BUCKETS.map((b) => total[b]!), total.total!], emphasis: true });
        const ap = await this.accountBalance(tenantId, 'payable', cur);
        r.checks.push({ label: 'Agrees with accounts payable in the books', ok: ap === total.total });
        return r;
      }
    }
  }

  /** CSV of a report, with money as plain numbers in major units. */
  toCsv(r: ReportView): string {
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? '' : String(v);
      const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const lines = [r.columns.map(esc).join(',')];
    for (const row of r.rows) {
      lines.push(row.values.map((v, i) => (r.moneyColumns.includes(i) && typeof v === 'number' ? (v / 100).toFixed(2) : esc(v))).map(String).join(','));
    }
    return `﻿${lines.join('\r\n')}\r\n`;
  }

  /* ---------------------------------------------------------------- */
  /* What students owe                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Per student and lateness, installment by installment: an installment
   * still unpaid falls in the bucket of its own due date.
   */
  async receivablesAging(tenantId: string, cur: string): Promise<{ clientId: string; name: string; buckets: AgingBuckets }[]> {
    const day = today();
    const rows = await this.db
      .select({
        id: invoices.id,
        clientId: invoices.clientId,
        name: clients.fullName,
        dueDate: invoices.dueDate,
        total: invoices.total,
        paid: sql<string>`coalesce((select sum(case when p.kind = 'payment' then p.amount else -p.amount end) from payments p where p.invoice_id = ${invoices.id} and p.voided_at is null), 0)`,
        credited: sql<string>`coalesce((select sum(cn.amount) from credit_notes cn where cn.invoice_id = ${invoices.id} and cn.voided_at is null), 0)`,
      })
      .from(invoices)
      .innerJoin(clients, eq(clients.id, invoices.clientId))
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'issued'), eq(invoices.currency, cur)));
    const plans = rows.length
      ? await this.db.select().from(installments).where(inArray(installments.invoiceId, rows.map((r) => r.id))).orderBy(asc(installments.seq))
      : [];
    const planOf = new Map<string, (typeof plans)[number][]>();
    for (const p of plans) planOf.set(p.invoiceId, [...(planOf.get(p.invoiceId) ?? []), p]);
    const byClient = new Map<string, { clientId: string; name: string; buckets: AgingBuckets }>();
    for (const r of rows) {
      const settled = Number(r.paid) + Number(r.credited);
      const owed = r.total - settled;
      if (owed === 0) continue;
      const entry = byClient.get(r.clientId) ?? { clientId: r.clientId, name: r.name, buckets: { currency: cur as Currency, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 } };
      const plan = planOf.get(r.id);
      if (plan?.length && owed > 0) {
        for (const i of allocateInstallments(plan, settled, day)) {
          const left = i.amount - i.paid;
          if (left > 0) entry.buckets[agingBucket(daysLate(i.dueDate, day))] += left;
        }
      } else {
        // Overpaid invoices count as current credit, so the total still matches the books.
        entry.buckets[owed > 0 ? agingBucket(daysLate(r.dueDate, day)) : 'current'] += owed;
      }
      entry.buckets.total += owed;
      byClient.set(r.clientId, entry);
    }
    return [...byClient.values()].filter((c) => c.buckets.total !== 0).sort((a, b) => b.buckets.total - a.buckets.total);
  }

  private async accountBalance(tenantId: string, key: string, cur: string): Promise<number> {
    const [r] = await this.db
      .select({ d: sql<string>`coalesce(sum(${journalLines.debit}), 0)`, c: sql<string>`coalesce(sum(${journalLines.credit}), 0)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(and(eq(journalLines.tenantId, tenantId), eq(ledgerAccounts.systemKey, key), eq(journalEntries.currency, cur)));
    const type: AccountType = key === 'payable' ? 'liability' : 'asset';
    const net = Number(r?.d ?? 0) - Number(r?.c ?? 0);
    return NORMAL_BALANCE[type] === 'debit' ? net : -net;
  }

  receivableBalance(tenantId: string, cur: string): Promise<number> {
    return this.accountBalance(tenantId, 'receivable', cur);
  }

  /* ---------------------------------------------------------------- */
  /* The workspace's front page                                        */
  /* ---------------------------------------------------------------- */

  async overview(actor: AuthUser): Promise<FinanceOverview> {
    if (!staffCan(actor, 'finance.ledger') && !staffCan(actor, 'finance.expenses') && !staffCan(actor, 'billing.verify') && !staffCan(actor, 'billing.approve')) {
      throw new ForbiddenException('You do not have access to the finance workspace.');
    }
    const tenantId = tenantOf(actor);
    const day = today();
    const monthStart = `${day.slice(0, 7)}-01`;
    const seeBooks = staffCan(actor, 'finance.ledger');
    const [baseCurrency, accts, balances, month, currencies, settingsRow, queues, recent] = await Promise.all([
      this.ledger.baseCurrency(tenantId),
      this.accounts(tenantId),
      seeBooks ? this.ledger.balances(tenantId) : Promise.resolve(new Map()),
      seeBooks
        ? this.db
            .select({
              currency: journalEntries.currency,
              type: ledgerAccounts.type,
              d: sql<string>`sum(${journalLines.debit})`,
              c: sql<string>`sum(${journalLines.credit})`,
            })
            .from(journalLines)
            .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
            .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
            .where(and(eq(journalLines.tenantId, tenantId), gte(journalEntries.entryDate, monthStart), inArray(ledgerAccounts.type, ['income', 'expense'])))
            .groupBy(journalEntries.currency, ledgerAccounts.type)
        : Promise.resolve([]),
      this.db.selectDistinct({ c: invoices.currency }).from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'issued'))),
      this.db.execute<{ locked: string | null }>(sql`select locked_through::text as locked from finance_settings where tenant_id = ${tenantId}`),
      Promise.all([
        this.db.select({ n: sql<number>`count(*)::int` }).from(paymentSubmissions).where(and(eq(paymentSubmissions.tenantId, tenantId), eq(paymentSubmissions.status, 'pending'))),
        this.db.select({ n: sql<number>`count(*)::int` }).from(refundRequests).where(and(eq(refundRequests.tenantId, tenantId), eq(refundRequests.status, 'pending'))),
        this.db.select({ n: sql<number>`count(*)::int` }).from(invoices).where(and(eq(invoices.tenantId, tenantId), eq(invoices.status, 'pending_approval'))),
        this.db.select({ n: sql<number>`count(*)::int` }).from(bills).where(and(eq(bills.tenantId, tenantId), eq(bills.status, 'open'), sql`${bills.dueDate} < ${day}`)),
        this.db.select({ n: sql<number>`count(*)::int` }).from(bankLines).where(and(eq(bankLines.tenantId, tenantId), isNull(bankLines.matchedLineId))),
      ]),
      seeBooks
        ? this.db.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.tenantId, tenantId)).orderBy(desc(journalEntries.createdAt)).limit(8)
        : Promise.resolve([]),
    ]);
    const receivables = await Promise.all(
      [...new Set([baseCurrency, ...currencies.map((c) => c.c)])].map(async (cur) => {
        const rows = await this.receivablesAging(tenantId, cur);
        const b: AgingBuckets = { currency: cur as Currency, current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90plus: 0, total: 0 };
        for (const r of rows) for (const k of [...BUCKETS, 'total'] as const) b[k] += r.buckets[k];
        return b;
      }),
    );
    const payables = await this.db
      .select({
        currency: bills.currency,
        open: sql<string>`sum(${bills.amount})`,
        overdue: sql<string>`sum(${bills.amount}) filter (where ${bills.dueDate} < ${day})`,
      })
      .from(bills)
      .where(and(eq(bills.tenantId, tenantId), eq(bills.status, 'open')))
      .groupBy(bills.currency);
    const thisMonth = new Map<string, { income: number; expenses: number }>();
    for (const m of month as { currency: string; type: string; d: string; c: string }[]) {
      const x = thisMonth.get(m.currency) ?? { income: 0, expenses: 0 };
      if (m.type === 'income') x.income += Number(m.c) - Number(m.d);
      else x.expenses += Number(m.d) - Number(m.c);
      thisMonth.set(m.currency, x);
    }
    const lockRows = (settingsRow as unknown as { rows?: { locked: string | null }[] }).rows ?? (settingsRow as unknown as { locked: string | null }[]);
    return {
      baseCurrency,
      money: seeBooks
        ? accts
            .filter((a) => a.active && (a.subtype === 'cash' || a.subtype === 'bank' || a.subtype === 'clearing'))
            .map((a) => {
              const v = toAccount(a, balances.get(a.id));
              return { accountId: a.id, name: a.name, subtype: v.subtype!, balances: v.balances };
            })
        : [],
      receivables: receivables.filter((r) => r.total !== 0 || r.currency === baseCurrency),
      payablesDue: payables.map((p) => ({ currency: p.currency as Currency, open: Number(p.open ?? 0), overdue: Number(p.overdue ?? 0) })),
      thisMonth: [...thisMonth.entries()].map(([currency, x]) => ({ currency: currency as Currency, income: x.income, expenses: x.expenses, profit: x.income - x.expenses })),
      queues: {
        proofsToVerify: queues[0][0]?.n ?? 0,
        refundsToApprove: queues[1][0]?.n ?? 0,
        invoicesToApprove: queues[2][0]?.n ?? 0,
        billsOverdue: queues[3][0]?.n ?? 0,
        unmatchedBankLines: queues[4][0]?.n ?? 0,
      },
      lockedThrough: lockRows[0]?.locked ?? null,
      recentEntries: await this.ledger.entries(recent.map((r) => r.id)),
    };
  }

  /* ---------------------------------------------------------------- */
  /* Journal exports for accounting software                           */
  /* ---------------------------------------------------------------- */

  async exportJournal(actor: AuthUser, q: ExportJournalInput): Promise<{ body: string; fileName: string; contentType: string }> {
    this.assertCan(actor);
    if (q.to < q.from) throw new BadRequestException('The period ends before it starts.');
    const tenantId = tenantOf(actor);
    const rows = await this.db
      .select({
        number: journalEntries.number,
        date: journalEntries.entryDate,
        memo: journalEntries.memo,
        currency: journalEntries.currency,
        code: ledgerAccounts.code,
        account: ledgerAccounts.name,
        debit: journalLines.debit,
        credit: journalLines.credit,
        description: journalLines.description,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(
        and(
          eq(journalLines.tenantId, tenantId),
          gte(journalEntries.entryDate, q.from),
          lte(journalEntries.entryDate, q.to),
          q.currency ? eq(journalEntries.currency, q.currency) : undefined,
        ),
      )
      .orderBy(asc(journalEntries.entryDate), asc(journalEntries.number), desc(journalLines.debit))
      .limit(50_000);
    const money = (n: number) => (n / 100).toFixed(2);
    const csv = (cells: (string | number)[]) =>
      cells
        .map((c) => {
          const s = String(c);
          const safe = /^[=+\-@]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
          return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        })
        .join(',');
    const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
    const mdy = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`;
    let body: string;
    let ext = 'csv';
    let contentType = 'text/csv; charset=utf-8';
    if (q.format === 'xero') {
      // Xero's manual journal import: one row per line, debits positive, credits negative.
      body = [csv(['*Narration', '*Date', 'Description', '*AccountCode', '*TaxRate', '*Amount'])]
        .concat(rows.map((r) => csv([`${r.number} ${r.memo}`, dmy(r.date), r.description ?? r.memo, r.code, 'Tax Exempt', money(r.debit - r.credit)])))
        .join('\r\n');
    } else if (q.format === 'quickbooks') {
      // QuickBooks Desktop IIF: one GENERAL JOURNAL transaction per entry.
      ext = 'iif';
      contentType = 'text/plain; charset=utf-8';
      const out = ['!TRNS\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tDOCNUM\tMEMO', '!SPL\tTRNSTYPE\tDATE\tACCNT\tAMOUNT\tDOCNUM\tMEMO', '!ENDTRNS'];
      let current: string | null = null;
      for (const r of rows) {
        const tab = (s: string) => s.replace(/[\t\r\n]/g, ' ');
        const line = ['GENERAL JOURNAL', mdy(r.date), tab(`${r.code} ${r.account}`), money(r.debit - r.credit), r.number, tab(r.description ?? r.memo)].join('\t');
        if (r.number !== current) {
          if (current) out.push('ENDTRNS');
          out.push(`TRNS\t${line}`);
          current = r.number;
        } else out.push(`SPL\t${line}`);
      }
      if (current) out.push('ENDTRNS');
      body = out.join('\r\n');
    } else {
      body = [csv(['Date', 'Entry', 'Memo', 'Account code', 'Account', 'Description', 'Debit', 'Credit', 'Currency'])]
        .concat(rows.map((r) => csv([r.date, r.number, r.memo, r.code, r.account, r.description ?? '', r.debit ? money(r.debit) : '', r.credit ? money(r.credit) : '', r.currency])))
        .join('\r\n');
    }
    await this.audit.record(actor, { action: 'data.exported', entityType: 'export', metadata: { dataset: 'journal', format: q.format, from: q.from, to: q.to, rows: rows.length } });
    return { body: `${q.format === 'quickbooks' ? '' : '﻿'}${body}\r\n`, fileName: `journal-${q.from}-to-${q.to}${q.format === 'csv' ? '' : `-${q.format}`}.${ext}`, contentType };
  }
}

/* ------------------------------------------------------------------ */

/** Adds a titled section of accounts with their values; returns its total. */
function section(
  rows: ReportRow[],
  title: string,
  accts: AccountRow[],
  sums: Sums,
  value: (x: { debit: number; credit: number }) => number,
  withTotal = true,
): number {
  rows.push({ label: title, values: [title, null], emphasis: true });
  let total = 0;
  for (const a of accts) {
    const x = sums.get(a.id);
    if (!x) continue;
    const v = value(x);
    if (v === 0) continue;
    total += v;
    rows.push({ label: a.name, level: 1, code: a.code, accountId: a.id, values: [`${a.code} ${a.name}`, v] });
  }
  if (withTotal) rows.push({ label: `Total ${title.toLowerCase()}`, values: [`Total ${title.toLowerCase()}`, total], emphasis: true });
  return total;
}

function daysLate(due: string, day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86_400_000);
}

function monthsBack(day: string, n: number): string {
  const d = new Date(`${day.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

function monthList(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  const end = to.slice(0, 7);
  for (let i = 0; i < 120; i++) {
    const m = d.toISOString().slice(0, 7);
    if (m > end) break;
    out.push(m);
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function monthLabel(m: string): string {
  return `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}
