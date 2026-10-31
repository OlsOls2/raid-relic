import { capturePage } from '../test-support/capture-page.js';
// Optional host QA: local mocked OAuth/Helix only; never follows Twitch URLs.
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
const origin = 'https://localhost:5191';
const f = await pilotFixture('memory', { origin });
let server, sockets, localTLS;
const captures = new Map();
const captureCoverage = [];
const capture = (page, name) => capturePage(page, name, captures, captureCoverage);
let browser, failure, activePage;
let frontendPageErrorCount = 0;
let diagnostic = null;
let phase = 'local startup';
let diagnostics;
let lastPostStatus;
async function press(page, id, label, expected) {
  phase = label;
  const ownPath = `/control/${id}`;
  const post = page.waitForResponse(
    (r) => new URL(r.url()).pathname === ownPath && r.request().method() === 'POST',
  );
  const refreshed = page
    .waitForResponse(
      (r) => new URL(r.url()).pathname === `${ownPath}/status` && r.request().method() === 'GET',
    )
    .catch(() => null);
  await page.evaluate(() => {
    window.__pilotPostProof = null;
  });
  if (label.startsWith('Send Off to ')) {
    phase = 'trusted-pointer-across-status-render';
    const pattern = `**/control/${id}/status`;
    let releaseRead;
    const heldRead = new Promise((resolve) => {
      releaseRead = resolve;
    });
    const routeRead = async (route) => {
      await heldRead;
      await route.continue();
    };
    await page.route(pattern, routeRead);
    const nextRead = page.waitForRequest(
      (request) => new URL(request.url()).pathname === ownPath + '/status',
    );
    const readResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === ownPath + '/status',
    );
    const generation = await page.locator('body').getAttribute('data-control-read-generation');
    await page.locator('#refresh').click();
    await nextRead;
    const button = await page.getByRole('button', { name: label, exact: true }).elementHandle();
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    if (!box) throw Error('Send button unavailable');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    releaseRead();
    if ((await readResponse).status() !== 200) throw Error('Own status failed');
    await page.waitForFunction(
      (before) => Number(document.body.dataset.controlReadGeneration) > Number(before),
      generation,
    );
    if (
      !(await button.evaluate(
        (node) =>
          node === document.querySelector('#raid button.send-off') &&
          node.isConnected &&
          !node.disabled,
      ))
    )
      throw Error('Polling replaced or disabled pressed Send Off');
    await page.unroute(pattern, routeRead);
    await page.mouse.up();
  } else await page.getByRole('button', { name: label, exact: true }).click();
  phase = `${label}: own-response`;
  const response = await post;
  await page.waitForFunction(() => Boolean(window.__pilotPostProof));
  const result = await page.evaluate(() => window.__pilotPostProof);
  if (result.http !== response.status()) throw Error('Response proof mismatch');
  lastPostStatus = {
    http: response.status(),
    status: [
      'accepted',
      'processed',
      'reconciled',
      'blocked',
      'busy',
      'failed',
      'unknown',
      'rejected',
      'rejected-preflight',
      'idle-or-reconcile-only',
    ].includes(result.status)
      ? result.status
      : 'unexpected',
  };
  if (response.status() !== 200 || result.status !== expected)
    throw new Error('Owner POST returned unexpected status');
  phase = `${label}: status-refresh`;
  if (!(await refreshed)) throw new Error('Owner status refresh missing');
  await page.waitForFunction(() => !document.getElementById('refresh').disabled);
  phase = `${label}: result-dom`;
  await page
    .locator('#result')
    .filter({
      hasText:
        expected === 'processed'
          ? /processed|Keeper choice saved/i
          : expected === 'reconciled'
            ? /reconciled/i
            : /accepted/i,
    })
    .waitFor();
  if (expected === 'accepted') {
    if (
      !(await page.locator('#send-result').isVisible()) ||
      (await page.locator('#send-result').textContent()) !==
        (await page.locator('#result').textContent())
    )
      throw new Error('Adjacent dispatch result mismatch');
  }
  if (expected === 'reconciled' && result.ready !== true)
    throw new Error('Mocked subscriptions not enabled');
  checks.push({ name: label, status: result.status, passed: true });
}
const checks = [];
try {
  phase = 'ephemeral local HTTPS fixture';
  localTLS = await createLocalTLS();
  server = createServer(localTLS.options, f.runtime.handler);
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
    args: ['--disable-background-networking'],
  });
  const context = await browser.newContext({
    viewport: { width: 900, height: 850 },
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  // Record only closed properties from the SAME page POST response, before
  // boundedResponse consumes its stream. No raw body, cookies or CSRF retained.
  await context.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await nativeFetch(...args);
      if (
        args[1]?.method === 'POST' &&
        new URL(String(args[0]), location.href).pathname === location.pathname
      ) {
        window.__pilotPostProof = response
          .clone()
          .json()
          .then(
            (value) => ({
              http: response.status,
              status: [
                'accepted',
                'processed',
                'reconciled',
                'blocked',
                'busy',
                'failed',
                'unknown',
                'rejected',
                'rejected-preflight',
                'idle-or-reconcile-only',
              ].includes(value.status)
                ? value.status
                : 'unexpected',
              ready: value.ready === true,
            }),
            () => ({ http: response.status, status: 'invalid-json', ready: false }),
          );
      }
      return response;
    };
  });
  // Legacy SVG-fallback contract; default real WebGL is exercised independently.
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /^webgl/.test(type) ? null : original.call(this, type, ...args);
    };
  });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  if (typeof context.routeWebSocket !== 'function')
    throw new Error('WebSocket routing unavailable');
  await context.routeWebSocket('**/*', (route) => {
    if (new URL(route.url()).origin === 'wss://localhost:5191') route.connectToServer();
    else route.close();
  });
  for (const id of [BOT, HOME, OTHER]) {
    const start = await context.request.get(
      `${origin}${id === BOT ? '/oauth/bot/start' : `/oauth/keeper/${id}/start`}`,
      { maxRedirects: 0 },
    );
    const state = new URL(start.headers().location).searchParams.get('state'); // External URL parsed, never fetched.
    const result = await context.request.get(`${origin}/auth/callback?state=${state}&code=${id}`, {
      maxRedirects: 0,
    });
    if (result.status() !== 200) throw new Error('Mock consent failed');
  }
  const cookies = await context.cookies(origin);
  for (const id of [HOME, OTHER]) {
    if (
      !cookies.some(
        (c) =>
          c.name === `__Host-rr_control_${id}` &&
          c.secure &&
          c.httpOnly &&
          c.sameSite === 'Lax' &&
          c.path === '/',
      )
    )
      throw new Error('Secure Keeper cookie missing');
  }
  checks.push({ name: 'Local HTTPS and Secure __Host Keeper cookies', passed: true });
  const page = await context.newPage();
  activePage = page;
  page.on('pageerror', () => frontendPageErrorCount++);
  for (const id of [HOME, OTHER]) {
    await page.goto(`${origin}/control/${id}`);
    await page.getByRole('button', { name: 'Set up channel', exact: true }).waitFor();
    if (await page.locator('#simulator').isHidden()) throw new Error('Simulator label missing');
    await press(page, id, 'Set up channel', 'reconciled');
    await press(page, id, 'Opt in this channel', 'processed');
    phase = 'capture-control';
    await capture(page, `pilot-control-${id}`);
    phase = 'control-capture-complete';
    f.advance();
  }
  await f.chat(HOME, HOME, '!mark moon');
  await f.chat(HOME, HOME, '!relic approve m1');
  await page.goto(`${origin}/control/${HOME}`);
  await page.getByRole('button', { name: 'Send Off to olsols2', exact: true }).waitFor();
  page.once('dialog', (dialog) => dialog.accept());
  await press(page, HOME, 'Send Off to olsols2', 'accepted');
  if (
    f.calls.filter(
      (call) => new URL(call.url).pathname === '/helix/raids' && call.method === 'POST',
    ).length !== 1
  )
    throw new Error('Expected one mocked raid request');
  if (
    (await f.runtime.state.getKeeperRegistry()).holderId !== HOME ||
    (await f.runtime.state.getPublicJourney()).rings !== 0 ||
    (await f.runtime.overlayFeeds[OTHER].snapshot()).marks.length !== 0
  )
    throw new Error('API acceptance created travel/preview');
  f.advance();
  await f.raid();
  await page.setViewportSize({ width: 160, height: 160 });
  await page.goto(`${origin}/overlay/${OTHER}?corner=1`);
  await page.locator('#compact-status').filter({ hasText: 'Incoming' }).waitFor();
  await page.locator('.rune').first().waitFor();
  if ((await f.runtime.state.getKeeperRegistry()).holderId !== HOME)
    throw new Error('Preview prematurely transferred ownership');
  phase = 'capture-incoming-preview';
  await capture(page, 'pilot-incoming-preview');
  phase = 'incoming-capture-complete';
  checks.push({
    name: 'Verified fake raid preview before claims; API acceptance is not travel',
    passed: true,
  });
  await f.chat(HOME, HOME, '!offer');
  await f.chat(OTHER, OTHER, '!accept');
  for (const id of [HOME, OTHER]) {
    await page.goto(`${origin}/overlay/${id}?corner=1`);
    await page.setViewportSize({ width: 160, height: 160 });
    await page.locator('#compact-count').filter({ hasText: 'Rings 1' }).waitFor();
    if (await page.locator('#simulator').isHidden())
      throw new Error('Overlay simulator label missing');
    phase = 'capture-overlay';
    await capture(page, `pilot-overlay-${id}`);
    phase = 'overlay-capture-complete';
  }
  if ((await f.runtime.state.getKeeperRegistry()).holderId !== OTHER)
    throw new Error('Mock claim did not transfer');
  checks.push({
    name: 'Two mocked consents, own controls, single mocked raid, claim and both overlays',
    passed: true,
  });
  phase = 'status-error-expiry-recovery';
  await page.setViewportSize({ width: 1280, height: 900 });
  const errorPattern = `**/control/${OTHER}/status`;
  const unavailable = (route) =>
    route.fulfill({ status: 503, json: { error: 'Status unavailable' } });
  await page.route(errorPattern, unavailable);
  await page.goto(`${origin}/control/${OTHER}`);
  await page.locator('#result').filter({ hasText: 'Status unavailable or invalid' }).waitFor();
  if (await page.locator('#first-keep').isEnabled()) throw Error('Failed status enabled action');
  await page.unroute(errorPattern, unavailable);
  await page.locator('#refresh').click();
  await page.locator('#result').filter({ hasText: 'Session read.' }).waitFor();
  const beforeExpiryPosts = f.calls.filter(
    (call) => new URL(call.url).pathname === '/helix/raids',
  ).length;
  f.advance(12 * 3600000 + 1);
  await page.locator('#refresh').click();
  await page.locator('#result').filter({ hasText: 'expired or unauthorized' }).waitFor();
  if (await page.locator('#first-keep').isEnabled()) throw Error('Expired session enabled action');
  await f.login(OTHER);
  await context.addCookies([
    {
      name: '__Host-rr_control_' + OTHER,
      value: f.cookies[OTHER].split('=')[1],
      url: origin,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  await page.locator('#refresh').click();
  await page.locator('#result').filter({ hasText: 'Session read.' }).waitFor();
  if (
    f.calls.filter((call) => new URL(call.url).pathname === '/helix/raids').length !==
    beforeExpiryPosts
  )
    throw Error('Recovery retried Raid POST');
  checks.push({
    name: 'Real status503 and expired-session401 clear reading state; fresh mocked consent recovers without repeating Raid POST',
    passed: true,
  });
} catch (error) {
  failure = error;
  try {
    diagnostic = await activePage.evaluate(() => {
      const result = document.getElementById('result')?.textContent ?? '';
      const patterns = [
        ['processed', /processed/i],
        ['choice-saved', /Keeper choice saved/i],
        ['reconciled', /reconciled/i],
        ['status-refreshed', /Status refreshed/i],
        ['status-reading', /Reading your session/i],
        ['status-invalid', /Status unavailable or invalid|Invalid status/i],
        ['outcome-unavailable', /Request outcome unavailable/i],
        [
          'auth-reconnect',
          /expired or unauthorized|authorization failed|Reconnect this matching Keeper/i,
        ],
      ];
      const proof = window.__pilotPostProof;
      const allowed = [
        'accepted',
        'processed',
        'reconciled',
        'blocked',
        'busy',
        'failed',
        'unknown',
        'rejected',
        'rejected-preflight',
        'idle-or-reconcile-only',
      ];
      return {
        resultState: patterns.find(([, pattern]) => pattern.test(result))?.[0] ?? 'other',
        resultLength: Math.min(65536, result.length),
        refreshDisabled: document.getElementById('refresh')?.disabled === true,
        simulatorHidden: document.getElementById('simulator')?.hidden === true,
        actionHttp:
          Number.isInteger(proof?.http) && proof.http >= 100 && proof.http <= 599 ? proof.http : 0,
        actionStatus: allowed.includes(proof?.status) ? proof.status : 'unexpected',
      };
    });
  } catch {
    diagnostic = { resultState: 'unavailable', resultLength: 0 };
  }
  diagnostic.frontendPageErrorCount = Math.min(10000, frontendPageErrorCount);
  diagnostic.errorName = [
    'Error',
    'TypeError',
    'ReferenceError',
    'TimeoutError',
    'TargetClosedError',
  ].includes(error?.name)
    ? error.name
    : 'other';
  // Classify locally; never serialize the provider/runtime message or stack.
  const message = typeof error?.message === 'string' ? error.message : '';
  diagnostic.errorCategory = /capture.*(?:bound|size)|bounded encoded|cumulative PNG|raster/i.test(
    message,
  )
    ? 'capture-size'
    : /capture geometry|tile scroll|document changed|explicit viewport/i.test(message)
      ? 'capture-geometry'
      : /screenshot/i.test(message)
        ? 'screenshot'
        : /target.*closed|page.*closed|browser.*closed/i.test(message)
          ? 'target-closed'
          : /timeout/i.test(message)
            ? 'timeout'
            : /strict mode|strict locator/i.test(message)
              ? 'strict-locator'
              : 'other';

  try {
    diagnostics = {
      tls: { localOnly: true, configured: Boolean(localTLS) },
      lastPostStatus,
      accounts: await Promise.all(
        [HOME, OTHER].map(async (id) => {
          const s = await f.runtime.pilot.status(id);
          return {
            account: s.account,
            online: s.online,
            optedIn: s.optedIn,
            holder: s.holder,
            intent: s.intent,
            readiness: s.bothReadiness,
          };
        }),
      ),
      mockRequests: f.calls
        .slice(-60)
        .map((call) => ({ path: new URL(call.url).pathname, method: call.method ?? 'GET' })),
    };
  } catch {
    diagnostics = { status: 'Diagnostic state unavailable' };
  }
} finally {
  try {
    await mkdir('artifacts', { recursive: true });
    for (const [name, bytes] of captures) await writeFile(`artifacts/${name}.png`, bytes);
    await writeFile(
      'artifacts/pilot-browser-results.json',
      JSON.stringify(
        {
          passed: !failure,
          simulator: true,
          checks,
          captures: [...captures.keys()],
          captureCoverage,
          diagnostics,
          diagnostic,
          failure: failure ? `Pilot browser check failed during ${phase}` : null,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await browser?.close();
    } finally {
      try {
        sockets?.close();
        server?.closeAllConnections();
        if (server?.listening) await new Promise((resolve) => server.close(resolve));
      } finally {
        await localTLS?.cleanup();
      }
    }
  }
}
if (failure)
  throw new Error(
    `Pilot browser check failed during ${phase}; see safe artifacts/pilot-browser-results.json`,
  );
console.log('Local mocked pilot browser check passed; no live Twitch/OBS proof.');
