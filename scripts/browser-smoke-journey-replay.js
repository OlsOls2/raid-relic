// LOCAL HTTPS, real completed mock kernel hops, no Twitch/cloud/credential access.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
import { pngRGBA } from '../test-support/png-rgba.js';
const origin = 'https://localhost:5191';
let server,
  tls,
  browser,
  page,
  active,
  stage = 'setup',
  failed = false;
const checks = [],
  captures = [],
  images = new Map(),
  pageErrors = [];
let mapReads = 0;
async function capture(name) {
  if (process.env.P6_CAPTURE !== '1') return;
  await page.waitForFunction(
    () =>
      Math.abs(
        Number(document.querySelector('#map-svg').getAttribute('viewBox').split(' ')[2]) -
          document.querySelector('#map-svg').getBoundingClientRect().width,
      ) < 2,
  );
  await page.locator('#journey-map').evaluate((n) => {
    n.scrollIntoView({ block: 'start' });
    scrollBy(0, -40);
  });
  const bytes = await page.screenshot({
    fullPage: false,
    omitBackground: name === 'journey-embed.png',
  });
  assert.ok(bytes.length <= 512 * 1024);
  images.set(name, bytes);
}
async function hop(i) {
  const from = i % 2 ? OTHER : HOME,
    to = i % 2 ? HOME : OTHER;
  assert.equal((await active.control(from, `send:${to}`)).status, 200);
  active.advance();
  await active.raid(from, to, 1);
  await active.chat(from, '811', '!offer');
  await active.chat(to, '812', '!accept');
  active.advance(1000);
}
async function scrub(v) {
  await page.locator('#map-range').evaluate((n, v) => {
    n.value = String(v);
    n.dispatchEvent(new Event('input', { bubbles: true }));
  }, v);
}
try {
  active = await pilotFixture('firestore', { origin });
  for (const id of [BOT, HOME, OTHER]) await active.login(id);
  for (const id of [HOME, OTHER]) {
    await active.control(id, 'bootstrap');
    active.advance();
    await active.control(id, 'keep');
    active.advance();
  }
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
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  await context.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== origin) return r.abort();
    if (u.pathname === '/api/journey-map') mapReads++;
    return r.continue();
  });
  await context.routeWebSocket('**/*', (r) => r.close());
  await context.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const n = document.getElementById('map-simulator') ?? document.createElement('aside');
      n.id = 'map-simulator';
      n.textContent = 'SIMULATOR · local recorded journey';
      n.style.cssText =
        'position:fixed;top:10px;left:12px;z-index:100;color:#101d30;background:#e6bb70;padding:4px';
      document.body.prepend(n);
      document.title = 'SIMULATOR · Journey replay';
    });
  });
  page = await context.newPage();
  page.on('pageerror', (e) =>
    pageErrors.push(
      ['TypeError', 'SyntaxError', 'ReferenceError'].includes(e.name) ? e.name : 'other',
    ),
  );
  stage = 'empty';
  await page.goto(origin + '/atlas/');
  await page.locator('#map-status').filter({ hasText: 'No completed journeys yet' }).waitFor();
  assert.equal(await page.locator('.map-hop').count(), 0);
  assert.equal(await page.locator('#map-play').isDisabled(), true);
  for (let i = 0; i < 5; i++) await hop(i);
  await page.locator('#map-refresh').click();
  await page.waitForFunction(() => document.querySelectorAll('.map-hop').length === 5);
  assert.equal(await page.locator('#map-stops>li').count(), 5);
  const before = mapReads;
  stage = 'curves';
  for (const base of [0, 1]) {
    const positions = [];
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      await scrub(base + t);
      positions.push(
        await page.locator('.map-comet').evaluate((n) => {
          let opacity = 1;
          for (let p = n; p instanceof Element; p = p.parentElement)
            opacity *= Number(getComputedStyle(p).opacity);
          const b = n.getBoundingClientRect();
          return { x: Number(n.dataset.x), y: Number(n.dataset.y), opacity, width: b.width };
        }),
      );
    }
    assert.equal(new Set(positions.map((p) => `${p.x},${p.y}`)).size, 5);
    assert.ok(positions.every((p) => p.opacity > 0.8 && p.width > 0));
  }
  await scrub(3);
  assert.equal(await page.locator('.map-growth-band').count(), 3);
  await page.locator('#map-range').focus();
  await page.keyboard.press('End');
  assert.equal(await page.locator('.map-growth-band').count(), 5);
  await page.keyboard.press('Home');
  assert.equal(await page.locator('.map-growth-band').count(), 0);
  assert.equal(mapReads, before);
  await scrub(2.5);
  await capture('journey-map-desktop.png');
  await page.setViewportSize({ width: 393, height: 800 });
  await capture('journey-map-mobile.png');
  for (const width of [375, 393, 480]) {
    await page.setViewportSize({ width, height: 800 });
    await page.locator('#map-svg').scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () =>
        Math.abs(
          Number(document.querySelector('#map-svg').getAttribute('viewBox').split(' ')[2]) -
            document.querySelector('#map-svg').getBoundingClientRect().width,
        ) < 2,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
    );
    const readable = await page.locator('#map-svg').evaluate((svg) => {
      const labels = [...svg.querySelectorAll('.map-node-label')].map((n) => {
        const r = n.getBoundingClientRect(),
          m = n.getScreenCTM();
        return {
          height: r.height,
          font: Number.parseFloat(getComputedStyle(n).fontSize) * Math.hypot(m.a, m.b),
          inside: r.left >= 0 && r.right <= innerWidth,
        };
      });
      const mini = svg.querySelector('.map-mini image').getBoundingClientRect(),
        head = svg.querySelector('.map-comet circle').getBoundingClientRect(),
        box = svg.getBoundingClientRect(),
        nodes = [...svg.querySelectorAll('.map-node')].map((n) => n.getBoundingClientRect());
      const top = document.elementFromPoint(head.x + head.width / 2, head.y + head.height / 2);
      return {
        labels,
        mini: mini.width,
        head: head.width,
        uncovered: !!top?.closest('.map-comet'),
        span: Math.abs(nodes[1].x - nodes[0].x) / box.width,
      };
    });
    assert.ok(readable.labels.every((n) => n.height >= 14 && n.font >= 14 && n.inside));
    assert.ok(
      readable.mini >= 28 && readable.head >= 8 && readable.uncovered && readable.span >= 0.59,
    );
  }
  checks.push({
    name: 'SIMULATOR zero/five real kernel hops, visible curve positions, ring growth, keyboard and mobile bounds',
    passed: true,
  });
  stage = 'playback';
  await page.locator('#map-restart').click();
  await page.locator('#map-play').click();
  await page.waitForFunction(() => Number(document.querySelector('#map-range').value) > 0.05);
  await page.locator('#map-play').click();
  const paused = await page.locator('#map-range').inputValue();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#map-range').inputValue(), paused);
  // Injected browser visibility: explicitly not physical OS-tab visibility proof.
  await page.locator('#map-play').click();
  await page.waitForFunction(
    () => document.querySelector('#journey-map').dataset.playing === 'true',
  );
  await page.evaluate(() => {
    window.__p6Hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  assert.equal(await page.locator('#journey-map').getAttribute('data-playing'), 'false');
  await page.evaluate(() => {
    if (window.__p6Hidden) Object.defineProperty(document, 'hidden', window.__p6Hidden);
    else delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#map-play').click();
  assert.equal(await page.locator('#journey-map').getAttribute('data-playing'), 'false');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const map = JSON.parse((await active.request('/api/journey-map')).body),
    t = map.hops[1].stopId;
  await page.goto(origin + '/atlas/?t=' + t);
  await page.waitForFunction(() => document.querySelector('#journey-map').dataset.rings === '2');
  await page.locator('#map-stops .map-stop-select').nth(3).click();
  assert.ok(page.url().includes(map.hops[3].stopId));
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('#journey-map').dataset.rings === '2');
  await page.goto(origin + '/atlas/?t=' + 'f'.repeat(64));
  await page.locator('#map-status').filter({ hasText: 'Stop not available' }).waitFor();
  await page.route('**/api/journey-map', (r) => r.fulfill({ status: 503, body: 'Unavailable' }));
  await page.locator('#map-refresh').click();
  await page.locator('#map-status').filter({ hasText: 'Previous route cleared' }).waitFor();
  assert.equal(await page.locator('.map-hop').count(), 0);
  await page.unroute('**/api/journey-map');
  let releaseMap;
  const heldMap = new Promise((r) => {
    releaseMap = r;
  });
  await page.route('**/api/journey-map', async (r) => {
    await heldMap;
    await r.continue();
  });
  await page.locator('#map-refresh').click();
  await page.waitForFunction(
    () => document.querySelector('#journey-map').getAttribute('aria-busy') === 'true',
  );
  assert.equal(await page.locator('.map-hop').count(), 0);
  releaseMap();
  await page.waitForFunction(() => !document.querySelector('#map-refresh').disabled);
  await page.unroute('**/api/journey-map');
  checks.push({
    name: 'SIMULATOR pause/injected visibility/reduced motion, deep links/back, invalid stop and failure clears route',
    passed: true,
  });
  stage = 'sixteen';
  for (let i = 5; i < 16; i++) await hop(i);
  await page.goto(origin + '/atlas/embed');
  await page.waitForFunction(() => document.querySelectorAll('.map-hop').length === 16);
  await scrub(16);
  assert.equal(await page.locator('.map-growth-band').count(), 16);
  await page.setViewportSize({ width: 1000, height: 700 });
  await scrub(2.5);
  const bytes = await page.screenshot({ fullPage: false, omitBackground: true });
  const png = pngRGBA(bytes);
  for (const [x, y] of [
    [0, 0],
    [999, 0],
    [0, 699],
    [999, 699],
  ])
    assert.equal(png.pixel(x, y)[3], 0);
  let drawn = 0;
  for (let y = 0; y < 700; y += 4)
    for (let x = 0; x < 1000; x += 4) if (png.pixel(x, y)[3] > 0) drawn++;
  assert.ok(drawn > 100);
  await capture('journey-embed.png');
  assert.equal(await page.locator('#keeper-scores,#mark-search').count(), 0);
  assert.equal(pageErrors.length, 0);
  checks.push({
    name: 'SIMULATOR sixteen actual transfers, transparent embed actual PNG alpha/nonblank drawing and no private ledger',
    passed: true,
  });
} catch {
  failed = true;
} finally {
  try {
    await mkdir('artifacts', { recursive: true });
    for (const [name, bytes] of images) {
      await writeFile(`artifacts/${name}`, bytes);
      captures.push(name);
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
    'artifacts/journey-replay-browser-results.json',
    JSON.stringify(
      {
        simulator: true,
        passed: !failed,
        stage,
        failureCategory: failed ? 'assertion-or-browser' : null,
        pageErrors,
        checks,
        captures,
      },
      null,
      2,
    ),
  );
}
if (failed) process.exitCode = 1;
