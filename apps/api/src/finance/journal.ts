import { BadRequestException } from '@nestjs/common';
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import {
  FEE_CATEGORY_ACCOUNT,
  METHOD_ACCOUNT,
  SYSTEM_ACCOUNTS,
  type FeeCategory,
  type JournalSource,
  type PaymentMethod,
} from '@crm/shared';
import type { Db } from '../db/connection';
import { financeSettings, journalEntries, journalLines, ledgerAccounts } from '../db/schema';

/** A database handle or an open transaction: posting always joins the caller's. */
export type Tx = Pick<Db, 'insert' | 'select' | 'update' | 'execute'>;

export interface PostLine {
  /** A SYSTEM_ACCOUNTS key, or a specific account by id. */
  account: string | { id: string };
  debit?: number;
  credit?: number;
  description?: string | null;
  clientId?: string | null;
}

export interface PostInput {
  tenantId: string;
  date: string;
  memo: string;
  currency: string;
  fxRate?: number | string | null;
  sourceType: JournalSource;
  sourceId?: string | null;
  reversalOf?: string | null;
  createdBy?: string | null;
  lines: PostLine[];
}

/**
 * The tenant's system account ids, by key. System accounts are never deleted
 * (only switched off), so a key always resolves to the same id and the map
 * can be kept for the life of the process.
 */
const systemIds = new Map<string, Map<string, string>>();

export async function systemAccountIds(tx: Tx, tenantId: string): Promise<Map<string, string>> {
  const cached = systemIds.get(tenantId);
  if (cached && cached.size >= SYSTEM_ACCOUNTS.length) return cached;
  const read = () =>
    tx
      .select({ id: ledgerAccounts.id, key: ledgerAccounts.systemKey })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.tenantId, tenantId), isNotNull(ledgerAccounts.systemKey)));
  let rows = await read();
  // A consultancy created some other way than onboarding (a script, a
  // restore) gets its chart of accounts the first time anything is posted.
  if (rows.length < SYSTEM_ACCOUNTS.length) {
    await seedLedger(tx, tenantId);
    rows = await read();
  }
  const map = new Map(rows.map((r) => [r.key!, r.id]));
  systemIds.set(tenantId, map);
  return map;
}

export async function systemAccountId(tx: Tx, tenantId: string, key: string): Promise<string> {
  const id = (await systemAccountIds(tx, tenantId)).get(key);
  if (!id) throw new Error(`Ledger account "${key}" is missing for this consultancy`);
  return id;
}

/** "The books are closed up to ..." as a readable refusal, before the trigger says it less kindly. */
export async function assertPeriodOpen(tx: Tx, tenantId: string, date: string): Promise<void> {
  const [s] = await tx
    .select({ lockedThrough: financeSettings.lockedThrough })
    .from(financeSettings)
    .where(eq(financeSettings.tenantId, tenantId))
    .limit(1);
  if (s?.lockedThrough && date <= s.lockedThrough) {
    throw new BadRequestException({
      message: `The books are closed up to ${s.lockedThrough}. Date it after that, or ask a manager to reopen the period.`,
      code: 'PERIOD_LOCKED',
    });
  }
}

/**
 * Posts one balanced entry in the caller's transaction and returns its id -
 * or null when every line is zero (an invoice for nothing posts nothing).
 * Lines to the same account and side are merged. The database refuses an
 * entry that does not balance, any later change to it, and any date inside
 * a locked period; this checks the first two first, to fail with a reason.
 */
