/**
 * Finance: invoices with tax, discounts and promotions posted to a
 * double-entry journal that always balances; approvals, installments,
 * credit notes, refunds with a second pair of eyes, students' proof of
 * payment, online payments (test driver and a signed Stripe webhook),
 * quotes, expenses and bills, bank reconciliation, the cash count, the
 * period lock, reports, the reminder and late-fee sweep - each tried from
 * the other consultancy and without the permission.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { appGet, as, call, db, fx, giveRole, pdf, schema, setPermission, startApp, stopApp, upload } from './harness';

const shared = require('@crm/shared') as typeof import('@crm/shared');

before(startApp);
after(stopApp);

const alphaM = as('alphaManager');
const alphaC = as('alphaConsultant');
const alphaS = as('alphaClient');
const bravoM = as('bravoManager');
const bravoC = as('bravoConsultant');

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

let accounts: Record<string, string> = {};
let gst = '';
let vatIncl = '';
let bigInvoice: any = null;

async function linesOf(sourceType: string, sourceId: string) {
  const rows = await db()
    .select({ key: schema.ledgerAccounts.systemKey, debit: schema.journalLines.debit, credit: schema.journalLines.credit })
    .from(schema.journalLines)
    .innerJoin(schema.journalEntries, eq(schema.journalEntries.id, schema.journalLines.entryId))
    .innerJoin(schema.ledgerAccounts, eq(schema.ledgerAccounts.id, schema.journalLines.accountId))
    .where(and(eq(schema.journalEntries.sourceType, sourceType), eq(schema.journalEntries.sourceId, sourceId)));
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

describe('the books a consultancy starts with', () => {
  test('a chart of accounts and finance settings exist for every consultancy', async () => {
    const r = await alphaM('GET', '/finance/account-options');
    assert.equal(r.status, 200);
    accounts = Object.fromEntries(r.body.filter((a: any) => a.systemKey).map((a: any) => [a.systemKey, a.id]));
    for (const key of ['cash', 'bank', 'online', 'receivable', 'tax_payable', 'fees_service', 'disbursements', 'sales_returns', 'rent', 'cash_over_short']) {
      assert.ok(accounts[key], `${key} account exists`);
    }
    const s = await alphaM('GET', '/finance/settings');
    assert.equal(s.status, 200);
    assert.equal(s.body.baseCurrency, 'PKR');
    assert.equal(s.body.gateway.provider, 'none');
  });

  test('tax rates and promotion codes are set up by those allowed to', async () => {
    const a = await alphaM('POST', '/finance/taxes', { name: 'GST on services', ratePercent: 16 });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    gst = a.body.id;
    const b = await alphaM('POST', '/finance/taxes', { name: 'VAT included', ratePercent: 20, inclusive: true });
    vatIncl = b.body.id;
    assert.equal((await alphaM('POST', '/finance/promos', { code: 'welcome10', kind: 'percent', value: 10 })).status, 201);
    assert.equal((await alphaM('POST', '/finance/promos', { code: 'WELCOME10', kind: 'percent', value: 5 })).status, 400, 'codes are unique (case-folded)');
    assert.equal((await alphaC('POST', '/finance/taxes', { name: 'Sneaky', ratePercent: 1 })).status, 403);
  });
});

describe('invoices with tax, discounts and promotions', () => {
  test('lines are priced once - the invoice, its PDF and the journal agree, and disbursements are not revenue', async () => {
    const items = [
      { description: 'Counselling', quantity: 1, unitAmount: 100_000_00, category: 'service', taxRateId: gst, discount: 10_000_00 },
      { description: 'Visa fee paid for you', quantity: 1, unitAmount: 50_000_00, category: 'disbursement' },
      { description: 'IELTS course', quantity: 1, unitAmount: 24_000_00, category: 'course', taxRateId: vatIncl },
    ];
    const r = await alphaM('POST', '/billing/invoices', { clientId: fx.alpha.clientId, caseId: fx.alpha.caseId, currency: 'PKR', dueDate: day(30), items });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const expected = shared.computeTotals([
      { quantity: 1, unitAmount: 100_000_00, discount: 10_000_00, tax: { rateBp: 1600, inclusive: false } },
      { quantity: 1, unitAmount: 50_000_00 },
      { quantity: 1, unitAmount: 24_000_00, tax: { rateBp: 2000, inclusive: true } },
    ]);
    assert.equal(r.body.total, expected.total);
    assert.equal(r.body.total, 178_400_00);
    assert.equal(r.body.tax, 18_400_00);
    assert.equal(r.body.discount, 10_000_00);
    assert.equal(r.body.items[2].tax, 4_000_00, 'inclusive tax is taken out of the price');
    bigInvoice = r.body;

    const books = await linesOf('invoice', r.body.id);
    assert.equal(books.receivable, 178_400_00);
    assert.equal(books.fees_service, -90_000_00, 'service revenue net of its discount');
    assert.equal(books.fees_course, -20_000_00, 'course revenue without the tax inside its price');
    assert.equal(books.disbursements, -50_000_00, 'money recovered for a disbursement is not revenue');
    assert.equal(books.tax_payable, -18_400_00);
    await booksBalance(fx.alpha.id);

    const pdfRes = await alphaM('GET', `/billing/invoices/${r.body.id}/pdf`);
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.headers.get('content-type'), 'application/pdf');
    assert.equal(pdfRes.raw.subarray(0, 4).toString(), '%PDF');
  });

  test('a promotion code takes its share off every line; a bad code is refused with a reason', async () => {
    const ok = await alphaM('POST', '/billing/invoices', {
      clientId: fx.alpha.clientId,
      currency: 'PKR',
      dueDate: day(14),
      promoCode: 'welcome10',
      items: [{ description: 'Admission', quantity: 1, unitAmount: 100_000_00 }],
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.total, 90_000_00);
    assert.equal(ok.body.promoCode, 'WELCOME10');
    const bad = await alphaM('POST', '/billing/invoices', {
      clientId: fx.alpha.clientId,
      currency: 'PKR',
      dueDate: day(14),
      promoCode: 'NOPE',
      items: [{ description: 'Admission', quantity: 1, unitAmount: 100_000_00 }],
    });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.fieldErrors.promoCode);
    const usd = await alphaM('POST', '/finance/promos', { code: 'FLAT50', kind: 'fixed', value: 50, currency: 'USD' });
    assert.equal(usd.status, 201);
    const wrongCurrency = await alphaM('POST', '/billing/invoices', {
      clientId: fx.alpha.clientId,
      currency: 'PKR',
      dueDate: day(14),
      promoCode: 'FLAT50',
      items: [{ description: 'Admission', quantity: 1, unitAmount: 100_000_00 }],
    });
    assert.equal(wrongCurrency.status, 400);
  });
});

describe('discounts over the limit wait for approval', () => {
  let pendingId = '';

  test('a consultant’s big discount needs a reason and is not issued until approved', async () => {
    const settings = await alphaM('PUT', '/finance/settings', { baseCurrency: 'PKR', discountApprovalPercent: 15 });
    assert.equal(settings.status, 200, JSON.stringify(settings.body));
    const body = {
      clientId: fx.alpha.clientId,
      currency: 'PKR',
      dueDate: day(14),
      items: [{ description: 'Complete package', quantity: 1, unitAmount: 150_000_00, discount: 30_000_00 }],
    };
    const noReason = await alphaC('POST', '/billing/invoices', body);
    assert.equal(noReason.status, 400);
    assert.ok(noReason.body.fieldErrors.discountReason);
    const r = await alphaC('POST', '/billing/invoices', { ...body, discountReason: 'Sibling of an existing student' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'pending_approval');
    pendingId = r.body.id;
    assert.deepEqual(await linesOf('invoice', pendingId), {}, 'nothing is booked yet');
  });

  test('the student cannot see it and nothing can be paid against it', async () => {
    const list = await alphaS('GET', '/billing/invoices?pageSize=100');
    assert.ok(!list.body.items.some((i: any) => i.id === pendingId));
    assert.equal((await alphaS('GET', `/billing/invoices/${pendingId}`)).status, 404);
    const pay = await alphaC('POST', `/billing/invoices/${pendingId}/payments`, { amount: 1000, method: 'cash', receivedOn: day(0) });
    assert.equal(pay.status, 400);
  });

  test('the person who gave the discount can never approve it; someone else can', async () => {
    assert.equal((await alphaC('POST', `/billing/invoices/${pendingId}/approve`, {})).status, 403, 'no approval right');
    await setPermission('alpha', 'billing.approve', 'allow');
    const own = await alphaC('POST', `/billing/invoices/${pendingId}/approve`, {});
    assert.equal(own.status, 403);
    assert.match(own.body.message, /Someone else/);
    await setPermission('alpha', 'billing.approve', 'inherit');
    const ok = await alphaM('POST', `/billing/invoices/${pendingId}/approve`, { note: 'Fine' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'issued');
    assert.equal(ok.body.approvedByName, 'alpha manager');
    assert.equal((await linesOf('invoice', pendingId)).receivable, 120_000_00);
    await alphaM('PUT', '/finance/settings', { baseCurrency: 'PKR', discountApprovalPercent: null });
  });
});

describe('installments', () => {
  let id = '';

  test('they must add up to the total; lateness follows the schedule', async () => {
    const base = {
      clientId: fx.alpha.clientId,
      currency: 'PKR',
      issueDate: day(-40),
      dueDate: day(30),
      items: [{ description: 'Admission processing', quantity: 1, unitAmount: 90_000_00 }],
    };
    const wrong = await alphaC('POST', '/billing/invoices', { ...base, installments: [{ dueDate: day(-20), amount: 30_000_00 }, { dueDate: day(20), amount: 50_000_00 }] });
    assert.equal(wrong.status, 400);
    const r = await alphaC('POST', '/billing/invoices', { ...base, installments: [{ dueDate: day(-20), amount: 30_000_00 }, { dueDate: day(20), amount: 60_000_00 }] });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    id = r.body.id;
    assert.equal(r.body.dueDate, day(20), 'the invoice is due when the last part is');
    assert.equal(r.body.overdue, true, 'the first part is late');
    assert.deepEqual(r.body.nextDue, { dueDate: day(-20), amount: 30_000_00 });
    assert.deepEqual(r.body.installments.map((i: any) => i.status), ['overdue', 'due']);
    const overdue = await alphaC('GET', '/billing/invoices?status=overdue&pageSize=100');
    assert.ok(overdue.body.items.some((i: any) => i.id === id));
  });

  test('paying the first part brings it up to date', async () => {
    const r = await alphaC('POST', `/billing/invoices/${id}/payments`, { amount: 30_000_00, method: 'cash', receivedOn: day(0), accountId: accounts.cash });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.overdue, false);
    assert.deepEqual(r.body.installments.map((i: any) => i.status), ['paid', 'due']);
    assert.equal(r.body.payments[0].accountName, 'Cash in hand');
    const books = await linesOf('payment', r.body.payments[0].id);
    assert.equal(books.cash, 30_000_00);
    assert.equal(books.receivable, -30_000_00);
  });
});

describe('payments, voids and credit notes', () => {
  test('voiding a payment reverses its entry and keeps the row', async () => {
    const paid = await alphaM('POST', `/billing/invoices/${bigInvoice.id}/payments`, { amount: 50_000_00, method: 'bank_transfer', receivedOn: day(0) });
    assert.equal(paid.status, 201);
    const p = paid.body.payments[0];
    const voided = await alphaM('POST', `/billing/payments/${p.id}/void`, { reason: 'Entered against the wrong invoice' });
    assert.equal(voided.status, 201);
    assert.equal(voided.body.paid, 0);
    assert.deepEqual(await linesOf('payment', p.id), { bank: 50_000_00, receivable: -50_000_00 });
    assert.deepEqual(await linesOf('payment_void', p.id), { bank: -50_000_00, receivable: 50_000_00 }, 'the void posts the mirror image');
    assert.equal((await alphaC('POST', `/billing/payments/${p.id}/void`, { reason: 'Again please' })).status, 403);
  });

  test('a credit note lowers what is owed, books the revenue and tax back, and cannot exceed the invoice', async () => {
    assert.equal((await alphaC('POST', `/billing/invoices/${bigInvoice.id}/credit-notes`, { amount: 1000, reason: 'Goodwill gesture' })).status, 403);
    const r = await alphaM('POST', `/billing/invoices/${bigInvoice.id}/credit-notes`, { amount: 17_840_00, reason: 'Ten percent goodwill after a delay' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.credited, 17_840_00);
    assert.equal(r.body.balance, 178_400_00 - 17_840_00);
    const cn = r.body.creditNotes[0];
    assert.equal(cn.taxAmount, 1_840_00, 'its share of the tax');
    const books = await linesOf('credit_note', cn.id);
    assert.equal(books.receivable, -17_840_00);
    assert.equal(books.tax_payable, 1_840_00);
    assert.equal(books.disbursements, 5_000_00, 'the disbursement share goes back to disbursements');
    assert.equal(books.sales_returns, 11_000_00, 'the rest shows as credit notes against income');
    const tooMuch = await alphaM('POST', `/billing/invoices/${bigInvoice.id}/credit-notes`, { amount: 178_400_00, reason: 'Everything back' });
    assert.equal(tooMuch.status, 400);
    const v = await alphaM('POST', `/billing/credit-notes/${cn.id}/void`, { reason: 'Issued by mistake' });
    assert.equal(v.body.credited, 0);
    const voidInvoice = await alphaM('POST', `/billing/invoices/${bigInvoice.id}/void`, { reason: 'Test that voids reverse' });
    assert.equal(voidInvoice.status, 201, JSON.stringify(voidInvoice.body));
    const after = await linesOf('invoice', bigInvoice.id);
    assert.equal(after.receivable, 178_400_00);
    const reversal = await linesOf('invoice_void', bigInvoice.id);
    assert.equal(reversal.receivable, -178_400_00, 'voiding posts the mirror image');
    await booksBalance(fx.alpha.id);
  });
});

describe('refunds with a second pair of eyes', () => {
  let invoiceId = '';
  let requestId = '';

  test('someone asks, with a reason, for no more than was paid', async () => {
    const inv = await alphaM('POST', '/billing/invoices', { clientId: fx.alpha.clientId, currency: 'PKR', dueDate: day(10), items: [{ description: 'Visa file', quantity: 1, unitAmount: 60_000_00 }] });
    invoiceId = inv.body.id;
    await alphaM('POST', `/billing/invoices/${invoiceId}/payments`, { amount: 60_000_00, method: 'bank_transfer', receivedOn: day(0) });
    assert.equal((await alphaC('POST', `/billing/invoices/${invoiceId}/refund-requests`, { amount: 10_000_00, method: 'bank_transfer', reason: 'Visa refused' })).status, 403);
    await setPermission('alpha', 'billing.refund', 'allow');
    const tooMuch = await alphaC('POST', `/billing/invoices/${invoiceId}/refund-requests`, { amount: 70_000_00, method: 'bank_transfer', reason: 'Visa refused' });
    assert.equal(tooMuch.status, 400);
    const r = await alphaC('POST', `/billing/invoices/${invoiceId}/refund-requests`, { amount: 20_000_00, method: 'bank_transfer', reason: 'Visa refused; refund per policy' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    requestId = r.body.id;
    assert.equal(r.body.status, 'pending');
  });

  test('whoever asked cannot approve it; an approver can, and only then does money go out', async () => {
    await setPermission('alpha', 'billing.approve', 'allow');
    const own = await alphaC('POST', `/billing/refund-requests/${requestId}/decide`, { approve: true });
    assert.equal(own.status, 403);
    await setPermission('alpha', 'billing.approve', 'inherit');
    const noReason = await alphaM('POST', `/billing/refund-requests/${requestId}/decide`, { approve: false });
    assert.equal(noReason.status, 400, 'turning down needs a reason');
    const ok = await alphaM('POST', `/billing/refund-requests/${requestId}/decide`, { approve: true, note: 'Per refund policy' });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'approved');
    const inv = await alphaM('GET', `/billing/invoices/${invoiceId}`);
    assert.equal(inv.body.paid, 40_000_00);
    const refund = inv.body.payments.find((p: any) => p.kind === 'refund');
    assert.ok(refund.number.startsWith('RFD-'));
    assert.equal((await linesOf('payment', refund.id)).receivable, 20_000_00);
    assert.equal((await alphaM('POST', `/billing/refund-requests/${requestId}/decide`, { approve: true })).status, 400, 'decided once');
    await setPermission('alpha', 'billing.refund', 'inherit');
  });

  test('when the consultancy approves every refund, managers cannot skip it', async () => {
    await alphaM('PUT', '/finance/settings', { baseCurrency: 'PKR', directRefunds: false });
    const r = await alphaM('POST', `/billing/invoices/${invoiceId}/payments`, { kind: 'refund', amount: 1_000_00, method: 'cash', receivedOn: day(0) });
    assert.equal(r.status, 403);
    await alphaM('PUT', '/finance/settings', { baseCurrency: 'PKR', directRefunds: true });
  });
});

describe('a student’s proof of payment', () => {
  let invoiceId = '';
  let submission: any = null;

  test('the student uploads a slip; it is filed and waits', async () => {
    const inv = await alphaM('POST', '/billing/invoices', { clientId: fx.alpha.clientId, currency: 'PKR', dueDate: day(10), items: [{ description: 'Admission', quantity: 1, unitAmount: 40_000_00 }] });
    invoiceId = inv.body.id;
    const tooMuch = await upload('alphaClient', `/billing/invoices/${invoiceId}/submissions`, { amount: String(50_000_00), method: 'bank_transfer', paidOn: day(0) }, { name: 'slip.pdf', type: 'application/pdf', bytes: pdf() });
    assert.equal(tooMuch.status, 400);
    const r = await upload('alphaClient', `/billing/invoices/${invoiceId}/submissions`, { amount: String(40_000_00), method: 'bank_transfer', paidOn: day(0), reference: 'HBL-998877' }, { name: 'slip.pdf', type: 'application/pdf', bytes: pdf() });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    submission = r.body;
    assert.equal(submission.status, 'pending');
    const [doc] = await db().select().from(schema.documents).where(eq(schema.documents.id, submission.documentId));
    assert.equal(doc!.typeKey, 'payment_proof');
    const blocked = await alphaM('POST', `/documents/${submission.documentId}/status`, { status: 'verified' });
    assert.equal(blocked.status, 400, 'decided in finance, where the money is recorded');
  });

  test('checking it needs "Verify payments"; approving records the payment once', async () => {
    assert.equal((await alphaC('POST', `/billing/submissions/${submission.id}/review`, { approve: true })).status, 403);
    const ok = await alphaM('POST', `/billing/submissions/${submission.id}/review`, { approve: true, accountId: accounts.bank });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'approved');
    assert.ok(ok.body.receiptNumber.startsWith('RCT-'));
    assert.equal((await alphaM('POST', `/billing/submissions/${submission.id}/review`, { approve: true })).status, 400);
    const inv = await alphaS('GET', `/billing/invoices/${invoiceId}`);
    assert.equal(inv.body.paymentStatus, 'paid');
    const [doc] = await db().select().from(schema.documents).where(eq(schema.documents.id, submission.documentId));
    assert.equal(doc!.status, 'verified');
  });

  test('a rejection tells the student why', async () => {
    const inv = await alphaM('POST', '/billing/invoices', { clientId: fx.alpha.clientId, currency: 'PKR', dueDate: day(10), items: [{ description: 'Interview prep', quantity: 1, unitAmount: 15_000_00 }] });
    const s = await upload('alphaClient', `/billing/invoices/${inv.body.id}/submissions`, { amount: String(15_000_00), method: 'online', paidOn: day(0) }, { name: 'slip.pdf', type: 'application/pdf', bytes: pdf() });
    const noNote = await alphaM('POST', `/billing/submissions/${s.body.id}/review`, { approve: false });
    assert.equal(noNote.status, 400);
    const r = await alphaM('POST', `/billing/submissions/${s.body.id}/review`, { approve: false, note: 'The amount on the slip is not visible.' });
    assert.equal(r.body.status, 'rejected');
    const mine = await alphaS('GET', '/billing/submissions');
    assert.ok(mine.body.some((x: any) => x.id === s.body.id && x.reviewNote));
  });
});

describe('paying online', () => {
  test('the test driver: a checkout, then the payment recorded once', async () => {
    const inv = await alphaM('POST', '/billing/invoices', { clientId: fx.alpha.clientId, currency: 'PKR', dueDate: day(10), items: [{ description: 'Consultation', quantity: 1, unitAmount: 5_000_00 }] });
    assert.equal((await alphaS('POST', `/billing/invoices/${inv.body.id}/pay-online`, {})).status, 400, 'off by default');
    assert.equal((await alphaM('PUT', '/finance/settings/gateway', { provider: 'test' })).status, 200);
    const start = await alphaS('POST', `/billing/invoices/${inv.body.id}/pay-online`, { what: 'balance' });
    assert.equal(start.status, 201, JSON.stringify(start.body));
    assert.match(start.body.url, /\/pay\/test\//);
    assert.equal((await alphaM('POST', `/billing/online/${start.body.id}/test`, { pay: true })).status, 403, 'only the student pays');
    const paid = await alphaS('POST', `/billing/online/${start.body.id}/test`, { pay: true });
    assert.equal(paid.body.status, 'paid');
    assert.ok(paid.body.receiptNumber);
    assert.equal((await alphaS('POST', `/billing/online/${start.body.id}/test`, { pay: true })).status, 400);
    const after = await alphaS('GET', `/billing/invoices/${inv.body.id}`);
    assert.equal(after.body.paid, 5_000_00);
    assert.equal(after.body.payments.length, 1);
    assert.equal(after.body.payments[0].accountName, 'Online payments');
  });

  test('Stripe: only a correctly signed webhook records money, and only once', async () => {
    const saved = await alphaM('PUT', '/finance/settings/gateway', { provider: 'stripe', stripeSecretKey: 'sk_test_abc123', stripeWebhookSecret: 'whsec_testsecret' });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.gateway.stripeConfigured, true);
    assert.ok(!JSON.stringify(saved.body).includes('sk_test_abc123'), 'the key is never sent back');
    const [stored] = await db().select({ k: schema.financeSettings.stripeSecretKey }).from(schema.financeSettings).where(eq(schema.financeSettings.tenantId, fx.alpha.id));
    assert.ok(stored!.k!.startsWith('v1:'), 'sealed at rest');

    const inv = await alphaM('POST', '/billing/invoices', { clientId: fx.alpha.clientId, currency: 'PKR', dueDate: day(10), items: [{ description: 'Consultation', quantity: 1, unitAmount: 7_000_00 }] });
    const [op] = await db()
      .insert(schema.onlinePayments)
      .values({ tenantId: fx.alpha.id, invoiceId: inv.body.id, clientId: fx.alpha.clientId, amount: 7_000_00, currency: 'PKR', provider: 'stripe', providerRef: 'cs_test_123' })
      .returning();
    const event = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_123', payment_status: 'paid', amount_total: 7_000_00, currency: 'pkr' } } };
    const body = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', 'whsec_testsecret').update(`${t}.${body}`).digest('hex');
    const url = `/billing/online/stripe/${fx.alpha.id}/webhook`;
    const bad = await call('POST', url, { host: fx.alpha.host, json: event, headers: { 'stripe-signature': `t=${t},v1=${'0'.repeat(64)}` } });
    assert.equal(bad.status, 401);
    const ok = await call('POST', url, { host: fx.alpha.host, json: event, headers: { 'stripe-signature': `t=${t},v1=${sig}` } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const again = await call('POST', url, { host: fx.alpha.host, json: event, headers: { 'stripe-signature': `t=${t},v1=${sig}` } });
    assert.equal(again.status, 200);
    const after = await alphaM('GET', `/billing/invoices/${inv.body.id}`);
    assert.equal(after.body.payments.length, 1, 'delivered twice, recorded once');
    assert.equal(after.body.payments[0].method, 'card');
    const [done] = await db().select().from(schema.onlinePayments).where(eq(schema.onlinePayments.id, op!.id));
    assert.equal(done!.status, 'paid');
    // Another consultancy's id in the URL cannot use alpha's secret.
    const cross = await call('POST', `/billing/online/stripe/${fx.bravo.id}/webhook`, { host: fx.bravo.host, json: event, headers: { 'stripe-signature': `t=${t},v1=${sig}` } });
    assert.equal(cross.status, 401);
    await alphaM('PUT', '/finance/settings/gateway', { provider: 'none' });
  });
});

describe('quotes and proforma invoices', () => {
  test('a quote is invoiced at the prices the student accepted, even after a rate changes', async () => {
    const draft = await alphaM('POST', '/billing/quotes', { clientId: fx.alpha.clientId, validUntil: day(14), send: false, items: [{ description: 'Draft line', quantity: 1, unitAmount: 1_000_00 }] });
    assert.equal(draft.status, 201);
    assert.equal((await alphaS('GET', `/billing/quotes/${draft.body.id}`)).status, 404, 'a draft is not the student’s yet');
    const q = await alphaM('POST', '/billing/quotes', {
      clientId: fx.alpha.clientId,
      validUntil: day(14),
      promoCode: 'WELCOME10',
      items: [{ description: 'Admission processing', quantity: 1, unitAmount: 75_000_00, taxRateId: gst }],
    });
    assert.equal(q.status, 201, JSON.stringify(q.body));
    assert.equal(q.body.status, 'sent');
    assert.equal(q.body.total, 78_300_00, '75,000 less 10% plus 16%');
    const pdfRes = await alphaS('GET', `/billing/quotes/${q.body.id}/pdf`);
    assert.equal(pdfRes.raw.subarray(0, 4).toString(), '%PDF');
    // The tax rate changes after the quote went out.
    await alphaM('PUT', `/finance/taxes/${gst}`, { name: 'GST on services', ratePercent: 18 });
    const accepted = await alphaS('POST', `/billing/quotes/${q.body.id}/accept`, { note: 'Go ahead' });
    assert.equal(accepted.body.status, 'accepted');
    const inv = await alphaM('POST', `/billing/quotes/${q.body.id}/convert`, { dueDate: day(20) });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    assert.equal(inv.body.total, 78_300_00);
    assert.equal(inv.body.quoteNumber, q.body.number);
    assert.equal((await alphaM('POST', `/billing/quotes/${q.body.id}/convert`, { dueDate: day(20) })).status, 400, 'once');
    await alphaM('PUT', `/finance/taxes/${gst}`, { name: 'GST on services', ratePercent: 16 });
  });
});

describe('expenses, bills and the books', () => {
  test('an expense posts to its heading; a disbursement is not an expense; income accounts are refused', async () => {
    const rent = await alphaM('POST', '/finance/expenses', {
      spentOn: day(0),
      accountId: accounts.rent,
      vendor: 'Landlord',
      description: 'October rent',
      amount: 150_000_00,
      currency: 'PKR',
      paidFromAccountId: accounts.bank,
      method: 'bank_transfer',
    });
    assert.equal(rent.status, 201, JSON.stringify(rent.body));
    assert.ok(rent.body.number.startsWith('EXP-'));
    assert.deepEqual(await linesOf('expense', rent.body.id), { rent: 150_000_00, bank: -150_000_00 });
    const disb = await alphaM('POST', '/finance/expenses', {
      spentOn: day(0),
      accountId: accounts.disbursements,
      vendor: 'UKVI',
      description: 'Visa fee paid for the student',
      amount: 50_000_00,
      currency: 'PKR',
      paidFromAccountId: accounts.bank,
      method: 'card',
      clientId: fx.alpha.clientId,
    });
    assert.equal(disb.status, 201, JSON.stringify(disb.body));
    assert.equal((await linesOf('expense', disb.body.id)).disbursements, 50_000_00);
    const wrong = await alphaM('POST', '/finance/expenses', {
      spentOn: day(0),
      accountId: accounts.fees_service,
      vendor: 'X',
      description: 'Not an expense',
      amount: 1_00,
      currency: 'PKR',
      paidFromAccountId: accounts.bank,
      method: 'cash',
    });
    assert.equal(wrong.status, 400);
    const v = await alphaM('POST', `/finance/expenses/${disb.body.id}/void`, { reason: 'Paid by the student after all' });
    assert.equal(v.body.voided, true);
  });

  test('a bill is owed until paid, and the payables report agrees with the books', async () => {
    const b = await alphaM('POST', '/finance/bills', {
      vendor: 'CRM software Ltd',
      issueDate: day(-3),
      dueDate: day(10),
      accountId: accounts.software,
      description: 'Annual licence',
      amount: 24_000_00,
      currency: 'PKR',
    });
    assert.equal(b.status, 201, JSON.stringify(b.body));
    const payables = await alphaM('GET', '/finance/reports/payables');
    assert.equal(payables.status, 200);
    assert.ok(payables.body.checks.every((c: any) => c.ok), JSON.stringify(payables.body.checks));
    const paid = await alphaM('POST', `/finance/bills/${b.body.id}/pay`, { paidOn: day(0), paidFromAccountId: accounts.bank, method: 'bank_transfer' });
    assert.equal(paid.body.status, 'paid');
    assert.equal((await alphaM('POST', `/finance/bills/${b.body.id}/void`, { reason: 'Changed my mind' })).status, 400, 'a paid bill stays');
  });

  test('manual entries must balance; documents’ entries are corrected through the document', async () => {
    const unbalanced = await alphaM('POST', '/finance/journal', {
      entryDate: day(0),
      memo: 'Owner puts money in',
      currency: 'PKR',
      lines: [{ accountId: accounts.bank, debit: 100_00 }, { accountId: accounts.equity, credit: 90_00 }],
    });
    assert.equal(unbalanced.status, 400);
    const ok = await alphaM('POST', '/finance/journal', {
      entryDate: day(0),
      memo: 'Owner puts money in',
      currency: 'PKR',
      lines: [{ accountId: accounts.bank, debit: 500_000_00 }, { accountId: accounts.equity, credit: 500_000_00 }],
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.body));
    const rev = await alphaM('POST', `/finance/journal/${ok.body.id}/reverse`, { reason: 'Wrong account' });
    assert.equal(rev.status, 201);
    assert.equal((await alphaM('POST', `/finance/journal/${ok.body.id}/reverse`, { reason: 'Again' })).status, 400);
    const [invoiceEntry] = await db().select({ id: schema.journalEntries.id }).from(schema.journalEntries).where(and(eq(schema.journalEntries.tenantId, fx.alpha.id), eq(schema.journalEntries.sourceType, 'invoice'))).limit(1);
    assert.equal((await alphaM('POST', `/finance/journal/${invoiceEntry!.id}/reverse`, { reason: 'Try it' })).status, 403);
    const appendOnly = (e: any) => /append-only/.test(`${e?.message} ${e?.cause?.message}`);
    await assert.rejects(db().update(schema.journalLines).set({ debit: 1 }).where(eq(schema.journalLines.tenantId, fx.alpha.id)), appendOnly);
    await assert.rejects(db().delete(schema.journalEntries).where(eq(schema.journalEntries.id, invoiceEntry!.id)), appendOnly);
  });
});

describe('the bank and the cash drawer', () => {
  test('a statement imports once; lines are matched or booked until the bank and the books agree', async () => {
    const csv = ['Date,Description,Amount,Ref', `${day(0)},Transfer from student,40000.00,HBL-998877`, `${day(0)},Monthly account fee,-500.00,`].join('\n');
    const imp = await alphaM('POST', `/finance/bank/${accounts.bank}/import`, { csv, dateColumn: 0, descriptionColumn: 1, amountColumn: 2, referenceColumn: 3 });
    assert.equal(imp.status, 201, JSON.stringify(imp.body));
    assert.equal(imp.body.imported, 2);
    const again = await alphaM('POST', `/finance/bank/${accounts.bank}/import`, { csv, dateColumn: 0, descriptionColumn: 1, amountColumn: 2, referenceColumn: 3 });
    assert.equal(again.body.imported, 0);
    assert.equal(again.body.duplicates, 2);

    const view = await alphaM('GET', `/finance/bank/${accounts.bank}`);
    assert.equal(view.status, 200);
    const deposit = view.body.unmatchedBank.find((l: any) => l.amount === 40_000_00);
    const fee = view.body.unmatchedBank.find((l: any) => l.amount === -500_00);
    const suggested = view.body.suggestions[deposit.id];
    assert.ok(suggested?.length, 'the proof-of-payment receipt is suggested');
    assert.equal((await alphaM('POST', `/finance/bank/lines/${deposit.id}/match`, { journalLineId: suggested[0] })).status, 201);
    const charge = await alphaM('POST', `/finance/bank/lines/${fee.id}/entry`, { accountId: accounts.bank_charges, memo: 'Bank fee for October' });
    assert.equal(charge.status, 201, JSON.stringify(charge.body));
    const after = await alphaM('GET', `/finance/bank/${accounts.bank}`);
    assert.equal(after.body.unmatchedBank.length, 0);
    assert.equal(after.body.matched.length, 2);
    assert.equal(after.body.reconciledBalance, 40_000_00 - 500_00);
  });

  test('the cash count books any difference', async () => {
    const exp = await alphaM('GET', `/finance/day-close/expected?accountId=${accounts.cash}&date=${day(0)}&currency=PKR`);
    assert.equal(exp.body.expected, 30_000_00, 'the cash taken for the first installment');
    const r = await alphaM('POST', '/finance/day-close', { accountId: accounts.cash, date: day(0), currency: 'PKR', counted: 29_990_00, note: 'Short by 100' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.difference, -10_00);
    const after = await alphaM('GET', `/finance/day-close/expected?accountId=${accounts.cash}&date=${day(0)}&currency=PKR`);
    assert.equal(after.body.expected, 29_990_00, 'the books now match the drawer');
    assert.equal((await alphaM('POST', '/finance/day-close', { accountId: accounts.cash, date: day(0), currency: 'PKR', counted: 1 })).status, 400, 'once per day');
  });
});

describe('closing a period', () => {
  test('nothing can be dated inside it; only a manager reopens it', async () => {
    const lock = await alphaM('POST', '/finance/lock', { through: day(-1) });
    assert.equal(lock.status, 201, JSON.stringify(lock.body));
    assert.equal(lock.body.lockedThrough, day(-1));
    const inv = await alphaM('POST', '/billing/invoices', { clientId: fx.alpha.clientId, currency: 'PKR', dueDate: day(10), items: [{ description: 'Admission', quantity: 1, unitAmount: 1_000_00 }] });
    const late = await alphaM('POST', `/billing/invoices/${inv.body.id}/payments`, { amount: 1_000_00, method: 'cash', receivedOn: day(-2) });
    assert.equal(late.status, 400);
    assert.equal(late.body.code, 'PERIOD_LOCKED');
    const backdated = await alphaM('POST', '/billing/invoices', { clientId: fx.alpha.clientId, currency: 'PKR', issueDate: day(-5), dueDate: day(10), items: [{ description: 'Admission', quantity: 1, unitAmount: 1_000_00 }] });
    assert.equal(backdated.status, 400);
    await setPermission('alpha', 'finance.ledger', 'allow');
    assert.equal((await alphaC('POST', '/finance/lock', { through: null })).status, 403, 'reopening is a manager’s call');
    assert.equal((await alphaC('POST', '/finance/lock', { through: day(0) })).status, 400, 'a period that has not ended');
    await setPermission('alpha', 'finance.ledger', 'inherit');
    assert.equal((await alphaM('POST', '/finance/lock', { through: null })).status, 201);
  });
});

describe('reports', () => {
  test('every report runs, its checks hold, and it downloads as CSV', async () => {
    for (const name of shared.REPORTS) {
      const r = await alphaM('GET', `/finance/reports/${name}`);
      assert.equal(r.status, 200, `${name}: ${JSON.stringify(r.body)}`);
      for (const c of r.body.checks) assert.ok(c.ok, `${name}: ${c.label}`);
      const csv = await alphaM('GET', `/finance/reports/${name}?format=csv`);
      assert.equal(csv.status, 200);
      assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
    }
    const pnl = await alphaM('GET', '/finance/reports/pnl');
    const rent = pnl.body.rows.find((r: any) => r.code === '5200');
    assert.equal(rent.values[1], 150_000_00);
    const tb = await alphaM('GET', '/finance/reports/trial-balance?currency=base');
    assert.equal(tb.status, 200);
    const overview = await alphaM('GET', '/finance/overview');
    assert.equal(overview.status, 200);
    assert.ok(overview.body.money.some((m: any) => m.name === 'Cash in hand'));
  });

  test('the journal exports for Xero and QuickBooks', async () => {
    const xero = await alphaM('GET', `/finance/export/journal?from=${day(-60)}&to=${day(0)}&format=xero`);
    assert.equal(xero.status, 200);
    assert.match(xero.raw.toString('utf8'), /\*Narration,\*Date/);
    const qb = await alphaM('GET', `/finance/export/journal?from=${day(-60)}&to=${day(0)}&format=quickbooks`);
    assert.match(qb.raw.toString('utf8'), /^!TRNS/);
    assert.equal((await alphaC('GET', `/finance/export/journal?from=${day(-60)}&to=${day(0)}`)).status, 403);
  });
});

describe('reminders and late fees', () => {
  test('each reminder goes once, and a late fee is charged once', async () => {
    await alphaM('PUT', '/finance/settings', { baseCurrency: 'PKR', lateFeeKind: 'fixed', lateFeeValue: 500, lateFeeGraceDays: 0, reminderOffsets: [-3, 0, 1, 7] });
    const inv = await alphaM('POST', '/billing/invoices', { clientId: fx.alpha.clientId, currency: 'PKR', issueDate: day(-10), dueDate: day(-1), items: [{ description: 'Visa file', quantity: 1, unitAmount: 10_000_00 }] });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    const { RemindersService } = require('../src/reminders/reminders.service') as typeof import('../src/reminders/reminders.service');
    const sweep = appGet<InstanceType<typeof RemindersService>>(RemindersService);
    await sweep.run('payment-reminders');
    await sweep.run('payment-reminders');
    const sent = await db().select().from(schema.financeReminders).where(eq(schema.financeReminders.invoiceId, inv.body.id));
    assert.deepEqual(sent.map((s) => s.offsetDays).sort(), [0, 1], 'on the day and a day late; never twice');
    await sweep.run('late-fees');
    await sweep.run('late-fees');
    const fees = await db().select().from(schema.invoices).where(eq(schema.invoices.parentInvoiceId, inv.body.id));
    assert.equal(fees.length, 1);
    assert.equal(fees[0]!.total, 500_00);
    assert.equal((await linesOf('invoice', fees[0]!.id)).late_fees, -500_00);
    await alphaM('PUT', '/finance/settings', { baseCurrency: 'PKR' });
    await booksBalance(fx.alpha.id);
  });
});

describe('isolation and permissions', () => {
  test('another consultancy cannot see or touch any of it', async () => {
    assert.equal((await bravoM('GET', `/billing/invoices/${bigInvoice.id}`)).status, 404);
    assert.equal((await bravoM('GET', `/finance/accounts/${accounts.bank}/ledger`)).status, 404);
    assert.equal((await bravoM('GET', `/finance/bank/${accounts.bank}`)).status, 404);
    const journal = await bravoM('GET', '/finance/journal?pageSize=100');
    const alphaEntries = await db().select({ id: schema.journalEntries.id }).from(schema.journalEntries).where(eq(schema.journalEntries.tenantId, fx.alpha.id));
    const alphaIds = new Set(alphaEntries.map((e) => e.id));
    assert.ok(!journal.body.items.some((e: any) => alphaIds.has(e.id)));
    const quotes = await bravoM('GET', '/billing/quotes');
    assert.equal(quotes.body.items.length, 0);
    const subs = await bravoM('GET', '/billing/submissions');
    assert.equal(subs.body.length, 0);
    const exp = await bravoM('GET', '/finance/expenses');
    assert.equal(exp.body.items.length, 0);
    const pay = await bravoM('POST', `/finance/expenses`, { spentOn: day(0), accountId: accounts.rent, vendor: 'X', description: 'Their account', amount: 100, currency: 'PKR', paidFromAccountId: accounts.bank, method: 'cash' });
    assert.equal(pay.status, 400, 'alpha’s accounts are not bravo’s');
    await booksBalance(fx.bravo.id);
  });

  test('the books need their permissions; the Accountant role has them; students and trainers do not', async () => {
    assert.equal((await alphaC('GET', '/finance/reports/pnl')).status, 403);
    assert.equal((await alphaC('GET', '/finance/expenses')).status, 403);
    assert.equal((await alphaC('GET', '/finance/journal')).status, 403);
    await giveRole('alpha', 'accountant');
    assert.equal((await alphaC('GET', '/finance/reports/pnl')).status, 200);
    assert.equal((await alphaC('GET', '/finance/expenses')).status, 200);
    assert.equal((await alphaC('GET', '/finance/overview')).status, 200);
    assert.equal((await alphaC('POST', '/finance/lock', { through: null })).status, 201, 'no lock to reopen is not reopening');
    await giveRole('alpha', 'trainer');
    assert.equal((await alphaC('GET', '/billing/invoices')).status, 403);
    await giveRole('alpha', null);
    assert.equal((await alphaS('GET', '/finance/overview')).status, 403);
    assert.equal((await alphaS('GET', '/finance/reports/pnl')).status, 403);
    assert.equal((await bravoC('GET', '/finance/reports/pnl')).status, 403);
  });
});
