import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { hash } from '../src/crypto.js';
import { createMemoryState } from '../src/state.js';
import { createFirestoreStore } from '../src/store.js';
import { createApp } from '../src/app.js';
import { createSendOff } from '../src/send-off.js';
import { createMarkService } from '../src/marks.js';
import { reduceClaims, LINEAGE_LIMITS } from '../src/claims.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';
const source = '1591805230';
const target = '1591806023';
const bot = '1591804828';
const secret = 'synthetic-send-test-secret';
const base = Date.parse('2026-10-25T12:00:00Z');
function fixture(kind, mode = 'ok') {
  const db = kind === 'firestore' ? fakeFirestore() : null;
  const config = {
    lifecycle: {
      channels: [source, target],
      logins: { raidrelichq: source, targetkeeper: target },
    },
  };
  const makeStore = () => (db ? createFirestoreStore(db, config) : state);
  const state = db ? makeStore() : createMemoryState(config);
  let time = base;
  let seq = 0;
  const calls = [];
  const roles = [];
  const apps = Object.fromEntries(
    [source, target].map((host) => [
      host,
      createApp({
        secret,
        state: makeStore(),
        now: () => time,
        chatContext: { streamerId: host, botId: bot, keeperIds: [source, target] },
      }),
    ]),
  );
  function request(host, type, event, options = {}) {
    const id = options.id ?? `event-${++seq}`;
    const timestamp = new Date(options.sentAt ?? time).toISOString();
    const condition =
      options.condition ??
      (type === 'channel.chat.message'
        ? { broadcaster_user_id: host, user_id: bot }
        : { broadcaster_user_id: host });
    const rawBody = Buffer.from(
      JSON.stringify({ subscription: { type, version: options.version ?? '1', condition }, event }),
    );
    const digest = createHmac('sha256', secret)
      .update(id)
      .update(timestamp)
      .update(rawBody)
      .digest('hex');
    return {
      method: 'POST',
      path: '/eventsub',
      rawBody,
      headers: {
        'twitch-eventsub-message-id': id,
        'twitch-eventsub-message-timestamp': timestamp,
        'twitch-eventsub-message-signature': `sha256=${digest}`,
        'twitch-eventsub-message-type': 'notification',
      },
    };
  }
  const chatRequest = (text, host = source, user = host, options = {}) =>
    request(
      host,
      'channel.chat.message',
      {
        broadcaster_user_id: host,
        chatter_user_id: user,
        message_id: options.id ?? `message-${seq + 1}`,
        badges: options.badges ?? [],
        message: { text, fragments: [] },
      },
      options,
    );
  const chat = (text, host = source, user = host, options) =>
    apps[host].dispatch(chatRequest(text, host, user, options));
  const raid = (to = target, options = {}) =>
    apps[source].dispatch(
      request(
        source,
        'channel.raid',
        {
          from_broadcaster_user_id: source,
          to_broadcaster_user_id: to,
          viewers: options.viewers ?? 1,
        },
        { condition: { from_broadcaster_user_id: source }, ...options },
      ),
    );
  const transport = async (url, input) => {
    calls.push({ url, ...input });
    if (url.includes('/users?')) {
      if (
        mode === 'preflight401' &&
        calls.filter((call) => call.url.includes('/users?')).length === 1
      )
        return { status: 401, data: {} };
      return {
        status: 200,
        data: { data: [{ id: mode === 'wrong-account' ? '777' : target, login: 'targetkeeper' }] },
      };
    }
    if (url.includes('/streams?')) {
      if (typeof mode === 'function') await mode({ state, time });
      return {
        status: 200,
        data: {
          data:
            mode === 'offline'
              ? []
              : [
                  { user_id: source, id: '9001', type: 'live' },
                  { user_id: target, id: '9002', type: 'live' },
                ],
        },
      };
    }
    if (input.method === 'POST') {
      if (mode === 'timeout') throw new Error('PRIVATE_TOKEN timeout after dispatch');
      return {
        status: mode === 'post401' ? 401 : mode === 'post500' ? 500 : 200,
        data: { data: [{ created_at: new Date(time).toISOString() }] },
      };
    }
    throw new Error('Unexpected transport');
  };
  const worker = () =>
    createSendOff({
      state: makeStore(),
      streamerId: source,
      clientId: 'test-client',
      now: () => time,
      oauth: {
        accessToken: async (role, options) => {
          roles.push({ role, ...options });
          return 'synthetic-streamer-token';
        },
      },
      transport,
    });
  return {
    request,
    state,
    db,
    apps,
    chat,
    chatRequest,
    raid,
    worker,
    calls,
    roles,
    now: () => time,
    advance: (ms) => {
      time += ms;
    },
    async offline(host = source) {
      return apps[host].dispatch(request(host, 'stream.offline', { broadcaster_user_id: host }));
    },
    async online(host, stream) {
      return apps[host].dispatch(
        request(host, 'stream.online', {
          broadcaster_user_id: host,
          id: stream,
          type: 'live',
          started_at: new Date(time).toISOString(),
        }),
      );
    },
    async setup() {
      for (const [host, stream] of [
        [source, '9001'],
        [target, '9002'],
      ]) {
        await apps[host].dispatch(
          request(host, 'stream.online', {
            broadcaster_user_id: host,
            id: stream,
            type: 'live',
            started_at: new Date(time).toISOString(),
          }),
        );
        await chat('!relic keep', host);
      }
    },
  };
}

