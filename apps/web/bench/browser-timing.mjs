// Reproduces the README "Clicks, tabs and filters" figures against a running
// app (npm run dev:api + a production web build), with the seeded accounts.
// Needs puppeteer-core and Chrome: npm i --no-save puppeteer-core
//   node apps/web/bench/browser-timing.mjs <label> manager|consultant|client [--freshness]
// Real-browser timing + correctness of the interactions a user feels.
// Reports, per action: when the rail highlight moved, when the page landed
// (painted, with the new page's render stamp), how many navigation requests
// and how many "has anything changed?" checks it caused, and whether the page
// was then refreshed in the background.
import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE ?? 'http://localhost:3000';
const label = process.argv[2] ?? 'run';
const role = process.argv[3] ?? 'manager';
const doFreshness = process.argv.includes('--freshness');
const ACCOUNTS = {
  manager: { email: 'manager@consultancy.pk', home: '/overview', clients: '/overview/clients' },
  consultant: { email: 'ayesha@consultancy.pk', home: '/desk', clients: '/desk/clients' },
  client: { email: 'shahzaib.qureshi@gmail.com', home: '/portal' },
};
const acct = ACCOUNTS[role];

const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  defaultViewport: { width: 1440, height: 900 },
});

async function signedInPage() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const log = { rsc: [], checks: 0, api: 0 };
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (r.headers()['rsc'] === '1') log.rsc.push(r.headers()['next-router-prefetch'] ? 'prefetch' : 'nav');
    if (u.pathname === '/api/sync/changes') log.checks++;
    else if (u.pathname.startsWith('/api/')) log.api++;
  });
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle0' });
  const status = await page.evaluate(async (email) => {
    const r = await fetch('/api/auth/sign-in', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    return r.status;
  }, acct.email);
  if (status !== 200) throw new Error(`sign-in ${status}`);
  await page.goto(`${BASE}${acct.home}`, { waitUntil: 'networkidle0' });
  return { page, log };
}

/** Perform an action, then time until the expected address shows a new, painted page. */
async function timed(page, log, act, expect) {
  log.rsc = [];
  log.checks = 0;
  log.api = 0;
  const before = await page.evaluate(() => document.documentElement.dataset.renderId ?? null);
  const watch = page.evaluate(
    (expect, before) =>
      new Promise((resolve) => {
        const t0 = performance.now();
        let highlight = null;
        let settled = false;
        const href = expect.highlight;
        const check = () => {
          const now = performance.now() - t0;
          if (href && highlight === null) {
            const a = [...document.querySelectorAll(`a[href="${href}"]`)].find((x) => x.offsetParent !== null);
            if (a?.getAttribute('aria-current') === 'page') highlight = now;
          }
          if (settled) return;
          const here = location.pathname + location.search;
          const okPath = expect.exact ? here === expect.exact : here.startsWith(expect.path) && (!expect.search || location.search.includes(expect.search));
          const id = document.documentElement.dataset.renderId;
          if (!okPath || !id || (expect.newPage && id === before)) return;
          settled = true;
          mo.disconnect();
          requestAnimationFrame(() => setTimeout(() => resolve({ highlight, landed: performance.now() - t0, id }), 0));
        };
        const mo = new MutationObserver(check);
        mo.observe(document, { subtree: true, childList: true, attributes: true });
        window.__go = () => check();
        setTimeout(() => {
          if (!settled) {
            mo.disconnect();
            resolve({ highlight, landed: null, timeout: location.pathname + location.search });
          }
        }, 8000);
      }),
    expect,
    before,
  );
  await act();
  const res = await watch;
  // Let any background check and refresh finish, then see if the page changed.
  await new Promise((r) => setTimeout(r, 700));
  const after = await page.evaluate(() => document.documentElement.dataset.renderId ?? null);
  return {
    ...res,
    nav: log.rsc.filter((k) => k === 'nav').length,
    prefetch: log.rsc.filter((k) => k === 'prefetch').length,
    checks: log.checks,
    api: log.api,
    refreshed: res.id && after !== res.id,
  };
}

const fmt = (v) => (v == null ? '    -' : v.toFixed(0).padStart(5));
const rows = [];
function report(name, r) {
  rows.push({ name, ...r });
  console.log(
    `${name.padEnd(36)} highlight ${fmt(r.highlight)}  landed ${fmt(r.landed)}  nav ${r.nav}  prefetch ${r.prefetch}  checks ${r.checks}  refreshed ${r.refreshed ? 'yes' : 'no '}${r.timeout ? '  TIMEOUT at ' + r.timeout : ''}`,
  );
}
const click = (page, href) => () =>
  page.evaluate((href) => {
    const a = [...document.querySelectorAll(`a[href="${href}"]`)].find((x) => x.offsetParent !== null);
    a.click();
  }, href);

console.log(`# ${label} (${role}) ${new Date().toISOString()}`);
const { page, log } = await signedInPage();
const rail = await page.evaluate(() =>
  [...document.querySelectorAll('nav a[href]')]
    .filter((a) => a.offsetParent !== null && a.getAttribute('href').startsWith('/'))
    .map((a) => a.getAttribute('href'))
    .filter((h, i, all) => all.indexOf(h) === i),
);
const order = [...rail.slice(1), rail[0]];

for (const href of order) report(`first ${href}`, await timed(page, log, click(page, href), { exact: href, highlight: href, newPage: true }));
for (const href of order) report(`again ${href}`, await timed(page, log, click(page, href), { exact: href, highlight: href, newPage: false }));

