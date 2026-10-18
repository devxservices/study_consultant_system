/**
 * Cross-tenant isolation.
 *
 * Boots the real API - every guard, service and SQL scope as it runs in
 * production - against a throwaway embedded database holding two
 * consultancies, then attacks each one from the other: reading, writing,
 * aggregating, referencing, subscribing and notifying across the boundary.
 * Every test states the one thing that must never happen.
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

/* ------------------------------------------------------------------ */
/* Environment - set before any app module is loaded                   */
/* ------------------------------------------------------------------ */

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-tenancy-test-'));
// Never a real database: this suite writes fixtures and would happily run
// against whatever DATABASE_URL points at.
delete process.env.DATABASE_URL;
process.env.PGLITE_DIR = path.join(workDir, 'pg');
process.env.STORAGE_LOCAL_DIR = path.join(workDir, 'storage');
process.env.STORAGE_DRIVER = 'local';
process.env.NODE_ENV = 'test';
process.env.PLATFORM_DOMAIN = 'localhost';
delete process.env.ADMIN_HOST;
delete process.env.DEFAULT_TENANT_SLUG;

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the env above is set */
const { createDb } = require('../src/db/connection') as typeof import('../src/db/connection');
const schema = require('../src/db/schema') as typeof import('../src/db/schema');
/* eslint-enable @typescript-eslint/no-require-imports */

const PASSWORD = 'correct-horse-battery';
const HOST = { alpha: 'alpha.localhost', bravo: 'bravo.localhost', admin: 'admin.localhost' };

interface TenantFixture {
  id: string;
  host: string;
  managerEmail: string;
  consultantEmail: string;
  clientEmail: string;
  consultantId: string;
  clientId: string;
  caseIds: string[];
  documentId: string;
  notificationId: string;
}

let fx: { alpha: TenantFixture; bravo: TenantFixture };
let base = '';
let app: { close(): Promise<void>; get<T = unknown>(token: unknown): T };

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

async function seed(): Promise<void> {
  const { hash } = require('bcryptjs') as typeof import('bcryptjs');
  const { migrate } = require('drizzle-orm/pglite/migrator') as typeof import('drizzle-orm/pglite/migrator');
  const handle = await createDb();
  const db = handle.db;
  await migrate(db as never, { migrationsFolder: path.resolve(__dirname, '../../drizzle') });

  const passwordHash = await hash(PASSWORD, 4);
  const {
    tenants,
    users,
    consultants,
    clients,
    cases,
    caseStageEvents,
    documents,
    messages,
    notifications,
  } = schema;

  await db.insert(users).values({
    tenantId: null,
    email: 'root@platform.test',
    passwordHash,
    fullName: 'Platform Root',
    role: 'super_admin',
  });

  async function tenant(slug: 'alpha' | 'bravo', caseCount: number): Promise<TenantFixture> {
    const [t] = await db.insert(tenants).values({ slug, name: `${slug} consultancy` }).returning();
    const tenantId = t!.id;
    const insertUser = async (email: string, role: 'manager' | 'consultant' | 'client') => {
      const [u] = await db
        .insert(users)
        .values({ tenantId, email, passwordHash, fullName: `${slug} ${role}`, role })
        .returning();
      return u!.id;
    };

    const managerId = await insertUser(`manager@${slug}.test`, 'manager');
    const consultantUserId = await insertUser(`consultant@${slug}.test`, 'consultant');
    // The same student email in both consultancies - two different people as
    // far as the platform is concerned.
    const clientUserId = await insertUser('student@shared.test', 'client');

    const [consultant] = await db
      .insert(consultants)
      .values({ tenantId, userId: consultantUserId })
      .returning();
    const [client] = await db
      .insert(clients)
      .values({
        tenantId,
        userId: clientUserId,
        fullName: `${slug} student`,
        email: 'student@shared.test',
        phone: '+92 300 0000000',
        assignedConsultantId: consultant!.id,
        createdBy: managerId,
        notes: 'Internal: prefers evening calls, family budget is tight.',
      })
      .returning();

    const caseIds: string[] = [];
    for (let i = 0; i < caseCount; i++) {
      const [k] = await db
        .insert(cases)
        .values({
          tenantId,
          reference: `APP-2026-000${i + 1}`,
          clientId: client!.id,
          consultantId: consultant!.id,
          targetCountry: 'United Kingdom',
          currentStage: 'documents_collection',
          // Old enough to be stalled, so the sweep has something to find.
          stageEnteredAt: new Date(Date.now() - 60 * 86_400_000),
        })
        .returning();
      await db.insert(caseStageEvents).values({
        tenantId,
        caseId: k!.id,
        stage: 'documents_collection',
        method: 'initial',
      });
      caseIds.push(k!.id);
    }

    const fileKey = `tenants/${tenantId}/cases/${caseIds[0]}/passport/${randomUUID()}`;
    const full = path.join(process.env.STORAGE_LOCAL_DIR!, fileKey);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '%PDF-1.4\n% fixture\n');
    const [doc] = await db
      .insert(documents)
      .values({
        tenantId,
        caseId: caseIds[0]!,
        clientId: client!.id,
        type: 'passport',
        fileKey,
        fileName: 'passport.pdf',
        fileSize: 20,
        mimeType: 'application/pdf',
        uploadedBy: clientUserId,
      })
      .returning();

    await db.insert(messages).values({
      tenantId,
      caseId: caseIds[0]!,
      senderId: clientUserId,
      senderRole: 'client',
      body: `hello from ${slug}`,
    });

    const [note] = await db
      .insert(notifications)
      .values({ tenantId, userId: managerId, type: 'document_uploaded', title: `${slug} upload` })
      .returning();

    return {
      id: tenantId,
      host: HOST[slug],
      managerEmail: `manager@${slug}.test`,
      consultantEmail: `consultant@${slug}.test`,
      clientEmail: 'student@shared.test',
      consultantId: consultant!.id,
      clientId: client!.id,
      caseIds,
      documentId: doc!.id,
      notificationId: note!.id,
    };
  }

  // Deliberately different sizes, so a leaked aggregate shows up as a wrong number.
  fx = { alpha: await tenant('alpha', 3), bravo: await tenant('bravo', 1) };
  await handle.close();
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

