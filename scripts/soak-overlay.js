// LOCAL synthetic TLS/WSS only. Never included in the default browser-smoke glob.
import assert from 'node:assert/strict';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { visualReview } from '../test-support/visual-review.js';
import { HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { overlaySoakOptions, overlaySoakBounds } from '../test-support/overlay-soak.js';
let review,
  deadline,
  cdp,
  options,
  failureCategory = null,
  passed = false;
let stage = 'options',
  logicalElapsedMs = 0,
  cycles = 0,
  lastFrames = 0,
  frames = 0;
let peakHeap = 0,
  requests = 0,
  sockets = 0,
  forbidden = 0;
let observationStart = null;
const started = performance.now(),
  samples = [];
const assets = { files: 0, bytes: 0, largestBytes: 0 };
async function sample() {
  await cdp.send('HeapProfiler.collectGarbage'); // Retained heap, explicitly forced GC.
  const [heap, dom, data] = await Promise.all([
    cdp.send('Runtime.getHeapUsage'),
    cdp.send('Memory.getDOMCounters'),
    review.page.evaluate(() => {
      const c = document.querySelector('canvas.relic3d');
      return {
        frames: Number(c?.dataset.frames ?? 0),
        canvases: document.querySelectorAll('canvas.relic3d').length,
        geometry: Number(c?.dataset.geometryCount ?? -1),
        textures: Number(c?.dataset.textureCount ?? -1),
        triangles: Number(c?.dataset.triangles ?? 0),
        active: c?.dataset.contextStatus === 'active',
        visible: !document.hidden && c?.getBoundingClientRect().width > 0,
        connected: document.body.dataset.connection === 'connected',
      };
    }),
  ]);
  assert.ok(data.active && data.visible && data.connected);
  assert.ok(data.frames > lastFrames, 'Actual GL frames must advance between samples');
  frames += data.frames - lastFrames;
  lastFrames = data.frames;
  assert.ok(data.geometry >= 0 && data.textures >= 0);
  samples.push({
    heap: heap.usedSize,
    frames,
    canvases: data.canvases,
    geometry: data.geometry,
    textures: data.textures,
    triangles: data.triangles,
    nodes: dom.nodes,
    listeners: dom.jsEventListeners,
    documents: dom.documents,
  });
  assert.ok(samples.length <= 25);
}
try {
  options = overlaySoakOptions(process.argv.slice(2));
  const maxWall = options.logical ? 150000 : options.warmupMs + options.durationMs + 120000;
  review = await visualReview();
  const { context, page, origin, fixture: f } = review;
  deadline = setTimeout(() => {
    void context.close().catch(() => {});
  }, maxWall);
  await context.routeWebSocket('**/*', (route) => {
    if (new URL(route.url()).origin !== origin.replace('https:', 'wss:')) {
      forbidden++;
      return route.close();
    }
    sockets++;
    return route.connectToServer();
  });
  page.on('request', (r) => {
    requests++;
    if (
      new URL(r.url()).origin !== origin ||
      r.method() !== 'GET' ||
      /^\/(?:control|oauth|auth|internal|eventsub)(?:\/|$)/.test(new URL(r.url()).pathname)
    )
      forbidden++;
  });
  for (const file of [
    'public/overlay.js',
    'public/overlay-client.js',
    'public/relic3d.js',
    'public/overlay.css',
    'public/vendor/three.core.js',
    'public/vendor/three.module.js',
  ]) {
    const value = await stat(file);
    assets.files++;
    assets.bytes += value.size;
    assets.largestBytes = Math.max(assets.largestBytes, value.size);
  }
  stage = 'fixture';
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    f.streams.get(id).viewer_count = 1;
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  await f.control(HOME, `send:${OTHER}`);
  await f.raid();
  await f.chat(HOME, '6500', '!offer');
  await f.chat(OTHER, '6501', '!accept');
  f.advance(240000); // Initial completed arrival is elapsed, not restarted on read.
  await page.setViewportSize({ width: 480, height: 800 });
  await page.goto(origin + '/overlay/' + OTHER);
  await page.bringToFront();
  await page.waitForFunction(
    () =>
      document.body.dataset.connection === 'connected' &&
      Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 2,
  );
  await page.locator('canvas.relic3d').evaluate((c) => c.setAttribute('data-render-profile', ''));
  cdp = await context.newCDPSession(page);
  stage = 'warmup';
  await page.waitForTimeout(options.warmupMs);
  f.advance(options.warmupMs);
  await sample();
  observationStart = performance.now();
  let nextUpdate = options.mode === 'smoke' ? 2000 : 60000;
  let nextCheckpoint = options.mode === 'smoke' ? 10000 : 300000;
  while (logicalElapsedMs < options.durationMs) {
    const previousLogical = logicalElapsedMs;
    if (options.logical) {
      f.advance(60000);
      logicalElapsedMs = Math.min(options.durationMs, logicalElapsedMs + 60000);
      await page.waitForTimeout(100);
    } else {
      await page.waitForTimeout(1000);
      logicalElapsedMs = Math.min(options.durationMs, performance.now() - observationStart);
      f.advance(logicalElapsedMs - previousLogical);
    }
    stage = 'observe';
    const live = await cdp.send('Runtime.getHeapUsage');
    peakHeap = Math.max(peakHeap, live.usedSize);
    if (logicalElapsedMs >= nextUpdate) {
      const actor = String(7000 + (cycles % 32));
      await f.chat(OTHER, actor, '!mark moon');
      const doc = await f.runtime.state.getPrivateMarks(OTHER, {
        broadcasterId: OTHER,
        chatterId: OTHER,
      });
      const mark = doc.sessions.flatMap((s) => s.marks).find((m) => m.userId === actor);
      assert.ok(mark);
      await f.chat(OTHER, OTHER, `!relic approve ${mark.id}`);
      await page.waitForFunction(() => document.querySelector('#runes').children.length > 0);
      await f.chat(OTHER, actor, '!relic forgetme');
      await page.waitForFunction(() => document.querySelector('#runes').children.length === 0);
      cycles++;
      f.calls.length = 0; // No retained growing provider-call history in this long fixture.
      if (cycles % 5 === 0) {
        review.dropConnections();
        await page.waitForFunction(() => document.body.dataset.connection !== 'connected');
        await page.waitForFunction(() => document.body.dataset.connection === 'connected');
      }
      nextUpdate += options.mode === 'smoke' ? 2000 : 60000;
    }
    if (logicalElapsedMs >= nextCheckpoint || logicalElapsedMs >= options.durationMs) {
      await page.waitForTimeout(150);
      await sample();
      nextCheckpoint += options.mode === 'smoke' ? 10000 : 300000;
    }
  }
  assert.ok(overlaySoakBounds(samples));
  assert.equal(forbidden, 0);
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  assert.ok(cycles > 0 && cycles <= 120);
  if (options.mode === 'wall') assert.ok(performance.now() - observationStart >= 7200000);
  passed = true;
  stage = 'complete';
} catch (e) {
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(e?.name)
    ? e.name
    : 'fixture-or-browser';
} finally {
  clearTimeout(deadline);
  const actualElapsedMs =
    observationStart === null ? 0 : Math.round(performance.now() - observationStart);
  await review?.close();
  const report = {
    passed,
    mode: options?.mode ?? 'invalid',
    stage,
    failureCategory,
    requestedDurationMs: options?.durationMs ?? 0,
    actualElapsedMs,
    totalElapsedMs: Math.round(performance.now() - started),
    logicalElapsedMs: Math.round(logicalElapsedMs),
    warmupMs: options?.warmupMs ?? 0,
    forcedGarbageCollection: true,
    checkpoints: samples.length,
    samples,
    cycles,
    frames,
    peakHeap,
    requests,
    sockets,
    forbidden,
    errors: review?.stats().errors ?? 0,
    assets,
  };
  const encoded = JSON.stringify(report);
  assert.ok(Buffer.byteLength(encoded) <= 65536);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/overlay-soak-results.json', encoded + '\n');
}
if (!passed) process.exitCode = 1;
