import test from 'node:test';
import assert from 'node:assert/strict';
import { overlaySoakOptions, overlaySoakBounds } from '../test-support/overlay-soak.js';
test('overlay soak explicitly distinguishes real two-hour wall time from accelerated fixture time', () => {
  assert.equal(overlaySoakOptions().mode, 'smoke');
  assert.throws(() => overlaySoakOptions(['--mode=wall']));
  assert.equal(overlaySoakOptions(['--mode=wall', '--duration-ms=7200000']).logical, false);
  assert.equal(overlaySoakOptions(['--mode=logical']).logical, true);
  assert.throws(() => overlaySoakOptions(['--duration-ms=10']));
  assert.throws(() => overlaySoakOptions(['--mode=smoke', '--mode=logical']));
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