interface Reply {
  status: number;
  body: any;
}

async function call(
  method: string,
  url: string,
  opts: { host: string; session?: string; json?: unknown },
): Promise<Reply> {
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: {
      'x-tenant-host': opts.host,
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
    /* not JSON - a file, say */
  }
  return { status: res.status, body };
}

async function signIn(host: string, email: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'x-tenant-host': host, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  assert.equal(res.status, 200, `sign-in for ${email} on ${host} should succeed`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('crm_session='));
  assert.ok(cookie, 'a session cookie is set');
  return cookie.split(';')[0]!;
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

const session = {} as Record<
  'alphaManager' | 'alphaConsultant' | 'bravoManager' | 'bravoConsultant' | 'bravoClient' | 'root',
  string
>;

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

  session.alphaManager = await signIn(HOST.alpha, fx.alpha.managerEmail);
  session.alphaConsultant = await signIn(HOST.alpha, fx.alpha.consultantEmail);
  session.bravoManager = await signIn(HOST.bravo, fx.bravo.managerEmail);
  session.bravoConsultant = await signIn(HOST.bravo, fx.bravo.consultantEmail);
  session.bravoClient = await signIn(HOST.bravo, fx.bravo.clientEmail);
  session.root = await signIn(HOST.admin, 'root@platform.test');
});

