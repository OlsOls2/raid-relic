import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredKeeperNetwork, RECEIVING_KEEPERS } from '../src/receiving.js';
import { createApp } from '../src/app.js';
import { pilotFixture } from '../test-support/pilot-fixture.js';
import {
  network3Fixture,
  readyNetwork3,
  networkHop,
  NETWORK3,
  HOME,
  OTHER,
  THIRD,
  BOT,
} from '../test-support/network3-fixture.js';
const config = { home: HOME, bot: BOT };
test('operator Keeper mapping is bounded, closed, duplicate-safe and retains existing identities', () => {
  assert.deepEqual(configuredKeeperNetwork(undefined, config), RECEIVING_KEEPERS);
  assert.deepEqual(configuredKeeperNetwork(JSON.stringify(NETWORK3), config), NETWORK3);
  assert.equal(
    Object.keys(
      configuredKeeperNetwork(JSON.stringify({ ...NETWORK3, 12345: 'fourthkeeper' }), config),
    ).length,
    4,
  );
  for (const raw of [
    'null',
    '[]',
    'false',
    '"map"',
    '{',
    'x'.repeat(1025),
    JSON.stringify({ ...NETWORK3, [BOT]: 'raidrelicbot' }),
    JSON.stringify({ ...NETWORK3, [THIRD]: 'olsols2' }),
    JSON.stringify({ ...NETWORK3, [THIRD]: '../olsols3' }),
    JSON.stringify({ ...NETWORK3, 0: 'zero' }),
    JSON.stringify({ ...NETWORK3, '001': 'leadingzero' }),
    JSON.stringify({ ...NETWORK3, [THIRD]: { login: 'olsols3' } }),
    JSON.stringify({ ...NETWORK3, [THIRD]: 'constructor' }),
    JSON.stringify({ ...NETWORK3, [HOME]: 'different' }),
    JSON.stringify({ ...NETWORK3, 1: 'four', 2: 'five' }),
    '{"1591805230":"raidrelichq","1591806023":"olsols2","1591806023":"olsols2"}',
    '{"__proto__":{"polluted":true},"1591805230":"raidrelichq","1591806023":"olsols2"}',
  ])
    assert.throws(() => configuredKeeperNetwork(raw, config));
});
test('configured public module is early, read-only, self-contained and has no store/OAuth access', async () => {
  const trap = new Proxy(
    {},
    {
      get() {
        throw Error('SDK access');
      },
    },
  );
  const app = createApp({ keeperNames: NETWORK3, state: trap, oauth: trap });
  const r = await app.dispatch({ method: 'GET', path: '/keeper-network.js' });
  assert.equal(r.status, 200);
  assert.match(r.body, /1593561134.*olsols3/);
  assert.doesNotMatch(r.body, /fetch|import|process|token|secret/i);
  assert.equal((await app.dispatch({ method: 'POST', path: '/keeper-network.js' })).status, 405);
});
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: third admission needs its own identity and grant; existing ten subscriptions are untouched`, async () => {
    const f = await network3Fixture(kind);
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) await f.control(id, 'bootstrap');
    assert.equal(f.subscriptions.length, 10);
    assert.equal((await f.request('/oauth/keeper/999/start')).status, 404);
    // Start a third role but return the other signed account: must reject, no role replacement.
    const start = await f.request(`/oauth/keeper/${THIRD}/start`);
    const nonce = new URL(start.headers.location).searchParams.get('state');
    const bad = await f.request('/auth/callback?state=' + nonce + '&code=' + OTHER, 'GET', {
      cookie: start.headers['set-cookie'].split(';')[0],
    });
    assert.equal(bad.status, 400);
    assert.ok(!(await f.runtime.store.getToken('keeper:' + THIRD)));
    const before = f.calls.filter(
      (c) => c.url.endsWith('/subscriptions') && c.method === 'POST',
    ).length;
    await assert.rejects(f.runtime.subscriptionManagers[THIRD].reconcile({ readiness: true }));
    assert.equal(
      f.calls.filter((c) => c.url.endsWith('/subscriptions') && c.method === 'POST').length,
      before,
    );
    await f.login(THIRD);
    assert.equal((await f.control(THIRD, 'bootstrap')).status, 200);
    assert.equal(f.subscriptions.length, 15);
    const own = f.subscriptions.slice(10);
    assert.equal(own.length, 5);
    assert.ok(own.every((s) => Object.values(s.condition).includes(THIRD)));
    assert.deepEqual(own.map((s) => s.type).sort(), [
      'channel.chat.message',
      'channel.raid',
      'channel.raid',
      'stream.offline',
      'stream.online',
    ]);
    await f.control(THIRD, 'bootstrap');
    assert.equal(f.subscriptions.length, 15);
    assert.equal((await f.runtime.state.getStreamStatus(THIRD)).optedIn, false);
  });
  test(`${kind}: signed A→B→C→A, early offers, distinct chat roles, independent budgets and cross-room erasure`, async () => {
    const f = await network3Fixture(kind);
    assert.equal(f.calls.length, 0);
    await readyNetwork3(f);
    for (const id of [HOME, OTHER, THIRD]) {
      assert.equal((await f.request('/overlay/' + id)).status, 200);
      assert.equal((await f.request('/keeper/' + NETWORK3[id])).status, 200);
    }
    await f.chat(HOME, '99001', '!mark moon');
    await networkHop(f, HOME, OTHER);
    await f.chat(OTHER, '99001', '!mark star');
    await networkHop(f, OTHER, THIRD);
    await f.chat(THIRD, '99001', '!mark sun');
    const p = await f.runtime.overlayFeeds[THIRD].snapshot();
    assert.equal(p.holderLogin, 'olsols3');
    assert.equal(p.lineageRings, 2);
    await networkHop(f, THIRD, HOME);
    const journey = await f.runtime.state.getPublicJourney();
    assert.equal(journey.rings, 3);
    assert.deepEqual(
      journey.stops.map((s) => [s.from, s.to]),
      [
        [HOME, OTHER],
        [OTHER, THIRD],
        [THIRD, HOME],
      ],
    );
    const third = JSON.parse((await f.request('/api/keeper/olsols3')).body);
    assert.equal(third.profile.received.length, 1);
    assert.equal(third.profile.received[0].to, 'olsols3');
    await f.chat(HOME, '99001', '!relic forgetme');
    assert.doesNotMatch(JSON.stringify(await f.runtime.state.getPublicJourney()), /moon/);
    for (const id of [HOME, OTHER, THIRD]) {
      const privateDoc = await f.runtime.state.getPrivateMarks(id, {
        broadcasterId: id,
        chatterId: id,
      });
      assert.ok(
        privateDoc.sessions.some((s) =>
          s.viewers.some((p) => p.userId === '99001' && p.spent === 1),
        ),
      );
    }
    assert.equal((await f.request('/keeper/unknown')).status, 404);
    assert.equal((await f.request('/api/keeper/unknown')).status, 404);
  });
  test(`${kind}: default network denies third OAuth/control; adding mapping never opts it into seeking`, async () => {
    const base = await pilotFixture(kind);
    assert.equal((await base.request(`/oauth/keeper/${THIRD}/start`)).status, 404);
    assert.equal((await base.request(`/control/${THIRD}/status`)).status, 404);
    const f = await network3Fixture(kind);
    await readyNetwork3(f);
    const own = await f.runtime.state.getStreamStatus(THIRD);
    assert.notEqual(own.seeking, true);
    const status = await f.request(`/control/${HOME}/status`, 'GET', { cookie: f.cookies[HOME] });
    const csrf = JSON.parse(status.body).csrf;
    assert.equal(
      (
        await f.request(
          `/control/${THIRD}`,
          'POST',
          {
            cookie: f.cookies[HOME],
            origin: 'https://pilot.example',
            'content-type': 'application/json',
          },
          Buffer.from(JSON.stringify({ action: 'seek-on', csrf })),
        )
      ).status,
      403,
    );
    assert.notEqual((await f.runtime.state.getStreamStatus(THIRD)).seeking, true);
    assert.equal((await f.control(THIRD, 'seek-on')).status, 200);
    assert.equal((await f.runtime.state.getStreamStatus(THIRD)).seeking, true);
    f.revoke(THIRD);
    await assert.rejects(f.runtime.receiving.authorize(HOME, THIRD));
  });
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: third offline Wander recipient requires explicit membership and existing grants, never a fabricated stream`, async () => {
    const { P7_SCOPES } = await import('../src/p7-scopes.js');
    const { wanderSignature, WANDER_PURPOSE } = await import('../src/wander-auth.js');
    const f = await network3Fixture(kind, {
      initialNow: Date.parse('2026-10-20T12:00:00Z'),
      extraBotScopes: [...P7_SCOPES],
      chronicleEnv: {
        SEEKERS_ENABLED: 'true',
        WANDER_ENABLED: 'true',
        WANDER_IDLE_HOURS: '72',
        WANDER_WARNING_HOURS: '12',
        P9_STREAK_ENABLED: 'true',
      },
    });
    await readyNetwork3(f);
    assert.equal((await f.control(THIRD, 'seek-on')).status, 200);
    f.streams.delete(THIRD);
    await f.signed('stream.offline', { broadcaster_user_id: THIRD }, THIRD);
    const tick = async (n) => {
      const raw = Buffer.from(
        JSON.stringify({
          purpose: WANDER_PURPOSE,
          timestamp: f.now(),
          nonce: n.toString(16).padStart(32, '0'),
        }),
      );
      return JSON.parse(
        (
          await f.request(
            '/internal/wander/tick',
            'POST',
            {
              'content-type': 'application/json',
              'x-rr-wander-signature': wanderSignature(Buffer.alloc(32, 5).toString('base64'), raw),
            },
            raw,
          )
        ).body,
      ).status;
    };
    await tick(1);
    f.advance(60 * 3600000);
    assert.equal(await tick(2), 'warning-queued');
    await f.login(THIRD);
    assert.equal((await f.control(THIRD, 'seek-off')).status, 200);
    f.advance(12 * 3600000);
    assert.equal(await tick(3), 'parked');
    await f.login(THIRD);
    assert.equal((await f.control(THIRD, 'seek-on')).status, 200);
    f.advance();
    assert.equal(await tick(4), 'wandered');
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, THIRD);
    const c = await f.runtime.state.getStreamStatus(THIRD);
    assert.equal(c.online, false);
    const marks = await f.runtime.state.getPrivateMarks(THIRD, {
      broadcasterId: THIRD,
      chatterId: THIRD,
    });
    assert.equal(marks.context.holdsRelic, false);
    assert.equal((await f.runtime.state.getPublicJourney()).stops[0].kind, 'wander');
    assert.equal(f.calls.filter((c) => new URL(c.url).pathname === '/helix/raids').length, 0);
  });
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: an unconsented third room cannot disrupt the already-authorised pair's optional actions`, async () => {
    const { P7_SCOPES } = await import('../src/p7-scopes.js');
    const calls = [];
    const p7HTTP = async (url, options = {}) => {
      calls.push({ url, ...options });
      const u = new URL(url);
      if (u.pathname.endsWith('/token'))
        return {
          status: 200,
          data: { access_token: 'synthetic-network-app', token_type: 'bearer', expires_in: 3600 },
        };
      if (u.pathname.endsWith('/moderation/channels'))
        return {
          status: 200,
          data: {
            data: [HOME, OTHER].map((broadcaster_id) => ({ broadcaster_id })),
            pagination: {},
          },
        };
      assert.equal(options.headers.Authorization, 'Bearer synthetic-network-app');
      assert.equal(u.searchParams.get('moderator_id'), BOT);
      assert.equal(
        u.searchParams.get(
          u.pathname.endsWith('/shoutouts') ? 'from_broadcaster_id' : 'broadcaster_id',
        ),
        OTHER,
      );
      return { status: 204, data: null };
    };
    const f = await network3Fixture(kind, {
      extraBotScopes: [...P7_SCOPES],
      p7HTTP,
      chronicleEnv: {
        P7_BOT_ACTIONS_ENABLED: 'true',
        P7_ANNOUNCEMENTS_ENABLED: 'true',
        P7_PIN_ENABLED: 'true',
        P7_SHOUTOUTS_ENABLED: 'true',
        P7_ALLOW_PIN_REPLACE: 'true',
      },
    });
    await f.login(BOT, { p7: true });
    for (const id of [HOME, OTHER]) {
      await f.login(id);
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    assert.ok(!(await f.runtime.store.getToken('keeper:' + THIRD)));
    await networkHop(f, HOME, OTHER);
    const actions = calls.filter((c) => new URL(c.url).pathname.startsWith('/helix/chat/'));
    assert.equal(actions.length, 3);
    const announcement = actions.find((c) => new URL(c.url).pathname.endsWith('/announcements'));
    assert.equal(JSON.parse(announcement.body).for_source_only, true);
    assert.match(JSON.parse(announcement.body).message, /@olsols2.*@raidrelichq/);
    const shout = actions.find((c) => new URL(c.url).pathname.endsWith('/shoutouts'));
    assert.equal(new URL(shout.url).searchParams.get('from_broadcaster_id'), OTHER);
    assert.equal(new URL(shout.url).searchParams.get('to_broadcaster_id'), HOME);
    assert.ok(!(await f.runtime.store.getToken('keeper:' + THIRD)));
  });
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: malformed batched stream metadata stays unavailable until a fresh bounded observation`, async () => {
    const f = await network3Fixture(kind);
    await readyNetwork3(f);
    assert.equal((await f.control(OTHER, 'seek-on')).status, 200);
    f.advance(60001);
    delete f.streams.get(THIRD).viewer_count;
    const reads = () => f.calls.filter((c) => new URL(c.url).pathname === '/helix/streams').length;
    const before = reads();
    assert.deepEqual((await f.runtime.receiving.page()).seekers, []);
    assert.equal(reads(), before + 1);
    f.streams.get(THIRD).viewer_count = 1;
    // Repairing metadata does not bypass the one-minute retry budget.
    assert.deepEqual((await f.runtime.receiving.page()).seekers, []);
    assert.equal(reads(), before + 1);
    f.advance(60001);
    assert.ok((await f.runtime.receiving.page()).seekers.some((s) => s.login === 'olsols2'));
    assert.equal(reads(), before + 2);
  });
}
