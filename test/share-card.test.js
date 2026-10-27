import test from 'node:test';
import assert from 'node:assert/strict';
import { ringCardModel, approvedCardWord } from '../public/ring-card.js';
import { freshShareSnapshot, assertFreshShare } from '../public/ring-card-client.js';
const id = 'a'.repeat(64),
  second = 'b'.repeat(64),
  now = Date.parse('2026-10-26T12:00Z');
const base = { stopId: id, keeper: '@olsols2', ringIndex: 1, claimedAt: now - 1000 };
const share = {
  holder: '@raidrelichq',
  hops: 2,
  totalEngravings: 2,
  engravings: ['moon', '🌙'],
  route: [
    {
      stopId: id,
      from: '@raidrelichq',
      to: '@olsols2',
      ringIndex: 1,
      claimedAt: now - 1000,
      kind: 'raid',
    },
    {
      stopId: second,
      from: '@olsols2',
      to: '@raidrelichq',
      ringIndex: 2,
      claimedAt: now,
      kind: 'raid',
    },
  ],
};
test('share model keeps recorded Keeper separate from current holder and defensively bounds approved content', () => {
  const m = ringCardModel(base, { share, now });
  assert.equal(m.keeper, '@olsols2');
  assert.equal(m.share.holder, '@raidrelichq');
  assert.equal(m.share.hops, 2);
  assert.deepEqual(m.share.engravings, ['moon', '🌙']);
  assert.ok(Object.isFrozen(m.share.route[0]));
  const invalid = [
    { private: 'value' },
    { holder: '@unknown' },
    { holder: '@olsols2' },
    { hops: 17 },
    { engravings: Array(9).fill('moon') },
    { engravings: ['<svg>'] },
    { engravings: ['x'.repeat(41)] },
    { engravings: ['word word'] },
    { engravings: ['\u0000'] },
    { totalEngravings: 161 },
    { route: [] },
  ];
  for (const patch of invalid)
    assert.throws(() => ringCardModel(base, { share: { ...share, ...patch }, now }));
  for (const patch of [
    { claimedAt: now + 1 },
    { stopId: second },
    { to: '@raidrelichq' },
    { ringIndex: 3 },
    { kind: 'unknown' },
    { viewerId: 'private' },
  ]) {
    const route = share.route.map((x) => ({ ...x }));
    route[0] = { ...route[0], ...patch };
    assert.throws(() => ringCardModel(base, { share: { ...share, route }, now }));
  }
  assert.equal(ringCardModel(base, { share: { ...share, holder: null }, now }).share.holder, null);
  assert.throws(() =>
    ringCardModel(
      { stopId: null, keeper: '@demo_keeper_a', ringIndex: 1, claimedAt: now },
      { mode: 'demo', share, now },
    ),
  );
  assert.equal(approvedCardWord('🌙'), true);
  assert.equal(approvedCardWord('moon'), true);
  assert.equal(approvedCardWord('Moon'), false);
  assert.equal(approvedCardWord('https'), false);
});
function data() {
  return {
    exact: {
      mode: 'simulator',
      offset: 0,
      total: 1,
      nextOffset: null,
      marks: [{ id: 'm1', text: 'moon', runeSvg: 'never consumed' }],
      stop: {
        ...base,
        from: '1591805230',
        to: '1591806023',
        approvedCount: 1,
      },
    },
    recap: {
      mode: 'simulator',
      rings: 2,
      completedStops: 2,
      route: share.route.map((r, i) => ({
        ...r,
        from: i ? '1591806023' : '1591805230',
        to: i ? '1591805230' : '1591806023',
        kind: undefined,
        retainedEntries: 1,
      })),
    },
    receiving: {
      mode: 'simulator',
      holder: { login: 'raidrelichq', ringCount: 2, heldSince: now },
    },
  };
}
const reader = (d) => async (path) =>
  structuredClone(
    path.includes('/stops/') ? d.exact : path === '/api/recap' ? d.recap : d.receiving,
  );
