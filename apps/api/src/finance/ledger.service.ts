import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  NORMAL_BALANCE,
  ledgerAccountSchema,
  manualJournalSchema,
  type AccountBalance,
  type AccountSubtype,
  type AccountType,
  type AuthUser,
  type Currency,
  type GeneralLedgerView,
  type JournalEntryView,
  type JournalQuery,
  type JournalSource,
  type LedgerAccountInput,
  type LedgerAccountView,
  type ManualJournalInput,
  type Paginated,
} from '@crm/shared';
import { DB } from '../db/database.module';
import type { Db } from '../db/connection';
import { bankLines, clients, journalEntries, journalLines, ledgerAccounts, users } from '../db/schema';
import { AuditService } from '../audit/audit.service';
import { tenantOf } from '../tenancy/tenant-resolver.service';
import { iso, isUniqueViolation, page, today } from '../common/db-helpers';
import { postEntry, reverseEntry, systemAccountIds } from './journal';

type AccountRow = typeof ledgerAccounts.$inferSelect;

/** Balances per account and currency: (accountId -> currency -> sums). */
export type BalanceMap = Map<string, Map<string, { debit: number; credit: number }>>;

/**
 * The books: accounts, the journal, one account's ledger, and the entries
 * an accountant makes by hand. Everything here reads the journal the
 * invoices, payments, expenses and bills post to - it never computes money
 * any other way.
 */
