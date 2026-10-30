// Real no-input/hidden-tab evidence on LOCAL fiction only. No browser clock here.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { noDemoIO } from '../test-support/visual-review.js';
import {
  nativeFilmReview,
  nativeTabVisibilityPreflight,
} from '../test-support/native-film-review.js';
import { filmResourceReason } from '../test-support/film-resources.js';
import { filmPaintedFraming } from '../test-support/film-framing.js';
import { optimizeContactPNG } from '../test-support/png-contact.js';
let review,
  stage = 'setup',
  passed = false,
  failureCategory = null,
  downloads = 0,
  requestOverflow = false;
const checks = [],
  diagnostic = {},
  captures = new Map(),
  pages = new Map();
const started = performance.now();
const seek = (page, ms) =>
  page.locator('#film-seek').evaluate((input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, ms);
try {
  review = await nativeFilmReview();
  const { page: film, context, origin, fixture } = review;
  const judge = await context.newPage();
  review.observe(judge);
  stage = 'blank-tab-visibility';
  await nativeTabVisibilityPreflight([film, judge], diagnostic);
  await noDemoIO(context);
  await context.addInitScript(() => {
    window.__timingOwnedPNGs = [];
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (
        blob instanceof Blob &&
        blob.type === 'image/png' &&
        blob.size > 0 &&
        blob.size <= 524288 &&
        window.__timingOwnedPNGs.length < 4
      )
        window.__timingOwnedPNGs.push({ url, type: blob.type, size: blob.size });
      return url;
    };
  });
  const observe = (page) => {
    const requests = [];
    pages.set(page, requests);
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
  };
  observe(film);
  await film.setViewportSize({ width: 1280, height: 720 });
  stage = 'film-real-hidden-setup';
  await film.goto(origin + '/demo/film?autoplay=1&kiosk=1');
  assert.equal(await film.locator('body').getAttribute('data-presentation-duration'), '150000');
  // Setup seek only. The following sixty seconds use actual monotonic wall time.
  await seek(film, 90000);
  observe(judge);
  await judge.setViewportSize({ width: 1280, height: 720 });
  await judge.goto(origin + '/demo/judge?autoplay=1&kiosk=1');
  await judge.bringToFront();
  await film.waitForFunction(() => document.hidden === true, undefined, { timeout: 5000 });
  const hiddenStart = performance.now();
  stage = 'actual-hidden-sixty-seconds';
  await new Promise((resolve) => setTimeout(resolve, 60000));
  diagnostic.actualHiddenObservationMs = Math.round(performance.now() - hiddenStart);
  assert.ok(diagnostic.actualHiddenObservationMs >= 60000);
  assert.equal(await film.evaluate(() => document.hidden), true);
  // Judge has had no input at all: its distinct 45-second pace must hold the end.
  assert.equal(await judge.locator('body').getAttribute('data-film-clock'), '150000');
  assert.equal(await judge.locator('body').getAttribute('data-film-playing'), 'false');
  assert.match(await judge.locator('#film-time').innerText(), /0:45 \/ 0:45/);
  await film.bringToFront();
  stage = 'kiosk-catchup-and-hold';
  await film.waitForFunction(() => document.body.dataset.filmClock === '150000');
  assert.equal(await film.locator('body').getAttribute('data-film-playing'), 'false');
  await film.waitForFunction(() => !document.querySelector('#film-export').disabled);
  await film.waitForTimeout(1000);
  assert.equal(await film.locator('body').getAttribute('data-film-clock'), '150000');
  assert.equal(await film.locator('#film-next').isVisible(), false);
  assert.equal(await film.locator('#film-play').isVisible(), true);
  assert.equal(downloads, 0);
  assert.match(await film.locator('#film-banner').innerText(), /SIMULATED/);
  assert.equal(await film.locator('#film-banner').isVisible(), true);
  // Accessible manual pause remains available in kiosk, including Space on page.
  await film.locator('#main-content').focus();
  await film.keyboard.press('Space');
  await film.waitForTimeout(600);
  assert.equal(await film.locator('body').getAttribute('data-film-playing'), 'true');
  await film.keyboard.press('Space');
  const paused = await film.locator('body').getAttribute('data-film-clock');
  await film.waitForTimeout(600);
  assert.equal(await film.locator('body').getAttribute('data-film-clock'), paused);
  checks.push({
    name: 'Actual background tab hidden for >=60s with throttling enabled; 45s judge no-input completion and 150s film catch-up after a 90s setup seek, deterministic hold and reachable kiosk pause',
    passed: true,
  });
  stage = 'normal-reduced-static';
  const reduced = await context.newPage();
  review.observe(reduced);
  observe(reduced);
  await reduced.emulateMedia({ reducedMotion: 'reduce' });
  await reduced.goto(origin + '/demo/film');
  await reduced.bringToFront();
  await reduced.waitForTimeout(2000);
  assert.equal(await reduced.locator('body').getAttribute('data-film-clock'), '0');
  assert.equal(await reduced.locator('body').getAttribute('data-film-playing'), 'false');
  assert.equal(await reduced.locator('#film-art canvas').count(), 0);
  await reduced.locator('#film-next').click();
  assert.equal(await reduced.locator('body').getAttribute('data-film-clock'), '15000');
  assert.equal(await reduced.locator('body').getAttribute('data-film-playing'), 'false');
  await reduced.waitForTimeout(1600);
  const caption = await reduced.locator('#film-caption').evaluate((node) => ({
    height: node.getBoundingClientRect().height,
    line: parseFloat(getComputedStyle(node).lineHeight),
    size: parseFloat(getComputedStyle(node).fontSize),
  }));
  assert.equal(caption.size, 28);
  assert.ok(caption.height <= caption.line * 2 + 1);
  assert.equal(await reduced.locator('.film-claim-burst').isVisible(), false);
  await reduced.locator('#film-play').click();
  await reduced.waitForTimeout(600);
  assert.ok(Number(await reduced.locator('body').getAttribute('data-film-clock')) > 15000);
  await reduced.locator('#film-play').click();
  stage = 'normal-to-reduced-transition';
  await reduced.emulateMedia({ reducedMotion: 'no-preference' });
  await reduced.goto(origin + '/demo/film');
  await reduced.waitForFunction(
    () => Number(document.querySelector('#film-art canvas')?.dataset.frames) > 0,
  );
  await seek(reduced, 60000);
  assert.equal(await reduced.locator('body').getAttribute('data-film-playing'), 'true');
  await reduced.emulateMedia({ reducedMotion: 'reduce' });
  await reduced.waitForFunction(
    () =>
      document.body.dataset.filmPlaying === 'false' &&
      document.querySelectorAll('#film-art canvas').length === 0,
  );
  const reducedPauseClock = await reduced.locator('body').getAttribute('data-film-clock');
  assert.equal(await reduced.locator('#film-art .growth-fallback').getAttribute('data-total'), '1');
  await reduced.waitForTimeout(600);
  assert.equal(await reduced.locator('body').getAttribute('data-film-clock'), reducedPauseClock);
  await reduced.locator('#film-play').click();
  await reduced.waitForFunction(
    (at) => Number(document.body.dataset.filmClock) > at,
    Number(reducedPauseClock),
  );
  assert.equal(await reduced.locator('body').getAttribute('data-film-playing'), 'true');
  assert.equal(await reduced.locator('#film-art canvas').count(), 0);
  await reduced.locator('#film-play').click();
  await reduced.goto(origin + '/demo/film?autoplay=1&kiosk=1');
  await reduced.waitForTimeout(600);
  assert.equal(await reduced.locator('body').getAttribute('data-film-playing'), 'true');
  assert.ok(Number(await reduced.locator('body').getAttribute('data-film-clock')) > 0);
  assert.equal(await reduced.locator('#film-art canvas').count(), 0);
  await reduced.locator('#film-play').click();
  // Check enlarged art, scene separation and bounded ongoing motion in normal mode.
  await film.bringToFront();
  await seek(film, 0);
  await film.locator('#film-play').click();
  const motionBefore = await film
    .locator('.chat-window ol')
    .evaluate((node) => getComputedStyle(node).transform);
  await film.waitForTimeout(1000);
  assert.notEqual(
    await film.locator('.chat-window ol').evaluate((node) => getComputedStyle(node).transform),
    motionBefore,
  );
  await film.locator('#film-play').click();
  const layout = await film.evaluate(() => ({
    stage: document.querySelector('#film-stage').getBoundingClientRect().height,
    art: document.querySelector('#film-art').getBoundingClientRect().height,
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  assert.ok(layout.art >= layout.stage * 0.5);
  assert.equal(layout.overflow, false);
  for (const [ms, scene] of [
    [0, 'send'],
    [15000, 'arrival'],
    [55000, 'claim'],
    [60000, 'engraving'],
  ]) {
    await seek(film, ms);
    const painted = await filmPaintedFraming(film, () => film.locator('#film-play').click());
    await film.locator('#film-play').click();
    diagnostic.paintedHeight = Math.round(painted.paintedHeight);
    diagnostic.paintedStageHeight = Math.round(painted.stageHeight);
    diagnostic.badgeOverlap = Math.round(painted.overlap);
    assert.ok(painted.paintedHeight >= painted.stageHeight * 0.5);
    assert.equal(painted.overlap, 0);
    assert.ok(painted.badgeHeight <= 44.1);
    assert.ok(painted.rasterWidth <= 480 && painted.rasterHeight <= 480);
    await film.waitForTimeout(400);
    if (process.env.FILM_TIMING_CAPTURE === '1') {
      const viewport = film.viewportSize();
      assert.ok(viewport.width * viewport.height * 4 <= 4 * 1024 * 1024);
      const bytes = await film.screenshot({ fullPage: false });
      assert.ok(bytes.length <= 524288);
      captures.set('film-timing-' + scene, bytes);
    }
  }
  // Optional contact sheet uses only the four genuine viewport captures above.
  if (captures.size) {
    const encodedFrames = [...captures.values()].map((bytes) => bytes.toString('base64'));
    assert.ok(Buffer.byteLength(JSON.stringify(encodedFrames)) < 3 * 1024 * 1024);
    const raw = await film.evaluate(async (frames) => {
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      try {
        const ctx = canvas.getContext('2d');
        for (let i = 0; i < frames.length; i++) {
          const image = await createImageBitmap(
            new Blob([Uint8Array.from(atob(frames[i]), (c) => c.charCodeAt(0))], {
              type: 'image/png',
            }),
          );
          try {
            ctx.drawImage(image, (i % 2) * 640, Math.floor(i / 2) * 360, 640, 360);
          } finally {
            image.close();
          }
        }
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!blob || blob.size > 1048576) throw Error('Contact intermediate bound');
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = '';
        for (let at = 0; at < bytes.length; at += 16384)
          binary += String.fromCharCode(...bytes.subarray(at, at + 16384));
        return btoa(binary);
      } finally {
        canvas.width = canvas.height = 0;
      }
    }, encodedFrames);
    assert.ok(typeof raw === 'string' && raw.length <= 1398104);
    assert.ok(Buffer.byteLength(JSON.stringify(raw)) < 4 * 1024 * 1024);
    const contact = optimizeContactPNG(Buffer.from(raw, 'base64'));
    diagnostic.contactEncodedBytes = contact.length;
    assert.ok(contact.length <= 524288);
    captures.set('film-timing-contact', contact);
  }
  for (const [page, requests] of pages) {
    const owned = await page.evaluate(() => ({
      preview: document.querySelector('#film-card').src,
      ownedPNGs: window.__timingOwnedPNGs,
    }));
    for (const request of requests)
      assert.ok(
        ['static', 'owned-preview'].includes(filmResourceReason(request, { origin, ...owned })),
      );
    assert.ok(
      Object.values(await page.evaluate(() => window.__demoIO)).every((count) => count === 0),
    );
  }
  assert.equal(downloads, 0);
  assert.equal(requestOverflow, false);
  assert.equal(fixture.calls.length, 0);
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  checks.push({
    name: 'Normal reduced mode stays static until manual action; 28px two-line captions, fictional moving chat, >=50% stage art and zero application IO/automatic downloads',
    passed: true,
  });
  passed = true;
} catch (error) {
  if (Number.isInteger(error?.nativeProtocolCode))
    diagnostic.nativeProtocolCode = error.nativeProtocolCode;
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(error?.name)
    ? error.name
    : 'fixture-or-browser';
  diagnostic.assertionLine = Number(
    /browser-smoke-film-timing[.]js:(\d+)/.exec(error?.stack ?? '')?.[1] ?? 0,
  );
} finally {
  try {
    await review?.close();
  } catch {
    passed = false;
    failureCategory ??= 'cleanup';
    diagnostic.cleanupFailed = 1;
  }
  diagnostic.actualTestElapsedMs = Math.round(performance.now() - started);
  diagnostic.browserClockUsed = false;
  await mkdir('artifacts', { recursive: true });
  assert.ok(
    captures.size <= 5 &&
      [...captures.values()].reduce((sum, bytes) => sum + bytes.length, 0) <= 4 * 1024 * 1024,
  );
  for (const [name, bytes] of captures) {
    assert.ok(bytes.length <= 524288);
    await writeFile('artifacts/' + name + '.png', bytes);
  }
  const report = JSON.stringify({ passed, stage, failureCategory, checks, diagnostic });
  assert.ok(Buffer.byteLength(report) <= 65536);
  await writeFile('artifacts/film-timing-browser-results.json', report + '\n');
}
if (!passed) process.exitCode = 1;
