// LOCAL HTTPS, memory/mock transports only. No production URLs are opened.
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
const origin = 'https://localhost:5191', f = await pilotFixture('memory', { origin });
let browser, server, tls, sockets, failure, stage = 'startup'; const checks = [];
try {
  tls = await createLocalTLS(); server = createServer(tls.options, f.runtime.handler);
  sockets = attachOverlaySockets(server, f.runtime.overlayFeeds, { origins: [origin], allowRead: f.runtime.allowPublicRead });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5191, '127.0.0.1', resolve); });
  const { chromium } = await import('playwright'); browser = await chromium.launch({ executablePath: '/snap/bin/chromium', chromiumSandbox: true, headless: true });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  // BASE pre-edition SVG contract. Active edition/decode/context-loss/mobile/corner
  // coverage lives in browser-smoke-editions.js; fixture/server receipt clocks stay unchanged.
  await context.addInitScript(() => {
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) { super(...(args.length ? args : ['2026-10-22T12:00:00Z'])); }
      static now() { return NativeDate.parse('2026-10-22T12:00:00Z'); }
    };
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /^webgl/.test(type) ? null : original.call(this, type, ...args); };
  });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', route => new URL(route.url()).origin === origin.replace('https:', 'wss:') ? route.connectToServer() : route.close());
  async function overlay(id, label) {
    stage = label; const page = await context.newPage();
    try {
      await page.goto(`${origin}/overlay/${id}`); await page.locator('#simulator').waitFor({ state: 'visible' });
      await page.waitForFunction(() => document.querySelector('.crystal')?.complete && document.querySelector('.crystal')?.naturalWidth > 0);
      const proof = await page.evaluate(() => {
        const img = document.querySelector('.crystal'), box = img.getBoundingClientRect();
        return { transparent: getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)', width: innerWidth, height: innerHeight,
          x: box.x, y: box.y, right: box.right, bottom: box.bottom, visible: box.width > 0 && box.height > 0 && getComputedStyle(img).visibility !== 'hidden', svg: img.getAttribute('src') === '/crystal.svg' };
      });
      if (!proof.transparent || !proof.visible || !proof.svg || proof.x < 0 || proof.y < 0 || proof.right > proof.width || proof.bottom > proof.height) throw Error('overlay bounds/transparency');
      checks.push({ name: label, passed: true, viewport: '1280x800', proof });
    } finally { await page.close(); }
  }
  await overlay(HOME, 'SIMULATOR full home waiting'); await overlay(OTHER, 'SIMULATOR full other waiting');
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) { await f.control(id, 'bootstrap'); f.advance(); await f.control(id, 'keep'); f.advance(); }
  await f.chat(HOME, HOME, '!mark moon'); await f.chat(HOME, HOME, '!relic approve m1');
  await f.control(HOME, `send:${OTHER}`); f.advance(); await f.raid(HOME, OTHER, 2);
  // Seek beyond the actual receipt-based20s animation with fixture clock; no CSS/class override.
  f.advance(20001); await overlay(OTHER, 'SIMULATOR verified receipt after20s');
  await f.chat(HOME, HOME, '!offer'); await f.chat(OTHER, OTHER, '!accept');
  if ((await f.runtime.state.getPublicJourney()).rings !== 1) throw Error('transfer failed');
  await overlay(HOME, 'SIMULATOR home after transfer'); await overlay(OTHER, 'SIMULATOR holder after transfer');
  stage = 'atlas'; const page = await context.newPage(); await page.goto(`${origin}/atlas/`);
  await page.waitForFunction(() => document.body.textContent.includes('1 completed growth ring'));
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Atlas overflow');
  checks.push({ name: 'SIMULATOR Atlas actual completed stop', passed: true }); await page.close(); stage = 'complete';
} catch (error) { failure = ['EPERM', 'EADDRINUSE', 'ENOENT'].includes(error?.code) ? error.code : 'assertion-or-browser'; }
finally {
  await browser?.close().catch(() => {}); sockets?.close(); if (server?.listening) await new Promise(resolve => server.close(resolve)); await tls?.cleanup();
  await mkdir('artifacts', { recursive: true }); await writeFile('artifacts/full-overlay-browser-results.json', JSON.stringify({ simulator: true, passed: !failure, stage, failure: failure ?? null, checks, captures: [] }, null, 2));
}
if (failure) process.exitCode = 1;
