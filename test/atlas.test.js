import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
import { readFile } from 'node:fs/promises';
import { createJourneyFixture } from '../test-support/journey-fixture.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';
import { atlasPage, handoffView } from '../src/public-view.js';
import { createApp } from '../src/app.js';
import { arrivalPhase } from '../public/arrival.js';
import { validSnapshot } from '../public/overlay-client.js';

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: Atlas APIs expose real completed stops and bounded approved text, not private proof`, async (t) => {
    const f = await createJourneyFixture({
      firestoreClient: kind === 'firestore' ? fakeFirestore() : undefined,
    });
    t.after(() => f.close());
    const get = (path) => f.app.dispatch({ method: 'GET', path });
    const page = await get('/api/atlas?offset=0&limit=1');
    assert.equal(page.status, 200);
    const value = JSON.parse(page.body);
    assert.equal(value.rings, 1);
    assert.equal(value.mode, 'simulator');
    assert.equal(value.stops.length, 1);
    const id = value.stops[0].stopId;
    let detail = JSON.parse((await get(`/api/atlas/stops/${id}?limit=2`)).body);
    assert.equal(detail.total, 4);
    assert.equal(detail.marks.length, 2);
    assert.equal(detail.nextOffset, 2);
    assert.equal(
      JSON.parse((await get(`/api/atlas/stops/${id}?offset=2&limit=2`)).body).nextOffset,
      null,
    );
    for (const key of ['userId', 'eventId', 'streamId', 'offers', 'accepts', 'cooldowns', 'tokens'])
      assert.ok(!JSON.stringify(detail).includes(`"${key}"`));
    assert.equal((await get(`/stops/${id}`)).status, 200);
    assert.equal((await get(`/api/atlas/stops/${'a'.repeat(64)}`)).status, 404);
    for (const path of [
      '/api/atlas?limit=9',
      '/api/atlas?limit=0',
      '/api/atlas?offset=-1',
      '/api/atlas?limit=1&limit=2',
      '/api/atlas?wat=1',
      '/api/atlas?offset=17',
      '/api/atlas/',
      '/api/atlas/stops/%3Cscript%3E',
      `/api/atlas/stops/${id}?limit=21`,
      `/api/atlas/stops/${id}?offset=161`,
    ])
      assert.equal((await get(path)).status, 400, path);
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH'])
      assert.equal((await f.app.dispatch({ method, path: '/api/atlas' })).status, 405);
    assert.equal((await f.app.dispatch({ method: 'POST', path: `/stops/${id}` })).status, 405);
    const snapshot = await f.feed.snapshot();
    assert.equal(snapshot.lineageRings, value.rings);
    assert.equal(snapshot.handoff.role, 'host');
    assert.equal(snapshot.handoff.threshold, 2);
    for (const forbidden of ['from', 'to', 'streamId', 'userId', 'eventId'])
      assert.ok(!(forbidden in snapshot.handoff));
  });
  test(`${kind}: committed forget/block/veto/opt-out purges Atlas and active overlay without cache`, async (t) => {
    for (const action of ['forgetme', 'block', 'veto-last', 'opt-out']) {
      const f = await createJourneyFixture({
        firestoreClient: kind === 'firestore' ? fakeFirestore() : undefined,
      });
      t.after(() => f.close());
      let latest;
      const off = f.feed.subscribe((value) => {
        latest = value;
      });
      t.after(off);
      const id = JSON.parse((await f.app.dispatch({ method: 'GET', path: '/api/atlas' })).body)
        .stops[0].stopId;
      // Complete the fixture's return hop so home runes are currently visible.
      await f.chat(f.target, '7001', { type: 'offer' });
      await f.chat(f.target, '7002', { type: 'offer' });
      await f.chat(f.source, '7003', { type: 'accept' });
      await f.chat(f.source, '7004', { type: 'accept' });
      assert.equal(latest.approvedCount, 4);
      assert.equal(latest.lineageRings, 2);
      const actor = {
        broadcasterId: f.source,
        chatterId: action === 'forgetme' ? '9000' : f.source,
      };
      await f.state.controlMarks(f.source, actor, { type: action, userId: '9000' }, Date.now());
      const detail = JSON.parse(
        (await f.app.dispatch({ method: 'GET', path: `/api/atlas/stops/${id}` })).body,
      );
      assert.equal(detail.marks.length, action === 'opt-out' ? 0 : 3, action);
      assert.equal(latest.approvedCount, action === 'opt-out' ? 0 : 3);
      if (action !== 'veto-last') assert.ok(!detail.marks.some((mark) => mark.text === 'moon'));
    }
  });
}
test('projection pages cap a 160-mark stop without generating other rune SVGs', () => {
  const id = 'a'.repeat(64);
  const marks = Array.from({ length: 160 }, (_, i) => ({
    id: `m${i + 1}`,
    text: 'moon',
    userId: 'private',
  }));
  const lineage = {
    stops: [{ stopId: id, from: '1', to: '2', ringIndex: 1, claimedAt: 1, raidSize: 1, marks }],
  };
  assert.ok(!JSON.stringify(atlasPage(lineage)).includes('runeSvg'));
  const seen = [];
  for (let offset = 0; offset < 160; offset += 20) {
    const page = atlasPage(lineage, { stopId: id, offset, limit: 20 });
    assert.equal(page.marks.length, 20);
    seen.push(...page.marks.map((mark) => mark.id));
  }
  assert.equal(new Set(seen).size, 160);
});
test('public budget bounds expensive Atlas/OAuth calls without IP records or blocking health', async () => {
  let reads = 0;
  let oauth = 0;
  let time = 0;
  const app = createApp({
    now: () => time,
    publicBudget: { burst: 2, perSecond: 1 },
    state: {
      getAtlasPage() {
        reads++;
        return { rings: 0, stops: [] };
      },
    },
    oauth: {
      callbackPath: '/auth/callback',
      route() {
        oauth++;
        return { status: 200 };
      },
    },
  });
  await app.dispatch({ method: 'GET', path: '/api/atlas' });
  await app.dispatch({ method: 'GET', path: '/oauth/streamer/start' });
  assert.equal((await app.dispatch({ method: 'GET', path: '/oauth/bot/start' })).status, 429);
  assert.equal(reads, 1);
  assert.equal(oauth, 1);
  assert.equal((await app.dispatch({ method: 'GET', path: '/health' })).status, 200);
  time = 1000;
  assert.equal((await app.dispatch({ method: 'GET', path: '/api/atlas' })).status, 200);
});
test('read failure yields generic unavailable with no retained/private content; browser uses safe text and no polling', async () => {
  const app = createApp({
    state: {
      getAtlasPage() {
        throw new Error('PRIVATE_SECRET');
      },
    },
  });
  const response = await app.dispatch({ method: 'GET', path: '/api/atlas' });
  assert.equal(response.status, 503);
  assert.ok(!response.body.includes('PRIVATE'));
  const source = await readFile('public/atlas.js', 'utf8');
  assert.ok(source.includes('textContent'));
  assert.ok(!/innerHTML|insertAdjacentHTML|setInterval/.test(source));
  assert.ok(source.includes("cache: 'no-store'"));
  assert.ok(source.includes('clear();'));
  assert.ok(source.includes('pagehide'));
});
test('arrival seeks exact receipt phases on reconnect, never replays or moves with reduced motion', () => {
  const hop = { role: 'host', startedAt: 1000, endsAt: 91000 };
  for (const [now, phase] of [
    [999, 'idle'],
    [1000, 'streak'],
    [3999, 'streak'],
    [4000, 'impact'],
    [6000, 'unfurl'],
    [20999, 'unfurl'],
    [21000, 'settled'],
    [91000, 'idle'],
  ])
    assert.equal(arrivalPhase(hop, now).phase, phase);
  assert.equal(arrivalPhase(hop, 12000).phase, 'unfurl');
  assert.equal(arrivalPhase(hop, 2000, true).phase, 'settled');
  assert.equal(arrivalPhase({ ...hop, role: 'source' }, 2000).phase, 'idle');
  assert.equal(arrivalPhase(null, 2000).phase, 'idle');
  const view = handoffView(
    {
      pendingHop: {
        from: '1',
        to: '2',
        startedAt: 1000,
        endsAt: 91000,
        threshold: 2,
        offers: ['private'],
        accepts: [],
        finalized: false,
      },
    },
    '2',
    2000,
  );
  assert.equal(view.offers, 1);
  assert.ok(!JSON.stringify(view).includes('private'));
  assert.equal(handoffView({ pendingHop: { cancelled: true } }, '2', 2000), null);
  const snapshot = {
    type: 'snapshot',
    revision: 1,
    mode: 'live',
    status: 'ready',
    lineageRings: 2,
    serverNow: 2000,
    marks: [],
    approvedCount: 0,
    handoff: view,
  };
  assert.equal(validSnapshot(snapshot), true);
  assert.equal(validSnapshot({ ...snapshot, handoff: { ...view, offers: 1000 } }), false);
});

test('upgrade budget rejects reconnect flood before snapshot/database access without binding a port', () => {
  const server = new EventEmitter();
  let response;
  let reads = 0;
  const sockets = attachOverlaySockets(
    server,
    {
      channel: '111',
      snapshot() {
        reads++;
      },
    },
    { origins: ['http://localhost:5191'], allowRead: () => false },
  );
  try {
    server.emit(
      'upgrade',
      { url: '/ws/111', headers: { origin: 'http://localhost:5191' } },
      {
        end(value) {
          response = value;
        },
      },
      Buffer.alloc(0),
    );
    assert.match(response, /429/);
    assert.equal(reads, 0);
  } finally {
    sockets.close();
  }
});

test('responsive layout shrinks grid tracks and QA preserves failed-run evidence without hiding overflow', async () => {
  const css = (await readFile('public/atlas.css', 'utf8')).replace(/\s+/g, '');
  assert.ok(css.includes('minmax(0,1fr)minmax(0,100px)'));
  assert.ok(css.includes('min-width:0;overflow-wrap:anywhere'));
  assert.ok(!/overflow(?:-x)?:\s*(?:hidden|clip)/.test(css));
  const smoke = (await readFile('scripts/browser-smoke.js', 'utf8'))
    .replace(/\s+/g, '')
    .replaceAll('\"', "'");
  assert.ok(smoke.includes("fits(page,'Atlas375px')"));
  assert.ok(smoke.includes("fits(page,'Stop375px')"));
  assert.ok(smoke.includes("fits(page,'Overlaycorner160px')"));
  assert.ok(smoke.includes('if(failure)throwfailure'));
  assert.ok(smoke.includes('Communitiesstayswholeat375px'));
  assert.ok(smoke.includes('corner.height===160'));
  assert.match(css, /h1\{[^}]*overflow-wrap:normal;[^}]*word-break:normal;[^}]*hyphens:none;?\}/);
  assert.ok(css.includes('@media(max-width:480px)'));
  const overlay = (await readFile('public/overlay.css', 'utf8')).replace(/\s+/g, '');
  assert.ok(overlay.includes('width:160px;height:160px'));
  assert.ok(overlay.includes('.corner.compact-state'));
});
