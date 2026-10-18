// Checks a kept page is corrected: a second session renames a client while
// the manager's list is kept, then the list is revisited (rail, and Back).
// Renames the first client and puts the name back. Needs puppeteer-core:
//   npm i --no-save puppeteer-core && node apps/web/bench/freshness.check.mjs
import puppeteer from 'puppeteer-core';
const BASE = 'http://localhost:3000';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, defaultViewport: { width: 1440, height: 900 } });
async function session(email) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sign-in`, { waitUntil: 'networkidle0' });
  await page.evaluate(async (email) => { await fetch('/api/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) }); }, email);
  return page;
}
const railClick = (page, href) => page.evaluate((href) => [...document.querySelectorAll('nav a[href]')].find((a) => a.getAttribute('href') === href && a.offsetParent !== null).click(), href);
const waitPath = (page, p) => page.waitForFunction((p) => location.pathname === p && document.documentElement.dataset.renderId, {}, p);

for (const scenario of ['kept copy (tab revisit)', 'back button']) {
  const me = await session('manager@consultancy.pk');
  const checks = [];
  me.on('request', (r) => { if (r.url().includes('/api/sync/changes')) checks.push(r.url()); });
  await me.goto(`${BASE}/overview`, { waitUntil: 'networkidle0' });
  await railClick(me, '/overview/clients'); await waitPath(me, '/overview/clients');
  await new Promise((r) => setTimeout(r, 300));
  const target = await me.evaluate(async () => { const { items } = await (await fetch('/api/clients?pageSize=1')).json(); return { id: items[0].id, name: items[0].fullName }; });
  const onPage = await me.evaluate((n) => document.body.innerText.includes(n), target.name);
  await railClick(me, '/overview/stuck'); await waitPath(me, '/overview/stuck');
  await new Promise((r) => setTimeout(r, 1500));

  const colleague = await session('ayesha@consultancy.pk');
  const marked = `${target.name} (edited)`;
  // Through the manager's own API session in another browser: a different tab/device.
  const other = await session('manager@consultancy.pk');
  const status = await other.evaluate(async (id, name) => (await fetch(`/api/clients/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: name }) })).status, target.id, marked);

  checks.length = 0;
  const t0 = Date.now();
  if (scenario.startsWith('back')) await me.goBack(); else await railClick(me, '/overview/clients');
  let firstShown = null, oldVisible = false, newAt = null;
  while (Date.now() - t0 < 5000) {
    const s = await me.evaluate((o, n) => ({ path: location.pathname, old: document.body.innerText.includes(o) && !document.body.innerText.includes(n), neu: document.body.innerText.includes(n) }), target.name, marked);
    if (s.path === '/overview/clients' && firstShown === null) firstShown = Date.now() - t0;
    if (s.path === '/overview/clients' && s.old) oldVisible = true;
    if (s.path === '/overview/clients' && s.neu) { newAt = Date.now() - t0; break; }
    await new Promise((r) => setTimeout(r, 10));
  }
  console.log(`${scenario}: target "${target.name}" on page: ${onPage}; rename status ${status}; list shown after ${firstShown} ms (old name first: ${oldVisible}); change visible after ${newAt ?? 'NEVER'} ms; checks ${checks.length}`);
  await other.evaluate(async (id, name) => fetch(`/api/clients/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fullName: name }) }), target.id, target.name);
  for (const p of [me, colleague, other]) await p.browserContext().close();
}
await browser.close();
