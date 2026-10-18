/**
 * Paying for the platform: the date a consultancy has paid until decides
 * what its staff can do, the platform admin records payments, managers are
 * reminded and see their own subscription, and the platform's terms and
 * privacy policy are published. Plus the cross-site write check.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { HOST, OUTBOX, PASSWORD, appGet, as, call, db, fx, schema, session, startApp, stopApp } from './harness';

before(startApp);
after(stopApp);

const shared = require('@crm/shared') as typeof import('@crm/shared');
const { EntitlementsService } = require('../src/tenancy/entitlements.service') as typeof import('../src/tenancy/entitlements.service');
const { SubscriptionsService } = require('../src/tenancy/subscriptions.service') as typeof import('../src/tenancy/subscriptions.service');
const { today } = require('../src/common/db-helpers') as typeof import('../src/common/db-helpers');

const day = (offset: number) => shared.addCalendarDays(today(), offset);

/** Moves alpha's paid-until date, as if the calendar had moved on. */
async function paidUntil(date: string | null, status: 'trialing' | 'active' | 'past_due' | 'cancelled' = 'active') {
  await db().update(schema.tenants).set({ currentPeriodEnd: date, subscriptionStatus: status, renewalNoticeKey: null }).where(eq(schema.tenants.id, fx.alpha.id));
  appGet<InstanceType<typeof EntitlementsService>>(EntitlementsService).invalidate();
}

function mailsTo(email: string): { subject: string; body: string }[] {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs
    .readdirSync(OUTBOX)
    .filter((f) => f.endsWith('.eml'))
    .sort()
    .map((f) => fs.readFileSync(path.join(OUTBOX, f), 'utf8'))
    .map((m) => m.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))))
    .filter((m) => new RegExp(`^To: .*${email.replace(/[.+]/g, '\\$&')}`, 'mi').test(m))
    .map((m) => ({
      subject: Buffer.from(/^Subject: (.*)$/im.exec(m)?.[1] ?? '', 'latin1').toString('utf8').replace(/=\?UTF-8\?Q\?|\?=/gi, '').replace(/_/g, ' '),
      body: m,
    }));
}

const alphaM = as('alphaManager');
const alphaC = as('alphaConsultant');
const alphaS = as('alphaClient');
const bravoC = as('bravoConsultant');
const root = as('root');

/** A small change any consultant may make: their client's city. */
const touchClient = (who: typeof alphaC, city: string) => who('PATCH', `/clients/${fx.alpha.clientId}`, { city });

