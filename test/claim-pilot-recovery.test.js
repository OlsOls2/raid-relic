import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { claimThreshold, sendState } from '../src/send-state.js';
import { ackDocument, ackKey, createClaimAcks } from '../src/claim-ack.js';
async function setup(kind, viewers = 2) {
  const f = await pilotFixture(kind); for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) { await f.control(id, 'bootstrap'); f.advance(); await f.control(id, 'keep'); f.advance(); }
  await f.control(HOME, `send:${OTHER}`); f.advance(); await f.raid(HOME, OTHER, viewers); return f;
}
function vote(f, host, actor, messageId, text) { return f.signed('channel.chat.message', { broadcaster_user_id: host, chatter_user_id: actor, message_id: messageId, message: { text, fragments: [] } }, host, { broadcaster_user_id: host, user_id: BOT }); }
async function expire(f, host, intentId, hopId, extra = {}) {
  const status = JSON.parse((await f.request(`/control/${host}/status`, 'GET', { cookie: f.cookies[host] })).body);
  return f.request(`/control/${host}/expire-handoff`, 'POST', { cookie: f.cookies[host], origin: 'https://pilot.example', 'content-type': 'application/json', ...extra }, Buffer.from(JSON.stringify({ csrf: status.csrf, intentId, hopId })));
}
test('versioned future threshold policy retains >=3 formula and changes0/1/2 only', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 100].map(claimThreshold), [1, 1, 1, 2, 2, 10]);
});
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: two original accounts complete T1 with correct-channel aggregate ACKs, replay never recounts/reposts`, async () => {
    const f = await setup(kind), posts = () => f.calls.filter(c => c.url.endsWith('/chat/messages'));
    assert.equal(posts().length, 0);
    await Promise.all([vote(f, HOME, HOME, 'offer-one', '!offer'), vote(f, HOME, HOME, 'offer-one', '!offer')]);
    assert.equal(posts().length, 1); assert.equal(JSON.parse(posts()[0].body).broadcaster_id, HOME);
    assert.match(JSON.parse(posts()[0].body).message, /Offers 1\/1/); assert.equal(posts()[0].headers.Authorization, `Bearer access-${BOT}`);
    await vote(f, OTHER, HOME, 'same-user', '!accept'); assert.equal(posts().length, 1);
    await vote(f, OTHER, OTHER, 'accept-one', '!accept'); assert.equal(posts().length, 2);
    assert.equal(JSON.parse(posts()[1].body).broadcaster_id, OTHER); assert.match(JSON.parse(posts()[1].body).message, /Claim complete/);
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, OTHER); assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    await vote(f, OTHER, OTHER, 'accept-one', '!accept'); assert.equal(posts().length, 2);
    f.advance(); await f.control(OTHER, `send:${HOME}`); f.advance(); await f.raid(OTHER, HOME, 2);
    await vote(f, OTHER, OTHER, 'return-offer', '!offer'); await vote(f, HOME, HOME, 'return-accept', '!accept');
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME); assert.equal((await f.runtime.state.getPublicJourney()).rings, 2);
    assert.ok(!JSON.stringify(await f.runtime.state.getPublicJourney()).includes('actorKey'));
  });
  test(`${kind}: source-only ended confirmed recovery checks Origin, IDs, deadline and permits same-direction new send only`, async () => {
    const f = await setup(kind, 3); await vote(f, HOME, HOME, 'one-offer', '!offer'); await vote(f, OTHER, OTHER, 'one-accept', '!accept');
    let root = await f.runtime.state.getKeeperRegistry(); const { id } = root.send, hopId = root.pendingHop.eventId;
    assert.equal(root.pendingHop.threshold, 2); assert.equal(root.holderId, HOME);
    assert.equal(JSON.parse((await expire(f, HOME, id, hopId)).body).status, 'blocked');
    assert.equal((await expire(f, HOME, id, hopId, { origin: 'https://wrong.example' })).status, 403);
    f.advance(180000);
    assert.equal(JSON.parse((await expire(f, OTHER, id, hopId)).body).status, 'blocked');
    assert.equal(JSON.parse((await expire(f, HOME, 'f'.repeat(64), hopId)).body).status, 'blocked');
    const calls = f.calls.length; assert.equal(JSON.parse((await expire(f, HOME, id, hopId)).body).status, 'expired-handoff');
    assert.equal(f.calls.length, calls); root = await f.runtime.state.getKeeperRegistry();
    assert.equal(root.holderId, HOME); assert.equal(root.send.status, 'expired-handoff'); assert.equal(root.pendingHop.offers, undefined);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
    assert.equal(JSON.parse((await expire(f, HOME, id, hopId)).body).status, 'expired-handoff');
    await vote(f, HOME, HOME, 'one-offer', '!offer'); assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
    f.advance(); assert.equal(JSON.parse((await f.control(HOME, `send:${OTHER}`)).body).status, 'accepted');
    assert.equal(JSON.parse((await expire(f, HOME, id, hopId)).body).status, 'blocked');
  });
  test(`${kind}: queued ACK forget/ban invalidates content but keeps minimal receipt and failure never retries`, async () => {
    const f = await setup(kind); const process = f.runtime.claimAcks.process;
    f.runtime.claimAcks.process = async () => {};
    await vote(f, HOME, '811', 'pending-ack', '!offer');
    await f.chat(HOME, '811', '!relic forgetme');
    f.runtime.claimAcks.process = process;
    await process(HOME, ackKey({ broadcasterId: HOME, chatterId: '811', messageId: 'pending-ack' }));
    assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 0);
    await vote(f, HOME, '811', 'pending-ack', '!offer'); assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 0);
    f.runtime.claimAcks.process = async () => {}; await vote(f, HOME, '812', 'failure', '!offer');
    let posts = 0; const service = createClaimAcks({ state: f.runtime.state, now: f.now, logger: () => { throw Error('synthetic'); }, bots: { [HOME]: { async sendChat(message, options) { assert.equal(options.retryUnauthorized, false); posts++; throw Error('synthetic401-or-timeout'); } } } });
    const key = ackKey({ broadcasterId: HOME, chatterId: '812', messageId: 'failure' });
    await Promise.all([service.process(HOME, key), service.process(HOME, key)]); assert.equal(posts, 1);
  });
}
test('ACK capacity fails closed and retired recovery never clears accepted/unknown/preflight or wrong stream proof', () => {
  const chat = { broadcasterId: HOME, chatterId: HOME, messageId: 'new', markAction: { type: 'offer' } };
  assert.throws(() => ackDocument({ rows: Array.from({ length: 128 }, (_, i) => ({ key: String(i), expiresAt: 1000, status: 'ignored' })) }, chat, null, {}, {}, 1), /capacity/);
  for (const status of ['accepted', 'unknown', 'queued', 'preflight', 'dispatching']) {
    const registry = { holderId: HOME, send: { status, id: 'x', sourceId: HOME }, pendingHop: { eventId: 'y' } };
    const result = sendState(registry, {}, {}, { channels: [HOME] }, { type: 'expire-handoff', source: HOME, actor: HOME, id: 'x', hopId: 'y' }, 1);
    assert.equal(result.result.status, 'blocked'); assert.deepEqual(result.registry, registry);
  }
});

for (const kind of ['memory', 'firestore']) test(`${kind}: strict deadline, copied/bot votes, queued bans and finalize failure preserve count/one POST`, async () => {
  const f = await setup(kind, 3);
  await f.signed('channel.chat.message', { broadcaster_user_id: HOME, chatter_user_id: HOME, message_id: 'copy', source_broadcaster_user_id: OTHER,
    source_message_id: '00000000-0000-4000-8000-000000000001', message: { text: '!offer', fragments: [] } }, HOME, { broadcaster_user_id: HOME, user_id: BOT });
  await vote(f, HOME, BOT, 'bot-vote', '!offer');
  assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 0);
  const process = f.runtime.claimAcks.process; f.runtime.claimAcks.process = async () => {};
  await vote(f, HOME, '811', 'blocked-vote', '!offer');
  await f.runtime.state.setChannelPolicy(HOME, { banned: false, blockedUserIds: ['811'] }, f.now());
  await f.runtime.state.setChannelPolicy(HOME, { banned: false, blockedUserIds: [] }, f.now());
  await process(HOME, ackKey({ broadcasterId: HOME, chatterId: '811', messageId: 'blocked-vote' }));
  assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 0);
  await vote(f, HOME, '812', 'finish-failure', '!offer');
  const key = ackKey({ broadcasterId: HOME, chatterId: '812', messageId: 'finish-failure' });
  const step = f.runtime.state.claimAckStep; let posts = 0;
  f.runtime.state.claimAckStep = (host, op, now) => { if (op.type === 'finish') throw Error('synthetic-finalize'); return step(host, op, now); };
  const service = createClaimAcks({ state: f.runtime.state, now: f.now, logger: () => {}, bots: { [HOME]: { async sendChat() { posts++; } } } });
  await service.process(HOME, key); f.runtime.state.claimAckStep = step; await service.process(HOME, key); assert.equal(posts, 1);
  const hop = (await f.runtime.state.getKeeperRegistry()).pendingHop;
  f.advance(hop.endsAt - f.now()); await vote(f, OTHER, OTHER, 'late-at-deadline', '!accept');
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 0); assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.cancelled, true);
});

test('Firestore failed vote commit rolls back count and ACK together with no external POST', async () => {
  const f = await setup('firestore'); f.db.failCommit = true;
  await assert.rejects(vote(f, HOME, HOME, 'rollback-vote', '!offer')); f.db.failCommit = false;
  assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 0);
  assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 0);
  await vote(f, HOME, HOME, 'rollback-vote', '!offer');
  assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 1);
  assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 1);
});
test('claim ACK bot option never retries actual mocked401 chat POST', async () => {
  const { createBot } = await import('../src/bot.js'); let posts = 0;
  const bot = createBot({ oauth: { accessToken: async role => { assert.equal(role, 'bot'); return 'synthetic-bot-token'; } }, clientId: 'client', clientSecret: 'synthetic-secret', streamerId: HOME, botId: BOT,
    callbackUrl: 'https://mock.example/eventsub', webhookSecret: 'synthetic-webhook-secret', transport: async () => { posts++; return { status: 401, data: {} }; } });
  await assert.rejects(bot.sendChat('Offers 1/1.', { retryUnauthorized: false })); assert.equal(posts, 1);
});

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: runtime Bot wiring marks successful ACKs sent and safe typed failures unknown without retry`, async () => {
    for (const mode of [null, '401', 'drop', 'transport', 'grant']) {
      const f = await setup(kind); const logs = []; const warn = console.warn;
      if (mode === 'grant') f.revoke(BOT); else f.chatFailure(mode);
      try { console.warn = line => logs.push(JSON.parse(line)); await vote(f, HOME, HOME, `runtime-${mode}`, '!offer'); } finally { console.warn = warn; }
      const doc = await f.runtime.state.getPrivateClaimAcks(HOME), row = doc.rows[0];
      assert.equal(row.status, mode === null ? 'sent' : 'unknown');
      assert.equal(logs.filter(l => l.event === 'raid_relic_claim_ack').length, 1);
      const diagnostic = logs[0].diagnostic;
      assert.equal(diagnostic.stage, mode === 'grant' ? 'bot-grant' : mode === 'transport' ? 'transport' : 'response');
      assert.equal(diagnostic.httpStatus, mode === 'grant' || mode === 'transport' ? null : mode === '401' ? 401 : 200);
      assert.equal(diagnostic.dropKind, mode === 'drop' ? 'other' : null);
      assert.ok(!JSON.stringify(logs).includes('synthetic-sensitive')); assert.ok(!JSON.stringify(logs).includes('untrusted-sensitive'));
      await vote(f, HOME, HOME, `runtime-${mode}`, '!offer');
      assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, mode === 'grant' ? 0 : 1);
    }
  });
  test(`${kind}: authoritative closed stream permits expired matching confirmed recovery after restart without resurrecting stream`, async () => {
    const f = await setup(kind, 3); const before = await f.runtime.state.getKeeperRegistry();
    f.advance(); await f.signed('stream.offline', { broadcaster_user_id: HOME }, HOME);
    f.advance(1000);
    await f.signed('stream.online', { broadcaster_user_id: HOME, id: '9300', type: 'live', started_at: new Date(f.now()).toISOString() }, HOME);
    f.advance(180000);
    const result = await expire(f, HOME, before.send.id, before.pendingHop.eventId); assert.equal(JSON.parse(result.body).status, 'expired-handoff');
    const channel = await f.runtime.state.getStreamStatus(HOME); assert.equal(channel.streamId, '9300'); assert.equal(channel.online, true); assert.ok(channel.closedIds.includes(before.pendingHop.sourceStreamId));
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME); assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
  });
  test(`${kind}: already committed votes have30s delivery grace, equality-deadline votes never count and get a closed-window reply`, async () => {
    const f = await setup(kind), process = f.runtime.claimAcks.process; f.runtime.claimAcks.process = async () => {};
    const hop = (await f.runtime.state.getKeeperRegistry()).pendingHop;
    f.advance(hop.endsAt - f.now() - 1); await vote(f, HOME, HOME, 'grace-vote', '!offer');
    f.advance(2); await process(HOME, ackKey({ broadcasterId: HOME, chatterId: HOME, messageId: 'grace-vote' }));
    assert.equal((await f.runtime.state.getPrivateClaimAcks(HOME)).rows[0].status, 'sent');
    await vote(f, OTHER, OTHER, 'late-vote', '!accept');
    assert.equal((await f.runtime.state.getPrivateClaimAcks(OTHER)).rows[0].status, 'queued');
    assert.match((await f.runtime.state.getPrivateClaimAcks(OTHER)).rows[0].message, /binding window has closed/);
    await process(OTHER, ackKey({ broadcasterId: OTHER, chatterId: OTHER, messageId: 'late-vote' }));
    assert.equal((await f.runtime.state.getPrivateClaimAcks(OTHER)).rows[0].status, 'sent');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
  });
}
test('asynchronously rejected ACK logger cannot fail the committed vote or cause resend', async () => {
  const f = await setup('memory'); f.runtime.claimAcks.process = async () => {}; await vote(f, HOME, HOME, 'async-log', '!offer');
  let posts = 0; const service = createClaimAcks({ state: f.runtime.state, now: f.now, logger: async () => { throw Error('sensitive-log-error'); }, bots: { [HOME]: { async sendChat() { posts++; } } } });
  const key = ackKey({ broadcasterId: HOME, chatterId: HOME, messageId: 'async-log' }); await service.process(HOME, key); await service.process(HOME, key); assert.equal(posts, 1);
});

for (const kind of ['memory', 'firestore']) test(`${kind}: both real runtime control HTML/status reload after expiry and completed T1`, async () => {
  const f = await setup(kind, 3); const old = await f.runtime.state.getKeeperRegistry(); f.advance(180000);
  assert.equal(JSON.parse((await expire(f, HOME, old.send.id, old.pendingHop.eventId)).body).status, 'expired-handoff');
  f.advance(); assert.equal(JSON.parse((await f.control(HOME, `send:${OTHER}`)).body).status, 'accepted'); f.advance(); await f.raid(HOME, OTHER, 2);
  await f.chat(HOME, HOME, '!offer'); await f.chat(OTHER, OTHER, '!accept');
  for (const host of [HOME, OTHER]) {
    const html = await f.request(`/control/${host}`, 'GET', { cookie: f.cookies[host] }); assert.equal(html.status, 200); assert.match(html.body.toString(), /id="account"/);
    const response = await f.request(`/control/${host}/status`, 'GET', { cookie: f.cookies[host] }); assert.equal(response.status, 200);
    const status = JSON.parse(response.body); assert.equal(status.pilot.holder, OTHER); assert.equal(status.pilot.intent, null); assert.equal(status.pilot.claimProgress.finalized, true);
  }
});