after(async () => {
  await app?.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

const asBravo = (method: string, url: string, json?: unknown) =>
  call(method, url, { host: HOST.bravo, session: session.bravoManager, json });
const asAlpha = (method: string, url: string, json?: unknown) =>
  call(method, url, { host: HOST.alpha, session: session.alphaManager, json });

/* ------------------------------------------------------------------ */
/* Sign-in and sessions                                                */
/* ------------------------------------------------------------------ */

describe('signing in is per site', () => {
  test('a consultancy’s credentials do not work on another consultancy’s site', async () => {
    const r = await call('POST', '/auth/sign-in', {
      host: HOST.bravo,
      json: { email: fx.alpha.managerEmail, password: PASSWORD },
    });
    assert.equal(r.status, 401);
  });

  test('consultancy credentials do not work on the admin site, nor admin ones on a consultancy', async () => {
    const onAdmin = await call('POST', '/auth/sign-in', {
      host: HOST.admin,
      json: { email: fx.alpha.managerEmail, password: PASSWORD },
    });
    assert.equal(onAdmin.status, 401);
    const onTenant = await call('POST', '/auth/sign-in', {
      host: HOST.alpha,
      json: { email: 'root@platform.test', password: PASSWORD },
    });
    assert.equal(onTenant.status, 401);
  });

  test('an unknown address signs nobody in', async () => {
    const r = await call('POST', '/auth/sign-in', {
      host: 'nowhere.example.com',
      json: { email: fx.alpha.managerEmail, password: PASSWORD },
    });
    assert.equal(r.status, 404);
  });

  test('the same email is a different person in each consultancy', async () => {
    const alpha = await signIn(HOST.alpha, 'student@shared.test');
    const a = await call('GET', '/auth/me', { host: HOST.alpha, session: alpha });
    const b = await call('GET', '/auth/me', { host: HOST.bravo, session: session.bravoClient });
    assert.equal(a.body.user.tenantId, fx.alpha.id);
    assert.equal(b.body.user.tenantId, fx.bravo.id);
    assert.notEqual(a.body.user.id, b.body.user.id);
  });

  test('a session is refused on any site but its own', async () => {
    const other = await call('GET', '/auth/me', { host: HOST.bravo, session: session.alphaManager });
    assert.equal(other.status, 401);
    const admin = await call('GET', '/auth/me', { host: HOST.admin, session: session.alphaManager });
    assert.equal(admin.status, 401);
    const unknown = await call('GET', '/auth/me', { host: 'x.example.com', session: session.alphaManager });
    assert.equal(unknown.status, 401);
  });
});

/* ------------------------------------------------------------------ */
/* Reading across the boundary                                         */
/* ------------------------------------------------------------------ */

describe('one consultancy cannot read another’s records', () => {
  test('lists contain only the caller’s consultancy', async () => {
    const clients = await asBravo('GET', '/clients?pageSize=100&includeArchived=true');
    assert.equal(clients.status, 200);
    assert.deepEqual(
      clients.body.items.map((c: { id: string }) => c.id),
      [fx.bravo.clientId],
    );

    const docs = await asBravo('GET', '/documents?pageSize=100');
    assert.deepEqual(
      docs.body.items.map((d: { id: string }) => d.id),
      [fx.bravo.documentId],
    );

    const consultants = await asBravo('GET', '/consultants');
    assert.deepEqual(
      consultants.body.map((c: { id: string }) => c.id),
      [fx.bravo.consultantId],
    );

    const threads = await asBravo('GET', '/messages/threads');
    assert.deepEqual(
      threads.body.map((t: { caseId: string }) => t.caseId),
      [fx.bravo.caseIds[0]],
    );
  });

  test('a record from another consultancy is indistinguishable from one that does not exist', async () => {
    const a = fx.alpha;
    for (const url of [
      `/clients/${a.clientId}`,
      `/cases/${a.caseIds[0]}`,
      `/documents/${a.documentId}`,
      `/documents/${a.documentId}/file`,
      `/messages?caseId=${a.caseIds[0]}`,
    ]) {
      const r = await asBravo('GET', url);
      assert.equal(r.status, 404, `${url} must be 404 from the other consultancy`);
    }
    // Same answer as a genuinely missing id.
    const missing = await asBravo('GET', `/cases/${randomUUID()}`);
    assert.equal(missing.status, 404);
  });

  test('filters cannot be pointed at another consultancy', async () => {
    const byClient = await asBravo('GET', `/documents?clientId=${fx.alpha.clientId}`);
    assert.equal(byClient.body.total, 0);
    const byConsultant = await asBravo('GET', `/clients?consultantId=${fx.alpha.consultantId}`);
    assert.equal(byConsultant.body.total, 0);
    const analytics = await asBravo('GET', `/analytics/kpis?consultantId=${fx.alpha.consultantId}`);
    assert.equal(analytics.body.activeCases, 0);
  });

  test('a consultancy’s client and consultant are confined too, not just its manager', async () => {
    for (const s of [session.bravoConsultant, session.bravoClient]) {
      const r = await call('GET', `/cases/${fx.alpha.caseIds[0]}`, { host: HOST.bravo, session: s });
      assert.equal(r.status, 404);
    }
  });
});

describe('aggregates count only the caller’s consultancy', () => {
  test('dashboard figures', async () => {
    const bravo = await asBravo('GET', '/analytics/kpis');
    const alpha = await asAlpha('GET', '/analytics/kpis');
    assert.equal(bravo.body.activeCases, 1);
    assert.equal(alpha.body.activeCases, 3);
    assert.equal(bravo.body.pendingReviews, 1);

    const funnel = await asBravo('GET', '/analytics/funnel');
    assert.equal(funnel.body.totalActive, 1);

    const health = await asBravo('GET', '/analytics/health');
    assert.equal(health.body.total, 1);

    const stuck = await asBravo('GET', '/analytics/stuck?pageSize=100');
    assert.deepEqual(
      stuck.body.items.map((c: { id: string }) => c.id),
      fx.bravo.caseIds,
    );
  });

  test('the audit trail and activity feed', async () => {
    // Give alpha something to leak.
    await asAlpha('POST', `/documents/${fx.alpha.documentId}/comments`, { body: 'Alpha-only remark' });

    const audit = await asBravo('GET', '/analytics/audit?pageSize=100');
    const activity = await asBravo('GET', '/analytics/activity?limit=50');
    for (const row of [...audit.body.items, ...activity.body]) {
      assert.notEqual(row.clientId, fx.alpha.clientId, 'no alpha rows in bravo’s feeds');
    }
    const alphaAudit = await asAlpha('GET', '/analytics/audit?pageSize=100');
    assert.ok(alphaAudit.body.items.some((r: { action: string }) => r.action === 'document.commented'));
  });
});

/* ------------------------------------------------------------------ */
/* Writing across the boundary                                         */
/* ------------------------------------------------------------------ */

describe('one consultancy cannot change another’s records', () => {
  test('every write on another consultancy’s record is a 404 and changes nothing', async () => {
    const a = fx.alpha;
    const attempts: [string, string, unknown?][] = [
      ['PATCH', `/clients/${a.clientId}`, { fullName: 'Hijacked' }],
      ['POST', `/clients/${a.clientId}/archive`],
      ['PATCH', `/cases/${a.caseIds[0]}`, { notes: 'hijacked' }],
      ['POST', `/cases/${a.caseIds[0]}/stage`, { stage: 'closed', reason: 'hijack attempt here' }],
      ['POST', `/cases/${a.caseIds[0]}/status`, { status: 'withdrawn', reason: 'hijack attempt' }],
      ['POST', `/cases/${a.caseIds[0]}/recheck`],
      ['POST', `/documents/${a.documentId}/verify`],
      ['POST', `/documents/${a.documentId}/reject`, { comment: 'Rejected from the wrong consultancy entirely.' }],
      ['POST', `/documents/${a.documentId}/comments`, { body: 'hello' }],
      ['DELETE', `/documents/${a.documentId}`],
      ['POST', '/messages', { caseId: a.caseIds[0], body: 'hello from bravo' }],
      ['POST', `/messages/${a.caseIds[0]}/read`],
    ];
    for (const [method, url, json] of attempts) {
      const r = await asBravo(method, url, json);
      assert.equal(r.status, 404, `${method} ${url} must be 404 from the other consultancy`);
    }

    const client = await asAlpha('GET', `/clients/${a.clientId}`);
    assert.equal(client.body.fullName, 'alpha student');
    assert.equal(client.body.archived, false);
    const doc = await asAlpha('GET', `/documents/${a.documentId}`);
    assert.equal(doc.body.status, 'pending');
    const kase = await asAlpha('GET', `/cases/${a.caseIds[0]}`);
    assert.equal(kase.body.currentStage, 'documents_collection');
    assert.equal(kase.body.status, 'active');
    const history = await asAlpha('GET', `/messages?caseId=${a.caseIds[0]}`);
    assert.ok(history.body.every((m: { body: string }) => m.body !== 'hello from bravo'));
  });

  test('a case cannot be opened for another consultancy’s client', async () => {
    const r = await asBravo('POST', '/cases', { clientId: fx.alpha.clientId, targetCountry: 'Canada' });
    assert.equal(r.status, 404);
  });

  test('a client cannot be handed to another consultancy’s consultant', async () => {
    const create = await asBravo('POST', '/clients', {
      fullName: 'New Bravo Student',
      email: 'new.student@bravo.test',
      phone: '+92 300 1111111',
      assignedConsultantId: fx.alpha.consultantId,
    });
    assert.equal(create.status, 400);

    const reassign = await asBravo('PATCH', `/clients/${fx.bravo.clientId}`, {
      assignedConsultantId: fx.alpha.consultantId,
    });
    assert.equal(reassign.status, 400);
    const after = await asBravo('GET', `/clients/${fx.bravo.clientId}`);
    assert.equal(after.body.consultant.id, fx.bravo.consultantId);
  });

  test('uniqueness is per consultancy: an email alpha already has is free in bravo', async () => {
    const student = { fullName: 'Twice Enrolled', email: 'twice@enrolled.test', phone: '+92 300 2222222' };
    assert.equal((await asAlpha('POST', '/clients', student)).status, 201);
    assert.equal((await asBravo('POST', '/clients', student)).status, 201, 'free in another consultancy');
    assert.equal((await asAlpha('POST', '/clients', student)).status, 400, 'still unique within one');
  });

  test('marking another user’s notification read changes nothing', async () => {
    const r = await asBravo('POST', `/notifications/${fx.alpha.notificationId}/read`);
    assert.equal(r.status, 204);
    const alpha = await asAlpha('GET', '/notifications');
    const note = alpha.body.items.find((n: { id: string }) => n.id === fx.alpha.notificationId);
    assert.equal(note.readAt, null);
  });

  test('a manager’s stuck-case sweep only alerts their own consultancy', async () => {
    const r = await asBravo('POST', '/analytics/stuck/sweep');
    assert.equal(r.status, 201);
    assert.ok(r.body.raised >= 1);

    const alpha = await asAlpha('GET', '/notifications?limit=50');
    assert.ok(
      alpha.body.items.every((n: { type: string }) => n.type !== 'case_stuck'),
      'alpha got no stuck alerts from bravo’s sweep',
    );
    const bravo = await asBravo('GET', '/notifications?limit=50');
    const stuck = bravo.body.items.filter((n: { type: string }) => n.type === 'case_stuck');
    assert.ok(stuck.length >= 1);
    assert.ok(stuck.every((n: { caseId: string }) => fx.bravo.caseIds.includes(n.caseId)));
  });
});

/* ------------------------------------------------------------------ */
/* Realtime                                                            */
/* ------------------------------------------------------------------ */

describe('realtime chat', () => {
  function join(sessionCookie: string, caseId: string): Promise<{ ok: boolean }> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { io } = require('socket.io-client') as typeof import('socket.io-client');
    return new Promise((resolve, reject) => {
      const socket = io(`${base}/chat`, {
        path: '/api/socket.io',
        addTrailingSlash: false,
        transports: ['websocket'],
        extraHeaders: { cookie: sessionCookie },
      });
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('socket timed out'));
      }, 5_000);
      socket.on('connect', () =>
        socket.emit('chat:join', { caseId }, (ack: { ok: boolean }) => {
          clearTimeout(timer);
          socket.close();
          resolve(ack);
        }),
      );
      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  test('a socket cannot join another consultancy’s conversation', async () => {
    assert.deepEqual(await join(session.bravoManager, fx.alpha.caseIds[0]!), { ok: false });
    assert.deepEqual(await join(session.alphaManager, fx.alpha.caseIds[0]!), { ok: true });
  });
});


/* ------------------------------------------------------------------ */
/* The modules: billing, tasks, announcements, plans                   */
/* ------------------------------------------------------------------ */

describe('every module stays inside its consultancy', () => {
  const made: Record<string, string> = {};

  before(async () => {
    // Alpha builds up one of everything, through the API like a real user.
    const pkg = await asAlpha('POST', '/billing/packages', { name: 'Alpha package', amount: 5_000_00, currency: 'PKR' });
    made.package = pkg.body.id;
    const inv = await asAlpha('POST', '/billing/invoices', {
      clientId: fx.alpha.clientId,
      dueDate: '2099-01-01',
      items: [{ description: 'Admission processing', packageId: made.package, unitAmount: 5_000_00 }],
    });
    made.invoice = inv.body.id;
    const paid = await asAlpha('POST', `/billing/invoices/${made.invoice}/payments`, {
      amount: 2_000_00,
      method: 'cash',
      receivedOn: new Date().toISOString().slice(0, 10),
    });
    made.payment = paid.body.payments[0].id;
    const task = await asAlpha('POST', '/tasks', { title: 'Alpha-only follow-up', caseId: fx.alpha.caseIds[0] });
    made.task = task.body.id;
    const notice = await asAlpha('POST', '/announcements', { title: 'Alpha notice', body: 'For alpha only', audience: 'everyone' });
    made.announcement = notice.body.id;
    for (const [k, v] of Object.entries(made)) assert.ok(v, `alpha created its ${k}`);
  });

  test('none of it shows up in the other consultancy’s lists', async () => {
    const lists: [string, (b: any) => string[]][] = [
      ['/billing/packages?all=true', (b) => b.map((x: any) => x.id)],
      ['/billing/invoices?pageSize=100', (b) => b.items.map((x: any) => x.id)],
      ['/billing/payments?limit=200', (b) => b.map((x: any) => x.id)],
      ['/tasks?view=all&pageSize=100', (b) => b.items.map((x: any) => x.id)],
      ['/announcements', (b) => b.map((x: any) => x.id)],
      ['/announcements/all', (b) => b.map((x: any) => x.id)],
    ];
    const alphaIds = new Set(Object.values(made));
    for (const [url, ids] of lists) {
      const r = await asBravo('GET', url);
      assert.equal(r.status, 200, url);
      for (const id of ids(r.body)) assert.ok(!alphaIds.has(id), `${url} leaked an alpha row`);
    }
    const totals = await asBravo('GET', '/billing/totals');
    assert.equal(totals.body.length, 0, 'no money of alpha’s in bravo’s totals');
  });

  test('every one of them is a 404 by id from the other consultancy', async () => {
    const attempts: [string, string, unknown?][] = [
      ['PATCH', `/billing/packages/${made.package}`, { name: 'Taken over', amount: 1, currency: 'PKR' }],
      ['GET', `/billing/invoices/${made.invoice}`],
      ['POST', `/billing/invoices/${made.invoice}/payments`, { amount: 100, method: 'cash', receivedOn: '2020-01-01' }],
      ['POST', `/billing/invoices/${made.invoice}/void`, { reason: 'Voided from the wrong place' }],
      ['POST', `/billing/payments/${made.payment}/void`, { reason: 'Voided from the wrong place' }],
      ['GET', `/billing/payments/${made.payment}/receipt`],
      ['GET', `/tasks/${made.task}`],
      ['PATCH', `/tasks/${made.task}`, { status: 'done' }],
      ['DELETE', `/tasks/${made.task}`],
      ['DELETE', `/announcements/${made.announcement}`],
    ];
    for (const [method, url, json] of attempts) {
      const r = await asBravo(method, url, json);
      assert.equal(r.status, 404, `${method} ${url} must be 404 from the other consultancy`);
    }
    const inv = await asAlpha('GET', `/billing/invoices/${made.invoice}`);
    assert.equal(inv.body.status, 'issued');
    assert.equal(inv.body.paid, 2_000_00, 'the ledger is untouched');
    const task = await asAlpha('GET', `/tasks/${made.task}`);
    assert.equal(task.body.status, 'open');
  });

  test('nothing can point across the line', async () => {
    // Bill another consultancy's client, or use its price list.
    const foreignClient = await asBravo('POST', '/billing/invoices', {
      clientId: fx.alpha.clientId,
      dueDate: '2099-01-01',
      items: [{ description: 'Consultation', unitAmount: 100 }],
    });
    assert.equal(foreignClient.status, 404);
    const foreignPackage = await asBravo('POST', '/billing/invoices', {
      clientId: fx.bravo.clientId,
      dueDate: '2099-01-01',
      items: [{ description: 'Consultation', packageId: made.package, unitAmount: 100 }],
    });
    assert.equal(foreignPackage.status, 400);
    // Give a task to someone in another consultancy, or hang it on their case.
    const alphaUser = (await asAlpha('GET', '/auth/me')).body.user.id;
    const foreignAssignee = await asBravo('POST', '/tasks', { title: 'Do this please', assigneeId: alphaUser });
    assert.equal(foreignAssignee.status, 400);
    const foreignCase = await asBravo('POST', '/tasks', { title: 'Do this please', caseId: fx.alpha.caseIds[0] });
    assert.equal(foreignCase.status, 404);
  });

  test('a client reads their own record without the office’s internal notes', async () => {
    const staff = await asBravo('GET', `/clients/${fx.bravo.clientId}`);
    assert.match(staff.body.notes, /Internal/);
    const own = await call('GET', `/clients/${fx.bravo.clientId}`, { host: HOST.bravo, session: session.bravoClient });
    assert.equal(own.status, 200);
    assert.equal(own.body.notes, null);
    const kase = await call('GET', `/cases/${fx.bravo.caseIds[0]}`, { host: HOST.bravo, session: session.bravoClient });
    assert.equal(kase.body.notes, null);
  });

  test('a client sees their own invoices and nobody else’s, and cannot write', async () => {
    const bravoInvoice = await asBravo('POST', '/billing/invoices', {
      clientId: fx.bravo.clientId,
      dueDate: '2099-01-01',
      items: [{ description: 'Consultation', unitAmount: 1_000_00 }],
    });
    assert.equal(bravoInvoice.status, 201);
    const asClient = (method: string, url: string, json?: unknown) =>
      call(method, url, { host: HOST.bravo, session: session.bravoClient, json });
    const mine = await asClient('GET', '/billing/invoices');
    assert.deepEqual(mine.body.items.map((i: any) => i.id), [bravoInvoice.body.id]);
    assert.equal((await asClient('GET', `/billing/invoices/${made.invoice}`)).status, 404);
    const write = await asClient('POST', `/billing/invoices/${bravoInvoice.body.id}/payments`, {
      amount: 100,
      method: 'cash',
      receivedOn: '2020-01-01',
    });
    assert.equal(write.status, 403, 'clients never record their own payments');
    assert.equal((await asClient('GET', '/tasks')).status, 403, 'tasks are the office’s, not the client’s');
  });

  test('within a consultancy, a consultant only reaches their own clients’ money', async () => {
    // A second alpha client, assigned to nobody, invoiced by the manager.
    const other = await asAlpha('POST', '/clients', { fullName: 'Unassigned Student', email: 'unassigned@alpha.test', phone: '+92 300 4444444' });
    const inv = await asAlpha('POST', '/billing/invoices', {
      clientId: other.body.id,
      dueDate: '2099-01-01',
      items: [{ description: 'Consultation', unitAmount: 100_00 }],
    });
    const asConsultant = (method: string, url: string, json?: unknown) =>
      call(method, url, { host: HOST.alpha, session: session.alphaConsultant, json });
    assert.equal((await asConsultant('GET', `/billing/invoices/${inv.body.id}`)).status, 404);
    assert.equal((await asConsultant('GET', `/billing/invoices/${made.invoice}`)).status, 200, 'their own client’s invoice is fine');
    const refund = await asConsultant('POST', `/billing/invoices/${made.invoice}/payments`, {
      kind: 'refund',
      amount: 100,
      method: 'cash',
      receivedOn: '2020-01-01',
    });
    assert.equal(refund.status, 403, 'refunds are a manager’s call');
  });

  test('the plan decides which modules a consultancy can use, on the server', async () => {
    const asRoot = (method: string, url: string, json?: unknown) =>
      call(method, url, { host: HOST.admin, session: session.root, json });
    const plan = await asRoot('POST', '/admin/plans', {
      code: 'tiny',
      name: 'Tiny',
      priceMonthly: 100,
      currency: 'USD',
      maxStaff: null,
      maxActiveClients: 1,
      storageGb: null,
      modules: ['tasks'],
    });
    assert.equal(plan.status, 201);
    const put = await asRoot('POST', `/admin/tenants/${fx.bravo.id}/subscription`, {
      planId: plan.body.id,
      subscriptionStatus: 'active',
    });
    assert.equal(put.status, 201);

    assert.equal((await asBravo('GET', '/billing/invoices')).status, 403, 'billing is off');
    assert.equal((await asBravo('GET', '/catalog/programs')).status, 404, 'the catalogue no longer exists');
    assert.equal((await asBravo('GET', '/tasks')).status, 200, 'tasks are on');
    const ent = await asBravo('GET', '/tenancy/entitlements');
    assert.deepEqual(ent.body.modules, ['tasks']);
    // Bravo already has more active clients than the plan allows.
    const extra = await asBravo('POST', '/clients', { fullName: 'One Too Many', email: 'toomany@bravo.test', phone: '+92 300 5555555' });
    assert.equal(extra.status, 403);
    // Alpha, on no plan, is untouched.
    assert.equal((await asAlpha('GET', '/billing/invoices')).status, 200);

    await asRoot('POST', `/admin/tenants/${fx.bravo.id}/subscription`, { planId: null, subscriptionStatus: 'active' });
    assert.equal((await asBravo('GET', '/billing/invoices')).status, 200, 'back on with no plan');
  });
});

/* ------------------------------------------------------------------ */
/* The platform admin                                                  */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/* The change marker the browser's page cache is checked against        */
/* ------------------------------------------------------------------ */

describe('"has anything changed?" answers for the caller’s consultancy only', () => {
  const changed = async (host: string, sessionCookie: string, since: number) => {
    const r = await call('GET', `/sync/changes?since=${since}`, { host, session: sessionCookie });
    assert.equal(r.status, 200);
    assert.equal(typeof r.body.now, 'number');
    return r.body.changed as boolean;
  };
  const quiet = () => new Promise((r) => setTimeout(r, 1_200));

  const sendOverSocket = (sessionCookie: string, caseId: string) =>
    emitOverSocket(sessionCookie, 'chat:send', { caseId, body: 'Checking in about your documents.' });

  function emitOverSocket(sessionCookie: string, event: string, payload: unknown): Promise<{ ok: boolean }> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { io } = require('socket.io-client') as typeof import('socket.io-client');
    return new Promise((resolve, reject) => {
      const socket = io(`${base}/chat`, {
        path: '/api/socket.io',
        addTrailingSlash: false,
        transports: ['websocket'],
        extraHeaders: { cookie: sessionCookie },
      });
      const timer = setTimeout(() => {
        socket.close();
        reject(new Error('socket timed out'));
      }, 5_000);
      socket.on('connect', () =>
        socket.emit(event, payload, (ack: { ok: boolean }) => {
          clearTimeout(timer);
          socket.close();
          resolve(ack);
        }),
      );
      socket.on('connect_error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  test('a write moves only its own consultancy’s marker, and reading moves nothing', async () => {
    // A page "rendered" now, after a quiet spell longer than the clock margin.
    await quiet();
    const renderedAt = Date.now();
    assert.equal(await changed(HOST.alpha, session.alphaManager, renderedAt), false);
    assert.equal(await changed(HOST.bravo, session.bravoManager, renderedAt), false);

    // Reading is not a change.
    for (const url of ['/clients', `/clients/${fx.bravo.clientId}`, '/analytics/kpis']) {
      await asBravo('GET', url);
    }
    assert.equal(await changed(HOST.bravo, session.bravoManager, renderedAt), false);

    // A write in alpha is news in alpha - and not in bravo.
    const write = await asAlpha('PATCH', `/clients/${fx.alpha.clientId}`, { fullName: 'alpha student' });
    assert.equal(write.status, 200);
    assert.equal(await changed(HOST.alpha, session.alphaManager, renderedAt), true);
    assert.equal(await changed(HOST.alpha, session.alphaConsultant, renderedAt), true);
    assert.equal(await changed(HOST.bravo, session.bravoManager, renderedAt), false);

    // A refused write from the other consultancy changes nothing there either.
    const attack = await asBravo('PATCH', `/clients/${fx.alpha.clientId}`, { fullName: 'Hijacked' });
    assert.equal(attack.status, 404);

    // A page rendered after the write is up to date.
    await quiet();
    assert.equal(await changed(HOST.alpha, session.alphaManager, Date.now()), false);
  });

  test('a chat message sent over the socket counts as a change', async () => {
    await quiet();
    const renderedAt = Date.now();
    assert.equal(await changed(HOST.alpha, session.alphaManager, renderedAt), false);
    const ack = await sendOverSocket(session.alphaManager, fx.alpha.caseIds[0]!);
    assert.equal(ack.ok, true, 'the message is sent');
    assert.equal(await changed(HOST.alpha, session.alphaManager, renderedAt), true);
    assert.equal(await changed(HOST.bravo, session.bravoManager, renderedAt), false);
  });

  test('writes no page shows are not news: an empty "read" and clearing the bell', async () => {
    const caseId = fx.alpha.caseIds[0]!;
    // Read whatever is unread, so the next read has nothing to mark.
    assert.equal((await emitOverSocket(session.alphaManager, 'chat:read', { caseId })).ok, true);
    await quiet();
    const renderedAt = Date.now();

    assert.equal((await emitOverSocket(session.alphaManager, 'chat:read', { caseId })).ok, true);
    const bell = await asAlpha('POST', '/notifications/read-all');
    assert.equal(bell.status, 204);
    assert.equal(await changed(HOST.alpha, session.alphaManager, renderedAt), false);

    // A read that marks someone's message is news: their unread counts move.
    assert.equal((await sendOverSocket(session.alphaConsultant, caseId)).ok, true);
    await quiet();
    const afterSend = Date.now();
    assert.equal((await emitOverSocket(session.alphaManager, 'chat:read', { caseId })).ok, true);
    assert.equal(await changed(HOST.alpha, session.alphaManager, afterSend), true);
  });

  test('clients learn nothing about office activity, the platform admin always re-checks, nonsense is refused', async () => {
    // However quiet the consultancy, a client is told to re-check - so the
    // answer can never tell them when staff are busy.
    await quiet();
    assert.equal(await changed(HOST.bravo, session.bravoClient, Date.now() + 60_000), true);
    assert.equal(await changed(HOST.bravo, session.bravoManager, Date.now() + 60_000), false);
    assert.equal(await changed(HOST.admin, session.root, Date.now() + 60_000), true);
    for (const since of ['', 'yesterday', '-5']) {
      const r = await call('GET', `/sync/changes?since=${since}`, { host: HOST.bravo, session: session.bravoManager });
      assert.equal(r.status, 400, `since=${since} must be refused`);
    }
    const anonymous = await call('GET', '/sync/changes?since=0', { host: HOST.bravo });
    assert.equal(anonymous.status, 401);
  });
});

describe('the platform admin', () => {
  const asRoot = (method: string, url: string, json?: unknown) =>
    call(method, url, { host: HOST.admin, session: session.root, json });

  test('manages consultancies but cannot read what is inside them', async () => {
    const list = await asRoot('GET', '/admin/tenants');
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 2);

    for (const url of ['/clients', `/cases/${fx.alpha.caseIds[0]}`, `/documents/${fx.alpha.documentId}`, '/messages/threads']) {
      const r = await asRoot('GET', url);
      assert.equal(r.status, 403, `${url} must be refused to the platform admin`);
    }
  });

  test('no consultancy user can reach the admin routes', async () => {
    for (const s of [session.alphaManager, session.bravoConsultant]) {
      const host = s === session.alphaManager ? HOST.alpha : HOST.bravo;
      const r = await call('GET', '/admin/tenants', { host, session: s });
      assert.equal(r.status, 403);
    }
  });

  test('onboarding is atomic and cannot be duplicated', async () => {
    const body = {
      name: 'Charlie Consultancy',
      slug: 'charlie',
      manager: { fullName: 'Charlie Manager', email: 'manager@charlie.test', password: PASSWORD },
    };
    const first = await asRoot('POST', '/admin/tenants', body);
    assert.equal(first.status, 201);
    const again = await asRoot('POST', '/admin/tenants', body);
    assert.equal(again.status, 409);

    // Its manager signs in at its own address and finds an empty workspace.
    const charlie = await signIn('charlie.localhost', 'manager@charlie.test');
    const clients = await call('GET', '/clients', { host: 'charlie.localhost', session: charlie });
    assert.equal(clients.body.total, 0);
  });

  test('suspending a consultancy locks it out at once, deletes nothing, and touches no one else', async () => {
    const suspend = await asRoot('POST', `/admin/tenants/${fx.bravo.id}/status`, {
      status: 'suspended',
      reason: 'Invoice unpaid after two reminders',
    });
    assert.equal(suspend.status, 201);

    const me = await call('GET', '/auth/me', { host: HOST.bravo, session: session.bravoManager });
    assert.equal(me.status, 403, 'an existing session stops working on its next request');
    const signin = await call('POST', '/auth/sign-in', {
      host: HOST.bravo,
      json: { email: fx.bravo.managerEmail, password: PASSWORD },
    });
    assert.equal(signin.status, 403);
    const site = await call('GET', '/tenancy/current', { host: HOST.bravo });
    assert.equal(site.body.available, false);

    const alpha = await asAlpha('GET', '/auth/me');
    assert.equal(alpha.status, 200, 'another consultancy is unaffected');

    await asRoot('POST', `/admin/tenants/${fx.bravo.id}/status`, { status: 'active' });
    const back = await call('GET', `/clients/${fx.bravo.clientId}`, {
      host: HOST.bravo,
      session: session.bravoManager,
    });
    assert.equal(back.status, 200, 'reactivated with its records intact');
  });

  test('a custom domain serves a consultancy only once verified', async () => {
    const add = await asRoot('POST', `/admin/tenants/${fx.bravo.id}/domains`, {
      hostname: 'portal.bravo-example.com',
    });
    assert.equal(add.status, 201);
    const before = await call('GET', '/tenancy/current', { host: 'portal.bravo-example.com' });
    assert.equal(before.status, 404, 'unverified domains route nowhere');

    const taken = await asRoot('POST', `/admin/tenants/${fx.alpha.id}/domains`, {
      hostname: 'portal.bravo-example.com',
    });
    assert.equal(taken.status, 409, 'a domain belongs to one consultancy');

    const platform = await asRoot('POST', `/admin/tenants/${fx.alpha.id}/domains`, {
      hostname: 'bravo.localhost',
    });
    assert.equal(platform.status, 400, 'platform addresses cannot be claimed');

    // Stand in for the DNS check, then confirm routing follows the proof.
    const { eq } = require('drizzle-orm') as typeof import('drizzle-orm');
    const { DB } = require('../src/db/database.module') as typeof import('../src/db/database.module');
    const { TenantResolver } =
      require('../src/tenancy/tenant-resolver.service') as typeof import('../src/tenancy/tenant-resolver.service');
    const db = app.get<import('../src/db/connection').Db>(DB);
    await db
      .update(schema.tenantDomains)
      .set({ verifiedAt: new Date() })
      .where(eq(schema.tenantDomains.hostname, 'portal.bravo-example.com'));
    app.get<InstanceType<typeof TenantResolver>>(TenantResolver).invalidate();

    const afterVerify = await call('GET', '/tenancy/current', { host: 'portal.bravo-example.com' });
    assert.equal(afterVerify.body.tenant.id, fx.bravo.id);
    const alphaOnBravoDomain = await call('POST', '/auth/sign-in', {
      host: 'portal.bravo-example.com',
      json: { email: fx.alpha.managerEmail, password: PASSWORD },
    });
    assert.equal(alphaOnBravoDomain.status, 401);
  });
});
