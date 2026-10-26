import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReview, noDemoIO } from '../test-support/visual-review.js';
let review,
  stage = 'setup',
  passed = false,
  failureCategory = null;
const checks = [];
const diagnostic = {};
let wanderCapture = null;
let forbidden = 0;
try {
  review = await visualReview();
  const { page, context, origin, fixture } = review;
  await noDemoIO(context);
  const allowed = new Set([
    '/demo/wander',
    '/wander-demo.js',
    '/wander-demo-state.js',
    '/wander-demo.css',
    '/growth.js',
    '/demo.css',
    '/fonts.css',
    '/fonts/Cinzel.ttf',
    '/favicon.svg',
    '/crystal.svg',
    '/relic3d.js',
    '/edition-view.js',
    '/editions.js',
    '/cinematic.js',
    '/claim-meter.js',
    '/keeper-network.js',
    '/vendor/three.module.js',
    '/vendor/three.core.js',
    '/edition-crystal/twitchcon-2026.svg',
  ]);
  page.on('request', (r) => {
    if (!allowed.has(new URL(r.url()).pathname)) forbidden++;
  });
  stage = 'static-warning';
  await page.goto(origin + '/demo/wander');
  assert.match(await page.locator('#demo-banner').innerText(), /SIMULATED.*NOT LIVE/);
  await page.getByRole('button', { name: 'Advance to 60h warning', exact: true }).click();
  assert.match(await page.locator('#wander-status').innerText(), /60h.*12 virtual hours/);
  stage = 'typed-move';
  await page.waitForFunction(
    () => Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 0,
  );
  await page.getByRole('button', { name: 'Advance 12h / Wander', exact: true }).click();
  assert.match(
    await page.locator('#wander-holder').innerText(),
    /fixture_seeker.*ring 10.*streak 0/,
  );
  assert.match(await page.locator('#wander-arrival').innerText(), /no raid audience/);
  assert.equal(await page.locator('#wander-path').getAttribute('stroke-dasharray'), '5 9');
  assert.equal(await page.locator('#wander-path').isVisible(), true);
  assert.equal(await page.locator('#wander-move').isDisabled(), true);
  assert.equal(await page.locator('canvas.relic3d').getAttribute('data-growth-ticks'), '1');
  await page.locator('#wander-play').click();
  assert.match(await page.locator('#wander-holder').innerText(), /ring 10/);
  checks.push({
    name: 'Virtual 60h warning then 72h typed Wander, no quorum/audience and one growth ring',
    passed: true,
  });
  stage = 'wander-recording-capture';
  assert.ok(Object.values(await page.evaluate(() => window.__demoIO)).every((n) => n === 0));
  assert.equal(fixture.calls.length, 0);
  assert.equal(forbidden, 0);
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  if (process.env.GROWTH_CAPTURE === '1') {
    const viewport = page.viewportSize();
    assert.ok(viewport.width * viewport.height * 4 <= 4 * 1024 * 1024);
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    assert.equal(await page.locator('#demo-banner').isVisible(), true);
    wanderCapture = await page.screenshot({ type: 'png' });
    assert.ok(wanderCapture.length <= 524288);
  }
  stage = 'responsive-reset';
  for (const width of [320, 390, 1280]) {
    stage = 'wander-width';
    await page.setViewportSize({ width, height: 844 });
    Object.assign(
      diagnostic,
      await page.evaluate(() => ({
        viewportWidth: innerWidth,
        docScrollWidth: document.documentElement.scrollWidth,
        sourceEnum: 1,
      })),
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  stage = 'wander-reset';
  await page.locator('#wander-reset').click();
  assert.match(
    await page.locator('#wander-holder').innerText(),
    /fixture_keeper.*ring 9.*streak 3/,
  );
  stage = 'wander-reduced-release';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelectorAll('canvas.relic3d').length === 0);
  stage = 'wander-reduced-svg';
  assert.ok(
    await page.locator('.crystal').evaluate(async (i) => {
      await i.decode();
      return i.naturalWidth > 0;
    }),
  );
  assert.equal(await page.locator('.growth-fallback').getAttribute('data-total'), '9');
  stage = 'wander-no-io';
  const io = await page.evaluate(() => window.__demoIO);
  assert.ok(Object.values(io).every((n) => n === 0));
  assert.equal(fixture.calls.length, 0);
  assert.equal(forbidden, 0);
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  checks.push({
    name: 'Static-only requests, no API/SDK/provider/storage calls, reset and reduced decoded fallback',
    passed: true,
  });
  passed = true;
  stage = 'complete';
} catch (e) {
  const line = /browser-smoke-wander-demo[.]js:(\d+)/.exec(e?.stack ?? '');
  if (line) diagnostic.assertionLine = Number(line[1]);
  try {
    const values = await review?.page.evaluate(() => ({
      viewportWidth: innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      canvasCount: document.querySelectorAll('canvas.relic3d').length,
      frames: Number(document.querySelector('canvas.relic3d')?.dataset.frames ?? 0),
      sourceEnum: 1,
    }));
    for (const [key, value] of Object.entries(values ?? {}))
      if (typeof value === 'boolean' || (Number.isFinite(value) && value >= 0 && value <= 1e9))
        diagnostic[key] = value;
  } catch {}
  diagnostic.browserErrors = review?.stats().errors ?? 0;
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(e?.name)
    ? e.name
    : 'browser-or-fixture';
} finally {
  await review?.close();
  await mkdir('artifacts', { recursive: true });
  if (wanderCapture && wanderCapture.length <= 524288)
    await writeFile('artifacts/wander-demo.png', wanderCapture);
  const report = JSON.stringify({ passed, stage, failureCategory, checks, forbidden, diagnostic });
  assert.ok(Buffer.byteLength(report) <= 65536);
  await writeFile('artifacts/wander-demo-browser-results.json', report + '\n');
}
if (!passed) process.exitCode = 1;