export async function postEntry(tx: Tx, input: PostInput): Promise<string | null> {
  const ids = await systemAccountIds(tx, input.tenantId);
  const merged = new Map<string, { accountId: string; debit: number; credit: number; description: string | null; clientId: string | null }>();
  for (const l of input.lines) {
    const debit = Math.round(l.debit ?? 0);
    const credit = Math.round(l.credit ?? 0);
    if (debit < 0 || credit < 0) throw new Error('Journal amounts are never negative; swap the side instead');
    if (debit === 0 && credit === 0) continue;
    const accountId = typeof l.account === 'string' ? ids.get(l.account) : l.account.id;
    if (!accountId) throw new Error(`Ledger account "${String(l.account)}" is missing for this consultancy`);
    const side = debit > 0 ? 'd' : 'c';
    const key = `${accountId}:${side}:${l.clientId ?? ''}:${l.description ?? ''}`;
    const prev = merged.get(key);
    if (prev) {
      prev.debit += debit;
      prev.credit += credit;
    } else merged.set(key, { accountId, debit, credit, description: l.description ?? null, clientId: l.clientId ?? null });
  }
  const lines = [...merged.values()];
  if (lines.length === 0) return null;
  const debits = lines.reduce((n, l) => n + l.debit, 0);
  const credits = lines.reduce((n, l) => n + l.credit, 0);
  if (debits !== credits) throw new Error(`Unbalanced entry "${input.memo}": debits ${debits}, credits ${credits}`);

  await assertPeriodOpen(tx, input.tenantId, input.date);

  // The next number, taken under the settings row's lock for this transaction.
  const [seq] = await tx
    .insert(financeSettings)
    .values({ tenantId: input.tenantId, journalSeq: 1 })
    .onConflictDoUpdate({ target: financeSettings.tenantId, set: { journalSeq: sql`${financeSettings.journalSeq} + 1` } })
    .returning({ n: financeSettings.journalSeq });

  const [entry] = await tx
    .insert(journalEntries)
    .values({
      tenantId: input.tenantId,
      number: `JE-${String(seq!.n).padStart(6, '0')}`,
      entryDate: input.date,
      memo: input.memo.slice(0, 300),
      currency: input.currency,
      fxRate: input.fxRate === null || input.fxRate === undefined ? null : String(input.fxRate),
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      reversalOf: input.reversalOf ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning({ id: journalEntries.id });
  await tx.insert(journalLines).values(lines.map((l) => ({ tenantId: input.tenantId, entryId: entry!.id, ...l })));
  return entry!.id;
}

/**
 * Undoes an entry by posting its mirror image, dated `date` (today, normally:
 * the correction happens now, even when the original sits in a closed
 * period). An entry can be reversed once; the unique index enforces it.
 */
export async function reverseEntry(
  tx: Tx,
  entryId: string,
  opts: { date: string; memo: string; sourceType: JournalSource; createdBy?: string | null },
): Promise<string | null> {
  const [entry] = await tx.select().from(journalEntries).where(eq(journalEntries.id, entryId)).limit(1);
  if (!entry) return null;
  const [already] = await tx.select({ id: journalEntries.id }).from(journalEntries).where(eq(journalEntries.reversalOf, entryId)).limit(1);
  if (already) throw new BadRequestException('That entry has already been reversed.');
  const lines = await tx.select().from(journalLines).where(eq(journalLines.entryId, entryId));
  return postEntry(tx, {
    tenantId: entry.tenantId,
    date: opts.date,
    memo: opts.memo,
    currency: entry.currency,
    fxRate: entry.fxRate,
    sourceType: opts.sourceType,
    sourceId: entry.sourceId,
    reversalOf: entry.id,
    createdBy: opts.createdBy ?? null,
    lines: lines.map((l) => ({ account: { id: l.accountId }, debit: l.credit, credit: l.debit, description: l.description, clientId: l.clientId })),
  });
}

/** The live (not reversed) entry a document posted, if any. */
export async function liveEntryFor(tx: Tx, tenantId: string, sourceType: JournalSource, sourceId: string): Promise<string | null> {
  const rows = await tx
    .select({ id: journalEntries.id })
    .from(journalEntries)
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        eq(journalEntries.sourceType, sourceType),
        eq(journalEntries.sourceId, sourceId),
        sql`not exists (select 1 from journal_entries r where r.reversal_of = ${journalEntries.id})`,
      ),
    )
    .limit(1);
  return rows[0]?.id ?? null;
}

/* ------------------------------------------------------------------ */
/* What each document posts                                            */
/* ------------------------------------------------------------------ */

export interface InvoiceForPosting {
  id: string;
  tenantId: string;
  number: string;
  clientId: string;
  currency: string;
  issueDate: string;
  total: number;
  fxRate: string | number | null;
  items: { category: string; amount: number; discount: number; taxAmount: number; taxInclusive: boolean }[];
}

/**
 * An invoice: the student owes the total (receivable); each line's net goes
 * to its fee's revenue account - or to disbursements, which are not revenue -
 * and the tax to tax payable.
 */
export function invoiceLines(inv: InvoiceForPosting): PostLine[] {
  const lines: PostLine[] = [{ account: 'receivable', debit: inv.total, clientId: inv.clientId }];
  let tax = 0;
  for (const it of inv.items) {
    const priced = it.amount - it.discount;
    const net = it.taxInclusive ? priced - it.taxAmount : priced;
    tax += it.taxAmount;
    lines.push({ account: FEE_CATEGORY_ACCOUNT[(it.category as FeeCategory) ?? 'service'] ?? 'fees_service', credit: net });
  }
  if (tax > 0) lines.push({ account: 'tax_payable', credit: tax });
  return lines;
}

export async function postInvoice(tx: Tx, inv: InvoiceForPosting, createdBy: string | null): Promise<string | null> {
  return postEntry(tx, {
    tenantId: inv.tenantId,
    date: inv.issueDate,
    memo: `Invoice ${inv.number}`,
    currency: inv.currency,
    fxRate: inv.fxRate,
    sourceType: 'invoice',
    sourceId: inv.id,
    createdBy,
    lines: invoiceLines(inv),
  });
}

