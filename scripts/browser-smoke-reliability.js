// Default: LOCAL synthetic TLS/WSS reliability. Explicit --cold-navigation:
// parent-owned read-only network timing; never an upstream EventSub socket.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { visualReview, growthPixels, localChromiumOptions } from '../test-support/visual-review.js';
import { HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
export const COLD_ROUTES = Object.freeze([
  '/',
  '/atlas/',
  '/keeper/olsols3',
  '/overlay/1593561134',
]);
export function coldOptions(args) {
  const values = new Map();
  for (const arg of args) {
    const match = /^(--cold-navigation|--preview-access-stdin|--origin|--samples)(?:=(.*))?$/.exec(
      arg,
    );
    if (!match || values.has(match[1])) throw Error('Cold input');
    const flag = ['--cold-navigation', '--preview-access-stdin'].includes(match[1]);
    if (flag ? match[2] !== undefined : !match[2]) throw Error('Cold input');
    values.set(match[1], flag ? true : match[2]);
  }
  const origin = values.get('--origin');
  const url = new URL(origin);
  if (
    !values.has('--cold-navigation') ||
    url.protocol !== 'https:' ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    !/^(?:[a-z][a-z0-9-]{0,62}---)?raid-relic-vz4bhnskgq-uc\.a\.run\.app$/.test(url.hostname)
  )
    throw Error('Cold origin');
  const samples = values.get('--samples') ?? '3';
  if (!/^[1-3]$/.test(samples)) throw Error('Cold samples');
  return { origin, samples: Number(samples), privateAccess: values.has('--preview-access-stdin') };
}
export function coldReadAllowed(origin, address, method) {
  try {
    const url = new URL(address);
    return (
      url.origin === origin &&
      !url.username &&
      !url.password &&
      ['GET', 'HEAD'].includes(method) &&
      !/%|\\/.test(url.pathname) &&
      !/^\/(?:control|auth|oauth|eventsub|internal|_preview)(?:\/|$)/.test(url.pathname)
    );
  } catch {
    return false;
  }
}
export function coldAccess(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > 44) throw Error('Cold access');
  const value = bytes.toString('ascii').replace(/\n$/, '');
  if (
    !Buffer.from(value + (bytes.at(-1) === 10 ? '\n' : ''), 'ascii').equals(bytes) ||
    !/^[A-Za-z0-9_-]{43}$/.test(value) ||
    Buffer.from(value, 'base64url').length !== 32 ||
    Buffer.from(value, 'base64url').toString('base64url') !== value
  )
    throw Error('Cold access');
  return value;
}
export function validateColdRow(row) {
  const positive = (v) => Number.isFinite(v) && v > 0 && v <= 150000;
  if (
    !COLD_ROUTES.includes(row?.route) ||
    !Number.isInteger(row.sample) ||
    row.sample < 0 ||
    row.sample > 2 ||
    row.status !== 200 ||
    row.error !== null ||
    row.visibility !== 'visible' ||
    !Array.isArray(row.paints) ||
    row.paints.length !== 2 ||
    !['first-paint', 'first-contentful-paint'].every(
      (name) => row.paints.filter((p) => p.name === name && positive(p.time)).length === 1,
    ) ||
    !positive(row.lcp?.time) ||
    !Number.isFinite(row.lcp?.size) ||
    row.lcp.size <= 0 ||
    row.lcp.size > 1365 * 768 ||
    !/^[A-Z][A-Z0-9]{0,15}$/.test(row.lcp?.tag ?? '') ||
    !positive(row.navigation?.ttfb) ||
    !positive(row.navigation?.dom) ||
    !positive(row.navigation?.load) ||
    !Number.isFinite(row.navigation?.transfer) ||
    row.navigation.transfer < 0
  )
    throw Error('Cold metric');
  return row;
}
export function coldSummary(rows, samples) {
  if (!Number.isInteger(samples) || samples < 1 || samples > 3 || rows.length !== samples * 4)
    throw Error('Cold rows');
  const keys = new Set();
  for (const row of rows) {
    validateColdRow(row);
    const key = row.route + ':' + row.sample;
    if (row.sample >= samples || keys.has(key)) throw Error('Cold duplicate');
    keys.add(key);
  }
  return COLD_ROUTES.map((route) => {
    const times = rows
      .filter((r) => r.route === route)
      .map((r) => r.lcp.time)
      .sort((a, b) => a - b);
    const medianMs =
      times.length % 2 ? times[Math.floor(times.length / 2)] : (times[0] + times[1]) / 2;
    return {
      route,
      medianMs,
      maxMs: times.at(-1),
      budgetMs: 2500,
      withinBudget: times.at(-1) <= 2500,
    };
  });
}
export function coldBaseline(value) {
  if (
    value?.at !== '2026-10-31T14:13:39.675Z' ||
    value.origin !== 'https://sendoff-fix-on-1031---raid-relic-vz4bhnskgq-uc.a.run.app' ||
    value.browser !== 'native Chromium 156.0.8078.47' ||
    JSON.stringify(value.viewport) !== '[1365,768]' ||
    value.dpr !== 1 ||
    value.samples !== 3 ||
    value.observationMs !== 8000 ||
    value.httpCacheDisabled !== true ||
    value.freshContextPerNavigation !== true ||
    value.cpuThrottle !== false ||
    value.networkThrottle !== false ||
    value.serverColdStartForced !== false ||
    value.noInputOrProviderWrites !== true
  )
    throw Error('Cold baseline');
  return coldSummary(value.rows, 3);
}
async function readColdAccess() {
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    const cleanup = () => {
      clearTimeout(timer);
      process.stdin.off('data', data);
      process.stdin.off('end', end);
      process.stdin.off('error', fail);
      process.stdin.pause();
    };
    const fail = () => {
      bytes.fill(0);
      cleanup();
      reject(Error('Cold access'));
    };
    const data = (chunk) => {
      if (bytes.length + chunk.length > 44) return fail();
      bytes = Buffer.concat([bytes, chunk]);
    };
    const end = () => {
      cleanup();
      try {
        const key = coldAccess(bytes);
        bytes.fill(0);
        resolve(key);
      } catch {
        bytes.fill(0);
        reject(Error('Cold access'));
      }
    };
    const timer = setTimeout(fail, 5000);
    process.stdin.on('data', data);
    process.stdin.once('end', end);
    process.stdin.once('error', fail);
    process.stdin.resume();
  });
}
async function runColdNavigation(args) {
  let browser,
    context,
    key = null,
    deadlineTimer;
  const rows = [];
  const report = { passed: false, stage: 'input', failureCategory: null, rows };
  const start = performance.now();
  try {
    const options = coldOptions(args);
    const baselineFile = await open(
      new URL('../docs/COLD_NAV_BASELINE_1031.json', import.meta.url),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let baselineBytes;
    try {
      const stat = await baselineFile.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size <= 0 || stat.size > 65536)
        throw Error('Cold baseline');
      baselineBytes = await baselineFile.readFile();
      if (baselineBytes.length !== stat.size || baselineBytes.length > 65536)
        throw Error('Cold baseline');
    } finally {
      await baselineFile.close();
    }
    const baseline = coldBaseline(JSON.parse(baselineBytes));
    if (options.privateAccess) key = await readColdAccess();
    report.stage = 'browser';
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ ...(await localChromiumOptions(chromium)), timeout: 20000 });
    let expired = false;
    deadlineTimer = setTimeout(
      () => {
        expired = true;
        void browser.close().catch(() => {});
      },
      Math.max(1, 150000 - (performance.now() - start)),
    );
    Object.assign(report, {
      origin: options.origin,
      browser: 'native Chromium ' + browser.version(),
      viewport: [1365, 768],
      dpr: 1,
      samples: options.samples,
      observationMs: 8000,
      httpCacheDisabled: true,
      freshContextPerNavigation: true,
      cpuThrottle: false,
      networkThrottle: false,
      serverColdStartForced: false,
      noInputOrProviderWrites: true,
      websocketPolicy: 'blocked-read-only-measurement',
      privateAccessSupplied: options.privateAccess,
      trustedInputCount: 0,
    });
    for (const route of COLD_ROUTES)
      for (let sample = 0; sample < options.samples; sample++) {
        if (expired || performance.now() - start >= 150000) throw Error('Cold deadline');
        report.stage = 'navigation';
        report.activeRoute = route;
        report.activeSample = sample;
        context = await browser.newContext({
          viewport: { width: 1365, height: 768 },
          deviceScaleFactor: 1,
          serviceWorkers: 'block',
          reducedMotion: 'no-preference',
          acceptDownloads: false,
        });
        let forbidden = 0,
          downloads = 0;
        await context.route('**/*', async (r) => {
          if (!coldReadAllowed(options.origin, r.request().url(), r.request().method())) {
            forbidden++;
            return r.abort();
          }
          // Credential is injected only after exact same-origin/method/path checks.
          // It is never a context-wide header forwarded through a redirect.
          return key
            ? r.continue({ headers: { ...r.request().headers(), 'x-preview-access': key } })
            : r.continue();
        });
        await context.routeWebSocket('**/*', (r) => r.close());
        const page = await context.newPage();
        page.on('download', () => downloads++);
        const cdp = await context.newCDPSession(page);
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Network.clearBrowserCache');
        await page.addInitScript(() => {
          window.__coldNavigationLCP = null;
          new PerformanceObserver((list) => {
            for (const e of list.getEntries())
              window.__coldNavigationLCP = {
                time: e.startTime,
                size: e.size,
                tag: e.element?.tagName ?? null,
              };
          }).observe({ type: 'largest-contentful-paint', buffered: true });
        });
        const response = await page.goto(options.origin + route, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        const observed = performance.now();
        report.stage = 'observation';
        while (performance.now() - observed < 8000)
          await new Promise((resolve) =>
            setTimeout(resolve, Math.ceil(8000 - (performance.now() - observed)) + 1),
          );
        const metrics = await page.evaluate(() => {
          const n = performance.getEntriesByType('navigation')[0];
          return {
            paints: performance
              .getEntriesByType('paint')
              .map((e) => ({ name: e.name, time: e.startTime })),
            lcp: window.__coldNavigationLCP,
            navigation: n
              ? {
                  ttfb: n.responseStart,
                  dom: n.domContentLoadedEventEnd,
                  load: n.loadEventEnd,
                  transfer: n.transferSize,
                }
              : null,
            visibility: document.visibilityState,
            previewGate:
              document.title === 'Private preview' ||
              Boolean(document.querySelector('form[action="/_preview/access"]')),
          };
        });
        report.boundary = {
          forbiddenRequests: forbidden,
          downloads,
          previewGate: metrics.previewGate,
          status: response?.status() ?? 0,
        };
        if (
          forbidden ||
          downloads ||
          metrics.previewGate ||
          expired ||
          new URL(page.url()).origin !== options.origin ||
          new URL(page.url()).pathname !== route
        )
          throw Error('Cold boundary');
        const row = {
          route,
          sample,
          status: response?.status() ?? 0,
          error: null,
          paints: metrics.paints,
          lcp: metrics.lcp,
          navigation: metrics.navigation,
          visibility: metrics.visibility,
        };
        validateColdRow(row);
        rows.push(row);
        await context.close();
        context = null;
      }
    report.stage = 'comparison';
    const summary = coldSummary(rows, options.samples);
    report.comparison = summary.map((r, i) => ({
      ...r,
      baselineMedianMs: baseline[i].medianMs,
      baselineMaxMs: baseline[i].maxMs,
      medianDeltaMs: r.medianMs - baseline[i].medianMs,
      maxDeltaMs: r.maxMs - baseline[i].maxMs,
    }));
    report.passed = summary.every((r) => r.withinBudget);
    if (!report.passed) report.failureCategory = 'lcp-budget';
  } catch {
    report.failureCategory = 'input-toolchain-boundary-or-metric';
  } finally {
    clearTimeout(deadlineTimer);
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    key = null;
    report.actualElapsedMs = Math.round(performance.now() - start);
    if (report.actualElapsedMs > 150000) {
      report.passed = false;
      report.failureCategory = 'overall-deadline';
    }
    const closed = JSON.stringify(report);
    if (Buffer.byteLength(closed) > 65536) throw Error('Cold report bound');
    await mkdir('artifacts', { recursive: true });
    await writeFile('artifacts/cold-navigation-browser-results.json', closed + '\n');
    console.log('COLD_NAV_RESULT ' + closed);
  }
  if (!report.passed) process.exitCode = 1;
}
async function runReliability() {
  let review,
    stage = 'setup',
    passed = false,
    failureCategory = null,
    connections = 0,
    closedConnections = 0;
  const checks = [],
    diagnostic = {};
  try {
    review = await visualReview({ durable: true });
    const { page, context, fixture: f, origin } = review;
    // Install before module evaluation: overlay-client captures timer functions
    // at creation. The clock runs normally until the explicit idle fast-forward.
    await page.clock.install();
    await context.routeWebSocket('**/*', (route) =>
      new URL(route.url()).origin === origin.replace('https:', 'wss:')
        ? route.connectToServer()
        : route.close(),
    );
    page.on('websocket', (socket) => {
      connections++;
      socket.on('close', () => closedConnections++);
    });
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    await f.chat(HOME, '9600', '!mark moon');
    await f.chat(HOME, HOME, '!relic approve m1');
    f.advance(31000);
    assert.equal(JSON.parse((await f.control(HOME, 'send:' + OTHER)).body).status, 'accepted');
    await f.raid(HOME, OTHER, 4);
    await f.chat(HOME, '9601', '!offer');
    await f.chat(OTHER, '9701', '!accept');
    const hop = (await f.runtime.state.getKeeperRegistry()).pendingHop;
    f.advance(23000);
    stage = 'late-initial-snapshot';
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(origin + '/overlay/' + OTHER);
    await page.bringToFront();
    await page.waitForFunction(() => document.body.dataset.connection === 'connected');
    await page.waitForFunction(
      () => Number(document.querySelector('.archive').dataset.cinematicElapsed) >= 23000,
    );
    assert.match(await page.locator('#claim-label').innerText(), /Offer 1\/2.*Accept 1\/2/);
    assert.equal(
      Number(await page.locator('.p3-flash').evaluate((el) => getComputedStyle(el).opacity)),
      0,
    );
    await page.waitForFunction(
      () => Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 0,
    );
    assert.equal(await growthPixels(page, async () => {}), true);
    stage = 'offline-reconnect';
    await context.setOffline(true);
    review.dropConnections();
    await page.waitForFunction(() => document.body.dataset.connection !== 'connected');
    const attempts = connections;
    // Bounded real observation of existing 500/1000ms backoff, not a catch-up clock.
    await page.waitForTimeout(1200);
    assert.ok(connections - attempts <= 3);
    await context.setOffline(false);
    await page.waitForFunction(() => document.body.dataset.connection === 'connected');
    // Connected means a validated snapshot arrived; the claim meter and cinema
    // are painted by overlay.js on its next animation frame, not by onopen.
    stage = 'offline-reconnect-rendered';
    await page.waitForFunction(
      () =>
        document.body.dataset.connection === 'connected' &&
        document.querySelector('#claim-meter')?.hidden === false &&
        /Offer 1\/2.*Accept 1\/2/.test(document.querySelector('#claim-label')?.textContent ?? '') &&
        Number(document.querySelector('.archive')?.dataset.cinematicElapsed) >= 23000,
    );
    assert.match(await page.locator('#claim-label').innerText(), /Offer 1\/2.*Accept 1\/2/);
    assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.startedAt, hop.startedAt);
    assert.equal(
      Number(await page.locator('.p3-flash').evaluate((el) => getComputedStyle(el).opacity)),
      0,
    );
    checks.push({
      name: 'Actual local WSS offline/backoff/reconnect seeks an elapsed receipt and preserves partial quorum without replay flash',
      passed: true,
    });
    stage = 'runtime-reconstruction';
    f.advance(1000);
    const calls = f.calls.length;
    await review.restartRuntime();
    assert.equal(f.calls.length, calls);
    await page.waitForFunction(() => document.body.dataset.connection === 'connected');
    await page.waitForFunction(
      () => Number(document.querySelector('.archive').dataset.cinematicElapsed) >= 24000,
    );
    const restored = await f.runtime.overlayFeeds[OTHER].snapshot();
    assert.equal(restored.handoff.startedAt, hop.startedAt);
    assert.equal(restored.handoff.endsAt, hop.endsAt);
    assert.match(await page.locator('#claim-label').innerText(), /Offer 1\/2.*Accept 1\/2/);
    await f.chat(HOME, '9602', '!offer');
    await f.chat(OTHER, '9702', '!accept');
    await page.waitForFunction(
      () => document.querySelector('.growth-fallback')?.dataset.total === '1',
    );
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, OTHER);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    checks.push({
      name: 'New runtime and hub over shared fake Firestore restore original partial clock, then genuine signed fixture votes bind exactly once',
      passed: true,
    });
    stage = 'privacy-after-disconnect';
    await page.waitForFunction(() => document.querySelectorAll('#runes img').length > 0);
    await context.setOffline(true);
    review.dropConnections();
    await f.chat(HOME, '9600', '!relic forgetme');
    f.advance(5000);
    await context.setOffline(false);
    await page.waitForFunction(() => document.body.dataset.connection === 'connected');
    await page.waitForFunction(() => document.querySelectorAll('#runes img').length === 0);
    assert.equal((await f.runtime.overlayFeeds[OTHER].snapshot()).approvedCount, 0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.querySelectorAll('.archive canvas').length === 0);
    assert.equal(await page.locator('.archive > img.crystal').isVisible(), true);
    assert.ok(
      await page.locator('.archive > img.crystal').evaluate(async (img) => {
        await img.decode();
        return img.naturalWidth > 0;
      }),
    );
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    assert.equal(
      f.calls.filter((c) => new URL(c.url).pathname.endsWith('/raids') && c.method === 'POST')
        .length,
      1,
    );
    assert.ok(connections >= 4 && connections <= 10);
    assert.deepEqual(review.stats(), { errors: 0, external: 0 });
    checks.push({
      name: 'Fresh post-disconnect erasure removes carried words; decoded reduced SVG, no extra Raid POST or unbounded reconnect loop',
      passed: true,
    });
    stage = 'human-idle-suspend';
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(
      () => Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 2,
    );
    f.advance(240000); // Resume must seek an elapsed completed receipt, not replay arrival.
    await page.keyboard.press('Shift');
    const closedBeforeIdle = closedConnections;
    await page.clock.fastForward(600001);
    await page.waitForFunction(() => document.body.dataset.connection === 'suspended');
    // The browser's actual WebSocket close event must arrive, not just a label.
    for (let i = 0; i < 50 && closedConnections === closedBeforeIdle; i++)
      await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(closedConnections, closedBeforeIdle + 1);
    assert.equal(await page.locator('#runes img').count(), 0);
    const idleConnections = connections;
    await page.clock.fastForward(10000);
    assert.equal(connections, idleConnections);
    assert.equal(await page.locator('body').getAttribute('data-connection'), 'suspended');
    stage = 'human-idle-trusted-resume';
    await page.keyboard.press('Shift');
    await page.waitForFunction(() => document.body.dataset.connection === 'connected');
    assert.equal(connections, idleConnections + 1);
    assert.equal(await page.locator('#runes img').count(), 0);
    assert.equal((await f.runtime.overlayFeeds[OTHER].snapshot()).approvedCount, 0);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    assert.equal(
      Number(await page.locator('.p3-flash').evaluate((el) => getComputedStyle(el).opacity)),
      0,
    );
    assert.deepEqual(review.stats(), { errors: 0, external: 0 });
    diagnostic.independentIdleResumeChecks = 1;
    checks.push({
      name: 'Browser-clock ten-minute human idle closes actual WSS; trusted Shift resumes fresh erased projection without arrival replay',
      passed: true,
    });
    diagnostic.connections = connections;
    passed = true;
  } catch (e) {
    failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(e?.name)
      ? e.name
      : 'browser-or-fixture';
    const line = /browser-smoke-reliability[.]js:(\d+)/.exec(e?.stack ?? '');
    if (line) diagnostic.assertionLine = Number(line[1]);
    diagnostic.connections = connections;
    diagnostic.browserErrors = review?.stats().errors ?? 0;
  } finally {
    await review?.close();
    await mkdir('artifacts', { recursive: true });
    const report = JSON.stringify({ passed, stage, failureCategory, checks, diagnostic });
    assert.ok(Buffer.byteLength(report) <= 65536);
    await writeFile('artifacts/reliability-browser-results.json', report + '\n');
  }
  if (!passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length === 2) await runReliability();
  else await runColdNavigation(process.argv.slice(2));
}
