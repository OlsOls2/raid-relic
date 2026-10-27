import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { setMarkContext, reduceMark, markReviewPolicy, MARK_LIMITS } from '../src/marks.js';
import { createMemoryState } from '../src/state.js';
import { createFirestoreStore, createMemoryAuthStore } from '../src/store.js';
import { createApp } from '../src/app.js';
import { createControl } from '../src/control.js';
import { createPilot } from '../src/pilot.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';

const host = '201',
  other = '202',
  bot = '203',
  origin = 'https://local.example';
const secret = 'synthetic-capacity-signature';
const context = (streamId) => ({
  streamId,
  keeperId: host,
  optedIn: true,
  holdsRelic: true,
  blockedUserIds: [],
});
const actor = { broadcasterId: host, chatterId: '101' };

test('full retained marked sessions update context without collection, loss, quota reset or privacy failure', () => {
  let doc;
  let now = 1000000;
  const policy = markReviewPolicy({ MARK_AUTO_APPROVE_ENABLED: 'true' });
  for (let i = 0; i < 16; i++) {
    now += 31000;
    doc = setMarkContext(doc, host, context(String(1000 + i)));
    doc = reduceMark(
      doc,
      host,
      actor,
      { type: 'mark', text: 'moon' },
      now,
      i % 2 ? policy : undefined,
    );
  }
  const retained = doc.sessions.flatMap((s) => s.marks);
  assert.equal(retained.length, 16);
  assert.ok(retained.some((m) => m.status === 'approved'));
  assert.ok(retained.some((m) => m.status === 'pending'));
  const serial = doc.serial,
    cooldowns = structuredClone(doc.cooldowns);
  assert.deepEqual(setMarkContext(doc, host, context('1015')), doc);
  doc = setMarkContext(doc, host, context('1016'));
  assert.equal(doc.context.streamId, '1016');
  assert.equal(doc.sessions.length, MARK_LIMITS.sessions);
  assert.equal(
    doc.sessions.some((s) => s.streamId === '1016'),
    false,
  );
  assert.deepEqual(
    doc.sessions.flatMap((s) => s.marks),
    retained,
  );
  assert.equal(doc.serial, serial);
  assert.deepEqual(doc.cooldowns, cooldowns);
  assert.deepEqual(setMarkContext(doc, host, context('1016')), doc);
  const denied = reduceMark(
    doc,
    host,
    { broadcasterId: host, chatterId: '102' },
    { type: 'mark', text: 'star' },
    now + 1,
    policy,
  );
  assert.equal(denied.serial, serial);
  assert.equal(denied.sessions.flatMap((s) => s.marks).length, 16);
  assert.throws(() => setMarkContext(doc, host, context('1015')), /Closed stream/);
  const erased = reduceMark(doc, host, actor, { type: 'forgetme' }, now + 1, policy);
  assert.equal(erased.sessions.flatMap((s) => s.marks).length, 0);
  assert.deepEqual(erased.cooldowns, cooldowns);
  assert.equal(
    erased.sessions.reduce((n, s) => n + s.spent, 0),
    16,
  );
  const recovered = setMarkContext(erased, host, context('1016'));
  assert.equal(recovered.sessions.length, 16);
  assert.ok(recovered.sessions.some((s) => s.streamId === '1016'));
});

test('compaction never discards an open, current, marked or nonempty-viewer session', () => {
  const sessions = Array.from({ length: 16 }, (_, i) => ({
    streamId: String(2000 + i),
    closed: false,
    spent: 0,
    marks: [],
    viewers: [],
  }));
  sessions[0].closed = true;
  sessions[0].viewers = [{ userId: '101', spent: 1 }];
  const original = {
    context: context('2015'),
    paused: false,
    blocked: ['103'],
    sessions,
    cooldowns: [{ userId: '101', at: 1000 }],
    serial: 0,
  };
  const next = setMarkContext(original, host, context('2016'));
  assert.equal(next.sessions.length, 16);
  assert.deepEqual(next.sessions[0], original.sessions[0]);
  assert.deepEqual(next.blocked, ['103']);
  assert.deepEqual(next.cooldowns, original.cooldowns);
  assert.equal(
    next.sessions.some((s) => s.streamId === '2016'),
    false,
  );
});

