import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DESIGN,
  crystalMesh,
  validRelicDesign,
  frameInterval,
  ringSummary,
  renderViewport,
  lowPowerWidget,
  createRelic3D,
} from '../public/relic3d.js';
test('original crystal geometry is deterministic and all Forge bounds stay below triangle budget', () => {
  for (const facets of [3, 6, 12])
    for (const shape of ['crystal', 'orb', 'seed']) {
      const design = { ...DEFAULT_DESIGN, facets, shape };
      const mesh = crystalMesh(design);
      assert.deepEqual(mesh, crystalMesh(design));
      assert.equal(mesh.triangles, facets * 6);
      assert.ok(mesh.positions.every(Number.isFinite));
      assert.ok(mesh.triangles * 2 + 16 * 2 * 8 * 24 * 2 + 160 * 2 < 20000);
    }
  for (const bad of [
    { ...DEFAULT_DESIGN, facets: 13 },
    { ...DEFAULT_DESIGN, aspect: NaN },
    { ...DEFAULT_DESIGN, palette: ['url(x)'] },
    { ...DEFAULT_DESIGN, extra: true },
  ]) {
    assert.equal(validRelicDesign(bad), false);
    assert.throws(() => crystalMesh(bad));
  }
});
test('frame budgets distinguish idle, verified arrival and reduced corner', () => {
  assert.equal(frameInterval(false), 1000 / 30);
  assert.equal(frameInterval(true), 1000 / 60);
  assert.equal(frameInterval(true, true), 1000 / 30);
  assert.equal(frameInterval(true, false, true), 1000 / 24);
  assert.equal(frameInterval(false, false, true), 1000 / 10);
  assert.equal(frameInterval(true, true, true), 1000 / 30);
  assert.equal(frameInterval(false, true, true), 1000 / 30);
});
test('reduced motion never imports WebGL; missing vendor fails to SVG without throwing', async () => {
  let imports = 0;
  const archive = { classList: { remove() {} } };
  const motion = await createRelic3D({
    archive,
    reducedMotion: { matches: true },
    load: () => {
      imports++;
      throw Error();
    },
  });
  assert.equal(imports, 0);
  assert.equal(motion.available, false);
  const missing = await createRelic3D({
    archive,
    reducedMotion: { matches: false },
    load: () => {
      imports++;
      throw Error('no vendor');
    },
  });
  assert.equal(imports, 1);
  assert.equal(missing.available, false);
  missing.update(null);
  missing.dispose();
});
test('injected renderer pauses hidden, discards stale sprite loads, and context loss restores SVG', async () => {
  const listeners = {},
    classes = new Set(),
    pending = new Map(),
    images = [];
  let sequence = 0,
    renders = 0,
    disposed = 0,
    forced = 0,
    rendererDisposals = 0,
    sizeCalls = 0,
    projectionCalls = 0;
  let bounds = { width: 160, height: 160 };
  let testCamera;
  const canvas = {
    style: { display: 'block' },
    dataset: {},
    width: 0,
    hidden: true,
    setAttribute() {},
    addEventListener(n, f) {
      listeners[n] = f;
    },
    removeEventListener(n, f) {
      if (listeners[n] === f) delete listeners[n];
    },
    remove() {},
  };
  class Object3D {
    constructor() {
      this.rotation = {};
      this.position = { set() {} };
      this.scale = { set() {} };
    }
    add() {}
    remove() {}
  }
  class Resource {
    constructor() {}
    setAttribute() {}
    computeVertexNormals() {}
    dispose() {
      disposed++;
    }
  }
  class Mesh extends Object3D {
    constructor(g, m) {
      super();
      this.geometry = g;
      this.material = m;
    }
  }
  class Material extends Resource {
    constructor(options) {
      super();
      Object.assign(this, options);
    }
  }
  class Image {
    constructor() {
      images.push(this);
    }
  }
  const T = {
    WebGLRenderer: class {
      constructor(options) {
        assert.equal(options.antialias, false);
        this.domElement = canvas;
      }
      setPixelRatio(n) {
        assert.equal(n, 1);
      }
      setClearColor(c, a) {
        assert.equal(a, 0);
      }
      setSize(w, h) {
        sizeCalls++;
        canvas.width = w;
        canvas.height = h;
      }
      render() {
        renders++;
      }
      dispose() {
        disposed++;
        rendererDisposals++;
      }
      forceContextLoss() {
        forced++;
        assert.equal(rendererDisposals, 1);
        assert.equal(listeners.webglcontextlost, undefined);
        assert.equal(listeners.webglcontextrestored, undefined);
      }
    },
    Scene: Object3D,
    Group: Object3D,
    PerspectiveCamera: class extends Object3D {
      constructor() {
        super();
        testCamera = this;
      }
      updateProjectionMatrix() {
        projectionCalls++;
      }
    },
    BufferGeometry: Resource,
    Float32BufferAttribute: Resource,
    ShaderMaterial: Material,
    Mesh,
    TorusGeometry: Resource,
    MeshBasicMaterial: Material,
    Texture: Resource,
    SpriteMaterial: Material,
    Sprite: class extends Mesh {
      constructor(m) {
        super(undefined, m);
      }
    },
  };
  const win = {
    Image,
    requestAnimationFrame(f) {
      const id = ++sequence;
      pending.set(id, f);
      return id;
    },
    cancelAnimationFrame(id) {
      pending.delete(id);
    },
  };
  const doc = {
    hidden: false,
    addEventListener(n, f) {
      listeners[n] = f;
    },
    removeEventListener() {},
  };
  const reducedMotion = {
    matches: false,
    addEventListener(n, f) {
      listeners.motion = f;
    },
    removeEventListener() {},
  };
  const archive = {
    dataset: { phase: 'idle' },
    getBoundingClientRect: () => bounds,
    append() {},
    classList: { add: (n) => classes.add(n), remove: (n) => classes.delete(n) },
  };
  const view = await createRelic3D({
    archive,
    reducedMotion,
    corner: true,
    document: doc,
    window: win,
    load: async () => T,
  });
  assert.equal(canvas.hidden, true);
  assert.equal(canvas.style.display, 'none'); // vendor inline block must not flash before first successful frame
  const tick = (time) => {
    const item = pending.entries().next().value;
    if (item) {
      pending.delete(item[0]);
      item[1](time);
    }
  };
  view.update({ lineageRings: 16, marks: [{ runeSvg: '<svg/>', faded: true }] });
  tick(0);
  assert.equal(renders, 1);
  assert.equal(canvas.style.display, 'block');
  tick(10);
  assert.equal(renders, 1);
  tick(34);
  assert.equal(renders, 2);
  const beforeReuse = disposed,
    imageCount = images.length;
  view.update({
    lineageRings: 16,
    marks: [{ runeSvg: '<svg/>', faded: true }],
    claimMeter: { offers: 1 },
    serverNow: 500,
  });
  assert.equal(disposed, beforeReuse);
  assert.equal(images.length, imageCount);
  assert.equal(pending.size, 1);
  tick(40);
  assert.equal(renders, 2); // unchanged update must not reset the30fps budget
  assert.equal(canvas.dataset.snapshotPresent, 'true');
  assert.equal(sizeCalls, 1);
  assert.equal(projectionCalls, 1);
  bounds = { width: 358, height: 135 };
  tick(68);
  assert.equal(canvas.width, 358);
  assert.equal(canvas.height, 135);
  assert.equal(testCamera.aspect, 358 / 135);
  assert.equal(projectionCalls, 2);
  tick(102);
  assert.equal(sizeCalls, 2);
  bounds = { width: 0, height: 0 };
  const prior = renders;
  tick(136);
  assert.equal(renders, prior);
  assert.equal(canvas.hidden, true);
  bounds = { width: 160, height: 160 };
  tick(170);
  assert.equal(canvas.width, 160);
  assert.equal(canvas.height, 160);
  assert.equal(testCamera.aspect, 1);

  reducedMotion.matches = true;
  listeners.motion();
  assert.equal(canvas.hidden, true);
  assert.equal(canvas.style.display, 'none');
  assert.equal(classes.has('webgl-relic'), false);
  assert.equal(pending.size, 0);
  reducedMotion.matches = false;
  listeners.motion();
  assert.equal(canvas.style.display, 'none');
  tick(204);
  assert.equal(canvas.style.display, 'block');
  assert.equal(canvas.hidden, false);
  assert.equal(classes.has('webgl-relic'), true);
  reducedMotion.matches = true;
  listeners.motion();
  assert.equal(canvas.hidden, true);
  assert.equal(canvas.style.display, 'none');
  reducedMotion.matches = false;
  view.wake();
  tick(238); // transition wake recovers a missed MQL event
  assert.equal(canvas.hidden, false);
  assert.equal(classes.has('webgl-relic'), true);
  assert.equal(pending.size, 1);
  images[0].onerror();
  assert.equal(canvas.dataset.spriteFailures, '1');
  view.update({ lineageRings: 0, marks: [] });
  assert.equal(canvas.dataset.spriteFailures, '0');
  const before = disposed;
  images[0].onerror();
  assert.equal(canvas.dataset.spriteFailures, '0');
  images[0].onload();
  assert.equal(disposed, before); // stale load creates no resources
  doc.hidden = true;
  listeners.visibilitychange();
  assert.equal(pending.size, 0);
  assert.equal(classes.has('webgl-relic'), false);
  doc.hidden = false;
  listeners.visibilitychange();
  tick(272);
  assert.equal(classes.has('webgl-relic'), true);
  view.update({ lineageRings: 3, marks: [] });
  view.update(null);
  listeners.visibilitychange();
  assert.equal(pending.size, 0);
  assert.equal(canvas.hidden, true);
  assert.equal(canvas.style.display, 'none');
  assert.equal(canvas.dataset.bands, '0');
  assert.equal(canvas.dataset.sprites, '0');
  assert.equal(forced, 0);
  const pausedRenders = renders;
  tick(306);
  assert.equal(renders, pausedRenders);
  view.update({ lineageRings: 1, marks: [] }, { animate: false });
  const staticRenders = renders;
  assert.equal(canvas.hidden, false);
  assert.equal(canvas.dataset.bands, '2');
  assert.equal(pending.size, 0);
  tick(320);
  assert.equal(renders, staticRenders);
  view.update(null);
  assert.equal(canvas.hidden, true);
  assert.equal(canvas.dataset.bands, '0');
  view.update({ lineageRings: 0, marks: [] });
  tick(340);
  listeners.webglcontextlost({ preventDefault() {} });
  assert.equal(pending.size, 0);
  assert.equal(canvas.hidden, true);
  assert.equal(canvas.style.display, 'none');
  assert.equal(classes.has('webgl-relic'), false);
  view.wake();
  assert.equal(canvas.style.display, 'none');
  assert.equal(forced, 0);
  const staleRestore = listeners.webglcontextrestored;
  listeners.webglcontextrestored();
  tick(374);
  assert.equal(canvas.dataset.contextStatus, 'active');
  assert.equal(canvas.hidden, false);
  assert.equal(forced, 0);
  view.dispose();
  view.dispose();
  assert.ok(disposed > 0);
  assert.equal(forced, 1);
  assert.equal(rendererDisposals, 1);
  assert.equal(canvas.hidden, true);
  assert.equal(canvas.style.display, 'none');
  staleRestore();
  view.update({ lineageRings: 1, marks: [] });
  view.wake();
  assert.equal(pending.size, 0);
  listeners.visibilitychange();
  assert.equal(pending.size, 0);
});
test('vendored Three.js module is local, MIT-labelled and exposes the renderer contract', async () => {
  const { readFile } = await import('node:fs/promises');
  const T = await import('../public/vendor/three.module.js');
  for (const name of [
    'WebGLRenderer',
    'BufferGeometry',
    'ShaderMaterial',
    'TorusGeometry',
    'SpriteMaterial',
  ])
    assert.equal(typeof T[name], 'function');
  assert.match(await readFile('public/vendor/LICENSE-three.txt', 'utf8'), /The MIT License/);
  assert.equal(T.REVISION, '186');
});

