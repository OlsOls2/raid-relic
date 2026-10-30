// Explicit LOCAL HTTPS/mock-only P1 functional gate. No screenshots required.
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
const origin = 'https://localhost:5191',
  f = await pilotFixture('memory', { origin });
let tls,
  server,
  sockets,
  browser,
  stage = 'startup',
  failure;
const checks = [],
  pageErrors = [];
let failureCategory = null;
try {
  tls = await createLocalTLS();
  server = createServer(tls.options, f.runtime.handler);
  sockets = attachOverlaySockets(server, f.runtime.overlayFeeds, {
    origins: [origin],
    allowRead: f.runtime.allowPublicRead,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(5191, '127.0.0.1', resolve);
  });
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  f.streams.get(HOME).viewer_count = 2;
  await f.control(HOME, `send:${OTHER}`);
  stage = 'browser';
  const { chromium } = await import('playwright');
  browser = await chromium.launch({
    executablePath: '/snap/bin/chromium',
    chromiumSandbox: true,
    headless: true,
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
  });
  // Legacy SVG-fallback contract; default real WebGL is exercised independently.
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /^webgl/.test(type) ? null : original.call(this, type, ...args);
    };
  });
  context.on('page', (page) =>
    page.on('pageerror', (error) => {
      if (pageErrors.length < 8)
        pageErrors.push(
          ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'Error'].includes(
            error?.name,
          )
            ? error.name
            : 'OtherError',
        );
    }),
  );
  await context.route('**/*', (r) =>
    new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
  );
  await context.routeWebSocket('**/*', (r) =>
    new URL(r.url()).origin === origin.replace('https:', 'wss:') ? r.connectToServer() : r.close(),
  );
  const pages = [];
  for (const [host, corner] of [
    [HOME, false],
    [OTHER, false],
    [OTHER, true],
  ]) {
    stage = corner ? 'corner-meter' : 'full-meter';
    const page = await context.newPage();
    if (corner) await page.setViewportSize({ width: 160, height: 160 });
    // Legacy full-composition contract; default-card coverage remains in full-overlay.
    await page.goto(`${origin}/overlay/${host}${corner ? '?corner=1' : '?layout=full'}`);
    await page.bringToFront();
    await page.locator('#claim-meter').waitFor({ state: 'visible' });
    if (!(await page.locator('#claim-label').textContent()).includes('Awaiting verified raid'))
      throw Error('meter label');
    if ((await page.locator('.archive').getAttribute('data-phase')) !== 'idle')
      throw Error('acceptance arrival');
    const box = await page.locator('#claim-meter').boundingBox();
    const size = page.viewportSize();
    if (
      !box ||
      box.x < 0 ||
      box.y < 0 ||
      box.x + box.width > size.width + 1 ||
      box.y + box.height > size.height + 1
    )
      throw Error('meter bounds');
    if (corner) {
      const status = await page.locator('#compact-status').boundingBox();
      const count = await page.locator('#compact-count').boundingBox();
      if (!status || !count || status.y + status.height > count.y || count.y + count.height > box.y)
        throw Error('corner voting overlap');
    }
    await page.locator('#simulator').waitFor({ state: 'visible' });
    pages.push(page);
  }
  checks.push({
    name: 'SIMULATOR both full meters and160px corner, provisional only/no arrival',
    passed: true,
  });
  stage = 'seen-source-votes';
  await f.chat(HOME, '811', 'hello');
  f.advance();
  await f.chat(OTHER, '811', '!offer');
  await f.chat(OTHER, OTHER, '!accept');
  if ((await f.runtime.state.getPublicJourney()).rings !== 0) throw Error('premature transfer');
  for (const page of pages) {
    await page.bringToFront();
    await page.waitForFunction(
      () =>
        document.visibilityState === 'visible' &&
        /Offer 1\/1.*Accept 1\/1/.test(document.querySelector('#claim-label').textContent),
    );
  }
  checks.push({
    name: 'SIMULATOR moved source-seen offer and quorums visible on both sides, no ring',
    passed: true,
  });
  stage = 'verified-kernel';
  f.advance();
  await f.raid(HOME, OTHER, 2);
  if ((await f.runtime.state.getPublicJourney()).rings !== 1) throw Error('verified completion');
  if ((await f.runtime.state.getKeeperRegistry()).holderId !== OTHER)
    throw Error('verified holder');
  stage = 'source-release';
  await pages[0].bringToFront();
  await pages[0].waitForFunction(
    () =>
      document.visibilityState === 'visible' &&
      document.body.dataset.state === 'waiting' &&
      document.querySelector('#claim-meter').hidden &&
      document.querySelector('.archive').dataset.phase === 'idle' &&
      document.querySelectorAll('.rune').length === 0 &&
      document.querySelector('#lineage').textContent.includes('1 completed'),
  );
  const sourceView = await pages[0].evaluate(async () =>
    (await fetch(`/api${location.pathname}`)).json(),
  );
  if (
    sourceView.status !== 'waiting' ||
    sourceView.marks.length !== 0 ||
    sourceView.claimMeter !== null ||
    sourceView.lineageRings !== 1 ||
    !sourceView.handoff?.completed ||
    sourceView.handoff.role !== 'source' ||
    sourceView.handoff.offers !== 1 ||
    sourceView.handoff.accepts !== 1 ||
    sourceView.handoff.threshold !== 1
  )
    throw Error('source release proof');
  for (const [index, page] of pages.entries()) {
    if (index === 0) continue;
    stage = index === 1 ? 'target-full' : 'target-corner';
    await page.bringToFront();
    await page.waitForFunction(
      () =>
        document.visibilityState === 'visible' &&
        document.body.dataset.state === 'ready' &&
        document.querySelector('#claim-meter').hidden &&
        document.querySelector('#lineage').textContent.includes('1 completed') &&
        document.querySelector('.archive').dataset.phase !== 'idle',
    );
    const view = await page.evaluate(async () => (await fetch(`/api${location.pathname}`)).json());
    if (
      view.status !== 'ready' ||
      !view.handoff?.completed ||
      view.handoff.role !== 'host' ||
      view.lineageRings !== 1 ||
      view.claimMeter !== null ||
      view.handoff.offers !== 1 ||
      view.handoff.accepts !== 1 ||
      view.handoff.threshold !== 1
    )
      throw Error('verified target completed proof');
  }
  await pages[2].bringToFront();
  await pages[2].locator('#compact-status').filter({ hasText: 'Relic connected' }).waitFor();
  stage = 'visible-arrival';
  await pages[1].bringToFront();
  await pages[1].waitForFunction(
    () =>
      document.querySelector('#lineage').textContent.includes('1 completed') &&
      document.querySelector('.archive').dataset.phase !== 'idle',
  );
  stage = 'reduced-motion';
  await pages[1].bringToFront();
  await pages[1].emulateMedia({ reducedMotion: 'reduce' });
  await pages[1].waitForFunction(
    () =>
      document.visibilityState === 'visible' &&
      document.querySelector('.archive').dataset.phase === 'settled',
  );
  if (pageErrors.length) throw Error('local page error');
  checks.push({
    name: 'SIMULATOR verified receipt gates transfer/arrival and reduced-motion settles',
    passed: true,
  });
  stage = 'complete';
} catch (error) {
  failureCategory =
    error?.name === 'TimeoutError'
      ? 'timeout'
      : ['EPERM', 'EADDRINUSE', 'ENOENT'].includes(error?.code)
        ? 'local-environment'
        : 'assertion-or-browser';
  failure = ['EPERM', 'EADDRINUSE', 'ENOENT'].includes(error?.code)
    ? error.code
    : 'assertion-or-browser';
} finally {
  await browser?.close().catch(() => {});
  sockets?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await tls?.cleanup();
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/preclaim-browser-results.json',
    JSON.stringify(
      {
        simulator: true,
        passed: !failure,
        stage,
        failure: failure ?? null,
        failureCategory,
        pageErrors,
        checks,
        captures: [],
      },
      null,
      2,
    ),
  );
}
if (failure) process.exitCode = 1;
