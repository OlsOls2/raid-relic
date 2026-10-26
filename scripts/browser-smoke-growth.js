import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReview, noDemoIO, growthPixels } from '../test-support/visual-review.js';
import { HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
let review,
  stage = 'setup',
  passed = false,
  failureCategory = null;
const checks = [];
const diagnostic = {};
let activePage;
const captures = new Map();
async function capture(page, name) {
  if (process.env.GROWTH_CAPTURE !== '1') return;
  const allowed = [
    'growth-9',
    'growth-17',
    'growth-42',
    'growth-120',
    'growth-corner',
    'growth-reduced',
    'growth-overlay',
    'growth-atlas',
  ];
  assert.ok(allowed.includes(name));
  const v = page.viewportSize();
  assert.ok(v.width * v.height * 4 <= 4 * 1024 * 1024);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  const png = await page.screenshot({ type: 'png' });
  assert.ok(png.length <= 524288);
  captures.set(name, png);
}
async function badgePixels(page, selector, count) {
  await page.locator(selector).scrollIntoViewIfNeeded();
  return page.locator(selector).evaluate(async (svg, expected) => {
    const b = svg.getBoundingClientRect(),
      root = svg.parentElement,
      parent = root.getBoundingClientRect(),
      style = getComputedStyle(svg);
    if (
      svg.dataset.total !== String(expected) ||
      style.display === 'none' ||
      style.visibility !== 'visible' ||
      Number(style.opacity) <= 0 ||
      b.width <= 0 ||
      b.height <= 0 ||
      parent.width <= 0 ||
      parent.height <= 0 ||
      b.left < parent.left - 1 ||
      b.right > parent.right + 1 ||
      b.top < parent.top - 1 ||
      b.bottom > parent.bottom + 1 ||
      b.left < -1 ||
      b.top < -1 ||
      b.right > innerWidth + 1 ||
      b.bottom > innerHeight + 1 ||
      b.height / parent.height > 0.5 ||
      b.width > parent.width
    )
      return false;
    if (root.classList.contains('webgl-relic')) {
      const centerY = (b.top + b.height / 2 - parent.top) / parent.height;
      const centerX = (b.left + b.width / 2 - parent.left) / parent.width;
      if (Math.abs(centerY - 0.654) > 0.015 || Math.abs(centerX - 0.5) > 0.015) return false;
      const canvas = root.querySelector('canvas.relic3d')?.getBoundingClientRect();
      if (
        !canvas ||
        b.left < canvas.left - 1 ||
        b.right > canvas.right + 1 ||
        b.top < canvas.top - 1 ||
        b.bottom > canvas.bottom + 1
      )
        return false;
    }
    for (let ancestor = root; ancestor; ancestor = ancestor.parentElement) {
      const box = ancestor.getBoundingClientRect(),
        css = getComputedStyle(ancestor);
      if (css.visibility !== 'visible' || Number(css.opacity) <= 0 || css.display === 'none')
        return false;
      if (
        ['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowX) &&
        (b.left < box.left - 1 || b.right > box.right + 1)
      )
        return false;
      if (
        ['hidden', 'clip', 'auto', 'scroll'].includes(css.overflowY) &&
        (b.top < box.top - 1 || b.bottom > box.bottom + 1)
      )
        return false;
    }
    // Test actual composition order without changing layout, visibility or art.
    const previous = svg.style.getPropertyValue('pointer-events');
    const priority = svg.style.getPropertyPriority('pointer-events');
    let onTop = false;
    try {
      svg.style.setProperty('pointer-events', 'all', 'important');
      const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      onTop = top === svg || svg.contains(top);
    } finally {
      if (previous) svg.style.setProperty('pointer-events', previous, priority);
      else svg.style.removeProperty('pointer-events');
    }
    if (!onTop) return false;
    const image = new Image();
    image.src =
      'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(new XMLSerializer().serializeToString(svg));
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 76;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0, 100, 76);
    const rgba = ctx.getImageData(0, 0, 100, 76).data;
    let colored = 0;
    for (let i = 0; i < rgba.length; i += 4)
      if (rgba[i + 3] > 0 && (rgba[i] !== rgba[i + 1] || rgba[i + 1] !== rgba[i + 2])) colored++;
    canvas.width = canvas.height = 0;
    return colored > 100;
  }, count);
}
try {
  review = await visualReview();
  const { page, context, origin, fixture: f } = review;
  activePage = page;
  await noDemoIO(context);
  stage = 'simulated-counts';
  await page.goto(origin + '/demo/');
  await page.selectOption('#demo-growth-example', '9');
  await page.waitForFunction(
    () => Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 0,
  );
  assert.ok(await growthPixels(page, () => page.setViewportSize({ width: 391, height: 844 })));
  assert.ok(await badgePixels(page, '#demo-art .growth-fallback', 9));
  await capture(page, 'growth-9');
  for (const [n, tier] of [
    [17, 'bronze'],
    [42, 'silver'],
    [120, 'prismatic'],
  ]) {
    assert.ok(await growthPixels(page, () => page.selectOption('#demo-growth-example', String(n))));
    const d = await page.locator('canvas.relic3d').evaluate((c) => ({
      ...c.dataset,
      canvases: document.querySelectorAll('canvas.relic3d').length,
    }));
    assert.equal(Number(d.growthTicks ?? 0), 0);
    assert.equal(await page.locator('.growth-tick').count(), 0);
    assert.equal(
      await page.locator('#demo-growth-note').textContent(),
      `Style preview: ${n} rings (SIMULATED). No recorded history or awards.`,
    );
    const nearArt = await page.evaluate(() => {
      const note = document.querySelector('#demo-growth-note').getBoundingClientRect();
      const art = document.querySelector('#demo-art').getBoundingClientRect();
      return note.top >= 0 && note.bottom <= art.top && art.top < innerHeight;
    });
    assert.equal(nearArt, true);
    assert.equal(d.growthTotal, String(n));
    assert.equal(d.growthTier, tier);
    assert.equal(d.growthTextures, '0');
    assert.equal(d.growthRepresentation, 'composited-svg-sprite');
    assert.equal(d.growthSprites, '1');
    assert.ok(await badgePixels(page, '#demo-art .growth-fallback', n));
    assert.equal(d.canvases, 1);
    assert.ok(Number(d.triangles) < 20000);
    assert.ok(Number(d.bands) <= 32);
    await capture(page, 'growth-' + n);
  }
  const ticks = await page.locator('canvas.relic3d').getAttribute('data-growth-ticks');
  await page.selectOption('#demo-growth-example', '120');
  assert.equal(await page.locator('canvas.relic3d').getAttribute('data-growth-ticks'), ticks);
  const frames = await page.locator('canvas.relic3d').getAttribute('data-frames');
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
  assert.equal(await page.locator('canvas.relic3d').getAttribute('data-frames'), frames);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => !document.querySelector('canvas.relic3d'));
  assert.equal(await page.locator('.growth-fallback').getAttribute('data-total'), '120');
  assert.ok(
    await page.locator('#demo-art .crystal').evaluate(async (i) => {
      await i.decode();
      return i.naturalWidth > 0;
    }),
  );
  assert.ok(await badgePixels(page, '#demo-art .growth-fallback', 120));
  await capture(page, 'growth-reduced');
  assert.ok(Object.values(await page.evaluate(() => window.__demoIO)).every((n) => n === 0));
  checks.push({
    name: '9/17/42/120 real GL pixels and visible composited engraved sprite, bounded bands, no replay tick, static no RAF and reduced exact fallback',
    passed: true,
  });
  // Fresh document/context removes the demo-only IO traps before observing actual public mock state.
  const ownBrowser = context.browser();
  await context.close();
  const c = await ownBrowser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  await c.route('**/*', (r) =>
    new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
  );
  const p = await c.newPage();
  activePage = p;
  review.observe(p);
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  await f.control(HOME, 'send:' + OTHER);
  f.advance();
  await f.raid(HOME, OTHER, 1);
  await f.chat(HOME, '911', '!offer');
  await f.chat(OTHER, '912', '!accept');
  f.advance(21000);
  stage = 'overlay-live-count';
  await p.goto(origin + '/overlay/' + OTHER);
  await p.waitForFunction(
    () => Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 0,
  );
  assert.ok(await growthPixels(p, () => p.setViewportSize({ width: 1279, height: 800 })));
  assert.equal(await p.locator('canvas.relic3d').getAttribute('data-growth-total'), '1');
  assert.ok(await badgePixels(p, '.archive .growth-fallback', 1));
  await capture(p, 'growth-overlay');
  await p.setViewportSize({ width: 160, height: 160 });
  await p.goto(origin + '/overlay/' + OTHER + '?corner=1');
  await p.waitForFunction(
    () => document.querySelector('canvas.relic3d')?.dataset.growthTotal === '1',
  );
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.ok(await badgePixels(p, '.archive .growth-fallback', 1));
  await capture(p, 'growth-corner');
  stage = 'atlas-navigation';
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.goto(origin + '/atlas/');
  stage = 'atlas-relic-visible';
  await p.locator('#atlas-relic').scrollIntoViewIfNeeded();
  stage = 'atlas-gl-count';
  await p.waitForFunction(
    () => document.querySelector('#atlas-relic canvas')?.dataset.growthTotal === '1',
  );
  stage = 'atlas-gl-pixels';
  assert.ok(await growthPixels(p, () => p.setViewportSize({ width: 1279, height: 800 })));
  stage = 'atlas-capture';
  assert.ok(await badgePixels(p, '#atlas-relic .growth-fallback', 1));
  await capture(p, 'growth-atlas');
  stage = 'atlas-reduced-release';
  await p.bringToFront();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await p.waitForFunction(() => !document.querySelector('#atlas-relic canvas'));
  stage = 'atlas-reduced-count';
  assert.equal(await p.locator('#atlas-relic .growth-fallback').getAttribute('data-total'), '1');
  stage = 'atlas-reduced-svg';
  assert.ok(
    await p.locator('#atlas-relic > img').evaluate(async (img) => {
      await img.decode();
      if (!img.complete || img.naturalWidth <= 0 || img.naturalHeight <= 0) return false;
      const sample = document.createElement('canvas');
      sample.width = sample.height = 32;
      const ctx = sample.getContext('2d');
      ctx.drawImage(img, 0, 0, 32, 32);
      const rgba = ctx.getImageData(0, 0, 32, 32).data;
      let colored = 0;
      for (let i = 0; i < rgba.length; i += 4)
        if (rgba[i + 3] > 0 && (rgba[i] !== rgba[i + 1] || rgba[i + 1] !== rgba[i + 2])) colored++;
      sample.width = sample.height = 0;
      return colored > 0;
    }),
  );
  assert.equal(await p.locator('#atlas-relic > img').isVisible(), true);
  assert.ok(await badgePixels(p, '#atlas-relic .growth-fallback', 1));
  stage = 'atlas-normal-return';
  await p.emulateMedia({ reducedMotion: 'no-preference' });
  await p.waitForFunction(
    () => Number(document.querySelector('#atlas-relic canvas')?.dataset.frames) > 0,
  );
  assert.equal(await p.locator('#atlas-relic canvas').count(), 1);
  assert.equal(await p.locator('#atlas-relic canvas').getAttribute('data-growth-total'), '1');
  assert.ok(await growthPixels(p, () => p.setViewportSize({ width: 1278, height: 800 })));
  checks.push({
    name: 'Actual signed completed stop drives matching Overlay/Atlas count and bounded corner/reduced presentation',
    passed: true,
  });
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  passed = true;
  stage = 'complete';
} catch (e) {
  const line = /browser-smoke-growth[.]js:(\d+)/.exec(e?.stack ?? '');
  if (line) diagnostic.assertionLine = Number(line[1]);
  try {
    const values = await activePage?.evaluate(() => ({
      viewportWidth: innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      atlasHolderCount: document.querySelectorAll('.holder-spotlight h3').length,
      canvasCount: document.querySelectorAll('canvas.relic3d').length,
      atlasCanvasCount: document.querySelectorAll('#atlas-relic canvas').length,
      atlasFrames: Number(document.querySelector('#atlas-relic canvas')?.dataset.frames ?? 0),
      atlasGrowthTotal: Number(
        document.querySelector('#atlas-relic canvas')?.dataset.growthTotal ?? 0,
      ),
      atlasPhysicalBands: Number(
        document.querySelector('#atlas-relic canvas')?.dataset.physicalBands ?? 0,
      ),
      motionMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
      docHidden: document.hidden,
      contextStatus:
        document.querySelector('#atlas-relic canvas')?.dataset.contextStatus === 'active' ? 1 : 0,
      mediaChangeCalls: Number(document.querySelector('#atlas-relic')?.dataset.motionChanges ?? 0),
      rendererCreates: Number(document.querySelector('#atlas-relic')?.dataset.rendererCreates ?? 0),
      rendererDisposes: Number(
        document.querySelector('#atlas-relic')?.dataset.rendererDisposes ?? 0,
      ),
      rendererEpoch: Number(document.querySelector('#atlas-relic')?.dataset.rendererEpoch ?? 0),
      canvasDisposed: document.querySelector('#atlas-relic canvas')?.dataset.disposed === 'true',
      sourceEnum: 2,
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
  for (const [name, png] of captures) await writeFile('artifacts/' + name + '.png', png);
  const report = JSON.stringify({ passed, stage, failureCategory, checks, diagnostic });
  assert.ok(Buffer.byteLength(report) <= 65536);
  await writeFile('artifacts/growth-browser-results.json', report + '\n');
}
if (!passed) process.exitCode = 1;
