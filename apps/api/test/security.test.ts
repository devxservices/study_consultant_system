/**
 * Permissions, the audit trail and two-step verification.
 *
 * Boots the real API against a throwaway embedded database and checks the
 * rules the owner relies on: a denied permission is refused by the API (not
 * just hidden), a change applies on the very next request, the audit log
 * cannot be rewritten, and a stolen password is not enough on its own.
 *
 * Run with:  npm test --workspace @crm/api
 */
import 'reflect-metadata';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-security-test-'));
delete process.env.DATABASE_URL;
process.env.PGLITE_DIR = path.join(workDir, 'pg');
process.env.STORAGE_LOCAL_DIR = path.join(workDir, 'storage');
process.env.STORAGE_DRIVER = 'local';
process.env.NODE_ENV = 'test';
process.env.PLATFORM_DOMAIN = 'localhost';
delete process.env.ADMIN_HOST;
delete process.env.DEFAULT_TENANT_SLUG;
delete process.env.CLIENT_IP_HEADER;

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the env above is set */
const { createDb } = require('../src/db/connection') as typeof import('../src/db/connection');
const schema = require('../src/db/schema') as typeof import('../src/db/schema');
const totp = require('../src/auth/totp') as typeof import('../src/auth/totp');
/* eslint-enable @typescript-eslint/no-require-imports */

const PASSWORD = 'correct-horse-battery';
const HOST = { gamma: 'gamma.localhost', delta: 'delta.localhost', admin: 'admin.localhost' };

interface Fixture {
  tenantId: string;
  deltaTenantId: string;
  managerUserId: string;
  /** Ayesha: owns client A. */
  c1UserId: string;
  c1ConsultantId: string;
  /** Bilal: owns client B. */
  c2UserId: string;
  c2ConsultantId: string;
  clientAId: string;
  clientBId: string;
  caseAId: string;
  caseBId: string;
  docAId: string;
  docBId: string;
  clientUserId: string;
}

let fx: Fixture;
let base = '';
let app: { close(): Promise<void>; get<T = unknown>(token: unknown): T };

async function seed(): Promise<void> {
  const { hash } = require('bcryptjs') as typeof import('bcryptjs');
  const { migrate } = require('drizzle-orm/pglite/migrator') as typeof import('drizzle-orm/pglite/migrator');
  const handle = await createDb();
  const db = handle.db;
  await migrate(db as never, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });
  const passwordHash = await hash(PASSWORD, 4);
  const { tenants, users, consultants, clients, cases, caseStageEvents, documents } = schema;

  await db.insert(users).values({
    tenantId: null,
    email: 'root@platform.test',
    passwordHash,
    fullName: 'Platform Root',
    role: 'super_admin',
  });

  const [gamma] = await db.insert(tenants).values({ slug: 'gamma', name: 'Gamma Study' }).returning();
  const [delta] = await db.insert(tenants).values({ slug: 'delta', name: 'Delta Visas' }).returning();
  const tenantId = gamma!.id;

  const user = async (t: string, email: string, role: 'manager' | 'consultant' | 'client', fullName: string) => {
    const [u] = await db.insert(users).values({ tenantId: t, email, passwordHash, fullName, role }).returning();
    return u!.id;
  };
  const managerUserId = await user(tenantId, 'owner@gamma.test', 'manager', 'Gamma Owner');
  const c1UserId = await user(tenantId, 'ayesha@gamma.test', 'consultant', 'Ayesha Khan');
  const c2UserId = await user(tenantId, 'bilal@gamma.test', 'consultant', 'Bilal Ahmed');
  const clientUserId = await user(tenantId, 'student@gamma.test', 'client', 'Ali Raza');
  await user(tenantId, 'mfa@gamma.test', 'consultant', 'Sara Two-Step');
  await user(tenantId, 'policy@gamma.test', 'consultant', 'Omar Policy');
  await user(delta!.id, 'owner@delta.test', 'manager', 'Delta Owner');

  const [c1] = await db.insert(consultants).values({ tenantId, userId: c1UserId }).returning();
  const [c2] = await db.insert(consultants).values({ tenantId, userId: c2UserId }).returning();

  const client = async (name: string, email: string, consultantId: string, userId: string | null) => {
    const [row] = await db
      .insert(clients)
      .values({ tenantId, userId, fullName: name, email, phone: '+92 300 1111111', assignedConsultantId: consultantId, createdBy: managerUserId })
      .returning();
    const [k] = await db
      .insert(cases)
      .values({
        tenantId,
        reference: `APP-2026-${Math.floor(Math.random() * 9000 + 1000)}`,
        clientId: row!.id,
        consultantId,
        targetCountry: 'United Kingdom',
        currentStage: 'documents_collection',
      })
      .returning();
    await db.insert(caseStageEvents).values({ tenantId, caseId: k!.id, stage: 'documents_collection', method: 'initial' });
    const fileKey = `tenants/${tenantId}/cases/${k!.id}/passport/${randomUUID()}`;
    const full = path.join(process.env.STORAGE_LOCAL_DIR!, fileKey);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '%PDF-1.4\n% fixture\n');
    const [doc] = await db
      .insert(documents)
      .values({
        tenantId,
        caseId: k!.id,
        clientId: row!.id,
        type: 'passport',
        fileKey,
        fileName: 'passport.pdf',
        fileSize: 20,
        mimeType: 'application/pdf',
        uploadedBy: userId ?? managerUserId,
      })
      .returning();
    return { clientId: row!.id, caseId: k!.id, docId: doc!.id };
  };

  const a = await client('Ali Raza', 'student@gamma.test', c1!.id, clientUserId);
  const b = await client('Zara Malik', 'zara@gamma.test', c2!.id, null);

  fx = {
    tenantId,
    deltaTenantId: delta!.id,
    managerUserId,
    c1UserId,
    c1ConsultantId: c1!.id,
    c2UserId,
    c2ConsultantId: c2!.id,
    clientAId: a.clientId,
    clientBId: b.clientId,
    caseAId: a.caseId,
    caseBId: b.caseId,
    docAId: a.docId,
    docBId: b.docId,
    clientUserId,
  };
  await handle.close();
}

