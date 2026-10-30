// LOCAL live-mode presentation over memory/mocked Twitch. Every capture is labelled.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
const origin = 'https://localhost:5191';
let browser,
  tls,
  server,
  sockets,
  stage = 'startup',
  failed = false;
const checks = [],
  captures = new Map(),
  errors = [],
  diagnostic = {};
async function capture(page, name) {
  if (process.env.P4_CAPTURE !== '1') return;
  const b = await page.screenshot({ fullPage: false });
  if (b.length <= 524288) captures.set(name, b);
}
try {
  const f = await pilotFixture('memory', { origin, simulator: false });
  tls = await createLocalTLS();
  server = createServer(tls.options, f.runtime.handler);
  sockets = attachOverlaySockets(server, f.runtime.overlayFeeds, {
    origins: [origin],
    allowRead: f.runtime.allowPublicRead,
  });
  await new Promise((r, j) => {
    server.once('error', j);
    server.listen(5191, '127.0.0.1', r);
  });
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  const { chromium } = await import('playwright');
  browser = await chromium.launch({
    executablePath: '/snap/bin/chromium',
    chromiumSandbox: true,
    headless: true,
  });
  async function context(options = {}) {
    const c = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
      ...options,
    });
    await c.route('**/*', (r) =>
      new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
    );
    await c.routeWebSocket('**/*', (r) =>
      new URL(r.url()).origin === origin.replace('https:', 'wss:')
        ? r.connectToServer()
        : r.close(),
    );
    await c.addInitScript(() => {
      addEventListener(
        'DOMContentLoaded',
        () => {
          const p = document.createElement('p');
          p.textContent = 'SIMULATOR · LOCAL MOCK ONLY · live-mode UI, not live Twitch';
          p.setAttribute('data-fixture-label', '');
          p.style.cssText =
            'position:fixed;left:2px;top:0;margin:0;font:9px system-ui;max-width:95vw;z-index:30;color:#ffe3a6;background:#101d30';
          document.body.prepend(p);
          document.title = 'SIMULATOR · ' + document.title;
        },
        { once: true },
      );
    });
    await c.addCookies(
      Object.values(f.cookies).map((cookie) => {
        const i = cookie.indexOf('=');
        return {
          name: cookie.slice(0, i),
          value: cookie.slice(i + 1),
          url: origin,
          secure: true,
          httpOnly: true,
          sameSite: 'Lax',
        };
      }),
    );
    c.on('page', (p) =>
      p.on('pageerror', (e) => {
        if (errors.length < 4)
          errors.push(
            ['TypeError', 'ReferenceError', 'SyntaxError'].includes(e.name) ? e.name : 'Error',
          );
      }),
    );
    return c;
  }
  const c = await context(),
    control = await c.newPage();
  let delayed = true;
  await control.route(`**/control/${HOME}/status`, async (r) => {
    if (!delayed) return r.continue();
    delayed = false;
    await new Promise((resolve) => setTimeout(resolve, 9000));
    try {
      await r.fulfill({ status: 200, json: {} });
    } catch {}
  });
  stage = 'bounded-read';
  await control.goto(`${origin}/control/${HOME}`);
  await control.locator('#result').filter({ hasText: 'Status timed out' }).waitFor();
  assert.equal(await control.locator('#raid button').count(), 0);
  const freshRead = control.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/control/${HOME}/status` && r.request().method() === 'GET',
  );
  await control.getByRole('button', { name: 'Refresh status', exact: true }).click();
  assert.equal((await freshRead).status(), 200);
  await control.waitForFunction(
    () =>
      !document.getElementById('refresh').disabled &&
      document.getElementById('light-live').dataset.state === 'ready',
  );
  // A successful read preserves the last result; real lights/read completion
  // prove recovery instead of expecting an unrelated replacement message.
  assert.equal(await control.locator('#result').isVisible(), true);
  for (const selector of ['#result', '#first-run p', '#first-run button', '#first-run summary h2'])
    assert.ok(
      await control
        .locator(selector)
        .evaluateAll((nodes) => nodes.every((n) => parseFloat(getComputedStyle(n).fontSize) >= 15)),
    );
  for (const key of ['bot', 'subscriptions', 'live'])
    assert.equal(await control.locator(`#light-${key}`).getAttribute('data-state'), 'ready');
  assert.equal(await control.locator('#ledger').isVisible(), false);
  assert.equal((await control.locator('#ledger').textContent()).trim(), '');
  await control.evaluate(async () => {
    await document.fonts.load('400 20px Cinzel');
    await document.fonts.ready;
  });
  assert(
    await control.evaluate(() =>
      [...document.fonts].some((f) => f.family === 'Cinzel' && f.status === 'loaded'),
    ),
  );
  assert(
    (await control.locator('h1').evaluate((n) => getComputedStyle(n).fontFamily)).includes(
      'Cinzel',
    ),
  );
  stage = 'ready-top-layout';
  await control.evaluate(() => scrollTo(0, 0));
  assert(
    await control.locator('.status-lights').evaluate((n) => {
      const r = n.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    }),
  );
  // Four-step layout: the actual step link opens and scrolls the Send Off panel.
  await control.getByRole('link', { name: 'Send Off', exact: true }).click();
  await control.locator('#raid .send-off').scrollIntoViewIfNeeded();
  assert(
    await control.locator('#raid .send-off').evaluate((n) => {
      const r = n.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    }),
  );
  assert.equal(await control.locator('#send-step').evaluate((n) => n.open), true);
  assert.equal(
    await control.locator('#raid .send-off').getAttribute('aria-describedby'),
    'send-disabled-reason target-help',
  );
  await capture(control, 'p4-polish-control.png');
  stage = 'human-raid-settings';
  let posts = 0;
  await control.route(`**/control/${HOME}`, async (r) => {
    if (r.request().method() !== 'POST') return r.continue();
    const b = r.request().postDataJSON();
    assert.equal(b.action, `send:${OTHER}`);
    assert.deepEqual(Object.keys(b).sort(), ['action', 'csrf']);
    posts++;
    await r.fulfill({
      status: 200,
      json: {
        status: 'blocked',
        reason: 'dispatch-rejected',
        diagnostic: { category: 'incoming-raid-policy', message: 'not displayed' },
      },
    });
  });
  control.on('dialog', (d) => d.accept());
  await control.getByRole('button', { name: 'Send Off to olsols2', exact: true }).click();
  await control
    .locator('#result')
    .filter({ hasText: 'olsols2 raid settings block this raider' })
    .waitFor();
  assert.equal(posts, 1);
  assert(!(await control.locator('main').innerText()).includes('not displayed'));
  checks.push({
    name: 'SIMULATOR live-mode cached lights, bounded retry, native font and closed human settings guidance',
    passed: true,
  });
  stage = 'actual-mock-transfer';
  await f.control(HOME, `send:${OTHER}`);
  f.advance();
  await f.raid(HOME, OTHER, 2);
  await f.chat(HOME, HOME, '!offer');
  await f.chat(OTHER, OTHER, '!accept');
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
  const source = await c.newPage();
  // Legacy full-composition contract; default-card coverage remains in full-overlay.
  await source.goto(`${origin}/overlay/${HOME}?layout=full`);
  await source.bringToFront();
  await source
    .locator('#status')
    .filter({ hasText: 'The relic has moved on to @olsols2' })
    .waitFor();
  assert.equal(await source.locator('.ring-pips span').count(), 1);
  assert((await source.locator('#lineage').textContent()) === 'Ring 1');
  const visible = await source.locator('main').innerText();
  assert(!/app-local|provisional|0\/160|completed growth rings/i.test(visible));
  await source.evaluate(async () => {
    await document.fonts.load('400 20px Cinzel');
  });
  await capture(source, 'p4-polish-overlay.png');
  stage = 'rolling-session';
  const before = await f.request(`/control/${HOME}/status`, 'GET', { cookie: f.cookies[HOME] });
  f.advance(6 * 3600000);
  const after = await f.request(`/control/${HOME}/status`, 'GET', { cookie: f.cookies[HOME] });
  assert.equal(after.status, 200);
  assert.equal(JSON.parse(after.body).expiresAt, JSON.parse(before.body).expiresAt);
  assert.equal(after.headers['set-cookie'], undefined);
  const explicitRenewal = await f.control(HOME, 'refresh-authorization');
  assert.equal(explicitRenewal.status, 200);
  assert.match(explicitRenewal.headers['set-cookie'], /Max-Age=43200/);
  await control.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await control.locator('#keeper-summary').filter({ hasText: '@olsols2' }).waitFor();
  await control.setViewportSize({ width: 375, height: 800 });
  assert(await control.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const small = await context({ viewport: { width: 160, height: 160 }, reducedMotion: 'reduce' });
  const corner = await small.newPage();
  await corner.goto(`${origin}/overlay/${OTHER}?corner=1`);
  await corner.bringToFront();
  await corner.locator('#compact-count').filter({ hasText: 'Ring 1' }).waitFor();
  // Keep the local fixture label accessible without changing the 160px layout.
  await corner.locator('[data-fixture-label]').evaluate((p) => {
    p.style.cssText = 'position:fixed;left:2px;top:0;margin:0;font:8px system-ui;z-index:20';
    p.textContent = 'SIMULATOR · LOCAL';
  });
  assert.equal(await corner.locator('.ring-pips span').count(), 1);
  assert(
    await corner.evaluate(
      () =>
        document.documentElement.scrollWidth <= 160 && document.documentElement.scrollHeight <= 160,
    ),
  );
  assert(await corner.locator('.crystal').isVisible());
  await capture(corner, 'p4-polish-corner.png');
  stage = 'font-failure-fallback';
  const fallback = await context({ reducedMotion: 'reduce' });
  await fallback.route('**/fonts/Cinzel.ttf', (r) => r.abort());
  const fallbackPage = await fallback.newPage();
  await fallbackPage.goto(`${origin}/overlay/${OTHER}`);
  await fallbackPage.locator('#lineage').filter({ hasText: 'Ring 1' }).waitFor();
  assert(await fallbackPage.locator('.crystal').isVisible());
  assert.equal(errors.length, 0);
  checks.push({
    name: 'SIMULATOR actual transfer/moved-on voice, explicit-action twelve-hour renewal with read-only GET, 375px/160px pips and font/SVG fallback',
    passed: true,
  });
} catch (error) {
  failed = true;
  diagnostic.assertionLine = Number(
    /browser-smoke-p4[.]js:(\d+)/.exec(error?.stack ?? '')?.[1] ?? 0,
  );
  diagnostic.failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(error?.name)
    ? error.name
    : 'fixture-or-browser';
} finally {
  await browser?.close().catch(() => {});
  sockets?.close();
  server?.closeAllConnections();
  if (server?.listening) await new Promise((r) => server.close(r));
  await tls?.cleanup();
  await mkdir('artifacts', { recursive: true });
  for (const [name, b] of captures) await writeFile(`artifacts/${name}`, b);
  await writeFile(
    'artifacts/p4-browser-results.json',
    JSON.stringify(
      {
        simulator: true,
        passed: !failed,
        stage,
        diagnostic,
        pageErrors: errors,
        checks,
        captures: [...captures.keys()],
      },
      null,
      2,
    ),
  );
}
if (failed) process.exitCode = 1;
