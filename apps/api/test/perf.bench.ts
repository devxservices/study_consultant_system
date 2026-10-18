/**
 * Performance benchmark: latency and database queries per request.
 *
 * Seeds a throwaway embedded database (never your development data), can
 * scale it up by cloning the seeded consultancy's records, boots the real API
 * in-process, and times each endpoint as the roles that use it. Every SQL
 * statement is counted, so "queries per request" is exact, not estimated.
 *
 *   npm run bench --workspace @crm/api                    # seeded data
 *   BENCH_SCALE=25 npm run bench --workspace @crm/api     # 25x the records
 *   BENCH_OUT=before.json ...                              # save results
 *
 * Numbers are for the embedded Postgres (PGlite) running in the same process
 * as the API - compare runs with each other, not with a production server.
 */
import 'reflect-metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import type { AddressInfo } from 'node:net';

const SCALE = Math.max(1, Number(process.env.BENCH_SCALE ?? 1));
const RUNS = Math.max(3, Number(process.env.BENCH_RUNS ?? 20));
const WARMUP = 3;
const apiRoot = path.resolve(__dirname, '../..');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-bench-'));

delete process.env.DATABASE_URL;
process.env.PGLITE_DIR = path.join(workDir, 'pg');
process.env.STORAGE_LOCAL_DIR = path.join(workDir, 'storage');
process.env.STORAGE_DRIVER = 'local';
process.env.NODE_ENV = 'test';
process.env.PLATFORM_DOMAIN = 'localhost';
delete process.env.ADMIN_HOST;
process.env.DEFAULT_TENANT_SLUG = 'main';

/* ------------------------------------------------------------------ */
/* Query counting                                                      */
/* ------------------------------------------------------------------ */

let queries = 0;
function countQueries(): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PGlite } = require('@electric-sql/pglite') as typeof import('@electric-sql/pglite');
  const proto = PGlite.prototype as unknown as Record<string, (...a: unknown[]) => unknown>;
  for (const method of ['query', 'exec']) {
    const original = proto[method]!;
    proto[method] = function (this: unknown, ...args: unknown[]) {
      queries++;
      return original.apply(this, args);
    };
  }
  const originalTx = proto.transaction!;
  proto.transaction = function (this: unknown, fn: unknown) {
    return originalTx.call(this, async (tx: Record<string, (...a: unknown[]) => unknown>) => {
      for (const method of ['query', 'exec']) {
        const inner = tx[method]!.bind(tx);
        tx[method] = (...args: unknown[]) => {
          queries++;
          return inner(...args);
        };
      }
      return (fn as (t: unknown) => unknown)(tx);
    });
  };
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

function run(script: string): void {
  execSync(`npx tsx ${script}`, { cwd: apiRoot, env: process.env, stdio: 'ignore' });
}

/**
 * Multiplies the main consultancy's records by cloning them with fresh ids,
 * remapping every foreign key to the clone. Unique columns get a suffix. The
 * clones behave like any other record - same consultants, stages, dates.
 */
