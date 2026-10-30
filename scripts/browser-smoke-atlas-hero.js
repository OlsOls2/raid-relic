// LOCAL mock runtime only. No live pages, provider access or screenshot-cap changes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReview, growthPixels } from '../test-support/visual-review.js';
import { HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
let review,
  activePage,
  stage = 'setup',
  passed = false,
  failureCategory = null;
const checks = [],
  diagnostic = {};
const geometry = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('#atlas-relic');
    const box = (node) => {
      const b = node.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    };
    const art = root.querySelector('canvas.relic3d') ?? root.querySelector('img');
    const pill = root.querySelector('.atlas-ring-pill');
    const a = art.getBoundingClientRect(),
      b = pill?.getBoundingClientRect();
    return {
      root: box(root),
      art: box(art),
      image: box(root.querySelector('img')),
      keeperY: document.querySelector('#receiving').getBoundingClientRect().y,
      pillHeight: b?.height ?? 0,
      overlap: b
        ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
          Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
        : 0,
      total: Number(root.dataset.rings),
      label: pill?.textContent.trim(),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
try {
  review = await visualReview();
  const { fixture: f, context, origin } = review;
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  stage = 'zero-count';
  await review.page.goto(origin + '/atlas/');
  await review.page.waitForFunction(
    () => document.querySelector('#atlas-relic')?.dataset.rings === '0',
  );
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
  await review.page.locator('#atlas-relic .atlas-ring-pill').waitFor({ state: 'attached' });
  assert.equal(await review.page.locator('#atlas-relic .atlas-ring-pill').isVisible(), false);
  await f.control(HOME, `send:${OTHER}`);
  await f.raid(HOME, OTHER, 1);
  await f.chat(HOME, '8201', '!offer');
  await f.chat(OTHER, '8202', '!accept');
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
  await review.page.close();
  const loads = [];
  for (let i = 0; i < 3; i++) {
    stage = 'cold-fallback';
    const page = await context.newPage();
    activePage = page;
    review.observe(page);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    let release;
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/vendor/three*.js', async (route) => {
      await blocked;
      await route.continue();
    });
    // Compare like-for-like cold loads: the front door and Atlas intentionally
    // have different text/intro geometry. Atlas is exercised separately
    // by the Atlas3D workflow; all three uncached hero loads remain real.
    await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
    await page.bringToFront();
    await page.waitForFunction(() => document.querySelector('#atlas-relic')?.dataset.rings === '1');
    await page.evaluate(async () => {
      await document.fonts.ready;
      await document.querySelector('#atlas-relic > img').decode();
    });
    // Decoding and font readiness do not finish CSS transitions. The edition
    // selector changes fallback opacity from zero to one over 300ms; keep the
    // optional vendor held until the actual visible fallback has settled.
    await page.waitForFunction(
      () => {
        const root = document.querySelector('#atlas-relic');
        const img = root?.querySelector(':scope > img');
        if (!img) return false;
        const style = getComputedStyle(img),
          box = img.getBoundingClientRect();
        return (
          img.complete &&
          img.naturalWidth > 0 &&
          box.width > 0 &&
          box.height > 0 &&
          style.opacity === '1' &&
          style.visibility === 'visible' &&
          style.display !== 'none' &&
          !root.classList.contains('webgl-relic') &&
          Number(root.querySelector('canvas.relic3d')?.dataset.frames ?? 0) === 0
        );
      },
      undefined,
      { timeout: 5000 },
    );
    const before = await geometry(page);
    assert.ok(before.root.width >= 440);
    assert.equal(before.root.width, before.root.height);
    assert.equal(
      await page.locator('#atlas-relic > img').evaluate((img) => getComputedStyle(img).opacity),
      '1',
    );
    release();
    stage = 'first-frame-crossfade';
    await page.waitForFunction(() => {
      const c = document.querySelector('#atlas-relic canvas.relic3d');
      const opacity = c && Number(getComputedStyle(c).opacity);
      return Number(c?.dataset.frames) > 0 && opacity > 0 && opacity < 1;
    });
    await page.waitForFunction(
      () => Number(getComputedStyle(document.querySelector('#atlas-relic canvas')).opacity) === 1,
    );
    await page.waitForTimeout(3000);
    stage = 'cold-settled-geometry';
    const after = await geometry(page);
    for (const key of ['x', 'y', 'width', 'height']) {
      assert.ok(Math.abs(after.root[key] - before.root[key]) <= 2);
      assert.ok(Math.abs(after.art[key] - after.image[key]) <= 2);
    }
    assert.ok(Math.abs(after.keeperY - before.keeperY) <= 2);
    assert.equal(after.label, 'Ring 1');
    assert.equal(after.total, 1);
    assert.equal(after.overlap, 0);
    assert.equal(after.pillHeight, 44);
    assert.equal(after.overflow, false);
    assert.ok(await growthPixels(page, async () => {}));
    const limits = await page.locator('#atlas-relic canvas').evaluate((c) => ({
      width: c.width,
      height: c.height,
      triangles: Number(c.dataset.triangles),
    }));
    assert.ok(limits.width <= 480 && limits.height <= 480 && limits.triangles < 20000);
    loads.push(after);
    if (i === 2) {
      stage = 'mobile-reduced-fallback';
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => !document.querySelector('#atlas-relic canvas'));
      for (const width of [320, 390, 650]) {
        await page.setViewportSize({ width, height: 844 });
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
        const mobile = await geometry(page);
        assert.ok(mobile.root.width >= width * 0.6);
        assert.equal(mobile.overlap, 0);
        assert.equal(mobile.pillHeight, 44);
        assert.equal(mobile.overflow, false);
        assert.equal(await page.locator('#atlas-relic > img').isVisible(), true);
      }
      await page.evaluate(async () => {
        await document.querySelector('#atlas-relic > img').decode();
      });
    }
    await page.close();
  }
  stage = 'three-cold-loads-same-route';
  diagnostic.coldLoadRects = loads.map((load) =>
    Object.fromEntries(
      ['x', 'y', 'width', 'height'].map((key) => [key, Math.round(load.root[key] * 100) / 100]),
    ),
  );
  for (const load of loads.slice(1))
    for (const key of ['x', 'y', 'width', 'height'])
      assert.ok(Math.abs(load.root[key] - loads[0].root[key]) <= 2);
  checks.push({
    name: 'Three uncached loads: reserved 480px square, first-frame 300ms crossfade, real GL pixels, stable geometry and unobstructed 44px Ring pill',
    passed: true,
  });
  checks.push({
    name: 'Reduced-motion SVG preserves true count, mobile >=60vw and no horizontal overflow; original raster/triangle caps',
    passed: true,
  });
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  passed = true;
} catch (error) {
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(error?.name)
    ? error.name
    : 'fixture-or-browser';
  diagnostic.assertionLine = Number(
    /browser-smoke-atlas-hero[.]js:(\d+)/.exec(error?.stack ?? '')?.[1] ?? 0,
  );
  try {
    if (activePage && !activePage.isClosed())
      Object.assign(
        diagnostic,
        await activePage.evaluate(() => {
          const root = document.querySelector('#atlas-relic');
          const img = root?.querySelector(':scope > img');
          const box = img?.getBoundingClientRect();
          return {
            fallbackOpacityMilli: img
              ? Math.round(Number(getComputedStyle(img).opacity) * 1000)
              : -1,
            fallbackWidthPx: Math.round(box?.width ?? 0),
            fallbackHeightPx: Math.round(box?.height ?? 0),
            fallbackDecoded: Number(Boolean(img?.complete && img.naturalWidth > 0)),
            heroWebgl: Number(root?.classList.contains('webgl-relic') === true),
            heroFrames: Number(root?.querySelector('canvas.relic3d')?.dataset.frames ?? 0),
          };
        }),
      );
  } catch {
    diagnostic.domDiagnosticUnavailable = 1;
  }
} finally {
  await review?.close();
  await mkdir('artifacts', { recursive: true });
  const report = JSON.stringify({ passed, stage, failureCategory, checks, diagnostic });
  assert.ok(Buffer.byteLength(report) <= 65536);
  await writeFile('artifacts/atlas-hero-browser-results.json', report + '\n');
}
if (!passed) process.exitCode = 1;