test('fresh-share comparison cancels engraving erasure, veto/replacement, route/holder changes and removed stops', async () => {
  const d = data(),
    snapshot = await freshShareSnapshot(id, reader(d));
  assert.equal(snapshot.share.engravings[0], 'moon');
  await assertFreshShare(snapshot, id, reader(d));
  for (const change of [
    (x) => {
      x.exact.marks[0].text = 'star';
    },
    (x) => {
      x.exact.marks = [];
      x.exact.total = x.exact.stop.approvedCount = 0;
      x.recap.route[0].retainedEntries = 0;
    },
    (x) => {
      x.receiving.holder = null;
    },
    (x) => {
      x.recap.route[1].claimedAt++;
    },
    (x) => {
      x.exact.mode = 'live';
    },
    (x) => {
      x.exact.marks[0].status = 'pending';
    },
  ]) {
    const altered = data();
    change(altered);
    await assert.rejects(() => assertFreshShare(snapshot, id, reader(altered)));
  }
  const advanced = data();
  advanced.recap.route.push({
    stopId: 'c'.repeat(64),
    from: '1591805230',
    to: '1591806023',
    ringIndex: 3,
    claimedAt: now + 1,
    retainedEntries: 0,
  });
  advanced.recap.rings = advanced.recap.completedStops = 3;
  advanced.receiving.holder = { login: 'olsols2', ringCount: 3, heldSince: now + 1 };
  await assert.rejects(() => assertFreshShare(snapshot, id, reader(advanced)));
  await assert.rejects(() =>
    assertFreshShare(snapshot, id, async () => {
      throw Error('Removed');
    }),
  );
});

// Exercise the HTTP projection, rather than reproducing its DTO in a fake.
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: signed journey exports real paginated approved Atlas responses and detects erasure`, async () => {
    const { pilotFixture, HOME, OTHER, BOT } = await import('../test-support/pilot-fixture.js');
    const f = await pilotFixture(kind, {
      chronicleEnv: { MARK_AUTO_APPROVE_ENABLED: 'true' },
    });
    for (const actor of [BOT, HOME, OTHER]) await f.login(actor);
    for (const actor of [HOME, OTHER]) f.streams.get(actor).viewer_count = 1;
    for (const actor of [HOME, OTHER]) {
      assert.equal((await f.control(actor, 'bootstrap')).status, 200);
      f.advance();
      assert.equal((await f.control(actor, 'keep')).status, 200);
      f.advance();
    }
    for (let i = 0; i < 21; i++) {
      await f.chat(HOME, String(9100 + i), '!mark moon');
      f.advance();
    }
    for (const [from, to, n] of [
      [HOME, OTHER, 1],
      [OTHER, HOME, 2],
    ]) {
      f.advance(31000);
      assert.equal(JSON.parse((await f.control(from, 'send:' + to)).body).status, 'accepted');
      await f.raid(from, to);
      await f.chat(from, String(9200 + n), '!offer');
      await f.chat(to, String(9300 + n), '!accept');
    }
    const route = JSON.parse((await f.request('/api/recap')).body).route;
    assert.equal(route.length, 2);
    const paths = [];
    const read = async (path) => {
      paths.push(path);
      const response = await f.request(path);
      assert.equal(response.status, 200);
      return JSON.parse(response.body);
    };
    const snapshot = await freshShareSnapshot(route[0].stopId, read);
    assert.equal(snapshot.share.holder, '@raidrelichq');
    assert.equal(snapshot.share.route[0].to, '@olsols2');
    assert.equal(snapshot.share.totalEngravings, 21);
    assert.deepEqual(snapshot.share.engravings, Array(8).fill('moon'));
    assert.ok(paths.some((path) => path.includes('?offset=20&limit=20')));
    await assertFreshShare(snapshot, route[0].stopId, read);
    await f.chat(HOME, '9100', '!relic forgetme');
    await assert.rejects(() => assertFreshShare(snapshot, route[0].stopId, read));
  });
}

test('share pagination rejects incomplete, repeated and changed public pages', async () => {
  const d = data();
  d.exact.total = d.exact.stop.approvedCount = d.recap.route[0].retainedEntries = 21;
  d.exact.marks = Array.from({ length: 20 }, (_, i) => ({ id: 'm' + i, text: 'moon' }));
  d.exact.nextOffset = 20;
  const last = {
    ...structuredClone(d.exact),
    offset: 20,
    nextOffset: null,
    marks: [{ id: 'm20', text: 'moon' }],
  };
  const read = (page) => async (path) =>
    path.includes('?offset=') ? structuredClone(page) : reader(d)(path);
  assert.equal((await freshShareSnapshot(id, read(last))).share.totalEngravings, 21);
  for (const patch of [
    { offset: 0 },
    { total: 20 },
    { marks: [] },
    { nextOffset: 20 },
    { mode: 'live' },
    { stop: { ...last.stop, approvedCount: 20 } },
  ]) {
    await assert.rejects(() => freshShareSnapshot(id, read({ ...last, ...patch })));
  }
});
