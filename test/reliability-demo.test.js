import test from 'node:test';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createRuntime } from '../src/runtime.js';
import { readFile } from 'node:fs/promises';
import {
  coldOptions,
  coldReadAllowed,
  coldAccess,
  coldSummary,
  coldBaseline,
  validateColdRow,
} from '../scripts/browser-smoke-reliability.js';

test('cold-navigation input, credential and read boundaries are closed without importing a running browser', () => {
  const origin = 'https://candidate---raid-relic-vz4bhnskgq-uc.a.run.app';
  assert.deepEqual(coldOptions(['--cold-navigation', '--origin=' + origin]), {
    origin,
    samples: 3,
    privateAccess: false,
  });
  for (const args of [
    [],
    ['--cold-navigation'],
    ['--cold-navigation', '--origin=http://example.run.app'],
    ['--cold-navigation', '--origin=' + origin + '/'],
    ['--cold-navigation', '--origin=' + origin, '--samples=4'],
    ['--cold-navigation', '--origin=' + origin, '--samples=0'],
    ['--cold-navigation', '--origin=' + origin, '--samples=1', '--samples=2'],
    ['--cold-navigation', '--origin=' + origin, '--unknown'],
    ['--cold-navigation=true', '--origin=' + origin],
  ])
    assert.throws(() => coldOptions(args));
  assert.throws(() => coldOptions(['--cold-navigation', '--origin=https://other.a.run.app']));
  assert.equal(coldReadAllowed(origin, origin + '/atlas/', 'GET'), true);
  assert.equal(coldReadAllowed(origin, origin + '/atlas.js', 'HEAD'), true);
  for (const path of [
    '/oauth/keeper/start',
    '/control/123/status',
    '/auth/callback',
    '/eventsub',
    '/internal/wander/tick',
    '/_preview/access',
    '/%6fauth/keeper/start',
  ])
    assert.equal(coldReadAllowed(origin, origin + path, 'GET'), false);
  for (const method of ['POST', 'PUT', 'DELETE'])
    assert.equal(coldReadAllowed(origin, origin + '/', method), false);
  assert.equal(coldReadAllowed(origin, 'https://provider.invalid/', 'GET'), false);
  const dummy = Buffer.alloc(32, 7).toString('base64url');
  assert.equal(coldAccess(Buffer.from(dummy + '\n')), dummy);
  for (const bytes of [
    Buffer.from(dummy + '\nextra'),
    Buffer.from(dummy + '\r\n'),
    Buffer.from('a'.repeat(43)),
    Buffer.from(dummy + '='),
    Buffer.alloc(43, 200),
  ])
    assert.throws(() => coldAccess(bytes));
});
test('cold-navigation baseline and metrics reject missing, duplicate or forged samples; summaries use median/max only', async () => {
  const baseline = JSON.parse(await readFile('docs/COLD_NAV_BASELINE_1031.json', 'utf8'));
  const summary = coldBaseline(baseline);
  assert.deepEqual(
    summary.map((r) => [r.medianMs, r.maxMs]),
    [
      [360, 428],
      [352, 380],
      [340, 356],
      [360, 364],
    ],
  );
  assert.ok(summary.every((r) => r.withinBudget));
  for (const patch of [
    { status: 401 },
    { visibility: 'hidden' },
    { error: 'TimeoutError' },
    { lcp: null },
    { lcp: { ...baseline.rows[0].lcp, time: 0 } },
    { lcp: { ...baseline.rows[0].lcp, time: NaN } },
    { paints: [] },
    { navigation: { ...baseline.rows[0].navigation, ttfb: 0 } },
  ])
    assert.throws(() => validateColdRow({ ...baseline.rows[0], ...patch }));
  assert.throws(() => coldSummary(baseline.rows.slice(1), 3));
  assert.throws(() => coldSummary([baseline.rows[1], ...baseline.rows.slice(1)], 3));
  assert.throws(() => coldBaseline({ ...baseline, serverColdStartForced: true }));
  assert.throws(() => coldBaseline({ ...baseline, samples: 4 }));
  const slow = structuredClone(baseline.rows);
  slow[0].lcp.time = 2501;
  assert.equal(coldSummary(slow, 3)[0].withinBudget, false);
});
const raidPosts = (f) =>
  f.calls.filter((c) => new URL(c.url).pathname.endsWith('/raids') && c.method === 'POST');
const refreshPosts = (f) =>
  f.calls.filter(
    (c) =>
      new URL(c.url).pathname.endsWith('/token') &&
      new URLSearchParams(c.body).get('grant_type') === 'refresh_token',
  );