export interface PaymentForPosting {
  id: string;
  tenantId: string;
  number: string;
  kind: 'payment' | 'refund';
  clientId: string;
  currency: string;
  amount: number;
  receivedOn: string;
  accountId: string | null;
  method: PaymentMethod;
  fxRate: string | number | null;
}

/** Money in: the account it landed in up, the student's debt down. A refund the other way. */
export async function postPayment(tx: Tx, p: PaymentForPosting, createdBy: string | null): Promise<string | null> {
  const money: PostLine['account'] = p.accountId ? { id: p.accountId } : METHOD_ACCOUNT[p.method];
  const lines: PostLine[] =
    p.kind === 'payment'
      ? [
          { account: money, debit: p.amount },
          { account: 'receivable', credit: p.amount, clientId: p.clientId },
        ]
      : [
          { account: 'receivable', debit: p.amount, clientId: p.clientId },
          { account: money, credit: p.amount },
        ];
  return postEntry(tx, {
    tenantId: p.tenantId,
    date: p.receivedOn,
    memo: `${p.kind === 'payment' ? 'Payment' : 'Refund'} ${p.number}`,
    currency: p.currency,
    fxRate: p.fxRate,
    sourceType: 'payment',
    sourceId: p.id,
    createdBy,
    lines,
  });
}

/**
 * A credit note gives back part of an invoice: the student owes less; the
 * revenue it reverses is shown as "Discounts and credit notes" (so income
 * reports keep both numbers), a disbursement share goes back to
 * disbursements, and the tax share comes off tax payable.
 */
export function creditNoteLines(
  amount: number,
  taxAmount: number,
  clientId: string,
  invoiceItems: { category: string; amount: number; discount: number; taxAmount: number; taxInclusive: boolean }[],
): PostLine[] {
  const nets = invoiceItems.map((it) => {
    const priced = it.amount - it.discount;
    return { category: it.category, net: it.taxInclusive ? priced - it.taxAmount : priced };
  });
  const base = nets.reduce((n, x) => n + x.net, 0);
  const net = amount - taxAmount;
  const disbursementNet = nets.filter((x) => x.category === 'disbursement').reduce((n, x) => n + x.net, 0);
  const toDisbursements = base > 0 ? Math.round((net * disbursementNet) / base) : 0;
  return [
    { account: 'sales_returns', debit: net - toDisbursements },
    { account: 'disbursements', debit: toDisbursements },
    { account: 'tax_payable', debit: taxAmount },
    { account: 'receivable', credit: amount, clientId },
  ];
}

/* ------------------------------------------------------------------ */
/* A new consultancy                                                    */
/* ------------------------------------------------------------------ */

/** The chart of accounts and finance settings a consultancy starts with. Idempotent. */
export async function seedLedger(tx: Pick<Db, 'insert' | 'select'>, tenantId: string): Promise<void> {
  await tx.insert(financeSettings).values({ tenantId }).onConflictDoNothing();
  const existing = await tx
    .select({ key: ledgerAccounts.systemKey, code: ledgerAccounts.code })
    .from(ledgerAccounts)
    .where(eq(ledgerAccounts.tenantId, tenantId));
  const keys = new Set(existing.map((e) => e.key));
  const codes = new Set(existing.map((e) => e.code));
  const missing = SYSTEM_ACCOUNTS.filter((a) => !keys.has(a.key) && !codes.has(a.code));
  if (missing.length) {
    await tx.insert(ledgerAccounts).values(
      missing.map((a) => ({
        tenantId,
        systemKey: a.key,
        code: a.code,
        name: a.name,
        type: a.type,
        subtype: a.subtype ?? null,
        description: a.description || null,
      })),
    );
  }
  systemIds.delete(tenantId);
}

/** Money accounts (cash, bank, online) of this consultancy, by id - for checking a picked account. */
export async function assertMoneyAccount(tx: Tx, tenantId: string, accountId: string): Promise<void> {
  const [row] = await tx
    .select({ id: ledgerAccounts.id })
    .from(ledgerAccounts)
    .where(
      and(
        eq(ledgerAccounts.id, accountId),
        eq(ledgerAccounts.tenantId, tenantId),
        eq(ledgerAccounts.active, true),
        inArray(ledgerAccounts.subtype, ['cash', 'bank', 'clearing']),
      ),
    )
    .limit(1);
  if (!row) {
    throw new BadRequestException({
      message: 'Pick one of your cash, bank or online accounts.',
      fieldErrors: { accountId: 'Not one of your cash, bank or online accounts.' },
    });
  }
}
