import { and, asc, eq, sql } from 'drizzle-orm';
import { computeTotals } from '@crm/shared';
import type { Db } from '../connection';
import {
  bankImports,
  bankLines,
  bills,
  clients,
  expenses,
  financeSettings,
  installments,
  invoiceItems,
  invoices,
  journalLines,
  journalEntries,
  promoCodes,
  quotes,
  taxRates,
  users,
} from '../schema';
import { postEntry, postInvoice, systemAccountId, systemAccountIds } from '../../finance/journal';
import { createHash } from 'node:crypto';

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/**
 * Demo data for the finance workspace: settings with bank details, a tax and
 * a promotion, three months of expenses, bills (one overdue), two invoices
 * in installments (one late), a quote waiting for the student, and a bank
 * statement with lines to reconcile. Everything posts to the journal exactly
 * as the app would. Fills only an empty workspace, so it is safe to re-run.
 */
export async function seedFinance(db: Db, tenantId: string): Promise<{ expenses: number; bills: number; invoices: number; bankLines: number }> {
  const [has] = await db.select({ n: sql<number>`count(*)::int` }).from(expenses).where(eq(expenses.tenantId, tenantId));
  if ((has?.n ?? 0) > 0) return { expenses: 0, bills: 0, invoices: 0, bankLines: 0 };

  await systemAccountIds(db, tenantId);
  const acc = async (key: string) => systemAccountId(db, tenantId, key);
  const [manager] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), eq(users.role, 'manager')))
    .limit(1);
  const by = manager?.id ?? null;

  await db
    .insert(financeSettings)
    .values({ tenantId })
    .onConflictDoNothing();
  await db
    .update(financeSettings)
    .set({
      bankDetails: 'Meezan Bank, Gulberg III branch, Lahore\nAccount title: Consultancy (Pvt) Ltd\nIBAN: PK36 MEZN 0002 0101 0123 4567\nJazzCash / Easypaisa: 0300 1234567',
      invoiceTerms: 'Fees are payable by the due date. Consultancy fees are non-refundable once an application is submitted, except as set out in our refund policy. Fees paid on your behalf are passed through at cost.',
      discountApprovalBp: 2000,
      gatewayProvider: process.env.NODE_ENV === 'production' ? 'none' : 'test',
      reminderOffsets: [-3, 0, 7, 14],
    })
    .where(eq(financeSettings.tenantId, tenantId));

  await db
    .insert(taxRates)
    .values({ tenantId, name: 'Punjab sales tax on services', rateBp: 1600, inclusive: false, isDefault: false, active: true })
    .onConflictDoNothing();
  await db
    .insert(promoCodes)
    .values([
      { tenantId, code: 'EXPO2026', description: 'Education expo walk-ins', kind: 'percent', value: 1000, validTo: day(60), maxUses: 50, createdBy: by },
      { tenantId, code: 'SIBLING', description: 'Brothers and sisters of current students', kind: 'percent', value: 1500, createdBy: by },
    ])
    .onConflictDoNothing();

  /* ---------------- The money the business started the period with ---------------- */
  await db.transaction((tx) =>
    postEntry(tx, {
      tenantId,
      date: day(-120),
      memo: 'Opening balances: owner’s capital in the bank',
      currency: 'PKR',
      fxRate: 1,
      sourceType: 'opening',
      createdBy: by,
      lines: [
        { account: 'bank', debit: 4_500_000_00 },
        { account: 'equity', credit: 4_500_000_00 },
      ],
    }),
  );

  /* ---------------- Expenses: three months of running costs ---------------- */
  const costs: { key: string; vendor: string; description: string; amount: number; from: string; method: 'bank_transfer' | 'cash' | 'card' }[] = [
    { key: 'rent', vendor: 'Gulberg Properties', description: 'Office rent', amount: 180_000_00, from: 'bank', method: 'bank_transfer' },
    { key: 'salaries', vendor: 'Staff payroll', description: 'Salaries', amount: 620_000_00, from: 'bank', method: 'bank_transfer' },
    { key: 'marketing', vendor: 'Meta Platforms', description: 'Facebook and Instagram ads', amount: 85_000_00, from: 'online', method: 'card' },
    { key: 'office', vendor: 'Al-Fatah Stationers', description: 'Office supplies', amount: 12_500_00, from: 'cash', method: 'cash' },
    { key: 'rent', vendor: 'LESCO', description: 'Electricity', amount: 46_000_00, from: 'bank', method: 'bank_transfer' },
  ];
  let expenseCount = 0;
  for (let m = 2; m >= 0; m--) {
    for (const [i, c] of costs.entries()) {
      const spentOn = day(-(m * 30) - 3 - i);
      expenseCount++;
      const number = `EXP-${spentOn.slice(0, 4)}-${String(expenseCount).padStart(4, '0')}`;
      await db.transaction(async (tx) => {
        const [e] = await tx
          .insert(expenses)
          .values({
            tenantId,
            number,
            spentOn,
            accountId: await acc(c.key),
            vendor: c.vendor,
            description: `${c.description}, ${new Date(`${spentOn}T00:00:00Z`).toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' })}`,
            amount: c.amount,
            currency: 'PKR',
            fxRate: '1',
            paidFromAccountId: await acc(c.from),
            method: c.method,
            recordedBy: by,
          })
          .returning();
        await postEntry(tx, {
          tenantId,
          date: spentOn,
          memo: `${number}: ${c.vendor} - ${e!.description}`,
          currency: 'PKR',
          fxRate: 1,
          sourceType: 'expense',
          sourceId: e!.id,
          createdBy: by,
          lines: [
            { account: c.key, debit: c.amount },
            { account: c.from, credit: c.amount },
          ],
        });
      });
    }
  }

  /* ---------------- Bills ---------------- */
  const billRows = [
    { vendor: 'Zoho Corporation', description: 'CRM and email licences, annual', key: 'software', amount: 96_000_00, issue: -20, due: 10 },
    { vendor: 'Brightside Translations', description: 'Transcript translations, September', key: 'professional', amount: 38_500_00, issue: -40, due: -10 },
  ];
  for (const [i, b] of billRows.entries()) {
    const issueDate = day(b.issue);
    const number = `BIL-${issueDate.slice(0, 4)}-${String(i + 1).padStart(4, '0')}`;
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(bills)
        .values({ tenantId, number, vendor: b.vendor, issueDate, dueDate: day(b.due), accountId: await acc(b.key), description: b.description, amount: b.amount, currency: 'PKR', fxRate: '1', createdBy: by })
        .returning();
      await postEntry(tx, {
        tenantId,
        date: issueDate,
        memo: `${number}: ${b.vendor} - ${b.description}`,
        currency: 'PKR',
        fxRate: 1,
        sourceType: 'bill',
        sourceId: row!.id,
        createdBy: by,
        lines: [
          { account: b.key, debit: b.amount },
          { account: 'payable', credit: b.amount },
        ],
      });
    });
  }

  /* ---------------- Invoices in installments, and a quote ---------------- */
  const students = await db
    .select({ id: clients.id })
    .from(clients)
    .where(and(eq(clients.tenantId, tenantId), eq(clients.archived, false)))
    .orderBy(asc(clients.createdAt))
    .limit(3);
  let invoiceCount = 0;
  const [last] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(invoices)
    .where(and(eq(invoices.tenantId, tenantId), sql`${invoices.number} like ${`INV-${day(0).slice(0, 4)}-%`}`));
  let seq = last?.n ?? 0;
  for (const [i, s] of students.slice(0, 2).entries()) {
    const total = 150_000_00;
    const issueDate = day(i === 0 ? -50 : -10);
    const plan = i === 0 ? [{ d: -35, a: 50_000_00 }, { d: -5, a: 50_000_00 }, { d: 25, a: 50_000_00 }] : [{ d: 5, a: 75_000_00 }, { d: 35, a: 75_000_00 }];
    seq++;
    const number = `INV-${issueDate.slice(0, 4)}-${String(seq).padStart(4, '0')}`;
    await db.transaction(async (tx) => {
      const [inv] = await tx
        .insert(invoices)
        .values({ tenantId, number, clientId: s.id, currency: 'PKR', issueDate, dueDate: day(plan[plan.length - 1]!.d), total, subtotal: total, fxRate: '1', createdBy: by, notes: 'Complete package, payable in installments.' })
        .returning();
      await tx.insert(invoiceItems).values({ tenantId, invoiceId: inv!.id, description: 'Complete package', quantity: 1, unitAmount: total, amount: total, lineTotal: total, position: 0, category: 'service' });
      await tx.insert(installments).values(plan.map((p, n) => ({ tenantId, invoiceId: inv!.id, seq: n + 1, dueDate: day(p.d), amount: p.a })));
      await postInvoice(tx, { ...inv!, items: [{ category: 'service', amount: total, discount: 0, taxAmount: 0, taxInclusive: false }] }, by);
    });
    invoiceCount++;
  }
  if (students[2]) {
    const lines = [{ description: 'Admission processing (UK, five universities)', quantity: 1, unitAmount: 75_000_00 }, { description: 'Visa file preparation', quantity: 1, unitAmount: 60_000_00 }];
    const t = computeTotals(lines.map((l) => ({ quantity: l.quantity, unitAmount: l.unitAmount })), { kind: 'percent', value: 1000 });
    const [promo] = await db.select().from(promoCodes).where(and(eq(promoCodes.tenantId, tenantId), eq(promoCodes.code, 'EXPO2026'))).limit(1);
    await db
      .insert(quotes)
      .values({
        tenantId,
        number: `QUO-${day(0).slice(0, 4)}-0001`,
        clientId: students[2].id,
        currency: 'PKR',
        issueDate: day(-2),
        validUntil: day(12),
        status: 'sent',
        items: lines.map((l, n) => ({
          ...l,
          amount: t.lines[n]!.amount,
          discount: t.lines[n]!.discount,
          tax: 0,
          total: t.lines[n]!.total,
          taxRateName: null,
          taxRateBp: 0,
          taxInclusive: false,
          category: 'service',
          packageId: null,
          taxRateId: null,
          lineDiscount: 0,
        })),
        subtotal: t.subtotal,
        discountTotal: t.discount,
        taxTotal: 0,
        total: t.total,
        promoCodeId: promo?.id ?? null,
        promoSnapshot: promo ? { id: promo.id, kind: 'percent', value: 1000, code: promo.code } : null,
        notes: 'Expo offer: 10% off when you start before the end of the month.',
        createdBy: by,
      })
      .onConflictDoNothing();
  }

  /* ---------------- A bank statement to reconcile ---------------- */
  const bankId = await acc('bank');
  const ledger = await db
    .select({ date: journalEntries.entryDate, debit: journalLines.debit, credit: journalLines.credit, memo: journalEntries.memo })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .where(and(eq(journalLines.tenantId, tenantId), eq(journalLines.accountId, bankId), sql`${journalEntries.entryDate} >= ${day(-45)}`))
    .orderBy(asc(journalEntries.entryDate))
    .limit(12);
  const lines = [
    ...ledger.map((l) => ({ date: l.date, amount: l.debit - l.credit, description: l.debit ? `IBFT CREDIT ${l.memo.slice(0, 30).toUpperCase()}` : `DEBIT ${l.memo.slice(0, 30).toUpperCase()}` })),
    { date: day(-6), amount: -1_250_00, description: 'BANK CHARGES - SMS ALERTS AND STATEMENT' },
    { date: day(-4), amount: 3_412_00, description: 'PROFIT ON SAVINGS' },
  ];
  let imported = 0;
  if (lines.length) {
    const [imp] = await db.insert(bankImports).values({ tenantId, accountId: bankId, fileName: 'meezan-statement.csv', lineCount: lines.length, importedBy: by }).returning();
    for (const [n, l] of lines.entries()) {
      const [row] = await db
        .insert(bankLines)
        .values({
          tenantId,
          accountId: bankId,
          importId: imp!.id,
          lineDate: l.date,
          description: l.description,
          amount: l.amount,
          fingerprint: createHash('sha256').update(`${l.date}|${l.amount}|${l.description}|${n}`).digest('hex').slice(0, 40),
        })
        .onConflictDoNothing()
        .returning({ id: bankLines.id });
      if (row) imported++;
    }
  }
  return { expenses: expenseCount, bills: billRows.length, invoices: invoiceCount, bankLines: imported };
}