async function open(f, viewers = 1) {
  await f.setup();
  f.advance(1000);
  await f.raid(target, { viewers });
}
async function finish(f, viewer = '111', accepter = '222') {
  await f.chat('!offer', source, viewer);
  await f.chat('!accept', target, accepter);
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: signed two-chat claims transfer once atomically with contexts and real lineage`, async () => {
    const f = fixture(kind);
    await open(f, 4); // ceil(sqrt(4)) = 2
    const offer = f.chatRequest('!offer', source, '111');
    await Promise.all(Array.from({ length: 12 }, () => f.apps[source].dispatch(offer)));
    await f.chat('!offer', source, '112');
    await f.chat('!accept', target, '211');
    assert.equal((await f.state.getKeeperRegistry()).holderId, source);
    const accept = f.chatRequest('!accept', target, '212');
    await Promise.all(Array.from({ length: 12 }, () => f.apps[source].dispatch(accept)));
    const registry = await f.state.getKeeperRegistry();
    assert.equal(registry.holderId, target);
    assert.equal(registry.pendingHop.finalized, true);
    assert.equal(registry.send, undefined);
    const journey = await f.state.getPublicJourney();
    assert.equal(journey.rings, 1);
    assert.equal(journey.stops[0].raidSize, 4);
    assert.equal(journey.stops[0].ringIndex, 1);
    assert.equal(
      (await f.state.getPrivateMarks(source, { broadcasterId: source, chatterId: source })).context
        .holdsRelic,
      false,
    );
    assert.equal(
      (await f.state.getPrivateMarks(target, { broadcasterId: target, chatterId: target })).context
        .holdsRelic,
      true,
    );
    assert.ok(!JSON.stringify(journey).includes('chatterId'));
    assert.ok(!JSON.stringify(journey).includes('offers'));
    // A second signed, eligible manual hop back. No finalized intent blocks it.
    f.advance(1000);
    await f.apps[source].dispatch(
      f.request(
        target,
        'channel.raid',
        { from_broadcaster_user_id: target, to_broadcaster_user_id: source, viewers: 1 },
        { condition: { from_broadcaster_user_id: target } },
      ),
    );
    await f.chat('!offer', target, '333');
    await f.chat('!accept', source, '444');
    assert.equal((await f.state.getKeeperRegistry()).holderId, source);
    assert.equal((await f.state.getPublicJourney()).rings, 2);
  });
  test(`${kind}: wrong side, same user, bot and forged channel never supply claim proof`, async () => {
    const f = fixture(kind);
    await open(f);
    await f.chat('!accept', source, '556');
    await f.chat('!offer', target, '555');
    await f.chat('!offer', source, bot);
    await f.chat('!accept', target, bot);
    assert.equal((await f.state.getKeeperRegistry()).pendingHop.offers.length, 0);
    await f.chat('!offer', source, '111');
    await f.chat('!accept', target, '111');
    assert.equal((await f.state.getKeeperRegistry()).holderId, source);
    const forged = f.request('777', 'channel.chat.message', {
      broadcaster_user_id: '777',
      chatter_user_id: '222',
      message_id: 'forged',
      message: { text: '!accept', fragments: [] },
    });
    assert.equal((await f.apps[source].dispatch(forged)).status, 400);
    await f.chat('!accept', target, '222');
    assert.equal((await f.state.getKeeperRegistry()).holderId, target);
  });
  test(`${kind}: threshold uses only bounded signed viewers and caps at ten per side`, async () => {
    const f = fixture(kind);
    await open(f, 1000000);
    assert.equal((await f.state.getKeeperRegistry()).pendingHop.threshold, 10);
    for (let i = 0; i < 10; i++) await f.chat('!offer', source, String(100 + i));
    for (let i = 0; i < 9; i++) await f.chat('!accept', target, String(200 + i));
    assert.equal((await f.state.getKeeperRegistry()).holderId, source);
    await f.chat('!accept', target, '209');
    assert.equal((await f.state.getPublicJourney()).rings, 1);
    for (const viewers of [-1, 1.2, 1000001, '10']) {
      assert.equal((await f.raid(target, { viewers })).status, 400);
    }
  });
  test(`${kind}: expiry and policy revocation permanently cancel old claims`, async () => {
    for (const action of ['expire', 'pause', 'opt-out', 'ban', 'block', 'offline', 'new-stream']) {
      const f = fixture(kind);
      await open(f);
      await f.chat('!offer', source, '111');
      f.advance(1);
      if (action === 'expire') f.advance(180000);
      if (action === 'pause') {
        await f.chat('!relic pause', target);
        await f.chat('!relic resume', target);
      }
      if (action === 'opt-out') {
        await f.chat('!relic opt-out', target);
        f.advance(1);
        await f.chat('!relic keep', target);
      }
      if (action === 'ban') {
        await f.state.setChannelPolicy(target, { banned: true, blockedUserIds: [] }, f.now());
        await f.state.setChannelPolicy(target, { banned: false, blockedUserIds: [] }, f.now());
      }
      if (action === 'block') await f.chat(`!relic block ${source}`, target);
      if (action === 'offline') await f.offline(target);
      if (action === 'new-stream') await f.online(source, '9003');
      await f.chat('!accept', target, '222');
      assert.equal((await f.state.getKeeperRegistry()).holderId, source, action);
      assert.equal((await f.state.getPublicJourney()).rings, 0, action);
    }
  });
  test(`${kind}: proven retired source and later closure after verified manual raid can claim`, async () => {
    const f = fixture(kind);
    await f.setup();
    await f.chat('!relic send @targetkeeper');
    await f.worker().processPending();
    f.advance(1000);
    const at = f.now();
    f.advance(1000);
    await f.offline();
    await f.raid(target, { sentAt: at });
    await finish(f);
    assert.equal((await f.state.getKeeperRegistry()).holderId, target);
    assert.equal((await f.state.getStreamStatus(source)).online, false);
    const manual = fixture(kind);
    await open(manual);
    await manual.offline();
    await finish(manual);
    assert.equal((await manual.state.getPublicJourney()).rings, 1);
  });
  test(`${kind}: archived approved content is public only until forget/block/veto/opt-out purges it`, async () => {
    for (const action of ['forget', 'block', 'veto', 'opt-out']) {
      const f = fixture(kind);
      await f.setup();
      await f.chat('!mark moon', source, '333');
      await f.chat('!mark secretpending', source, '444');
      await f.chat('!relic approve m1');
      f.advance(1000);
      await f.raid();
      await finish(f);
      let text = JSON.stringify(await f.state.getPublicJourney());
      assert.ok(text.includes('moon'));
      assert.ok(!text.includes('secretpending'));
      assert.ok(!text.includes('userId'));
      const service = createMarkService(f.state, { now: f.now });
      const actor = { broadcasterId: source, chatterId: source };
      if (action === 'forget')
        await service.forgetMe(source, { broadcasterId: source, chatterId: '333' });
      if (action === 'block') await service.blockUser(source, actor, '333');
      if (action === 'veto') {
        await service.vetoLast(source, actor);
        await service.vetoLast(source, actor);
      }
      if (action === 'opt-out') await service.optOut(source, actor);
      text = JSON.stringify(await f.state.getPublicJourney());
      assert.ok(!text.includes('moon'), action);
      assert.equal((await f.state.getPublicJourney()).rings, 1);
    }
  });
}
test('Firestore failed final claim rolls back dedupe, counts, ownership, contexts and lineage', async () => {
  const f = fixture('firestore');
  await open(f);
  await f.chat('!offer', source, '111');
  const req = f.chatRequest('!accept', target, '222');
  const before = structuredClone([...f.db.docs]);
  f.db.failCommit = true;
  await assert.rejects(f.apps[source].dispatch(req));
  assert.deepEqual([...f.db.docs], before);
  f.db.failCommit = false;
  f.db.retry = true;
  await f.apps[source].dispatch(req);
  assert.equal((await f.state.getPublicJourney()).rings, 1);
  assert.equal((await f.state.getKeeperRegistry()).holderId, target);
});

test('lineage capacity fails closed explicitly without ownership or fabricated ring', () => {
  const from = source,
    to = target;
  const channel = (id) => ({
    online: true,
    streamId: id,
    optedIn: true,
    paused: false,
    banned: false,
    blockedUserIds: [],
  });
  const doc = (id) => ({
    paused: false,
    blocked: [],
    context: {
      keeperId: id,
      streamId: id,
      optedIn: true,
      holdsRelic: id === from,
      blockedUserIds: [],
    },
    sessions: [{ streamId: id, marks: [] }],
  });
  const channels = { [from]: channel(from), [to]: channel(to) };
  const marks = { [from]: doc(from), [to]: doc(to) };
  const registry = {
    holderId: from,
    pendingHop: {
      from,
      to,
      eventId: 'capacity',
      sourceStreamId: from,
      targetStreamId: to,
      threshold: 1,
      offers: ['111'],
      accepts: [],
      startedAt: 0,
      raidSentAt: 0,
      endsAt: 100,
      raidSize: 1,
    },
  };
  const chat = { broadcasterId: to, chatterId: '222', markAction: { type: 'accept' } };
  const stops = Array.from({ length: LINEAGE_LIMITS.stops }, (_, i) => ({
    from,
    streamId: from,
    marks: [],
    ringIndex: i + 1,
  }));
  const result = reduceClaims(registry, channels, marks, { stops }, chat, 1);
  assert.equal(result.registry.holderId, from);
  assert.equal(result.registry.pendingHop.capacityBlocked, true);
  assert.equal(result.lineage.stops.length, LINEAGE_LIMITS.stops);
  marks[from].sessions[0].marks = Array.from(
    { length: LINEAGE_LIMITS.marksPerStop + 1 },
    (_, i) => ({ id: `m${i}`, userId: '333', text: 'moon', status: 'approved' }),
  );
  const markLimit = reduceClaims(registry, channels, marks, { stops: [] }, chat, 1);
  assert.equal(markLimit.registry.pendingHop.capacityBlocked, true);
  assert.equal(markLimit.lineage.stops.length, 0);
});
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: planned final claim clears send intent and blocked participants do not count`, async () => {
    const f = fixture(kind);
    await f.setup();
    await f.chat('!relic send @targetkeeper');
    await f.worker().processPending();
    f.advance(1000);
    await f.raid();
    await f.chat('!relic block 111', source);
    await f.chat('!offer', source, '111');
    await f.chat('!accept', target, '222');
    assert.equal((await f.state.getKeeperRegistry()).holderId, source);
    await f.chat('!offer', source, '333');
    assert.equal((await f.state.getKeeperRegistry()).send, undefined);
    assert.equal((await f.state.getKeeperRegistry()).holderId, target);
  });
}

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: pre-receipt delayed claims do not count; public journey excludes private proof`, async () => {
    const f = fixture(kind);
    await f.setup();
    f.advance(1000);
    const raidAt = f.now();
    f.advance(1000);
    await f.raid(target, { sentAt: raidAt, viewers: 0 });
    await f.chat('!offer', source, '111', { sentAt: raidAt });
    assert.deepEqual((await f.state.getKeeperRegistry()).pendingHop.offers, []);
    await finish(f);
    const response = await f.apps[source].dispatch({ method: 'GET', path: '/api/journey' });
    assert.equal(response.status, 200);
    const value = JSON.parse(response.body);
    assert.equal(value.rings, 1);
    for (const key of ['eventId', 'streamId', 'userId', 'offers', 'accepts', 'threshold'])
      assert.ok(!response.body.includes(`"${key}"`));
    assert.equal(
      (await f.apps[source].dispatch({ method: 'POST', path: '/api/journey' })).status,
      404,
    );
  });
  test(`${kind}: veto across a later stream purges archive permanently without resurrecting it`, async () => {
    const f = fixture(kind);
    await f.setup();
    await f.chat('!mark moon', source, '333');
    await f.chat('!relic approve m1');
    f.advance(1000);
    await f.raid();
    await finish(f);
    f.advance(1000);
    await f.online(source, '9003');
    await createMarkService(f.state).vetoLast(source, { broadcasterId: source, chatterId: source });
    assert.equal((await f.state.getPublicJourney()).stops[0].marks.length, 0);
    await f.chat('!relic approve m1');
    assert.equal((await f.state.getPublicJourney()).stops[0].marks.length, 0);
  });
}

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: verified raid then source closure permits claims without reopening or weakening policy`, async () => {
    for (const policy of ['none', 'pause', 'opt-out', 'ban', 'block', 'target-offline']) {
      const f = fixture(kind);
      await open(f);
      const raidAt = f.now();
      f.advance(1000);
      await f.offline();
      assert.equal((await f.state.getKeeperRegistry()).pendingHop.raidSentAt, raidAt);
      if (policy === 'pause') await f.chat('!relic pause');
      if (policy === 'opt-out') await f.chat('!relic opt-out');
      if (policy === 'ban')
        await f.state.setChannelPolicy(source, { banned: true, blockedUserIds: [] }, f.now());
      if (policy === 'block') await f.chat(`!relic block ${target}`);
      if (policy === 'target-offline') await f.offline(target);
      await finish(f);
      assert.equal((await f.state.getPublicJourney()).rings, policy === 'none' ? 1 : 0, policy);
      assert.equal((await f.state.getStreamStatus(source)).online, false);
    }
  });
  test(`${kind}: earlier offline boundary, restarted source and wrong retired stream reject claims`, async () => {
    for (const scenario of ['earlier-boundary', 'restart', 'wrong-retired-id']) {
      const f = fixture(kind);
      await open(f);
      const raidAt = f.now();
      f.advance(1000);
      if (scenario === 'earlier-boundary') {
        await f.apps[source].dispatch(
          f.request(
            source,
            'stream.offline',
            { broadcaster_user_id: source },
            { sentAt: raidAt - 1 },
          ),
        );
      } else {
        await f.offline();
        f.advance(1000);
        await f.online(source, '9003');
        if (scenario === 'wrong-retired-id') {
          f.advance(1000);
          await f.offline();
          assert.equal((await f.state.getStreamStatus(source)).retiredStream.streamId, '9003');
        }
      }
      await finish(f);
      assert.equal((await f.state.getPublicJourney()).rings, 0, scenario);
      assert.equal((await f.state.getKeeperRegistry()).holderId, source);
    }
  });
  test(`${kind}: every approved mark through the full 160 stream cap archives and forget purges all own content`, async () => {
    for (const count of [33, 160]) {
      const f = fixture(kind);
      await f.setup();
      for (let i = 0; i < count; i++) {
        // Five per viewer, 32 viewers; preserve the real quotas/cooldown.
        if (i && i % 32 === 0) f.advance(30000);
        await f.chat('!mark moon', source, String(1000 + (i % 32)));
        await f.chat(`!relic approve m${i + 1}`);
      }
      f.advance(1);
      await f.raid();
      await finish(f);
      const journey = await f.state.getPublicJourney();
      assert.equal(journey.rings, 1);
      assert.equal(journey.stops[0].marks.length, count);
      const ownCount = Math.ceil(count / 32);
      await f.chat('!relic forgetme', source, '1000');
      assert.equal((await f.state.getPublicJourney()).stops[0].marks.length, count - ownCount);
      const privateMarks = await f.state.getPrivateMarks(source, {
        broadcasterId: source,
        chatterId: source,
      });
      assert.ok(
        privateMarks.sessions.every((session) =>
          session.marks.every((mark) => mark.userId !== '1000'),
        ),
      );
    }
  });
}

