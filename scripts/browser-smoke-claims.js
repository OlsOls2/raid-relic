// Optional host-only LOCAL HTTPS mocked browser gate. Fixed registered5191.
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
const origin = 'https://localhost:5191', f = await pilotFixture('memory', { origin });
let browser, server, tls, failure; let stage = 'local-startup', failureCategory = null; const checks = [], safeGets = [], pageErrors = [];
try {
  stage = 'local-tls'; tls = await createLocalTLS(); server = createServer(tls.options, (req, res) => { res.setHeader('x-raid-relic-mode', 'simulator'); return f.runtime.handler(req, res); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5191, '127.0.0.1', resolve); });
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) { await f.control(id, 'bootstrap'); f.advance(); await f.control(id, 'keep'); f.advance(); }
  await f.control(HOME, `send:${OTHER}`); f.advance(); await f.raid(HOME, OTHER, 3); f.advance(90000);
  stage = 'browser-launch'; const { chromium } = await import('playwright'); browser = await chromium.launch({ executablePath: '/snap/bin/chromium', chromiumSandbox: true, headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  await context.route('**/*', r => new URL(r.request().url()).origin === origin ? r.continue() : r.abort());
  await context.addCookies(Object.entries(f.cookies).map(([, cookie]) => { const i = cookie.indexOf('='); return { name: cookie.slice(0, i), value: cookie.slice(i + 1), url: origin, secure: true, httpOnly: true, sameSite: 'Lax' }; }));
  stage = 'control-load'; const page = await context.newPage();
  page.on('pageerror', error => { if (pageErrors.length < 4) pageErrors.push(['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'].includes(error.name) ? error.name : 'Error'); });
  page.on('response', response => {
    if (response.request().method() !== 'GET' || safeGets.length >= 12) return;
    const path = new URL(response.url()).pathname;
    const name = path === `/control/${HOME}` ? 'source-control-html' : path === `/control/${HOME}/status` ? 'source-control-status' : path === '/control.js' ? 'control-module' : null;
    if (name) safeGets.push({ name, status: response.status() });
  });
  page.on('dialog', d => d.accept()); await page.goto(`${origin}/control/${HOME}`);
  await page.waitForFunction(() => !document.getElementById('expire-handoff').disabled);
  if (!(await page.locator('body').textContent()).includes('0–2 viewers')) throw Error('Missing truthful threshold policy');
  stage = 'expiry-post'; const refreshed = page.waitForResponse(r => new URL(r.url()).pathname === `/control/${HOME}/status`);
  const done = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/expire-handoff') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Expire ended handoff', exact: true }).click();
  if ((await (await done).json()).status !== 'expired-handoff') throw Error('Recovery failed');
  await refreshed; await page.waitForFunction(() => !document.getElementById('refresh').disabled);
  checks.push({ name: 'SIMULATOR source-only ended confirmed control', passed: true });
  stage = 'post-expiry-send'; f.advance(); const send = await f.control(HOME, `send:${OTHER}`); if (JSON.parse(send.body).status !== 'accepted') throw Error('mock send blocked');
  stage = 'verified-raid'; f.advance(); await f.raid(HOME, OTHER, 2);
  stage = 't1-votes-ack'; await f.chat(HOME, HOME, '!offer'); await f.chat(OTHER, OTHER, '!accept');
  for (const host of [HOME, OTHER]) { const doc = await f.runtime.state.getPrivateClaimAcks(host); if (doc.rows.filter(r => r.status === 'sent').length !== 1) throw Error('mock ACK not sent'); }
  if ((await f.runtime.state.getPublicJourney()).rings !== 1 || f.calls.filter(c => c.url.endsWith('/chat/messages')).length !== 2) throw Error('Mocked T1/ACK failed');
  // #account exists in initial HTML: it cannot prove the async status fetch rendered.
  // Arm status BEFORE navigation, then assert both response and committed DOM.
  const statusReload = page.waitForResponse(r => new URL(r.url()).pathname === `/control/${HOME}/status` && r.request().method() === 'GET');
  stage = 'reload-html'; const html = await page.reload(); if (html?.status() !== 200) throw Error('control html failed');
  stage = 'reload-status'; const response = await statusReload; if (response.status() !== 200) throw Error('control status failed');
  const privateValue = await response.json();
  if (privateValue.pilot?.holder !== OTHER || privateValue.pilot?.intent !== null || privateValue.pilot?.claimProgress?.finalized !== true) throw Error('control status state failed');
  stage = 'reload-dom'; await page.locator('#account').filter({ hasText: 'Keeper control' }).waitFor();
  await page.waitForFunction(other => {
    const fields = Object.fromEntries([...document.querySelectorAll('#ledger dt')].map(dt => [dt.textContent, dt.nextElementSibling?.textContent]));
    try { return JSON.parse(fields.holder) === other && JSON.parse(fields.intent) === null && JSON.parse(fields.claimProgress).finalized === true; } catch { return false; }
  }, OTHER);
  if (pageErrors.length) throw Error('control page error');
  stage = 'simulator-label'; await page.evaluate(() => { const label = document.createElement('p'); label.textContent = 'SIMULATOR · LOCAL MOCK ONLY · NO REAL CHAT/RAID'; document.body.prepend(label); document.title = 'SIMULATOR claims'; });
  // Functional hotfix gate only: no screenshot capture or visual-proof assertion.
  checks.push({ name: 'SIMULATOR T1 two-account claim, two SENT ACKs and postclaim control response/DOM', passed: true });
  stage = 'complete';
} catch (error) { failure = true; failureCategory = ['EPERM', 'EADDRINUSE', 'ENOENT'].includes(error?.code) ? error.code : pageErrors.length ? 'page-error' : error?.name === 'TimeoutError' ? 'timeout' : 'assertion-or-browser'; }
finally {
  await browser?.close().catch(() => {}); if (server?.listening) await new Promise(resolve => server.close(resolve)); await tls?.cleanup();
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/claims-browser-results.json', JSON.stringify({ simulator: true, passed: !failure, stage, failureCategory, safeGets, pageErrors, checks, captures: [], screenshotCapture: false }, null, 2));
}
if (failure) { console.error(JSON.stringify({ stage, failureCategory })); process.exitCode = 1; }