@Injectable()
export class LedgerService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  /* ---------------------------------------------------------------- */
  /* Accounts                                                          */
  /* ---------------------------------------------------------------- */

  async accounts(actor: AuthUser, opts: { includeInactive?: boolean; asOf?: string } = {}): Promise<LedgerAccountView[]> {
    const tenantId = tenantOf(actor);
    await systemAccountIds(this.db, tenantId);
    const [rows, balances] = await Promise.all([
      this.db
        .select()
        .from(ledgerAccounts)
        .where(and(eq(ledgerAccounts.tenantId, tenantId), opts.includeInactive ? undefined : eq(ledgerAccounts.active, true)))
        .orderBy(asc(ledgerAccounts.code)),
      this.balances(tenantId, { to: opts.asOf }),
    ]);
    return rows.map((r) => toAccount(r, balances.get(r.id)));
  }

  async account(actor: AuthUser, id: string): Promise<LedgerAccountView> {
    const tenantId = tenantOf(actor);
    const [row] = await this.db.select().from(ledgerAccounts).where(and(eq(ledgerAccounts.id, id), eq(ledgerAccounts.tenantId, tenantId))).limit(1);
    if (!row) throw new NotFoundException('Account not found.');
    const balances = await this.balances(tenantId, { accountIds: [id] });
    return toAccount(row, balances.get(id));
  }

  async saveAccount(actor: AuthUser, raw: LedgerAccountInput, id?: string): Promise<LedgerAccountView> {
    const input = ledgerAccountSchema.parse(raw);
    const tenantId = tenantOf(actor);
    try {
      let row: AccountRow | undefined;
      if (id) {
        const [current] = await this.db.select().from(ledgerAccounts).where(and(eq(ledgerAccounts.id, id), eq(ledgerAccounts.tenantId, tenantId))).limit(1);
        if (!current) throw new NotFoundException('Account not found.');
        // The system posts to its own accounts by what they are, so what they
        // are cannot change - only their name, code, notes and whether they show.
        if (current.systemKey && (input.type !== current.type || (input.subtype ?? null) !== current.subtype)) {
          throw new BadRequestException('This account is one the system posts to; its type cannot change. Rename it, or add a new account.');
        }
        if (!current.systemKey && input.type !== current.type) {
          const [used] = await this.db.select({ n: sql<number>`count(*)::int` }).from(journalLines).where(eq(journalLines.accountId, id));
          if ((used?.n ?? 0) > 0) throw new BadRequestException('This account has entries, so its type cannot change.');
        }
        if (current.systemKey && !input.active && ['receivable', 'tax_payable', 'payable', 'sales_returns'].includes(current.systemKey)) {
          throw new BadRequestException('The system needs this account; it cannot be switched off.');
        }
        [row] = await this.db
          .update(ledgerAccounts)
          .set({
            code: input.code,
            name: input.name,
            type: input.type,
            subtype: input.subtype ?? null,
            currency: input.currency ?? null,
            description: input.description,
            active: input.active,
            updatedAt: new Date(),
          })
          .where(and(eq(ledgerAccounts.id, id), eq(ledgerAccounts.tenantId, tenantId)))
          .returning();
      } else {
        [row] = await this.db
          .insert(ledgerAccounts)
          .values({
            tenantId,
            code: input.code,
            name: input.name,
            type: input.type,
            subtype: input.subtype ?? null,
            currency: input.currency ?? null,
            description: input.description,
            active: input.active,
          })
          .returning();
      }
      await this.audit.record(actor, {
        action: 'finance.settings_changed',
        entityType: 'ledger_account',
        entityId: row!.id,
        metadata: { account: `${row!.code} ${row!.name}`, type: row!.type, subtype: row!.subtype, active: row!.active },
      });
      return this.account(actor, row!.id);
    } catch (err) {
      if (isUniqueViolation(err)) throw new BadRequestException({ message: 'Another account already has that code.', fieldErrors: { code: 'Already used' } });
      throw err;
    }
  }

  /**
   * Debits and credits per account and currency, optionally within dates.
   * One grouped query - the basis of every balance and report.
   */
  async balances(
    tenantId: string,
    opts: { from?: string; to?: string; before?: string; accountIds?: string[]; currency?: string } = {},
  ): Promise<BalanceMap> {
    const conds: (SQL | undefined)[] = [eq(journalLines.tenantId, tenantId)];
    if (opts.from) conds.push(gte(journalEntries.entryDate, opts.from));
    if (opts.to) conds.push(lte(journalEntries.entryDate, opts.to));
    if (opts.before) conds.push(lt(journalEntries.entryDate, opts.before));
    if (opts.accountIds?.length) conds.push(inArray(journalLines.accountId, opts.accountIds));
    if (opts.currency) conds.push(eq(journalEntries.currency, opts.currency));
    const rows = await this.db
      .select({
        accountId: journalLines.accountId,
        currency: journalEntries.currency,
        debit: sql<string>`sum(${journalLines.debit})`,
        credit: sql<string>`sum(${journalLines.credit})`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .where(and(...conds))
      .groupBy(journalLines.accountId, journalEntries.currency);
    const map: BalanceMap = new Map();
    for (const r of rows) {
      const per = map.get(r.accountId) ?? new Map();
      per.set(r.currency, { debit: Number(r.debit), credit: Number(r.credit) });
      map.set(r.accountId, per);
    }
    return map;
  }

  /* ---------------------------------------------------------------- */
  /* The journal                                                       */
  /* ---------------------------------------------------------------- */

  async journal(actor: AuthUser, query: JournalQuery): Promise<Paginated<JournalEntryView>> {
    const tenantId = tenantOf(actor);
    const conds: (SQL | undefined)[] = [eq(journalEntries.tenantId, tenantId)];
    if (query.from) conds.push(gte(journalEntries.entryDate, query.from));
    if (query.to) conds.push(lte(journalEntries.entryDate, query.to));
    if (query.sourceType) conds.push(eq(journalEntries.sourceType, query.sourceType));
    if (query.currency) conds.push(eq(journalEntries.currency, query.currency));
    if (query.accountId) {
      conds.push(sql`exists (select 1 from journal_lines jl where jl.entry_id = ${journalEntries.id} and jl.account_id = ${query.accountId})`);
    }
    if (query.q) conds.push(or(ilike(journalEntries.memo, `%${query.q}%`), ilike(journalEntries.number, `%${query.q}%`)));
    const where = and(...conds);
    const [[count], rows] = await Promise.all([
      this.db.select({ n: sql<number>`count(*)::int` }).from(journalEntries).where(where),
      this.db
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(where)
        .orderBy(desc(journalEntries.entryDate), desc(journalEntries.number))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
    ]);
    const items = await this.entries(rows.map((r) => r.id));
    return page(items, count?.n ?? 0, query.page, query.pageSize);
  }

  async entry(actor: AuthUser, id: string): Promise<JournalEntryView> {
    const [row] = await this.db
      .select({ id: journalEntries.id })
      .from(journalEntries)
      .where(and(eq(journalEntries.id, id), eq(journalEntries.tenantId, tenantOf(actor))))
      .limit(1);
    if (!row) throw new NotFoundException('Entry not found.');
    return (await this.entries([id]))[0]!;
  }

  /** Full entries with their lines, in the order the ids were given. */
  async entries(ids: string[]): Promise<JournalEntryView[]> {
    if (!ids.length) return [];
    const creator = alias(users, 'creator');
    const reverser = alias(journalEntries, 'reverser');
    const [heads, lines] = await Promise.all([
      this.db
        .select({ e: journalEntries, createdByName: creator.fullName, reversedById: reverser.id })
        .from(journalEntries)
        .leftJoin(creator, eq(creator.id, journalEntries.createdBy))
        .leftJoin(reverser, eq(reverser.reversalOf, journalEntries.id))
        .where(inArray(journalEntries.id, ids)),
      this.db
        .select({
          l: journalLines,
          code: ledgerAccounts.code,
          name: ledgerAccounts.name,
          clientName: clients.fullName,
        })
        .from(journalLines)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
        .leftJoin(clients, eq(clients.id, journalLines.clientId))
        .where(inArray(journalLines.entryId, ids))
        .orderBy(desc(journalLines.debit), asc(ledgerAccounts.code)),
    ]);
    const byEntry = new Map<string, typeof lines>();
    for (const l of lines) {
      const list = byEntry.get(l.l.entryId) ?? [];
      list.push(l);
      byEntry.set(l.l.entryId, list);
    }
    const byId = new Map(heads.map((h) => [h.e.id, h]));
    return ids
      .map((id) => byId.get(id))
      .filter((h): h is NonNullable<typeof h> => Boolean(h))
      .map((h) => {
        const ls = byEntry.get(h.e.id) ?? [];
        return {
          id: h.e.id,
          number: h.e.number,
          entryDate: h.e.entryDate,
          memo: h.e.memo,
          currency: h.e.currency as Currency,
          fxRate: h.e.fxRate === null ? null : Number(h.e.fxRate),
          sourceType: h.e.sourceType as JournalSource,
          sourceId: h.e.sourceId,
          reversalOfId: h.e.reversalOf,
          reversedById: h.reversedById,
          createdByName: h.createdByName,
          createdAt: iso(h.e.createdAt),
          total: ls.reduce((n, l) => n + l.l.debit, 0),
          lines: ls.map((l) => ({
            id: l.l.id,
            accountId: l.l.accountId,
            accountCode: l.code,
            accountName: l.name,
            debit: l.l.debit,
            credit: l.l.credit,
            description: l.l.description,
            clientName: l.clientName,
          })),
        };
      });
  }

  /** One account's lines in a period, with the balance carried in and a running balance. */
  async generalLedger(actor: AuthUser, accountId: string, q: { from?: string; to?: string; currency?: string }): Promise<GeneralLedgerView> {
    const tenantId = tenantOf(actor);
    const account = await this.account(actor, accountId);
    const to = q.to ?? today();
    const from = q.from ?? `${to.slice(0, 7)}-01`;
    const currency = (q.currency ?? account.currency ?? account.balances[0]?.currency ?? (await this.baseCurrency(tenantId))) as Currency;
    const sign = NORMAL_BALANCE[account.type] === 'debit' ? 1 : -1;
    const LIMIT = 1000;
    const [openingMap, rows] = await Promise.all([
      this.balances(tenantId, { before: from, accountIds: [accountId], currency }),
      this.db
        .select({
          lineId: journalLines.id,
          entryId: journalEntries.id,
          number: journalEntries.number,
          entryDate: journalEntries.entryDate,
          memo: journalEntries.memo,
          sourceType: journalEntries.sourceType,
          description: journalLines.description,
          debit: journalLines.debit,
          credit: journalLines.credit,
          reconciled: sql<boolean>`exists (select 1 from ${bankLines} b where b.matched_line_id = ${journalLines.id})`,
        })
        .from(journalLines)
        .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
        .where(
          and(
            eq(journalLines.tenantId, tenantId),
            eq(journalLines.accountId, accountId),
            eq(journalEntries.currency, currency),
            gte(journalEntries.entryDate, from),
            lte(journalEntries.entryDate, to),
          ),
        )
        .orderBy(asc(journalEntries.entryDate), asc(journalEntries.number))
        .limit(LIMIT + 1),
    ]);
    const o = openingMap.get(accountId)?.get(currency);
    const opening = o ? sign * (o.debit - o.credit) : 0;
    let running = opening;
    const shown = rows.slice(0, LIMIT).map((r) => {
      running += sign * (r.debit - r.credit);
      return {
        lineId: r.lineId,
        entryId: r.entryId,
        entryNumber: r.number,
        entryDate: r.entryDate,
        memo: r.memo,
        sourceType: r.sourceType as JournalSource,
        description: r.description,
        debit: r.debit,
        credit: r.credit,
        running,
        reconciled: Boolean(r.reconciled),
      };
    });
    return { account, currency, from, to, opening, closing: running, rows: shown, truncated: rows.length > LIMIT };
  }

  /* ---------------------------------------------------------------- */
  /* Entries made by hand                                              */
  /* ---------------------------------------------------------------- */

  async manual(actor: AuthUser, raw: ManualJournalInput): Promise<JournalEntryView> {
    const input = manualJournalSchema.parse(raw);
    const tenantId = tenantOf(actor);
    const ids = [...new Set(input.lines.map((l) => l.accountId))];
    const found = await this.db
      .select({ id: ledgerAccounts.id, active: ledgerAccounts.active })
      .from(ledgerAccounts)
      .where(and(eq(ledgerAccounts.tenantId, tenantId), inArray(ledgerAccounts.id, ids)));
    if (found.length !== ids.length || found.some((f) => !f.active)) {
      throw new BadRequestException({ message: 'Every line needs one of your active accounts.', fieldErrors: { lines: 'Unknown or switched-off account' } });
    }
    const base = await this.baseCurrency(tenantId);
    const id = await this.db.transaction((tx) =>
      postEntry(tx, {
        tenantId,
        date: input.entryDate,
        memo: input.memo,
        currency: input.currency,
        fxRate: input.currency === base ? 1 : (input.fxRate ?? null),
        sourceType: 'manual',
        createdBy: actor.id,
        lines: input.lines.map((l) => ({ account: { id: l.accountId }, debit: l.debit, credit: l.credit, description: l.description })),
      }),
    );
    await this.audit.record(actor, {
      action: 'journal.posted',
      entityType: 'journal_entry',
      entityId: id!,
      metadata: { memo: input.memo, date: input.entryDate, currency: input.currency, total: input.lines.reduce((n, l) => n + (l.debit ?? 0), 0) },
    });
    return this.entry(actor, id!);
  }

  /**
   * Reverses a manual entry (documents reverse their own entries when they
   * are voided - an invoice's entry is undone by voiding the invoice, so the
   * two can never disagree).
   */
  async reverse(actor: AuthUser, id: string, reason: string): Promise<JournalEntryView> {
    const entry = await this.entry(actor, id);
    if (entry.sourceType !== 'manual' && entry.sourceType !== 'bank' && entry.sourceType !== 'opening') {
      throw new ForbiddenException('This entry belongs to a document. Void the document instead, and its entry is reversed with it.');
    }
    if (entry.reversedById) throw new BadRequestException('That entry has already been reversed.');
    if (entry.reversalOfId) throw new BadRequestException('That entry is itself a reversal.');
    const newId = await this.db.transaction((tx) =>
      reverseEntry(tx, id, { date: today(), memo: `Reversal of ${entry.number}: ${reason}`, sourceType: 'reversal', createdBy: actor.id }),
    );
    await this.audit.record(actor, { action: 'journal.reversed', entityType: 'journal_entry', entityId: id, metadata: { number: entry.number, reason } });
    return this.entry(actor, newId!);
  }

  async baseCurrency(tenantId: string): Promise<Currency> {
    const r = await this.db.execute<{ c: string }>(sql`select base_currency as c from finance_settings where tenant_id = ${tenantId}`);
    const rows = (r as unknown as { rows?: { c: string }[] }).rows ?? (r as unknown as { c: string }[]);
    return (rows[0]?.c ?? 'PKR') as Currency;
  }
}

export function toAccount(r: AccountRow, balances?: Map<string, { debit: number; credit: number }>): LedgerAccountView {
  const sign = NORMAL_BALANCE[r.type as AccountType] === 'debit' ? 1 : -1;
  const list: AccountBalance[] = [...(balances ?? new Map()).entries()]
    .map(([currency, b]) => ({ currency: currency as Currency, debit: b.debit, credit: b.credit, balance: sign * (b.debit - b.credit) }))
    .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type as AccountType,
    subtype: (r.subtype as AccountSubtype | null) ?? null,
    currency: (r.currency as Currency | null) ?? null,
    description: r.description,
    systemKey: r.systemKey,
    active: r.active,
    balances: list,
  };
}
