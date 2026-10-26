import test from 'node:test';
import assert from 'node:assert/strict';
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