// A fresh browser: hover (real mouse), pause like a person does, then click.
{
  const fresh = await signedInPage();
  for (const href of order) {
    const r = await timed(fresh.page, fresh.log, async () => {
      const sel = `nav a[href="${href}"]`;
      const handle = (await fresh.page.$$(sel)).find(Boolean);
      const visible = [];
      for (const h of await fresh.page.$$(sel)) if (await h.isVisible()) visible.push(h);
      await visible[0].hover();
      await new Promise((r) => setTimeout(r, 250));
      await visible[0].click();
      void handle;
    }, { exact: href, highlight: href, newPage: true });
    report(`hover+click ${href}`, r);
  }
  await fresh.page.browserContext().close();
}

if (acct.clients) {
  const list = acct.clients;
  await page.goto(`${BASE}${list}`, { waitUntil: 'networkidle0' });
  const type = (value) => async () => {
    // Triple-click does not reliably select the text of a type="search" input.
    await page.click('input[aria-label="Search clients"]');
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    if (value) await page.type('input[aria-label="Search clients"]', value, { delay: 40 });
    else await page.keyboard.press('Backspace');
  };
  report('search "ali" (typed)', await timed(page, log, type('ali'), { path: list, search: 'q=ali', newPage: true }));
  report('search cleared', await timed(page, log, type(''), { exact: list, newPage: true }));
  report('search "ali" again', await timed(page, log, type('ali'), { path: list, search: 'q=ali', newPage: true }));
  report('search cleared again', await timed(page, log, type(''), { exact: list, newPage: true }));
  const pick = (sel, v) => () => page.select(sel, v);
  report('stage = documents', await timed(page, log, pick('select[aria-label="Filter by stage"]', 'documents_collection'), { path: list, search: 'stage=documents_collection', newPage: true }));
  report('stage = offer letter', await timed(page, log, pick('select[aria-label="Filter by stage"]', 'offer_letter'), { path: list, search: 'stage=offer_letter', newPage: true }));
  report('stage = documents again', await timed(page, log, pick('select[aria-label="Filter by stage"]', 'documents_collection'), { path: list, search: 'stage=documents_collection', newPage: true }));
  report('stage = all', await timed(page, log, pick('select[aria-label="Filter by stage"]', ''), { exact: list, newPage: true }));
  report('sort by name', await timed(page, log, pick('select[aria-label="Sort clients"]', 'name'), { path: list, search: 'sort=name', newPage: true }));
  report('sort back to recent', await timed(page, log, pick('select[aria-label="Sort clients"]', 'recent'), { path: list, newPage: true }));
}

if (doFreshness && acct.clients) {
  console.log('\n# freshness: a colleague changes a client while this list is kept in the browser');
  const list = acct.clients;
  await page.goto(`${BASE}${list}?sort=name`, { waitUntil: 'networkidle0' });
  const target = await page.evaluate(async () => {
    const r = await fetch('/api/clients?pageSize=1&sort=name');
    const { items } = await r.json();
    return { id: items[0].id, name: items[0].fullName };
  });
  const elsewhere = rail.find((h) => h !== list && h !== acct.home) ?? acct.home;
  // Visit another tab, so the list is now a kept copy.
  await timed(page, log, click(page, elsewhere), { exact: elsewhere, newPage: true });
  // The colleague (a separate session) renames the client.
  const marked = `${target.name} [freshness test]`;
  const colleague = await browser.createBrowserContext();
  const cp = await colleague.newPage();
  await cp.goto(`${BASE}/sign-in`);
  const renamed = await cp.evaluate(async (email, id, name) => {
    await fetch('/api/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
    const r = await fetch(`/api/clients/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: name }) });
    return r.status;
  }, acct.email, target.id, marked);
  console.log(`colleague renamed "${target.name}" -> status ${renamed}`);
  // Back to the list: shown at once from the keep, then checked and refreshed.
  await page.evaluate((href) => {
    const a = [...document.querySelectorAll('nav a[href]')].find((x) => x.getAttribute('href') === href && x.offsetParent !== null);
    window.__shownAt = null;
    a.click();
  }, list);
  const t0 = Date.now();
  let sawOld = false;
  let sawNewAt = null;
  while (Date.now() - t0 < 4000) {
    const state = await page.evaluate((marked) => ({ path: location.pathname, has: document.body.innerText.includes(marked) }), marked);
    if (state.path === list && !state.has) sawOld = true;
    if (state.path === list && state.has) { sawNewAt = Date.now() - t0; break; }
    await new Promise((r) => setTimeout(r, 15));
  }
  console.log(`list shown from keep first: ${sawOld ? 'yes' : 'no'}; new name visible after ${sawNewAt ?? 'NEVER'} ms`);
  // Put the name back.
  const restored = await cp.evaluate(async (id, name) => {
    const r = await fetch(`/api/clients/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: name }) });
    return r.status;
  }, target.id, target.name);
  console.log(`name restored -> status ${restored}`);
  await colleague.close();
}

const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] ?? 0;
const pick = (p) => rows.filter((r) => r.name.startsWith(p) && r.landed != null).map((r) => r.landed);
console.log(
  `\nmedian landed: first visit ${med(pick('first')).toFixed(0)} ms, revisit ${med(pick('again')).toFixed(0)} ms, hover+click ${med(pick('hover+click')).toFixed(0)} ms`,
);
await browser.close();
