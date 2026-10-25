import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { SCOPES } from '../src/oauth.js';
async function fixture(kind, permitted = true) {
  const f = await pilotFixture(kind, { extraKeeperScopes: permitted ? ['channel:moderate'] : [] });
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) { await f.control(id, 'bootstrap'); f.advance(); await f.control(id, 'keep'); }
  f.ban = (host, user, overrides = {}) => f.signed('channel.ban', { broadcaster_user_id: host, user_id: user, moderator_user_id: host, is_permanent: true, banned_at: new Date(f.now()).toISOString(), ends_at: null, ...overrides }, host);
  f.cancel = async (host, intent, extra = {}) => {
    const status = JSON.parse((await f.request(`/control/${host}/status`, 'GET', { cookie: f.cookies[host] })).body);
    return f.request(`/control/${host}/cancel-queued`, 'POST', { cookie: f.cookies[host], origin: 'https://pilot.example', 'content-type': 'application/json', ...extra },
      Buffer.from(JSON.stringify({ csrf: status.csrf, intentId: intent.id, generation: intent.generation })));
  };
  return f;
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: signed known bans persist/purge and prohibit marks and both claim sides; no implicit unban`, async () => {
    const f = await fixture(kind); await f.chat(HOME, '811', '!mark moon'); await f.chat(HOME, HOME, '!relic approve m1');
    f.advance(); await f.raid(HOME, OTHER, 4); await f.chat(HOME, '811', '!offer');
    assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 1);
    assert.equal((await f.ban(HOME, '811')).status, 204); await f.ban(HOME, '811');
    const channel = await f.runtime.state.getStreamStatus(HOME); assert.deepEqual(channel.observedBans, ['811']);
    const calls = f.calls.length; await f.chat(HOME, '811', '!mark star'); await f.chat(HOME, '811', '!offer');
    assert.equal(f.calls.length, calls); assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 0);
    await f.ban(OTHER, '812'); await f.chat(OTHER, '812', '!accept'); assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.accepts.length, 0);
    const doc = await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME }); assert.equal(doc.sessions[0].marks.length, 0);
    await f.runtime.state.setChannelPolicy(HOME, { banned: false, blockedUserIds: [] }, f.now());
    assert.ok((await f.runtime.state.getStreamStatus(HOME)).blockedUserIds.includes('811'));
    f.advance(30001); await f.chat(HOME, '811', '!mark ember'); assert.equal((await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME })).sessions[0].marks.length, 0);
  });
  test(`${kind}: no extra scope means no ban ingestion, malformed/copy/stale proof denied; plan remains five`, async () => {
    const f = await fixture(kind, false); assert.equal((await f.ban(HOME, '811')).status, 403); assert.equal((await f.runtime.state.getStreamStatus(HOME)).observedBans, undefined);
    assert.equal(f.runtime.subscriptionManagers[HOME].payloads().length, 5);
    assert.deepEqual(SCOPES.streamer, ['channel:bot', 'channel:manage:raids']);
    const g = await fixture(kind);
    for (const bad of [{ user_id: 'x' }, { moderator_user_id: 1 }, { is_permanent: 'true' }, { banned_at: 'bad' }, { source_broadcaster_user_id: OTHER }, { ends_at: 'bad' }, { broadcaster_user_id: OTHER }]) assert.equal((await g.ban(HOME, '811', bad)).status, 400);
    g.advance(300001); assert.equal((await g.ban(HOME, '811')).status, 403);
  });
  test(`${kind}: own exact queued generation can cancel, stale/cross-owner/origin proofs cannot; terminal state retained`, async () => {
    const f = await fixture(kind); await f.chat(HOME, HOME, '!relic send @olsols2');
    const intent = (await f.runtime.state.getKeeperRegistry()).send; assert.equal(intent.status, 'queued'); const before = f.calls.length;
    assert.equal(JSON.parse((await f.cancel(OTHER, intent)).body).status, 'blocked');
    assert.equal((await f.cancel(HOME, intent, { origin: 'https://other.invalid' })).status, 403);
    assert.equal(JSON.parse((await f.cancel(HOME, { ...intent, generation: 'a'.repeat(64) })).body).status, 'blocked');
    assert.equal(JSON.parse((await f.cancel(HOME, intent)).body).status, 'cancelled-undispatched');
    assert.equal((await f.runtime.state.getKeeperRegistry()).send.status, 'rejected'); assert.equal(f.calls.length, before);
    f.advance(); await f.chat(HOME, HOME, '!relic send @olsols2'); const newer = (await f.runtime.state.getKeeperRegistry()).send;
    assert.notEqual(newer.generation, intent.generation); assert.equal(JSON.parse((await f.cancel(HOME, intent)).body).status, 'blocked');
    const claim = await f.runtime.state.sendOffStep({ type: 'claim', source: HOME, owner: 'worker' }, f.now());
    assert.equal(JSON.parse((await f.cancel(HOME, newer)).body).status, 'blocked');
    await f.runtime.state.sendOffStep({ type: 'dispatch', id: claim.id, owner: 'worker' }, f.now());
    for (const status of ['unknown', 'accepted']) {
      await f.runtime.state.sendOffStep({ type: 'finish', id: claim.id, owner: 'worker', status }, f.now());
      assert.equal(JSON.parse((await f.cancel(HOME, newer)).body).status, 'blocked');
    }
    assert.equal(f.calls.filter(c => c.url.includes('/raids?')).length, 0);
  });
}
test('Firestore ban failure rolls back participant counts/policy/marks/dedupe together', async () => {
  const f = await fixture('firestore'); const before = await f.runtime.state.getStreamStatus(HOME);
  f.db.failCommit = true; await assert.rejects(f.ban(HOME, '811')); f.db.failCommit = false;
  assert.deepEqual(await f.runtime.state.getStreamStatus(HOME), before);
  await f.ban(HOME, '811'); assert.ok((await f.runtime.state.getStreamStatus(HOME)).observedBans.includes('811'));
});

for (const kind of ['memory', 'firestore']) test(`${kind}: cancellation races cannot dispatch twice; accepted/unknown/dispatching cannot cancel`, async () => {
  for (const status of ['accepted', 'unknown', 'dispatching']) {
    const f = await fixture(kind); await f.chat(HOME, HOME, '!relic send @olsols2'); const intent = (await f.runtime.state.getKeeperRegistry()).send;
    const claim = await f.runtime.state.sendOffStep({ type: 'claim', source: HOME, owner: 'worker' }, f.now());
    await f.runtime.state.sendOffStep({ type: 'dispatch', id: claim.id, owner: 'worker' }, f.now());
    if (status !== 'dispatching') await f.runtime.state.sendOffStep({ type: 'finish', id: claim.id, owner: 'worker', status }, f.now());
    assert.equal((await f.runtime.state.getKeeperRegistry()).send.status, status);
    assert.equal(JSON.parse((await f.cancel(HOME, intent)).body).status, 'blocked');
  }
  const f = await fixture(kind); await f.chat(HOME, HOME, '!relic send @olsols2'); const intent = (await f.runtime.state.getKeeperRegistry()).send;
  await Promise.all([f.cancel(HOME, intent), f.control(HOME, 'process'), f.control(HOME, 'process')]);
  assert.ok(f.calls.filter(c => new URL(c.url).pathname === '/helix/raids').length <= 1);
});
