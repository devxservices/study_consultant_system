/**
 * Partner consultants: the public application, onboarding (papers, the
 * agreement signed in the app, approval), partner logins closed to
 * everything but their portal, students registered first-come with a
 * conflict queue, earnings from university commission (as it is received,
 * converted, with a master partner's override), per enrolled student and
 * from fees (never pass-through money), reversals and clawbacks, payouts
 * with withholding, advances and a second approver, the portal itself, and
 * the usual attacks from the other consultancy and without permission.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, sql } from 'drizzle-orm';
import { HOST, PASSWORD, appGet, as, call, db, fx, pdf, schema, setPermission, signIn, startApp, stopApp, upload } from './harness';
import { CommissionsService } from '../src/commissions/commissions.service';

before(startApp);
after(stopApp);

const alphaM = as('alphaManager');
const alphaC = as('alphaConsultant');
const bravoM = as('bravoManager');

const day = (offset = 0) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

let master = '';
let sub = '';
let ownerSession = '';
let counsellorSession = '';
let subStudent = '';
let subCase = '';
let uniId = '';
let accounts: Record<string, string> = {};
const partnerCall = (session: () => string) => (method: string, url: string, json?: unknown) => call(method, url, { host: HOST.alpha, session: session(), json });
const owner = partnerCall(() => ownerSession);
const counsellor = partnerCall(() => counsellorSession);
const partnerUpload = (url: string, fields: Record<string, string>, bytes: Buffer, name = 'file.pdf') => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), name);
  return call('POST', url, { host: HOST.alpha, session: ownerSession, form });
};

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

async function earningsOf(partnerId: string) {
  const r = await alphaM('GET', `/partners/earnings?partnerId=${partnerId}&pageSize=100`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items as any[];
}

describe('applying and onboarding', () => {
  test('the public form takes an application once, refuses bots, and tells staff', async () => {
    const info = await call('GET', '/public/partners/apply', { host: HOST.alpha });
    assert.equal(info.status, 200);
    assert.equal(info.body.open, true);
    const form = { name: 'Skyline Overseas', kind: 'sub_agent', contactName: 'Hamza Qureshi', email: 'hello@skyline.example', phone: '+92 42 3555 0101', country: 'Pakistan', city: 'Lahore', studentsPerYear: 40 };
    assert.equal((await call('POST', '/public/partners/apply', { host: HOST.alpha, json: { ...form, website2: 'http://spam' } })).status, 400, 'the honeypot');
    const a = await call('POST', '/public/partners/apply', { host: HOST.alpha, json: form });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const again = await call('POST', '/public/partners/apply', { host: HOST.alpha, json: form });
    assert.equal(again.status, 201, 'says the same thing twice');
    const list = await alphaM('GET', '/partners?status=applied');
    assert.equal(list.body.items.filter((p: any) => p.email === 'hello@skyline.example').length, 1, 'only once');
    const bell = await alphaM('GET', '/notifications?limit=20');
    assert.ok(bell.body.items.some((n: any) => n.type === 'partner_applied'));
    assert.ok(!(await bravoM('GET', '/partners')).body.items.some((p: any) => p.email === 'hello@skyline.example'), 'not another consultancy’s');
    await alphaM('PUT', '/partners/settings', { ...(await alphaM('GET', '/partners/settings')).body, applicationsOpen: false });
    assert.equal((await call('POST', '/public/partners/apply', { host: HOST.alpha, json: { ...form, email: 'new@skyline.example' } })).status, 403, 'closed');
    await alphaM('PUT', '/partners/settings', { ...(await alphaM('GET', '/partners/settings')).body, applicationsOpen: true });
  });

  test('staff add partners and sub-agents, one level deep; only those allowed', async () => {
    const body = { name: 'Lahore Global Education', kind: 'sub_agent', contactName: 'Ayesha Raza', email: 'office@lge.example', phone: '+92 42 111 222 333', country: 'Pakistan', city: 'Lahore', currency: 'PKR', withholdingPercent: 10 };
    assert.equal((await alphaC('POST', '/partners', body)).status, 403);
    const r = await alphaM('POST', '/partners', body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    master = r.body.id;
    assert.equal(r.body.status, 'onboarding');
    assert.match(r.body.number, /^PTR-\d{4}-\d{4}$/);
    assert.equal((await alphaM('POST', '/partners', { ...body, name: 'Copy' })).status, 409, 'one partner per email');
    const s = await alphaM('POST', '/partners', { ...body, name: 'Multan Study Link', email: 'desk@msl.example', parentPartnerId: master, overridePercent: 5, withholdingPercent: null });
    assert.equal(s.status, 201, JSON.stringify(s.body));
    sub = s.body.id;
    const deeper = await alphaM('POST', '/partners', { ...body, name: 'Too deep', email: 'deep@x.example', parentPartnerId: sub });
    assert.equal(deeper.status, 400, 'one level only');
    const noParent = await alphaM('POST', '/partners', { ...body, name: 'No parent', email: 'np@x.example', overridePercent: 3 });
    assert.equal(noParent.status, 400, 'an override needs a master');
    assert.equal((await bravoM('GET', `/partners/${master}`)).status, 404);
    assert.equal((await alphaM('GET', `/partners/${master}`)).body.subAgents[0].id, sub);
  });

  test('a partner login is closed to everything but its own portal', async () => {
    const m = await alphaM('POST', `/partners/${master}/members`, { fullName: 'Ayesha Raza', email: 'ayesha@lge.example', role: 'owner', password: PASSWORD });
    assert.equal(m.status, 201, JSON.stringify(m.body));
    ownerSession = await signIn(HOST.alpha, 'ayesha@lge.example');
    for (const url of ['/clients', '/partners', '/commissions', '/billing/invoices', '/drive']) {
      assert.equal((await owner('GET', url)).status, 403, `${url} is closed to partners`);
    }
    const dash = await owner('GET', '/partner-portal/dashboard');
    assert.equal(dash.status, 200, JSON.stringify(dash.body));
    assert.equal(dash.body.partner.id, master);
    assert.equal(dash.body.me.role, 'owner');
    const staffTry = await alphaC('GET', '/partner-portal/dashboard');
    assert.equal(staffTry.status, 403, `staff do not use the partner portal: ${JSON.stringify(staffTry.body)}`);
    // The owner adds a counsellor; a counsellor cannot add anyone or make an owner.
    const c = await owner('POST', '/partner-portal/team', { fullName: 'Bilal Counsellor', email: 'bilal@lge.example', role: 'counsellor', password: PASSWORD });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    const makeOwner = await owner('POST', '/partner-portal/team', { fullName: 'X Person', email: 'x@lge.example', role: 'owner', password: PASSWORD });
    assert.equal(makeOwner.status, 403, `owners are the consultancy's to make: ${JSON.stringify(makeOwner.body)}`);
    counsellorSession = await signIn(HOST.alpha, 'bilal@lge.example');
    const byCounsellor = await counsellor('POST', '/partner-portal/team', { fullName: 'Y Person', email: 'y@lge.example', role: 'counsellor', password: PASSWORD });
    assert.equal(byCounsellor.status, 403, `counsellors add nobody: ${JSON.stringify(byCounsellor.body)}`);
    assert.equal((await counsellor('GET', '/partner-portal/earnings')).status, 403, 'money is for owners and administrators');
  });

  test('activation needs approved papers and a signed agreement; the signature is checked against what was sent', async () => {
    const early = await alphaM('POST', `/partners/${master}/status`, { status: 'active', reason: 'Looks good to us' });
    assert.equal(early.status, 400);
    assert.match(early.body.message, /papers approved.*agreement signed/);
    for (const kind of ['registration', 'owner_id', 'bank']) {
      const u = await partnerUpload('/partner-portal/documents', { kind }, pdf(kind), `${kind}.pdf`);
      assert.equal(u.status, 201, JSON.stringify(u.body));
    }
    const docs = (await alphaM('GET', `/partners/${master}`)).body.documents as any[];
    assert.equal(docs.length, 3);
    assert.equal((await alphaM('GET', `/partners/${master}`)).body.kycStatus, 'pending');
    const reject = await alphaM('POST', `/partners/${master}/documents/${docs[0].id}/review`, { decision: 'reject' });
    assert.equal(reject.status, 400, 'a rejection says why');
    for (const d of docs) assert.equal((await alphaM('POST', `/partners/${master}/documents/${d.id}/review`, { decision: 'approve' })).status, 201);
    assert.equal((await alphaM('GET', `/partners/${master}`)).body.kycStatus, 'approved');
    const file = await owner('GET', `/partner-portal/documents/${docs[0].id}`);
    assert.equal(file.raw.subarray(0, 4).toString(), '%PDF');

    const draft = await alphaM('GET', `/partners/${master}/agreements/draft`);
    assert.match(draft.body.body, /Lahore Global Education/);
    const created = await alphaM('POST', `/partners/${master}/agreements`, { title: draft.body.title, body: draft.body.body, validFrom: day(0) });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const agreementId = created.body[0].id;
    assert.equal((await owner('GET', '/partner-portal/agreements')).body.length, 0, 'drafts are not shown');
    assert.equal((await alphaM('POST', `/partners/${master}/agreements/${agreementId}/send`)).status, 201);
    const sent = (await owner('GET', '/partner-portal/agreements')).body[0];
    assert.equal(sent.status, 'sent');
    assert.match(sent.documentHash, /^[0-9a-f]{64}$/);
    const wrongName = await owner('POST', `/partner-portal/agreements/${agreementId}/sign`, { signerName: 'Ayesha Raza', signerTitle: 'Director', kind: 'typed', signature: 'A. Raza', agree: true });
    assert.equal(wrongName.status, 400, 'typed exactly as the name');
    assert.equal((await counsellor('POST', `/partner-portal/agreements/${agreementId}/sign`, { signerName: 'Bilal', signerTitle: 'Counsellor', kind: 'typed', signature: 'Bilal', agree: true })).status, 403);
    // Terms changed behind the partner's back are not what it would be signing.
    await db().update(schema.partnerAgreements).set({ body: `${draft.body.body}\n\n10. A late extra clause.` }).where(eq(schema.partnerAgreements.id, agreementId));
    assert.equal((await owner('POST', `/partner-portal/agreements/${agreementId}/sign`, { signerName: 'Ayesha Raza', signerTitle: 'Director', kind: 'typed', signature: 'Ayesha Raza', agree: true })).status, 400);
    await db().update(schema.partnerAgreements).set({ body: draft.body.body }).where(eq(schema.partnerAgreements.id, agreementId));
    const signed = await owner('POST', `/partner-portal/agreements/${agreementId}/sign`, { signerName: 'Ayesha Raza', signerTitle: 'Director', kind: 'typed', signature: 'Ayesha  Raza', agree: true });
    assert.equal(signed.status, 201, JSON.stringify(signed.body));
    assert.equal(signed.body.status, 'signed');
    assert.ok(signed.body.signerIp !== undefined);
    const cert = await alphaM('GET', `/partners/${master}/agreements/${agreementId}/pdf`);
    assert.equal(cert.raw.subarray(0, 4).toString(), '%PDF');
    assert.equal((await owner('GET', `/partner-portal/agreements/${agreementId}/pdf`)).status, 200);

    const go = await alphaM('POST', `/partners/${master}/status`, { status: 'active', reason: 'Papers and agreement in order' });
    assert.equal(go.status, 201, JSON.stringify(go.body));
    assert.equal(go.body.status, 'active');
    assert.ok(go.body.approvedAt);
  });
});

describe('students and who they belong to', () => {
  test('a partner registers a new student with an application, looked after by its manager', async () => {
    const p = (await alphaM('GET', `/partners/${master}`)).body;
    await alphaM('PUT', `/partners/${master}`, { ...p, managerUserId: fx.alpha.consultantUserId, withholdingPercent: 10, overridePercent: 0, parentPartnerId: null });
    const body = { fullName: 'Zara Malik', email: 'zara.malik@example.com', phone: '+92 300 111 2233', passportNumber: 'AB1234567', firstApplication: { targetCountry: 'United Kingdom', intake: 'Fall 2026' }, consent: true };
    assert.equal((await owner('POST', '/partner-portal/students', { ...body, consent: false })).status, 400, 'the student must agree');
    const r = await counsellor('POST', '/partner-portal/students', body);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.status, 'registered');
    const client = await alphaM('GET', `/clients/${r.body.clientId}`);
    assert.equal(client.body.consultant?.id, fx.alpha.consultantId, 'its manager, a consultant, looks after the student');
    const who = await alphaM('GET', `/partners/students/${r.body.clientId}`);
    assert.equal(who.body.partnerName, 'Lahore Global Education');
    const list = await owner('GET', '/partner-portal/students');
    assert.equal(list.body.length, 1);
    assert.equal(list.body[0].applications.length, 1);
    assert.equal(list.body[0].registeredByName, 'Bilal Counsellor');
    assert.equal((await owner('POST', '/partner-portal/students', body)).body.status, 'yours', 'the same student again');
  });

  test('a student someone already has goes to the queue; staff decide; the claimant sees only its own entry', async () => {
    const existing = (await alphaM('GET', `/clients/${fx.alpha.clientId}`)).body;
    const claim = await owner('POST', '/partner-portal/students', { fullName: 'Different Spelling', email: 'other.address@example.com', phone: existing.phone, consent: true });
    assert.equal(claim.status, 201, JSON.stringify(claim.body));
    assert.equal(claim.body.status, 'conflict');
    const mine = await owner('GET', '/partner-portal/conflicts');
    assert.equal(mine.body.length, 1);
    assert.equal(mine.body[0].clientName, 'Different Spelling', 'only what it entered');
    assert.equal(mine.body[0].currentPartnerName, null);
    const queue = await alphaM('GET', '/partners/conflicts');
    assert.equal(queue.body.length, 1);
    assert.deepEqual(queue.body[0].matchedOn, ['phone']);
    assert.equal(queue.body[0].lapsed, false, 'the student has a live application');
    assert.equal(queue.body[0].clientName, existing.fullName);
    assert.equal((await alphaC('POST', `/partners/conflicts/${queue.body[0].id}/resolve`, { decision: 'transfer', note: 'Partner brought them' })).status, 403);
    const decided = await alphaM('POST', `/partners/conflicts/${queue.body[0].id}/resolve`, { decision: 'transfer', note: 'They brought the student in person' });
    assert.equal(decided.status, 201, JSON.stringify(decided.body));
    assert.equal(decided.body.length, 0, 'nothing open');
    assert.equal((await alphaM('GET', `/partners/students/${fx.alpha.clientId}`)).body.partnerName, 'Lahore Global Education');
    assert.equal((await owner('GET', '/partner-portal/students')).body.length, 2);
  });

  test('staff credit a student to a sub-agent; the master sees it, marked as the sub-agent’s', async () => {
    const c = await alphaM('POST', '/clients', { fullName: 'Hassan Javed', email: 'hassan.javed@example.com', phone: '+92 321 555 7788', firstApplication: { targetCountry: 'United Kingdom', intake: 'Fall 2026' } });
    assert.equal(c.status, 201, JSON.stringify(c.body));
    subStudent = c.body.id;
    subCase = (await alphaM('GET', `/clients/${subStudent}`)).body.cases[0].id;
    assert.equal((await alphaC('PUT', `/partners/students/${subStudent}`, { partnerId: sub, reason: 'Referred by the sub-agent' })).status, 403);
    const a = await alphaM('PUT', `/partners/students/${subStudent}`, { partnerId: sub, reason: 'Referred by the sub-agent' });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    const seen = (await owner('GET', '/partner-portal/students')).body.find((s: any) => s.clientId === subStudent);
    assert.equal(seen.viaPartnerName, 'Multan Study Link');
    const upload = await partnerUpload(`/partner-portal/students/${subStudent}/documents`, {}, pdf('sub'));
    assert.equal(upload.status, 404, 'a sub-agent’s student is the master’s to read, not to change');
  });
});

describe('what partners earn', () => {
  test('the rules: one per kind of earning, the most specific wins', async () => {
    const opts = await alphaM('GET', '/finance/account-options');
    accounts = Object.fromEntries(opts.body.filter((a: any) => a.systemKey).map((a: any) => [a.systemKey, a.id]));
    const inst = await alphaM('POST', '/institutions', { name: 'University of Eastmoor', country: 'United Kingdom', currency: 'GBP' });
    uniId = inst.body.id;
    await alphaM('POST', `/institutions/${uniId}/agreements`, { title: 'Agency 2026', validFrom: day(-300), currency: 'GBP', claimAfterDays: 14, paymentTermsDays: 30, rules: [{ name: 'All', ratePercent: 20 }] });
    const bad = await alphaM('POST', '/partners/rules', { name: 'Broken', basis: 'fixed_per_student', fixedAmount: 0, validFrom: day(-10) });
    assert.equal(bad.status, 400);
    assert.equal((await alphaC('POST', '/partners/rules', { name: 'Sneaky', basis: 'commission_share', ratePercent: 90, validFrom: day(-10) })).status, 403);
    for (const rule of [
      { name: 'Everyone: half the commission', basis: 'commission_share', ratePercent: 50, validFrom: day(-100) },
      { name: 'Gold partners: 60%', basis: 'commission_share', ratePercent: 60, tier: 'gold', validFrom: day(-100) },
      { name: 'LGE: 10,000 per student', basis: 'fixed_per_student', fixedAmount: 10_000, currency: 'PKR', partnerId: master, validFrom: day(-100) },
      { name: 'Fees: 10% of counselling', basis: 'fee_share', ratePercent: 10, feeCategories: ['service'], validFrom: day(-100) },
    ]) {
      const r = await alphaM('POST', '/partners/rules', rule);
      assert.equal(r.status, 201, JSON.stringify(r.body));
    }
    assert.equal((await alphaM('GET', '/partners/rules')).body.length, 4);
  });

  test('a fixed amount when the student enrols; a share as the university pays, at its rate; the master’s override on its sub-agent', async () => {
    for (const [caseId, tuition] of [[fx.alpha.caseId, 10_000_00], [subCase, 5_000_00]] as const) {
      const e = await alphaM('PUT', `/cases/${caseId}/enrolment`, { institutionId: uniId, tuitionFee: tuition, courseStart: day(-40) });
      assert.equal(e.status, 200, JSON.stringify(e.body));
      await alphaM('POST', `/cases/${caseId}/stage`, { stage: 'fee_payment', reason: 'Deposit paid' });
    }
    const [mine] = (await alphaM('GET', `/cases/${fx.alpha.caseId}/commissions`)).body;
    const [theirs] = (await alphaM('GET', `/cases/${subCase}/commissions`)).body;
    assert.equal(mine.amount, 2_000_00);
    assert.equal((await alphaM('POST', `/commissions/${mine.id}/confirm`, { enrolledOn: day(-30), fxRate: 350 })).status, 201);
    assert.equal((await alphaM('POST', `/commissions/${theirs.id}/confirm`, { enrolledOn: day(-30), fxRate: 350 })).status, 201);

    let lge = await earningsOf(master);
    const fixed = lge.find((e) => e.kind === 'fixed_per_student');
    assert.equal(fixed.amount, 10_000_00);
    assert.equal(fixed.currency, 'PKR');
    assert.deepEqual(await linesOf('partner_earning', fixed.id), { partner_commission: 10_000_00, partner_payable: -10_000_00 });
    assert.equal((await earningsOf(sub)).length, 0, 'the fixed rule was for LGE alone');

    const r1 = await alphaM('POST', '/commissions/receipts', { institutionId: uniId, receivedOn: day(-5), currency: 'GBP', amount: 2000, fxRate: 360, accountId: accounts.bank, allocations: [{ commissionId: mine.id, amount: 2000 }] });
    assert.equal(r1.status, 201, JSON.stringify(r1.body));
    lge = await earningsOf(master);
    const share = lge.find((e) => e.kind === 'commission_share');
    assert.equal(share.amount, 360_000_00, '50% of £2,000 at 360');
    assert.equal(share.currency, 'PKR');
    assert.equal(share.basisAmount, 2_000_00);

    const r2 = await alphaM('POST', '/commissions/receipts', { institutionId: uniId, receivedOn: day(-5), currency: 'GBP', amount: 1000, fxRate: 360, accountId: accounts.bank, allocations: [{ commissionId: theirs.id, amount: 1000 }] });
    assert.equal(r2.status, 201, JSON.stringify(r2.body));
    const subShare = (await earningsOf(sub)).find((e) => e.kind === 'commission_share');
    assert.equal(subShare.amount, 180_000_00);
    const override = (await earningsOf(master)).find((e) => e.kind === 'override');
    assert.equal(override.amount, 18_000_00, '5% of the £1,000 received, in rupees');
    assert.equal(override.fromPartnerName, 'Multan Study Link');

    // The same receipt's event heard again earns nothing more.
    const commissions = appGet<CommissionsService>(CommissionsService);
    const [alloc] = await db().select().from(schema.receiptAllocations).where(eq(schema.receiptAllocations.receiptId, r2.body.id));
    await commissions.emitCommission({ type: 'received', tenantId: fx.alpha.id, commissionId: theirs.id, allocationId: alloc!.id, receiptId: r2.body.id, amount: 1000_00, fxRate: 360, on: day(-5), actor: null });
    assert.equal((await earningsOf(sub)).filter((e) => e.kind === 'commission_share').length, 1, 'once');

    // Voiding the university's payment takes back the unpaid share and the override on it.
    assert.equal((await alphaM('POST', `/commissions/receipts/${r2.body.id}/void`, { reason: 'Bank returned it' })).status, 201);
    assert.equal((await earningsOf(sub)).find((e) => e.kind === 'commission_share').status, 'reversed');
    assert.equal((await earningsOf(master)).find((e) => e.kind === 'override').status, 'reversed');
    assert.deepEqual(await linesOf('reversal', subShare.id), { partner_commission: -180_000_00, partner_payable: 180_000_00 });
    const r3 = await alphaM('POST', '/commissions/receipts', { institutionId: uniId, receivedOn: day(-2), currency: 'GBP', amount: 1000, fxRate: 360, accountId: accounts.bank, allocations: [{ commissionId: theirs.id, amount: 1000 }] });
    assert.equal(r3.status, 201);
    assert.equal((await earningsOf(sub)).filter((e) => e.kind === 'commission_share' && e.status === 'payable').length, 1);
    await booksBalance(fx.alpha.id);
  });

  test('a share of the fees the student pays - never of money passed through - reversed when the payment is', async () => {
    const inv = await alphaM('POST', '/billing/invoices', {
      clientId: fx.alpha.clientId,
      currency: 'PKR',
      dueDate: day(30),
      items: [
        { description: 'Counselling', quantity: 1, unitAmount: 100_000_00, category: 'service' },
        { description: 'Visa fee paid for you', quantity: 1, unitAmount: 50_000_00, category: 'disbursement' },
      ],
    });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    const pay = await alphaM('POST', `/billing/invoices/${inv.body.id}/payments`, { amount: 75_000_00, method: 'cash', receivedOn: day(0) });
    assert.equal(pay.status, 201, JSON.stringify(pay.body));
    const paymentId = pay.body.payments.find((p: any) => p.kind === 'payment').id;
    const fee = (await earningsOf(master)).find((e) => e.kind === 'fee_share');
    assert.equal(fee.basisAmount, 50_000_00, 'the counselling share of the 75,000 paid');
    assert.equal(fee.amount, 5_000_00);
    const refund = await alphaM('POST', `/billing/invoices/${inv.body.id}/payments`, { kind: 'refund', amount: 15_000_00, method: 'cash', receivedOn: day(0) });
    assert.equal(refund.status, 201, JSON.stringify(refund.body));
    const back = (await earningsOf(master)).find((e) => e.kind === 'clawback' && e.description.startsWith('Refund'));
    assert.equal(back.amount, -1_000_00, '10% of the 10,000 in fees refunded');
    assert.equal((await alphaM('POST', `/billing/payments/${paymentId}/void`, { reason: 'Recorded against the wrong invoice' })).status, 400, 'more refunded than paid');
    const refundId = (await alphaM('GET', `/billing/invoices/${inv.body.id}`)).body.payments.find((p: any) => p.kind === 'refund').id;
    assert.equal((await alphaM('POST', `/billing/payments/${refundId}/void`, { reason: 'Refund entered by mistake' })).status, 201);
    assert.equal((await alphaM('POST', `/billing/payments/${paymentId}/void`, { reason: 'Recorded against the wrong invoice' })).status, 201);
    const after = await earningsOf(master);
    assert.equal(after.find((e) => e.kind === 'fee_share').status, 'reversed');
    assert.equal(after.find((e) => e.id === back.id).status, 'reversed');
    await booksBalance(fx.alpha.id);
  });
});

describe('payouts', () => {
  let payoutId = '';

  test('withholding, an advance taken back, and a second person to approve', async () => {
    assert.equal((await alphaC('PUT', `/partners/${master}/bank`, { accountTitle: 'LGE', bankName: 'Meezan', iban: 'PK36MEZN0002010101234567' })).status, 403);
    assert.equal((await alphaM('PUT', `/partners/${master}/bank`, { accountTitle: 'Lahore Global Education', bankName: 'Meezan Bank', iban: 'PK36 MEZN 0002 0101 0123 4567' })).status, 204);
    assert.match((await alphaM('GET', `/partners/${master}`)).body.bank.iban, /^PK36MEZN/);
    assert.equal((await owner('GET', '/partner-portal/me')).body.bank.iban, 'PK36MEZN0002010101234567', 'the owner sees its own');

    const adv = await alphaM('POST', '/partners/advances', { partnerId: master, amount: 20_000, currency: 'PKR', givenOn: day(-1), accountId: accounts.bank, reason: 'Office set-up advance' });
    assert.equal(adv.status, 201, JSON.stringify(adv.body));
    assert.deepEqual(await linesOf('partner_advance', adv.body[0].id), { partner_advances: 20_000_00, bank: -20_000_00 });

    const owed = (await earningsOf(master)).filter((e) => e.status === 'payable' && e.currency === 'PKR').reduce((n, e) => n + e.amount, 0);
    assert.equal(owed, 10_000_00 + 360_000_00 + 18_000_00);
    const p = await alphaM('POST', '/partners/payouts', { partnerId: master, currency: 'PKR', periodLabel: 'September 2026' });
    assert.equal(p.status, 201, JSON.stringify(p.body));
    payoutId = p.body.id;
    assert.equal(p.body.gross, owed);
    assert.equal(p.body.withholding, Math.round(owed / 10));
    assert.equal(p.body.advanceRecovered, 20_000_00);
    assert.equal(p.body.net, owed - Math.round(owed / 10) - 20_000_00);
    assert.equal(p.body.earnings.length, 3);
    assert.equal((await alphaM('POST', '/partners/payouts', { partnerId: master, currency: 'PKR', periodLabel: 'Again' })).status, 400, 'nothing left to pay');
    assert.equal((await owner('GET', '/partner-portal/payouts')).body.length, 0, 'drafts are the consultancy’s');

    assert.equal((await alphaM('POST', `/partners/payouts/${payoutId}/approve`)).status, 403, 'not by whoever prepared it');
    assert.equal((await alphaC('POST', `/partners/payouts/${payoutId}/approve`)).status, 403, 'not without the permission');
    await setPermission('alpha', 'payout.manage', 'allow');
    await setPermission('alpha', 'partner.view', 'allow');
    assert.equal((await alphaC('POST', `/partners/payouts/${payoutId}/approve`)).status, 201);
    const paid = await alphaM('POST', `/partners/payouts/${payoutId}/pay`, { paidOn: day(0), accountId: accounts.bank, method: 'bank_transfer', reference: 'IBFT-4471' });
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
    assert.equal(paid.body.status, 'paid');
    assert.deepEqual(await linesOf('payout', payoutId), {
      partner_payable: owed,
      withholding_payable: -Math.round(owed / 10),
      partner_advances: -20_000_00,
      bank: -(owed - Math.round(owed / 10) - 20_000_00),
    });
    assert.ok((await earningsOf(master)).filter((e) => e.payoutId === payoutId).every((e) => e.status === 'paid'));
    assert.equal((await alphaM('GET', `/partners/advances?partnerId=${master}`)).body[0].outstanding, 0);
    const statement = await owner('GET', `/partner-portal/payouts/${payoutId}/statement`);
    assert.equal(statement.raw.subarray(0, 4).toString(), '%PDF');
    assert.equal((await counsellor('GET', '/partner-portal/payouts')).status, 403);
    await booksBalance(fx.alpha.id);
  });

  test('a clawback after payment is owed back, so the next payout has nothing to pay', async () => {
    const [mine] = (await alphaM('GET', `/cases/${fx.alpha.caseId}/commissions`)).body;
    const cb = await alphaM('POST', `/commissions/${mine.id}/clawback`, { reason: 'Withdrew in week two', amount: 1000 });
    assert.equal(cb.status, 201, JSON.stringify(cb.body));
    const back = (await earningsOf(master)).find((e) => e.kind === 'clawback' && e.description.includes('clawed back'));
    assert.equal(back.amount, -(180_000_00 + 10_000_00), 'half the share, and the per-student amount');
    const next = await alphaM('POST', '/partners/payouts', { partnerId: master, currency: 'PKR', periodLabel: 'October 2026' });
    assert.equal(next.status, 400);
    assert.match(next.body.message, /nets to/);
  });

  test('voiding a paid payout reverses it and puts the earnings and the advance back', async () => {
    const v = await alphaM('POST', `/partners/payouts/${payoutId}/void`, { reason: 'Paid to the wrong account' });
    assert.equal(v.status, 201, JSON.stringify(v.body));
    assert.equal(v.body.status, 'void');
    assert.ok((await earningsOf(master)).filter((e) => ['fixed_per_student', 'commission_share', 'override'].includes(e.kind) && e.status !== 'reversed').every((e) => e.status === 'payable'));
    assert.equal((await alphaM('GET', `/partners/advances?partnerId=${master}`)).body[0].outstanding, 20_000_00);
    const rev = await linesOf('reversal', payoutId);
    assert.equal(rev.bank, 0 - (await linesOf('payout', payoutId)).bank!);
    await booksBalance(fx.alpha.id);
    await setPermission('alpha', 'payout.manage', 'inherit');
    await setPermission('alpha', 'partner.view', 'inherit');
  });
});

describe('the partner portal', () => {
  test('the dashboard: students, results, money owed and the next tier', async () => {
    const d = await owner('GET', '/partner-portal/dashboard');
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.equal(d.body.counts.students, 3, 'its own two and its sub-agent’s one');
    assert.equal(d.body.kyc, 'approved');
    assert.equal(d.body.agreement.status, 'signed');
    assert.ok(d.body.earnings.some((e: any) => e.currency === 'PKR'));
    assert.equal(d.body.nextTier.tier, 'silver');
    const c = await counsellor('GET', '/partner-portal/dashboard');
    assert.equal(c.body.earnings.length, 0, 'counsellors do not see money');
  });

  test('documents for its students: uploaded, listed and read; not another partner’s', async () => {
    const [student] = (await owner('GET', '/partner-portal/students')).body.filter((s: any) => s.viaPartnerName === null && s.fullName === 'Zara Malik');
    const u = await partnerUpload(`/partner-portal/students/${student.clientId}/documents`, { type: 'passport' }, pdf('zara-passport'), 'passport.pdf');
    assert.equal(u.status, 201, JSON.stringify(u.body));
    const doc = u.body.documentList.find((d: any) => d.byYou);
    assert.ok(doc);
    assert.ok(u.body.documents >= 1, 'the student list counts their documents');
    const file = await owner('GET', `/partner-portal/students/${student.clientId}/documents/${doc.id}`);
    assert.equal(file.raw.subarray(0, 4).toString(), '%PDF');
    // Staff see it in the student's drive, uploaded by the partner.
    const staffList = await alphaM('GET', `/documents?clientId=${student.clientId}&pageSize=50`);
    assert.ok(staffList.body.items.some((d: any) => d.id === doc.id));
    assert.equal((await owner('GET', `/partner-portal/students/${fx.bravo.clientId}`)).status, 404);
  });

  test('the marketing library: only folders shared with partners', async () => {
    const f = await alphaM('POST', '/drive/folders', { name: 'Brochures for partners', sharedWithPartners: true });
    assert.equal(f.status, 201, JSON.stringify(f.body));
    const hidden = await alphaM('POST', '/drive/folders', { name: 'Internal pricing' });
    for (const [folderId, name] of [[f.body.id, 'brochure.pdf'], [hidden.body.id, 'pricing.pdf']]) {
      const u = await upload('alphaManager', '/drive/upload', { folderId }, { name, type: 'application/pdf', bytes: pdf(name) });
      assert.equal(u.status, 201, JSON.stringify(u.body));
    }
    const lib = await owner('GET', '/partner-portal/resources');
    const files = lib.body.folders.flatMap((x: any) => x.files.map((y: any) => y.name));
    assert.ok(files.includes('brochure.pdf'));
    assert.ok(!files.includes('pricing.pdf'));
    const brochure = lib.body.folders.flatMap((x: any) => x.files).find((y: any) => y.name === 'brochure.pdf');
    assert.equal((await owner('GET', `/partner-portal/resources/${brochure.id}`)).status, 200);
  });

  test('messages both ways, each side told', async () => {
    const m = await owner('POST', '/partner-portal/messages', { body: 'When is the CAS for Zara expected?' });
    assert.equal(m.status, 201, JSON.stringify(m.body));
    const staff = await alphaM('GET', `/partners/${master}/messages`);
    assert.equal(staff.body.length, 1);
    const reply = await alphaM('POST', `/partners/${master}/messages`, { body: 'Next week, after the deposit clears.' });
    assert.equal(reply.status, 201);
    const thread = await owner('GET', '/partner-portal/messages');
    assert.deepEqual(thread.body.map((x: any) => x.fromPartner), [true, false]);
    const consultantBell = await alphaC('GET', '/notifications?limit=20');
    assert.ok(consultantBell.body.items.some((n: any) => n.title.startsWith('Message from Lahore Global Education')), 'its manager hears');
  });

  test('announcements to partners reach partners', async () => {
    const a = await alphaM('POST', '/announcements', { title: 'New UK intakes open', body: 'January intakes are open at six partner universities.', audience: 'partners' });
    assert.equal(a.status, 201, JSON.stringify(a.body));
    const d = await owner('GET', '/partner-portal/dashboard');
    assert.ok(d.body.announcements.some((x: any) => x.title === 'New UK intakes open'));
    const staffFeed = await alphaC('GET', '/announcements');
    assert.ok(!(staffFeed.body as any[]).some((x: any) => x.title === 'New UK intakes open'), 'not shown to staff as theirs');
  });
});

describe('suspension, leaderboard, isolation', () => {
  test('a suspended partner registers nobody and is not paid; terminating closes its logins', async () => {
    assert.equal((await alphaM('POST', `/partners/${sub}/status`, { status: 'suspended', reason: 'Complaint under review' })).status, 201);
    const subPartner = await alphaM('POST', `/partners/${sub}/members`, { fullName: 'Sub Owner', email: 'owner@msl.example', role: 'owner', password: PASSWORD });
    assert.equal(subPartner.status, 201);
    const subSession = await signIn(HOST.alpha, 'owner@msl.example');
    const subCall = (method: string, url: string, json?: unknown) => call(method, url, { host: HOST.alpha, session: subSession, json });
    assert.equal((await subCall('POST', '/partner-portal/students', { fullName: 'New One', email: 'new.one@example.com', phone: '+92 333 000 1122', consent: true })).status, 403);
    assert.equal((await alphaM('POST', '/partners/payouts', { partnerId: sub, currency: 'PKR', periodLabel: 'Now' })).status, 400);
    assert.equal((await alphaM('POST', `/partners/${sub}/status`, { status: 'terminated', reason: 'Relationship ended' })).status, 201);
    assert.equal((await subCall('GET', '/partner-portal/dashboard')).status, 401, 'its logins are switched off');
  });

  test('the leaderboard ranks by enrolments', async () => {
    const l = await alphaM('GET', '/partners/leaderboard');
    assert.equal(l.status, 200, JSON.stringify(l.body));
    const top = l.body.rows[0];
    assert.equal(top.partnerId, master);
    assert.equal(top.rank, 1);
    assert.equal(top.enrolled, 1);
  });

  test('another consultancy and people without the permission see none of it', async () => {
    assert.equal((await alphaC('GET', '/partners')).status, 403);
    assert.equal((await bravoM('GET', '/partners')).body.items.length, 0);
    assert.equal((await bravoM('GET', `/partners/payouts/${(await alphaM('GET', '/partners/payouts')).body[0].id}`)).status, 404);
    assert.equal((await bravoM('GET', `/partners/earnings?partnerId=${master}`)).body.items.length, 0);
    assert.equal((await bravoM('GET', '/partners/conflicts')).body.length, 0);
    assert.equal((await bravoM('PUT', `/partners/students/${fx.alpha.clientId}`, { partnerId: null, reason: 'Taking it over' })).status, 404);
    assert.equal((await owner('GET', '/partners/leaderboard')).status, 403);
    await booksBalance(fx.alpha.id);
    await booksBalance(fx.bravo.id);
  });
});