async function scaleUp(times: number): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createDb } = require('../src/db/connection') as typeof import('../src/db/connection');
  const handle = await createDb();
  const pg = (handle.db as unknown as { $client: { exec(sql: string): Promise<unknown>; query<T>(sql: string): Promise<{ rows: T[] }> } }).$client;
  const columns = async (table: string) =>
    (
      await pg.query<{ column_name: string }>(
        `select column_name from information_schema.columns where table_name = '${table}' and table_schema = 'public' order by ordinal_position`,
      )
    ).rows.map((r) => r.column_name);

  const [main] = (await pg.query<{ id: string }>(`select id from tenants where slug = 'main'`)).rows;
  if (!main) throw new Error('no main tenant to scale');

  // Each step clones rows from a snapshot of the ORIGINAL rows (o_<table>),
  // so copy k never clones copy k-1. Joins map every foreign key to its clone.
  const plan: { table: string; joins: string; set: Record<string, string> }[] = [
    {
      table: 'clients',
      joins: 'join m_clients mc on mc.old_id = s.id',
      set: { id: 'mc.new_id', user_id: 'null', email: `'k' || $K || '.' || s.email`, full_name: `s.full_name || ' ' || $K` },
    },
    {
      table: 'cases',
      joins: 'join m_cases mk on mk.old_id = s.id join m_clients mc on mc.old_id = s.client_id',
      set: { id: 'mk.new_id', client_id: 'mc.new_id', reference: `s.reference || '-' || $K` },
    },
    { table: 'case_stage_events', joins: 'join m_cases mk on mk.old_id = s.case_id', set: { id: 'gen_random_uuid()', case_id: 'mk.new_id' } },
    {
      table: 'documents',
      joins: 'join m_documents md on md.old_id = s.id join m_cases mk on mk.old_id = s.case_id join m_clients mc on mc.old_id = s.client_id',
      set: { id: 'md.new_id', case_id: 'mk.new_id', client_id: 'mc.new_id', superseded_by: 'null' },
    },
    { table: 'document_comments', joins: 'join m_documents md on md.old_id = s.document_id', set: { id: 'gen_random_uuid()', document_id: 'md.new_id' } },
    { table: 'messages', joins: 'join m_cases mk on mk.old_id = s.case_id', set: { id: 'gen_random_uuid()', case_id: 'mk.new_id', document_id: 'null' } },
    {
      table: 'invoices',
      joins: 'join m_invoices mi on mi.old_id = s.id join m_clients mc on mc.old_id = s.client_id left join m_cases mk on mk.old_id = s.case_id',
      set: { id: 'mi.new_id', client_id: 'mc.new_id', case_id: 'mk.new_id', number: `s.number || '-' || $K` },
    },
    { table: 'invoice_items', joins: 'join m_invoices mi on mi.old_id = s.invoice_id', set: { id: 'gen_random_uuid()', invoice_id: 'mi.new_id' } },
    {
      table: 'payments',
      joins: 'join m_invoices mi on mi.old_id = s.invoice_id join m_clients mc on mc.old_id = s.client_id',
      set: { id: 'gen_random_uuid()', invoice_id: 'mi.new_id', client_id: 'mc.new_id', number: `s.number || '-' || $K` },
    },
    {
      table: 'tasks',
      joins: 'left join m_clients mc on mc.old_id = s.client_id left join m_cases mk on mk.old_id = s.case_id',
      set: { id: 'gen_random_uuid()', client_id: 'mc.new_id', case_id: 'mk.new_id' },
    },
    {
      table: 'audit_log',
      joins: 'left join m_clients mc on mc.old_id = s.client_id left join m_cases mk on mk.old_id = s.case_id',
      set: { id: 'gen_random_uuid()', client_id: 'mc.new_id', case_id: 'mk.new_id' },
    },
  ];

  const hasTenant = async (t: string) => (await columns(t)).includes('tenant_id');
  for (const step of plan) {
    const filter = (await hasTenant(step.table)) ? `where tenant_id = '${main.id}'` : '';
    await pg.exec(`create temp table o_${step.table} as select * from ${step.table} ${filter}`);
  }

  for (let k = 1; k < times; k++) {
    await pg.exec(`
      drop table if exists m_clients, m_cases, m_documents, m_invoices;
      create temp table m_clients as select id as old_id, gen_random_uuid() as new_id from o_clients;
      create temp table m_cases as select id as old_id, gen_random_uuid() as new_id from o_cases;
      create temp table m_documents as select id as old_id, gen_random_uuid() as new_id from o_documents where superseded_by is null;
      create temp table m_invoices as select id as old_id, gen_random_uuid() as new_id from o_invoices;
    `);
    for (const step of plan) {
      const cols = await columns(step.table);
      const values = cols.map((c) => (step.set[c] ?? `s.${c}`).replace(/\$K/g, String(k)));
      await pg.exec(
        `insert into ${step.table} (${cols.map((c) => `"${c}"`).join(', ')})
         select ${values.join(', ')} from o_${step.table} s ${step.joins}`,
      );
    }
  }
  await pg.exec('analyze');
  await handle.close();
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

