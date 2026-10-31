import test from 'node:test';
import assert from 'node:assert/strict';
import { wanderFixture, WANDER_TEST_KEY } from '../test-support/wander-fixture.js';
import { HOME, OTHER, BOT, pilotFixture } from '../test-support/pilot-fixture.js';
import { wanderPolicy, wanderMutation, wanderKey } from '../src/wander-state.js';
import { wanderSignature, verifyWanderRequest, WANDER_PURPOSE } from '../src/wander-auth.js';
import { validJourney } from '../public/journey-map.js';
import { ringCardModel, validRingCardFilename } from '../public/ring-card.js';
const status = (r) => JSON.parse(r.body).status;
const posts = (f) =>
  f.calls.filter((c) => c.url.endsWith('/chat/messages')).map((c) => JSON.parse(c.body));
test('policy has no production minute shortcut and HMAC is raw-body/purpose/time bound', () => {
  assert.deepEqual(wanderPolicy(), { enabled: false, idleHours: 72, warningHours: 12 });
  for (const env of [
    { WANDER_ENABLED: 'yes' },
    { WANDER_IDLE_HOURS: '0.02' },
    { WANDER_IDLE_HOURS: '12', WANDER_WARNING_HOURS: '12' },
    { WANDER_WARNING_HOURS: '0' },
  ])
    assert.throws(() => wanderPolicy(env));
  const raw = Buffer.from(
    JSON.stringify({ purpose: WANDER_PURPOSE, timestamp: 100000, nonce: 'a'.repeat(32) }),
  );
  const sig = wanderSignature(WANDER_TEST_KEY, raw);
  assert.ok(verifyWanderRequest(WANDER_TEST_KEY, raw, sig, 100000));
  for (const [body, signature, now] of [
    [Buffer.from(raw + ' '), sig, 100000],
    [raw, '0'.repeat(64), 100000],
    [raw, sig, 160001],
  ])
    assert.equal(verifyWanderRequest(WANDER_TEST_KEY, body, signature, now), null);
});
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: unknown history waits full policy, warning is once, offline Wander is typed and next real claim starts1`, async () => {
    const f = await wanderFixture(kind);
    const initialCalls = f.calls.length;
    assert.equal(status(await f.tick()), 'waiting');
    assert.equal(
      f.calls.length,
      initialCalls,
      'unknown legacy tracking does not consult providers',
    );
    f.advanceHours(60);
    assert.equal(status(await f.tick()), 'warning-queued');
    assert.deepEqual(posts(f).map((p) => p.message), [
      'The relic has been idle. It may wander to an opted-in Keeper after the warning period. Add an approved mark or start a valid Send Off to keep playing.',
    ]);
    await f.signed('stream.offline', { broadcaster_user_id: OTHER }, OTHER);
    f.streams.delete(OTHER);
    f.advanceHours(12);
    assert.equal(status(await f.tick({ nonce: 'b'.repeat(32) })), 'wandered');
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, OTHER);
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, false);
    assert.ok((await f.runtime.state.getStreamStatus(OTHER)).seekAt >= f.now());
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).online, false);
    assert.equal(
      (await f.runtime.state.getPrivateMarks(OTHER, { broadcasterId: OTHER, chatterId: OTHER }))
        .context.holdsRelic,
      false,
    );
    const journey = await f.runtime.state.getPublicJourney();
    assert.equal(journey.rings, 1);
    assert.equal(journey.stops[0].kind, 'wander');
    assert.equal(journey.stops[0].raidSize, null);
    assert.equal(f.calls.filter((c) => new URL(c.url).pathname === '/helix/raids').length, 0);
    assert.deepEqual(posts(f).map((p) => p.message), [
      'The relic has been idle. It may wander to an opted-in Keeper after the warning period. Add an approved mark or start a valid Send Off to keep playing.',
      'The relic wandered here to @olsols2; no raid or audience transfer occurred. Leave !mark word to add a community rune.',
    ]);
    assert.equal(status(await f.tick({ nonce: 'b'.repeat(32) })), 'duplicate');
    const scores = await f.runtime.state.getScoreboard(f.now());
    assert.ok(
      scores.channels.every((c) => c.hopsCarried === 0 && !c.badges.includes('Chain of 3')),
    );
    assert.equal(scores.streak.current, 0);
    const map = { ...(await f.runtime.state.getJourneyMap(f.now())), mode: 'simulator' };
    assert.equal(validJourney(map), true);
    const snapshot = await f.runtime.overlayFeeds[OTHER].snapshot();
    assert.equal(snapshot.handoff, null);
    assert.equal(snapshot.wanderArrival.kind, 'wander');
    f.advance();
    // Real online proof attaches a new session; never fabricated by Wander.
    const stream = {
      user_id: OTHER,
      id: '9902',
      type: 'live',
      viewer_count: 1,
      started_at: new Date(f.now()).toISOString(),
    };
    f.streams.set(OTHER, stream);
    await f.signed(
      'stream.online',
      { broadcaster_user_id: OTHER, id: stream.id, type: 'live', started_at: stream.started_at },
      OTHER,
    );
    f.advance();
    await f.control(HOME, 'seek-on');
    f.advance();
    await f.control(OTHER, 'send:' + HOME);
    f.advance();
    await f.raid(OTHER, HOME, 1);
    await f.chat(OTHER, '8201', '!offer');
    await f.chat(HOME, '8202', '!accept');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 2);
    assert.equal((await f.runtime.state.getScoreboard(f.now())).streak.current, 1);
  });
  test(`${kind}: unsigned/stale/wrong-purpose/feature-off do nothing; replay and concurrent tick produce one warning`, async () => {
    const f = await wanderFixture(kind);
    const before = await f.runtime.state.getKeeperRegistry(),
      calls = f.calls.length,
      writes = f.db?.writes.length;
    assert.equal((await f.tick({ signature: '0'.repeat(64) })).status, 403);
    assert.equal((await f.tick({ timestamp: f.now() - 60001 })).status, 403);
    assert.equal((await f.tick({ purpose: 'other-purpose' })).status, 403);
    assert.deepEqual(await f.runtime.state.getKeeperRegistry(), before);
    assert.equal(f.calls.length, calls);
    if (f.db) assert.equal(f.db.writes.length, writes);
    await f.tick();
    f.advanceHours(60);
    await Promise.all([f.tick(), f.tick()]);
    assert.equal(posts(f).filter((p) => p.message.startsWith('The relic has been idle')).length, 1);
    const disabled = await pilotFixture(kind);
    const none = disabled.calls.length;
    assert.equal(
      (await disabled.request('/internal/wander/tick', 'POST', {}, Buffer.from('{}'))).status,
      403,
    );
    assert.equal(disabled.calls.length, none);
  });
  test(`${kind}: meaningful approved play cancels idle; public reads, invalid/held marks and source offline do not reset it`, async () => {
    const f = await wanderFixture(kind);
    await f.tick();
    const original = (await f.runtime.state.getKeeperRegistry()).wander.activityAt;
    f.advanceHours(60);
    await f.tick();
    await f.runtime.state.getReceivingView(f.now());
    await f.runtime.state.getScoreboard(f.now());
    await f.chat(HOME, '8301', '!mark spoiler');
    assert.equal((await f.runtime.state.getKeeperRegistry()).wander.activityAt, original);
    f.advance();
    await f.chat(HOME, '8302', '!mark moon');
    assert.equal((await f.runtime.state.getKeeperRegistry()).wander.activityAt, f.now());
    f.advanceHours(12);
    assert.equal(status(await f.tick()), 'waiting');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
  });
  test(`${kind}: no eligible recipient parks, revoked grant fails closed and retained references erase without quota refund`, async () => {
    const f = await wanderFixture(kind);
    await f.chat(HOME, '8401', '!mark moon');
    await f.tick();
    f.advanceHours(60);
    await f.tick();
    f.advance();
    await f.login(OTHER);
    assert.equal((await f.control(OTHER, 'seek-off')).status, 200);
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, false);
    f.advanceHours(12);
    assert.equal(status(await f.tick()), 'parked');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
    f.advance();
    await f.login(OTHER);
    assert.equal((await f.control(OTHER, 'seek-on')).status, 200);
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
    assert.equal(status(await f.tick()), 'wandered');
    assert.equal((await f.runtime.state.getPublicJourney()).stops[0].marks[0].text, 'moon');
    await f.chat(HOME, '8401', '!relic forgetme');
    assert.equal((await f.runtime.state.getPublicJourney()).stops[0].marks.length, 0);
    const privateMarks = await f.runtime.state.getPrivateMarks(HOME, {
      broadcasterId: HOME,
      chatterId: HOME,
    });
    assert.equal(privateMarks.sessions[0].viewers.find((v) => v.userId === '8401').spent, 1);
  });
}

test('pure CAS rejects stale activity/policy, prioritises live then small audience, blocks ambiguous dispatch and history cap', () => {
  const channels = {};
  const marks = {};
  for (const id of ['1', '2', '3', '4']) {
    channels[id] = {
      optedIn: true,
      online: id !== '2',
      streamId: 's' + id,
      seeking: true,
      seekAt: 1, // Explicit pre-hold membership in this synthetic capability fixture.
      paused: false,
      banned: false,
      blockedUserIds: [],
    };
    marks[id] = { context: { optedIn: true, streamId: 's' + id }, sessions: [], blocked: [] };
  }
  const policy = wanderPolicy({ WANDER_ENABLED: 'true' }),
    config = { channels: Object.keys(channels), streakEnabled: true };
  let input = {
    registry: { holderId: '1', originated: true },
    channels,
    marks,
    lineage: { stops: [] },
  };
  input = wanderMutation(input, config, policy, { type: 'prepare', nonce: 'a'.repeat(64) }, 1000);
  input = wanderMutation(
    input,
    config,
    policy,
    { type: 'prepare', nonce: 'b'.repeat(64) },
    1000 + 60 * 3600000,
  );
  const proof = { at: 1000 + 60 * 3600000, source: '1', sourceValid: true, candidates: [] };
  input = wanderMutation(
    input,
    config,
    policy,
    { type: 'commit', nonce: 'b'.repeat(64), expected: wanderKey(input), proof },
    proof.at,
  );
  input.registry.wander.rows[0].status = 'accepted';
  const now = 1000 + 72 * 3600000;
  input = wanderMutation(input, config, policy, { type: 'prepare', nonce: 'c'.repeat(64) }, now);
  const op = {
    type: 'commit',
    nonce: 'c'.repeat(64),
    expected: wanderKey(input),
    proof: {
      at: now,
      source: '1',
      sourceValid: true,
      candidates: [
        { id: '2', live: false, viewers: 0 },
        { id: '3', live: true, viewers: 8, streamId: 's3' },
        { id: '4', live: true, viewers: 2, streamId: 's4' },
      ],
    },
  };
  assert.equal(wanderMutation(input, config, policy, op, now).registry.holderId, '4');
  const changed = structuredClone(input);
  changed.channels['4'].seeking = false;
  assert.equal(wanderMutation(changed, config, policy, op, now).result.status, 'superseded');
  const busy = structuredClone(input);
  busy.registry.send = { status: 'unknown' };
  assert.equal(
    wanderMutation(busy, config, policy, { ...op, expected: wanderKey(busy) }, now).result.status,
    'busy',
  );
  const full = structuredClone(input);
  full.lineage.stops = Array.from({ length: 16 }, () => ({}));
  assert.equal(
    wanderMutation(full, config, policy, { ...op, expected: wanderKey(full) }, now).result.status,
    'capacity',
  );
  assert.equal(
    wanderMutation(input, config, policy, op, 999).result.status,
    'clock-or-tracker-unavailable',
  );
  assert.equal(
    wanderMutation(input, config, policy, { ...op, proof: { ...op.proof, at: now - 30001 } }, now)
      .result.status,
    'capability-unavailable',
  );
  assert.equal(
    wanderMutation(
      input,
      config,
      policy,
      { ...op, proof: { ...op.proof, sourceValid: false } },
      now,
    ).result.status,
    'capability-unavailable',
  );
  const m = ringCardModel(
    { stopId: 'a'.repeat(64), keeper: '@olsols2', ringIndex: 1, claimedAt: 1000 },
    { kind: 'wander', now },
  );
  assert.match(m.caption, /Wandered.*no raid/);
  assert.equal(validRingCardFilename('raid-relic-wander-stop-1-olsols2.png'), true);
});

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: persistent CAS admits one move across concurrent commits and retry`, async () => {
    const f = await wanderFixture(kind);
    await f.tick();
    f.advanceHours(60);
    await f.tick();
    f.advanceHours(12);
    const nonce = 'e'.repeat(64);
    await f.runtime.state.wanderStep({ type: 'prepare', nonce }, f.now());
    const input = await f.runtime.state.getWanderInput();
    const op = {
      type: 'commit',
      nonce,
      expected: wanderKey(input),
      proof: {
        at: f.now(),
        source: HOME,
        sourceValid: true,
        candidates: [{ id: OTHER, live: true, viewers: 1, streamId: f.streams.get(OTHER).id }],
      },
    };
    if (f.db) f.db.retry = true;
    const results = await Promise.all([
      f.runtime.state.wanderStep(op, f.now()),
      f.runtime.state.wanderStep(op, f.now()),
    ]);
    assert.equal(results.filter((r) => r.status === 'wandered').length, 1);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
  });
  test(`${kind}: revoked recipient, bot grant failure and policy ban cannot acquire ownership`, async () => {
    for (const failure of ['recipient', 'bot', 'ban']) {
      const f = await wanderFixture(kind);
      await f.tick();
      f.advanceHours(60);
      await f.tick();
      f.advanceHours(12);
      if (failure === 'recipient') f.revoke(OTHER);
      if (failure === 'bot') f.revoke(BOT);
      if (failure === 'ban')
        await f.runtime.state.setChannelPolicy(
          OTHER,
          { banned: true, blockedUserIds: [] },
          f.now(),
        );
      const result = status(await f.tick());
      assert.ok(['parked', 'capability-unavailable'].includes(result));
      assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
      assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
      assert.equal(f.calls.filter((c) => new URL(c.url).pathname === '/helix/raids').length, 0);
    }
  });
}

