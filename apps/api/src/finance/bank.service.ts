import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { createHash } from 'node:crypto';
import {
  bankEntrySchema,
  bankImportSchema,
  dayCloseSchema,
  parseBankStatement,
  type AuthUser,
  type BankAccountView,
  type BankEntryInput,
  type BankImportInput,
  type BankLineView,
  type Currency,
  type DayCloseInput,
  type DayCloseView,
  type UnmatchedLedgerLine,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { bankImports, bankLines, dayCloses, journalEntries, journalLines, ledgerAccounts, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { staffCan } from '../auth/permissions';
import { iso, today } from '../common/db-helpers';
import { postEntry } from './journal';
import { LedgerService } from './ledger.service';

/** How far apart (days) a statement line and a ledger line may be and still look alike. */
const MATCH_WINDOW_DAYS = 5;

/**
 * Bank reconciliation and the cash drawer. A statement (CSV, mapped column
 * by column) is imported against one of the consultancy's bank accounts;
 * each statement line is then matched to the ledger line it is - or turned
 * into an entry (bank charges, interest) - until the books and the bank
 * agree. Cash is counted at the end of the day against what the books say.
 */
@Injectable()
export class BankService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
  ) {}

  private assertCan(actor: AuthUser): void {
    if (!staffCan(actor, 'finance.ledger')) throw new ForbiddenException('You do not have permission to work on the books.');
  }

  private async moneyAccount(tenantId: string, id: string) {
    const [a] = await this.db
      .select()
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.id, id), eq(ledgerAccounts.tenantId, tenantId), inArray(ledgerAccounts.subtype, ['cash', 'bank', 'clearing'])))
      .limit(1);
    if (!a) throw new NotFoundException('Not one of your cash, bank or online accounts.');
    return a;
  }

  async view(actor: AuthUser, accountId: string, currencyRaw?: string): Promise<BankAccountView> {
    this.assertCan(actor);
    const tenantId = tenantOf(actor);
    const account = await this.ledger.account(actor, accountId);
    if (!account.subtype || !['cash', 'bank', 'clearing'].includes(account.subtype)) throw new NotFoundException('Not a bank account.');
    const currency = (currencyRaw ?? account.currency ?? account.balances[0]?.currency ?? (await this.ledger.baseCurrency(tenantId))) as Currency;
    const ledgerBalance = account.balances.find((b) => b.currency === currency)?.balance ?? 0;
    const importer = alias(users, 'importer');
    const [lines, ledgerLines, reconciled, imports] = await Promise.all([
      this.db
        .select({ b: bankLines, number: journalEntries.number, memo: journalEntries.memo })
        .from(bankLines)
        .leftJoin(journalLines, eq(journalLines.id, bankLines.matchedLineId))
        .leftJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .where(and(eq(bankLines.tenantId, tenantId), eq(bankLines.accountId, accountId)))
        .orderBy(desc(bankLines.lineDate), desc(bankLines.createdAt))
        .limit(1000),
      this.db
        .select({ id: journalLines.id, number: journalEntries.number, date: journalEntries.entryDate, memo: journalEntries.memo, debit: journalLines.debit, credit: journalLines.credit })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .where(
          and(
            eq(journalLines.tenantId, tenantId),
            eq(journalLines.accountId, accountId),
            eq(journalEntries.currency, currency),
            sql`not exists (select 1 from bank_lines b where b.matched_line_id = ${journalLines.id})`,
          ),
        )
        .orderBy(desc(journalEntries.entryDate))
        .limit(500),
      this.db
        .select({ n: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .innerJoin(bankLines, eq(bankLines.matchedLineId, journalLines.id))
        .where(and(eq(journalLines.accountId, accountId), eq(journalEntries.currency, currency))),
      this.db
        .select({ id: bankImports.id, fileName: bankImports.fileName, lineCount: bankImports.lineCount, createdAt: bankImports.createdAt, importedByName: importer.fullName })
        .from(bankImports)
        .leftJoin(importer, eq(importer.id, bankImports.importedBy))
        .where(and(eq(bankImports.tenantId, tenantId), eq(bankImports.accountId, accountId)))
        .orderBy(desc(bankImports.createdAt))
        .limit(20),
    ]);
    const toLine = (r: (typeof lines)[number]): BankLineView => ({
      id: r.b.id,
      lineDate: r.b.lineDate,
      description: r.b.description,
      reference: r.b.reference,
      amount: r.b.amount,
      matchedLineId: r.b.matchedLineId,
      matchedEntryNumber: r.number,
      matchedMemo: r.memo,
      matchedAt: r.b.matchedAt ? iso(r.b.matchedAt) : null,
    });
    const unmatchedBank = lines.filter((l) => !l.b.matchedLineId).map(toLine);
    const unmatchedLedger: UnmatchedLedgerLine[] = ledgerLines.map((l) => ({ lineId: l.id, entryNumber: l.number, entryDate: l.date, memo: l.memo, amount: l.debit - l.credit }));
    const suggestions: Record<string, string[]> = {};
    for (const b of unmatchedBank) {
      const near = unmatchedLedger
        .filter((l) => l.amount === b.amount && Math.abs(daysBetween(l.entryDate, b.lineDate)) <= MATCH_WINDOW_DAYS)
        .sort((x, y) => Math.abs(daysBetween(x.entryDate, b.lineDate)) - Math.abs(daysBetween(y.entryDate, b.lineDate)))
        .map((l) => l.lineId);
      if (near.length) suggestions[b.id] = near.slice(0, 3);
    }
    return {
      account,
      currency,
      ledgerBalance,
      reconciledBalance: Number(reconciled[0]?.n ?? 0),
      statementTotal: lines.reduce((n, l) => n + l.b.amount, 0),
      unmatchedBank,
      unmatchedLedger,
      matched: lines.filter((l) => l.b.matchedLineId).slice(0, 50).map(toLine),
      suggestions,
      imports: imports.map((i) => ({ ...i, createdAt: iso(i.createdAt) })),
    };
  }

  async import(actor: AuthUser, accountId: string, raw: BankImportInput): Promise<{ imported: number; duplicates: number; errors: { row: number; message: string }[] }> {
    this.assertCan(actor);
    const input = bankImportSchema.parse(raw);
    const tenantId = tenantOf(actor);
    await this.moneyAccount(tenantId, accountId);
    const { lines, errors } = parseBankStatement(input);
    if (!lines.length) {
      throw new BadRequestException({
        message: errors.length ? `Nothing could be read. Row ${errors[0]!.row}: ${errors[0]!.message}.` : 'The file has no money lines.',
        fieldErrors: { csv: 'Check the column choices and the date format' },
      });
    }
    // The same line twice in one statement is two real payments; the same
    // line in a statement imported again is not.
    const seen = new Map<string, number>();
    const rows = lines.map((l) => {
      const base = `${l.date}|${l.amount}|${l.description.toLowerCase()}|${l.reference ?? ''}`;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { ...l, fingerprint: createHash('sha256').update(`${base}|${n}`).digest('hex').slice(0, 40) };
    });
    const result = await this.db.transaction(async (tx) => {
      const [imp] = await tx.insert(bankImports).values({ tenantId, accountId, fileName: input.fileName, lineCount: 0, importedBy: actor.id }).returning();
      const inserted = await tx
        .insert(bankLines)
        .values(rows.map((l) => ({ tenantId, accountId, importId: imp!.id, lineDate: l.date, description: l.description || '(no description)', reference: l.reference, amount: l.amount, fingerprint: l.fingerprint })))
        .onConflictDoNothing()
        .returning({ id: bankLines.id });
      await tx.update(bankImports).set({ lineCount: inserted.length }).where(eq(bankImports.id, imp!.id));
      return { imported: inserted.length, duplicates: rows.length - inserted.length, importId: imp!.id };
    });
    await this.audit.record(actor, {
      action: 'bank.imported',
      entityType: 'bank_import',
      entityId: result.importId,
      metadata: { account: accountId, file: input.fileName, imported: result.imported, duplicates: result.duplicates, unreadable: errors.length },
    });
    return { imported: result.imported, duplicates: result.duplicates, errors: errors.slice(0, 20) };
  }

  async match(actor: AuthUser, bankLineId: string, journalLineId: string): Promise<void> {
    this.assertCan(actor);
    const tenantId = tenantOf(actor);
    const [b] = await this.db.select().from(bankLines).where(and(eq(bankLines.id, bankLineId), eq(bankLines.tenantId, tenantId))).limit(1);
    if (!b) throw new NotFoundException('Statement line not found.');
    if (b.matchedLineId) throw new BadRequestException('That statement line is already matched.');
    const [l] = await this.db.select().from(journalLines).where(and(eq(journalLines.id, journalLineId), eq(journalLines.tenantId, tenantId))).limit(1);
    if (!l || l.accountId !== b.accountId) throw new BadRequestException('That ledger line is not on this account.');
    if (l.debit - l.credit !== b.amount) throw new BadRequestException('The amounts differ. Match lines for the same amount, or make an entry for the difference.');
    try {
      const [done] = await this.db
        .update(bankLines)
        .set({ matchedLineId: journalLineId, matchedBy: actor.id, matchedAt: new Date() })
        .where(and(eq(bankLines.id, bankLineId), isNull(bankLines.matchedLineId)))
        .returning({ id: bankLines.id });
      if (!done) throw new BadRequestException('That statement line is already matched.');
    } catch (err) {
      if ((err as { code?: string; cause?: { code?: string } }).code === '23505' || (err as { cause?: { code?: string } }).cause?.code === '23505') {
        throw new BadRequestException('That ledger line is already matched to another statement line.');
      }
      throw err;
    }
    await this.audit.record(actor, { action: 'bank.matched', entityType: 'bank', entityId: bankLineId, metadata: { journalLine: journalLineId, amount: b.amount } });
  }

  async unmatch(actor: AuthUser, bankLineId: string): Promise<void> {
    this.assertCan(actor);
    const [done] = await this.db
      .update(bankLines)
      .set({ matchedLineId: null, matchedBy: null, matchedAt: null })
      .where(and(eq(bankLines.id, bankLineId), eq(bankLines.tenantId, tenantOf(actor)), isNotNull(bankLines.matchedLineId)))
      .returning({ id: bankLines.id });
    if (!done) throw new NotFoundException('That statement line is not matched.');
    await this.audit.record(actor, { action: 'bank.unmatched', entityType: 'bank', entityId: bankLineId });
  }

  /**
   * A line only the bank knew about - charges, interest, a transfer the
   * owner made - booked straight from the statement and matched to it.
   */
  async entryFromLine(actor: AuthUser, bankLineId: string, raw: BankEntryInput): Promise<void> {
    this.assertCan(actor);
    const input = bankEntrySchema.parse(raw);
    const tenantId = tenantOf(actor);
    const [b] = await this.db.select().from(bankLines).where(and(eq(bankLines.id, bankLineId), eq(bankLines.tenantId, tenantId))).limit(1);
    if (!b) throw new NotFoundException('Statement line not found.');
    if (b.matchedLineId) throw new BadRequestException('That statement line is already matched.');
    const [other] = await this.db
      .select()
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.id, input.accountId), eq(ledgerAccounts.tenantId, tenantId), eq(ledgerAccounts.active, true)))
      .limit(1);
    if (!other || other.id === b.accountId) throw new BadRequestException({ message: 'Pick the account on the other side.', fieldErrors: { accountId: 'Pick another account' } });
    const bankAccount = await this.moneyAccount(tenantId, b.accountId);
    const base = await this.ledger.baseCurrency(tenantId);
    const currency = bankAccount.currency ?? base;
    const amount = Math.abs(b.amount);
    // Inside the transaction only `tx` may be used: the development database
    // has one connection, and a query on `this.db` there would wait for ever.
    await this.db.transaction(async (tx) => {
      const entryId = await postEntry(tx, {
        tenantId,
        date: b.lineDate,
        memo: input.memo,
        currency,
        fxRate: currency === base ? 1 : null,
        sourceType: 'bank',
        sourceId: b.id,
        createdBy: actor.id,
        lines:
          b.amount > 0
            ? [
                { account: { id: b.accountId }, debit: amount, description: b.description },
                { account: { id: other.id }, credit: amount, description: b.description },
              ]
            : [
                { account: { id: other.id }, debit: amount, description: b.description },
                { account: { id: b.accountId }, credit: amount, description: b.description },
              ],
      });
      const [bankSide] = await tx
        .select({ id: journalLines.id })
        .from(journalLines)
        .where(and(eq(journalLines.entryId, entryId!), eq(journalLines.accountId, b.accountId)))
        .limit(1);
      await tx.update(bankLines).set({ matchedLineId: bankSide!.id, matchedBy: actor.id, matchedAt: new Date() }).where(eq(bankLines.id, b.id));
    });
    await this.audit.record(actor, { action: 'journal.posted', entityType: 'bank', entityId: bankLineId, metadata: { memo: input.memo, amount: b.amount, account: other.name } });
  }

  /** Removes an import that went wrong - only while none of its lines is matched. */
  async removeImport(actor: AuthUser, importId: string): Promise<void> {
    this.assertCan(actor);
    const tenantId = tenantOf(actor);
    const [imp] = await this.db.select().from(bankImports).where(and(eq(bankImports.id, importId), eq(bankImports.tenantId, tenantId))).limit(1);
    if (!imp) throw new NotFoundException('Import not found.');
    const [matched] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(bankLines)
      .where(and(eq(bankLines.importId, importId), isNotNull(bankLines.matchedLineId)));
    if ((matched?.n ?? 0) > 0) throw new BadRequestException('Some of its lines are matched. Unmatch them first.');
    await this.db.delete(bankImports).where(eq(bankImports.id, importId));
    await this.audit.record(actor, { action: 'bank.unmatched', entityType: 'bank_import', entityId: importId, metadata: { removed: true, file: imp.fileName, lines: imp.lineCount } });
  }

  /* ---------------------------------------------------------------- */
  /* Counting the cash                                                 */
  /* ---------------------------------------------------------------- */

  async dayCloses(actor: AuthUser, accountId?: string): Promise<DayCloseView[]> {
    this.assertCan(actor);
    const closer = alias(users, 'closer');
    const rows = await this.db
      .select({ d: dayCloses, accountName: ledgerAccounts.name, closedByName: closer.fullName })
      .from(dayCloses)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, dayCloses.accountId))
      .leftJoin(closer, eq(closer.id, dayCloses.closedBy))
      .where(and(eq(dayCloses.tenantId, tenantOf(actor)), accountId ? eq(dayCloses.accountId, accountId) : undefined))
      .orderBy(desc(dayCloses.closeDate), asc(ledgerAccounts.code))
      .limit(120);
    return rows.map((r) => ({
      id: r.d.id,
      date: r.d.closeDate,
      accountId: r.d.accountId,
      accountName: r.accountName,
      currency: r.d.currency as Currency,
      expected: r.d.expected,
      counted: r.d.counted,
      difference: r.d.counted - r.d.expected,
      note: r.d.note,
      closedByName: r.closedByName,
      createdAt: iso(r.d.createdAt),
    }));
  }

  /** What the books say should be in the drawer at the end of a day. */
  async expectedCash(actor: AuthUser, accountId: string, date: string, currency: string): Promise<number> {
    this.assertCan(actor);
    const tenantId = tenantOf(actor);
    await this.moneyAccount(tenantId, accountId);
    const [r] = await this.db
      .select({ n: sql<string>`coalesce(sum(${journalLines.debit} - ${journalLines.credit}), 0)` })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(and(eq(journalLines.accountId, accountId), eq(journalEntries.currency, currency), lte(journalEntries.entryDate, date)));
    return Number(r?.n ?? 0);
  }

  async closeDay(actor: AuthUser, raw: DayCloseInput): Promise<DayCloseView> {
    this.assertCan(actor);
    const input = dayCloseSchema.parse(raw);
    const tenantId = tenantOf(actor);
    if (input.date > today()) throw new BadRequestException({ message: 'That day has not happened yet.', fieldErrors: { date: 'Today or earlier' } });
    const account = await this.moneyAccount(tenantId, input.accountId);
    const expected = await this.expectedCash(actor, input.accountId, input.date, input.currency);
    const difference = input.counted - expected;
    const base = await this.ledger.baseCurrency(tenantId);
    const row = await this.db
      .transaction(async (tx) => {
        let entryId: string | null = null;
        if (difference !== 0 && input.postDifference) {
          entryId = await postEntry(tx, {
            tenantId,
            date: input.date,
            memo: `Cash count ${input.date}, ${account.name}: ${difference > 0 ? 'over' : 'short'}`,
            currency: input.currency,
            fxRate: input.currency === base ? 1 : null,
            sourceType: 'cash_count',
            createdBy: actor.id,
            lines:
              difference > 0
                ? [
                    { account: { id: account.id }, debit: difference },
                    { account: 'cash_over_short', credit: difference },
                  ]
                : [
                    { account: 'cash_over_short', debit: -difference },
                    { account: { id: account.id }, credit: -difference },
                  ],
          });
        }
        const [d] = await tx
          .insert(dayCloses)
          .values({ tenantId, accountId: account.id, closeDate: input.date, currency: input.currency, expected, counted: input.counted, note: input.note, entryId, closedBy: actor.id })
          .returning();
        return d!;
      })
      .catch((err: unknown) => {
        const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
        if (code === '23505') throw new BadRequestException({ message: 'That day is already closed for this account.', fieldErrors: { date: 'Already counted' } });
        throw err;
      });
    await this.audit.record(actor, {
      action: 'journal.posted',
      entityType: 'day_close',
      entityId: row.id,
      metadata: { date: input.date, account: account.name, expected, counted: input.counted, difference },
    });
    return (await this.dayCloses(actor, input.accountId)).find((d) => d.id === row.id)!;
  }
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}
