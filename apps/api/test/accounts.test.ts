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
import sharp from 'sharp';
import { HOST, OUTBOX, PASSWORD, appGet, as, call, db, fx, schema, session, setPermission, signIn, startApp, stopApp, upload } from './harness';

before(startApp);
after(stopApp);

const dns = require('../src/tenancy/domain-dns') as typeof import('../src/tenancy/domain-dns');
const { PdfService } = require('../src/finance/pdf.service') as typeof import('../src/finance/pdf.service');

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

  test('the full logo is its own slot: uploaded, served publicly, removed, and never touches the icon', async () => {
    // The smallest real PNG: files are judged by their bytes, not their name.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const before = await as('alphaManager')('GET', '/tenancy/branding');
    assert.equal(before.body.fullLogoUrl, null);
    const icon = before.body.logoUrl;

    const up = await upload('alphaManager', '/tenancy/branding/logo/full', {}, { name: 'wide.png', type: 'image/png', bytes: png });
    assert.equal(up.status, 201);
    assert.match(up.body.fullLogoUrl, /^\/api\/tenancy\/logo\/[0-9a-f-]+\/full\?v=/);
    assert.equal(up.body.logoUrl, icon, 'the icon is untouched');

    const site = await call('GET', '/tenancy/current', { host: HOST.alpha });
    assert.equal(site.body.tenant.fullLogoUrl, up.body.fullLogoUrl, 'the sign-in page and menu see it at once');
    const served = await call('GET', up.body.fullLogoUrl.replace(/^\/api/, ''), { host: HOST.alpha });
    assert.equal(served.status, 200, 'served before anyone signs in');
    assert.equal(served.headers.get('content-type'), 'image/png');
    assert.equal(served.headers.get('cache-control'), 'public, max-age=31536000, immutable', 'a versioned URL is cached for good');
    const meta = await sharp(served.raw).metadata();
    assert.deepEqual([meta.format, meta.width, meta.height], ['png', 1, 1], 'a tiny logo is never enlarged');

    const svg = await upload('alphaManager', '/tenancy/branding/logo/full', {}, {
      name: 'wide.svg',
      type: 'image/svg+xml',
      bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    });
    assert.equal(svg.status, 400, 'never SVG, which can carry script');
    assert.equal((await upload('alphaConsultant', '/tenancy/branding/logo/full', {}, { name: 'w.png', type: 'image/png', bytes: png })).status, 403);

    const removed = await as('alphaManager')('DELETE', '/tenancy/branding/logo/full');
    assert.equal(removed.status, 200);
    assert.equal(removed.body.fullLogoUrl, null);
    assert.equal(removed.body.logoUrl, icon);
    assert.equal((await call('GET', up.body.fullLogoUrl.replace(/^\/api/, ''), { host: HOST.alpha })).status, 404);
  });

  test('logos are stored the way they are shown: decoded, trimmed, sized, stripped', async () => {
    const fetchImage = async (url: string) => {
      const res = await call('GET', url.replace(/^\/api/, ''), { host: HOST.alpha });
      assert.equal(res.status, 200);
      return { res, meta: await sharp(res.raw).metadata() };
    };
    // A 3000 x 600 export whose artwork (2000 x 400) sits in a transparent margin.
    const wide = await sharp({ create: { width: 3000, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: { create: { width: 2000, height: 400, channels: 4, background: { r: 20, g: 90, b: 200, alpha: 1 } } }, left: 500, top: 100 }])
      .png()
      .toBuffer();
    const full = await upload('alphaManager', '/tenancy/branding/logo/full', {}, { name: 'wide.png', type: 'image/png', bytes: wide });
    assert.equal(full.status, 201);
    const f = await fetchImage(full.body.fullLogoUrl);
    assert.deepEqual([f.meta.width, f.meta.height], [1200, 240], 'margin trimmed, then fitted inside 1200 x 300');
    assert.ok(f.res.raw.length < wide.length, 'smaller than what was sent');

    // With only the full logo, documents carry it (laid out wide) rather than nothing.
    const pdfs = appGet<InstanceType<typeof PdfService>>(PdfService);
    const wideBrand = await pdfs.brand(fx.alpha.id);
    assert.ok(wideBrand.logo);
    assert.equal(wideBrand.logoWide, true);
    const cert = await pdfs.courseCertificate(fx.alpha.id, {
      number: 'C-1', studentName: 'Test Student', courseName: 'IELTS', batchCode: 'B1',
      from: '2026-01-01', to: '2026-02-01', attendancePercent: 90, completedOn: '2026-02-01',
    });
    assert.equal(cert.subarray(0, 4).toString(), '%PDF');
    assert.ok(cert.includes('/Subtype /Image'), 'the logo is drawn');

    // A photo-like JPEG, not square, carrying EXIF.
    const photo = await sharp({ create: { width: 900, height: 600, channels: 3, background: { r: 200, g: 40, b: 40 } } })
      .composite([{ input: { create: { width: 300, height: 300, channels: 3, background: { r: 255, g: 255, b: 255 } } }, left: 300, top: 150 }])
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-gps-and-camera' } } })
      .toBuffer();
    assert.ok((await sharp(photo).metadata()).exif, 'the upload really carries EXIF');
    const icon = await upload('alphaManager', '/tenancy/branding/logo', {}, { name: 'photo.jpg', type: 'image/jpeg', bytes: photo });
    assert.equal(icon.status, 201);
    const i = await fetchImage(icon.body.logoUrl);
    assert.deepEqual([i.meta.format, i.meta.width, i.meta.height], ['png', 256, 256], 'a 256 px square PNG');
    assert.equal(i.meta.exif, undefined, 'metadata stripped');
    assert.equal((await pdfs.brand(fx.alpha.id)).logoWide, false, 'the square icon is preferred on documents');

    // The iPhone home-screen icon: 180 px, opaque.
    const site = await call('GET', '/tenancy/current', { host: HOST.alpha });
    assert.match(site.body.tenant.touchIconUrl, /\/apple\?v=/);
    const t = await fetchImage(site.body.tenant.touchIconUrl);
    assert.deepEqual([t.meta.width, t.meta.height, t.meta.hasAlpha], [180, 180, false]);

    // Starts like a PNG, is not one.
    const fake = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(2048, 7)]);
    const bad = await upload('alphaManager', '/tenancy/branding/logo/full', {}, { name: 'fake.png', type: 'image/png', bytes: fake });
    assert.equal(bad.status, 400);
    assert.match(bad.body.fieldErrors.file, /could not be read/);

    await as('alphaManager')('DELETE', '/tenancy/branding/logo');
    await as('alphaManager')('DELETE', '/tenancy/branding/logo/full');
    const after = await call('GET', '/tenancy/current', { host: HOST.alpha });
    assert.equal(after.body.tenant.touchIconUrl, null);
  });

  test('logo uploads hold up against abuse: size, extra parts, pixel bombs, hidden payloads, other sites', async () => {
    // Run as the platform admin on Bravo, so this does not spend Alpha's change budget.
    const url = `/admin/tenants/${fx.bravo.id}/logo`;
    const solid = (w: number, h: number) =>
      sharp({ create: { width: w, height: h, channels: 3, background: { r: 10, g: 120, b: 60 } } }).png().toBuffer();

    // Over 5 MB: the upload is cut off while it is still arriving.
    const huge = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(5 * 1024 * 1024 + 1)]);
    assert.equal((await upload('root', url, {}, { name: 'big.png', type: 'image/png', bytes: huge })).status, 413);

    // Anything but the one file part.
    const extra = await upload('root', url, { note: 'x' }, { name: 'a.png', type: 'image/png', bytes: await solid(8, 8) });
    assert.equal(extra.status, 400, 'an extra form field is refused');

    // A small file that unpacks into 25 million pixels.
    const bomb = await solid(5000, 5000);
    assert.ok(bomb.length < 5 * 1024 * 1024, `the bomb itself is small (${bomb.length} bytes)`);
    const bombed = await upload('root', url, {}, { name: 'bomb.png', type: 'image/png', bytes: bomb });
    assert.equal(bombed.status, 400);
    assert.match(bombed.body.fieldErrors.file, /4096/);

    // A real PNG carrying a script after its last chunk: whatever comes back has none of it.
    const payload = '<html><script>alert(document.cookie)</script></html>';
    const polyglot = Buffer.concat([await solid(64, 64), Buffer.from(payload)]);
    const up = await upload('root', url, {}, { name: 'logo.png', type: 'image/png', bytes: polyglot });
    if (up.status === 201) {
      const served = await call('GET', up.body.logoUrl.replace(/^\/api/, ''), { host: HOST.bravo });
      assert.equal(served.status, 200);
      assert.ok(!served.raw.includes('<script'), 'the hidden script does not survive re-encoding');
      assert.equal(served.headers.get('content-type'), 'image/png');
      assert.equal(served.headers.get('x-content-type-options'), 'nosniff');
      assert.match(served.headers.get('content-security-policy') ?? '', /sandbox/, 'opened on its own, it still runs nothing');
      await as('root')('DELETE', url);
    } else {
      assert.equal(up.status, 400, 'or it is refused outright');
    }

    // A write from another site's page, with the manager's cookie, is refused.
    const form = new FormData();
    form.append('file', new Blob([await solid(8, 8)], { type: 'image/png' }), 'a.png');
    const forged = await call('POST', '/tenancy/branding/logo', {
      host: HOST.bravo,
      session: session.bravoManager,
      form,
      headers: { origin: 'https://evil.example' },
    });
    assert.equal(forged.status, 403);

    // Only a manager, and only their own consultancy: the id never comes from the request.
    for (const who of ['bravoConsultant', 'bravoClient'] as const) {
      assert.equal((await upload(who, '/tenancy/branding/logo', {}, { name: 'a.png', type: 'image/png', bytes: await solid(8, 8) })).status, 403, who);
    }
    assert.equal((await upload('bravoManager', `/admin/tenants/${fx.alpha.id}/logo`, {}, { name: 'a.png', type: 'image/png', bytes: await solid(8, 8) })).status, 403, 'a manager cannot use the admin route');
  });

  test('logo changes are rate limited per person: ten at once, then 429 with Retry-After', async () => {
    for (let i = 0; i < 10; i++) {
      assert.equal((await as('bravoManager')('DELETE', '/tenancy/branding/logo/full')).status, 200, `change ${i + 1}`);
    }
    const limited = await as('bravoManager')('DELETE', '/tenancy/branding/logo/full');
    assert.equal(limited.status, 429);
    assert.ok(Number(limited.headers.get('retry-after')) > 0);
    assert.match(limited.body.message, /Too many logo changes/);
    assert.equal((await as('alphaManager')('GET', '/tenancy/branding')).status, 200, 'everything else, and everyone else, carries on');
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
