import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { journeyMap } from '../src/journey-map.js';
import {
  validJourney,
  selection,
  raidWidth,
  nodePosition,
  curve,
  curvePoint,
} from '../public/journey-map.js';
import { createApp } from '../src/app.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
const config = { channels: [HOME, OTHER], logins: { raidrelichq: HOME, olsols2: OTHER } },
  now = 1792950000000;
const history = (n) => ({
  stops: Array.from({ length: n }, (_, i) => ({
    stopId: (i + 1).toString(16).padStart(64, '0'),
    eventId: `verified-${i}`,
    from: i % 2 ? OTHER : HOME,
    to: i % 2 ? HOME : OTHER,
    ringIndex: i + 1,
    claimedAt: now - 16000 + i * 1000,
    raidSize: i,
    marks: [{ userId: 'PRIVATE', text: 'SECRET', status: 'pending' }],
    offers: ['PRIVATE'],
  })),
});
test('map explicitly projects zero/one/all16 completed stops without marks or private associations', () => {
  for (const n of [0, 1, 16]) {
    const v = journeyMap(history(n), config, now);
    assert.equal(v.hops.length, n);
    assert.ok(validJourney({ ...v, mode: 'live' }));
    assert.deepEqual(
      Object.keys(v.hops[0] ?? {}).sort(),
      n ? ['claimedAt', 'from', 'raidSize', 'ringIndex', 'stopId', 'to'] : [],
    );
    assert.doesNotMatch(JSON.stringify(v), /PRIVATE|SECRET|marks|offers|eventId/);
    assert.deepEqual(
      v.nodes.map((n) => n.label),
      ['@raidrelichq', '@olsols2'],
    );
  }
});
test('map rejects capacity, duplicate IDs/events, wrong channels, noncontiguous/invalid chronology and sizes', () => {
  for (const mutate of [
    (s) => s.push({ ...s[0] }),
    (s) => (s[1].stopId = s[0].stopId),
    (s) => (s[1].eventId = s[0].eventId),
    (s) => (s[1].from = s[1].to),
    (s) => (s[1].claimedAt = now + 1),
    (s) => (s[1].claimedAt = -1),
    (s) => (s[1].raidSize = NaN),
    (s) => (s[1].raidSize = 1000001),
    (s) => (s[1].ringIndex = 8),
  ]) {
    const h = history(16);
    mutate(h.stops);
    assert.throws(() => journeyMap(h, config, now));
  }
});
test('strict client rejects unknown/private fields and malformed configured labels', () => {
  const v = { ...journeyMap(history(2), config, now), mode: 'live' };
  assert.ok(validJourney(v));
  for (const change of [
    (w) => (w.actor = 'private'),
    (w) => (w.hops[0].userId = 'private'),
    (w) => (w.nodes[0].label = '<script>'),
    (w) => (w.hops[0].raidSize = -1),
    (w) => w.nodes.push(w.nodes[0]),
  ]) {
    const w = structuredClone(v);
    change(w);
    assert.equal(validJourney(w), false);
  }
});
test('deep links accept one retained stop selector, embed explicitplay only, no URLs/prototypes/duplicates', () => {
  const t = 'a'.repeat(64);
  assert.equal(selection('?t=' + t).stopId, t);
  assert.equal(selection('?play=1', true).play, true);
  for (const s of [
    '?t=x',
    '?t=' + t + '&t=' + t,
    '?__proto__=x',
    '?t=https://example.com',
    '?play=1',
    '?q=private',
  ])
    assert.throws(() => selection(s));
  assert.throws(() => selection('?play=0', true));
});
test('curves are stable, visibly distinct across hops; raid widths monotonic and bounded', () => {
  const a = nodePosition(0, 2),
    b = nodePosition(1, 2),
    one = curve(a, b, 0),
    two = curve(b, a, 1);
  assert.deepEqual(one, curve(a, b, 0));
  const points = [0, 0.25, 0.5, 0.75, 1].map((t) => curvePoint(one, t));
  assert.equal(new Set(points.map((p) => JSON.stringify(p))).size, 5);
  assert.deepEqual(points[0], a);
  assert.deepEqual(points[4], b);
  assert.notDeepEqual(curvePoint(one, 0.25), curvePoint(two, 0.25));
  assert.notDeepEqual(curvePoint(one, 0.5), curvePoint(two, 0.5));
  assert.equal(raidWidth(0), 2);
  assert.ok(Math.abs(raidWidth(1000000) - 8) < 1e-12);
  assert.ok(raidWidth(1) < raidWidth(100));
});
for (const kind of ['memory', 'firestore'])
  test(`${kind}: actual completed kernel hop, one lineage read, no writes/provider; strict HTTP paths`, async () => {
    const f = await pilotFixture(kind);
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    let v = JSON.parse((await f.request('/api/journey-map')).body);
    assert.equal(v.hops.length, 0);
    await f.control(HOME, `send:${OTHER}`);
    f.advance();
    await f.raid(HOME, OTHER, 1);
    await f.chat(HOME, '811', '!offer');
    await f.chat(OTHER, '812', '!accept');
    const calls = f.calls.length;
    if (f.db) {
      f.db.reads.length = 0;
      f.db.writes.length = 0;
    }
    const response = await f.request('/api/journey-map');
    v = JSON.parse(response.body);
    assert.equal(response.status, 200);
    assert.ok(validJourney(v));
    assert.equal(v.hops.length, 1);
    assert.equal(v.hops[0].to, OTHER);
    assert.equal(f.calls.length, calls);
    if (f.db) {
      assert.equal(f.db.reads.length, 1);
      assert.equal(f.db.writes.length, 0);
    }
    assert.equal((await f.request('/api/journey-map?x=1')).status, 400);
    assert.equal((await f.request('/api/journey-map', 'POST')).status, 405);
    for (const path of [
      '/atlas/?t=' + v.hops[0].stopId,
      '/atlas/embed?play=1',
      '/atlas/embed?t=' + v.hops[0].stopId,
    ])
      assert.equal((await f.request(path)).status, 200);
    for (const path of [
      '/atlas/?t=x',
      '/atlas/embed?play=0',
      '/atlas/?q=secret',
      '/atlas/?t=' + v.hops[0].stopId + '&t=' + v.hops[0].stopId,
    ])
      assert.equal((await f.request(path)).status, 400);
    await f.chat(HOME, '811', '!relic forgetme');
    assert.equal(JSON.parse((await f.request('/api/journey-map')).body).hops.length, 1);
    assert.doesNotMatch(
      (await f.request('/api/journey-map')).body,
      /PRIVATE|userId|marks|token|csrf/,
    );
  });