async function fixture(kind, initialStreams = 16) {
  const db = kind === 'firestore' ? fakeFirestore() : null;
  const options = {
    lifecycle: { channels: [host, other], logins: { sample_a: host, sample_b: other } },
  };
  const state = db ? createFirestoreStore(db, options) : createMemoryState(options);
  const auth = createMemoryAuthStore();
  let now = Date.parse('2026-10-25T12:00:00Z'),
    seq = 0,
    observed = null,
    calls = 0;
  const control = createControl({
    store: auth,
    keeperIds: [host, other],
    origin,
    secure: true,
    now: () => now,
  });
  const pilot = createPilot({
    keepers: { [host]: 'sample_a', [other]: 'sample_b' },
    streamerId: host,
    state,
    store: auth,
    oauth: {
      accessTokenForKeeper: async (id) => {
        assert.equal(id, host);
        return 'synthetic-token';
      },
    },
    subscriptions: {
      [host]: { reconcile: async () => ({ ready: true, results: [], conditions: [] }) },
    },
    clientId: 'public-dummy-client',
    now: () => now,
    logger: () => {},
    transport: async (url) => {
      assert.equal(url, `https://api.twitch.tv/helix/streams?user_id=${host}`);
      calls++;
      return { status: 200, data: { data: observed ? [observed] : [] } };
    },
  });
  // Own HTTP/CSRF boundary is real; status is intentionally minimal because this
  // fixture exposes bootstrap only, not unrelated candidate/dispatch services.
  control.bindPilot({
    actions: () => ['bootstrap'],
    status: async () => ({}),
    execute: pilot.execute,
  });
  const app = createApp({
    secret,
    state,
    oauth: { control },
    now: () => now,
    chatContext: { streamerId: host, botId: bot, keeperIds: [host, other] },
  });
  const signed = async (type, streamId, sentAt = now, startedAt = sentAt, deliveryId) => {
    const id = deliveryId ?? `capacity-event-${++seq}`,
      timestamp = new Date(sentAt).toISOString();
    const rawBody = Buffer.from(
      JSON.stringify({
        subscription: { type, version: '1', condition: { broadcaster_user_id: host } },
        event: {
          broadcaster_user_id: host,
          ...(type === 'stream.online'
            ? { id: streamId, type: 'live', started_at: new Date(startedAt).toISOString() }
            : {}),
        },
      }),
    );
    return app.dispatch({
      method: 'POST',
      path: '/eventsub',
      rawBody,
      headers: {
        'twitch-eventsub-message-id': id,
        'twitch-eventsub-message-timestamp': timestamp,
        'twitch-eventsub-message-type': 'notification',
        'twitch-eventsub-message-signature':
          'sha256=' +
          createHmac('sha256', secret).update(id).update(timestamp).update(rawBody).digest('hex'),
      },
    });
  };
  for (let i = 0; i < initialStreams; i++) {
    now += 1000;
    assert.equal((await signed('stream.online', String(3000 + i))).status, 204);
    now += 1000;
    assert.equal((await signed('stream.offline')).status, 204);
  }
  const cookie = (await control.issue(host)).split(';')[0];
  return {
    state,
    app,
    signed,
    db,
    calls: () => calls,
    now: () => now,
    advance: (ms = 1000) => {
      now += ms;
    },
    observe(streamId, startedAt = now) {
      observed = {
        user_id: host,
        id: streamId,
        type: 'live',
        started_at: new Date(startedAt).toISOString(),
      };
    },
    async bootstrap() {
      const status = await app.dispatch({
        method: 'GET',
        path: `/control/${host}/status`,
        headers: { cookie },
      });
      assert.equal(status.status, 200);
      const csrf = JSON.parse(status.body).csrf;
      return app.dispatch({
        method: 'POST',
        path: `/control/${host}`,
        headers: {
          cookie,
          origin,
          'content-type': 'application/json',
        },
        rawBody: Buffer.from(JSON.stringify({ action: 'bootstrap', csrf })),
      });
    },
  };
}
for (const kind of ['memory', 'firestore']) {
  for (const entry of ['signed-online', 'own-bootstrap']) {
    test(`${kind}: seventeenth stream via ${entry} reclaims only inactive empty sessions and remains idempotent`, async () => {
      const f = await fixture(kind);
      const before = await f.state.getPrivateMarks(host, { broadcasterId: host, chatterId: host });
      assert.equal(before.sessions.length, 16);
      assert.ok(
        before.sessions.every((s) => s.closed && s.marks.length === 0 && s.viewers.length === 0),
      );
      const tombstones = (await f.state.getStreamStatus(host)).closedIds;
      assert.equal(tombstones.length, 16);
      const registry = await f.state.getKeeperRegistry(),
        journey = await f.state.getPublicJourney();
      f.advance();
      if (entry === 'signed-online')
        assert.equal((await f.signed('stream.online', '3016')).status, 204);
      else {
        f.observe('3016');
        const response = await f.bootstrap();
        assert.equal(response.status, 200);
        assert.equal(JSON.parse(response.body).status, 'reconciled');
        assert.equal(JSON.parse(response.body).ready, true);
      }
      const channel = await f.state.getStreamStatus(host);
      assert.equal(channel.online, true);
      assert.equal(channel.streamId, '3016');
      assert.deepEqual(channel.closedIds, tombstones);
      const after = await f.state.getPrivateMarks(host, { broadcasterId: host, chatterId: host });
      assert.equal(after.sessions.length, 16);
      assert.equal(after.context.streamId, '3016');
      assert.equal(
        after.sessions.some((s) => s.streamId === '3000'),
        false,
      );
      assert.ok(after.sessions.some((s) => s.streamId === '3015' && s.closed));
      f.advance();
      assert.equal((await f.signed('stream.online', '3016')).status, 204);
      assert.deepEqual(
        await f.state.getPrivateMarks(host, { broadcasterId: host, chatterId: host }),
        after,
      );
      if (entry === 'own-bootstrap') {
        f.advance();
        const repeated = await f.bootstrap();
        assert.equal(repeated.status, 200);
        assert.equal(JSON.parse(repeated.body).status, 'reconciled');
        assert.equal(f.calls(), 2);
        assert.deepEqual(
          await f.state.getPrivateMarks(host, { broadcasterId: host, chatterId: host }),
          after,
        );
      }
      f.advance();
      assert.equal((await f.signed('stream.online', '3000')).status, 204);
      assert.equal((await f.state.getStreamStatus(host)).streamId, '3016');
      assert.deepEqual(await f.state.getKeeperRegistry(), registry);
      assert.deepEqual(await f.state.getPublicJourney(), journey);
    });
  }
}

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: signed lifecycle survives40 more closures with bounded sessions/tombstones and monotonic eviction fence`, async () => {
    const f = await fixture(kind);
    let floor = -1;
    for (let i = 16; i < 56; i++) {
      f.advance();
      assert.equal((await f.signed('stream.online', String(3000 + i))).status, 204);
      assert.equal((await f.state.getStreamStatus(host)).streamId, String(3000 + i));
      f.advance();
      assert.equal((await f.signed('stream.offline')).status, 204);
      const channel = await f.state.getStreamStatus(host);
      assert.equal(channel.online, false);
      assert.ok(channel.closedIds.length <= 16);
      assert.ok(channel.closedStartFence >= floor);
      floor = channel.closedStartFence;
      const doc = await f.state.getPrivateMarks(host, { broadcasterId: host, chatterId: host });
      assert.ok(doc.sessions.length <= 16);
      assert.ok(
        doc.sessions.every((s) => s.closed && s.marks.length === 0 && s.viewers.length === 0),
      );
    }
    const before = await f.state.getStreamStatus(host);
    f.advance();
    await f.signed('stream.offline');
    const heartbeat = await f.state.getStreamStatus(host);
    assert.equal(heartbeat.closedStartFence, before.closedStartFence);
    assert.deepEqual(heartbeat.closedIds, before.closedIds);
    f.advance();
    await f.signed('stream.online', '3999');
    assert.equal((await f.state.getStreamStatus(host)).streamId, '3999');
  });

  test(`${kind}: eviction rejects same-second forgotten IDs and stale CAS starts without blocking a genuinely newer stream`, async () => {
    const f = await fixture(kind, 0),
      start = f.now();
    for (let i = 0; i < 17; i++) {
      f.advance(10);
      assert.equal((await f.signed('stream.online', String(4000 + i), f.now(), start)).status, 204);
      assert.equal((await f.state.getStreamStatus(host)).streamId, String(4000 + i));
      f.advance(10);
      assert.equal(
        (await f.signed('stream.offline', undefined, f.now(), f.now(), `close-${i}`)).status,
        204,
      );
    }
    const closed = await f.state.getStreamStatus(host);
    assert.equal(closed.closedIds.length, 16);
    assert.equal(closed.closedIds.includes('4000'), false);
    assert.ok(closed.closedStartFence >= start);
    const lastOfflineAt = f.now();
    f.advance(10);
    assert.equal(
      (await f.signed('stream.offline', undefined, lastOfflineAt, lastOfflineAt, 'close-16'))
        .status,
      204,
    );
    assert.deepEqual(await f.state.getStreamStatus(host), closed);
    f.advance(10);
    await f.signed('stream.online', '4000', f.now(), start);
    assert.equal((await f.state.getStreamStatus(host)).online, false);
    f.observe('4998', start);
    const observation = await f.bootstrap();
    assert.equal(observation.status, 200);
    assert.equal((await f.state.getStreamStatus(host)).online, false);
    assert.equal((await f.state.getStreamStatus(host)).closedStartFence, closed.closedStartFence);
    f.advance(1000);
    f.observe('4999');
    assert.equal((await f.bootstrap()).status, 200);
    assert.equal((await f.state.getStreamStatus(host)).streamId, '4999');
    assert.equal((await f.state.getKeeperRegistry()).holderId, null);
    assert.equal((await f.state.getPublicJourney()).rings, 0);
  });
}

test('same-stream context refresh cannot refund a five-mark quota; retained marks survive subsequent compaction', () => {
  let doc;
  for (let i = 0; i < 16; i++) doc = setMarkContext(doc, host, context(String(6000 + i)));
  let now = 2000000;
  for (let i = 0; i < 5; i++) {
    now += 31000;
    doc = reduceMark(doc, host, actor, { type: 'mark', text: 'moon' }, now);
  }
  assert.equal(doc.sessions.at(-1).viewers[0].spent, 5);
  const refreshed = setMarkContext(
    setMarkContext(doc, host, context('6015')),
    host,
    context('6015'),
  );
  assert.deepEqual(refreshed, doc);
  const denied = reduceMark(refreshed, host, actor, { type: 'mark', text: 'star' }, now + 31000);
  assert.equal(denied.serial, 5);
  const moved = setMarkContext(denied, host, context('6016'));
  assert.equal(moved.sessions.length, 16);
  assert.equal(moved.sessions.flatMap((s) => s.marks).length, 5);
  assert.equal(moved.sessions.find((s) => s.streamId === '6015').closed, true);
  assert.throws(() => setMarkContext(moved, host, context('6015')), /Closed stream/);
});
