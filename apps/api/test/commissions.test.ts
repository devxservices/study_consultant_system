/**
 * University commissions: the institution catalogue, agreements and rules,
 * commissions worked out when an application reaches its trigger step,
 * confirmed with volume tiers and a bonus, claimed, received with bank
 * charges and exchange differences, disputed, written off, clawed back and
 * deducted, cancelled when a student withdraws, and staff incentives - all
 * in balanced books, and each tried from the other consultancy and without
 * the permission.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, sql } from 'drizzle-orm';
import { appGet, as, db, fx, schema, setPermission, startApp, stopApp } from './harness';

before(startApp);
after(stopApp);

const alphaM = as('alphaManager');
const alphaC = as('alphaConsultant');
const alphaS = as('alphaClient');
const bravoM = as('bravoManager');

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

let accounts: Record<string, string> = {};
let uniId = '';
let agreementId = '';
const caseIds: string[] = [];
const byCase: Record<string, any[]> = {};

/** Debit less credit per account for one source, optionally in one currency. */
async function linesOf(sourceType: string, sourceId: string, currency?: string) {
  const rows = await db()
    .select({ key: schema.ledgerAccounts.systemKey, debit: schema.journalLines.debit, credit: schema.journalLines.credit })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .innerJoin(schema.ledgerAccounts, eq(schema.ledgerAccounts.id, schema.journalLines.accountId))
    .where(and(eq(schema.journalEntries.sourceType, sourceType), eq(schema.journalEntries.sourceId, sourceId), currency ? eq(schema.journalEntries.currency, currency) : undefined));
  const out: Record<string, number> = {};
  for (const r of rows) out[r.key ?? 'custom'] = (out[r.key ?? 'custom'] ?? 0) + r.debit - r.credit;
  return out;
}

async function booksBalance(tenantId: string) {
  const rows = await db()
    .select({ currency: schema.journalEntries.currency, d: sql<string>`sum(${schema.journalLines.debit})`, c: sql<string>`sum(${schema.journalLines.credit})` })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .where(eq(schema.journalLines.tenantId, tenantId))
    .groupBy(schema.journalEntries.currency);
  for (const r of rows) assert.equal(r.d, r.c, `debits equal credits in ${r.currency}`);
}