let base = '';

async function signIn(email: string, host = 'localhost'): Promise<string> {
  const r = await fetch(`${base}/api/auth/sign-in`, {
    method: 'POST',
    headers: { 'x-tenant-host': host, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  if (r.status !== 200) throw new Error(`sign-in ${email}: ${r.status}`);
  return r.headers.getSetCookie().find((c) => c.startsWith('crm_session='))!.split(';')[0]!;
}

async function get(session: string, url: string): Promise<{ status: number; body: any; bytes: number }> {
  const r = await fetch(`${base}/api${url}`, { headers: { 'x-tenant-host': 'localhost', cookie: session } });
  const text = await r.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* csv */
  }
  return { status: r.status, body, bytes: Buffer.byteLength(text) };
}

interface Result {
  name: string;
  status: number;
  medianMs: number;
  p95Ms: number;
  queries: number;
  bytes: number;
}

async function measure(name: string, session: string, url: string): Promise<Result> {
  let status = 0;
  let bytes = 0;
  for (let i = 0; i < WARMUP; i++) await get(session, url);
  const times: number[] = [];
  const before = queries;
  for (let i = 0; i < RUNS; i++) {
    const t = performance.now();
    const r = await get(session, url);
    times.push(performance.now() - t);
    status = r.status;
    bytes = r.bytes;
  }
  times.sort((a, b) => a - b);
  return {
    name,
    status,
    medianMs: round(times[Math.floor(times.length / 2)]!),
    p95Ms: round(times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)]!),
    queries: round((queries - before) / RUNS),
    bytes,
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

/* ------------------------------------------------------------------ */

async function main() {
  const t0 = performance.now();
  run('src/db/scripts/migrate.ts');
  run('src/db/scripts/seed.ts');
  run('src/db/scripts/seed-extras.ts');
  if (SCALE > 1) await scaleUp(SCALE);
  const seededIn = Math.round(performance.now() - t0);

  countQueries();
  const { NestFactory } = require('@nestjs/core') as typeof import('@nestjs/core');
  const cookieParser = require('cookie-parser') as typeof import('cookie-parser');
  const { AppModule } = require('../src/app.module') as typeof import('../src/app.module');
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;

  const manager = await signIn('manager@consultancy.pk');
  const consultant = await signIn('ayesha@consultancy.pk');
  const clients = (await get(manager, '/clients?pageSize=100')).body;
  const withLogin = clients.items.find((c: { hasLogin?: boolean; caseCount?: number }) => c.hasLogin && (c.caseCount ?? 0) > 0);
  const clientDetail = (await get(manager, `/clients/${withLogin.id}`)).body;
  const caseId = clientDetail.cases[0].id as string;
  const client = await signIn(withLogin.email);
  const counts = await (async () => {
    const one = async (sql: string) => {
      const r = await get(manager, sql);
      return r.body?.total ?? r.body?.length ?? '?';
    };
    return { clients: await one('/clients?pageSize=1&includeArchived=true'), audit: await one('/analytics/audit?pageSize=1') };
  })();

  const plan: [string, string, string][] = [
    ['auth: who am I', 'manager', '/auth/me'],
    ['clients: list (25)', 'manager', '/clients?pageSize=25'],
    ['clients: search', 'manager', '/clients?pageSize=25&q=khan'],
    ['clients: one', 'manager', `/clients/${withLogin.id}`],
    ['cases: one', 'manager', `/cases/${caseId}`],
    ['documents: review queue', 'manager', '/documents?status=pending&pageSize=100&sort=oldest'],
    ['documents: one case', 'manager', `/documents?caseId=${caseId}&pageSize=100&sort=newest`],
    ['messages: threads', 'manager', '/messages/threads'],
    ['messages: unread', 'manager', '/messages/unread'],
    ['messages: history', 'manager', `/messages?caseId=${caseId}&limit=50`],
    ['notifications', 'manager', '/notifications?limit=20'],
    ['analytics: kpis', 'manager', '/analytics/kpis'],
    ['analytics: funnel', 'manager', '/analytics/funnel'],
    ['analytics: trends', 'manager', '/analytics/trends?months=6'],
    ['analytics: health', 'manager', '/analytics/health'],
    ['analytics: stuck', 'manager', '/analytics/stuck?pageSize=25'],
    ['analytics: activity', 'manager', '/analytics/activity?limit=8'],
    ['analytics: deadlines', 'manager', '/analytics/deadlines?days=30'],
    ['analytics: destinations', 'manager', '/analytics/destinations'],
    ['analytics: sources', 'manager', '/analytics/sources'],
    ['audit: feed', 'manager', '/analytics/audit?pageSize=50'],
    ['audit: filtered', 'manager', '/analytics/audit?pageSize=50&category=document&q=a'],
    ['billing: invoices', 'manager', '/billing/invoices?pageSize=25'],
    ['billing: totals', 'manager', '/billing/totals'],
    ['billing: ledger', 'manager', '/billing/payments?limit=50'],
    ['billing: revenue', 'manager', '/billing/revenue?months=6'],
    ['consultants: workload', 'manager', '/consultants?includeInactive=true'],
    ['team: members', 'manager', '/team'],
    ['tasks: open', 'manager', '/tasks?view=open&pageSize=25'],
    ['tasks: counts', 'manager', '/tasks/counts?scope=all'],
    ['tenancy: current', 'manager', '/tenancy/current'],
    ['consultant: clients', 'consultant', '/clients?pageSize=25'],
    ['consultant: kpis', 'consultant', '/analytics/kpis'],
    ['consultant: review queue', 'consultant', '/documents?status=pending&pageSize=100&sort=oldest'],
    ['consultant: workload', 'consultant', '/consultants/me'],
    ['client: own record', 'client', `/clients/${withLogin.id}`],
    ['client: own documents', 'client', `/documents?caseId=${caseId}&pageSize=100&sort=newest`],
    ['client: messages', 'client', `/messages?caseId=${caseId}&limit=50`],
    ['export: clients CSV', 'manager', '/export/clients'],
  ];
  const sessions: Record<string, string> = { manager, consultant, client };
  const results: Result[] = [];
  for (const [name, who, url] of plan) results.push(await measure(name, sessions[who]!, url));

  const mem = process.memoryUsage();
  console.log(`\nScale ${SCALE}x - ${counts.clients} clients, ${counts.audit} audit rows - ${RUNS} runs each (seeded in ${seededIn} ms)\n`);
  console.log('endpoint'.padEnd(30), 'status', 'median ms'.padStart(10), 'p95 ms'.padStart(8), 'queries'.padStart(8), 'bytes'.padStart(9));
  for (const r of results) {
    console.log(
      r.name.padEnd(30),
      String(r.status).padStart(6),
      r.medianMs.toFixed(1).padStart(10),
      r.p95Ms.toFixed(1).padStart(8),
      String(r.queries).padStart(8),
      String(r.bytes).padStart(9),
    );
  }
  const total = results.reduce((a, r) => ({ ms: a.ms + r.medianMs, q: a.q + r.queries }), { ms: 0, q: 0 });
  console.log(`\nsum of medians ${round(total.ms)} ms, sum of queries ${round(total.q)}; rss ${Math.round(mem.rss / 1e6)} MB, heap ${Math.round(mem.heapUsed / 1e6)} MB`);

  if (process.env.BENCH_OUT) {
    fs.writeFileSync(
      process.env.BENCH_OUT,
      JSON.stringify({ scale: SCALE, runs: RUNS, counts, results, rssMb: Math.round(mem.rss / 1e6), heapMb: Math.round(mem.heapUsed / 1e6) }, null, 2),
    );
  }
  await app.close();
  fs.rmSync(workDir, { recursive: true, force: true });
}

main().catch((e) => {
  console.error(e);
  fs.rmSync(workDir, { recursive: true, force: true });
  process.exit(1);
});
