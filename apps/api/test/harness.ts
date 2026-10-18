/**
 * A booted API for the module suites.
 *
 * Every suite that imports this runs in its own process (node --test spawns
 * one per file), against its own throwaway embedded database and storage
 * directory, with two consultancies - alpha and bravo - each holding a
 * manager, a consultant, a client with one application and a document. The
 * suites then attack each module from the other consultancy, from the wrong
 * role, and with the permission switched off.
 *
 * Call `startApp()` in `before`, `stopApp()` in `after`.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-module-test-'));
delete process.env.DATABASE_URL;
process.env.PGLITE_DIR = path.join(workDir, 'pg');
process.env.STORAGE_LOCAL_DIR = path.join(workDir, 'storage');
process.env.STORAGE_DRIVER = 'local';
process.env.MAIL_DRIVER = 'log';
process.env.MAIL_OUTBOX_DIR = path.join(workDir, 'outbox');
process.env.MESSAGING_DRIVER = 'log';
process.env.NODE_ENV = 'test';
process.env.PLATFORM_DOMAIN = 'localhost';
delete process.env.ADMIN_HOST;
delete process.env.DEFAULT_TENANT_SLUG;

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the env above is set */
const { createDb } = require('../src/db/connection') as typeof import('../src/db/connection');
export const schema = require('../src/db/schema') as typeof import('../src/db/schema');
const { seedTenantDefaults } = require('../src/tenancy/tenant-defaults') as typeof import('../src/tenancy/tenant-defaults');
/* eslint-enable @typescript-eslint/no-require-imports */

export const PASSWORD = 'correct-horse-battery';
export const HOST = { alpha: 'alpha.localhost', bravo: 'bravo.localhost', admin: 'admin.localhost' } as const;
export const OUTBOX = process.env.MAIL_OUTBOX_DIR!;

export interface TenantFixture {
  id: string;
  host: string;
  managerEmail: string;
  consultantEmail: string;
  clientEmail: string;
  managerUserId: string;
  consultantUserId: string;
  clientUserId: string;
  consultantId: string;
  clientId: string;
  caseId: string;
  documentId: string;
  /** Role ids by system key: counsellor, senior, accountant, trainer, partner_manager. */
  roles: Record<string, string>;
}

export interface Reply {
  status: number;
  body: any;
  headers: Headers;
  raw: Buffer;
}

export type Who =
  | 'alphaManager'
  | 'alphaConsultant'
  | 'alphaClient'
  | 'bravoManager'
  | 'bravoConsultant'
  | 'bravoClient'
  | 'root';