test('abort during vendor import creates no late canvas; visual cap reports actual count', async () => {
  const controller = new AbortController();
  let resolve,
    appended = 0;
  const archive = {
    append() {
      appended++;
    },
    classList: { remove() {} },
  };
  const viewPromise = createRelic3D({
    archive,
    signal: controller.signal,
    reducedMotion: { matches: false, removeEventListener() {} },
    document: { removeEventListener() {} },
    window: {},
    load: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  controller.abort();
  resolve({
    WebGLRenderer: class {
      constructor() {
        assert.fail('Late renderer created');
      }
    },
  });
  const view = await viewPromise;
  assert.equal(view.available, false);
  assert.equal(appended, 0);
  assert.deepEqual(ringSummary(19), {
    total: 19,
    visible: 16,
    text: '19 completed rings · 16 visual bands shown',
  });
});
test('failed optional import cleans up when injected document/listener methods are absent', async () => {
  const view = await createRelic3D({
    archive: { classList: { remove() {} } },
    reducedMotion: { matches: false },
    document: undefined,
    load: async () => {
      throw Error('synthetic missing vendor');
    },
  });
  assert.equal(view.available, false);
  view.dispose();
});

test('50 permanent renderer disposals release context once after resources/listeners and cannot resume stale callbacks', async () => {
  let forces = 0;
  for (let i = 0; i < 50; i++) {
    const bounds = i % 3 === 0 ? { width: 358, height: 135 } : { width: 480, height: 480 },
      corner = i % 3 === 2;
    const events = new Map(),
      docEvents = new Map(),
      motionEvents = new Map(),
      pending = new Map(),
      order = [];
    let seq = 0;
    const canvas = {
      dataset: {},
      style: { display: 'block' },
      setAttribute() {},
      addEventListener: (n, f) => events.set(n, f),
      removeEventListener: (n, f) => {
        if (events.get(n) === f) events.delete(n);
      },
      remove() {
        order.push('remove');
      },
    };
    class Obj {
      constructor() {
        this.rotation = {};
        this.position = { set() {} };
        this.scale = { set() {} };
      }
      add() {}
      remove() {}
    }
    class Resource {
      setAttribute() {}
      computeVertexNormals() {}
      dispose() {
        order.push('resource');
      }
    }
    class Mat extends Resource {
      constructor(o) {
        super();
        Object.assign(this, o);
      }
    }
    class Mesh extends Obj {
      constructor(g, m) {
        super();
        this.geometry = g;
        this.material = m;
      }
    }
    const T = {
      WebGLRenderer: class {
        constructor(options) {
          assert.equal(options.antialias, !(corner || bounds.height === 135));
          this.domElement = canvas;
        }
        setPixelRatio() {}
        setClearColor() {}
        setSize() {}
        render() {}
        dispose() {
          order.push('renderer');
        }
        forceContextLoss() {
          forces++;
          assert.equal(events.size, 0);
          order.push('force');
        }
      },
      Scene: Obj,
      Group: Obj,
      PerspectiveCamera: Obj,
      BufferGeometry: Resource,
      Float32BufferAttribute: Resource,
      ShaderMaterial: Mat,
      Mesh,
      TorusGeometry: Resource,
      MeshBasicMaterial: Mat,
    };
    const document = {
        hidden: false,
        addEventListener: (n, f) => docEvents.set(n, f),
        removeEventListener: (n, f) => {
          if (docEvents.get(n) === f) docEvents.delete(n);
        },
      },
      motion = {
        matches: false,
        addEventListener: (n, f) => motionEvents.set(n, f),
        removeEventListener: (n, f) => {
          if (motionEvents.get(n) === f) motionEvents.delete(n);
        },
      },
      window = {
        requestAnimationFrame(f) {
          pending.set(++seq, f);
          return seq;
        },
        cancelAnimationFrame: (id) => pending.delete(id),
      };
    const view = await createRelic3D({
      archive: {
        dataset: { phase: 'idle' },
        classList: { add() {}, remove() {} },
        append() {},
        getBoundingClientRect: () => bounds,
      },
      corner,
      document,
      window,
      reducedMotion: motion,
      load: async () => T,
    });
    assert.equal(view.available, true);
    view.update({ lineageRings: 1, marks: [] });
    const [id, frame] = pending.entries().next().value;
    pending.delete(id);
    frame(0);
    const stale = [...events.values()];
    view.dispose();
    view.dispose();
    for (const callback of stale) callback({ preventDefault() {} });
    view.update({ lineageRings: 2, marks: [] });
    view.wake();
    assert.equal(pending.size, 0);
    assert.equal(docEvents.size, 0);
    assert.equal(motionEvents.size, 0);
    assert.equal(canvas.style.display, 'none');
    assert.ok(order.indexOf('resource') < order.indexOf('renderer'));
    assert.ok(order.indexOf('renderer') < order.indexOf('force'));
    assert.ok(order.indexOf('force') < order.indexOf('remove'));
  }
  assert.equal(forces, 50);
});

test('physical viewport caps both axes uniformly and rejects absent or hidden bounds', () => {
  for (const [w, h, ew, eh] of [
    [480, 480, 480, 480],
    [358, 135, 358, 135],
    [135, 358, 135, 358],
    [160, 160, 160, 160],
    [1280, 720, 480, 270],
    [720, 1280, 270, 480],
  ])
    assert.deepEqual(renderViewport(w, h), { width: ew, height: eh, aspect: ew / eh });
  for (const [w, h] of [
    [0, 160],
    [160, 0],
    [-1, 1],
    [NaN, 1],
    [1, Infinity],
    [undefined, 1],
  ])
    assert.equal(renderViewport(w, h), null);
});

test('small widget context profile mirrors corner without changing larger or invalid-bound defaults', () => {
  for (const [w, h, c, expected] of [
    [358, 135, false, true],
    [135, 358, false, true],
    [160, 160, true, true],
    [480, 480, false, false],
    [480, 480, true, true],
    [358, 161, false, false],
    [0, 135, false, false],
    [NaN, 135, false, false],
    [Infinity, 135, false, false],
    [-1, 135, false, false],
    [undefined, 135, false, false],
  ])
    assert.equal(lowPowerWidget(w, h, c), expected);
});
