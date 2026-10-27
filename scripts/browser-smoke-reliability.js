// Canonical-origin LOCAL TLS/WSS only. No upstream EventSub WebSocket exists.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReview, growthPixels } from '../test-support/visual-review.js';
import { HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
let review,
  stage = 'setup',
  passed = false,
  failureCategory = null,
  connections = 0;
const checks = [],
  diagnostic = {};
try {
  review = await visualReview({ durable: true });
  const { page, context, fixture: f, origin } = review;
  await context.routeWebSocket('**/*', (route) =>
    new URL(route.url()).origin === origin.replace('https:', 'wss:')
      ? route.connectToServer()
      : route.close(),
  );
  page.on('websocket', () => connections++);
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
    f.calls.filter((c) => new URL(c.url).pathname.endsWith('/raids') && c.method === 'POST').length,
    1,
  );
  assert.ok(connections >= 4 && connections <= 10);
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  checks.push({
    name: 'Fresh post-disconnect erasure removes carried words; decoded reduced SVG, no extra Raid POST or unbounded reconnect loop',
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