test('read budget before read, read-only preview map never invokes effects', async () => {
  let reads = 0;
  const app = createApp({
    previewReadOnly: true,
    state: {
      getJourneyMap() {
        reads++;
        return journeyMap(history(0), config, now);
      },
    },
    now: () => now,
    publicBudget: { burst: 1, perSecond: 0 },
  });
  assert.equal((await app.dispatch({ method: 'POST', path: '/api/journey-map' })).status, 403);
  assert.equal(reads, 0);
  assert.equal((await app.dispatch({ method: 'GET', path: '/api/journey-map' })).status, 200);
  assert.equal((await app.dispatch({ method: 'GET', path: '/api/journey-map' })).status, 429);
  assert.equal(reads, 1);
});
test('Atlas placement, embed transparency, text-only DOM and stopped RAF/abort guards remain explicit', async () => {
  const html = await readFile(new URL('../public/atlas.html', import.meta.url), 'utf8'),
    css = await readFile(new URL('../public/journey-map.css', import.meta.url), 'utf8'),
    js = await readFile(new URL('../public/journey-map.js', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="keeper-scores"') < html.indexOf('id="journey-map"'));
  assert.ok(html.indexOf('id="journey-map"') < html.indexOf('id="mark-history"'));
  assert.match(css, /background:\s*transparent/i);
  assert.doesNotMatch(js, /innerHTML|setInterval|WebSocket/);
  assert.match(js, /cancelAnimationFrame/);
  assert.match(js, /document.hidden/);
  assert.match(js, /8000/);
  assert.match(js, /credentials:\s*['"]omit['"]/);
});
test('judges explicit module graph serves labelled map/embed and closed simulator projection', async () => {
  const { createJudges } = await import('../test-support/judges.js');
  const j = await createJudges({ intent: true, env: {} });
  try {
    for (const path of ['/journey-map.js', '/journey-map.css', '/atlas/embed?play=1']) {
      const r = await j.dispatch({ method: 'GET', path, headers: { host: '127.0.0.1:5191' } });
      assert.equal(r.status, 200);
      if (path.includes('embed')) assert.match(r.body, /SIMULATOR/);
    }
    const r = await j.dispatch({
      method: 'GET',
      path: '/api/journey-map',
      headers: { host: '127.0.0.1:5191' },
    });
    assert.equal(r.status, 200);
    assert.ok(validJourney(JSON.parse(r.body)));
    assert.equal(JSON.parse(r.body).mode, 'simulator');
  } finally {
    await j.close();
  }
});
test('responsive two-node geometry spans useful width; configured four-node layouts remain bounded', () => {
  for (const [w, h] of [
    [900, 440],
    [331, 360],
    [311, 360],
  ]) {
    const a = nodePosition(0, 2, w, h),
      b = nodePosition(1, 2, w, h);
    assert.ok((b.x - a.x) / w >= 0.59);
    assert.deepEqual(a, nodePosition(0, 2, w, h));
    for (let i = 0; i < 4; i++) {
      const p = nodePosition(i, 4, w, h);
      assert.ok(p.x >= w * 0.19 && p.x <= w * 0.81 && p.y > 40 && p.y < h - 40);
    }
  }
});
test('missing trusted login labels a channel, never invents an @handle', () => {
  const v = { ...journeyMap(history(0), { channels: [HOME], logins: {} }, now), mode: 'live' };
  assert.equal(v.nodes[0].label, `Channel ${HOME}`);
  assert.ok(validJourney(v));
  v.nodes[0].label = 'Channel 999';
  assert.equal(validJourney(v), false);
});
