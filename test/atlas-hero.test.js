import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { atlasRings, createAtlasHero } from '../public/atlas-hero.js';
const archive = () => ({ dataset: {}, classList: { remove() {} } });
test('Atlas accepts bounded actual aggregate rings only', () => {
  for (const n of [0, 1, 16]) assert.equal(atlasRings(n), n);
  for (const n of [-1, 17, NaN, Infinity, '3', null, 1.5]) assert.equal(atlasRings(n), null);
});
test('Atlas renderer receives no mark, stop or identity data and clears synchronously', async () => {
  const values = [];
  let disposed = 0;
  const hero = createAtlasHero({
    archive: archive(),
    motion: { matches: false },
    load: async () => ({
      createRelic3D: async () => ({ update: (v) => values.push(v), dispose: () => disposed++ }),
    }),
  });
  await hero.update(3);
  assert.deepEqual(values.at(-1), { status: 'archive', lineageRings: 3, marks: [] });
  hero.clear();
  assert.equal(values.at(-1), null);
  assert.equal(disposed, 1);
});
test('Atlas import failure and stale asynchronous creation retain fallback without resurrection', async () => {
  const a = archive();
  let resolve,
    disposed = 0;
  const hero = createAtlasHero({
    archive: a,
    motion: {},
    load: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const pending = hero.update(2);
  hero.clear();
  resolve({
    createRelic3D: () => {
      throw Error('Must not create');
    },
  });
  await pending;
  assert.equal(a.dataset.rings, '0');
  hero.dispose();
  await hero.update(1);
  const failed = createAtlasHero({
    archive: archive(),
    motion: {},
    load: async () => {
      throw Error('Missing vendor');
    },
  });
  await failed.update(2);
  failed.dispose();
  assert.equal(disposed, 0);
});

test('Atlas reduced preference disposes the scene, skips imports and normal return creates one fresh scene', async () => {
  const a = archive();
  let change,
    loads = 0,
    disposed = 0,
    created = 0;
  const motion = {
    matches: false,
    addEventListener(type, fn) {
      change = fn;
    },
    removeEventListener() {},
  };
  const hero = createAtlasHero({
    archive: a,
    motion,
    load: async () => {
      loads++;
      return {
        createRelic3D: async () => {
          created++;
          return {
            update() {},
            dispose() {
              disposed++;
            },
          };
        },
      };
    },
  });
  await hero.update(3);
  motion.matches = true;
  change();
  await hero.update(3);
  assert.equal(disposed, 1);
  assert.equal(loads, 1);
  assert.equal(a.dataset.rings, '3');
  motion.matches = false;
  await hero.update(3);
  assert.equal(created, 2);
  hero.dispose();
  assert.equal(disposed, 2);
});
test('Atlas motion change during import fences late creation and retains exact static count', async () => {
  let resolve,
    created = 0;
  const motion = { matches: false };
  const a = archive();
  const hero = createAtlasHero({
    archive: a,
    motion,
    load: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  const pending = hero.update(4);
  motion.matches = true;
  resolve({
    createRelic3D() {
      created++;
      throw Error('Must not create');
    },
  });
  await pending;
  assert.equal(created, 0);
  assert.equal(a.dataset.rings, '4');
  hero.dispose();
});

test('Atlas renderer-observed reduced preference notifies its owner and preserves count without reload', async () => {
  const a = archive(),
    motion = { matches: false };
  let notify,
    loads = 0,
    disposed = 0;
  const hero = createAtlasHero({
    archive: a,
    motion,
    load: async () => {
      loads++;
      return {
        createRelic3D: async ({ onReducedMotion }) => {
          notify = onReducedMotion;
          return {
            update() {},
            dispose() {
              disposed++;
            },
          };
        },
      };
    },
  });
  await hero.update(2);
  motion.matches = true;
  notify();
  assert.equal(a.dataset.rings, '2');
  assert.equal(disposed, 1);
  assert.equal(loads, 1);
  assert.equal(a.dataset.motionChanges, '1');
  motion.matches = false;
  await hero.update(2);
  assert.equal(loads, 2);
  hero.dispose();
});

test('Atlas composited growth styles target the actual hero root in normal and reduced presentation', async () => {
  const css = await readFile(new URL('../public/atlas.css', import.meta.url), 'utf8');
  const html = await readFile(new URL('../public/atlas.html', import.meta.url), 'utf8');
  assert.match(html, /id="atlas-relic"[^>]*class="atlas-relic"/);
  assert.match(
    css,
    /:is\(\.archive,\s*\.atlas-relic\)\s+\.growth-fallback\s*\{[^}]*position:\s*absolute/s,
  );
  assert.match(
    css,
    /:is\(\.archive,\s*\.atlas-relic\)\.webgl-relic\s+\.growth-fallback\s*\{[^}]*height:\s*34\.5%[^}]*top:\s*65\.4%[^}]*translate\(-50%,\s*-50%\)/s,
  );
  assert.match(css, /:is\(\.archive,\s*\.atlas-relic\)\s+\.growth-tick/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /#atlas-relic\s*\{[^}]*aspect-ratio:\s*1[^}]*margin-bottom:\s*60px/s);
  assert.match(
    css,
    /#atlas-relic\s+\.atlas-ring-pill\s*\{[^}]*top:\s*calc\(100%\s*\+\s*16px\)[^}]*height:\s*44px/s,
  );
  assert.match(css, /transition:\s*opacity\s+300ms\s+ease/);
});

test('Atlas ring pill keeps the authoritative total, hides zero and clears invalid data', async () => {
  const { presentAtlasGrowth } = await import('../public/atlas-hero.js');
  const make = (tag) => ({
    tag,
    children: [],
    dataset: {},
    attributes: {},
    textContent: '',
    classList: { add() {} },
    setAttribute(key, value) {
      this.attributes[key] = value;
    },
    toggleAttribute(key, enabled) {
      if (enabled) this.attributes[key] = '';
      else delete this.attributes[key];
    },
    append(...items) {
      this.children.push(...items);
    },
    prepend(item) {
      this.children.unshift(item);
    },
    querySelector(name) {
      return this.children.find((item) => item.tag === name);
    },
    remove() {
      a.svg = null;
    },
  });
  const a = {
    ownerDocument: { createElementNS: (_, tag) => make(tag) },
    append(svg) {
      this.svg = svg;
    },
    querySelector() {
      return this.svg;
    },
  };
  presentAtlasGrowth(a, 3);
  const svg = a.svg;
  assert.equal(svg.dataset.total, '3');
  assert.equal(svg.attributes['aria-label'], 'Ring 3');
  assert.equal(svg.querySelector('text').textContent, 'Ring 3');
  assert.equal(svg.querySelector('rect').attributes.height, '42');
  assert.equal(Object.hasOwn(svg.attributes, 'hidden'), false);
  presentAtlasGrowth(a, 0);
  assert.equal(a.svg, svg);
  assert.equal(svg.dataset.total, '0');
  assert.equal(Object.hasOwn(svg.attributes, 'hidden'), true);
  presentAtlasGrowth(a, 16);
  assert.equal(Object.hasOwn(svg.attributes, 'hidden'), false);
  assert.equal(svg.querySelector('text').textContent, 'Ring 16');
  presentAtlasGrowth(a, undefined);
  assert.equal(a.svg, null);
});