export const fx = {} as { alpha: TenantFixture; bravo: TenantFixture };
export const session = {} as Record<Who, string>;
let base = '';
let app: { close(): Promise<void>; get<T = unknown>(token: unknown): T } | null = null;

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
  const { tenants, users, consultants, clients, cases, caseStageEvents, documents, staffRoles } = schema;

  await db.insert(users).values({
    tenantId: null,
    email: 'root@platform.test',
    passwordHash,
    fullName: 'Platform Root',
    role: 'super_admin',
  });

  async function tenant(slug: 'alpha' | 'bravo'): Promise<TenantFixture> {
    const [t] = await db.insert(tenants).values({ slug, name: `${slug} consultancy` }).returning();
    const tenantId = t!.id;
    await seedTenantDefaults(db, tenantId);
    const roleRows = await db
      .select({ id: staffRoles.id, key: staffRoles.systemKey })
      .from(staffRoles)
      .where(require('drizzle-orm').eq(staffRoles.tenantId, tenantId));
    const roles = Object.fromEntries(roleRows.map((r) => [r.key!, r.id]));

    const insertUser = async (email: string, role: 'manager' | 'consultant' | 'client') => {
      const [u] = await db
        .insert(users)
        .values({ tenantId, email, passwordHash, fullName: `${slug} ${role}`, role })
        .returning();
      return u!.id;
    };
    const managerUserId = await insertUser(`manager@${slug}.test`, 'manager');
    const consultantUserId = await insertUser(`consultant@${slug}.test`, 'consultant');
    const clientUserId = await insertUser('student@shared.test', 'client');

    const [consultant] = await db.insert(consultants).values({ tenantId, userId: consultantUserId }).returning();
    const [client] = await db
      .insert(clients)
      .values({
        tenantId,
        userId: clientUserId,
        fullName: `${slug} student`,
        email: 'student@shared.test',
        phone: '+92 300 0000000',
        assignedConsultantId: consultant!.id,
        createdBy: managerUserId,
      })
      .returning();
    const [k] = await db
      .insert(cases)
      .values({
        tenantId,
        reference: 'APP-2026-0001',
        clientId: client!.id,
        consultantId: consultant!.id,
        targetCountry: 'United Kingdom',
        currentStage: 'documents_collection',
      })
      .returning();
    await db.insert(caseStageEvents).values({ tenantId, caseId: k!.id, stage: 'documents_collection', method: 'initial' });

    const fileKey = `tenants/${tenantId}/cases/${k!.id}/passport/${randomUUID()}`;
    const full = path.join(process.env.STORAGE_LOCAL_DIR!, fileKey);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '%PDF-1.4\n% fixture passport\n');
    const [doc] = await db
      .insert(documents)
      .values({
        tenantId,
        caseId: k!.id,
        clientId: client!.id,
        type: 'passport',
        fileKey,
        fileName: 'passport.pdf',
        fileSize: 28,
        mimeType: 'application/pdf',
        uploadedBy: clientUserId,
      })
      .returning();

    return {
      id: tenantId,
      host: HOST[slug],
      managerEmail: `manager@${slug}.test`,
      consultantEmail: `consultant@${slug}.test`,
      clientEmail: 'student@shared.test',
      managerUserId,
      consultantUserId,
      clientUserId,
      consultantId: consultant!.id,
      clientId: client!.id,
      caseId: k!.id,
      documentId: doc!.id,
      roles,
    };
  }

  fx.alpha = await tenant('alpha');
  fx.bravo = await tenant('bravo');
  await handle.close();
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

export async function call(
  method: string,
  url: string,
  opts: { host: string; session?: string; json?: unknown; form?: FormData; headers?: Record<string, string> },
): Promise<Reply> {
  const json = method === 'GET' || method === 'HEAD' ? undefined : opts.json;
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: {
      'x-tenant-host': opts.host,
      ...(opts.session ? { cookie: opts.session } : {}),
      ...(json !== undefined ? { 'content-type': 'application/json' } : {}),
      ...opts.headers,
    },
    body: opts.form ?? (json !== undefined ? JSON.stringify(json) : undefined),
  });
  const raw = Buffer.from(await res.arrayBuffer());
  let body: unknown = raw.toString('utf8');
  try {
    body = raw.length ? JSON.parse(raw.toString('utf8')) : null;
  } catch {
    /* not JSON - a file, say */
  }
  return { status: res.status, body, headers: res.headers, raw };
}

