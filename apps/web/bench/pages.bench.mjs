/**
 * Page benchmark: how long the web server takes to render each screen, and how
 * many API requests and database queries it costs to do it.
 *
 * Seeds a throwaway embedded database (never your development data), starts
 * the real API on it, builds the web app for production and starts it, then
 * requests each page as the role that uses it. A counting proxy sits between
 * the web server and the API, and the API's database counts its statements,
 * so "API calls" and "queries" per render are exact.
 *
 *   npm run bench --workspace @crm/web
 *   BENCH_OUT=pages.json npm run bench --workspace @crm/web
 *   BENCH_RUNS=30 ...          # samples per page (default 15)
 *   BENCH_SKIP_BUILD=1 ...     # reuse the existing .next build
 *
 * Like the API benchmark, the milliseconds are for this machine, with the API
 * on embedded Postgres: compare runs with each other, taken in the same
 * conditions. The call counts and the bundle sizes do not depend on either.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const RUNS = Math.max(3, Number(process.env.BENCH_RUNS ?? 15));
const WARMUP = 3;
const API_PORT = 4518;
const PROXY_PORT = 4517;
const WEB_PORT = 3517;
const COUNTER_PORT = 4519;

const webRoot = path.resolve(import.meta.dirname, '..');
const apiRoot = path.resolve(webRoot, '../api');
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-pages-'));
const nextBin = createRequire(path.join(webRoot, 'package.json')).resolve('next/dist/bin/next');

const apiEnv = {
  ...process.env,
  PGLITE_DIR: path.join(workDir, 'pg'),
  STORAGE_LOCAL_DIR: path.join(workDir, 'storage'),
  STORAGE_DRIVER: 'local',
  NODE_ENV: 'test',
  PLATFORM_DOMAIN: 'localhost',
  DEFAULT_TENANT_SLUG: 'main',
  PORT: String(API_PORT),
  WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
  BENCH_COUNTER_PORT: String(COUNTER_PORT),
};
delete apiEnv.DATABASE_URL;
delete apiEnv.ADMIN_HOST;

const webEnv = { ...process.env, API_URL: `http://127.0.0.1:${PROXY_PORT}`, NODE_ENV: 'production' };

const children = [];
let proxy = null;

function cleanup() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* already gone */
    }
  }
  proxy?.close();
  // The database files are held for a moment after the API exits.
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(workDir, { recursive: true, force: true });
      return;
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }
  }
}

/* ------------------------------------------------------------------ */
/* The counting proxy                                                  */
/* ------------------------------------------------------------------ */

/** Every request the web server made to the API, in the order it made them. */
let calls = [];