async function pending(kind) {
  const f = await pilotFixture(kind, {
    rotateTokens: true,
    chronicleEnv: { P9_STREAK_ENABLED: 'true', MARK_AUTO_APPROVE_ENABLED: 'true' },
  });
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    assert.equal((await f.control(id, 'bootstrap')).status, 200);
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  await f.chat(HOME, '8600', '!mark moon');
  f.advance(31000);
  assert.equal(JSON.parse((await f.control(HOME, 'send:' + OTHER)).body).status, 'accepted');
  const sentAt = f.now();
  const receipt = () =>
    f.signed(
      'channel.raid',
      { from_broadcaster_user_id: HOME, to_broadcaster_user_id: OTHER, viewers: 4 },
      HOME,
      { from_broadcaster_user_id: HOME },
      { deliveryId: 'reliable-receipt', sentAt },
    );
  await receipt();
  await f.chat(HOME, '8601', '!offer', { messageId: 'reliable-offer' });
  const before = await f.runtime.state.getKeeperRegistry();
  assert.equal(before.pendingHop.offers.length, 1);
  assert.equal(before.pendingHop.threshold, 2);
  return { f, before, receipt };
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: source expiry and bot rotation during pending quorum preserve receipt clock and never replay Raid POST`, async () => {
    const { f, before, receipt } = await pending(kind);
    const oldSource = await f.runtime.store.getToken('streamer'),
      oldBot = await f.runtime.store.getToken('bot');
    f.expire(HOME);
    f.expire(BOT);
    const refreshBefore = refreshPosts(f).length;
    const tokens = await Promise.all(
      Array.from({ length: 4 }, () => f.runtime.oauth.accessTokenForKeeper(HOME)),
    );
    assert.equal(new Set(tokens).size, 1);
    assert.equal(refreshPosts(f).length - refreshBefore, 1);
    assert.notDeepEqual(await f.runtime.store.getToken('streamer'), oldSource);
    await f.chat(OTHER, '8701', '!accept');
    assert.notDeepEqual(await f.runtime.store.getToken('bot'), oldBot);
    let snapshot = await f.runtime.overlayFeeds[OTHER].snapshot();
    assert.equal(snapshot.handoff.startedAt, before.pendingHop.startedAt);
    assert.equal(snapshot.handoff.endsAt, before.pendingHop.endsAt);
    assert.equal(snapshot.handoff.offers, 1);
    assert.equal(snapshot.handoff.accepts, 1);
    assert.equal(snapshot.lineageRings, 0);
    const grantWrites = refreshPosts(f).length;
    let leases = 0;
    const acquire = f.runtime.store.acquire.bind(f.runtime.store);
    f.runtime.store.acquire = (...args) => {
      leases++;
      return acquire(...args);
    };
    await f.runtime.oauth.accessTokenForKeeper(HOME);
    assert.equal(leases, 0);
    assert.equal(refreshPosts(f).length, grantWrites);
    const repliesBeforeDuplicate = f.calls.filter((c) =>
      new URL(c.url).pathname.endsWith('/chat/messages'),
    ).length;
    await receipt();
    await f.chat(HOME, '8601', '!offer', { messageId: 'reliable-offer' });
    assert.equal(
      f.calls.filter((c) => new URL(c.url).pathname.endsWith('/chat/messages')).length,
      repliesBeforeDuplicate,
    );
    assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 1);
    await f.chat(HOME, '8602', '!offer');
    await f.chat(OTHER, '8702', '!accept');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, OTHER);
    await receipt();
    await f.chat(OTHER, '8702', '!accept');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    assert.equal(raidPosts(f).length, 1);
    assert.ok(
      f.calls
        .filter((c) => new URL(c.url).pathname.endsWith('/chat/messages'))
        .every((c) => {
          const body = JSON.parse(c.body);
          return body.sender_id === BOT && [HOME, OTHER].includes(body.broadcaster_id);
        }),
    );
  });
  test(`${kind}: transient refresh 429/503 and definitive refresh rejection do not erase pending votes or manufacture consent`, async () => {
    const { f, before } = await pending(kind);
    f.expire(HOME);
    for (const status of [503, 429, 400, 401]) {
      f.refreshFailure(status);
      await assert.rejects(
        () => f.runtime.oauth.accessTokenForKeeper(HOME),
        (error) => {
          assert.equal(error.code === 'reconsent-required', [400, 401].includes(status));
          assert.doesNotMatch(error.message, /access-|refresh-|synthetic-client/);
          return true;
        },
      );
      const current = await f.runtime.state.getKeeperRegistry();
      assert.deepEqual(current.pendingHop, before.pendingHop);
      assert.equal(raidPosts(f).length, 1);
    }
    f.expire(BOT);
    f.refreshFailure(503);
    await f.chat(OTHER, '8701', '!accept');
    assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.accepts.length, 1);
    f.refreshFailure(null);
    await f.runtime.oauth.accessTokenForKeeper(HOME);
    await f.chat(HOME, '8602', '!offer');
    await f.chat(OTHER, '8702', '!accept');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    assert.equal(raidPosts(f).length, 1);
  });
}
test('shared Firestore runtime reconstruction retains partial quorum, original timestamps and completed history without startup networking', async () => {
  const { f, before, receipt } = await pending('firestore');
  await f.chat(OTHER, '8701', '!accept');
  const partial = await f.runtime.state.getKeeperRegistry();
  const calls = f.calls.length;
  f.advance(23000);
  await f.restart();
  assert.equal(f.calls.length, calls);
  const recovered = await f.runtime.overlayFeeds[OTHER].snapshot();
  assert.equal(recovered.handoff.startedAt, before.pendingHop.startedAt);
  assert.equal(recovered.handoff.endsAt, before.pendingHop.endsAt);
  assert.equal(recovered.handoff.offers, 1);
  assert.equal(recovered.handoff.accepts, 1);
  assert.ok(recovered.serverNow - recovered.handoff.startedAt >= 23000);
  assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop, partial.pendingHop);
  await receipt();
  assert.equal(raidPosts(f).length, 1);
  await f.chat(HOME, '8602', '!offer');
  await f.chat(OTHER, '8702', '!accept');
  const completed = await f.runtime.overlayFeeds[OTHER].snapshot();
  assert.equal(completed.lineageRings, 1);
  const journey = await f.runtime.state.getPublicJourney();
  const afterCalls = f.calls.length;
  await f.restart();
  assert.equal(f.calls.length, afterCalls);
  const again = await f.runtime.overlayFeeds[OTHER].snapshot();
  assert.equal(again.handoff.completedAt, completed.handoff.completedAt);
  assert.deepEqual(again.streak, completed.streak);
  assert.deepEqual(await f.runtime.state.getPublicJourney(), journey);
  assert.equal(raidPosts(f).length, 1);
  f.db.failReads = true;
  const writes = f.db.writes.length;
  assert.equal((await f.request('/api/atlas')).status, 503);
  assert.equal((await f.runtime.overlayFeeds[OTHER].snapshot()).status, 'unavailable');
  assert.equal(f.db.writes.length, writes);
  assert.equal(raidPosts(f).length, 1);
  f.db.failReads = false;
  assert.equal((await f.runtime.overlayFeeds[OTHER].snapshot()).lineageRings, 1);
});
test('failed production persistence loading fails closed rather than selecting memory or bootstrapping', async () => {
  let loads = 0;
  await assert.rejects(() =>
    createRuntime(
      {
        NODE_ENV: 'production',
        STATE_STORE: 'firestore',
        GOOGLE_CLOUD_PROJECT: 'raid-relic-hackathon',
        RELEASE_COMMIT: 'a'.repeat(40),
      },
      {
        loadSDK: async () => {
          loads++;
          throw Error('Unavailable persistence');
        },
      },
    ),
  );
  assert.equal(loads, 1);
});

test('raw webhook challenge, tamper, invalid JSON and delayed replay boundaries preserve an existing pending claim', async () => {
  const { f, before } = await pending('firestore');
  const request = (
    body,
    { age = 0, kind = 'webhook_callback_verification', tamper = false } = {},
  ) => {
    const id = 'reliability-boundary',
      timestamp = new Date(f.now() - age).toISOString();
    const signature =
      'sha256=' +
      createHmac('sha256', 'synthetic-pilot-hmac-secret')
        .update(id)
        .update(timestamp)
        .update(body)
        .digest('hex');
    return f.request(
      '/eventsub',
      'POST',
      {
        'twitch-eventsub-message-id': id,
        'twitch-eventsub-message-timestamp': timestamp,
        'twitch-eventsub-message-type': kind,
        'twitch-eventsub-message-signature': signature,
      },
      tamper ? Buffer.concat([body, Buffer.from(' ')]) : body,
    );
  };
  const body = Buffer.from(JSON.stringify({ challenge: 'fixture-✓' }));
  const challenge = await request(body);
  assert.equal(challenge.status, 200);
  assert.equal(challenge.body, 'fixture-✓');
  assert.equal((await request(body, { tamper: true })).status, 403);
  assert.equal((await request(body, { age: 600001 })).status, 403);
  assert.equal((await request(Buffer.from('{'))).status, 400);
  assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop, before.pendingHop);
  assert.equal(raidPosts(f).length, 1);
});