async function commissionsOf(caseId: string) {
  const r = await alphaM('GET', `/cases/${caseId}/commissions`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  byCase[caseId] = r.body;
  return r.body as any[];
}

describe('the institution catalogue', () => {
  test('managers build it; every member of staff reads it; nobody else sees it', async () => {
    const opts = await alphaM('GET', '/finance/account-options');
    accounts = Object.fromEntries(opts.body.filter((a: any) => a.systemKey).map((a: any) => [a.systemKey, a.id]));
    assert.ok(accounts.staff_incentives && accounts.bad_debts, 'the new accounts exist');

    const r = await alphaM('POST', '/institutions', {
      name: 'University of Northbridge',
      country: 'United Kingdom',
      city: 'Northbridge',
      currency: 'GBP',
      contacts: [{ name: 'Priya Shah', role: 'International partnerships', email: 'partnerships@northbridge.example', primary: true }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    uniId = r.body.id;
    assert.equal(r.body.contacts.length, 1);
    assert.equal((await alphaM('POST', '/institutions', { name: 'university of northbridge', country: 'United Kingdom', currency: 'GBP' })).status, 400, 'names are unique');
    assert.equal((await alphaC('POST', '/institutions', { name: 'Sneaky College', country: 'Canada', currency: 'CAD' })).status, 403);
    const list = await alphaC('GET', '/institutions');
    assert.equal(list.status, 200);
    assert.ok(list.body.some((i: any) => i.id === uniId));
    assert.equal((await bravoM('GET', `/institutions/${uniId}`)).status, 404);
    assert.ok(!(await bravoM('GET', '/institutions')).body.some((i: any) => i.id === uniId));
    assert.equal((await alphaS('GET', '/institutions')).status, 403);
  });

  test('an agreement holds its rules, first match wins', async () => {
    const r = await alphaM('POST', `/institutions/${uniId}/agreements`, {
      title: 'Agency agreement 2026',
      validFrom: day(-200),
      validTo: day(300),
      currency: 'GBP',
      claimAfterDays: 30,
      paymentTermsDays: 45,
      rules: [
        {
          name: 'Postgraduate',
          ratePercent: 15,
          tiers: [{ fromStudents: 2, ratePercent: 20 }],
          bonusStudents: 2,
          bonusAmount: 500,
          retentionDays: 60,
          conditions: [{ field: 'studyLevel', op: 'is', value: 'master' }],
        },
        { name: 'Everything else', ratePercent: 10, years: 'each_year', yearCount: 2 },
      ],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    agreementId = r.body.id;
    assert.equal(r.body.status, 'active');
    assert.equal(r.body.rules.length, 2);
    const bad = await alphaM('POST', `/institutions/${uniId}/agreements`, { title: 'Broken', validFrom: day(0), currency: 'GBP', rules: [{ name: 'No rate', ratePercent: 0 }] });
    assert.equal(bad.status, 400);
    const inst = await alphaM('GET', `/institutions/${uniId}`);
    assert.equal(inst.body.activeAgreement.id, agreementId);
    // Commission terms are for those who may see commissions.
    assert.equal((await alphaC('GET', `/institutions/${uniId}`)).body.agreements.length, 0);
  });
});

describe('commissions are worked out at the trigger step', () => {
  test('nothing until the deposit stage; then the matching rule earns it, with the consultant’s share', async () => {
    assert.equal((await alphaM('PUT', '/commissions/settings', { consultantSharePercent: 10, followUpDays: 7 })).status, 200);
    caseIds.push(fx.alpha.caseId);
    await alphaM('PATCH', `/cases/${fx.alpha.caseId}`, { studyLevel: 'master', intake: 'Fall 2026' });
    const e = await alphaM('PUT', `/cases/${fx.alpha.caseId}/enrolment`, { institutionId: uniId, tuitionFee: 15_000_00, tuitionCurrency: 'GBP', courseStart: day(-45) });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    assert.equal(e.body.institutionName, 'University of Northbridge');
    assert.equal(e.body.targetUniversity, 'University of Northbridge');
    assert.equal((await commissionsOf(fx.alpha.caseId)).length, 0, 'documents stage: not yet');

    const move = await alphaM('POST', `/cases/${fx.alpha.caseId}/stage`, { stage: 'fee_payment', reason: 'Deposit paid and CAS issued' });
    assert.equal(move.status, 201, JSON.stringify(move.body));
    const list = await commissionsOf(fx.alpha.caseId);
    assert.equal(list.length, 1);
    const c = list[0];
    assert.equal(c.status, 'expected');
    assert.equal(c.ruleName, 'Postgraduate');
    assert.equal(c.amount, 2_250_00, '15% of 15,000');
    assert.equal(c.currency, 'GBP');
    assert.equal(c.claimableOn, day(-15), 'course start plus the claim window');
    assert.equal(c.splits.length, 1);
    assert.equal(c.splits[0].shareBp, 1000);
    assert.deepEqual(await linesOf('commission', c.id), {}, 'expected is not yet booked');
    // Moving again changes nothing: it is earned once.
    await alphaM('POST', `/cases/${fx.alpha.caseId}/stage`, { stage: 'visa_filed', reason: 'Visa filed straight away' });
    assert.equal((await commissionsOf(fx.alpha.caseId)).length, 1);
  });

  test('each-year rules expect one commission per year of the course', async () => {
    for (const level of ['master', 'bachelor']) {
      const k = await alphaM('POST', '/cases', { clientId: fx.alpha.clientId, targetCountry: 'United Kingdom', studyLevel: level, intake: 'Fall 2026' });
      assert.equal(k.status, 201, JSON.stringify(k.body));
      caseIds.push(k.body.id);
      await alphaM('POST', `/cases/${k.body.id}/stage`, { stage: 'fee_payment', reason: 'Deposit paid at once' });
      // The institution is set after the trigger step: worked out then.
      const e = await alphaM('PUT', `/cases/${k.body.id}/enrolment`, { institutionId: uniId, tuitionFee: 15_000_00, courseStart: day(-45) });
      assert.equal(e.status, 200, JSON.stringify(e.body));
    }
    assert.equal((await commissionsOf(caseIds[1]!)).length, 1);
    const yearly = await commissionsOf(caseIds[2]!);
    assert.deepEqual(yearly.map((c) => [c.yearNo, c.amount]), [[1, 1_500_00], [2, 1_500_00]]);
    assert.ok(yearly[1].expectedOn > yearly[0].expectedOn, 'a year apart');
  });

  test('what is only expected follows the application: new fees and dates re-price it, a new institution cancels it', async () => {
    const k = await alphaM('POST', '/cases', { clientId: fx.alpha.clientId, targetCountry: 'United Kingdom', studyLevel: 'bachelor', intake: 'Spring 2027' });
    await alphaM('POST', `/cases/${k.body.id}/stage`, { stage: 'fee_payment', reason: 'Deposit paid at once' });
    await alphaM('PUT', `/cases/${k.body.id}/enrolment`, { institutionId: uniId, tuitionFee: 20_000_00, courseStart: day(90) });
    assert.deepEqual((await commissionsOf(k.body.id)).map((c) => c.amount), [2_000_00, 2_000_00]);

    // A scholarship, and the start moved back a month.
    const e = await alphaM('PUT', `/cases/${k.body.id}/enrolment`, { institutionId: uniId, tuitionFee: 20_000_00, scholarship: 5_000_00, courseStart: day(120) });
    assert.equal(e.status, 200, JSON.stringify(e.body));
    const repriced = await commissionsOf(k.body.id);
    assert.deepEqual(repriced.map((c) => [c.yearNo, c.amount, c.tuition]), [[1, 1_500_00, 15_000_00], [2, 1_500_00, 15_000_00]], '10% of tuition less the scholarship');
    assert.equal(repriced[0].claimableOn, day(120 + 30), 'dated from the new start');

    // The student goes elsewhere: the expected commission goes with the old institution.
    const other = await alphaM('POST', '/institutions', { name: 'Eastgate College', country: 'United Kingdom', currency: 'GBP' });
    await alphaM('PUT', `/cases/${k.body.id}/enrolment`, { institutionId: other.body.id, tuitionFee: 12_000_00, courseStart: day(120) });
    const after = await commissionsOf(k.body.id);
    assert.ok(after.every((c) => c.status === 'cancelled'), JSON.stringify(after.map((c) => c.status)));
    assert.match(after[0].note, /moved to another institution/);
  });
});

describe('confirming, claiming and receiving', () => {
  let claimId = '';

  test('confirming books it; the second student moves the tier and earns the bonus', async () => {
    const first = byCase[caseIds[0]!]![0];
    const r = await alphaM('POST', `/commissions/${first.id}/confirm`, { enrolledOn: day(-10), fxRate: 355 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'confirmed');
    assert.equal(r.body.amount, 2_250_00);
    assert.equal(r.body.retentionUntil, day(50));
    assert.deepEqual(await linesOf('commission', first.id), { commission_receivable: 2_250_00, commission_income: -2_250_00 });
    assert.equal((await alphaM('POST', `/commissions/${first.id}/confirm`, { enrolledOn: day(-10) })).status, 400, 'once');

    const second = byCase[caseIds[1]!]![0];
    const r2 = await alphaM('POST', `/commissions/${second.id}/confirm`, { enrolledOn: day(-9), fxRate: 355 });
    assert.equal(r2.body.amount, 3_000_00, 'the 20% tier from the second student');
    const bonus = await alphaM('GET', `/commissions?view=to_claim&institutionId=${uniId}`);
    const b = bonus.body.items.find((x: any) => x.kind === 'bonus');
    assert.ok(b, 'a volume bonus');
    assert.equal(b.amount, 500_00);
    assert.equal((await linesOf('commission', b.id)).commission_income, -500_00);
  });

  test('a claim takes confirmed commissions only, and goes out with a PDF', async () => {
    const expected = byCase[caseIds[2]!]![0];
    const bad = await alphaM('POST', '/commissions/claims', { institutionId: uniId, commissionIds: [expected.id], periodLabel: 'September 2026' });
    assert.equal(bad.status, 400);
    const toClaim = (await alphaM('GET', `/commissions?view=to_claim&institutionId=${uniId}`)).body.items;
    assert.equal(toClaim.length, 3);
    const r = await alphaM('POST', '/commissions/claims', { institutionId: uniId, commissionIds: toClaim.map((c: any) => c.id), periodLabel: 'September 2026 intake' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    claimId = r.body.id;
    assert.equal(r.body.total, 5_750_00);
    assert.equal(r.body.status, 'draft');
    const sent = await alphaM('POST', `/commissions/claims/${claimId}/submit`, { submittedOn: day(-5) });
    assert.equal(sent.body.status, 'submitted');
    assert.equal(sent.body.dueOn, day(40));
    assert.ok(sent.body.commissions.every((c: any) => c.status === 'claimed'));
    const pdf = await alphaM('GET', `/commissions/claims/${claimId}/pdf`);
    assert.equal(pdf.raw.subarray(0, 4).toString(), '%PDF');
  });

  test('a receipt is matched commission by commission, charges booked, exchange difference kept', async () => {
    const [first, second] = [byCase[caseIds[0]!]![0], byCase[caseIds[1]!]![0]];
    const over = await alphaM('POST', '/commissions/receipts', {
      institutionId: uniId, receivedOn: day(0), currency: 'GBP', amount: 5000, accountId: accounts.bank,
      allocations: [{ commissionId: first.id, amount: 3000 }],
    });
    assert.equal(over.status, 400, 'no more than is outstanding');
    const r = await alphaM('POST', '/commissions/receipts', {
      institutionId: uniId, receivedOn: day(0), currency: 'GBP', amount: 5000, bankCharges: 25, fxRate: 360, accountId: accounts.bank, claimId,
      reference: 'NB-REMIT-1', allocations: [{ commissionId: first.id, amount: 2250 }, { commissionId: second.id, amount: 2750 }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.net, 4_975_00);
    assert.equal(r.body.unallocated, 0);
    assert.deepEqual(await linesOf('commission_receipt', r.body.id, 'GBP'), { bank: 4_975_00, bank_charges: 25_00, commission_receivable: -5_000_00 });
    const a1 = r.body.allocations.find((a: any) => a.commissionId === first.id);
    assert.equal(a1.fxDifference, 2_250_00 * 5, '5 rupees a pound better than booked');
    // Both were booked at 355 and paid at 360: a realised gain, in rupees, that clears the receivable in the base currency.
    assert.deepEqual(await linesOf('commission_receipt', r.body.id, 'PKR'), { commission_receivable: 5_000_00 * 5, fx_differences: -5_000_00 * 5 });
    const c1 = (await alphaM('GET', `/commissions/${first.id}`)).body;
    assert.equal(c1.stage, 'received');
    const c2 = (await alphaM('GET', `/commissions/${second.id}`)).body;
    assert.equal(c2.stage, 'part_received');
    assert.equal(c2.outstanding, 250_00);
    assert.equal((await alphaM('GET', `/commissions/claims/${claimId}`)).body.status, 'part_paid');
  });

  test('a share is paid once the commission is received in full, as an expense', async () => {
    const first = (await alphaM('GET', `/commissions/${byCase[caseIds[0]!]![0].id}`)).body;
    const split = first.splits[0];
    assert.equal(split.payable, true);
    assert.equal(split.amount, 225_00);
    const second = (await alphaM('GET', `/commissions/${byCase[caseIds[1]!]![0].id}`)).body;
    assert.equal((await alphaM('POST', `/commissions/splits/${second.splits[0].id}/pay`, { paidOn: day(0), accountId: accounts.bank })).status, 400, 'not received in full');
    const paid = await alphaM('POST', `/commissions/splits/${split.id}/pay`, { paidOn: day(0), accountId: accounts.bank });
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
    assert.deepEqual(await linesOf('incentive', split.id), { staff_incentives: 225_00, bank: -225_00 });
    assert.equal((await alphaM('POST', `/commissions/splits/${split.id}/pay`, { paidOn: day(0), accountId: accounts.bank })).status, 400, 'once');
    const mine = await alphaC('GET', '/commissions/incentives/mine');
    assert.equal(mine.status, 200);
    assert.ok(mine.body.splits.some((s: any) => s.id === split.id && s.paidOn === day(0)));
  });
});

describe('when things go wrong', () => {
  test('a dispute, then writing off what will never come', async () => {
    const id = byCase[caseIds[1]!]![0].id;
    assert.equal((await alphaM('POST', `/commissions/${id}/dispute`, { reason: 'Says the student deferred' })).body.status, 'disputed');
    assert.equal((await alphaM('POST', `/commissions/${id}/resolve`, { reason: 'Enrolment evidence sent' })).body.status, 'claimed');
    const w = await alphaM('POST', `/commissions/${id}/write-off`, { reason: 'Balance not worth chasing' });
    assert.equal(w.body.status, 'written_off');
    const books = await linesOf('commission', id);
    assert.equal(books.bad_debts, 250_00);
  });

  test('a clawback reverses the income; the next payment is net of it, and no more than it', async () => {
    const first = byCase[caseIds[0]!]![0].id;
    const cl = await alphaM('POST', `/commissions/${first}/clawback`, { reason: 'Withdrew in week three' });
    assert.equal(cl.status, 201, JSON.stringify(cl.body));
    assert.equal(cl.body.status, 'clawed_back');
    const third = byCase[caseIds[2]!]![0];
    await alphaM('POST', `/commissions/${third.id}/confirm`, { enrolledOn: day(-8), fxRate: 355 });
    const bonus = (await alphaM('GET', `/commissions?view=claimed&institutionId=${uniId}`)).body.items.find((x: any) => x.kind === 'bonus');
    const r = await alphaM('POST', '/commissions/receipts', {
      institutionId: uniId, receivedOn: day(0), currency: 'GBP', amount: 1000, accountId: accounts.bank,
      allocations: [{ commissionId: bonus.id, amount: 500 }, { commissionId: third.id, amount: 1500 }, { commissionId: first, amount: -1000 }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const tooMuch = await alphaM('POST', '/commissions/receipts', {
      institutionId: uniId, receivedOn: day(0), currency: 'GBP', amount: 100, accountId: accounts.bank,
      allocations: [{ commissionId: first, amount: -2000 }],
    });
    assert.equal(tooMuch.status, 400);
    await booksBalance(fx.alpha.id);
  });

  test('withdrawing cancels what was only expected; a received commission cannot be cancelled', async () => {
    const yearTwo = byCase[caseIds[2]!]![1];
    const w = await alphaM('POST', `/cases/${caseIds[2]}/status`, { status: 'withdrawn', reason: 'Student withdrew before year two' });
    assert.equal(w.status, 201, JSON.stringify(w.body));
    assert.equal((await alphaM('GET', `/commissions/${yearTwo.id}`)).body.status, 'cancelled');
    const received = byCase[caseIds[2]!]![0];
    assert.equal((await alphaM('POST', `/commissions/${received.id}/cancel`, { reason: 'Changed our mind' })).status, 400);
  });

  test('voiding a receipt reverses it - unless incentives were paid on what it settled', async () => {
    const receipts = (await alphaM('GET', `/commissions/receipts?institutionId=${uniId}`)).body;
    const [latest, first] = [receipts[0], receipts[receipts.length - 1]];
    assert.equal((await alphaM('POST', `/commissions/receipts/${first.id}/void`, { reason: 'Entered twice' })).status, 400);
    const v = await alphaM('POST', `/commissions/receipts/${latest.id}/void`, { reason: 'Bank returned it' });
    assert.equal(v.status, 201, JSON.stringify(v.body));
    assert.equal(v.body.voided, true);
    assert.equal((await linesOf('reversal', latest.id)).bank, -1_000_00);
    await booksBalance(fx.alpha.id);
  });

  test('a receipt at a worse rate books an exchange loss, and voiding it reverses that too', async () => {
    const third = byCase[caseIds[2]!]![0];
    const r = await alphaM('POST', '/commissions/receipts', {
      institutionId: uniId, receivedOn: day(0), currency: 'GBP', amount: 100, fxRate: 350, accountId: accounts.bank,
      allocations: [{ commissionId: third.id, amount: 100 }],
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.allocations[0].fxDifference, -100_00 * 5);
    assert.deepEqual(await linesOf('commission_receipt', r.body.id, 'PKR'), { fx_differences: 500_00, commission_receivable: -500_00 });
    const v = await alphaM('POST', `/commissions/receipts/${r.body.id}/void`, { reason: 'Recorded against the wrong student' });
    assert.equal(v.status, 201, JSON.stringify(v.body));
    assert.deepEqual(await linesOf('reversal', r.body.id, 'PKR'), { fx_differences: -500_00, commission_receivable: 500_00 });
    assert.equal((await linesOf('reversal', r.body.id, 'GBP')).bank, -100_00);
    await booksBalance(fx.alpha.id);
  });
});

describe('agreements change without changing what was earned', () => {
  test('rules can be edited (new version); the currency cannot once commissions exist', async () => {
    const before = (await alphaM('GET', `/commissions/${byCase[caseIds[0]!]![0].id}`)).body;
    const agreement = (await alphaM('GET', `/institutions/${uniId}`)).body.agreements[0];
    const r = await alphaM('PUT', `/institutions/${uniId}/agreements/${agreementId}`, { ...agreement, rules: [{ name: 'Flat', ratePercent: 5 }] });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.version, 2);
    const after = (await alphaM('GET', `/commissions/${byCase[caseIds[0]!]![0].id}`)).body;
    assert.equal(after.amount, before.amount);
    assert.equal(after.ruleName, 'Postgraduate', 'keeps the rule it was earned under');
    const cur = await alphaM('PUT', `/institutions/${uniId}/agreements/${agreementId}`, { ...agreement, currency: 'USD', rules: [{ name: 'Flat', ratePercent: 5 }] });
    assert.equal(cur.status, 400);
  });
});

describe('the dashboard and the sweep', () => {
  test('the overview totals per currency', async () => {
    const o = await alphaM('GET', '/commissions/overview');
    assert.equal(o.status, 200, JSON.stringify(o.body));
    const gbp = o.body.totals.find((t: any) => t.currency === 'GBP');
    assert.ok(gbp.received > 0);
    assert.ok(o.body.byInstitution.some((b: any) => b.institutionId === uniId));
  });

  test('claim windows and overdue claims are chased once per interval', async () => {
    const k = await alphaM('POST', '/cases', { clientId: fx.alpha.clientId, targetCountry: 'United Kingdom', studyLevel: 'master' });
    await alphaM('POST', `/cases/${k.body.id}/stage`, { stage: 'fee_payment', reason: 'Deposit paid at once' });
    await alphaM('PUT', `/cases/${k.body.id}/enrolment`, { institutionId: uniId, tuitionFee: 10_000_00, courseStart: day(-60) });
    const [c] = await commissionsOf(k.body.id);
    assert.equal(c.claimableOn, day(-60 + 30));
    const claims = (await alphaM('GET', '/commissions/claims')).body;
    await db().update(schema.commissionClaims).set({ dueOn: day(-3) }).where(eq(schema.commissionClaims.id, claims[0].id));
    const { RemindersService } = require('../src/reminders/reminders.service') as typeof import('../src/reminders/reminders.service');
    const sweep = appGet<InstanceType<typeof RemindersService>>(RemindersService);
    await sweep.run('commission-follow-ups');
    await sweep.run('commission-follow-ups');
    const notes = await db()
      .select({ type: schema.notifications.type })
      .from(schema.notifications)
      .where(and(eq(schema.notifications.userId, fx.alpha.managerUserId), sql`${schema.notifications.type} in ('commission_due', 'claim_follow_up')`));
    assert.ok(notes.filter((n) => n.type === 'claim_follow_up').length === 1, 'the overdue claim is chased once');
    assert.ok(notes.filter((n) => n.type === 'commission_due').length >= 1);
    const [row] = await db().select({ at: schema.commissions.dueNotifiedAt }).from(schema.commissions).where(eq(schema.commissions.id, c.id));
    assert.ok(row!.at, 'claimable commission flagged once');
  });
});

describe('isolation and permissions', () => {
  test('without the permission staff see no commissions; another consultancy sees nothing at all', async () => {
    const someId = byCase[caseIds[0]!]![0].id;
    assert.equal((await alphaC('GET', '/commissions')).status, 403);
    assert.equal((await alphaC('GET', `/cases/${fx.alpha.caseId}/commissions`)).status, 403);
    assert.equal((await alphaS('GET', '/commissions')).status, 403);
    await setPermission('alpha', 'commission.view', 'allow');
    assert.equal((await alphaC('GET', '/commissions')).status, 200);
    assert.equal((await alphaC('POST', `/commissions/${someId}/dispute`, { reason: 'Just looking around' })).status, 403);
    await setPermission('alpha', 'commission.view', 'inherit');

    assert.equal((await bravoM('GET', `/commissions/${someId}`)).status, 404);
    const claims = (await alphaM('GET', '/commissions/claims')).body;
    assert.equal((await bravoM('GET', `/commissions/claims/${claims[0].id}`)).status, 404);
    assert.equal((await bravoM('PUT', `/cases/${fx.alpha.caseId}/enrolment`, { institutionId: null })).status, 404);
    const theirs = await bravoM('POST', '/commissions/claims', { institutionId: uniId, commissionIds: [someId], periodLabel: 'Theirs' });
    assert.ok(theirs.status === 404 || theirs.status === 400);
    assert.equal((await bravoM('GET', '/commissions')).body.items.length, 0);
    assert.equal((await bravoM('GET', '/commissions/receipts')).body.length, 0);
    await booksBalance(fx.alpha.id);
    await booksBalance(fx.bravo.id);
  });

  test('the people a commission can be shared with are the consultancy’s own staff, for those who manage commissions', async () => {
    assert.equal((await alphaC('GET', '/commissions/staff-options')).status, 403);
    const mine = await alphaM('GET', '/commissions/staff-options');
    assert.equal(mine.status, 200);
    assert.ok(mine.body.some((u: any) => u.id === fx.alpha.consultantUserId));
    const theirs = await bravoM('GET', '/commissions/staff-options');
    assert.ok(!theirs.body.some((u: any) => u.id === fx.alpha.consultantUserId), 'not another consultancy’s');
  });
});