function startProxy() {
  const agent = new http.Agent({ keepAlive: true });
  proxy = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    const upstream = http.request(
      { host: '127.0.0.1', port: API_PORT, path: req.url, method: req.method, headers: req.headers, agent },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('error', () => {
      res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  return new Promise((resolve) => proxy.listen(PROXY_PORT, '127.0.0.1', resolve));
}

/* ------------------------------------------------------------------ */
/* Processes                                                           */
/* ------------------------------------------------------------------ */

function start(args, cwd, env) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  child.on('exit', (code) => {
    if (code) console.error(`[${path.basename(args[0])}] exited ${code}\n${output.slice(-2000)}`);
  });
  children.push(child);
  return child;
}

async function waitFor(url, headers = {}) {
  for (let i = 0; i < 240; i++) {
    try {
      const r = await fetch(url, { headers, redirect: 'manual' });
      await r.arrayBuffer();
      if (r.status < 500) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${url} never came up`);
}

/* ------------------------------------------------------------------ */
/* Requests                                                            */
/* ------------------------------------------------------------------ */

const api = `http://127.0.0.1:${API_PORT}/api`;

async function signIn(email) {
  const r = await fetch(`${api}/auth/sign-in`, {
    method: 'POST',
    headers: { 'x-tenant-host': 'localhost', 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  if (r.status !== 200) throw new Error(`sign-in ${email}: ${r.status}`);
  return r.headers.getSetCookie().find((c) => c.startsWith('crm_session=')).split(';')[0];
}

async function apiGet(session, url) {
  const r = await fetch(`${api}${url}`, { headers: { 'x-tenant-host': 'localhost', cookie: session } });
  return r.json();
}

/** One page, as a browser on http://localhost would ask for it. */
function page(session, url) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = http.request(
      {
        host: '127.0.0.1',
        port: WEB_PORT,
        path: url,
        headers: { host: `localhost:${WEB_PORT}`, cookie: session, accept: 'text/html' },
      },
      (res) => {
        let bytes = 0;
        res.on('data', (d) => (bytes += d.length));
        res.on('end', () => resolve({ status: res.statusCode, bytes, ms: performance.now() - started }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const round = (n) => Math.round(n * 10) / 10;

/** SQL statements the API has run so far (see count-queries.cjs). */
async function queryCount() {
  return Number(await (await fetch(`http://127.0.0.1:${COUNTER_PORT}`)).text());
}

async function measure(name, session, url) {
  for (let i = 0; i < WARMUP; i++) await page(session, url);
  calls = [];
  const queriesBefore = await queryCount();
  const times = [];
  let last = { status: 0, bytes: 0 };
  let lastCalls = [];
  for (let i = 0; i < RUNS; i++) {
    const before = calls.length;
    last = await page(session, url);
    times.push(last.ms);
    lastCalls = calls.slice(before);
  }
  times.sort((a, b) => a - b);
  return {
    name,
    url,
    status: last.status,
    medianMs: round(times[Math.floor(times.length / 2)]),
    p95Ms: round(times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)]),
    apiCalls: round(calls.length / RUNS),
    queries: round(((await queryCount()) - queriesBefore) / RUNS),
    bytes: last.bytes,
    requests: lastCalls,
  };
}

/* ------------------------------------------------------------------ */
/* Bundle sizes                                                        */
/* ------------------------------------------------------------------ */

/** What the browser downloads: every script and stylesheet the build emitted. */
function bundle() {
  const dir = path.join(webRoot, '.next/static');
  const out = { js: 0, css: 0, files: 0 };
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) (out.js += fs.statSync(p).size), out.files++;
      else if (e.name.endsWith('.css')) (out.css += fs.statSync(p).size), out.files++;
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return { jsKb: Math.round(out.js / 1024), cssKb: Math.round(out.css / 1024), files: out.files };
}

/* ------------------------------------------------------------------ */

async function main() {
  const sh = (cmd, cwd, env) => execSync(cmd, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString();

  sh('npx tsc -p tsconfig.test.json', apiRoot, process.env);
  for (const script of ['migrate', 'seed', 'seed-extras']) sh(`npx tsx src/db/scripts/${script}.ts`, apiRoot, apiEnv);

  // The build's own table of what each route sends the browser.
  let routes = '';
  if (!process.env.BENCH_SKIP_BUILD) {
    const built = sh(`"${process.execPath}" "${nextBin}" build`, webRoot, webEnv);
    routes = built.slice(built.indexOf('Route (app)'));
  }

  start(['-r', path.join(import.meta.dirname, 'count-queries.cjs'), '.test-build/src/main.js'], apiRoot, apiEnv);
  await waitFor(`${api}/health`);
  await startProxy();
  start([nextBin, 'start', '-p', String(WEB_PORT)], webRoot, webEnv);
  await waitFor(`http://127.0.0.1:${WEB_PORT}/sign-in`, { host: `localhost:${WEB_PORT}` });

  const manager = await signIn('manager@consultancy.pk');
  const consultant = await signIn('ayesha@consultancy.pk');
  const clients = await apiGet(manager, '/clients?pageSize=100');
  const withLogin = clients.items.find((c) => c.hasLogin && (c.caseCount ?? 0) > 0);
  const caseId = (await apiGet(manager, `/clients/${withLogin.id}`)).cases[0].id;
  const client = await signIn(withLogin.email);
  const own = (await apiGet(consultant, '/clients?pageSize=100')).items.find((c) => (c.caseCount ?? 0) > 0);
  const ownCaseId = (await apiGet(consultant, `/clients/${own.id}`)).cases[0].id;

  const plan = [
    ['manager: overview', manager, '/overview'],
    ['manager: clients', manager, '/overview/clients'],
    ['manager: one client', manager, `/overview/clients/${withLogin.id}`],
    ['manager: one case', manager, `/overview/cases/${caseId}`],
    ['manager: not moving', manager, '/overview/stuck'],
    ['manager: tasks', manager, '/overview/tasks'],
    ['manager: finance', manager, '/overview/finance'],
    ['manager: team', manager, '/overview/consultants'],
    ['manager: audit trail', manager, '/overview/audit'],
    ['manager: security', manager, '/overview/security'],
    ['consultant: dashboard', consultant, '/desk'],
    ['consultant: clients', consultant, '/desk/clients'],
    ['consultant: one client', consultant, `/desk/clients/${own.id}`],
    ['consultant: one case', consultant, `/desk/cases/${ownCaseId}`],
    ['consultant: to review', consultant, '/desk/reviews'],
    ['consultant: messages', consultant, '/desk/messages'],
    ['consultant: tasks', consultant, '/desk/tasks'],
    ['consultant: workload', consultant, '/desk/workload'],
    ['client: overview', client, '/portal'],
    ['client: progress', client, '/portal/progress'],
    ['client: documents', client, '/portal/documents'],
    ['client: payments', client, '/portal/payments'],
    ['client: messages', client, '/portal/messages'],
    ['sign-in page', '', '/sign-in'],
  ];

  const results = [];
  for (const [name, session, url] of plan) results.push(await measure(name, session, url));

  console.log(`\n${RUNS} renders of each page\n`);
  console.log('page'.padEnd(26), 'status', 'median ms'.padStart(10), 'p95 ms'.padStart(8), 'API calls'.padStart(10), 'queries'.padStart(8), 'bytes'.padStart(8));
  for (const r of results) {
    console.log(
      r.name.padEnd(26),
      String(r.status).padStart(6),
      r.medianMs.toFixed(1).padStart(10),
      r.p95Ms.toFixed(1).padStart(8),
      String(r.apiCalls).padStart(10),
      String(r.queries).padStart(8),
      String(r.bytes).padStart(8),
    );
  }
  const total = results.reduce(
    (a, r) => ({ ms: a.ms + r.medianMs, calls: a.calls + r.apiCalls, queries: a.queries + r.queries }),
    { ms: 0, calls: 0, queries: 0 },
  );
  const sizes = bundle();
  console.log(`\nsum of medians ${round(total.ms)} ms; per pass: ${round(total.calls)} API calls, ${round(total.queries)} queries`);
  console.log(`browser bundle: ${sizes.jsKb} KB script, ${sizes.cssKb} KB styles, ${sizes.files} files`);

  if (process.env.BENCH_OUT) {
    fs.writeFileSync(process.env.BENCH_OUT, JSON.stringify({ runs: RUNS, results, bundle: sizes, routes }, null, 2));
  }
}

main()
  .then(() => {
    cleanup();
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    cleanup();
    process.exit(1);
  });
