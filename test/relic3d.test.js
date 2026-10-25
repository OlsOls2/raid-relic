import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DESIGN, crystalMesh, validRelicDesign, frameInterval, ringSummary, createRelic3D } from '../public/relic3d.js';
test('original crystal geometry is deterministic and all Forge bounds stay below triangle budget', () => {
  for (const facets of [3, 6, 12]) for (const shape of ['crystal', 'orb', 'seed']) {
    const design = { ...DEFAULT_DESIGN, facets, shape };
    const mesh = crystalMesh(design); assert.deepEqual(mesh, crystalMesh(design));
    assert.equal(mesh.triangles, facets * 6); assert.ok(mesh.positions.every(Number.isFinite));
    assert.ok(mesh.triangles * 2 + 16 * 2 * 8 * 24 * 2 + 160 * 2 < 20000);
  }
  for (const bad of [{ ...DEFAULT_DESIGN, facets: 13 }, { ...DEFAULT_DESIGN, aspect: NaN }, { ...DEFAULT_DESIGN, palette: ['url(x)'] }, { ...DEFAULT_DESIGN, extra: true }]) {
    assert.equal(validRelicDesign(bad), false); assert.throws(() => crystalMesh(bad));
  }
});
test('frame budgets distinguish idle, verified arrival and reduced corner', () => {
  assert.equal(frameInterval(false), 1000 / 30); assert.equal(frameInterval(true), 1000 / 60); assert.equal(frameInterval(true, true), 1000 / 30);
});
test('reduced motion never imports WebGL; missing vendor fails to SVG without throwing', async () => {
  let imports = 0; const archive = { classList: { remove() {} } };
  const motion = await createRelic3D({ archive, reducedMotion: { matches: true }, load: () => { imports++; throw Error(); } });
  assert.equal(imports, 0); assert.equal(motion.available, false);
  const missing = await createRelic3D({ archive, reducedMotion: { matches: false }, load: () => { imports++; throw Error('no vendor'); } });
  assert.equal(imports, 1); assert.equal(missing.available, false); missing.update(null); missing.dispose();
});
test('injected renderer pauses hidden, discards stale sprite loads, and context loss restores SVG', async () => {
  const listeners = {}, classes = new Set(), pending = new Map(), images = []; let sequence = 0, renders = 0, disposed = 0;
  const canvas = { dataset: {}, width: 0, hidden: true, setAttribute() {}, addEventListener(n, f) { listeners[n] = f; }, remove() {} };
  class Object3D { constructor() { this.rotation = {}; this.position = { set() {} }; this.scale = { set() {} }; } add() {} remove() {} }
  class Resource { constructor() {} setAttribute() {} computeVertexNormals() {} dispose() { disposed++; } }
  class Mesh extends Object3D { constructor(g, m) { super(); this.geometry = g; this.material = m; } }
  class Material extends Resource { constructor(options) { super(); Object.assign(this, options); } }
  class Image { constructor() { images.push(this); } }
  const T = { WebGLRenderer: class { constructor() { this.domElement = canvas; } setPixelRatio(n) { assert.equal(n, 1); } setClearColor(c, a) { assert.equal(a, 0); } setSize(n) { canvas.width = n; } render() { renders++; } dispose() { disposed++; } },
    Scene: Object3D, Group: Object3D, PerspectiveCamera: Object3D, BufferGeometry: Resource, Float32BufferAttribute: Resource,
    ShaderMaterial: Material, Mesh, TorusGeometry: Resource, MeshBasicMaterial: Material, Texture: Resource, SpriteMaterial: Material,
    Sprite: class extends Mesh { constructor(m) { super(undefined, m); } } };
  const win = { Image, requestAnimationFrame(f) { const id = ++sequence; pending.set(id, f); return id; }, cancelAnimationFrame(id) { pending.delete(id); } };
  const doc = { hidden: false, addEventListener(n, f) { listeners[n] = f; }, removeEventListener() {} };
  const reducedMotion = { matches: false, addEventListener(n, f) { listeners.motion = f; }, removeEventListener() {} };
  const archive = { dataset: { phase: 'idle' }, getBoundingClientRect: () => ({ width: 160 }), append() {}, classList: { add: n => classes.add(n), remove: n => classes.delete(n) } };
  const view = await createRelic3D({ archive, reducedMotion, corner: true, document: doc, window: win, load: async () => T });
  const tick = time => { const item = pending.entries().next().value; if (item) { pending.delete(item[0]); item[1](time); } };
  view.update({ lineageRings: 16, marks: [{ runeSvg: '<svg/>', faded: true }] }); tick(0); assert.equal(renders, 1); tick(10); assert.equal(renders, 1); tick(34); assert.equal(renders, 2);
  const beforeReuse = disposed, imageCount = images.length;
  view.update({ lineageRings: 16, marks: [{ runeSvg: '<svg/>', faded: true }], claimMeter: { offers: 1 }, serverNow: 500 });
  assert.equal(disposed, beforeReuse); assert.equal(images.length, imageCount); assert.equal(pending.size, 1);
  tick(40); assert.equal(renders, 2); // unchanged update must not reset the30fps budget
  assert.equal(canvas.dataset.snapshotPresent, 'true');
  reducedMotion.matches = true; listeners.motion(); assert.equal(canvas.hidden, true); assert.equal(classes.has('webgl-relic'), false); assert.equal(pending.size, 0);
  reducedMotion.matches = false; listeners.motion(); tick(68); assert.equal(canvas.hidden, false); assert.equal(classes.has('webgl-relic'), true);
  reducedMotion.matches = true; listeners.motion(); assert.equal(canvas.hidden, true);
  reducedMotion.matches = false; view.wake(); tick(102); // transition wake recovers a missed MQL event
  assert.equal(canvas.hidden, false); assert.equal(classes.has('webgl-relic'), true); assert.equal(pending.size, 1);
  images[0].onerror(); assert.equal(canvas.dataset.spriteFailures, '1');
  view.update({ lineageRings: 0, marks: [] }); assert.equal(canvas.dataset.spriteFailures, '0'); const before = disposed; images[0].onerror(); assert.equal(canvas.dataset.spriteFailures, '0'); images[0].onload(); assert.equal(disposed, before); // stale load creates no resources
  doc.hidden = true; listeners.visibilitychange(); assert.equal(pending.size, 0); assert.equal(classes.has('webgl-relic'), false);
  doc.hidden = false; listeners.visibilitychange(); tick(100); assert.equal(classes.has('webgl-relic'), true);
  view.update(null); listeners.visibilitychange(); assert.equal(pending.size, 0);
  view.update({ lineageRings: 0, marks: [] }); tick(140);
  listeners.webglcontextlost({ preventDefault() {} }); assert.equal(pending.size, 0); assert.equal(canvas.hidden, true); assert.equal(classes.has('webgl-relic'), false);
  view.dispose(); assert.ok(disposed > 0);
  listeners.visibilitychange(); assert.equal(pending.size, 0);
});
test('vendored Three.js module is local, MIT-labelled and exposes the renderer contract', async () => {
  const { readFile } = await import('node:fs/promises');
  const T = await import('../public/vendor/three.module.js');
  for (const name of ['WebGLRenderer', 'BufferGeometry', 'ShaderMaterial', 'TorusGeometry', 'SpriteMaterial']) assert.equal(typeof T[name], 'function');
  assert.match(await readFile('public/vendor/LICENSE-three.txt', 'utf8'), /The MIT License/);
  assert.equal(T.REVISION, '186');
});

test('abort during vendor import creates no late canvas; visual cap reports actual count', async () => {
  const controller = new AbortController(); let resolve, appended = 0;
  const archive = { append() { appended++; }, classList: { remove() {} } };
  const viewPromise = createRelic3D({ archive, signal: controller.signal, reducedMotion: { matches: false, removeEventListener() {} },
    document: { removeEventListener() {} }, window: {}, load: () => new Promise(r => { resolve = r; }) });
  controller.abort(); resolve({ WebGLRenderer: class { constructor() { assert.fail('Late renderer created'); } } });
  const view = await viewPromise; assert.equal(view.available, false); assert.equal(appended, 0);
  assert.deepEqual(ringSummary(19), { total: 19, visible: 16, text: '19 completed rings · 16 visual bands shown' });
});
test('failed optional import cleans up when injected document/listener methods are absent', async () => {
  const view = await createRelic3D({ archive: { classList: { remove() {} } }, reducedMotion: { matches: false }, document: undefined,
    load: async () => { throw Error('synthetic missing vendor'); } });
  assert.equal(view.available, false); view.dispose();
});
