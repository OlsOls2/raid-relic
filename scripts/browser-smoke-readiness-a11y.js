// Parent-run, loopback-only SIMULATOR accessibility gate. No live/provider consent or actions.
import assert from 'node:assert/strict';
import { mkdtemp, chmod, readFile, rm, mkdir, writeFile } from 'node:fs/promises';
import { createJudges, JUDGES_ORIGIN as origin } from '../test-support/judges.js';
import { rgba, over, contrast } from '../test-support/a11y-contrast.js';
import { createServer, request as httpsRequest } from 'node:https';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';
import { createPrivatePreview } from '../src/server.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
import { localChromiumOptions } from '../test-support/visual-review.js';

// Legacy readiness checks retain their own state and bounded report.
async function runReadinessA11y() {
  const checks = [],
    images = new Map(),
    timers = new Set();
  let judges,
    browser,
    context,
    page,
    stage = 'setup',
    failureCategory = null,
    diagnostic = {},
    passed = false,
    external = 0,
    errors = 0,
    mode = 'normal',
    fixtureProviderBaseline = 0;
  async function paint() {
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
  }
  async function shot(name) {
    if (process.env.READINESS_CAPTURE !== '1') return;
    await paint();
    assert.ok(await page.locator('#ready-simulator').isVisible());
    const b = await page.screenshot({ fullPage: false });
    assert.ok(b.length <= 524288);
    images.set(name, b);
  }
  async function skip() {
    await page.keyboard.press('Tab');
    assert.equal(
      await page.evaluate(() => document.activeElement?.getAttribute('href')),
      '#main-content',
    );
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'main-content');
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => {
      const n = document.activeElement,
        s = getComputedStyle(n);
      return {
        width: parseFloat(s.outlineWidth),
        style: s.outlineStyle,
        color: s.outlineColor,
        bg: getComputedStyle(document.documentElement).backgroundColor,
        name: (n.getAttribute('aria-label') || n.textContent || '').trim().length,
      };
    });
    assert.ok(f.width >= 2 && f.style !== 'none' && f.name > 0);
    assert.ok(contrast(rgba(f.color), rgba(f.bg)) >= 3);
  }
  async function layout() {
    await paint();
    const v = await page.evaluate(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      mainCount: document.querySelectorAll('main').length,
      h1Count: document.querySelectorAll('h1').length,
      labels: [...document.querySelectorAll('input:not([type=hidden]),select')].every(
        (n) => n.labels?.length || n.getAttribute('aria-label'),
      ),
      buttons: [...document.querySelectorAll('button')]
        .filter((n) => !n.hidden && n.getBoundingClientRect().height > 0)
        .every((n) => n.getBoundingClientRect().height >= 44),
    }));
    diagnostic = { width: v.width, scrollWidth: v.scrollWidth };
    assert.ok(
      v.scrollWidth <= v.width + 1 && v.mainCount === 1 && v.h1Count === 1 && v.labels && v.buttons,
    );
  }
  async function colors() {
    const rows = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          'h1,#description,.ledger-coverage,#status,#map-status,#scores-status,#demo-progress,#demo-lock,#demo-clock,label,.edition-disclaimer',
        ),
      ]
        .slice(0, 50)
        .filter((n) => n.getBoundingClientRect().width > 0 && n.textContent.trim())
        .map((n) => {
          const s = getComputedStyle(n),
            backgrounds = [];
          for (let p = n; p; p = p.parentElement)
            backgrounds.push(getComputedStyle(p).backgroundColor);
          return {
            color: s.color,
            backgrounds,
            size: parseFloat(s.fontSize),
            weight: Number(s.fontWeight) || 400,
          };
        }),
    );
    assert.ok(rows.length >= 3);
    let minimum = 21;
    for (const row of rows) {
      let bg = [16, 29, 48, 1];
      for (const c of row.backgrounds.reverse()) bg = over(rgba(c), bg);
      const ratio = contrast(over(rgba(row.color), bg), bg),
        large = row.size >= 24 || (row.size >= 18.66 && row.weight >= 700);
      minimum = Math.min(minimum, ratio);
      assert.ok(ratio >= (large ? 3 : 4.5));
    }
    diagnostic = { ...diagnostic, contrastSamples: rows.length, minContrast: minimum };
  }
  async function refreshHistory() {
    await page.locator('#refresh').click();
    await page.locator('#refresh:not(:disabled)').waitFor();
  }
  try {
    judges = await createJudges({ intent: true, env: {} });
    await judges.listen();
    const { chromium } = await import('playwright');
    browser = await chromium.launch({
      executablePath: '/snap/bin/chromium',
      chromiumSandbox: true,
      headless: true,
    });
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
      acceptDownloads: true,
    });
    await context.route('**/*', async (route) => {
      const u = new URL(route.request().url());
      if (u.origin !== origin) {
        external++;
        return route.abort();
      }
      const requestMode = mode,
        affected =
          u.pathname === '/api/atlas' ||
          (requestMode === '500' && ['/api/journey-map', '/api/scores'].includes(u.pathname));
      if (requestMode !== 'normal' && affected) {
        if (requestMode === 'timeout')
          await new Promise((resolve) => {
            const t = setTimeout(() => {
              timers.delete(t);
              resolve();
            }, 9000);
            timers.add(t);
          });
        try {
          return await route.fulfill({
            status: requestMode === '500' ? 500 : 200,
            contentType: 'application/json',
            body: requestMode === 'malformed' ? '{}' : '{}',
          });
        } catch {
          return;
        }
      }
      return route.continue();
    });
    await context.addInitScript(() => {
      addEventListener(
        'DOMContentLoaded',
        () => {
          const n = document.createElement('aside');
          n.id = 'ready-simulator';
          n.textContent = 'SIMULATOR · local QA';
          Object.assign(n.style, {
            position: 'fixed',
            bottom: '4px',
            right: '4px',
            zIndex: '100',
            background: '#e6bb70',
            color: '#101d30',
            padding: '4px',
            font: '12px system-ui',
          });
          document.body.append(n);
        },
        { once: true },
      );
      if (location.pathname.startsWith('/demo')) {
        window.__readyIO = 0;
        const no = () => {
          window.__readyIO++;
          throw Error('Demo IO forbidden');
        };
        window.fetch = no;
        window.XMLHttpRequest = no;
        window.WebSocket = no;
        window.EventSource = no;
        navigator.sendBeacon = no;
        for (const k of ['setItem', 'removeItem', 'clear']) Storage.prototype[k] = no;
      }
    });
    page = await context.newPage();
    page.on('pageerror', () => errors++);
    page.setDefaultTimeout(15000);
    stage = 'landing-empty-keyboard';
    await page.goto(origin + '/');
    await page.waitForFunction(() => document.querySelector('#atlas-relic')?.dataset.rings === '0');
    assert.equal(await page.locator('#title').innerText(), 'Raids that leave a story.');
    assert.equal(await page.locator('.primary-cta').getAttribute('href'), '/demo/judge');
    assert.equal(await page.locator('.secondary-cta').getAttribute('href'), '/start');
    await skip();
    // The landing is a front door, not the expanded archive. Exercise native
    // keyboard disclosures before checking the same actual empty projections.
    await page.locator('#how-we-verify > summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#how-we-verify').evaluate((n) => n.open), true);
    assert.match(
      await page.locator('#how-we-verify').innerText(),
      /verified.*both eligible chats/s,
    );
    assert.equal(await page.locator('.landing-archive').evaluate((n) => n.open), false);
    await page.locator('.landing-archive > summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('.landing-archive').evaluate((n) => n.open), true);
    await page.locator('#status.empty-state').filter({ hasText: 'First journey begins' }).waitFor();
    // The landing's new empty copy is #status above. Keyboard anchor navigation
    // can clear transient #map-status via popstate; assert the settled actual map
    // and its persistent empty caption, rather than obsolete transient copy.
    await page.waitForFunction(
      () => document.querySelector('#journey-map').getAttribute('aria-busy') === 'false',
    );
    assert.equal(await page.locator('#map-status').getAttribute('role'), 'status');
    assert.match(await page.locator('#status.empty-state').innerText(), /First journey begins/);
    assert.equal(
      await page.locator('#map-caption').innerText(),
      'No completed journeys yet. No route has been invented.',
    );
    assert.equal(await page.locator('#journey-map').getAttribute('data-rings'), '0');
    assert.ok(await page.locator('#map-play').isDisabled());
    assert.equal(await page.locator('#map-stops button').count(), 0);
    await colors();
    for (const width of [320, 375, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      if (width < 600) {
        await page.waitForFunction(() => !document.querySelector('#ledger-details').open);
        assert.equal(await page.locator('#ledger-details').evaluate((n) => n.open), false);
      }
      await layout();
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(() => scrollTo(0, 0));
    await shot('ready-landing.png');
    checks.push({
      name: 'Actual empty landing, native skip/Tab focus, named controls, contrast and five responsive widths',
      passed: true,
    });
    stage = 'atlas-recorded-keyboard';
    await judges.seedReviewJourney();
    fixtureProviderBaseline = judges.auditCounts().providerCalls;
    await page.goto(origin + '/atlas/');
    await page.locator('#map-stops .map-stop-select').nth(2).waitFor();
    await skip();
    await colors();
    for (const width of [320, 375, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await layout();
    }
    assert.equal(
      await page.locator('#map-stops button[aria-label="Download ring card Stop 3"]').count(),
      1,
    );
    await page.locator('#scores-refresh').focus();
    await page.keyboard.press('Enter');
    await page.locator('#scores-refresh:not(:disabled)').waitFor();
    stage = 'atlas-500-history';
    mode = '500';
    await refreshHistory();
    await page.locator('#status').filter({ hasText: 'Archive unavailable' }).waitFor();
    stage = 'atlas-500-map';
    await page.locator('#map-refresh').click();
    await page.locator('#map-status').filter({ hasText: 'Previous route cleared' }).waitFor();
    await page.locator('#map-refresh:not(:disabled)').waitFor();
    stage = 'atlas-500-scores';
    await page.locator('#scores-refresh').click();
    await page
      .locator('#scores-status')
      .filter({ hasText: 'Previous names and counts hidden' })
      .waitFor();
    await page.locator('#scores-refresh:not(:disabled)').waitFor();
    assert.equal(await page.locator('#journey .stop,#map-stops button,#keeper-rows li').count(), 0);
    for (const id of ['status', 'map-status', 'scores-status'])
      assert.equal(await page.locator('#' + id).getAttribute('role'), 'status');
    for (const failure of ['malformed', 'timeout']) {
      stage = 'atlas-' + failure + '-history';
      mode = failure;
      await refreshHistory();
      assert.match(await page.locator('#status').innerText(), /Archive unavailable/);
      assert.equal(await page.locator('#journey .stop').count(), 0);
    }
    mode = 'normal';
    stage = 'atlas-recover-history';
    await refreshHistory();
    await page.locator('#journey .stop').nth(2).waitFor();
    stage = 'atlas-recover-map';
    await page.locator('#map-refresh').click();
    await page.locator('#map-stops .map-stop-select').nth(2).waitFor();
    await page.locator('#map-refresh:not(:disabled)').waitFor();
    stage = 'atlas-recover-scores';
    await page.locator('#scores-refresh').click();
    await page.locator('#keeper-rows>li').first().waitFor();
    await page.locator('#scores-refresh:not(:disabled)').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => !document.querySelector('#ledger-details').open);
    await page.locator('#ledger-details > summary').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#ledger-details').evaluate((n) => n.open), true);
    await page.locator('#keeper-scores').scrollIntoViewIfNeeded();
    await shot('ready-atlas.png');
    checks.push({
      name: 'Recorded Atlas keyboard refresh, five widths and real500/malformed/8s timeout clearing plus recovery',
      passed: true,
    });
    stage = 'demo-reduced-keyboard';
    await page.goto(origin + '/demo/');
    await skip();
    await colors();
    for (const width of [320, 375, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 844 });
      await layout();
    }
    assert.equal(await page.locator('canvas.relic3d').count(), 0);
    await page.locator('#demo-tour').focus();
    await page.keyboard.press('Space');
    await page.waitForFunction(() => document.body.dataset.demoPlaying === 'true');
    assert.ok(await page.locator('#demo-send').isDisabled());
    await page.locator('#demo-pause').focus();
    await page.keyboard.press('Space');
    assert.equal(await page.locator('body').getAttribute('data-demo-playing'), 'false');
    assert.ok(await page.locator('#demo-offer').isEnabled());
    assert.ok(await page.locator('#demo-raid').isEnabled());
    await page.locator('#demo-reset').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#demo-rings').innerText(), 'Rings: 0');
    assert.ok(
      await page
        .locator('.crystal')
        .evaluate(
          (n) => n.complete && n.naturalWidth > 0 && getComputedStyle(n).visibility !== 'hidden',
        ),
    );
    assert.equal(await page.locator('#demo-clock').getAttribute('aria-live'), null);
    await page.locator('#demo-proof summary').focus();
    await page.keyboard.press('Enter');
    assert.ok(await page.locator('#demo-proof').evaluate((n) => n.open));
    await page.keyboard.press('Space');
    assert.equal(await page.locator('#demo-proof').evaluate((n) => n.open), false);
    assert.ok(await page.locator('#demo-download').isDisabled());
    await page.locator('#demo-send').click();
    await page.locator('#demo-source-chat button').click();
    await page.locator('#demo-raid').click();
    await page.locator('#demo-host-chat button').click();
    assert.ok(await page.locator('#demo-download').isEnabled());
    const download = page.waitForEvent('download');
    await page.locator('#demo-download').click();
    const d = await download;
    assert.equal(d.suggestedFilename(), 'raid-relic-demo-ring-1.png');
    let bytes = 0;
    const stream = await d.createReadStream();
    for await (const chunk of stream) bytes += chunk.length;
    assert.ok(bytes > 1000 && bytes <= 524288);
    assert.equal(await page.evaluate(() => window.__readyIO), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    await shot('ready-demo.png');
    assert.equal(external, 0);
    assert.equal(errors, 0);
    assert.equal(judges.auditCounts().providerCalls, fixtureProviderBaseline);
    checks.push({
      name: 'Reduced-motion keyboard tour/pause/reset, visible original SVG, simulated download, contrast and zero demo IO',
      passed: true,
    });
    passed = true;
    stage = 'complete';
  } catch (error) {
    diagnostic.assertionLine = Number(
      /browser-smoke-readiness-a11y[.]js:(\d+)/.exec(error?.stack ?? '')?.[1] ?? 0,
    );
    failureCategory =
      error?.name === 'TimeoutError'
        ? 'timeout'
        : error?.name === 'AssertionError'
          ? 'assertion'
          : error?.code === 'EPERM'
            ? 'sandbox-unavailable'
            : 'browser-or-fixture';
  } finally {
    for (const t of timers) clearTimeout(t);
    await browser?.close().catch(() => {});
    await judges?.close().catch(() => {});
    await mkdir('artifacts', { recursive: true });
    for (const [name, b] of images) await writeFile('artifacts/' + name, b);
    const report = {
      passed,
      stage,
      failureCategory,
      checks,
      diagnostic,
      external,
      browserErrors: errors,
      captures: [...images.keys()],
    };
    const output = JSON.stringify(report);
    assert.ok(Buffer.byteLength(output) <= 65536);
    await writeFile('artifacts/readiness-a11y-browser-results.json', output);
  }
  if (!passed) process.exitCode = 1;
}

// Explicit LOCAL HTTPS + actual browser/WSS fixture; import-safe for transport tests.
const run = promisify(execFile);
const ORIGIN = 'https://localhost:5191';
const DUMMY = Buffer.alloc(32, 11).toString('base64url'); // Fixed synthetic fixture, never operator material.
const JS = `window.previewFixture={ready:true,messages:0,closed:0,errors:0};
window.openPreviewFixture=function(){var ws=new WebSocket('wss://localhost:5191/ws/201');
ws.onmessage=function(e){if(e.data==='{"type":"snapshot","fixture":true,"revision":1}')previewFixture.messages++;};
ws.onclose=function(){previewFixture.closed++;};ws.onerror=function(){previewFixture.errors++;};};`;
const APP =
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>LOCAL fixture</title><script src="/fixture.js" defer></script><main><h1>LOCAL synthetic product</h1><p>No provider or game state.</p></main></html>';
function leaked(req) {
  return (
    JSON.stringify(req.headers).includes(DUMMY) || JSON.stringify(req.rawHeaders).includes(DUMMY)
  );
}
export async function privatePreviewFixture({ enabled = true, expiryMs = 60000 } = {}) {
  if (!Number.isInteger(expiryMs) || expiryMs < 100 || expiryMs > 86400000)
    throw Error('Fixture expiry bounds');
  const directory = await mkdtemp(join(tmpdir(), 'raid-private-tls-'));
  let server,
    sockets,
    formMetadata = null;
  const counts = {
    app: 0,
    readBudget: 0,
    snapshot: 0,
    httpSnapshot: 0,
    subscribe: 0,
    activeSubscriptions: 0,
    credentialLeak: 0,
    readOnlyDenied: 0,
    actions: 0,
    provider: 0,
    requests: 0,
  };
  const close = async () => {
    sockets?.close();
    if (server) {
      server.closeAllConnections();
      if (server.listening) await new Promise((r) => server.close(r));
    }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await chmod(directory, 0o700);
    const keyPath = join(directory, 'local.key'),
      certPath = join(directory, 'local.pem');
    await run(
      '/usr/bin/openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=DNS:localhost,IP:127.0.0.1',
        '-keyout',
        keyPath,
        '-out',
        certPath,
      ],
      { timeout: 15000, maxBuffer: 16384 },
    );
    await chmod(keyPath, 0o600);
    const expiresAt = Date.now() + expiryMs;
    const gate = createPrivatePreview({
      P5_PREVIEW_PRIVATE_ENABLED: String(enabled),
      P5_PREVIEW_READ_ONLY: 'true',
      P5_PREVIEW_ACCESS_SHA256: createHash('sha256').update(DUMMY).digest('hex'),
      P5_PREVIEW_ACCESS_EXPIRES_AT: new Date(expiresAt).toISOString(),
    });
    const handler = (req, res) => {
      counts.app++;
      if (leaked(req)) counts.credentialLeak++;
      const headers = {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy':
          "default-src 'none'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      };
      // Mock product's master read-only boundary, not a successful fake action.
      if (req.method !== 'GET') {
        counts.readOnlyDenied++;
        res.writeHead(403, headers);
        res.end('Read-only fixture');
        return;
      }
      if (req.url === '/') {
        res.writeHead(200, { ...headers, 'content-type': 'text/html; charset=utf-8' });
        res.end(APP);
      } else if (req.url === '/fixture.js') {
        res.writeHead(200, { ...headers, 'content-type': 'text/javascript; charset=utf-8' });
        res.end(JS);
      } else if (req.url === '/health' || req.url === '/snapshot') {
        if (req.url === '/snapshot') counts.httpSnapshot++;
        res.writeHead(200, { ...headers, 'content-type': 'application/json' });
        res.end('{"fixture":true}');
      } else {
        res.writeHead(404, headers);
        res.end('Not found');
      }
    };
    server = createServer(
      { key: await readFile(keyPath), cert: await readFile(certPath) },
      (req, res) => {
        counts.requests++;
        if (req.method === 'POST' && req.url === '/_preview/access') {
          const origin = req.headers.origin,
            site = req.headers['sec-fetch-site'];
          formMetadata = {
            originCategory:
              origin === undefined
                ? 'missing'
                : origin === 'null'
                  ? 'null'
                  : origin === ORIGIN
                    ? 'same'
                    : 'other',
            hostMatchesFixture: req.headers.host === 'localhost:5191',
            secFetchSiteCategory: ['same-origin', 'same-site', 'cross-site', 'none'].includes(site)
              ? site
              : site === undefined
                ? 'missing'
                : 'other',
            contentTypeExact: req.headers['content-type'] === 'application/x-www-form-urlencoded',
            contentLength: /^\d{1,6}$/.test(req.headers['content-length'] ?? '')
              ? Number(req.headers['content-length'])
              : -1,
          };
        }
        if (counts.requests > 128) {
          res.writeHead(429, { connection: 'close' });
          res.end();
          return;
        }
        return gate.wrapHandler(handler)(req, res);
      },
    );
    server.requestTimeout = 15000;
    server.headersTimeout = 10000;
    const wire = gate.upgradeServer(server),
      wrappers = new Map();
    // Measurement inside admission, before the unchanged actual WS adapter.
    const inspected = {
      on(event, listener) {
        const wrapped = (req, ...args) => {
          if (leaked(req)) counts.credentialLeak++;
          return listener(req, ...args);
        };
        wrappers.set(listener, wrapped);
        wire.on(event, wrapped);
      },
      off(event, listener) {
        wire.off(event, wrappers.get(listener));
        wrappers.delete(listener);
      },
    };
    sockets = attachOverlaySockets(
      inspected,
      {
        channel: '201',
        async snapshot() {
          counts.snapshot++;
          return { type: 'snapshot', fixture: true, revision: 1 };
        },
        subscribe() {
          counts.subscribe++;
          counts.activeSubscriptions++;
          return () => {
            counts.activeSubscriptions--;
          };
        },
      },
      {
        origins: [ORIGIN],
        maxClients: 2,
        allowRead: () => {
          counts.readBudget++;
          return true;
        },
      },
    );
    await new Promise((r, j) => {
      server.once('error', j);
      server.listen(5191, '127.0.0.1', r);
    });
    return {
      origin: ORIGIN,
      key: DUMMY,
      expiresAt,
      stats: () => ({ ...counts, clients: sockets.clients.size }),
      formMetadata: () => formMetadata && { ...formMetadata },
      close,
    };
  } catch {
    await close();
    throw Error('Private fixture startup failed');
  }
}
export function privateFixtureRequest(path, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0,
      settled = false;
    const chunks = [];
    if (typeof path !== 'string' || !path.startsWith('/') || path.length > 2048) {
      reject(Error('Fixture request path rejected'));
      return;
    }
    const req = httpsRequest(
      {
        hostname: 'localhost',
        port: 5191,
        path,
        method,
        headers,
        rejectUnauthorized: false,
        agent: false,
      },
      (res) => {
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > 65536) {
            req.destroy();
            if (!settled) {
              settled = true;
              reject(Error('Fixture response bound'));
            }
          } else chunks.push(chunk);
        });
        res.on('error', () => {
          if (!settled) {
            settled = true;
            reject(Error('Fixture HTTPS response failed'));
          }
        });
        res.on('end', () => {
          if (!settled) {
            settled = true;
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks, size).toString('utf8'),
            });
          }
        });
      },
    );
    req.setTimeout(5000, () => req.destroy());
    req.on('error', () => {
      if (!settled) {
        settled = true;
        reject(Error('Fixture HTTPS request failed'));
      }
    });
    req.end(body);
  });
}
async function deniedSocket() {
  return new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket('wss://localhost:5191/ws/201', {
      origin: ORIGIN,
      rejectUnauthorized: false,
      handshakeTimeout: 5000,
    });
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.terminate();
        reject(Error('Fixture WS denial deadline'));
      }
    }, 6000);
    ws.on('unexpected-response', (req, res) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        res.on('error', () => {});
        res.resume();
        req.destroy();
        ws.terminate();
        resolve(res.statusCode);
      }
    });
    ws.on('open', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        ws.terminate();
        reject(Error('Unexpected unauthenticated WS'));
      }
    });
    ws.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(Error('Fixture WS handshake failed'));
      }
    });
  });
}
async function runPrivatePreviewBrowser() {
  let fixture,
    browser,
    context,
    page,
    passed = false,
    stage = 'startup',
    failureCategory = null;
  const checks = [],
    diagnostic = { assertionLine: 0 },
    cookieFlags = {};
  let errors = 0,
    forbidden = 0,
    requests = 0,
    downloads = 0;
  try {
    if (!process.getuid?.()) throw Error('Fixture nonroot browser required');
    fixture = await privatePreviewFixture();
    const root = await privateFixtureRequest('/');
    assert.equal(root.status, 200);
    assert.match(root.body, /<main><h1>Private preview/);
    assert.doesNotMatch(root.body, /Twitch|raidrelichq|olsols|<script|<img/);
    for (const path of [
      '/health',
      '/fixture.js',
      '/snapshot',
      '/oauth/keeper/start',
      '/eventsub',
      '/api/journey',
      '/ws/201',
      '/?key=' + DUMMY,
    ])
      assert.equal((await privateFixtureRequest(path)).status, 401);
    assert.equal(await deniedSocket(), 401);
    let stats = fixture.stats();
    for (const name of [
      'app',
      'readBudget',
      'snapshot',
      'subscribe',
      'credentialLeak',
      'provider',
      'actions',
    ])
      assert.equal(stats[name], 0);
    checks.push({
      name: 'Unauthenticated HTTPS assets/API/auth/health and actual WSS denied before product/feed work',
      passed: true,
    });
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch(await localChromiumOptions(chromium));
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      serviceWorkers: 'block',
    });
    const allowed = new Set([
      '/',
      '/_preview/access',
      '/fixture.js',
      '/snapshot',
      '/readonly-action',
      '/favicon.ico',
    ]);
    await context.route('**/*', (route) => {
      const u = new URL(route.request().url());
      requests++;
      const method = route.request().method();
      if (
        requests > 64 ||
        u.origin !== ORIGIN ||
        !allowed.has(u.pathname) ||
        u.search ||
        !(
          method === 'GET' ||
          (method === 'POST' && ['/_preview/access', '/readonly-action'].includes(u.pathname))
        )
      ) {
        forbidden++;
        return route.abort();
      }
      return route.continue();
    });
    page = await context.newPage();
    page.on('pageerror', () => errors++);
    page.on('download', () => downloads++);
    page.on('websocket', (ws) => {
      if (ws.url() !== 'wss://localhost:5191/ws/201') forbidden++;
    });
    stage = 'real-https-form';
    await page.goto(ORIGIN);
    assert.equal(await page.locator('main h1').innerText(), 'Private preview');
    await page.getByLabel('Access code').fill(DUMMY);
    const response = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/_preview/access',
    );
    await page.getByRole('button', { name: 'Enter private preview', exact: true }).click();
    diagnostic.formHTTPStatus = (await response).status();
    diagnostic.formRequest = fixture.formMetadata();
    assert.equal(diagnostic.formHTTPStatus, 303);
    await page.waitForFunction(() => window.previewFixture?.ready === true);
    assert.equal(page.url(), ORIGIN + '/');
    const cookies = await context.cookies(ORIGIN),
      cookie = cookies.find((c) => c.name === '__Host-raid-preview');
    assert.ok(cookie);
    if (cookie.value !== DUMMY) throw Error('Fixture cookie binding');
    Object.assign(cookieFlags, {
      secure: Number(cookie.secure),
      httpOnly: Number(cookie.httpOnly),
      sameSiteStrict: Number(cookie.sameSite === 'Strict'),
      hostOnly: Number(cookie.domain === 'localhost'),
      rootPath: Number(cookie.path === '/'),
      withinExpiry: Number(cookie.expires * 1000 <= fixture.expiresAt + 1000),
    });
    assert.ok(Object.values(cookieFlags).every((v) => v === 1));
    const privacy = await page.evaluate(
      (key) => ({
        url: location.href.includes(key),
        referrer: document.referrer.includes(key),
        storage: localStorage.length + sessionStorage.length,
        cookieVisible: document.cookie.includes('__Host-raid-preview'),
        global: Object.values(Object.getOwnPropertyDescriptors(window)).some(
          (d) => typeof d.value === 'string' && d.value.includes(key),
        ),
      }),
      DUMMY,
    );
    assert.deepEqual(privacy, {
      url: false,
      referrer: false,
      storage: 0,
      cookieVisible: false,
      global: false,
    });
    await page.evaluate(() => window.openPreviewFixture());
    await page.waitForFunction(() => window.previewFixture.messages === 1);
    assert.equal(await page.evaluate(() => window.previewFixture.errors), 0);
    assert.equal((await page.request.get(ORIGIN + '/snapshot')).status(), 200);
    assert.equal((await page.request.post(ORIGIN + '/readonly-action')).status(), 403);
    stats = fixture.stats();
    assert.equal(stats.snapshot, 1);
    assert.equal(stats.httpSnapshot, 1);
    assert.equal(stats.subscribe, 1);
    assert.equal(stats.clients, 1);
    assert.equal(stats.credentialLeak, 0);
    assert.equal(stats.actions, 0);
    assert.equal(stats.provider, 0);
    assert.equal(stats.readOnlyDenied, 1);
    checks.push({
      name: 'Actual HTTPS form303, Secure HttpOnly host cookie, native WSS fixture projection and retained read-only denial',
      passed: true,
    });
    await page.close();
    await context.close();
    context = null;
    await fixture.close();
    fixture = null;
    // Create deadline only AFTER browser warmup. Real elapsed, no fake clock or input keepalive.
    stage = 'absolute-expiry';
    fixture = await privatePreviewFixture({ expiryMs: 12000 });
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      serviceWorkers: 'block',
    });
    await context.route('**/*', (r) => {
      const u = new URL(r.request().url());
      requests++;
      if (
        requests > 64 ||
        u.origin !== ORIGIN ||
        !['/', '/_preview/access', '/fixture.js', '/favicon.ico'].includes(u.pathname) ||
        u.search ||
        !(
          r.request().method() === 'GET' ||
          (r.request().method() === 'POST' && u.pathname === '/_preview/access')
        )
      ) {
        forbidden++;
        return r.abort();
      }
      return r.continue();
    });
    page = await context.newPage();
    page.on('pageerror', () => errors++);
    page.on('download', () => downloads++);
    await page.goto(ORIGIN);
    await page.getByLabel('Access code').fill(DUMMY);
    const expiryResponse = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/_preview/access',
    );
    await page.getByRole('button', { name: 'Enter private preview', exact: true }).click();
    diagnostic.expiryFormHTTPStatus = (await expiryResponse).status();
    diagnostic.expiryFormRequest = fixture.formMetadata();
    assert.equal(diagnostic.expiryFormHTTPStatus, 303);
    await page.waitForFunction(() => window.previewFixture?.ready === true);
    await page.evaluate(() => window.openPreviewFixture());
    await page.waitForFunction(() => window.previewFixture.messages === 1);
    const before = performance.now();
    await page.waitForFunction(() => window.previewFixture.closed === 1, undefined, {
      timeout: 15000,
    });
    diagnostic.expiryWaitMs = Math.round(performance.now() - before);
    assert.ok(Date.now() >= fixture.expiresAt);
    diagnostic.expectedExpirySocketErrors = await page.evaluate(() => window.previewFixture.errors);
    assert.ok(diagnostic.expectedExpirySocketErrors <= 1);
    assert.equal(
      (await privateFixtureRequest('/health', { headers: { 'X-Preview-Access': DUMMY } })).status,
      401,
    );
    stats = fixture.stats();
    assert.equal(stats.clients, 0);
    assert.equal(stats.credentialLeak, 0);
    assert.equal(stats.actions, 0);
    assert.equal(stats.provider, 0);
    checks.push({
      name: 'Real short absolute expiry destroys admitted WSS and rejects subsequent HTTPS; not an hour/physical OBS proof',
      passed: true,
    });
    assert.equal(errors, 0);
    assert.equal(forbidden, 0);
    assert.equal(downloads, 0);
    passed = true;
  } catch (error) {
    failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(error?.name)
      ? error.name
      : 'fixture-or-browser';
    diagnostic.assertionLine = Number(
      /browser-smoke-readiness-a11y[.]js:(\d+)/.exec(error?.stack ?? '')?.[1] ?? 0,
    );
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await fixture?.close().catch(() => {});
    await mkdir('artifacts', { recursive: true });
    const report = JSON.stringify({
      passed,
      stage,
      failureCategory,
      checks,
      diagnostic,
      cookieFlags,
      errors,
      forbidden,
      downloads,
      requests,
      browserClockUsed: false,
      physicalOBS: false,
    });
    assert.ok(Buffer.byteLength(report) <= 65536);
    await writeFile('artifacts/private-preview-browser-results.json', report + '\n');
  }
  if (!passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== '--private-only')) {
    throw new Error('Unsupported readiness QA arguments');
  }
  if (args.length === 0) await runReadinessA11y();
  await runPrivatePreviewBrowser();
}