test('internal authentication rejects before any store/provider property access', async () => {
  const { createApp } = await import('../src/app.js');
  let accesses = 0;
  const trap = new Proxy(
    {},
    {
      get() {
        accesses++;
        throw Error('No capability');
      },
    },
  );
  const app = createApp({
    state: trap,
    oauth: trap,
    wander: {
      enabled: true,
      verify: () => null,
      tick: () => {
        accesses++;
      },
    },
  });
  assert.equal(
    (
      await app.dispatch({
        method: 'POST',
        path: '/internal/wander/tick',
        rawBody: Buffer.from('{}'),
      })
    ).status,
    403,
  );
  assert.equal(accesses, 0);
});

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: old-holder offline alone neither resets activity nor fabricates a raid/online session`, async () => {
    const f = await wanderFixture(kind);
    await f.tick();
    const at = (await f.runtime.state.getKeeperRegistry()).wander.activityAt;
    f.advanceHours(60);
    await f.tick();
    f.advance();
    await f.signed('stream.offline', { broadcaster_user_id: HOME }, HOME);
    f.streams.delete(HOME);
    assert.equal((await f.runtime.state.getKeeperRegistry()).wander.activityAt, at);
    f.advanceHours(12);
    assert.equal(status(await f.tick()), 'wandered');
    assert.equal((await f.runtime.state.getStreamStatus(HOME)).online, false);
    const row = (await f.runtime.state.getPublicJourney()).stops[0];
    assert.equal(row.kind, 'wander');
    assert.equal(row.raidSize, null);
    assert.equal((await f.runtime.overlayFeeds[OTHER].snapshot()).handoff, null);
  });
}

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: expired control cookie and original CSRF cannot withdraw Seeker consent`, async () => {
    const f = await wanderFixture(kind);
    const response = await f.request(`/control/${OTHER}/status`, 'GET', {
      cookie: f.cookies[OTHER],
    });
    assert.equal(response.status, 200);
    const csrf = JSON.parse(response.body).csrf;
    const before = await f.runtime.state.getStreamStatus(OTHER);
    assert.equal(before.seeking, true);
    f.advanceHours(60);
    assert.equal(
      (await f.request(`/control/${OTHER}/status`, 'GET', { cookie: f.cookies[OTHER] })).status,
      401,
    );
    assert.equal((await f.control(OTHER, 'seek-off', {}, { csrf })).status, 403);
    assert.deepEqual(await f.runtime.state.getStreamStatus(OTHER), before);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
  });
}
