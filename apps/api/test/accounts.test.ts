/**
 * Getting into an account and running a consultancy's own white label:
 * "forgot my password", invitations staff send, sessions that end when a
 * password changes, a manager's own branding and domain, and the DNS check
 * that connects a domain.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { HOST, OUTBOX, PASSWORD, as, call, db, fx, schema, setPermission, signIn, startApp, stopApp } from './harness';

before(startApp);
after(stopApp);

const dns = require('../src/tenancy/domain-dns') as typeof import('../src/tenancy/domain-dns');

/** Every email sent to someone, oldest first, with quoted-printable undone. */
function mailsTo(email: string): string[] {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs
    .readdirSync(OUTBOX)
    .filter((f) => f.endsWith('.eml'))
    .sort()
    .map((f) => fs.readFileSync(path.join(OUTBOX, f), 'utf8'))
    .map((m) => m.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16))))
    .filter((m) => new RegExp(`^To: .*${email.replace(/[.+]/g, '\\$&')}`, 'mi').test(m));
}

function lastLink(email: string): { url: string; token: string } {
  const mail = mailsTo(email).at(-1);
  assert.ok(mail, `an email went to ${email}`);
  const m = /(https?:\/\/[^\s"<]+\/reset-password\?token=([A-Za-z0-9_-]+))/.exec(mail);
  assert.ok(m, 'the email carries a set-password link');
  return { url: m[1]!, token: m[2]! };
}

/** A fresh member of staff, so ending their sessions leaves the fixtures' sessions alone. */
let seq = 0;
async function newStaff(tenant: 'alpha' | 'bravo'): Promise<{ id: string; email: string }> {
  const { hash } = require('bcryptjs') as typeof import('bcryptjs');
  const email = `staff${++seq}@${tenant}.test`;
  const [u] = await db()
    .insert(schema.users)
    .values({ tenantId: fx[tenant].id, email, passwordHash: await hash(PASSWORD, 4), fullName: `Sam Staff${seq}`, role: 'consultant' })
    .returning({ id: schema.users.id });
  await db().insert(schema.consultants).values({ tenantId: fx[tenant].id, userId: u!.id });
  return { id: u!.id, email };
}

const me = (host: string, cookie: string) => call('GET', '/auth/me', { host, session: cookie });

describe('forgot password', () => {
  test('the same answer whether or not the email has an account, and an email only for a real one, on its own site', async () => {
    const nobody = await call('POST', '/auth/password/forgot', { host: HOST.alpha, json: { email: 'nobody@nowhere.test' } });
    assert.equal(nobody.status, 204);
    assert.equal(mailsTo('nobody@nowhere.test').length, 0);

    const staff = await newStaff('alpha');
    const wrongSite = await call('POST', '/auth/password/forgot', { host: HOST.bravo, json: { email: staff.email } });
    assert.equal(wrongSite.status, 204, 'the same answer on another consultancy’s site');
    assert.equal(mailsTo(staff.email).length, 0, 'but nothing is sent: the account is not theirs');

    const real = await call('POST', '/auth/password/forgot', { host: HOST.alpha, json: { email: staff.email.toUpperCase() } });
    assert.equal(real.status, 204);
    const { url } = lastLink(staff.email);
    assert.match(url, /^http:\/\/alpha\.localhost(:\d+)?\/reset-password\?token=/, 'the link leads to the consultancy’s own address');

    const unknownSite = await call('POST', '/auth/password/forgot', { host: 'nowhere.example.com', json: { email: staff.email } });
    assert.equal(unknownSite.status, 404);
  });

  test('a link sets the password once, works only on its own site, and ends every old session', async () => {
    const staff = await newStaff('alpha');
    const oldSession = await signIn(HOST.alpha, staff.email);
    await call('POST', '/auth/password/forgot', { host: HOST.alpha, json: { email: staff.email } });
    const { token } = lastLink(staff.email);

    const foreign = await call('GET', `/auth/password/link?token=${token}`, { host: HOST.bravo });
    assert.equal(foreign.status, 404, 'another consultancy’s site does not accept it');
    const info = await call('GET', `/auth/password/link?token=${token}`, { host: HOST.alpha });
    assert.equal(info.status, 200);
    assert.equal(info.body.purpose, 'reset');
    assert.equal(info.body.email, staff.email);
    assert.equal(info.body.firstName, 'Sam');

    const short = await call('POST', '/auth/password/set', { host: HOST.alpha, json: { token, password: 'short' } });
    assert.equal(short.status, 400);

    const set = await call('POST', '/auth/password/set', { host: HOST.alpha, json: { token, password: 'brand-new-password' } });
    assert.equal(set.status, 200);
    assert.equal((await me(HOST.alpha, oldSession)).status, 401, 'the session from before the reset is over');

    const oldPassword = await call('POST', '/auth/sign-in', { host: HOST.alpha, json: { email: staff.email, password: PASSWORD } });
    assert.equal(oldPassword.status, 401);
    const fresh = await signIn(HOST.alpha, staff.email, 'brand-new-password');
    assert.equal((await me(HOST.alpha, fresh)).status, 200);

    const again = await call('POST', '/auth/password/set', { host: HOST.alpha, json: { token, password: 'another-password' } });
    assert.equal(again.status, 410, 'a link works once');
    const forged = await call('GET', '/auth/password/link?token=not-a-real-token-at-all-xxxxxxxx', { host: HOST.alpha });
    assert.equal(forged.status, 404);
  });

  test('only the newest link works, links expire, and an account gets at most three emails an hour', async () => {
    const staff = await newStaff('alpha');
    await call('POST', '/auth/password/forgot', { host: HOST.alpha, json: { email: staff.email } });
    const first = lastLink(staff.email).token;
    await call('POST', '/auth/password/forgot', { host: HOST.alpha, json: { email: staff.email } });
    const second = lastLink(staff.email).token;
    assert.notEqual(first, second);
    assert.equal((await call('GET', `/auth/password/link?token=${first}`, { host: HOST.alpha })).status, 410, 'a newer email replaces the older one');

    await db()
      .update(schema.passwordTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(schema.passwordTokens.userId, staff.id));
    const expired = await call('GET', `/auth/password/link?token=${second}`, { host: HOST.alpha });
    assert.equal(expired.status, 410);
    assert.match(expired.body.message, /expired/);

    await call('POST', '/auth/password/forgot', { host: HOST.alpha, json: { email: staff.email } });
    await call('POST', '/auth/password/forgot', { host: HOST.alpha, json: { email: staff.email } });
    assert.equal(mailsTo(staff.email).length, 3, 'the fourth request in an hour sends nothing');
  });

  test('a switched-off login gets no link, and its old link stops working', async () => {
    const staff = await newStaff('alpha');
    await call('POST', '/auth/password/forgot', { host: HOST.alpha, json: { email: staff.email } });
    const { token } = lastLink(staff.email);
    await db().update(schema.users).set({ isActive: false }).where(eq(schema.users.id, staff.id));
    assert.equal((await call('GET', `/auth/password/link?token=${token}`, { host: HOST.alpha })).status, 404);
    await call('POST', '/auth/password/forgot', { host: HOST.alpha, json: { email: staff.email } });
    assert.equal(mailsTo(staff.email).length, 1);
  });
});

describe('sessions', () => {
  test('changing your password keeps you signed in here and signs you out everywhere else', async () => {
    const staff = await newStaff('alpha');
    const laptop = await signIn(HOST.alpha, staff.email);
    const phone = await signIn(HOST.alpha, staff.email);
    const change = await call('POST', '/auth/password', {
      host: HOST.alpha,
      session: laptop,
      json: { currentPassword: PASSWORD, newPassword: 'a-better-password' },
    });
    assert.equal(change.status, 204);
    const renewed = change.headers.getSetCookie().find((c) => c.startsWith('crm_session='))!.split(';')[0]!;
    assert.equal((await me(HOST.alpha, renewed)).status, 200, 'the laptop carries on with its renewed session');
    assert.equal((await me(HOST.alpha, phone)).status, 401, 'the phone is signed out');
  });

  test('“sign out everywhere else” ends every other session', async () => {
    const staff = await newStaff('alpha');
    const here = await signIn(HOST.alpha, staff.email);
    const elsewhere = await signIn(HOST.alpha, staff.email);
    const res = await call('POST', '/auth/sessions/end-others', { host: HOST.alpha, session: here });
    assert.equal(res.status, 204);
    const renewed = res.headers.getSetCookie().find((c) => c.startsWith('crm_session='))!.split(';')[0]!;
    assert.equal((await me(HOST.alpha, renewed)).status, 200);
    assert.equal((await me(HOST.alpha, elsewhere)).status, 401);
    const audit = await db().select().from(schema.auditLog).where(eq(schema.auditLog.entityId, staff.id));
    assert.ok(audit.some((a) => a.action === 'user.sessions_ended'));
  });
});

describe('invitations', () => {
  test('a client is invited and chooses their own password; staff never know it', async () => {
    const created = await as('alphaManager')('POST', '/clients', {
      fullName: 'Hira Invited',
      email: 'hira.invited@example.test',
      phone: '+92 300 1234567',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const clientId = created.body.id as string;

    const across = await as('bravoManager')('POST', `/clients/${clientId}/portal-invite`);
    assert.equal(across.status, 404, 'another consultancy cannot invite this client');

    const invite = await as('alphaManager')('POST', `/clients/${clientId}/portal-invite`);
    assert.equal(invite.status, 200);
    assert.equal(invite.body.emailed, true);
    const { token, url } = lastLink('hira.invited@example.test');
    assert.equal(url, invite.body.link, 'staff get the same link to send by WhatsApp');
    const mail = mailsTo('hira.invited@example.test').at(-1)!;
    assert.match(mail, /From: alpha consultancy/);
    assert.match(mail, /choose your password/);

    const guess = await call('POST', '/auth/sign-in', { host: HOST.alpha, json: { email: 'hira.invited@example.test', password: '' } });
    assert.notEqual(guess.status, 200, 'an invited login has no password until they choose one');

    const info = await call('GET', `/auth/password/link?token=${token}`, { host: HOST.alpha });
    assert.equal(info.body.purpose, 'invite');
    const set = await call('POST', '/auth/password/set', { host: HOST.alpha, json: { token, password: 'my-own-password' } });
    assert.equal(set.status, 200);
    const session = await signIn(HOST.alpha, 'hira.invited@example.test', 'my-own-password');
    const who = await me(HOST.alpha, session);
    assert.equal(who.body.user.role, 'client');
    assert.equal(who.body.user.clientId, clientId);

    const detail = await as('alphaManager')('GET', `/clients/${clientId}`);
    assert.equal(detail.body.hasLogin, true);
  });

  test('inviting needs the portal-access permission', async () => {
    await setPermission('alpha', 'client.portal_access', 'deny');
    try {
      const res = await as('alphaConsultant')('POST', `/clients/${fx.alpha.clientId}/portal-invite`);
      assert.equal(res.status, 403);
    } finally {
      await setPermission('alpha', 'client.portal_access', 'inherit');
    }
  });

  test('a colleague added without a password is invited, and signs in with the one they choose', async () => {
    const res = await as('alphaManager')('POST', '/consultants', { fullName: 'Nadia Newhire', email: 'nadia@alpha.test' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.invite, 'the invitation comes back to show and copy');
    assert.equal(lastLink('nadia@alpha.test').url, res.body.invite.link);
    const withPassword = await as('alphaManager')('POST', '/consultants', { fullName: 'Omar Typed', email: 'omar@alpha.test', password: 'typed-password' });
    assert.equal(withPassword.body.invite, null, 'a password set by the manager sends no invitation');
    assert.equal(mailsTo('omar@alpha.test').length, 0);

    const { token } = lastLink('nadia@alpha.test');
    await call('POST', '/auth/password/set', { host: HOST.alpha, json: { token, password: 'nadias-password' } });
    const s = await signIn(HOST.alpha, 'nadia@alpha.test', 'nadias-password');
    assert.equal((await me(HOST.alpha, s)).body.user.role, 'consultant');
  });

  test('a new consultancy’s manager can be invited instead of given a password, and re-sent a link by the admin', async () => {
    const res = await as('root')('POST', '/admin/tenants', {
      name: 'Charlie Consultants',
      slug: 'charlie',
      manager: { fullName: 'Chen Owner', email: 'owner@charlie.test' },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.invite.link, /^http:\/\/charlie\.localhost(:\d+)?\/reset-password\?token=/);
    const managerId = res.body.managers[0].id as string;

    const again = await as('root')('POST', `/admin/tenants/${res.body.id}/managers/${managerId}/password-link`);
    assert.equal(again.status, 200);
    assert.equal((await call('GET', `/auth/password/link?token=${new URL(res.body.invite.link).searchParams.get('token')}`, { host: 'charlie.localhost' })).status, 410, 'the newer link replaces the first');
    const { token } = lastLink('owner@charlie.test');
    assert.equal((await call('POST', '/auth/password/set', { host: 'charlie.localhost', json: { token, password: 'owners-password' } })).status, 200);
    await signIn('charlie.localhost', 'owner@charlie.test', 'owners-password');

    const wrongTenant = await as('root')('POST', `/admin/tenants/${fx.alpha.id}/managers/${managerId}/password-link`);
    assert.equal(wrongTenant.status, 404, 'a manager is reached through their own consultancy only');
    const notAdmin = await as('alphaManager')('POST', `/admin/tenants/${res.body.id}/managers/${managerId}/password-link`);
    assert.equal(notAdmin.status, 403);
  });

  test('a manager sends a colleague a link; nobody outside the consultancy can', async () => {
    const res = await as('alphaManager')('POST', `/consultants/${fx.alpha.consultantId}/password-link`);
    assert.equal(res.status, 200);
    assert.match(res.body.link, /reset-password\?token=/);
    assert.equal(lastLink(fx.alpha.consultantEmail).url, res.body.link);
    const across = await as('bravoManager')('POST', `/consultants/${fx.alpha.consultantId}/password-link`);
    assert.equal(across.status, 404);
    const self = await as('alphaConsultant')('POST', `/consultants/${fx.alpha.consultantId}/password-link`);
    assert.equal(self.status, 403, 'a consultant without staff management cannot');
  });
});

describe('a consultancy’s own white label', () => {
  test('the manager edits their branding; consultants, clients and the platform admin cannot reach it', async () => {
    const own = await as('alphaManager')('GET', '/tenancy/branding');
    assert.equal(own.status, 200);
    assert.equal(own.body.slug, 'alpha');
    assert.equal(own.body.platformHost, 'alpha.localhost');
    for (const who of ['alphaConsultant', 'alphaClient', 'root'] as const) {
      assert.equal((await as(who)('GET', '/tenancy/branding')).status, 403, `${who} is refused`);
    }

    const saved = await as('alphaManager')('PATCH', '/tenancy/branding', {
      name: 'Alpha Study Abroad',
      primaryColor: '#0E7C66',
      contactEmail: 'hello@alpha.test',
    });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.primaryColor, '#0e7c66');
    const site = await call('GET', '/tenancy/current', { host: HOST.alpha });
    assert.equal(site.body.tenant.name, 'Alpha Study Abroad', 'the sign-in page shows it at once');
    assert.equal(site.body.tenant.contactEmail, 'hello@alpha.test');
    const bravo = await call('GET', '/tenancy/current', { host: HOST.bravo });
    assert.notEqual(bravo.body.tenant.name, 'Alpha Study Abroad');
  });

  test('a subdomain needs one CNAME to the consultancy’s own address; a root domain needs an A record and the TXT', async () => {
    const sub = await as('alphaManager')('POST', '/tenancy/branding/domains', { hostname: 'portal.alpha-example.com' });
    assert.equal(sub.status, 201);
    const d = sub.body.domains.find((x: { hostname: string }) => x.hostname === 'portal.alpha-example.com');
    assert.equal(d.setup.apex, false);
    assert.deepEqual(d.setup.records, [{ type: 'CNAME', name: 'portal', fqdn: 'portal.alpha-example.com', value: 'alpha.localhost' }]);
    assert.equal(d.live, false);

    const root = await as('alphaManager')('POST', '/tenancy/branding/domains', { hostname: 'alpha-example.com.pk' });
    const r = root.body.domains.find((x: { hostname: string }) => x.hostname === 'alpha-example.com.pk');
    assert.equal(r.setup.apex, true, 'example.com.pk is a root domain');
    assert.deepEqual(r.setup.records.map((x: { type: string; name: string }) => [x.type, x.name]), [['A', '@'], ['TXT', '_crm-verification']]);

    const bravoTry = await as('bravoManager')('POST', '/tenancy/branding/domains', { hostname: 'portal.alpha-example.com' });
    assert.equal(bravoTry.status, 409, 'a domain belongs to one consultancy');
  });

  test('Check now: a CNAME to the consultancy’s own address connects the domain in one step', async () => {
    const saved = { ...dns.lookups };
    dns.lookups.cnameOf = async (h) => (h === 'portal.alpha-example.com' ? ['alpha.localhost'] : []);
    dns.lookups.addressesOf = async () => ['203.0.113.10'];
    dns.lookups.txtValues = async () => [];
    try {
      const before = await call('GET', '/tenancy/current', { host: 'portal.alpha-example.com' });
      assert.equal(before.status, 404);
      const list = await as('alphaManager')('GET', '/tenancy/branding');
      const d = list.body.domains.find((x: { hostname: string }) => x.hostname === 'portal.alpha-example.com');
      const check = await as('alphaManager')('POST', `/tenancy/branding/domains/${d.id}/verify`);
      assert.equal(check.status, 201);
      assert.equal(check.body.live, true, check.body.message);
      const after = await call('GET', '/tenancy/current', { host: 'portal.alpha-example.com' });
      assert.equal(after.body.tenant.id, fx.alpha.id, 'the domain now serves the consultancy');
      assert.equal((await call('GET', '/tenancy/tls-check?domain=portal.alpha-example.com', { host: HOST.admin })).status, 200);
      const view = (await as('alphaManager')('GET', '/tenancy/branding')).body.domains.find((x: { id: string }) => x.id === d.id);
      assert.equal(view.live, true);

      // Links in emails now use it.
      await call('POST', '/auth/password/forgot', { host: HOST.alpha, json: { email: fx.alpha.managerEmail } });
      assert.match(lastLink(fx.alpha.managerEmail).url, /^https:\/\/portal\.alpha-example\.com\/reset-password/);
    } finally {
      Object.assign(dns.lookups, saved);
    }
  });

  test('ownership without pointing here is not live, and the answer says what to add', async () => {
    const saved = { ...dns.lookups };
    const list = await as('alphaManager')('GET', '/tenancy/branding');
    const d = list.body.domains.find((x: { hostname: string }) => x.hostname === 'alpha-example.com.pk');
    dns.lookups.cnameOf = async () => [];
    dns.lookups.txtValues = async () => [d.verification.value];
    dns.lookups.addressesOf = async (h) => (h === 'alpha-example.com.pk' ? ['198.51.100.7'] : ['203.0.113.10']);
    try {
      const check = await as('alphaManager')('POST', `/tenancy/branding/domains/${d.id}/verify`);
      assert.equal(check.body.live, false);
      assert.match(check.body.message, /Ownership is confirmed/);
      assert.match(check.body.message, /198\.51\.100\.7/, 'it says where the domain leads now');
      const view = (await as('alphaManager')('GET', '/tenancy/branding')).body.domains.find((x: { id: string }) => x.id === d.id);
      assert.ok(view.verifiedAt);
      assert.equal(view.pointsHere, false);
      assert.equal(view.live, false);
    } finally {
      Object.assign(dns.lookups, saved);
    }
  });

  test('a CNAME to another consultancy’s address proves nothing', async () => {
    const saved = { ...dns.lookups };
    const add = await as('bravoManager')('POST', '/tenancy/branding/domains', { hostname: 'portal.trick-example.com' });
    const d = add.body.domains.find((x: { hostname: string }) => x.hostname === 'portal.trick-example.com');
    dns.lookups.cnameOf = async () => ['alpha.localhost'];
    dns.lookups.addressesOf = async () => ['203.0.113.10'];
    dns.lookups.txtValues = async () => [];
    try {
      const check = await as('bravoManager')('POST', `/tenancy/branding/domains/${d.id}/verify`);
      assert.equal(check.body.live, false);
      assert.equal((await call('GET', '/tenancy/current', { host: 'portal.trick-example.com' })).status, 404);
    } finally {
      Object.assign(dns.lookups, saved);
    }
  });

  test('a manager cannot touch another consultancy’s domain by id', async () => {
    const list = await as('alphaManager')('GET', '/tenancy/branding');
    const d = list.body.domains[0];
    assert.equal((await as('bravoManager')('POST', `/tenancy/branding/domains/${d.id}/verify`)).status, 404);
    assert.equal((await as('bravoManager')('DELETE', `/tenancy/branding/domains/${d.id}`)).status, 404);
  });
});

describe('plans', () => {
  test('a feature outside the plan is refused with a code the web app turns into a plain page', async () => {
    const plan = await as('root')('POST', '/admin/plans', {
      code: 'no-billing',
      name: 'No billing',
      priceMonthly: 0,
      maxStaff: null,
      maxActiveClients: null,
      storageGb: null,
      modules: ['tasks'],
    });
    assert.equal(plan.status, 201, JSON.stringify(plan.body));
    await as('root')('POST', `/admin/tenants/${fx.bravo.id}/subscription`, { planId: plan.body.id, subscriptionStatus: 'active' });
    const res = await as('bravoManager')('GET', '/billing/invoices');
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'MODULE_OFF');
    assert.equal(res.body.module, 'billing');
  });
});
