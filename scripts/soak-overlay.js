// LOCAL synthetic TLS/WSS only. Never included in the default browser-smoke glob.
import assert from 'node:assert/strict';
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { visualReview, growthPixels } from '../test-support/visual-review.js';
import { HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import {
  overlaySoakOptions,
  overlaySoakBounds,
  overlayFixtureElapsed,
} from '../test-support/overlay-soak.js';
import { hash } from '../src/crypto.js';
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
let trustedInputCount = 0,
  idleObservationMs = 0,
  arrivalObserved = false;
let fixture,
  requestedActor = null;
const diagnostic = {};
const started = performance.now(),
  samples = [];
const assets = { files: 0, bytes: 0, largestBytes: 0 };
async function sample() {
  stage = 'sample-gc';
  await cdp.send('HeapProfiler.collectGarbage'); // Retained heap, explicitly forced GC.
  stage = 'sample-metrics';
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
  review = await visualReview({ readProjection: ['obs-wall', 'obs-probe'].includes(options.mode) });
  const { context, page, origin, fixture: f } = review;
  fixture = f;
  const advanceFixture = (delta = 1) => {
    assert.ok(Number.isSafeInteger(delta) && delta >= 0 && Number.isSafeInteger(f.now()));
    f.advance(delta);
    assert.ok(Number.isSafeInteger(f.now()));
  };
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
  if (['obs-wall', 'obs-probe'].includes(options.mode)) {
    stage = 'obs-idle-setup';
    const registryBefore = await f.runtime.state.getKeeperRegistry();
    const journeyBefore = await f.runtime.state.getPublicJourney();
    await context.addInitScript(() => {
      window.__obsIdle = { input: 0, actions: 0, downloads: 0 };
      for (const type of ['keydown', 'pointerdown', 'click', 'touchstart', 'wheel'])
        addEventListener(
          type,
          (event) => {
            if (event.isTrusted) window.__obsIdle.input++;
          },
          true,
        );
      for (const name of ['fetch', 'XMLHttpRequest'])
        window[name] = function () {
          window.__obsIdle.actions++;
          throw Error('OBS idle read only');
        };
      navigator.sendBeacon = () => {
        window.__obsIdle.actions++;
        return false;
      };
      for (const name of ['setItem', 'removeItem', 'clear'])
        Storage.prototype[name] = () => {
          window.__obsIdle.actions++;
          throw Error('OBS idle no storage writes');
        };
    });
    page.on('download', () => {
      forbidden++;
    });
    await page.goto(origin + '/overlay/' + OTHER + '?obs=1');
    await page.bringToFront();
    await page.waitForFunction(
      () =>
        document.body.dataset.connection === 'connected' &&
        Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 2,
    );
    await page.locator('canvas.relic3d').evaluate((c) => c.setAttribute('data-render-profile', ''));
    cdp = await context.newCDPSession(page);
    await page.waitForTimeout(options.warmupMs);
    await sample();
    observationStart = performance.now();
    const checkpointMs = options.mode === 'obs-probe' ? 10000 : 300000;
    let checkpoint = checkpointMs;
    stage = 'obs-idle-observation';
    while (performance.now() - observationStart < options.durationMs) {
      await page.waitForTimeout(1000);
      const elapsed = performance.now() - observationStart;
      if (elapsed >= checkpoint) {
        await sample();
        checkpoint += checkpointMs;
      }
      assert.equal(await page.locator('body').getAttribute('data-connection'), 'connected');
    }
    idleObservationMs = Math.round(performance.now() - observationStart);
    const expectedSamples = options.mode === 'obs-wall' ? 13 : 3;
    if (samples.length < expectedSamples) await sample();
    assert.equal(samples.length, expectedSamples);
    assert.ok(performance.now() - observationStart >= options.durationMs);
    stage = 'obs-post-idle-arrival';
    const beforeArrivalFrames = Number(
      await page.locator('canvas.relic3d').getAttribute('data-frames'),
    );
    const projected = await review.projectArrival(OTHER);
    await page.waitForFunction(
      (before) =>
        document.body.dataset.connection === 'connected' &&
        document.body.classList.contains('arrival-takeover') &&
        ['streak', 'impact', 'unfurl'].includes(document.querySelector('.archive').dataset.phase) &&
        Number(document.querySelector('canvas.relic3d')?.dataset.frames) > before,
      beforeArrivalFrames,
    );
    assert.equal(await page.locator('#arrival-action').innerText(), 'Receiving chat: !accept');
    assert.ok(await growthPixels(page, () => page.waitForTimeout(100)));
    const postArrival = await page.evaluate(() => ({
      phaseCode: ['idle', 'streak', 'impact', 'unfurl', 'settled'].indexOf(
        document.querySelector('.archive').dataset.phase,
      ),
      frames: Number(document.querySelector('canvas.relic3d').dataset.frames),
      countdown: Number(document.querySelector('#arrival-countdown').textContent),
      geometry: Number(document.querySelector('canvas.relic3d').dataset.geometryCount),
      textures: Number(document.querySelector('canvas.relic3d').dataset.textureCount),
      triangles: Number(document.querySelector('canvas.relic3d').dataset.triangles),
      sprites: Number(document.querySelector('canvas.relic3d').dataset.sprites),
      active: document.querySelector('canvas.relic3d').dataset.contextStatus === 'active',
      width: document.querySelector('canvas.relic3d').width,
      height: document.querySelector('canvas.relic3d').height,
    }));
    assert.ok(postArrival.phaseCode >= 1 && postArrival.phaseCode <= 3);
    assert.ok(postArrival.frames > beforeArrivalFrames);
    assert.ok(postArrival.countdown > 160 && postArrival.countdown <= 180);
    assert.ok(postArrival.width <= 480 && postArrival.height <= 480);
    assert.equal(projected.endsAt - projected.startedAt, 180000);
    assert.equal(postArrival.active, true);
    assert.ok(postArrival.geometry <= samples[0].geometry + 2);
    assert.ok(postArrival.textures <= samples[0].textures + 2);
    assert.ok(postArrival.triangles < 20000 && postArrival.sprites <= 160);
    const postDOM = await cdp.send('Memory.getDOMCounters');
    assert.ok(postDOM.nodes <= samples[0].nodes + 64);
    assert.ok(postDOM.jsEventListeners <= samples[0].listeners + 8);
    assert.ok(postDOM.documents <= samples[0].documents + 1);
    arrivalObserved = true;
    diagnostic.postIdlePhaseCode = postArrival.phaseCode;
    diagnostic.postIdleFrames = postArrival.frames;
    diagnostic.postIdleCountdown = postArrival.countdown;
    assert.ok(overlaySoakBounds(samples));
    assert.deepEqual(await page.evaluate(() => window.__obsIdle), {
      input: 0,
      actions: 0,
      downloads: 0,
    });
    assert.equal(sockets, 1, 'Retained read socket; no idle reconnect or action loop');
    assert.equal(f.calls.length, 0);
    assert.deepEqual(await f.runtime.state.getKeeperRegistry(), registryBefore);
    assert.deepEqual(await f.runtime.state.getPublicJourney(), journeyBefore);
    assert.equal(forbidden, 0);
    assert.deepEqual(review.stats(), { errors: 0, external: 0 });
    diagnostic.obsIdleNoInput = 1;
  } else {
    stage = 'fixture';
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      f.streams.get(id).viewer_count = 1;
      await f.control(id, 'bootstrap');
      advanceFixture();
      await f.control(id, 'keep');
      advanceFixture();
    }
    await f.control(HOME, `send:${OTHER}`);
    await f.raid();
    await f.chat(HOME, '6500', '!offer');
    await f.chat(OTHER, '6501', '!accept');
    advanceFixture(240000); // Initial completed arrival is elapsed, not restarted on read.
    await page.setViewportSize({ width: 480, height: 800 });
    stage = 'overlay-navigation';
    await page.goto(origin + '/overlay/' + OTHER);
    await page.bringToFront();
    // Playwright keyboard input is browser-trusted; never forge isTrusted or
    // change the production ten-minute human-idle policy.
    const activeInput = async () => {
      stage = 'trusted-input';
      await page.keyboard.press('Shift');
      trustedInputCount++;
    };
    stage = 'frame-ready';
    await page.waitForFunction(
      () =>
        document.body.dataset.connection === 'connected' &&
        Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 2,
    );
    await page.locator('canvas.relic3d').evaluate((c) => c.setAttribute('data-render-profile', ''));
    cdp = await context.newCDPSession(page);
    stage = 'warmup';
    await activeInput();
    stage = 'warmup';
    await page.waitForTimeout(options.warmupMs);
    advanceFixture(options.warmupMs);
    await sample();
    observationStart = performance.now();
    await activeInput();
    let nextInputAt = performance.now() + 300000;
    let nextUpdate = options.mode === 'smoke' ? 2000 : 60000;
    let nextCheckpoint = options.mode === 'smoke' ? 10000 : 300000;
    while (logicalElapsedMs < options.durationMs) {
      if (performance.now() >= nextInputAt) {
        await activeInput();
        nextInputAt = performance.now() + 300000;
      }
      const previousLogical = logicalElapsedMs;
      if (options.logical) {
        advanceFixture(60000);
        logicalElapsedMs = Math.min(options.durationMs, logicalElapsedMs + 60000);
        stage = 'logical-wait';
        await page.waitForTimeout(100);
      } else {
        stage = 'observation-wait';
        await page.waitForTimeout(1000);
        logicalElapsedMs = overlayFixtureElapsed(
          performance.now() - observationStart,
          options.durationMs,
        );
        advanceFixture(logicalElapsedMs - previousLogical);
      }
      stage = 'peak-heap';
      const live = await cdp.send('Runtime.getHeapUsage');
      peakHeap = Math.max(peakHeap, live.usedSize);
      if (logicalElapsedMs >= nextUpdate) {
        const actor = String(7000 + (cycles % 32));
        requestedActor = actor;
        stage = 'cycle-mark';
        await f.chat(OTHER, actor, '!mark moon');
        stage = 'cycle-mark-read';
        const doc = await f.runtime.state.getPrivateMarks(OTHER, {
          broadcasterId: OTHER,
          chatterId: OTHER,
        });
        const mark = doc.sessions.flatMap((s) => s.marks).find((m) => m.userId === actor);
        assert.ok(mark);
        stage = 'cycle-approve';
        await f.chat(OTHER, OTHER, `!relic approve ${mark.id}`);
        stage = 'rune-visible';
        await page.waitForFunction(() => document.querySelector('#runes').children.length > 0);
        stage = 'cycle-forget';
        await f.chat(OTHER, actor, '!relic forgetme');
        stage = 'rune-cleared';
        await page.waitForFunction(() => document.querySelector('#runes').children.length === 0);
        cycles++;
        f.calls.length = 0; // No retained growing provider-call history in this long fixture.
        if (cycles % 5 === 0) {
          stage = 'socket-drop';
          review.dropConnections();
          await page.waitForFunction(() => document.body.dataset.connection !== 'connected');
          stage = 'socket-reconnect';
          await page.waitForFunction(() => document.body.dataset.connection === 'connected');
        }
        nextUpdate += options.mode === 'smoke' ? 2000 : 60000;
      }
      if (logicalElapsedMs >= nextCheckpoint || logicalElapsedMs >= options.durationMs) {
        stage = 'checkpoint-wait';
        await page.waitForTimeout(150);
        await sample();
        nextCheckpoint += options.mode === 'smoke' ? 10000 : 300000;
      }
    }
    assert.ok(overlaySoakBounds(samples));
    assert.equal(forbidden, 0);
    assert.deepEqual(review.stats(), { errors: 0, external: 0 });
    assert.ok(cycles > 0 && cycles <= 120);
    if (['wall', 'wall-probe'].includes(options.mode))
      assert.ok(performance.now() - observationStart >= options.durationMs);
  }
  passed = true;
  stage = 'complete';
} catch (e) {
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(e?.name)
    ? e.name
    : 'fixture-or-browser';
  const line = /soak-overlay[.]js:(\d+)/.exec(e?.stack ?? '');
  diagnostic.assertionLine = line ? Number(line[1]) : 0;
  diagnostic.cycle = cycles;
  diagnostic.logicalClockMs = logicalElapsedMs;
  diagnostic.fixtureClockInteger = Number.isSafeInteger(fixture?.now()) ? 1 : 0;
  try {
    if (fixture) {
      const channel = await fixture.runtime.state.getStreamStatus(OTHER);
      const doc = await fixture.runtime.state.getPrivateMarks(OTHER, {
        broadcasterId: OTHER,
        chatterId: OTHER,
      });
      const marks = doc.sessions.flatMap((s) => s.marks);
      diagnostic.channelOnline = channel?.online ? 1 : 0;
      diagnostic.channelOptedIn = channel?.optedIn ? 1 : 0;
      diagnostic.channelPaused = channel?.paused ? 1 : 0;
      diagnostic.channelBanned = channel?.banned ? 1 : 0;
      diagnostic.approvedMarkCount = marks.filter((m) => m.status === 'approved').length;
      diagnostic.pendingMarkCount = marks.filter((m) => m.status === 'pending').length;
      diagnostic.actorSpent =
        doc.sessions.flatMap((s) => s.viewers).find((v) => v.userId === requestedActor)?.spent ?? 0;
      diagnostic.privacyFloorMs = fixture.db?.docs.get(`presence/${hash(OTHER)}`)?.notBefore ?? -1;
    }
  } catch {
    diagnostic.stateDiagnosticUnavailable = 1;
  }
  let diagnosticTimer;
  try {
    Object.assign(
      diagnostic,
      await Promise.race([
        review.page.evaluate(() => ({
          domRuneCount: document.querySelector('#runes')?.children.length ?? -1,
          connectionCode: ['connected', 'connecting', 'reconnecting', 'stale', 'suspended'].indexOf(
            document.body.dataset.connection,
          ),
          contextStatusCode: ['active', 'lost', 'disposed'].indexOf(
            document.querySelector('canvas.relic3d')?.dataset.contextStatus,
          ),
        })),
        new Promise((_, reject) => {
          diagnosticTimer = setTimeout(() => reject(Error()), 1500);
        }),
      ]),
    );
  } catch {
    diagnostic.domDiagnosticUnavailable = 1;
  } finally {
    clearTimeout(diagnosticTimer);
  }
} finally {
  clearTimeout(deadline);
  const actualElapsedMs =
    observationStart === null ? 0 : Math.round(performance.now() - observationStart);
  try {
    await review?.close();
  } catch {
    diagnostic.cleanupFailed = 1;
    passed = false;
    failureCategory ??= 'cleanup';
  }
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
    fullHour: options?.mode === 'obs-wall' && idleObservationMs >= 3600000,
    idleObservationMs,
    arrivalObserved,
    syntheticTransportArrival: ['obs-wall', 'obs-probe'].includes(options?.mode),
    checkpoints: samples.length,
    samples,
    cycles,
    frames,
    peakHeap,
    requests,
    sockets,
    trustedInputCount,
    forbidden,
    errors: review?.stats().errors ?? 0,
    assets,
    diagnostic,
  };
  const encoded = JSON.stringify(report);
  assert.ok(Buffer.byteLength(encoded) <= 65536);
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/overlay-soak-results.json', encoded + '\n');
}
if (!passed) process.exitCode = 1;
