import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createMemoryState } from '../src/state.js';
import { createFirestoreStore } from '../src/store.js';
import { createApp } from '../src/app.js';
import { eligible } from '../src/send-state.js';
import { createSendOff } from '../src/send-off.js';
import { createMarkService } from '../src/marks.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';

const source = '1591805230'; const target = '1591806023'; const bot = '1591804828';
const secret = 'synthetic-send-test-secret'; const base = Date.parse('2026-10-25T12:00:00Z');
function fixture(kind, mode = 'ok') {
  const db = kind === 'firestore' ? fakeFirestore() : null;
  const config = { lifecycle: { channels: [source, target], logins: { raidrelichq: source, targetkeeper: target } } };
  const makeStore = () => db ? createFirestoreStore(db, config) : state;
  const state = db ? makeStore() : createMemoryState(config);
  let time = base; let seq = 0; const calls = []; const roles = [];
  const apps = Object.fromEntries([source, target].map(host => [host, createApp({ secret, state: makeStore(), now: () => time, chatContext: { streamerId: host, botId: bot } })]));
  function request(host, type, event, options = {}) {
    const id = options.id ?? `event-${++seq}`; const timestamp = new Date(options.sentAt ?? time).toISOString();
    const condition = options.condition ?? (type === 'channel.chat.message' ? { broadcaster_user_id: host, user_id: bot } : { broadcaster_user_id: host });
    const rawBody = Buffer.from(JSON.stringify({ subscription: { type, version: options.version ?? '1', condition }, event }));
    const digest = createHmac('sha256', secret).update(id).update(timestamp).update(rawBody).digest('hex');
    return { method: 'POST', path: '/eventsub', rawBody, headers: { 'twitch-eventsub-message-id': id, 'twitch-eventsub-message-timestamp': timestamp,
      'twitch-eventsub-message-signature': `sha256=${digest}`, 'twitch-eventsub-message-type': 'notification' } };
  }
  const chatRequest = (text, host = source, user = host, options = {}) => request(host, 'channel.chat.message', { broadcaster_user_id: host, chatter_user_id: user,
    message_id: options.id ?? `message-${seq + 1}`, badges: options.badges ?? [], message: { text, fragments: [] } }, options);
  const chat = (text, host = source, user = host, options) => apps[host].dispatch(chatRequest(text, host, user, options));
  const raid = (to = target, options = {}) => apps[source].dispatch(request(source, 'channel.raid', { from_broadcaster_user_id: source,
    to_broadcaster_user_id: to, viewers: 12 }, { condition: { from_broadcaster_user_id: source }, ...options }));
  const transport = async (url, input) => {
    calls.push({ url, ...input });
    if (url.includes('/users?')) {
      if (mode === 'preflight401' && calls.filter(call => call.url.includes('/users?')).length === 1) return { status: 401, data: {} };
      return { status: 200, data: { data: [{ id: mode === 'wrong-account' ? '777' : target, login: 'targetkeeper' }] } };
    }
    if (url.includes('/streams?')) {
      if (typeof mode === 'function') await mode({ state, time });
      return { status: 200, data: { data: mode === 'offline' ? [] : [{ user_id: source, id: '9001', type: 'live' }, { user_id: target, id: '9002', type: 'live' }] } };
    }
    if (input.method === 'POST') {
      if (mode === 'timeout') throw new Error('PRIVATE_TOKEN timeout after dispatch');
      return { status: mode === 'post401' ? 401 : mode === 'post500' ? 500 : 200, data: { data: [{ created_at: new Date(time).toISOString() }] } };
    }
    throw new Error('Unexpected transport');
  };
  const worker = () => createSendOff({ state: makeStore(), streamerId: source, clientId: 'test-client', now: () => time,
    oauth: { accessToken: async (role, options) => { roles.push({ role, ...options }); return 'synthetic-streamer-token'; } }, transport });
  return { state, db, apps, chat, chatRequest, raid, worker, calls, roles, now: () => time, advance: ms => { time += ms; },
    async offline(host = source) {
      return apps[host].dispatch(request(host, 'stream.offline', { broadcaster_user_id: host }));
    },
    async online(host, stream) {
      return apps[host].dispatch(request(host, 'stream.online', { broadcaster_user_id: host, id: stream, type: 'live', started_at: new Date(time).toISOString() }));
    },
    async setup() {
      for (const [host, stream] of [[source, '9001'], [target, '9002']]) {
        await apps[host].dispatch(request(host, 'stream.online', { broadcaster_user_id: host, id: stream, type: 'live', started_at: new Date(time).toISOString() }));
        await chat('!relic keep', host);
      }
    },
  };
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: signed owner command reserves once without HTTP; moderator/viewer and non-Keeper targets cannot send`, async () => {
    const f = fixture(kind); await f.setup();
    await f.chat('!relic send @targetkeeper', source, '333', { badges: [{ set_id: 'moderator', id: '1' }] });
    assert.equal((await f.state.getKeeperRegistry()).send, undefined);
    await f.chat('!relic send @outsider'); assert.equal((await f.state.getKeeperRegistry()).send, undefined);
    const req = f.chatRequest('!relic send @targetkeeper');
    await Promise.all(Array.from({ length: 20 }, (_, i) => i % 2 ? f.apps[source].dispatch(req) : f.chat('!relic send @targetkeeper')));
    const intent = (await f.state.getKeeperRegistry()).send; assert.equal(intent.status, 'queued'); assert.equal(f.calls.length, 0);
    await Promise.all([f.worker().processPending(), f.worker().processPending()]);
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
    assert.equal((await f.state.getKeeperRegistry()).holderId, source);
    assert.notEqual((await f.state.getKeeperRegistry()).pendingHop?.verified, true);
    assert.equal(await f.state.getRitual(target), undefined);
    assert.ok(f.roles.every(item => item.role === 'streamer'));
  });
  test(`${kind}: opted-out target cannot reserve and preflight exact account/live failures are terminal before POST`, async () => {
    for (const mode of ['wrong-account', 'offline']) {
      const f = fixture(kind, mode); await f.setup(); await f.chat('!relic send @targetkeeper');
      assert.equal((await f.worker().processPending()).status, 'rejected-preflight');
      assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
      assert.equal((await f.state.getKeeperRegistry()).send.status, 'rejected');
    }
    const f = fixture(kind); await f.setup(); await f.chat('!relic opt-out', target); await f.chat('!relic send @targetkeeper');
    assert.equal((await f.state.getKeeperRegistry()).send, undefined);
  });
  test(`${kind}: opt-out/pause/block between reservation and API dispatch prevents POST`, async () => {
    for (const action of ['opt-out', 'pause', 'block', 'offline']) {
      const f = fixture(kind, async ({ state, time }) => {
        if (action === 'offline') await state.accept({ id: 'offline-during-preflight', expiresAt: time + 600000, now: time, sentAt: time,
          lifecycle: { host: target, type: 'offline', sentAt: time } });
        else if (action === 'block') await state.setChannelPolicy(target, { banned: true, blockedUserIds: [] }, time);
        else await state.controlMarks(target, { broadcasterId: target, chatterId: target },
          action === 'pause' ? { type: 'pause', paused: true } : { type: 'opt-out' }, time);
      });
      await f.setup(); await f.chat('!relic send @targetkeeper');
      assert.equal((await f.worker().processPending()).status, 'rejected-or-lease-lost');
      assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
    }
  });
  test(`${kind}: GET preflight 401 refreshes once but POST 401 never retries or refreshes`, async () => {
    const f = fixture(kind, 'preflight401'); await f.setup(); await f.chat('!relic send @targetkeeper');
    assert.equal((await f.worker().processPending()).status, 'accepted');
    assert.equal(f.roles.filter(item => item.refresh).length, 1); assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
    const failed = fixture(kind, 'post401'); await failed.setup(); await failed.chat('!relic send @targetkeeper');
    assert.equal((await failed.worker().processPending()).status, 'rejected'); await failed.worker().processPending();
    assert.equal(failed.calls.filter(call => call.method === 'POST').length, 1); assert.equal(failed.roles.filter(item => item.refresh).length, 0);
  });
  test(`${kind}: post-dispatch timeout/5xx remain unknown across workers and repeated commands, never retry StartRaid`, async () => {
    for (const mode of ['timeout', 'post500']) {
      const f = fixture(kind, mode); await f.setup(); await f.chat('!relic send @targetkeeper');
      assert.equal((await f.worker().processPending()).status, 'unknown'); f.advance(40000);
      await f.chat('!relic send @targetkeeper'); await f.worker().processPending();
      assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
      assert.equal((await f.state.getKeeperRegistry()).send.status, 'unknown');
      assert.ok(!JSON.stringify(await f.state.getKeeperRegistry()).includes('PRIVATE_TOKEN'));
    }
  });
  test(`${kind}: expired preflight lease can be reclaimed; dispatch crash becomes unknown without HTTP on restart`, async () => {
    const f = fixture(kind); await f.setup(); await f.chat('!relic send @targetkeeper');
    const first = await f.state.sendOffStep({ type: 'claim', source, owner: 'old' }, f.now());
    f.advance(30001); const next = await f.state.sendOffStep({ type: 'claim', source, owner: 'new' }, f.now());
    assert.equal(await f.state.sendOffStep({ type: 'dispatch', id: first.id, owner: 'old' }, f.now()), null);
    assert.ok(await f.state.sendOffStep({ type: 'dispatch', id: next.id, owner: 'new' }, f.now()));
    f.advance(30001); await f.worker().processPending();
    assert.equal((await f.state.getKeeperRegistry()).send.status, 'unknown'); assert.equal(f.calls.length, 0);
  });
  test(`${kind}: only matching signed actual raid confirms accepted/unknown intent and binds existing180s voting clock with verified arrival`, async () => {
    for (const mode of ['ok', 'timeout']) {
    const f = fixture(kind, mode); await f.setup(); await f.chat('!relic send @targetkeeper'); await f.worker().processPending();
    assert.equal(await f.state.getRitual(target), undefined);
    await f.raid('777'); assert.notEqual((await f.state.getKeeperRegistry()).pendingHop?.verified, true);
    assert.equal((await f.raid(target, { condition: { from_broadcaster_user_id: '777' } })).status, 400);
    assert.equal((await f.raid(target, { version: '2' })).status, 400);
    f.advance(5000); const receivedAt = f.now(); await f.raid(target, { sentAt: receivedAt - 1000, id: 'actual-raid' });
    const registry = await f.state.getKeeperRegistry(); assert.equal(registry.send.status, 'confirmed');
    assert.equal(registry.pendingHop.startedAt, receivedAt); assert.equal(registry.pendingHop.endsAt, (mode === 'timeout' ? receivedAt : base) + 180000);
    assert.equal(registry.holderId, source); assert.equal(registry.pendingHop.phase, 'pending-handoff');
    await f.raid(target, { sentAt: receivedAt - 1000, id: 'actual-raid' }); assert.equal((await f.state.getKeeperRegistry()).pendingHop.startedAt, receivedAt);
    assert.ok(!JSON.stringify(await f.state.getPublicMarks(source)).includes('pendingHop'));
    }
  });
  test(`${kind}: manual eligible raid opens snatched/pending handoff without transfer; stale events cannot overwrite newer hop`, async () => {
    const f = fixture(kind); await f.setup(); f.advance(1000); await f.raid();
    const first = (await f.state.getKeeperRegistry()).pendingHop; assert.equal(first.origin, 'manual'); assert.equal(first.snatchedUntil, f.now() + 1500);
    f.advance(180001); await f.raid(); const second = (await f.state.getKeeperRegistry()).pendingHop;
    assert.ok(second.startedAt > first.startedAt); await f.raid(target, { sentAt: base + 500 });
    assert.deepEqual((await f.state.getKeeperRegistry()).pendingHop, second); assert.equal((await f.state.getKeeperRegistry()).holderId, source);
  });
  test(`${kind}: retired source stream proves older planned/unknown raid without reopening source`, async () => {
    for (const mode of ['ok', 'timeout']) {
      const f = fixture(kind, mode); await f.setup(); await f.chat('!relic send @targetkeeper'); await f.worker().processPending();
      f.advance(1000); const raidAt = f.now(); f.advance(1000); await f.offline();
      const closed = await f.state.getStreamStatus(source);
      assert.deepEqual(closed.retiredStream, { streamId: '9001', startedAt: base, offlineAt: f.now() });
      f.advance(1000); await f.offline(); // Must not extend the original closure boundary.
      assert.equal((await f.state.getStreamStatus(source)).retiredStream.offlineAt, base + 2000);
      await f.raid(target, { sentAt: raidAt });
      assert.equal((await f.state.getKeeperRegistry()).send.status, 'confirmed');
      assert.equal((await f.state.getStreamStatus(source)).online, false);
      assert.equal((await f.state.getKeeperRegistry()).holderId, source);
      assert.equal((await f.state.getKeeperRegistry()).pendingHop.startedAt, f.now());
    }
  });
  test(`${kind}: retired confirmation fails closed for late raid, target offline, new stream or current controls`, async () => {
    for (const scenario of ['late', 'target-offline', 'new-stream', 'opt-out', 'pause', 'block', 'ban', 'manual']) {
      const f = fixture(kind); await f.setup();
      if (scenario !== 'manual') { await f.chat('!relic send @targetkeeper'); await f.worker().processPending(); }
      f.advance(1000); const raidAt = f.now(); f.advance(1000); await f.offline(); f.advance(1000);
      if (scenario === 'target-offline') await f.offline(target);
      if (scenario === 'new-stream') await f.online(source, '9003');
      const service = createMarkService(f.state, { now: f.now });
      const actor = { broadcasterId: source, chatterId: source };
      if (scenario === 'opt-out') await service.optOut(source, actor);
      if (scenario === 'pause') await service.pause(source, actor);
      if (scenario === 'block') await f.state.controlMarks(source, actor, { type: 'block', userId: target }, f.now());
      if (scenario === 'ban') await f.state.setChannelPolicy(source, { banned: true, blockedUserIds: [] }, f.now());
      await f.raid(target, { sentAt: scenario === 'late' ? f.now() : raidAt });
      const hop = (await f.state.getKeeperRegistry()).pendingHop; assert.ok(!hop?.verified, scenario);
      assert.equal(await f.state.getRitual(target), undefined, scenario);
    }
  });
  test(`${kind}: trusted mark service controls synchronize lifecycle and prevent dispatch`, async () => {
    for (const action of ['pause', 'optOut']) {
      const f = fixture(kind); await f.setup(); await f.chat('!relic send @targetkeeper');
      await createMarkService(f.state, { now: f.now })[action](source, { broadcasterId: source, chatterId: source });
      const channel = await f.state.getStreamStatus(source);
      assert.equal(action === 'pause' ? channel.paused : !channel.optedIn, true);
      await f.worker().processPending(); assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
    }
  });
  test(`${kind}: unrelated or opted-out raid cannot use legacy naked ritual path`, async () => {
    const f = fixture(kind); await f.setup(); await f.raid('777'); assert.equal(await f.state.getRitual('777'), undefined);
    await f.chat('!relic opt-out', target); await f.raid(); assert.equal(await f.state.getRitual(target), undefined);
    assert.notEqual((await f.state.getKeeperRegistry()).pendingHop?.verified, true);
  });
}
test('Firestore reserve failure commits neither dedupe nor outbox; transaction retry performs no external effect', async () => {
  const f = fixture('firestore'); await f.setup(); const req = f.chatRequest('!relic send @targetkeeper');
  const before = structuredClone([...f.db.docs]); f.db.failCommit = true;
  await assert.rejects(f.apps[source].dispatch(req)); assert.deepEqual([...f.db.docs], before);
  f.db.failCommit = false; f.db.retry = true; await f.apps[source].dispatch(req);
  assert.equal((await f.state.getKeeperRegistry()).send.status, 'queued'); assert.equal(f.calls.length, 0);
});

test('final eligibility independently checks mark policy/context as well as lifecycle policy', () => {
  const channel = { online: true, streamId: '9001', optedIn: true, paused: false, banned: false, blockedUserIds: [] };
  const channels = { [source]: structuredClone(channel), [target]: structuredClone(channel) };
  const doc = id => ({ paused: false, blocked: [], context: { keeperId: id, streamId: '9001', optedIn: true, holdsRelic: id === source, blockedUserIds: [] } });
  const marks = { [source]: doc(source), [target]: doc(target) }; const registry = { holderId: source };
  assert.equal(eligible(registry, channels, marks, source, target), true);
  for (const host of [source, target]) for (const mutate of [
    d => { d.paused = true; }, d => { d.context.optedIn = false; },
    d => { d.context.streamId = 'other'; }, d => { d.context.keeperId = '777'; },
    d => { d.context.blockedUserIds = [source, target]; }, d => { d.blocked = [source, target]; },
  ]) {
    const changed = structuredClone(marks); mutate(changed[host]);
    assert.equal(eligible(registry, channels, changed, source, target), false);
  }
  const changed = structuredClone(marks); changed[source].context.holdsRelic = false;
  assert.equal(eligible(registry, channels, changed, source, target), false);
  channels[source].online = false;
  assert.equal(eligible(registry, channels, marks, source, target), false);
});
