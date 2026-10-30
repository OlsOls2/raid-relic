import test from 'node:test';
import assert from 'node:assert/strict';
import {
  overlaySoakOptions,
  overlaySoakBounds,
  overlayFixtureElapsed,
} from '../test-support/overlay-soak.js';
test('overlay soak explicitly distinguishes real two-hour wall time from accelerated fixture time', () => {
  assert.equal(overlaySoakOptions().mode, 'smoke');
  assert.throws(() => overlaySoakOptions(['--mode=obs-probe']));
  assert.throws(() => overlaySoakOptions(['--mode=obs-probe', '--duration-ms=3600000']));
  assert.throws(() => overlaySoakOptions(['--mode=obs-wall', '--duration-ms=20000']));
  const probe = overlaySoakOptions(['--mode=obs-probe', '--duration-ms=20000']);
  assert.equal(probe.durationMs, 20000);
  assert.equal(probe.logical, false);
  assert.equal(probe.warmupMs, 2000);
  const hour = overlaySoakOptions(['--mode=obs-wall', '--duration-ms=3600000']);
  assert.equal(hour.durationMs, 3600000);
  assert.equal(hour.logical, false);

  assert.throws(() => overlaySoakOptions(['--mode=wall']));
  assert.equal(overlaySoakOptions(['--mode=wall', '--duration-ms=7200000']).logical, false);
  assert.equal(overlaySoakOptions(['--mode=logical']).logical, true);
  assert.throws(() => overlaySoakOptions(['--duration-ms=10']));
  assert.throws(() => overlaySoakOptions(['--mode=smoke', '--mode=logical']));
  assert.equal(
    overlaySoakOptions(['--mode=wall-probe', '--duration-ms=600000']).durationMs,
    600000,
  );
  assert.equal(overlaySoakOptions(['--mode=wall-probe', '--duration-ms=600000']).warmupMs, 2000);
  assert.throws(() => overlaySoakOptions(['--mode=wall-probe']));
  assert.throws(() => overlaySoakOptions(['--mode=wall-probe', '--duration-ms=7200000']));
  assert.throws(() => overlaySoakOptions(['--mode=wall', '--duration-ms=600000']));
});
test('wall fixture uses integer cumulative milliseconds without losing fractional interval remainder', () => {
  let fixtureNow = 1800000000000,
    previous = 0;
  for (const actual of [1000.75, 2001.5, 60000.25, 480025.999, 600000.75]) {
    const elapsed = overlayFixtureElapsed(actual, 600000);
    fixtureNow += elapsed - previous;
    previous = elapsed;
    assert.ok(Number.isSafeInteger(fixtureNow));
    assert.equal(fixtureNow, 1800000000000 + Math.floor(Math.min(actual, 600000)));
    assert.equal(new Date(fixtureNow).getTime(), fixtureNow);
  }
  assert.equal(previous, 600000);
  for (const invalid of [NaN, Infinity, -1])
    assert.throws(() => overlayFixtureElapsed(invalid, 600000));
});
test('retained metric gates reject stopped rendering, excessive retained growth and accumulating resources', () => {
  const a = {
    heap: 4000000,
    frames: 10,
    canvases: 1,
    geometry: 5,
    textures: 2,
    nodes: 500,
    listeners: 60,
    documents: 2,
    triangles: 868,
  };
  assert.equal(overlaySoakBounds([a, { ...a, frames: 20 }]), true);
  for (const change of [
    { frames: 10 },
    { heap: 20000000 },
    { canvases: 2 },
    { geometry: 8 },
    { listeners: 80 },
    { nodes: 600 },
    { triangles: 20000 },
  ])
    assert.equal(overlaySoakBounds([a, { ...a, frames: 20, ...change }]), false);
});
