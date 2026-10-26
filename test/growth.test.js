import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  growthSummary,
  MAX_GROWTH,
  presentGrowth,
  pulseGrowth,
  clearGrowthFeedback,
} from '../public/growth.js';
import { ringSummary } from '../public/relic3d.js';
import { scoreProfileURL } from '../public/scoreboard.js';
import { freshWanderDemo, wanderDemoStep } from '../public/wander-demo-state.js';
import { createApp } from '../src/app.js';
for (const [n, decades, thin, tier] of [
  [9, 0, 9, 'original'],
  [17, 1, 7, 'bronze'],
  [42, 4, 2, 'silver'],
  [120, 12, 0, 'prismatic'],
  [50, 5, 0, 'gold'],
])
  test(`growth ${n}: exact engraved number, bounded truthful bands and tier`, () => {
    const model = growthSummary(n);
    assert.deepEqual(ringSummary(n), model);
    assert.equal(model.total, n);
    assert.equal(model.decades, decades);
    assert.equal(model.thin, thin);
    assert.equal(model.tier, tier);
    assert.ok(model.groups.length <= 16);
    assert.equal(
      model.groups.reduce((a, b) => a + b, 0),
      n,
    );
  });
test('growth rejects invalid inputs and truthfully bundles large decades', () => {
  for (const n of [-1, NaN, Infinity, '120', 3.5, MAX_GROWTH + 1])
    assert.equal(growthSummary(n), null);
  for (const n of [99, 199, 999, MAX_GROWTH]) {
    const m = growthSummary(n);
    assert.ok(m.visible <= 16);
    assert.equal(
      m.groups.reduce((a, b) => a + b, 0),
      n,
    );
  }
});
test('score links use public login and known eligible profile only', () => {
  for (const name of ['raidrelichq', 'olsols2'])
    assert.equal(scoreProfileURL(name, [name]), '/keeper/' + name);
  assert.equal(
    scoreProfileURL('olsols3', ['olsols3'], { 1593561134: 'olsols3' }),
    '/keeper/olsols3',
  );
  assert.equal(scoreProfileURL('consenting_raider'), 'https://twitch.tv/consenting_raider');
  assert.equal(scoreProfileURL('raidrelichq', []), 'https://twitch.tv/raidrelichq');
  for (const value of [null, undefined, '<script>', '../private', 'https://evil', 'Display Name'])
    assert.equal(scoreProfileURL(value), null);
});
test('visual Wander is idempotent, warning-gated, typed and local, with explicit streak reset', () => {
  const initial = freshWanderDemo();
  assert.deepEqual(wanderDemoStep(initial, 'move'), initial);
  const warned = wanderDemoStep(initial, 'warn'),
    moved = wanderDemoStep(warned, 'move');
  assert.equal(warned.hours, 60);
  assert.equal(moved.hours, 72);
  assert.equal(moved.rings, 10);
  assert.equal(moved.streak, 0);
  assert.equal(moved.holder, 'fixture_seeker');
  assert.deepEqual(wanderDemoStep(moved, 'move'), moved);
  assert.deepEqual(wanderDemoStep(moved, 'reset'), initial);
});
test('Wander static film surface is before SDK/auth, connect-none, no network or storage code', async () => {
  const trap = new Proxy(
      {},
      {
        get() {
          throw Error('SDK access');
        },
      },
    ),
    app = createApp({ state: trap, oauth: trap, previewReadOnly: true });
  for (const path of [
    '/demo/wander',
    '/wander-demo.js',
    '/wander-demo-state.js',
    '/wander-demo.css',
    '/growth.js',
  ]) {
    const r = await app.dispatch({ method: 'GET', path });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-security-policy'], /connect-src 'none'/);
  }
  const html = await readFile('public/wander-demo.html', 'utf8');
  assert.match(html, /SIMULATED · NOT LIVE/);
  for (const file of ['wander-demo.js', 'wander-demo-state.js']) {
    const source = await readFile('public/' + file, 'utf8');
    assert.doesNotMatch(
      source,
      /fetch\s*\(|WebSocket|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|\/internal\/|\/api\/|TOKEN_ENCRYPTION/,
    );
  }
});

function growthDOM() {
  const make = () => ({
    children: [],
    attributes: {},
    dataset: {},
    textContent: '',
    classList: { add() {} },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
    append(...nodes) {
      for (const n of nodes) {
        n.parent = this;
        this.children.push(n);
      }
    },
    remove() {
      if (this.parent) {
        this.parent.children = this.parent.children.filter((n) => n !== this);
        this.parent = null;
      }
    },
  });
  const root = make();
  root.ownerDocument = { createElementNS: make };
  return root;
}
test('growth SVG clear is safe before first view, repeatable, and valid after invalidation', () => {
  const root = growthDOM();
  for (const count of [undefined, undefined, null, -1, NaN, '9', MAX_GROWTH + 1]) {
    assert.doesNotThrow(() => presentGrowth(root, count));
    assert.equal(root.children.length, 0);
  }
  const nine = presentGrowth(root, 9),
    first = root.children[0];
  assert.equal(nine.total, 9);
  assert.equal(first.dataset.total, '9');
  assert.equal(first.children.at(-1).textContent, '9');
  assert.equal(presentGrowth(root, 9), nine);
  assert.equal(root.children.length, 1);
  presentGrowth(root, undefined);
  presentGrowth(root, undefined);
  assert.equal(root.children.length, 0);
  const seventeen = presentGrowth(root, 17);
  assert.equal(seventeen.total, 17);
  assert.notEqual(root.children[0], first);
  assert.equal(root.children[0].dataset.tier, 'bronze');
  assert.equal(root.children[0].children.at(-1).textContent, '17');
  for (const count of [null, NaN, undefined]) {
    presentGrowth(root, count);
    assert.equal(root.children.length, 0);
  }
  assert.equal(presentGrowth(root, 120).total, 120);
  assert.equal(root.children.length, 1);
  root.ownerDocument = undefined;
  presentGrowth(root, undefined);
  assert.equal(root.children.length, 0); // Cleanup does not depend on creation APIs still existing.
});
test('growth SVG safely ignores missing archives and unavailable SVG DOM APIs', () => {
  for (const root of [
    undefined,
    null,
    {},
    { ownerDocument: {} },
    { ownerDocument: { createElementNS: true } },
    {
      ownerDocument: {
        createElementNS() {
          throw Error('must not call without append');
        },
      },
    },
  ])
    for (const count of [undefined, null, 9]) assert.doesNotThrow(() => presentGrowth(root, count));
});

test('composited emblem reuses one SVG, preserves prismatic accents and cancels owned feedback on clear', () => {
  const root = growthDOM();
  presentGrowth(root, 9);
  const sprite = root.children[0];
  let animations = 0,
    cancellations = 0;
  sprite.animate = () => {
    animations++;
    return {
      cancel() {
        cancellations++;
      },
    };
  };
  presentGrowth(root, 17);
  assert.equal(root.children[0], sprite);
  pulseGrowth(root);
  assert.equal(animations, 1);
  clearGrowthFeedback(root);
  assert.equal(cancellations, 1);
  presentGrowth(root, 120);
  assert.equal(root.children.length, 1);
  assert.equal(sprite.children.at(-1).textContent, '120');
  assert.ok(sprite.children.slice(1, 5).every((n) => n.attributes.visibility === 'visible'));
  pulseGrowth(root);
  presentGrowth(root, undefined);
  assert.equal(cancellations, 2);
  assert.equal(root.children.length, 0);
});