/* ------------------------------------------------------------------ */

interface Reply {
  status: number;
  body: any;
  text: string;
  headers: Headers;
}

async function call(
  method: string,
  url: string,
  opts: { host?: string; session?: string; json?: unknown; ua?: string } = {},
): Promise<Reply> {
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: {
      'x-tenant-host': opts.host ?? HOST.gamma,
      'user-agent': opts.ua ?? 'security-test',
      ...(opts.session ? { cookie: opts.session } : {}),
      ...(opts.json !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : undefined,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* CSV or a file */
  }
  return { status: res.status, body, text, headers: res.headers };
}

function cookieFrom(headers: Headers): string | null {
  const c = headers.getSetCookie().find((x) => x.startsWith('crm_session='));
  return c ? c.split(';')[0]! : null;
}

async function signIn(email: string, host = HOST.gamma): Promise<string> {
  const r = await call('POST', '/auth/sign-in', { host, json: { email, password: PASSWORD } });
  assert.equal(r.status, 200, `sign-in for ${email}`);
  const cookie = cookieFrom(r.headers);
  assert.ok(cookie, 'a session cookie is set');
  return cookie;
}

/** The code an authenticator app would show right now (or n steps later). */
function codeFor(secretBase32: string, offset = 0): string {
  return totp.hotp(totp.base32Decode(secretBase32), totp.currentStep() + offset);
}

const s = {} as Record<'owner' | 'ayesha' | 'bilal' | 'student' | 'deltaOwner' | 'root', string>;

before(async () => {
  await seed();
  const { NestFactory } = require('@nestjs/core') as typeof import('@nestjs/core');
  const cookieParser = require('cookie-parser') as typeof import('cookie-parser');
  const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
  const nest = await NestFactory.create(AppModule, { logger: false });
  nest.setGlobalPrefix('api');
  nest.use(cookieParser());
  await nest.listen(0, '127.0.0.1');
  const { port } = nest.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  app = nest;

  s.owner = await signIn('owner@gamma.test');
  s.ayesha = await signIn('ayesha@gamma.test');
  s.bilal = await signIn('bilal@gamma.test');
  s.student = await signIn('student@gamma.test');
  s.deltaOwner = await signIn('owner@delta.test', HOST.delta);
  s.root = await signIn('root@platform.test', HOST.admin);
});

after(async () => {
  await app?.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

const asOwner = (method: string, url: string, json?: unknown) => call(method, url, { session: s.owner, json });
const asAyesha = (method: string, url: string, json?: unknown) => call(method, url, { session: s.ayesha, json });
const setMember = (userId: string, changes: Record<string, string>) =>
  asOwner('PUT', `/team/${userId}/permissions`, { changes });

/* ------------------------------------------------------------------ */
/* Permissions                                                         */
/* ------------------------------------------------------------------ */

describe('permissions are enforced by the API', () => {
  test('a consultant sees only their own clients until "see every client" is allowed - and the change is immediate', async () => {
    assert.equal((await asAyesha('GET', `/clients/${fx.clientBId}`)).status, 404);
    assert.equal((await asAyesha('GET', `/cases/${fx.caseBId}`)).status, 404);
    const before = await asAyesha('GET', '/clients?pageSize=50');
    assert.deepEqual(before.body.items.map((c: { id: string }) => c.id), [fx.clientAId]);

    assert.equal((await setMember(fx.c1UserId, { 'client.view_all': 'allow' })).status, 200);

    // Same session, no sign-in again.
    assert.equal((await asAyesha('GET', `/clients/${fx.clientBId}`)).status, 200);
    assert.equal((await asAyesha('GET', `/cases/${fx.caseBId}`)).status, 200);
    assert.equal((await asAyesha('GET', `/documents/${fx.docBId}`)).status, 200);
    const widened = await asAyesha('GET', '/clients?pageSize=50');
    assert.equal(widened.body.total, 2);

    await setMember(fx.c1UserId, { 'client.view_all': 'inherit' });
    assert.equal((await asAyesha('GET', `/clients/${fx.clientBId}`)).status, 404);
  });

  test('a change is immediate even while the same person has a page full of requests in flight', async () => {
    // One page fires a dozen requests at once as the same person. However those are served, a request made after a
    // permission was taken away must never be answered with who the person
    // was before.
    const total = async () => (await asAyesha('GET', '/clients?pageSize=50')).body.total as number;
    const burst = () => Array.from({ length: 12 }, () => asAyesha('GET', '/clients?pageSize=50'));
    const own = await total();

    for (let round = 0; round < 5; round++) {
      assert.equal((await setMember(fx.c1UserId, { 'client.view_all': 'allow' })).status, 200);
      const everyone = await total();
      assert.ok(everyone > own, 'the permission widens the list');

      const inFlight = burst();
      // Taken away while that burst is still being served, with more arriving...
      const change = setMember(fx.c1UserId, { 'client.view_all': 'inherit' });
      const alsoInFlight = burst();
      assert.equal((await change).status, 200);

      // ...and everything asked once the change is confirmed sees it.
      const after = await Promise.all([...burst(), asAyesha('GET', `/clients/${fx.clientBId}`)]);
      const other = after.pop()!;
      assert.equal(other.status, 404, 'another consultant’s client is gone again');
      for (const r of after) {
        assert.equal(r.status, 200);
        assert.equal(r.body.total, own, 'no request made after the change sees the wider list');
      }

      // The ones that overlapped the change are each a whole answer from one
      // side of it or the other - never an error, never a mixture.
      for (const r of await Promise.all([...inFlight, ...alsoInFlight])) {
        assert.equal(r.status, 200);
        assert.ok(r.body.total === own || r.body.total === everyone);
        assert.equal(r.body.items.length, r.body.total);
      }
    }
  });

  test('requests arriving together are each answered as the person who sent them', async () => {
    const who: [string, string][] = [
      [s.owner, fx.managerUserId],
      [s.ayesha, fx.c1UserId],
      [s.bilal, fx.c2UserId],
      [s.student, fx.clientUserId],
    ];
    const replies = await Promise.all(
      Array.from({ length: 40 }, (_, i) => {
        const [session, userId] = who[i % who.length]!;
        return call('GET', '/auth/me', { session }).then((r) => ({ r, userId }));
      }),
    );
    for (const { r, userId } of replies) {
      assert.equal(r.status, 200);
      assert.equal(r.body.user.id, userId);
    }
    // And a session that is no longer good is refused in the middle of a crowd too.
    const mixed = await Promise.all([
      ...Array.from({ length: 6 }, () => call('GET', '/auth/me', { session: s.ayesha })),
      call('GET', '/auth/me', { session: 'crm_session=not-a-session' }),
      call('GET', '/auth/me'),
    ]);
    assert.deepEqual(mixed.map((r) => r.status), [200, 200, 200, 200, 200, 200, 401, 401]);
  });

  test('a denied action is refused with a clear code, while reading stays open', async () => {
    await setMember(fx.c1UserId, { 'case.move': 'deny' });
    const moved = await asAyesha('POST', `/cases/${fx.caseAId}/status`, { status: 'on_hold', reason: 'test' });
    assert.equal(moved.status, 403);
    assert.equal(moved.body.code, 'PERMISSION_DENIED');
    assert.equal(moved.body.permission, 'case.move');
    assert.equal((await asAyesha('GET', `/cases/${fx.caseAId}`)).status, 200);
    // Bilal is untouched by Ayesha's override.
    const bilal = await call('POST', `/cases/${fx.caseBId}/status`, {
      session: s.bilal,
      json: { status: 'on_hold', reason: 'test' },
    });
    assert.equal(bilal.status, 201);
    await setMember(fx.c1UserId, { 'case.move': 'inherit' });
    const again = await asAyesha('POST', `/cases/${fx.caseAId}/status`, { status: 'active' });
    assert.notEqual(again.status, 403);
  });

  test('documents, conversations and money each follow their own permission', async () => {
    await setMember(fx.c1UserId, { 'document.view': 'deny', 'chat.send': 'deny', 'billing.view': 'deny' });
    assert.equal((await asAyesha('GET', `/documents?caseId=${fx.caseAId}`)).status, 403);
    assert.equal((await asAyesha('GET', `/documents/${fx.docAId}/file`)).status, 403);
    assert.equal((await asAyesha('POST', '/messages', { caseId: fx.caseAId, body: 'hello' })).status, 403);
    assert.equal((await asAyesha('GET', `/messages?caseId=${fx.caseAId}`)).status, 200, 'reading is separate from sending');
    assert.equal((await asAyesha('GET', '/billing/invoices')).status, 403);
    await setMember(fx.c1UserId, { 'document.view': 'inherit', 'chat.send': 'inherit', 'billing.view': 'inherit' });
    assert.equal((await asAyesha('GET', `/documents?caseId=${fx.caseAId}`)).status, 200);
  });

  test('the chat socket path checks the permission too, with the identity as it is now', async () => {
    const { AuthService } = require('../src/auth/auth.service') as typeof import('../src/auth/auth.service');
    const { MessagesService } = require('../src/messages/messages.service') as typeof import('../src/messages/messages.service');
    const auth = app.get<InstanceType<typeof AuthService>>(AuthService);
    const messages = app.get<InstanceType<typeof MessagesService>>(MessagesService);

    await setMember(fx.c1UserId, { 'chat.view': 'deny' });
    const ayesha = (await auth.loadUser(fx.c1UserId))!;
    await assert.rejects(messages.assertCaseAccess(ayesha, fx.caseAId), (e: { response?: { code?: string } }) => e.response?.code === 'PERMISSION_DENIED');
    await assert.rejects(messages.send(ayesha, { caseId: fx.caseAId, body: 'hi' } as never));
    await setMember(fx.c1UserId, { 'chat.view': 'inherit' });
  });

  test('a member override wins over the consultancy default, which wins over the built-in one', async () => {
    const newClient = (email: string) => ({ fullName: 'New Student', email, phone: '+92 300 2222222' });

    assert.equal((await asOwner('PUT', '/team/defaults', { changes: { 'client.create': 'deny' } })).status, 200);
    const denied = await asAyesha('POST', '/clients', newClient('n1@gamma.test'));
    assert.equal(denied.status, 403);
    assert.equal((await call('POST', '/clients', { session: s.bilal, json: newClient('n2@gamma.test') })).status, 403);

    await setMember(fx.c1UserId, { 'client.create': 'allow' });
    assert.equal((await asAyesha('POST', '/clients', newClient('n3@gamma.test'))).status, 201);
    assert.equal((await call('POST', '/clients', { session: s.bilal, json: newClient('n4@gamma.test') })).status, 403);

    const view = await asOwner('GET', `/team/${fx.c1UserId}/permissions`);
    const row = view.body.rows.find((r: { key: string }) => r.key === 'client.create');
    assert.deepEqual([row.allowed, row.source, row.override, row.inherited], [true, 'member', 'allow', false]);

    await asOwner('PUT', '/team/defaults', { changes: { 'client.create': 'inherit' } });
    await setMember(fx.c1UserId, { 'client.create': 'inherit' });
  });

  test('a consultant cannot hand a client to someone else without "reassign clients"', async () => {
    const r = await asAyesha('PATCH', `/clients/${fx.clientAId}`, { assignedConsultantId: fx.c2ConsultantId });
    assert.equal(r.status, 403);
    assert.equal(r.body.code, 'PERMISSION_DENIED');
    const created = await asAyesha('POST', '/clients', {
      fullName: 'Quiet Handover',
      email: 'handover@gamma.test',
      phone: '+92 300 3333333',
      assignedConsultantId: fx.c2ConsultantId,
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.consultant.id, fx.c1ConsultantId, 'the new client stays with its creator');
  });

  test('nobody but a manager changes permissions, and nobody can restrict a manager', async () => {
    assert.equal((await asAyesha('PUT', `/team/${fx.c1UserId}/permissions`, { changes: { 'audit.view': 'allow' } })).status, 403);
    assert.equal((await asAyesha('PUT', '/team/defaults', { changes: { 'audit.view': 'allow' } })).status, 403);
    assert.equal((await asAyesha('GET', '/team')).status, 403);
    const owner = await setMember(fx.managerUserId, { 'case.move': 'deny' });
    assert.equal(owner.status, 400);
    const me = await asOwner('GET', '/auth/me');
    const { PERMISSIONS } = require('@crm/shared') as typeof import('@crm/shared');
    assert.equal(me.body.user.permissions.length, PERMISSIONS.length, 'a manager holds every permission');
  });

  test('a manager cannot see or change another consultancy’s people', async () => {
    const r = await call('PUT', `/team/${fx.c1UserId}/permissions`, {
      host: HOST.delta,
      session: s.deltaOwner,
      json: { changes: { 'client.view_all': 'allow' } },
    });
    assert.equal(r.status, 404);
    const team = await call('GET', '/team', { host: HOST.delta, session: s.deltaOwner });
    assert.deepEqual(team.body.map((m: { email: string }) => m.email), ['owner@delta.test']);
    const view = await asAyesha('GET', `/clients/${fx.clientBId}`);
    assert.equal(view.status, 404, 'nothing was granted');
  });

  test('"manage consultants" lets a consultant add colleagues, never touch a manager’s login or their own', async () => {
    const before = await asAyesha('POST', '/consultants', {
      fullName: 'Nadia New',
      email: 'nadia@gamma.test',
      password: 'longenough1',
    });
    assert.equal(before.status, 403);

    await setMember(fx.c1UserId, { 'staff.manage': 'allow', 'staff.view': 'allow' });
    const added = await asAyesha('POST', '/consultants', { fullName: 'Nadia New', email: 'nadia@gamma.test', password: 'longenough1' });
    assert.equal(added.status, 201);
    const own = await asAyesha('POST', `/consultants/${fx.c1ConsultantId}/password`, { password: 'takeover123' });
    assert.equal(own.status, 403);
    const colleague = await asAyesha('POST', `/consultants/${fx.c2ConsultantId}/password`, { password: 'reset-for-bilal' });
    assert.equal(colleague.status, 204);
    // A password set by someone else ends the sessions signed in with the old one.
    assert.equal((await call('GET', '/auth/me', { session: s.bilal })).status, 401);
    // Restore Bilal's password, and his session, for the tests that follow.
    await asOwner('POST', `/consultants/${fx.c2ConsultantId}/password`, { password: PASSWORD });
    s.bilal = await signIn('bilal@gamma.test');
    await setMember(fx.c1UserId, { 'staff.manage': 'inherit', 'staff.view': 'inherit' });
  });

  test('every permission change is in the audit trail, with who, what and from what to what', async () => {
    await setMember(fx.c2UserId, { 'billing.payment': 'deny' });
    const feed = await asOwner('GET', `/analytics/audit?action=permission.changed&pageSize=5`);
    const row = feed.body.items[0];
    assert.equal(row.action, 'permission.changed');
    assert.equal(row.actorId, fx.managerUserId);
    assert.equal(row.metadata.memberId, fx.c2UserId);
    assert.equal(row.metadata.permission, 'billing.payment');
    assert.deepEqual([row.metadata.from, row.metadata.to], ['default', 'deny']);
    await setMember(fx.c2UserId, { 'billing.payment': 'inherit' });
  });
});

/* ------------------------------------------------------------------ */
/* The audit trail                                                     */
/* ------------------------------------------------------------------ */

describe('the audit trail', () => {
  test('is closed to consultants unless a manager opens it', async () => {
    assert.equal((await asAyesha('GET', '/analytics/audit')).status, 403);
    await setMember(fx.c1UserId, { 'audit.view': 'allow' });
    const r = await asAyesha('GET', '/analytics/audit?pageSize=5');
    assert.equal(r.status, 200);
    assert.ok(r.body.items.every((i: { tenantId?: string }) => !('tenantId' in i) || i.tenantId === fx.tenantId));
    await setMember(fx.c1UserId, { 'audit.view': 'inherit' });
  });

  test('records staff opening a client, an application and a document - once per quarter hour - but not the client themselves', async () => {
    await call('GET', `/clients/${fx.clientBId}`, { session: s.bilal, ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130' });
    await call('GET', `/clients/${fx.clientBId}`, { session: s.bilal });
    await call('GET', `/cases/${fx.caseBId}`, { session: s.bilal });
    await call('GET', `/documents/${fx.docBId}/file`, { session: s.bilal });
    await call('GET', `/clients/${fx.clientAId}`, { session: s.student });

    const views = await asOwner('GET', `/analytics/audit?actorId=${fx.c2UserId}&category=client&pageSize=20`);
    const clientViews = views.body.items.filter((i: { action: string }) => i.action === 'client.viewed');
    assert.equal(clientViews.length, 1, 'a refresh is not a second view');
    assert.equal(clientViews[0].clientId, fx.clientBId);
    assert.match(clientViews[0].userAgent, /Chrome/);
    assert.ok(clientViews[0].ipAddress, 'the address is recorded');

    const all = await asOwner('GET', `/analytics/audit?actorId=${fx.c2UserId}&pageSize=50`);
    const actions = all.body.items.map((i: { action: string }) => i.action);
    assert.ok(actions.includes('case.viewed'));
    assert.ok(actions.includes('document.downloaded'));

    const student = await asOwner('GET', `/analytics/audit?actorId=${fx.clientUserId}&action=client.viewed`);
    assert.equal(student.body.total, 0);
  });

  test('records failed sign-ins against the consultancy they were tried on', async () => {
    await call('POST', '/auth/sign-in', { json: { email: 'bilal@gamma.test', password: 'wrong-password' } });
    const r = await asOwner('GET', '/analytics/audit?action=user.sign_in_failed&pageSize=1');
    assert.equal(r.body.items[0].metadata.email, 'bilal@gamma.test');
    assert.equal(r.body.items[0].actorId, null);
    const other = await call('GET', '/analytics/audit?action=user.sign_in_failed', { host: HOST.delta, session: s.deltaOwner });
    assert.equal(other.body.total, 0, 'another consultancy never sees it');
  });

  test('filters by kind of event and by date', async () => {
    const r = await asOwner('GET', '/analytics/audit?category=user&pageSize=100');
    assert.ok(r.body.total > 0);
    assert.ok(r.body.items.every((i: { action: string }) => i.action.startsWith('user.') || i.action.startsWith('mfa.')));
    const future = await asOwner('GET', '/analytics/audit?from=2099-01-01');
    assert.equal(future.body.total, 0);
  });

  test('switching a login off is its own event, and a member’s access history holds only changes about them', async () => {
    assert.equal((await asOwner('PATCH', `/consultants/${fx.c2ConsultantId}`, { active: false })).status, 200);
    assert.equal((await asOwner('PATCH', `/consultants/${fx.c2ConsultantId}`, { active: true })).status, 200);
    const off = await asOwner('GET', `/analytics/audit?action=staff.deactivated&pageSize=1`);
    assert.equal(off.body.items[0].entityId, fx.c2UserId);
    assert.equal(off.body.items[0].metadata.memberName, 'Bilal Ahmed');
    assert.equal((await asOwner('GET', '/analytics/audit?action=staff.reactivated')).body.total, 1);

    await setMember(fx.c2UserId, { 'staff.view': 'deny' });
    await setMember(fx.c1UserId, { 'staff.view': 'deny' });
    const history = await asOwner('GET', `/analytics/audit?entityId=${fx.c2UserId}&category=team&pageSize=100`);
    const actions = history.body.items.map((i: { action: string }) => i.action);
    assert.ok(actions.includes('permission.changed'));
    assert.ok(actions.includes('staff.deactivated'));
    assert.ok(history.body.items.every((i: { entityId: string }) => i.entityId === fx.c2UserId), 'nobody else’s changes');
    await setMember(fx.c2UserId, { 'staff.view': 'inherit' });
    await setMember(fx.c1UserId, { 'staff.view': 'inherit' });
  });

  test('cannot be edited or deleted, even directly in the database', async () => {
    const { DB } = require('../src/db/database.module') as typeof import('../src/db/database.module');
    const { sql } = require('drizzle-orm') as typeof import('drizzle-orm');
    const db = app.get<import('../src/db/connection').Db>(DB);
    const before = await db.execute(sql`select count(*)::int as n from audit_log`);
    const count = (r: unknown) => Number((r as { rows: { n: number }[] }).rows[0]!.n);

    // The database's own refusal, underneath the driver's "Failed query" wrapper.
    const refused = (e: Error & { cause?: Error }) => /audit_log is append-only/.test(`${e.message} ${e.cause?.message ?? ''}`);
    await assert.rejects(db.execute(sql`update audit_log set action = 'user.signed_in'`), refused);
    await assert.rejects(db.execute(sql`delete from audit_log`), refused);
    await assert.rejects(db.execute(sql`truncate audit_log`), refused);
    assert.equal(count(await db.execute(sql`select count(*)::int as n from audit_log`)), count(before));
  });
});

/* ------------------------------------------------------------------ */
/* Exports                                                             */
/* ------------------------------------------------------------------ */

describe('exports', () => {
  test('need "export data", cover only what the person can see, neutralise formulas, and are recorded', async () => {
    assert.equal((await asAyesha('GET', '/export/clients')).status, 403);
    await asOwner('PATCH', `/clients/${fx.clientAId}`, { city: '=HYPERLINK("http://evil.test","x")' });
    await setMember(fx.c1UserId, { 'data.export': 'allow' });

    const r = await asAyesha('GET', '/export/clients');
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type') ?? '', /text\/csv/);
    assert.match(r.headers.get('content-disposition') ?? '', /attachment; filename="clients-/);
    assert.ok(r.text.includes('Ali Raza'));
    assert.ok(!r.text.includes('Zara Malik'), 'another consultant’s client is not in it');
    assert.ok(r.text.includes(`"'=HYPERLINK(""http://evil.test"",""x"")"`), 'the formula is defused');

    assert.equal((await asAyesha('GET', '/export/audit')).status, 403, 'the audit trail needs its own permission');
    assert.equal((await asAyesha('GET', '/export/nonsense')).status, 400);

    const logged = await asOwner('GET', `/analytics/audit?action=data.exported&actorId=${fx.c1UserId}`);
    assert.equal(logged.body.items[0].metadata.key, 'clients');
    assert.equal(typeof logged.body.items[0].metadata.rows, 'number');

    const owner = await asOwner('GET', '/export/clients');
    assert.ok(owner.text.includes('Zara Malik'), 'the owner exports everything');
    await setMember(fx.c1UserId, { 'data.export': 'inherit' });
  });
});

/* ------------------------------------------------------------------ */
/* Two-step verification                                               */
/* ------------------------------------------------------------------ */

describe('two-step verification', () => {
  let secret = '';
  let recovery: string[] = [];
  let sara = '';

  test('is switched on only after a code from the app proves the scan worked', async () => {
    sara = await signIn('mfa@gamma.test');
    const setup = await call('POST', '/auth/mfa/setup', { session: sara });
    assert.equal(setup.status, 200);
    assert.match(setup.body.qrDataUrl, /^data:image\/png;base64,/);
    assert.match(setup.body.otpauthUrl, /^otpauth:\/\/totp\/Gamma%20Study/);
    secret = setup.body.secret;

    const wrong = await call('POST', '/auth/mfa/enable', { session: sara, json: { code: '000000' } });
    assert.equal(wrong.status, 400);
    const status = await call('GET', '/auth/mfa', { session: sara });
    assert.equal(status.body.enabled, false);

    const ok = await call('POST', '/auth/mfa/enable', { session: sara, json: { code: codeFor(secret) } });
    assert.equal(ok.status, 200);
    recovery = ok.body.recoveryCodes;
    assert.equal(recovery.length, 10);
    assert.equal(new Set(recovery).size, 10);
  });

  test('keeps the secret encrypted and the recovery codes hashed', async () => {
    const { DB } = require('../src/db/database.module') as typeof import('../src/db/database.module');
    const { eq } = require('drizzle-orm') as typeof import('drizzle-orm');
    const db = app.get<import('../src/db/connection').Db>(DB);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.email, 'mfa@gamma.test'));
    assert.match(u!.mfaSecret!, /^v1:/);
    assert.ok(!u!.mfaSecret!.includes(secret));
    const codes = await db.select().from(schema.mfaRecoveryCodes).where(eq(schema.mfaRecoveryCodes.userId, u!.id));
    assert.equal(codes.length, 10);
    assert.ok(codes.every((c) => /^[0-9a-f]{64}$/.test(c.codeHash) && !recovery.includes(c.codeHash)));
  });

  test('a correct password alone gets a challenge, not a session', async () => {
    const r = await call('POST', '/auth/sign-in', { json: { email: 'mfa@gamma.test', password: PASSWORD } });
    assert.equal(r.status, 200);
    assert.equal(r.body.mfaRequired, true);
    assert.equal(cookieFrom(r.headers), null, 'no session cookie yet');
    // The challenge is signed like a session but is not one.
    const misuse = await call('GET', '/auth/me', { session: `crm_session=${r.body.challenge}` });
    assert.equal(misuse.status, 401);

    const bad = await call('POST', '/auth/mfa/verify', { json: { challenge: r.body.challenge, code: '123456' } });
    assert.equal(bad.status, 401);
    // One code, captured once: the replay below must be the very same code.
    const code = codeFor(secret, 1);
    const good = await call('POST', '/auth/mfa/verify', { json: { challenge: r.body.challenge, code } });
    assert.equal(good.status, 200);
    const cookie = cookieFrom(good.headers);
    assert.ok(cookie);
    assert.equal((await call('GET', '/auth/me', { session: cookie! })).body.user.mfaEnabled, true);

    // The same code cannot be used twice.
    const again = await call('POST', '/auth/sign-in', { json: { email: 'mfa@gamma.test', password: PASSWORD } });
    const replay = await call('POST', '/auth/mfa/verify', { json: { challenge: again.body.challenge, code } });
    assert.equal(replay.status, 401);
  });

  test('five wrong codes burn the challenge', async () => {
    const r = await call('POST', '/auth/sign-in', { json: { email: 'mfa@gamma.test', password: PASSWORD } });
    for (let i = 0; i < 5; i++) {
      await call('POST', '/auth/mfa/verify', { json: { challenge: r.body.challenge, code: '000000' } });
    }
    const late = await call('POST', '/auth/mfa/verify', { json: { challenge: r.body.challenge, recoveryCode: recovery[5] } });
    assert.equal(late.status, 401);
    assert.match(late.body.message, /too many/i);
  });

  test('a recovery code works exactly once, and its use is recorded', async () => {
    const first = await call('POST', '/auth/sign-in', { json: { email: 'mfa@gamma.test', password: PASSWORD } });
    const used = await call('POST', '/auth/mfa/verify', { json: { challenge: first.body.challenge, recoveryCode: recovery[0]!.toLowerCase() } });
    assert.equal(used.status, 200, 'case and dash do not matter');
    const second = await call('POST', '/auth/sign-in', { json: { email: 'mfa@gamma.test', password: PASSWORD } });
    const reused = await call('POST', '/auth/mfa/verify', { json: { challenge: second.body.challenge, recoveryCode: recovery[0] } });
    assert.equal(reused.status, 401);
    const log = await asOwner('GET', '/analytics/audit?action=mfa.recovery_code_used&pageSize=1');
    assert.equal(log.body.total, 1);
  });

  test('a manager can reset it for someone who lost their phone; another consultancy cannot', async () => {
    const team = await asOwner('GET', '/team');
    const saraRow = team.body.find((m: { email: string }) => m.email === 'mfa@gamma.test');
    assert.equal(saraRow.mfaEnabled, true);

    const foreign = await call('POST', `/team/${saraRow.userId}/mfa/reset`, { host: HOST.delta, session: s.deltaOwner });
    assert.equal(foreign.status, 404);
    assert.equal((await asAyesha('POST', `/team/${saraRow.userId}/mfa/reset`)).status, 403);

    assert.equal((await asOwner('POST', `/team/${saraRow.userId}/mfa/reset`)).status, 204);
    const plain = await call('POST', '/auth/sign-in', { json: { email: 'mfa@gamma.test', password: PASSWORD } });
    assert.ok(cookieFrom(plain.headers), 'signs in with the password alone again');
    assert.equal(plain.body.mfaRequired, undefined);
  });

  test('a policy that requires it stops staff at the door until they set it up, and cannot be switched off', async () => {
    const omar = await signIn('policy@gamma.test');
    assert.equal((await call('GET', '/clients', { session: omar })).status, 200);

    // The owner cannot require it of others before using it themselves.
    const first = await asOwner('PUT', '/team/security', { policy: 'staff' });
    assert.equal(first.status, 400);
    assert.equal(first.body.code, 'MFA_OWNER_FIRST');
    const ownSetup = await asOwner('POST', '/auth/mfa/setup');
    assert.equal((await asOwner('POST', '/auth/mfa/enable', { code: codeFor(ownSetup.body.secret) })).status, 200);

    assert.equal((await asOwner('PUT', '/team/security', { policy: 'staff' })).status, 200);
    assert.equal((await asOwner('GET', '/clients')).status, 200, 'the owner, already protected, carries on');
    const blocked = await call('GET', '/clients', { session: omar });
    assert.equal(blocked.status, 403);
    assert.equal(blocked.body.code, 'MFA_SETUP_REQUIRED');
    const me = await call('GET', '/auth/me', { session: omar });
    assert.equal(me.status, 200);
    assert.equal(me.body.user.mfaSetupRequired, true);
    // Clients are not covered by "staff".
    assert.equal((await call('GET', `/clients/${fx.clientAId}`, { session: s.student })).status, 200);

    const setup = await call('POST', '/auth/mfa/setup', { session: omar });
    const enable = await call('POST', '/auth/mfa/enable', { session: omar, json: { code: codeFor(setup.body.secret) } });
    assert.equal(enable.status, 200);
    assert.equal((await call('GET', '/clients', { session: omar })).status, 200, 'through, once set up');

    const off = await call('POST', '/auth/mfa/disable', { session: omar, json: { code: codeFor(setup.body.secret, 1) } });
    assert.equal(off.status, 403, 'required means it stays on');

    const log = await asOwner('GET', '/analytics/audit?action=security.policy_changed&pageSize=1');
    assert.deepEqual([log.body.items[0].metadata.from, log.body.items[0].metadata.to], ['optional', 'staff']);
    await asOwner('PUT', '/team/security', { policy: 'optional' });
  });

  test('the platform admin can reset a consultancy owner who is locked out - but not a consultant', async () => {
    const { DB } = require('../src/db/database.module') as typeof import('../src/db/database.module');
    const { eq } = require('drizzle-orm') as typeof import('drizzle-orm');
    const db = app.get<import('../src/db/connection').Db>(DB);
    await db.update(schema.users).set({ mfaEnabledAt: new Date(), mfaSecret: 'v1:x' }).where(eq(schema.users.id, fx.managerUserId));

    const consultant = await call('POST', `/admin/tenants/${fx.tenantId}/managers/${fx.c1UserId}/mfa/reset`, { host: HOST.admin, session: s.root });
    assert.equal(consultant.status, 404);
    const wrongTenant = await call('POST', `/admin/tenants/${fx.deltaTenantId}/managers/${fx.managerUserId}/mfa/reset`, { host: HOST.admin, session: s.root });
    assert.equal(wrongTenant.status, 404);
    const ok = await call('POST', `/admin/tenants/${fx.tenantId}/managers/${fx.managerUserId}/mfa/reset`, { host: HOST.admin, session: s.root });
    assert.equal(ok.status, 204);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, fx.managerUserId));
    assert.equal(u!.mfaEnabledAt, null);
  });
});

/* ------------------------------------------------------------------ */
/* The client boundary                                                 */
/* ------------------------------------------------------------------ */

describe('clients stay inside their own record whatever staff permissions say', () => {
  test('staff-only surfaces refuse a client', async () => {
    for (const [method, url] of [
      ['GET', '/team'],
      ['GET', '/team/security'],
      ['GET', '/analytics/audit'],
      ['GET', '/export/clients'],
      ['GET', '/consultants'],
    ] as const) {
      const r = await call(method, url, { session: s.student });
      assert.equal(r.status, 403, `${url} is not for clients`);
    }
  });

  test('denying staff a permission never takes the client’s own actions away', async () => {
    await asOwner('PUT', '/team/defaults', { changes: { 'chat.send': 'deny', 'document.view': 'deny' } });
    const sent = await call('POST', '/messages', { session: s.student, json: { caseId: fx.caseAId, body: 'Is my visa ready?' } });
    assert.equal(sent.status, 201);
    const docs = await call('GET', `/documents?caseId=${fx.caseAId}`, { session: s.student });
    assert.equal(docs.status, 200);
    assert.equal((await asAyesha('POST', '/messages', { caseId: fx.caseAId, body: 'Reply' })).status, 403);
    await asOwner('PUT', '/team/defaults', { changes: { 'chat.send': 'inherit', 'document.view': 'inherit' } });
  });

  test('a client never reaches another client, even one in the same consultancy', async () => {
    for (const url of [`/clients/${fx.clientBId}`, `/cases/${fx.caseBId}`, `/documents/${fx.docBId}`, `/messages?caseId=${fx.caseBId}`]) {
      assert.equal((await call('GET', url, { session: s.student })).status, 404, url);
    }
  });
});
