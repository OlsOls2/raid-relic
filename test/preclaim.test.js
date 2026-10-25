import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { claimMeterView, handoffView } from '../src/public-view.js';
import { meterProgress, validClaimMeter } from '../public/claim-meter.js';
import { updatePresence } from '../src/presence.js';
async function setup(kind) {
  const f = await pilotFixture(kind); for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) { await f.control(id, 'bootstrap'); f.advance(); await f.control(id, 'keep'); f.advance(); }
  f.streams.get(HOME).viewer_count = 2; return f;
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: acceptance opens180s voting only; precollected quorums complete only on verified actual raid without extending clock`, async () => {
    const f = await setup(kind); await f.control(HOME, `send:${OTHER}`);
    const root = await f.runtime.state.getKeeperRegistry(), hop = root.pendingHop;
    assert.equal(hop.endsAt - hop.startedAt, 180000); assert.equal(hop.verified, false);
    const target = await f.runtime.overlayFeeds[OTHER].snapshot(); assert.equal(target.status, 'waiting'); assert.equal(target.handoff, null); assert.equal(target.marks.length, 0); assert.equal(target.claimMeter.awaitingRaid, true);
    await f.chat(HOME, HOME, '!offer'); await f.chat(OTHER, OTHER, '!accept');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0); assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
    f.advance(20000); const receipt = f.now(); await f.raid(HOME, OTHER, 2);
    const after = await f.runtime.state.getKeeperRegistry(); assert.equal(after.holderId, OTHER); assert.equal(after.pendingHop.endsAt, hop.endsAt);
    assert.equal(after.pendingHop.arrivalStartedAt, receipt); assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    assert.equal((await f.runtime.state.getPrivateClaimAcks(OTHER)).rows.filter(r => r.status === 'sent').length, 2);
    assert.ok(!JSON.stringify(await f.runtime.overlayFeeds[OTHER].snapshot()).includes('sourceStreamId'));
  });
  test(`${kind}: target offers require exact source-session presence; copied/bot/forgotten evidence cannot qualify`, async () => {
    const f = await setup(kind); await f.control(HOME, `send:${OTHER}`);
    await f.chat(OTHER, '811', '!offer'); assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 0);
    await f.chat(HOME, '812', 'hello'); f.advance(); await f.chat(OTHER, '812', '!offer');
    assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop.offers, ['812']);
    await f.chat(OTHER, '812', '!relic forgetme'); assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 0);
    await f.chat(OTHER, '812', '!offer'); assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 0);
    await f.signed('channel.chat.message', { broadcaster_user_id: HOME, chatter_user_id: '813', message_id: 'copied-presence', source_broadcaster_user_id: OTHER,
      source_message_id: '00000000-0000-4000-8000-000000000001', message: { text: 'hello', fragments: [] } }, HOME, { broadcaster_user_id: HOME, user_id: BOT });
    await f.chat(OTHER, '813', '!offer'); await f.chat(OTHER, BOT, '!offer'); assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 0);
  });
  test(`${kind}: signed actual threshold increases provisional estimate; strict180s boundary and late confirmation never revive votes`, async () => {
    const f = await setup(kind); await f.control(HOME, `send:${OTHER}`); await f.chat(HOME, HOME, '!offer'); await f.chat(OTHER, OTHER, '!accept');
    f.advance(); await f.raid(HOME, OTHER, 4); let root = await f.runtime.state.getKeeperRegistry(); assert.equal(root.pendingHop.threshold, 2); assert.equal(root.holderId, HOME);
    await f.chat(HOME, '821', '!offer'); await f.chat(OTHER, '822', '!accept'); assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    const g = await setup(kind); await g.control(HOME, `send:${OTHER}`); const end = (await g.runtime.state.getKeeperRegistry()).pendingHop.endsAt;
    g.advance(end - g.now()); await g.chat(HOME, HOME, '!offer'); await g.chat(OTHER, OTHER, '!accept'); await g.raid(HOME, OTHER, 1);
    root = await g.runtime.state.getKeeperRegistry(); assert.equal(root.send.status, 'confirmed'); assert.equal(root.pendingHop.cancelled, true); assert.equal(root.holderId, HOME); assert.equal((await g.runtime.state.getPublicJourney()).rings, 0);
    assert.equal((await g.runtime.pilot.expireHandoff(HOME, root.send.id, root.pendingHop.eventId)).status, 'expired-handoff');
  });
}
test('legacy90s/T2 meter and new180s meter validate strictly, clamp arcs, expire and contain no private proof', () => {
  const registry = { pendingHop: { from: HOME, to: OTHER, startedAt: 100, endsAt: 90100, threshold: 2, offers: ['private'], accepts: [] } };
  assert.equal(handoffView(registry, HOME, 101).threshold, 2);
  const old = claimMeterView(registry, HOME, 101); assert.equal(validClaimMeter(old), true); assert.equal(old.endsAt - old.startedAt, 90000);
  const modern = { ...old, endsAt: 180100, offers: 8, provisional: true, awaitingRaid: true };
  assert.equal(meterProgress(modern, 100).offers, 1); assert.equal(meterProgress(modern, 180100), null);
  assert.equal(validClaimMeter({ ...modern, userId: 'private' }), false);
});
test('presence is stream-scoped, bounded, no text/login retention and clears rather than resurrects after pause', () => {
  const c = { online: true, optedIn: true, streamId: '9', startedAt: 0, consentAt: 0, blockedUserIds: [] }, m = { context: { optedIn: true }, blocked: [] };
  let doc = updatePresence(null, HOME, c, m, { broadcasterId: HOME, chatterId: '811', messageId: 'original', chatterLogin: 'private', text: 'private' }, 10, 10);
  assert.deepEqual(doc.actors, [{ id: '811', seenAt: 10 }]); assert.ok(!JSON.stringify(doc).includes('private'));
  assert.equal(updatePresence(doc, HOME, { ...c, streamId: '10' }, m, null, 20, 20).actors.length, 0);
  doc = updatePresence(doc, HOME, { ...c, paused: true }, m, null, 20, 20); assert.equal(updatePresence(doc, HOME, c, m, null, 30, 30).actors.length, 0);
  assert.throws(() => updatePresence({ streamId: '9', actors: Array.from({ length: 256 }, (_, i) => ({ id: String(i), seenAt: 1 })) }, HOME, c, m, { broadcasterId: HOME, chatterId: '999', messageId: 'capacity' }, 30, 30), /capacity/);
});

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: actual threshold can decrease; concurrent receipt/votes still transfer once and preserve accepted clock`, async () => {
    const f = await setup(kind); f.streams.get(HOME).viewer_count = 100; await f.control(HOME, `send:${OTHER}`);
    const before = (await f.runtime.state.getKeeperRegistry()).pendingHop; assert.equal(before.threshold, 10);
    await Promise.all([f.chat(HOME, HOME, '!offer'), f.chat(OTHER, OTHER, '!accept'), f.raid(HOME, OTHER, 2)]);
    await f.raid(HOME, OTHER, 2);
    const root = await f.runtime.state.getKeeperRegistry(); assert.equal(root.holderId, OTHER); assert.equal(root.pendingHop.endsAt, before.endsAt); assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
  });
  test(`${kind}: source session restart/ban revokes moved proof and absent raid cannot transfer or clear accepted intent`, async () => {
    const f = await setup(kind); await f.chat(HOME, '831', 'hello');
    f.advance(); await f.signed('stream.offline', { broadcaster_user_id: HOME }, HOME); f.advance(1000);
    await f.signed('stream.online', { broadcaster_user_id: HOME, id: '9400', type: 'live', started_at: new Date(f.now()).toISOString() }, HOME);
    f.streams.get(HOME).id = '9400'; await f.control(HOME, `send:${OTHER}`);
    await f.chat(OTHER, '831', '!offer'); assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 0);
    await f.chat(HOME, '832', 'hello'); f.advance(); await f.chat(OTHER, '832', '!offer');
    await f.runtime.state.setChannelPolicy(HOME, { banned: false, blockedUserIds: ['832'] }, f.now());
    assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 0);
    f.advance(180001); await f.chat(OTHER, OTHER, '!accept');
    assert.equal((await f.runtime.state.getKeeperRegistry()).send.status, 'accepted'); assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
  });
}
test('Firestore presence/vote failure rolls back both counters and ledger proof', async () => {
  const f = await setup('firestore'); await f.control(HOME, `send:${OTHER}`);
  f.db.failCommit = true; await assert.rejects(f.chat(HOME, '841', 'hello')); f.db.failCommit = false;
  await f.chat(OTHER, '841', '!offer'); assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 0);
});
test('receipt-before-accepted-finish cannot restart arrival or overwrite confirmation', async () => {
  const { createSendOff } = await import('../src/send-off.js'); const f = await setup('firestore');
  await f.chat(HOME, HOME, '!relic send @olsols2');
  const service = createSendOff({ state: f.runtime.state, streamerId: HOME, clientId: 'public-client', now: f.now, logger: () => {}, oauth: { accessToken: async () => 'synthetic-source' }, transport: async (url, options) => {
    if (url.includes('/users?')) return { status: 200, data: { data: [{ id: OTHER, login: 'olsols2' }] } };
    if (url.includes('/streams?')) return { status: 200, data: { data: [...f.streams.values()] } };
    assert.equal(options.method, 'POST'); await f.raid(HOME, OTHER, 2); f.advance(1000); return { status: 200, data: { data: [{}] } };
  } });
  const received = f.now(); await service.processPending(); const root = await f.runtime.state.getKeeperRegistry();
  assert.equal(root.send.status, 'confirmed'); assert.equal(root.pendingHop.arrivalStartedAt, received); assert.equal(root.pendingHop.endsAt, received + 180000);
});
test('legacy persisted90-second threshold2 reducer is never retroconverted', async () => {
  const { reduceClaims } = await import('../src/claims.js'); const f = await setup('memory'); await f.raid(HOME, OTHER, 4);
  const root = await f.runtime.state.getKeeperRegistry(); delete root.pendingHop.policy; delete root.pendingHop.verified; delete root.pendingHop.claimStartedAt; delete root.pendingHop.claimEndsAt; root.pendingHop.endsAt = root.pendingHop.startedAt + 90000;
  const channels = {}, marks = {}; for (const id of [HOME, OTHER]) { channels[id] = await f.runtime.state.getStreamStatus(id); marks[id] = await f.runtime.state.getPrivateMarks(id, { broadcasterId: id, chatterId: id }); }
  const result = reduceClaims(root, channels, marks, { stops: [] }, null, root.pendingHop.startedAt + 89999);
  assert.equal(result.registry.pendingHop.threshold, 2); assert.equal(result.registry.pendingHop.endsAt - result.registry.pendingHop.startedAt, 90000); assert.equal(result.registry.holderId, HOME);
});

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: countdown-sent offer delivered after actual raid uses accepted clock, never arrival clock`, async () => {
    const f = await setup(kind); await f.control(HOME, `send:${OTHER}`); const before = (await f.runtime.state.getKeeperRegistry()).pendingHop;
    f.advance(1000); const sentAt = f.now(); f.advance(1000); await f.raid(HOME, OTHER, 2);
    const arrival = (await f.runtime.state.getKeeperRegistry()).pendingHop.arrivalStartedAt;
    f.advance(); await f.signed('channel.chat.message', { broadcaster_user_id: HOME, chatter_user_id: HOME, message_id: 'delayed-countdown', message: { text: '!offer', fragments: [] } }, HOME, { broadcaster_user_id: HOME, user_id: BOT }, { sentAt });
    assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 1);
    await f.chat(OTHER, OTHER, '!accept'); const result = await f.runtime.state.getKeeperRegistry();
    assert.equal(result.holderId, OTHER); assert.equal(result.pendingHop.endsAt, before.claimEndsAt); assert.equal(result.pendingHop.arrivalStartedAt, arrival);
  });
  test(`${kind}: moved classification survives raid binding; source forget/block revokes it and duplicate raid cannot restart expired proof`, async () => {
    for (const policy of ['forget', 'block']) {
      const f = await setup(kind); await f.control(HOME, `send:${OTHER}`); await f.chat(HOME, '851', 'hello'); f.advance(); await f.chat(OTHER, '851', '!offer');
      f.advance(); await f.raid(HOME, OTHER, 4); let root = await f.runtime.state.getKeeperRegistry();
      assert.deepEqual(root.pendingHop.movedOffers, ['851']); const arrival = root.pendingHop.arrivalStartedAt, end = root.pendingHop.endsAt;
      if (policy === 'forget') await f.chat(HOME, '851', '!relic forgetme'); else await f.runtime.state.setChannelPolicy(HOME, { banned: false, blockedUserIds: ['851'] }, f.now());
      assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 0);
      f.advance(end - f.now() + 1); await f.chat(OTHER, OTHER, '!accept'); f.advance(); await f.raid(HOME, OTHER, 4);
      root = await f.runtime.state.getKeeperRegistry(); assert.equal(root.pendingHop.arrivalStartedAt, arrival); assert.equal(root.pendingHop.endsAt, end); assert.equal(root.pendingHop.cancelled, true); assert.equal(root.holderId, HOME);
    }
  });
  test(`${kind}: source proof cannot be restored by known GUID or old timestamps after forget/pause/new stream`, async () => {
    const f = await setup(kind); const event = { broadcaster_user_id: HOME, chatter_user_id: '861', message_id: 'presence-original', message: { text: 'hello', fragments: [] } };
    const oldTime = f.now(); await f.signed('channel.chat.message', event, HOME, { broadcaster_user_id: HOME, user_id: BOT });
    f.advance(); await f.chat(HOME, '861', '!relic forgetme'); f.advance(60001);
    await f.signed('channel.chat.message', event, HOME, { broadcaster_user_id: HOME, user_id: BOT }); //fresh envelope cannot re-prove sameGUID
    await f.signed('channel.chat.message', { ...event, message_id: 'unseen-old' }, HOME, { broadcaster_user_id: HOME, user_id: BOT }, { sentAt: oldTime });
    await f.control(HOME, `send:${OTHER}`); await f.chat(OTHER, '861', '!offer'); assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 0);
    f.advance(); await f.chat(HOME, '861', 'new genuine hello'); f.advance(); await f.chat(OTHER, '861', '!offer'); assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 1);
    await f.control(HOME, 'pause'); f.advance(); await f.control(HOME, 'resume'); f.advance();
    await f.signed('channel.chat.message', event, HOME, { broadcaster_user_id: HOME, user_id: BOT });
    assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.cancelled, true);
    await f.signed('stream.offline', { broadcaster_user_id: HOME }, HOME); f.advance(1000); await f.signed('stream.online', { broadcaster_user_id: HOME, id: '9500', type: 'live', started_at: new Date(f.now()).toISOString() }, HOME);
    await f.signed('channel.chat.message', event, HOME, { broadcaster_user_id: HOME, user_id: BOT });
    // Existing accepted intent remains blocked; no new state/raid is fabricated.
    assert.equal((await f.runtime.state.getKeeperRegistry()).send.status, 'accepted');
  });
  test(`${kind}: exact completion ACK queued at commit recovers on original notification retry, never retries failed dispatch`, async () => {
    for (const mode of ['success', '401', 'finalize']) {
      const f = await setup(kind); await f.control(HOME, `send:${OTHER}`); await f.chat(HOME, HOME, '!offer'); await f.chat(OTHER, OTHER, '!accept');
      const process = f.runtime.claimAcks.process; f.runtime.claimAcks.process = async () => {};
      const dispatch = f.runtime.dispatch; let original;
      f.runtime.dispatch = req => { if (req.path === '/eventsub') original = req; return dispatch(req); };
      await f.raid(HOME, OTHER, 2); f.runtime.dispatch = dispatch; f.runtime.claimAcks.process = process;
      const before = f.calls.filter(c => c.url.endsWith('/chat/messages')).length;
      if (mode === '401') f.chatFailure('401');
      const step = f.runtime.state.claimAckStep;
      if (mode === 'finalize') f.runtime.state.claimAckStep = (...args) => { if (args[1].type === 'finish') throw Error('synthetic-finalize'); return step(...args); };
      assert.equal((await f.runtime.dispatch(original)).status, 204); f.runtime.state.claimAckStep = step;
      assert.equal((await f.runtime.dispatch(original)).status, 204);
      assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, before + 1); assert.equal((await f.runtime.state.getPublicJourney()).rings, 1); assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, OTHER);
    }
  });
}
test('irreversible accepted finish preserves status but opens no preclaim after policy or stream changes', async () => {
  const { sendState } = await import('../src/send-state.js');
  const base = { holderId: HOME, send: { id: 'intent', sourceId: HOME, targetId: OTHER, status: 'dispatching', owner: 'worker', sourceStreamId: '1', targetStreamId: '2' } };
  for (const change of ['optout', 'pause', 'stream']) {
    const channels = { [HOME]: { online: true, optedIn: true, streamId: '1', blockedUserIds: [] }, [OTHER]: { online: true, optedIn: true, streamId: '2', blockedUserIds: [] } };
    const marks = Object.fromEntries([HOME, OTHER].map((id, i) => [id, { context: { optedIn: true, keeperId: id, streamId: String(i + 1), holdsRelic: id === HOME, blockedUserIds: [] }, blocked: [] }]));
    if (change === 'optout') channels[OTHER].optedIn = false; if (change === 'pause') channels[HOME].paused = true; if (change === 'stream') channels[HOME].streamId = 'new';
    const result = sendState(base, channels, marks, { channels: [HOME, OTHER] }, { type: 'finish', id: 'intent', owner: 'worker', status: 'accepted' }, 100);
    assert.equal(result.registry.send.status, 'accepted'); assert.equal(result.registry.pendingHop, undefined);
  }
});