test('Firestore oversized serialized history aborts final claim with all records unchanged', async () => {
  const f = fixture('firestore');
  await open(f);
  await f.chat('!offer', source, '111');
  const key = `markChannels/${hash(source)}`;
  const doc = f.db.docs.get(key);
  // Bounded content/identities, 160 marks per stop, 15 prior stops.
  // An oversized legacy/corrupt private record must still fail the byte guard.
  const marks = Array.from({ length: 160 }, (_, i) => ({
    id: `m${i + 1}`,
    userId: '12345678901234567890123456789012',
    text: '𐐨'.repeat(32),
    status: 'approved',
    createdAt: base,
  }));
  doc.sessions[0].marks = marks;
  f.db.docs.set(key, doc);
  const stops = Array.from({ length: 15 }, (_, i) => ({
    stopId: hash(`stop-${i}`),
    eventId: hash(`raid-${i}`),
    from: source,
    to: target,
    streamId: '9001',
    claimedAt: base,
    raidSize: 1,
    ringIndex: i + 1,
    marks: marks.map(({ id, userId, text }) => ({ id, userId, text })),
  }));
  const history = { stops, legacyPadding: 'x'.repeat(LINEAGE_LIMITS.bytes) };
  assert.ok(Buffer.byteLength(JSON.stringify(history)) > LINEAGE_LIMITS.bytes);
  f.db.docs.set(`lineage/${hash('single')}`, history);
  const before = structuredClone([...f.db.docs]);
  const request = f.chatRequest('!accept', target, '222');
  await assert.rejects(f.apps[source].dispatch(request), /Lineage capacity reached/);
  assert.deepEqual([...f.db.docs], before);
  assert.equal((await f.state.getKeeperRegistry()).holderId, source);
});

for (const kind of ['memory', 'firestore'])
  test(`${kind}: actual Twitch empty opposite raid condition still opens verified handoff and atomic claim`, async () => {
    const f = fixture(kind);
    await f.setup();
    f.advance(1000);
    await f.raid(target, {
      condition: { from_broadcaster_user_id: source, to_broadcaster_user_id: '' },
    });
    assert.equal((await f.state.getKeeperRegistry()).pendingHop.to, target);
    await finish(f);
    assert.equal((await f.state.getKeeperRegistry()).holderId, target);
    assert.equal((await f.state.getPublicJourney()).rings, 1);
  });
