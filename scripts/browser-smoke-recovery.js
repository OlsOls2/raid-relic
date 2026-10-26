// Parent-run fixed-loopback recovery gate: synthetic OAuth/events only; no screenshots.
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
const origin = 'https://localhost:5191';
let tls,
  server,
  sockets,
  browser,
  stage = 'startup',
  failure;
const checks = [];
try {
  const f = await pilotFixture('memory', { origin });
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
  const { chromium } = await import('playwright');
  browser = await chromium.launch({
    executablePath: '/snap/bin/chromium',
    chromiumSandbox: true,
    headless: true,
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, reducedMotion: 'reduce' });
  await context.route('**/*', (r) =>
    new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
  );
  await context.routeWebSocket('**/*', (r) =>
    new URL(r.url()).origin === origin.replace('https:', 'wss:') ? r.connectToServer() : r.close(),
  );
  await context.addCookies(
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
  const page = await context.newPage();
  let delayed = true;
  await page.route(`**/control/${HOME}/status`, async (route) => {
    if (!delayed) return route.continue();
    delayed = false;
    await new Promise((resolve) => setTimeout(resolve, 9000));
    try {
      await route.fulfill({
        status: 200,
        json: {
          keeperId: HOME,
          csrf: 'obsolete-synthetic-response',
          actions: [],
          pilot: { account: 'obsolete' },
        },
      });
    } catch {
      /* Expected aborted obsolete read. */
    }
  });
  stage = 'bounded-control-read';
  await page.goto(`${origin}/control/${HOME}`);
  await page.locator('#result').filter({ hasText: 'Status timed out' }).waitFor();
  if (await page.locator('#raid button').count()) throw Error('stale Send enabled');
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await page.locator('#result').filter({ hasText: 'Status refreshed' }).waitFor();
  await page.waitForTimeout(1100);
  if ((await page.locator('#ledger').textContent()).includes('obsolete'))
    throw Error('obsolete read overwrote status');
  let posts = 0;
  await page.route(`**/control/${HOME}`, (r) => {
    if (r.request().method() === 'POST') {
      posts++;
      return r.abort();
    }
    return r.continue();
  });
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.locator('#result').filter({ hasText: 'Request outcome unavailable' }).waitFor();
  if (posts !== 1 || (await page.locator('#raid button').count()))
    throw Error('POST retried or stale actions retained');
  checks.push({
    name: 'SIMULATOR bounded private read, obsolete-response suppression, explicit Retry and no ambiguous POST retry',
    passed: true,
  });
  stage = 'socket-recovery';
  const overlay = await context.newPage();
  await overlay.goto(`${origin}/overlay/${HOME}`);
  await overlay.bringToFront();
  await overlay
    .locator('#compact-count')
    .filter({ hasText: 'Charge 0/160' })
    .waitFor({ state: 'attached' });
  await overlay.evaluate(() => {
    window.__recoveryPage = 17;
  });
  for (const ws of sockets.clients) ws.terminate();
  await f.chat(HOME, '811', '!mark moon');
  await f.chat(HOME, HOME, '!relic approve m1');
  await overlay.evaluate(() => window.dispatchEvent(new Event('online')));
  await overlay.locator('.rune').waitFor({ state: 'visible' });
  if ((await overlay.evaluate(() => window.__recoveryPage)) !== 17) throw Error('page reloaded');
  for (const ws of sockets.clients) ws.terminate();
  await f.chat(HOME, '811', '!relic forgetme');
  await overlay.waitForFunction(() => document.querySelectorAll('.rune').length === 0);
  await overlay.evaluate(() => window.dispatchEvent(new Event('online')));
  await overlay.waitForFunction(
    () =>
      !document.body.classList.contains('disconnected') &&
      document.querySelector('#count').textContent.includes('0 approved'),
  );
  if (
    (await overlay.evaluate(() => window.__recoveryPage)) !== 17 ||
    (await overlay.locator('.rune').count())
  )
    throw Error('private rune resurrected');
  checks.push({
    name: 'SIMULATOR real local WSS close/reconnect without reload, fresh approved snapshot and offline erasure',
    passed: true,
  });
  stage = 'complete';
} catch (e) {
  failure = ['EPERM', 'ENOENT', 'EADDRINUSE'].includes(e?.code)
    ? e.code
    : e?.name === 'TimeoutError'
      ? 'timeout'
      : 'assertion-or-browser';
} finally {
  await browser?.close().catch(() => {});
  sockets?.close();
  if (server?.listening) await new Promise((r) => server.close(r));
  await tls?.cleanup();
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/recovery-browser-results.json',
    JSON.stringify(
      { simulator: true, stage, passed: !failure, failure: failure ?? null, checks, captures: [] },
      null,
      2,
    ),
  );
}
if (failure) process.exitCode = 1;
