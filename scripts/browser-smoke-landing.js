// LOCAL mock-only real HTTPS/WSS roundtrip: no actual provider, controls or chat.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
import { ackKey } from '../src/claim-ack.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
const origin = 'https://localhost:5191';
let browser,
  server,
  tls,
  sockets,
  stage = 'startup',
  failed = false,
  failureCategory = null,
  sourceAssertionLine = 0,
  connectionCounts,
  storeKind;
const checks = [];
try {
  tls = await createLocalTLS();
  const { chromium } = await import('playwright');
  browser = await chromium.launch({
    executablePath: '/snap/bin/chromium',
    chromiumSandbox: true,
    headless: true,
  });
  for (const kind of ['memory', 'firestore']) {
    storeKind = kind;
    const f = await pilotFixture(kind, { origin });
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    async function complete(from, to) {
      await f.control(from, `send:${to}`);
      f.advance();
      await f.raid(from, to, 2);
      await f.chat(from, from, '!offer');
      await f.chat(to, to, '!accept');
    }
    await complete(HOME, OTHER);
    f.advance();
    await complete(OTHER, HOME);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 2);
    server = createServer(tls.options, f.runtime.handler);
    sockets = attachOverlaySockets(server, f.runtime.overlayFeeds, {
      origins: [origin],
      allowRead: f.runtime.allowPublicRead,
    });
    await new Promise((r, j) => {
      server.once('error', j);
      server.listen(5191, '127.0.0.1', r);
    });
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 720 },
      serviceWorkers: 'block',
    });
    await context.route('**/*', (r) =>
      new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
    );
    await context.routeWebSocket('**/*', (r) =>
      new URL(r.url()).origin === origin.replace('https:', 'wss:')
        ? r.connectToServer()
        : r.close(),
    );
    await context.addInitScript(() => {
      const Native = window.WebSocket,
        counters = { created: 0, opened: 0, closed: 0 };
      window.__landingSockets = counters;
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          counters.created++;
          this.addEventListener('open', () => counters.opened++);
          this.addEventListener('close', () => counters.closed++);
        }
      };
      addEventListener(
        'DOMContentLoaded',
        () => {
          const p = document.createElement('p');
          p.textContent = 'SIMULATOR · LOCAL MOCK RAID ONLY';
          p.style.cssText =
            'position:fixed;top:0;left:0;margin:0;z-index:30;color:#ffe3a6;background:#101d30;font:11px system-ui';
          document.body.prepend(p);
          document.title = 'SIMULATOR landing';
        },
        { once: true },
      );
    });
    const page = await context.newPage();
    stage = 'previous-holder';
    // Legacy full-composition contract; default-card coverage remains in full-overlay.
    await page.goto(`${origin}/overlay/${OTHER}?layout=full`);
    await page.bringToFront();
    await page
      .locator('#status')
      .filter({ hasText: 'The relic has moved on to @raidrelichq' })
      .waitFor();
    await page.waitForFunction(() =>
      document.querySelector('.archive').classList.contains('webgl-relic'),
    );
    stage = 'accepted-only';
    await f.control(HOME, `send:${OTHER}`);
    await f.chat(HOME, HOME, '!offer');
    await page.waitForFunction(() => !document.querySelector('#claim-meter').hidden);
    assert.equal(await page.locator('.p3-comet').isVisible(), false);
    assert.equal((await f.runtime.overlayFeeds[OTHER].snapshot()).handoff, null);
    f.advance(95000);
    const receipt = f.now();
    stage = 'verified-arrival';
    await f.raid(HOME, OTHER, 1);
    await page.waitForFunction(
      () =>
        document.querySelector('.archive').dataset.phase === 'streak' &&
        !document.querySelector('.p3-comet').hidden,
    );
    await page.locator('#status').filter({ hasText: 'The relic arrives' }).waitFor();
    assert(await page.locator('#simulator').isVisible());
    const proof = await page.evaluate(async () => {
      const s = await (await fetch('/api/overlay/1591806023')).json();
      return {
        status: s.status,
        movedAbsent: s.movedToLogin === undefined,
        window: s.handoff.endsAt - s.handoff.claimStartedAt,
        clock: s.handoff.clockPolicy,
        started: s.handoff.startedAt,
        rings: s.lineageRings,
        approved: s.approvedCount,
      };
    });
    assert.deepEqual(proof, {
      status: 'incoming',
      movedAbsent: true,
      window: 180000,
      clock: 'landing-v2',
      started: receipt,
      rings: 2,
      approved: 0,
    });
    for (let i = 0; i < 3; i++) {
      f.advance();
      await f.chat(HOME, HOME, '!relic resume');
    }
    await page.waitForTimeout(250);
    connectionCounts = await page.evaluate(() => window.__landingSockets);
    assert.deepEqual(connectionCounts, { created: 1, opened: 1, closed: 0 });
    assert.equal(
      await page.locator('body').evaluate((n) => n.classList.contains('disconnected')),
      false,
    );
    checks.push({
      name: `SIMULATOR ${kind} two-hop former holder receives full180s verified zero-mark arrival over one stable WSS`,
      passed: true,
    });
    stage = 'late-vote-quiet-suppression';
    const end = (await f.runtime.state.getKeeperRegistry()).pendingHop.endsAt;
    const posts = () => f.calls.filter((c) => c.url.endsWith('/chat/messages'));
    const n = posts().length;
    f.advance(end - f.now() + 27000);
    await f.chat(OTHER, OTHER, '!accept', { messageId: 'landing-closed-one' });
    assert.equal(posts().length, n);
    f.advance(44000);
    await f.chat(OTHER, OTHER, '!accept', { messageId: 'landing-closed-two' });
    assert.equal(posts().length, n);
    await f.chat(OTHER, OTHER, '!accept', { messageId: 'landing-closed-one' });
    assert.equal(posts().length, n);
    await f.chat(OTHER, OTHER, '!accept', { messageId: 'landing-closed-two' });
    assert.equal(posts().length, n);
    const rows = (await f.runtime.state.getPrivateClaimAcks(OTHER)).rows;
    for (const messageId of ['landing-closed-one', 'landing-closed-two']) {
      const matching = rows.filter(
        (r) => r.key === ackKey({ broadcasterId: OTHER, chatterId: OTHER, messageId }),
      );
      assert.equal(matching.length, 1);
      // ackDocument retains only the bounded ignored anti-replay tombstone;
      // no queued/sent delivery, private message or completion proof exists.
      assert.equal(matching[0].status, 'ignored');
      assert.deepEqual(Object.keys(matching[0]).sort(), [
        'expiresAt',
        'key',
        'requestActor',
        'status',
      ]);
    }
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 2);
    connectionCounts = await page.evaluate(() => window.__landingSockets);
    assert.deepEqual(connectionCounts, { created: 1, opened: 1, closed: 0 });
    checks.push({
      name: `SIMULATOR ${kind} two late votes and both exact replays remain quiet with ignored tombstones and no transfer/ring`,
      passed: true,
    });
    await context.close();
    sockets.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    server = null;
  }
} catch (error) {
  failed = true;
  failureCategory =
    error?.name === 'AssertionError'
      ? 'assertion'
      : error?.name === 'TimeoutError'
        ? 'timeout'
        : error?.name === 'TypeError'
          ? 'type-error'
          : 'browser-or-fixture';
  sourceAssertionLine = Number(
    /browser-smoke-landing[.]js:(\d+)/.exec(error?.stack ?? '')?.[1] ?? 0,
  );
} finally {
  await browser?.close().catch(() => {});
  sockets?.close();
  server?.closeAllConnections();
  if (server?.listening) await new Promise((r) => server.close(r));
  await tls?.cleanup();
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/landing-browser-results.json',
    JSON.stringify(
      {
        simulator: true,
        passed: !failed,
        stage,
        storeKind,
        failureCategory,
        sourceAssertionLine,
        connectionCounts,
        checks,
      },
      null,
      2,
    ),
  );
}
if (failed) process.exitCode = 1;
