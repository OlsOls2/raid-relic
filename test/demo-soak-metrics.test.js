import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { analyseDemoSoak, DEMO_SOAK_MS } from '../test-support/demo-soak-metrics.js';
const sample = (i, delta = 0) => ({
  atMs: i * 35000,
  heapUsedBeforeGC: 9000000 + delta,
  heapRetained: 5000000 + delta,
  nodes: 100,
  listeners: 20,
  documents: 1,
  openSockets: 0,
  pages: 1,
  contexts: 1,
  canvases: 1,
  activeCanvases: 0,
});
test('soak analysis accepts bounded reset noise and exposes raw/retained peaks, slope and endpoint counts', () => {
  const a = Array.from({ length: 27 }, (_, i) => sample(i, i % 2 ? 5000 : 0)),
    r = analyseDemoSoak(a);
  assert.ok(r.heapPassed && r.domPassed && r.isolationPassed);
  assert.equal(r.heapGrowthBytes, 0);
  assert.equal(r.heapPeakBytes, 9005000);
  assert.equal(r.heapRetainedPeakBytes, 5005000);
  assert.equal(r.pagesEnd, 1);
  assert.equal(DEMO_SOAK_MS, 900000);
});
test('soak analysis rejects sustained heap slope, excessive retained growth, DOM/listener and context/socket leaks', () => {
  let a = Array.from({ length: 27 }, (_, i) => sample(i, i * 20000));
  assert.equal(analyseDemoSoak(a).heapPassed, false);
  a = Array.from({ length: 27 }, (_, i) => sample(i, i * 100000));
  assert.equal(analyseDemoSoak(a).heapPassed, false);
  for (const patch of [{ nodes: 109 }, { listeners: 25 }, { documents: 2 }]) {
    a = [sample(0), { ...sample(1), ...patch }];
    assert.equal(analyseDemoSoak(a).domPassed, false);
  }
  for (const patch of [
    { openSockets: 1 },
    { pages: 2 },
    { contexts: 2 },
    { canvases: 2 },
    { activeCanvases: 1 },
  ])
    assert.equal(analyseDemoSoak([sample(0), { ...sample(1), ...patch }]).isolationPassed, false);
});
test('missing/nonfinite metrics or unbounded/unordered samples cannot become a pass', () => {
  for (const a of [
    [],
    [sample(0)],
    [sample(0), sample(0)],
    [sample(0), { ...sample(1), heapRetained: NaN }],
    Array.from({ length: 101 }, (_, i) => sample(i)),
  ])
    assert.throws(() => analyseDemoSoak(a));
});
test('official soak fixes real duration/viewport/sandbox and has no virtual clock or duration override', async () => {
  const s = (await readFile('scripts/browser-soak-demo.js', 'utf8')).replace(/\s+/g, '');
  assert.match(s, /DEMO_SOAK_MS/);
  assert.match(s, /performance\.now\(\)-steadyStart/);
  assert.match(s, /warmupCycles===2/);
  assert.match(s, /cycles>=20/);
  assert.match(s, /chromiumSandbox:true/);
  assert.match(s, /width:390,height:844/);
  assert.match(s, /HeapProfiler.collectGarbage/);
  assert.match(s, /Memory.getDOMCounters/);
  assert.doesNotMatch(s, /page\.clock|runFor\(|performance,'now'|process\.env|--no-sandbox/);
  assert.match(s, /demo-soak-browser-results\.json/);
});

test('partial failed soak retains trends without claiming a900s pass and error classification never reads messages', async () => {
  const { partialDemoSoak, closedSoakError, browserCpuSummary } =
    await import('../test-support/demo-soak-metrics.js');
  const partial = partialDemoSoak(
    Array.from({ length: 13 }, (_, i) => sample(i, i * 100)),
    473368,
    12,
  );
  assert.equal(partial.analysisAvailable, true);
  assert.equal(partial.partialAnalysis, true);
  assert.equal(partial.observationComplete, false);
  assert.equal(partial.heapEndBytes, 5001200);
  assert.equal(partialDemoSoak([sample(0)], 100, 0).analysisAvailable, false);
  for (const name of ['TimeoutError', 'TargetClosedError', 'ProtocolError'])
    assert.equal(
      closedSoakError({
        name,
        get message() {
          throw Error('must not read');
        },
      }),
      name,
    );
  assert.equal(closedSoakError({ name: 'private-value' }), 'Other');
  const cpu = browserCpuSummary([
    { type: 'renderer', id: 999, cpuTime: 115.5 },
    { type: 'GPU', id: 888, cpuTime: 117 },
    { type: 'browser', id: 777, cpuTime: 15 },
  ]);
  assert.deepEqual(cpu, {
    maxRendererCpuSeconds: 115.5,
    maxGpuCpuSeconds: 117,
    maxBrowserCpuSeconds: 15,
  });
  assert.doesNotMatch(JSON.stringify(cpu), /999|888|777|pid/);
});

test('reset sampling permits one stable hidden scene but rejects active or accumulating canvases', () => {
  assert.equal(analyseDemoSoak([sample(0), sample(1)]).isolationPassed, true);
  for (const patch of [{ activeCanvases: 1 }, { canvases: 2 }, { canvases: 0 }])
    assert.equal(analyseDemoSoak([sample(0), { ...sample(1), ...patch }]).isolationPassed, false);
});
test('demo visible reset leases its scene; only lifecycle release permanently disposes', async () => {
  const original = await readFile('public/demo.js', 'utf8'),
    s = original.replace(/\s+/g, '');
  const stop = s.slice(s.indexOf('functionstop('), s.indexOf('functiontick('));
  const reset = s.slice(s.indexOf('functionreset('), s.indexOf("$('demo-reset').onclick"));
  assert.match(stop, /view\?\.update\(null\)/);
  assert.doesNotMatch(stop + reset, /\.dispose\(/);
  assert.match(s, /functionreleaseRenderer\(\).*view\?\.dispose\(\)/);
  assert.match(s, /if\(document.hidden\)\{stop\(\);releaseRenderer\(\);\}/);
  assert.match(s, /pagehide.*reset\(\);releaseRenderer\(\)/);
  assert.match(s, /if\(motion.matches\)\{releaseRenderer\(\);\}/);
});

test('fictional scene memo ignores only clock changes and includes every current semantic field', async () => {
  const { freshDemo, demoSceneKey, demoStep } = await import('../public/demo-state.js');
  const s = freshDemo(),
    key = demoSceneKey(s);
  assert.equal(demoSceneKey(demoStep(s, { type: 'advance', ms: 100 })), key);
  assert.equal(demoSceneKey(null), null);
  assert.deepEqual(
    Object.keys(s)
      .filter((k) => k !== 'clock')
      .sort(),
    [
      'rings',
      'phase',
      'acceptedAt',
      'receiptAt',
      'completedAt',
      'offer',
      'accept',
      'source',
      'target',
      'holder',
      'streak',
      'marks',
      'markUsed',
      'reviewClock',
      'markLastAt',
      'notice',
    ].sort(),
  );
  for (const field of Object.keys(s).filter((k) => k !== 'clock'))
    assert.notEqual(
      demoSceneKey({
        ...s,
        [field]:
          typeof s[field] === 'boolean'
            ? !s[field]
            : s[field] === null
              ? 1
              : typeof s[field] === 'number'
                ? 2
                : s[field] + ' changed',
      }),
      key,
      field,
    );
});

// Exercise the actual controller functions without browser globals or a media
// change event. The renderer itself is injected; no GL/provider work runs here.
async function motionController(overrides = {}) {
  const source = await readFile('public/demo.js', 'utf8');
  const functions =
    source.slice(source.indexOf('function updateView()'), source.indexOf('function render()')) +
    source.slice(source.indexOf('async function renderer()'), source.indexOf('function stop('));
  const context = {
    motion: { matches: false },
    document: { hidden: false },
    view: null,
    pending: null,
    epoch: 0,
    viewKey: 'old',
    sceneKey: 'old',
    sceneSnapshot: { stale: true },
    state: { phase: 'countdown', completedAt: null },
    playing: true,
    growthExample: null,
    AbortController,
    $: () => ({}),
    scene: () => ({ marks: [] }),
    ...overrides,
  };
  runInNewContext(functions, context);
  return context;
}

test('current reduced preference permanently releases a cached scene without a change event', async () => {
  let disposals = 0;
  const c = await motionController({
    view: {
      dispose() {
        disposals++;
      },
      update() {
        assert.fail('reduced scene update');
      },
    },
  });
  c.motion.matches = true;
  c.updateView();
  c.updateView();
  await c.renderer();
  assert.equal(disposals, 1);
  assert.equal(c.view, null);
  assert.equal(c.sceneSnapshot, null);
  assert.equal(c.sceneKey, null);
  assert.equal(c.viewKey, null);
});

test('eventless reduced preference aborts pending creation and disposes its late result once', async () => {
  let resolve,
    signal,
    creates = 0,
    disposals = 0;
  const c = await motionController({
    createRelic3D: (options) => {
      creates++;
      signal = options.signal;
      return new Promise((done) => {
        resolve = done;
      });
    },
  });
  const waiting = c.renderer();
  c.motion.matches = true;
  c.updateView();
  assert.equal(signal.aborted, true);
  resolve({
    dispose() {
      disposals++;
    },
    update() {
      assert.fail('stale update');
    },
  });
  await waiting;
  await c.renderer();
  assert.equal(creates, 1);
  assert.equal(disposals, 1);
  assert.equal(c.view, null);
  assert.equal(c.pending, null);
});

test('creation rechecks reduced preference; normal motion can later create a fresh static scene', async () => {
  let resolve,
    disposals = 0,
    updates = 0;
  const c = await motionController({
    createRelic3D: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const waiting = c.renderer();
  c.motion.matches = true;
  resolve({
    dispose() {
      disposals++;
    },
    update() {
      assert.fail('reduced late update');
    },
  });
  await waiting;
  assert.equal(disposals, 1);
  assert.equal(c.view, null);
  c.motion.matches = false;
  c.playing = false;
  c.state = { phase: 'settled', completedAt: 1000 };
  c.createRelic3D = async () => ({
    dispose() {
      disposals++;
    },
    update(value, options) {
      assert.deepEqual(value, { marks: [] });
      assert.equal(options.animate, false);
      updates++;
    },
  });
  await c.renderer();
  c.updateView();
  assert.equal(updates, 1);
  assert.equal(disposals, 1);
});
