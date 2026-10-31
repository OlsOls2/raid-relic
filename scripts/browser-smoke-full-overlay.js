// LOCAL HTTPS, memory/mock transports only. No production URLs are opened.
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
const origin = 'https://localhost:5191',
  f = await pilotFixture('memory', { origin });
let browser,
  server,
  tls,
  sockets,
  failure,
  errorCategory = null,
  stage = 'startup';
const checks = [];
const diagnostic = { assertionLine: 0, errorCategoryCode: 0 };
const layoutMeasurements = [],
  captureMetadata = [];
const overlayCaptures = new Map();
const captureNames = new Set([
  'overlay-card-fhd.png',
  'overlay-card-960.png',
  'overlay-arrival-source.png',
  'overlay-arrival-host.png',
]);
async function captureOverlay(page, name) {
  if (process.env.OVERLAY_GROUP_CAPTURE !== '1') return;
  if (!captureNames.has(name) || overlayCaptures.has(name) || overlayCaptures.size >= 4)
    throw Error('capture inventory');
  await page.waitForFunction(
    () => Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 0,
  );
  const viewport = page.viewportSize();
  const clip = await page.locator('.relic-overlay').boundingBox();
  if (
    !clip ||
    clip.width <= 0 ||
    clip.height <= 0 ||
    Math.ceil(clip.width) * Math.ceil(clip.height) * 4 > 4 * 1024 * 1024 ||
    clip.x < 0 ||
    clip.y < 0 ||
    clip.x + clip.width > viewport.width ||
    clip.y + clip.height > viewport.height
  )
    throw Error('capture geometry');
  // Own procedural gameplay backdrop only; never hide or replace overlay content.
  await page.evaluate(() => {
    document.body.style.backgroundImage =
      'repeating-linear-gradient(35deg,#fff 0 12px,#26354b 12px 24px,#b7a2df 24px 36px)';
  });
  const png = await page.screenshot({ fullPage: false, clip });
  if (
    png.length > 524288 ||
    [...overlayCaptures.values()].reduce((a, b) => a + b, 0) + png.length > 4 * 1024 * 1024
  )
    throw Error('capture bytes');
  const after = page.viewportSize();
  const inner = await page.evaluate(() => [innerWidth, innerHeight]);
  if (
    after.width !== viewport.width ||
    after.height !== viewport.height ||
    inner[0] !== viewport.width ||
    inner[1] !== viewport.height
  )
    throw Error('capture changed viewport');
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/' + name, png);
  overlayCaptures.set(name, png.length);
  captureMetadata.push({
    name,
    viewport,
    clip,
    bytes: png.length,
    backdrop: 'synthetic-stripes',
    compressedGameplayProven: false,
  });
}

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
  // BASE pre-edition SVG contract. Active edition/decode/context-loss/mobile/corner
  // coverage lives in browser-smoke-editions.js; fixture/server receipt clocks stay unchanged.
  await context.addInitScript(() => {
    const NativeDate = Date;
    window.Date = class extends NativeDate {
      constructor(...args) {
        super(...(args.length ? args : ['2026-10-22T12:00:00Z']));
      }
      static now() {
        return NativeDate.parse('2026-10-22T12:00:00Z');
      }
    };
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /^webgl/.test(type) ? null : original.call(this, type, ...args);
    };
  });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  await context.routeWebSocket('**/*', (route) =>
    new URL(route.url()).origin === origin.replace('https:', 'wss:')
      ? route.connectToServer()
      : route.close(),
  );
  async function overlay(id, label) {
    stage = label;
    const page = await context.newPage();
    try {
      await page.goto(`${origin}/overlay/${id}`);
      await page.locator('#simulator').waitFor({ state: 'visible' });
      await page.waitForFunction(
        () =>
          document.querySelector('.crystal')?.complete &&
          document.querySelector('.crystal')?.naturalWidth > 0,
      );
      const proof = await page.evaluate(() => {
        const img = document.querySelector('.crystal'),
          box = img.getBoundingClientRect();
        return {
          transparent: getComputedStyle(document.body).backgroundColor === 'rgba(0, 0, 0, 0)',
          width: innerWidth,
          height: innerHeight,
          x: box.x,
          y: box.y,
          right: box.right,
          bottom: box.bottom,
          visible: box.width > 0 && box.height > 0 && getComputedStyle(img).visibility !== 'hidden',
          svg: img.getAttribute('src') === '/crystal.svg',
        };
      });
      if (
        !proof.transparent ||
        !proof.visible ||
        !proof.svg ||
        proof.x < 0 ||
        proof.y < 0 ||
        proof.right > proof.width ||
        proof.bottom > proof.height
      )
        throw Error('overlay bounds/transparency');
      checks.push({ name: label, passed: true, viewport: '1280x800', proof });
    } finally {
      await page.close();
    }
  }
  await overlay(HOME, 'SIMULATOR full home waiting');
  await overlay(OTHER, 'SIMULATOR full other waiting');
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  await f.chat(HOME, HOME, '!mark moon');
  await f.chat(HOME, HOME, '!relic approve m1');
  await f.control(HOME, `send:${OTHER}`);
  f.advance();
  await f.raid(HOME, OTHER, 2);
  // Seek beyond the actual receipt-based20s animation with fixture clock; no CSS/class override.
  f.advance(20001);
  await overlay(OTHER, 'SIMULATOR verified receipt after20s');
  await f.chat(HOME, HOME, '!offer');
  await f.chat(OTHER, OTHER, '!accept');
  if ((await f.runtime.state.getPublicJourney()).rings !== 1) throw Error('transfer failed');
  await overlay(HOME, 'SIMULATOR home after transfer');
  await overlay(OTHER, 'SIMULATOR holder after transfer');
  stage = 'atlas';
  const page = await context.newPage();
  await page.goto(`${origin}/atlas/`);
  await page.waitForFunction(() => document.body.textContent.includes('1 completed growth ring'));
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth))
    throw Error('Atlas overflow');
  checks.push({ name: 'SIMULATOR Atlas actual completed stop', passed: true });
  await page.close();
  stage = 'logical-fhd-card';
  const modern = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1920, height: 1080 },
  });
  await modern.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  await modern.routeWebSocket('**/*', (route) =>
    new URL(route.url()).origin === origin.replace('https:', 'wss:')
      ? route.connectToServer()
      : route.close(),
  );
  const card = await modern.newPage();
  await card.goto(`${origin}/overlay/${OTHER}`);
  await card.waitForFunction(
    () =>
      document.body.dataset.connection === 'connected' &&
      Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 0,
  );
  const geometry = async () =>
    card.evaluate(() => {
      const plate = document.querySelector('.relic-overlay').getBoundingClientRect();
      const central = {
        left: innerWidth * 0.2,
        right: innerWidth * 0.8,
        top: innerHeight * 0.2,
        bottom: innerHeight * 0.8,
      };
      const area = (a, b) =>
        Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
        Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const critical = ['.archive', 'h1', '#status', '#count'].map((q) =>
        document.querySelector(q).getBoundingClientRect(),
      );
      return {
        x: plate.x,
        y: plate.y,
        width: plate.width,
        height: plate.height,
        criticalOverlap: critical.reduce((n, r) => n + area(r, central), 0),
        plateOverlap: area(plate, central),
        heading: parseFloat(getComputedStyle(document.querySelector('h1')).fontSize),
        body: parseFloat(getComputedStyle(document.querySelector('#status')).fontSize),
        artSlotWidth: document.querySelector('.archive').getBoundingClientRect().width,
        artSlotHeight: document.querySelector('.archive').getBoundingClientRect().height,
        svgElementWidth: document.querySelector('.crystal').getBoundingClientRect().width,
        svgElementHeight: document.querySelector('.crystal').getBoundingClientRect().height,
        rasterWidth: document.querySelector('canvas.relic3d').width,
        rasterHeight: document.querySelector('canvas.relic3d').height,
      };
    });
  const settleCard = async (expected, phaseCode) => {
    try {
      await card.waitForFunction(
        ([vw, vh, x, y, width, height]) => {
          const rect = document.querySelector('.relic-overlay')?.getBoundingClientRect();
          return (
            innerWidth === vw &&
            innerHeight === vh &&
            rect &&
            rect.x === x &&
            rect.y === y &&
            rect.width === width &&
            rect.height === height
          );
        },
        expected,
        { timeout: 5000 },
      );
    } catch (error) {
      diagnostic.resizePhaseCode = phaseCode;
      try {
        const actual = await card.evaluate(() => {
          const rect = document.querySelector('.relic-overlay')?.getBoundingClientRect();
          return {
            resizeViewportWidth: innerWidth,
            resizeViewportHeight: innerHeight,
            resizeX: rect?.x,
            resizeY: rect?.y,
            resizeWidth: rect?.width,
            resizeHeight: rect?.height,
          };
        });
        for (const key of [
          'resizeViewportWidth',
          'resizeViewportHeight',
          'resizeX',
          'resizeY',
          'resizeWidth',
          'resizeHeight',
        ])
          diagnostic[key] = Number.isFinite(actual[key]) ? actual[key] : -1;
      } catch {
        diagnostic.resizeDiagnosticUnavailable = 1;
      }
      throw error;
    }
  };
  const fhd = await geometry();
  layoutMeasurements.push({
    viewportWidth: 1920,
    viewportHeight: 1080,
    ...fhd,
    paintedSubject140Proven: false,
    fullPlateAvoidsCentral60: fhd.plateOverlap === 0,
  });
  if (
    fhd.width !== 560 ||
    fhd.height !== 180 ||
    fhd.x !== 48 ||
    fhd.y !== 852 ||
    fhd.criticalOverlap !== 0 ||
    fhd.plateOverlap !== 224 * 12 ||
    fhd.heading !== 36 ||
    fhd.body !== 28 ||
    fhd.rasterWidth > 480 ||
    fhd.rasterHeight > 480
  )
    throw Error('logical card geometry');
  await captureOverlay(card, 'overlay-card-fhd.png');
  stage = 'compressed-card-resize';
  await card.setViewportSize({ width: 960, height: 540 });
  await settleCard([960, 540, 24, 426, 280, 90], 1);
  const half = await geometry();
  layoutMeasurements.push({
    viewportWidth: 960,
    viewportHeight: 540,
    ...half,
    paintedSubject140Proven: false,
    fullPlateAvoidsCentral60: half.plateOverlap === 0,
  });
  if (
    half.width !== 280 ||
    half.height !== 90 ||
    half.x !== 24 ||
    half.y !== 426 ||
    half.criticalOverlap !== 0 ||
    half.plateOverlap !== 56 * 12
  )
    throw Error('compressed card geometry');
  await captureOverlay(card, 'overlay-card-960.png');
  checks.push({
    name: 'Logical560x180 at48safe; original FHD and half-scale viewport, honest 12px plate-only central intrusion',
    passed: true,
  });
  stage = 'restored-fhd-resize';
  await card.setViewportSize({ width: 1920, height: 1080 });
  await settleCard([1920, 1080, 48, 852, 560, 180], 2);
  stage = 'verified-takeover';
  await f.control(OTHER, `send:${HOME}`);
  f.advance();
  await f.raid(OTHER, HOME, 2);
  await card.waitForFunction(() => document.body.classList.contains('arrival-takeover'));
  if ((await card.locator('#arrival-action').innerText()) !== 'Sending chat: !offer')
    throw Error('source role');
  const takeover = await card.locator('.relic-overlay').boundingBox();
  if (takeover.width !== 900 || takeover.height !== 300) throw Error('takeover geometry');
  const before = Number(await card.locator('#arrival-countdown').innerText());
  if (before > 180 || before < 175) throw Error('landing deadline');
  await captureOverlay(card, 'overlay-arrival-source.png');
  const receiver = await modern.newPage();
  await receiver.goto(`${origin}/overlay/${HOME}`);
  await receiver.waitForFunction(() => document.body.classList.contains('arrival-takeover'));
  if ((await receiver.locator('#arrival-action').innerText()) !== 'Receiving chat: !accept')
    throw Error('receiver role');
  await captureOverlay(receiver, 'overlay-arrival-host.png');
  await f.chat(OTHER, OTHER, '!offer');
  await f.chat(HOME, HOME, '!accept');
  await card.waitForFunction(() => !document.body.classList.contains('arrival-takeover'));
  if ((await f.runtime.state.getPublicJourney()).rings !== 2) throw Error('actual ring');
  await receiver.close();
  await card.close();
  checks.push({
    name: 'Actual signed verified landing drives both roles and real180s deadline; genuine completion returns card',
    passed: true,
  });
  stage = 'isolated-local-preview';
  const parent = await modern.newPage();
  let previewSockets = 0,
    previewWrites = 0;
  parent.on('websocket', () => previewSockets++);
  parent.on('request', (r) => {
    if (
      r.method() !== 'GET' ||
      /\/(api|control|auth|oauth|eventsub|internal)(?:\/|$)/.test(new URL(r.url()).pathname)
    )
      previewWrites++;
  });
  const beforeRegistry = await f.runtime.state.getKeeperRegistry(),
    beforeJourney = await f.runtime.state.getPublicJourney(),
    beforeCalls = f.calls.length;
  await parent.goto(origin + '/overlay');
  await parent.evaluate(
    (src) => {
      const iframe = document.createElement('iframe');
      iframe.width = '1280';
      iframe.height = '720';
      iframe.src = src;
      document.body.append(iframe);
    },
    origin + `/overlay/${HOME}?preview=arrival`,
  );
  const embedded = parent.frameLocator('iframe');
  await embedded.locator('body[data-local-preview-ready="true"]').waitFor({ state: 'attached' });
  if ((await embedded.locator('body').getAttribute('data-connection')) !== 'local-test')
    throw Error('preview connection label');
  await embedded.locator('#simulator').waitFor({ state: 'visible' });
  if (!/LOCAL TEST/.test(await embedded.locator('#simulator').innerText()))
    throw Error('preview label');
  await parent.evaluate(() =>
    document
      .querySelector('iframe')
      .contentWindow.postMessage(
        { type: 'raid-relic-preview-arrival', role: 'source' },
        location.origin,
      ),
  );
  await embedded.locator('#arrival-action').filter({ hasText: 'Sending chat: !offer' }).waitFor();
  await parent.evaluate(() =>
    document
      .querySelector('iframe')
      .contentWindow.postMessage(
        { type: 'raid-relic-preview-arrival', role: 'host', offers: 99 },
        location.origin,
      ),
  );
  if ((await embedded.locator('#arrival-action').innerText()) !== 'Sending chat: !offer')
    throw Error('preview schema');
  if (
    previewSockets ||
    previewWrites ||
    f.calls.length !== beforeCalls ||
    JSON.stringify(await f.runtime.state.getKeeperRegistry()) !== JSON.stringify(beforeRegistry) ||
    JSON.stringify(await f.runtime.state.getPublicJourney()) !== JSON.stringify(beforeJourney)
  )
    throw Error('preview effects');
  await parent.close();
  await modern.close();
  checks.push({
    name: 'Same-origin embedded LOCAL TEST with closed role-only messages and zero sockets/API/provider/game writes',
    passed: true,
  });
  stage = 'complete';
} catch (error) {
  const categories = ['AssertionError', 'TimeoutError', 'TypeError', 'ProtocolError'];
  const category = categories.indexOf(error?.name);
  errorCategory = category < 0 ? 'fixture-or-browser' : categories[category];
  diagnostic.errorCategoryCode = category < 0 ? 5 : category + 1;
  diagnostic.assertionLine = Number(
    /browser-smoke-full-overlay[.]js:(\d+)/.exec(error?.stack ?? '')?.[1] ?? 0,
  );
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
    'artifacts/full-overlay-browser-results.json',
    JSON.stringify(
      {
        simulator: true,
        passed: !failure,
        stage,
        failure: failure ?? null,
        errorCategory,
        diagnostic,
        checks,
        captures: [...overlayCaptures.keys()],
        captureMetadata,
        layoutMeasurements,
      },
      null,
      2,
    ),
  );
}
if (failure) process.exitCode = 1;
