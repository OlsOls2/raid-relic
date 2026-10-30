// Explicit dedicated LOCAL 150-second observation, outside the browser-smoke glob.
// No seek, browser clock, keyboard/mouse input, fixture writes or live connections.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { noDemoIO, growthPixels } from '../test-support/visual-review.js';
import {
  nativeFilmReview,
  nativeTabVisibilityPreflight,
} from '../test-support/native-film-review.js';
import { filmResourceReason } from '../test-support/film-resources.js';
const DURATION = 150000,
  HIDDEN = 60000;
let review,
  deadline,
  stage = 'setup',
  passed = false,
  failureCategory = null;
let observationStart = null,
  hiddenStart = null,
  actualHiddenElapsedMs = 0;
let downloads = 0,
  requestOverflow = false,
  timedOut = false,
  active = 0,
  hiddenDone = false;
let trustedInteractionCount = null;
const samples = [],
  seen = new Set(),
  records = [],
  diagnostic = {};
async function sample(page, pageCode) {
  await page.waitForFunction(
    () =>
      document.body.dataset.filmScene === '7' ||
      Number(document.querySelector('#film-art canvas')?.dataset.frames) > 0,
  );
  await page.evaluate(() =>
    document.querySelector('#film-art canvas')?.setAttribute('data-render-profile', ''),
  );
  await page.waitForFunction(
    () =>
      document.body.dataset.filmScene === '7' ||
      document.querySelector('#film-art canvas')?.dataset.geometryCount !== undefined,
  );
  const value = await page.evaluate(() => {
    const canvas = document.querySelector('#film-art canvas.relic3d');
    if (canvas) canvas.setAttribute('data-render-profile', '');
    return {
      clockMs: Number(document.body.dataset.filmClock),
      scene: Number(document.body.dataset.filmScene),
      playing: Number(document.body.dataset.filmPlaying === 'true'),
      hidden: Number(document.hidden),
      canvases: document.querySelectorAll('#film-art canvas.relic3d').length,
      width: canvas?.width ?? 0,
      height: canvas?.height ?? 0,
      frames: Number(canvas?.dataset.frames ?? 0),
      geometry: Number(canvas?.dataset.geometryCount ?? 0),
      textures: Number(canvas?.dataset.textureCount ?? 0),
      triangles: Number(canvas?.dataset.triangles ?? 0),
      sprites: Number(canvas?.dataset.sprites ?? 0),
      contextActive: Number(!canvas || canvas.dataset.contextStatus === 'active'),
      rings: /rings: 1/.test(document.querySelector('#film-count').textContent) ? 1 : 0,
    };
  });
  assert.ok(Object.values(value).every(Number.isFinite));
  assert.ok(value.clockMs >= 0 && value.clockMs <= DURATION);
  assert.ok(Number.isInteger(value.scene) && value.scene >= 0 && value.scene < 8);
  assert.ok(value.canvases <= 1 && value.width <= 480 && value.height <= 480);
  assert.ok(value.geometry <= 8 && value.textures <= 2 && value.sprites <= 160);
  assert.ok(value.triangles < 20000 && value.contextActive === 1);
  assert.equal(value.rings, Number(value.clockMs >= 55000));
  assert.equal(value.hidden, 0); // Scene coverage is from the genuinely foreground page.
  if (value.scene < 7) {
    assert.equal(value.canvases, 1);
    assert.ok(value.frames > 0);
  }
  seen.add(value.scene);
  samples.push({
    elapsedMs: Math.round(performance.now() - observationStart),
    page: pageCode,
    ...value,
  });
  assert.ok(samples.length <= 40);
}
try {
  review = await nativeFilmReview();
  const { context, page: film, origin, fixture } = review;
  deadline = setTimeout(() => {
    timedOut = true;
    void context.close().catch(() => {});
  }, 190000);
  await noDemoIO(context);
  await context.addInitScript(() => {
    window.__wallFilm = { firstClock: null, trustedInteractions: 0, ownedPNGs: [] };
    const initial = new MutationObserver(() => {
      const clock = document.body?.dataset.filmClock;
      if (clock !== undefined) {
        window.__wallFilm.firstClock = Number(clock);
        initial.disconnect();
      }
    });
    initial.observe(document, {
      subtree: true,
      attributes: true,
      attributeFilter: ['data-film-clock'],
    });
    for (const type of [
      'keydown',
      'keyup',
      'pointerdown',
      'pointerup',
      'click',
      'wheel',
      'touchstart',
      'input',
      'change',
    ])
      document.addEventListener(
        type,
        (event) => {
          if (event.isTrusted) window.__wallFilm.trustedInteractions++;
        },
        { capture: true, passive: true },
      );
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (
        blob instanceof Blob &&
        blob.type === 'image/png' &&
        blob.size > 0 &&
        blob.size <= 524288 &&
        window.__wallFilm.ownedPNGs.length < 4
      )
        window.__wallFilm.ownedPNGs.push({ url, type: blob.type, size: blob.size });
      return url;
    };
  });
  const before = {
    registry: await fixture.runtime.state.getKeeperRegistry(),
    journey: await fixture.runtime.state.getPublicJourney(),
  };
  // A second untouched film is a foreground witness during the primary's hidden
  // minute. Hidden pages intentionally do not paint intermediate DOM scenes;
  // never invent that scene coverage from an inferred clock.
  const witness = await context.newPage();
  review.observe(witness);
  const pages = [film, witness];
  stage = 'blank-tab-visibility';
  await nativeTabVisibilityPreflight(pages, diagnostic);
  for (const page of pages) {
    const requests = [];
    records.push(requests);
    page.on('request', (request) => {
      if (requests.length >= 64) {
        requestOverflow = true;
        return;
      }
      requests.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
      });
    });
    page.on('download', () => downloads++);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(origin + '/demo/film?autoplay=1&kiosk=1');
    assert.equal(
      await page.locator('body').getAttribute('data-presentation-duration'),
      String(DURATION),
    );
    assert.equal(await page.evaluate(() => window.__wallFilm.firstClock), 0);
  }
  await film.bringToFront();
  await film.waitForFunction(
    () =>
      !document.hidden && Number(document.querySelector('#film-art canvas')?.dataset.frames) > 2,
  );
  assert.equal(await growthPixels(film, async () => {}), true);
  await film
    .locator('#film-art canvas')
    .evaluate((canvas) => canvas.setAttribute('data-render-profile', ''));
  await film.waitForFunction(
    () => document.querySelector('#film-art canvas')?.dataset.geometryCount !== undefined,
  );
  observationStart = performance.now();
  stage = 'full-wall-observation';
  await sample(film, 0);
  let nextSample = 5000;
  while (performance.now() - observationStart < DURATION || !hiddenDone) {
    const elapsed = performance.now() - observationStart;
    if (hiddenStart === null && elapsed >= 55000) {
      stage = 'primary-actual-hidden';
      await witness.bringToFront();
      await film.waitForFunction(() => document.hidden === true, undefined, { timeout: 5000 });
      hiddenStart = performance.now();
      active = 1;
      await witness.waitForFunction(
        () =>
          !document.hidden &&
          Number(document.querySelector('#film-art canvas')?.dataset.frames) > 0,
      );
    }
    if (hiddenStart !== null && !hiddenDone && performance.now() - hiddenStart >= HIDDEN) {
      assert.equal(await film.evaluate(() => document.hidden), true);
      actualHiddenElapsedMs = performance.now() - hiddenStart;
      await film.bringToFront();
      active = 0;
      hiddenDone = true;
      await film.waitForFunction(
        () => !document.hidden && Number(document.body.dataset.filmClock) >= 115000,
      );
      stage = 'primary-catchup-and-finish';
    }
    if (elapsed >= nextSample && samples.length < 39) {
      await sample(pages[active], active);
      nextSample += 5000;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  diagnostic.actualElapsedMs = Math.round(performance.now() - observationStart);
  assert.ok(diagnostic.actualElapsedMs >= DURATION && actualHiddenElapsedMs >= HIDDEN);
  stage = 'deterministic-end-hold';
  await film.waitForFunction(
    () =>
      document.body.dataset.filmClock === '150000' && document.body.dataset.filmPlaying === 'false',
  );
  await film.waitForFunction(() => !document.querySelector('#film-export').disabled);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await sample(film, 0);
  assert.equal(await film.locator('body').getAttribute('data-film-clock'), '150000');
  assert.equal(await film.locator('body').getAttribute('data-film-playing'), 'false');
  assert.deepEqual(
    [...seen].sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 5, 6, 7],
  );
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const proof = await page.evaluate(() => ({
      firstClock: window.__wallFilm.firstClock,
      interactions: window.__wallFilm.trustedInteractions,
      preview: document.querySelector('#film-card').src,
      ownedPNGs: window.__wallFilm.ownedPNGs,
      io: window.__demoIO,
    }));
    assert.equal(proof.firstClock, 0);
    trustedInteractionCount = (trustedInteractionCount ?? 0) + proof.interactions;
    assert.equal(proof.interactions, 0);
    assert.ok(Object.values(proof.io).every((count) => count === 0));
    for (const request of records[i])
      assert.ok(
        ['static', 'owned-preview'].includes(filmResourceReason(request, { origin, ...proof })),
      );
  }
  assert.equal(requestOverflow, false);
  assert.equal(downloads, 0);
  assert.equal(fixture.calls.length, 0);
  assert.deepEqual(await fixture.runtime.state.getKeeperRegistry(), before.registry);
  assert.deepEqual(await fixture.runtime.state.getPublicJourney(), before.journey);
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  stage = 'complete';
  passed = true;
} catch (error) {
  if (Number.isInteger(error?.nativeProtocolCode))
    diagnostic.nativeProtocolCode = error.nativeProtocolCode;
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(error?.name)
    ? error.name
    : 'fixture-or-browser';
  diagnostic.assertionLine = Number(
    /observe-film-walltime[.]js:(\d+)/.exec(error?.stack ?? '')?.[1] ?? 0,
  );
} finally {
  clearTimeout(deadline);
  if (observationStart !== null)
    diagnostic.actualElapsedMs ??= Math.round(performance.now() - observationStart);
  try {
    await review?.close();
  } catch {
    passed = false;
    failureCategory ??= 'cleanup';
    diagnostic.cleanupFailed = 1;
  }
  const report = JSON.stringify({
    passed,
    stage,
    failureCategory,
    requestedDurationMs: DURATION,
    actualElapsedMs: diagnostic.actualElapsedMs ?? 0,
    actualHiddenElapsedMs: Math.round(actualHiddenElapsedMs),
    browserClockUsed: false,
    setupSeekUsed: false,
    trustedInteractionCount,
    timedOut,
    downloads,
    requestCount: records.reduce((sum, rows) => sum + rows.length, 0),
    scenes: [...seen].sort((a, b) => a - b),
    samples,
    diagnostic,
  });
  assert.ok(Buffer.byteLength(report) <= 65536);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/film-walltime-browser-results.json', report + '\n');
}
if (!passed) process.exitCode = 1;