export async function signIn(host: string, email: string, password = PASSWORD): Promise<string> {
  const res = await fetch(`${base}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'x-tenant-host': host, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(res.status, 200, `sign-in for ${email} on ${host} should succeed`);
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('crm_session='));
  assert.ok(cookie, 'a session cookie is set');
  return cookie.split(';')[0]!;
}

const HOST_OF: Record<Who, string> = {
  alphaManager: HOST.alpha,
  alphaConsultant: HOST.alpha,
  alphaClient: HOST.alpha,
  bravoManager: HOST.bravo,
  bravoConsultant: HOST.bravo,
  bravoClient: HOST.bravo,
  root: HOST.admin,
};

/** A request as one of the seeded people. */
export function as(who: Who) {
  return (method: string, url: string, json?: unknown) =>
    call(method, url, { host: HOST_OF[who], session: session[who], json });
}

/** A multipart upload as one of the seeded people. */
export function upload(who: Who, url: string, fields: Record<string, string>, file: { name: string; type: string; bytes: Buffer }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  form.append('file', new Blob([file.bytes], { type: file.type }), file.name);
  return call('POST', url, { host: HOST_OF[who], session: session[who], form });
}

/** A raw (non-JSON, non-multipart) request body, e.g. an upload chunk. */
export async function rawRequest(who: Who, method: string, url: string, body: Buffer, contentType: string): Promise<Reply> {
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: { 'x-tenant-host': HOST_OF[who], cookie: session[who], 'content-type': contentType },
    body,
  });
  const raw = Buffer.from(await res.arrayBuffer());
  let parsed: unknown = raw.toString('utf8');
  try {
    parsed = raw.length ? JSON.parse(raw.toString('utf8')) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, body: parsed, headers: res.headers, raw };
}

/** A minimal but valid PDF, unique per call so checksums differ. */
export function pdf(label: string = randomUUID()): Buffer {
  return Buffer.from(`%PDF-1.4\n% ${label}\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n`);
}

/** A raw query against the suite's own database, through the running app. */
export function db(): import('../src/db/connection').Db {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DB } = require('../src/db/database.module') as typeof import('../src/db/database.module');
  return app!.get(DB);
}

export function appGet<T>(token: unknown): T {
  return app!.get<T>(token);
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

export async function startApp(): Promise<void> {
  await seed();
  const { NestFactory } = require('@nestjs/core') as typeof import('@nestjs/core');
  const cookieParser = require('cookie-parser') as typeof import('cookie-parser');
  const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
  const nest = await NestFactory.create(AppModule, { logger: false, rawBody: true });
  nest.setGlobalPrefix('api');
  nest.use(cookieParser());
  const { refuseCrossSiteWrites } = require('../src/common/cross-site') as typeof import('../src/common/cross-site');
  nest.use(refuseCrossSiteWrites('crm_session'));
  await nest.listen(0, '127.0.0.1');
  const { port } = nest.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
  app = nest;

  session.alphaManager = await signIn(HOST.alpha, fx.alpha.managerEmail);
  session.alphaConsultant = await signIn(HOST.alpha, fx.alpha.consultantEmail);
  session.alphaClient = await signIn(HOST.alpha, fx.alpha.clientEmail);
  session.bravoManager = await signIn(HOST.bravo, fx.bravo.managerEmail);
  session.bravoConsultant = await signIn(HOST.bravo, fx.bravo.consultantEmail);
  session.bravoClient = await signIn(HOST.bravo, fx.bravo.clientEmail);
  session.root = await signIn(HOST.admin, 'root@platform.test');
}

export async function stopApp(): Promise<void> {
  await app?.close();
  fs.rmSync(workDir, { recursive: true, force: true });
}

/** Give a seeded consultant a role (as their manager), or take it away. */
export async function giveRole(tenant: 'alpha' | 'bravo', roleKey: string | null): Promise<void> {
  const manager = tenant === 'alpha' ? as('alphaManager') : as('bravoManager');
  const f = fx[tenant];
  const r = await manager('PUT', `/team/${f.consultantUserId}/role`, { roleId: roleKey ? f.roles[roleKey] : null });
  assert.equal(r.status, 200, `assigning role ${roleKey}: ${JSON.stringify(r.body)}`);
}

/** Set one of a seeded consultant's own permission overrides. */
export async function setPermission(tenant: 'alpha' | 'bravo', permission: string, choice: 'allow' | 'deny' | 'inherit') {
  const manager = tenant === 'alpha' ? as('alphaManager') : as('bravoManager');
  const r = await manager('PUT', `/team/${fx[tenant].consultantUserId}/permissions`, { changes: { [permission]: choice } });
  assert.equal(r.status, 200, `setting ${permission}: ${JSON.stringify(r.body)}`);
}