describe('the date paid until', () => {
  test('decides open, ending soon, grace and read-only - and cancelled ends without grace', () => {
    const s = shared.subscriptionState;
    assert.deepEqual(s('active', null, '2026-10-18', 7), { access: 'open', paidUntil: null, daysLeft: null, graceEndsOn: null, endingSoon: false });
    assert.equal(s('active', '2026-11-30', '2026-10-18').endingSoon, false);
    assert.equal(s('active', '2026-10-25', '2026-10-18').endingSoon, true);
    assert.equal(s('active', '2026-10-18', '2026-10-18').access, 'open', 'the last paid day is still paid');
    const grace = s('active', '2026-10-17', '2026-10-18', 7);
    assert.equal(grace.access, 'grace');
    assert.equal(grace.graceEndsOn, '2026-10-24');
    assert.equal(s('active', '2026-10-17', '2026-10-24', 7).access, 'grace', 'the last grace day still works');
    assert.equal(s('active', '2026-10-17', '2026-10-25', 7).access, 'read_only');
    assert.equal(s('cancelled', '2026-10-17', '2026-10-18', 7).access, 'read_only', 'cancelled: no grace');
    assert.equal(s('cancelled', '2026-10-30', '2026-10-18', 7).access, 'open', 'cancelled keeps what was paid for');
    assert.equal(s('past_due', '2026-10-30', '2026-10-18', 7).access, 'grace', 'marked overdue by hand: a warning, not a lock');
    assert.equal(shared.addCalendarMonths('2027-01-31', 1), '2027-02-28');
    assert.equal(shared.addCalendarMonths('2028-01-31', 1), '2028-02-29');
    assert.equal(shared.addCalendarMonths('2026-12-15', 2), '2027-02-15');
  });

  test('a new consultancy starts on the platform’s trial unless the admin says otherwise', async () => {
    const make = (slug: string, extra: Record<string, unknown> = {}) =>
      root('POST', '/admin/tenants', { name: `Trial ${slug}`, slug, manager: { fullName: 'Tess Trial', email: `tess@${slug}.test`, password: PASSWORD }, ...extra });
    const standard = await make('trialone');
    assert.equal(standard.status, 201, JSON.stringify(standard.body));
    assert.equal(standard.body.subscriptionStatus, 'trialing');
    assert.equal(standard.body.subscription.paidUntil, day(shared.DEFAULT_TRIAL_DAYS));

    const open = await make('trialtwo', { trialEndsOn: null });
    assert.equal(open.body.subscription.paidUntil, null, 'null: no end date');

    const set = await make('trialthree', { trialEndsOn: day(30) });
    assert.equal(set.body.subscription.paidUntil, day(30));

    await root('PUT', '/admin/platform/settings/billing', { paymentInstructions: '', graceDays: 7, trialDays: 0 });
    const none = await make('trialfour');
    assert.equal(none.body.subscription.paidUntil, null, 'a 0-day trial leaves no end date');
    await root('PUT', '/admin/platform/settings/billing', { paymentInstructions: '', graceDays: 7, trialDays: shared.DEFAULT_TRIAL_DAYS });
  });

  test('in the grace days everything works and staff are told; afterwards staff read but do not write', async () => {
    await paidUntil(day(-3));
    let e = await alphaM('GET', '/tenancy/entitlements');
    assert.equal(e.body.subscription.access, 'grace');
    assert.equal(e.body.subscription.graceEndsOn, day(4));
    assert.equal((await touchClient(alphaC, 'Lahore')).status, 200, 'grace: writes still work');

    await paidUntil(day(-8));
    e = await alphaM('GET', '/tenancy/entitlements');
    assert.equal(e.body.subscription.access, 'read_only');

    const refused = await touchClient(alphaC, 'Karachi');
    assert.equal(refused.status, 403);
    assert.equal(refused.body.code, 'SUBSCRIPTION_LAPSED');
    assert.match(refused.body.message, /read-only/);
    const managerRefused = await alphaM('POST', '/tasks', { title: 'Call the bank' });
    assert.equal(managerRefused.status, 403);
    assert.match(managerRefused.body.message, /Subscription/, 'the manager is pointed at where to renew');

    // Reading, exporting, their own security and answering students carry on.
    assert.equal((await alphaC('GET', '/clients')).status, 200);
    assert.equal((await alphaC('GET', `/clients/${fx.alpha.clientId}`)).status, 200);
    assert.equal((await alphaM('GET', '/export/clients')).status, 200);
    assert.equal((await alphaM('POST', '/auth/mfa/setup')).status, 200);
    assert.equal((await alphaM('POST', '/notifications/read-all')).status, 204);
    const reply = await alphaC('POST', '/messages', { caseId: fx.alpha.caseId, body: 'We are on it.' });
    assert.ok(reply.status < 300, `a reply to a student still goes: ${reply.status}`);

    // The consultancy's customers are not punished for its bill.
    const student = await alphaS('POST', '/messages', { caseId: fx.alpha.caseId, body: 'Any news?' });
    assert.ok(student.status < 300, `students still write: ${student.status}`);

    // And nobody else is touched.
    assert.equal((await bravoC('GET', '/tenancy/entitlements')).body.subscription.access, 'open');
    const bravoTouch = await bravoC('PATCH', `/clients/${fx.bravo.clientId}`, { city: 'Multan' });
    assert.equal(bravoTouch.status, 200);
  });

  test('a payment opens it again: from the day paid after a long lapse, from where it stood otherwise', async () => {
    await paidUntil(day(-20));
    const pay = (json: Record<string, unknown>) => root('POST', `/admin/tenants/${fx.alpha.id}/payments`, json);

    const first = await pay({ amount: 15_000_00, currency: 'PKR', months: 1, receivedOn: today(), method: 'bank_transfer', reference: 'HBL-1001' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const firstTo = shared.addCalendarDays(shared.addCalendarMonths(today(), 1), -1);
    assert.equal(first.body.subscription.paidUntil, firstTo, 'a lapse past the grace days restarts from the day paid');
    assert.equal(first.body.subscription.access, 'open');
    assert.equal(first.body.subscriptionStatus, 'active');
    appGet<InstanceType<typeof EntitlementsService>>(EntitlementsService).invalidate();
    assert.equal((await touchClient(alphaC, 'Quetta')).status, 200, 'staff can write again at once');

    const second = await pay({ amount: 45_000_00, currency: 'PKR', months: 3, receivedOn: today(), method: 'online' });
    const from = shared.addCalendarDays(firstTo, 1);
    assert.equal(second.body.subscription.paidUntil, shared.addCalendarDays(shared.addCalendarMonths(from, 3), -1), 'paying early continues from the paid date');

    const list = await root('GET', `/admin/tenants/${fx.alpha.id}/payments`);
    assert.equal(list.body.length, 2);
    assert.equal(list.body[0].months + list.body[1].months, 4);
    assert.equal(list.body.find((p: { reference: string | null }) => p.reference === 'HBL-1001').recordedBy, 'Platform Root');

    const receipt = mailsTo(fx.alpha.managerEmail).filter((m) => /subscription paid until/.test(m.subject));
    assert.equal(receipt.length, 2, 'the manager gets a receipt for each');
    assert.match(receipt[0]!.body, /HBL-1001/);

    const mine = await alphaM('GET', '/tenancy/subscription');
    assert.equal(mine.status, 200);
    assert.equal(mine.body.payments.length, 2);
    assert.ok(mine.body.payments.every((p: { recordedBy: string | null }) => p.recordedBy === null), 'who on the platform recorded it is not shown');
    assert.equal((await alphaC('GET', '/tenancy/subscription')).status, 403, 'a manager’s page');
    assert.equal((await as('bravoManager')('GET', '/tenancy/subscription')).body.payments.length, 0, 'each consultancy sees its own');

    const audit = await db().select().from(schema.auditLog).where(eq(schema.auditLog.action, 'tenant.subscription_paid'));
    assert.equal(audit.length, 2);
  });

  test('only the platform admin records payments and changes the platform’s settings', async () => {
    const bad = { amount: 1, currency: 'PKR', months: 1, receivedOn: today(), method: 'cash' };
    assert.equal((await alphaM('POST', `/admin/tenants/${fx.alpha.id}/payments`, bad)).status, 403);
    assert.equal((await alphaM('PUT', '/admin/platform/settings/billing', { paymentInstructions: 'x', graceDays: 60, trialDays: 1 })).status, 403);
    assert.equal((await alphaM('GET', '/admin/platform/settings')).status, 403);
    assert.equal((await root('POST', `/admin/tenants/${fx.alpha.id}/payments`, { ...bad, months: 0 })).status, 400);
    assert.equal((await root('POST', `/admin/tenants/${fx.alpha.id}/payments`, { ...bad, amount: 0 })).status, 400);
    assert.equal((await root('PUT', '/admin/platform/settings/billing', { paymentInstructions: 'x', graceDays: 61, trialDays: 1 })).status, 400);
  });

  test('managers are reminded once per stage: ending soon, overdue, read-only', async () => {
    await root('PUT', '/admin/platform/settings/billing', { paymentInstructions: 'Meezan Bank, IBAN PK00 MEZN 0000 1234', graceDays: 7, trialDays: 14 });
    const sweep = appGet<InstanceType<typeof SubscriptionsService>>(SubscriptionsService);
    const count = () => mailsTo(fx.alpha.managerEmail).length;

    await paidUntil(day(3));
    let before = count();
    await sweep.remind();
    await sweep.remind();
    let mails = mailsTo(fx.alpha.managerEmail).slice(before);
    assert.equal(mails.length, 1, 'one reminder, however often the sweep runs');
    assert.match(mails[0]!.subject, /runs until/);
    assert.match(mails[0]!.body, /IBAN PK00 MEZN 0000 1234/, 'with how to pay');
    assert.match(mails[0]!.body, /\/overview\/subscription/);

    await paidUntil(day(-2));
    before = count();
    await sweep.remind();
    mails = mailsTo(fx.alpha.managerEmail).slice(before);
    assert.equal(mails.length, 1);
    assert.match(mails[0]!.subject, /overdue/);

    await db().update(schema.tenants).set({ currentPeriodEnd: day(-9) }).where(eq(schema.tenants.id, fx.alpha.id));
    before = count();
    await sweep.remind();
    await sweep.remind();
    mails = mailsTo(fx.alpha.managerEmail).slice(before);
    assert.equal(mails.length, 1);
    assert.match(mails[0]!.subject, /read-only/);

    await paidUntil(day(-9), 'cancelled');
    before = count();
    await sweep.remind();
    assert.equal(count(), before, 'a cancelled subscription is not chased');

    await paidUntil(null);
  });
});

describe('what students and partners learn about the consultancy', () => {
  test('the menu, not the plan, its size or whether it has paid', async () => {
    await paidUntil(day(-30));
    const e = await alphaS('GET', '/tenancy/entitlements');
    assert.equal(e.status, 200);
    assert.ok(Array.isArray(e.body.modules) && e.body.modules.length > 0);
    assert.equal(e.body.planName, null);
    assert.equal(e.body.subscription.access, 'open');
    assert.equal(e.body.subscription.paidUntil, null);
    assert.deepEqual(e.body.usage, { staff: 0, activeClients: 0, storageBytes: 0 });
    await paidUntil(null);
  });
});

describe('terms and privacy policy', () => {
  test('published by the platform admin, readable by anyone, and on the launch checklist', async () => {
    const before = await call('GET', '/tenancy/legal', { host: HOST.alpha });
    assert.equal(before.status, 200);
    assert.equal(before.body.terms, null);
    let ready = await root('GET', '/admin/platform/readiness');
    assert.equal(ready.body.checks.find((c: { key: string }) => c.key === 'legal').ok, false);

    const saved = await root('PUT', '/admin/platform/settings/legal', { operatorName: 'Acme CRM Ltd', terms: 'Terms text', privacy: 'Privacy text' });
    assert.equal(saved.status, 200);
    const after = await call('GET', '/tenancy/legal', { host: HOST.bravo });
    assert.deepEqual([after.body.operatorName, after.body.terms, after.body.privacy], ['Acme CRM Ltd', 'Terms text', 'Privacy text']);
    assert.ok(after.body.updatedAt);
    ready = await root('GET', '/admin/platform/readiness');
    assert.equal(ready.body.checks.find((c: { key: string }) => c.key === 'legal').ok, true);
    assert.equal((await alphaM('PUT', '/admin/platform/settings/legal', { operatorName: 'x', terms: '', privacy: '' })).status, 403);
  });
});

describe('writes from another site', () => {
  test('are refused when they carry a session, whatever the cookie says', async () => {
    const write = (origin?: string) =>
      call('POST', '/notifications/read-all', { host: HOST.alpha, session: session.alphaManager, headers: origin ? { origin } : {} });
    assert.equal((await write('http://bravo.localhost:3000')).status, 403, 'a sibling consultancy’s page');
    assert.equal((await write('https://evil.example')).status, 403);
    assert.equal((await write('null')).status, 403, 'a sandboxed frame');
    assert.equal((await write('http://alpha.localhost:3000')).status, 204, 'its own pages');
    assert.equal((await write()).status, 204, 'scripts and the server send no Origin');
    // Without a session there is nothing to forge: sign-in from anywhere still answers normally.
    const signIn = await call('POST', '/auth/sign-in', { host: HOST.alpha, json: { email: 'nobody@alpha.test', password: 'wrong-password' }, headers: { origin: 'https://evil.example' } });
    assert.equal(signIn.status, 401);
  });
});
