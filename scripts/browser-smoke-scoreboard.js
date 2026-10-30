// LOCAL mock-only P5 gate. Fixed registered5191; all provider calls injected.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
import { EVENT_DAYS } from '../src/scoreboard.js';
const origin = 'https://localhost:5191';
let browser,
  server,
  tls,
  active,
  stage = 'setup',
  failed = false,
  failureCategory = null,
  diagnostic = {};
const checks = [],
  captures = [],
  captureBytes = new Map();
let page;
async function capture(name) {
  if (process.env.P5_CAPTURE !== '1') return;
  await page.locator('#keeper-scores').evaluate((n) => {
    n.scrollIntoView({ block: 'start' });
    window.scrollBy(0, -28);
  });
  await page.locator('#p5-simulator-label').waitFor();
  await mkdir('artifacts', { recursive: true });
  const bytes = await page.screenshot({ fullPage: false });
  assert.ok(bytes.length <= 512 * 1024);
  captureBytes.set(name, bytes);
}
async function prepared(at) {
  const f = await pilotFixture('firestore', { origin });
  if (at) f.advance(at - f.now());
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  return f;
}
async function hop(f) {
  await f.control(HOME, `send:${OTHER}`);
  f.advance();
  await f.raid(HOME, OTHER, 1);
  await f.chat(HOME, '811', '!offer');
  await f.chat(OTHER, '812', '!accept');
}
try {
  active = await prepared();
  await active.chat(HOME, '811', '!relic scores on');
  await active.chat(OTHER, '812', '!relic scores on');
  tls = await createLocalTLS();
  server = createServer(tls.options, (req, res) => {
    res.setHeader('x-raid-relic-mode', 'simulator');
    active.runtime.handler(req, res);
  });
  await new Promise((r, j) => {
    server.once('error', j);
    server.listen(5191, '127.0.0.1', r);
  });
  const { chromium } = await import('playwright');
  browser = await chromium.launch({
    executablePath: '/snap/bin/chromium',
    chromiumSandbox: true,
    headless: true,
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    hasTouch: true,
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  await context.route('**/*', (r) =>
    new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
  );
  await context.routeWebSocket('**/*', (r) => r.close());
  await context.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const label = document.createElement('aside');
      label.id = 'p5-simulator-label';
      label.textContent = 'SIMULATOR · LOCAL MOCK P5 ONLY';
      label.style.cssText =
        'position:fixed;top:0;left:0;right:0;z-index:100;background:#101d30;color:#ffe3a6';
      document.body.prepend(label);
      document.title = 'SIMULATOR P5';
    });
  });
  page = await context.newPage();
  stage = 'empty-coverage';
  await page.goto(origin + '/atlas/');
  await page.locator('#scores-status').filter({ hasText: 'First journey begins' }).waitFor();
  assert.equal((await active.runtime.state.getPublicJourney()).rings, 0);
  const emptyScores = await page.evaluate(async () => {
    const response = await fetch('/api/scores', { cache: 'no-store' });
    if (!response.ok) throw Error('Local score read failed');
    const value = await response.json();
    return { rings: value.rings, joined: value.raiders.map((row) => row.claimsJoined) };
  });
  // Both signed opt-ins exist already; neither has earned a claim yet.
  assert.deepEqual(emptyScores, { rings: 0, joined: [0, 0] });
  assert.match(await page.locator('#scores-coverage').textContent(), /unknown|not available/);
  assert(await page.locator('#simulator').isVisible());
  stage = 'completed-score';
  await hop(active);
  await page.locator('#scores-refresh').click();
  stage = 'completed-ring';
  await page.locator('#scores-status').filter({ hasText: '1 recorded ring' }).waitFor();
  assert.match(await page.locator('#raider-rows').textContent(), /1 completed claim joined/);
  assert.match(await page.locator('#keeper-rows').textContent(), /Ring 1/);
  active.advance(86400000);
  await page.locator('#scores-refresh').click();
  stage = 'completed-24h-badge';
  await page.locator('#keeper-rows').filter({ hasText: '24h Keeper' }).waitFor();
  assert.equal(
    await page
      .locator('.score-badge[data-earned=true][data-badge="Event-days badge · 13–15 Nov"]')
      .count(),
    0,
  );
  stage = 'badge-keyboard';
  await page.locator('.score-badge[data-earned=true] summary').first().focus();
  await page.keyboard.press('Enter');
  assert(await page.locator('.score-badge[data-earned=true][open] p').first().isVisible());
  await page.keyboard.press('Enter');
  stage = 'desktop-spotlight-ledger-layout';
  await page.evaluate(() => scrollTo(0, 0));
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const layout = await page.locator('#keeper-scores').evaluate((n) => ({
    top: n.getBoundingClientRect().top,
    width: n.getBoundingClientRect().width,
    heroEnd: document.querySelector('.intro').getBoundingClientRect().bottom,
    spotlightTop: document.querySelector('#receiving').getBoundingClientRect().top,
    spotlightBottom: document.querySelector('#receiving').getBoundingClientRect().bottom,
    spotlightWidth: document.querySelector('#receiving').getBoundingClientRect().width,
  }));
  diagnostic = { ...layout };
  assert.ok(layout.spotlightTop >= layout.heroEnd - 1);
  assert.ok(layout.top >= layout.spotlightBottom - 1);
  assert.ok(layout.width > 900 && layout.spotlightWidth > 900);
  stage = 'desktop-ledger-accessible-scroll';
  await page.locator('#scores-refresh').scrollIntoViewIfNeeded();
  await page.locator('#scores-refresh').focus();
  assert.ok(
    await page.locator('#scores-refresh').evaluate((n) => {
      const r = n.getBoundingClientRect();
      return n === document.activeElement && r.top >= 0 && r.bottom <= innerHeight;
    }),
  );
  assert.equal(await page.locator('#score-preview').isVisible(), false);
  await capture('scoreboard-desktop.png');
  await page.setViewportSize({ width: 393, height: 800 });
  await page.waitForFunction(() => !document.querySelector('#ledger-details').open);
  await page.locator('#ledger-details > summary').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#ledger-details').evaluate((n) => n.open), true);
  await page.locator('#scores-refresh').focus();
  assert.equal(
    await page.locator('#scores-refresh').evaluate((n) => n === document.activeElement),
    true,
  );
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const lock = page.locator('.score-badge[data-earned=false] summary').first();
  await lock.tap();
  assert(await page.locator('.score-badge[data-earned=false][open] p').first().isVisible());
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await lock.tap();
  await capture('scoreboard-mobile.png');
  for (const width of [375, 393]) {
    await page.setViewportSize({ width, height: 800 });
    await page.locator('#scores-coverage').evaluate((n) => {
      n.textContent =
        'Recorded journeys only; the first hold and past raiders are unknown. '.repeat(8);
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
  }
  await page.setViewportSize({ width: 375, height: 800 });
  checks.push({
    name: 'SIMULATOR completed-only scores, known24h badge, desktop/mobile bounds and keyboard refresh',
    passed: true,
  });
  stage = 'erase';
  await active.chat(HOME, '811', '!relic forgetme');
  await page.locator('#scores-refresh').click();
  await page.waitForFunction(() => !document.querySelector('#scores-refresh').disabled);
  assert.equal((await page.locator('#raider-rows').textContent()).includes('@viewer811'), false);
  await active.chat(OTHER, '812', '!relic top');
  active.advance(30001);
  await active.chat(OTHER, '812', '!relic badges');
  const posts = active.calls
    .filter((c) => c.url.endsWith('/chat/messages'))
    .map((c) => JSON.parse(c.body).message);
  assert.ok(posts.some((m) => m.startsWith('Recorded Keepers:')));
  assert.ok(posts.some((m) => m.startsWith('Keeper badges:')));
  assert.ok(posts.every((m) => [...m].length <= 500));
  checks.push({
    name: 'SIMULATOR fresh erasure without reload and exact mock top/badges bot replies',
    passed: true,
  });
  stage = 'quiet-refresh';
  let release;
  const held = new Promise((r) => {
    release = r;
  });
  await page.route('**/api/scores', async (route) => {
    await held;
    await route.continue();
  });
  const refresh = page.locator('#scores-refresh').click();
  await refresh;
  await page.waitForFunction(
    () => document.querySelector('#keeper-scores').getAttribute('aria-busy') === 'true',
  );
  assert.equal(await page.locator('#keeper-rows>li,#raider-rows>li').count(), 0);
  assert.equal(await page.locator('#scores-status').textContent(), '');
  release();
  await page.waitForFunction(() => !document.querySelector('#scores-refresh').disabled);
  await page.unroute('**/api/scores');
  await page.route('**/api/scores', (r) => r.fulfill({ status: 503, body: 'Unavailable' }));
  await page.locator('#scores-refresh').click();
  await page
    .locator('#scores-status')
    .filter({ hasText: 'Previous names and counts hidden' })
    .waitFor();
  assert.equal(await page.locator('#keeper-rows>li,#raider-rows>li').count(), 0);
  await page.unroute('**/api/scores');
  stage = 'official-event';
  active = await prepared(EVENT_DAYS.startsAt);
  await hop(active);
  await page.locator('#scores-refresh').click();
  await page
    .locator('.score-badge[data-earned=true][data-badge="Event-days badge · 13–15 Nov"]')
    .first()
    .waitFor();
  checks.push({
    name: 'SIMULATOR fake-clock November event-days badge, not an October/live claim',
    passed: true,
  });
  stage = 'preview-read-only';
  active = await pilotFixture('firestore', {
    origin,
    chronicleEnv: { P5_PREVIEW_READ_ONLY: 'true' },
  });
  await page.goto(origin + '/atlas/');
  // At 375px the intended ledger disclosure is closed. Use its native control;
  // read-only admission and mutation denials remain assertions below.
  if (!(await page.locator('#ledger-details').evaluate((n) => n.open)))
    await page.locator('#ledger-details > summary').click();
  assert.equal(await page.locator('#ledger-details').evaluate((n) => n.open), true);
  await page.locator('#score-preview').filter({ hasText: 'Read-only preview' }).waitFor();
  assert.equal(await page.locator('#score-preview').count(), 1);
  assert.equal(await page.locator('body>aside:not(#p5-simulator-label)').count(), 0);
  await capture('scoreboard-preview.png');
  const denied = await page.evaluate(async () => {
    const paths = [
      '/eventsub',
      '/api/forge',
      '/api/atlas/search',
      '/api/my-marks',
      '/control/1591805230',
      '/oauth/bot/start',
      '/auth/callback',
    ];
    const codes = [];
    for (const path of paths)
      codes.push(
        (
          await fetch(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
        ).status,
      );
    codes.push((await fetch('/control/1591805230/status')).status);
    codes.push((await fetch('/oauth/keeper/1591806023/start')).status);
    return codes;
  });
  assert.ok(denied.every((n) => n === 403));
  assert.equal(active.calls.length, 0);
  assert.equal(active.db.writes.length, 0);
  checks.push({
    name: 'SIMULATOR actual HTTPS preview denies OAuth/control/EventSub/all mutations before provider or storage writes',
    passed: true,
  });
} catch (error) {
  failed = true;
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(error?.name)
    ? error.name
    : 'browser-or-fixture';
  const line =
    typeof error?.stack === 'string'
      ? error.stack.slice(0, 8192).match(/browser-smoke-scoreboard[.]js:(\d{1,6})(?::\d+)?/)
      : null;
  if (line && Number(line[1]) > 0 && Number(line[1]) <= 100000)
    diagnostic.assertionLine = Number(line[1]);
  if (page && !page.isClosed()) {
    try {
      const values = await page.evaluate(() => ({
        viewportWidth: innerWidth,
        documentHeight: document.documentElement.scrollHeight,
        keeperRows: document.querySelectorAll('#keeper-rows>li').length,
        earnedBadges: document.querySelectorAll('.score-badge[data-earned=true]').length,
        ledgerTop: document.querySelector('#keeper-scores')?.getBoundingClientRect().top ?? -1,
        spotlightTop: document.querySelector('#receiving')?.getBoundingClientRect().top ?? -1,
        spotlightBottom: document.querySelector('#receiving')?.getBoundingClientRect().bottom ?? -1,
      }));
      for (const [key, value] of Object.entries(values))
        if (Number.isFinite(value) && Math.abs(value) <= 1000000000) diagnostic[key] = value;
    } catch {
      /* No raw exceptions or page content in metadata. */
    }
  }
} finally {
  try {
    if (captureBytes.size) {
      await mkdir('artifacts', { recursive: true });
      for (const [name, bytes] of captureBytes) {
        await writeFile(`artifacts/${name}`, bytes);
        captures.push(name);
      }
    }
  } catch {
    failed = true;
  }
  await browser?.close().catch(() => {});
  server?.closeAllConnections();
  if (server?.listening) await new Promise((r) => server.close(r));
  await tls?.cleanup();
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/scoreboard-browser-results.json',
    JSON.stringify(
      { simulator: true, passed: !failed, stage, failureCategory, diagnostic, checks, captures },
      null,
      2,
    ),
  );
}
if (failed) process.exitCode = 1;
