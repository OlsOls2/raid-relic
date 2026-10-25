import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createMemoryState } from '../src/state.js';
import { createFirestoreStore } from '../src/store.js';
import { createApp } from '../src/app.js';
import { createRuntime } from '../src/runtime.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';
import { INITIAL_HOME, LIFECYCLE_LIMITS } from '../src/lifecycle.js';

const home = INITIAL_HOME; const other = '1591806023'; const bot = '1591804828'; const secret = 'synthetic-lifecycle-test-secret';
const base = Date.parse('2026-10-25T12:00:00Z');
function fixture(kind) {
  const db = kind === 'firestore' ? fakeFirestore() : null;
  const options = { lifecycle: { channels: [home, other] } };
  const state = db ? createFirestoreStore(db, options) : createMemoryState(options);
  let time = base; let sequence = 0;
  const apps = new Map([home, other].map(host => [host, createApp({ secret, state: db ? createFirestoreStore(db, options) : state, now: () => time, chatContext: { streamerId: host, botId: bot } })]));
  function request(type, event, { host = home, sentAt = time, id = `event-${++sequence}`, condition } = {}) {
    const timestamp = new Date(sentAt).toISOString();
    const payload = { subscription: { type, version: '1', condition: condition ?? (type === 'channel.chat.message'
      ? { broadcaster_user_id: host, user_id: bot } : { broadcaster_user_id: host }) }, event: { broadcaster_user_id: host, ...event } };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const digest = createHmac('sha256', secret).update(id).update(timestamp).update(rawBody).digest('hex');
    return { method: 'POST', path: '/eventsub', rawBody, headers: { 'twitch-eventsub-message-id': id, 'twitch-eventsub-message-timestamp': timestamp,
      'twitch-eventsub-message-type': 'notification', 'twitch-eventsub-message-signature': `sha256=${digest}` } };
  }
  const dispatch = (type, event, options = {}) => apps.get(options.host ?? home).dispatch(request(type, event, options));
  const chat = (text, options = {}) => dispatch('channel.chat.message', { chatter_user_id: options.user ?? options.host ?? home,
    message_id: `message-${sequence + 1}`, badges: options.badges ?? [], message: { text, fragments: [] } }, options);
  return { state, db, apps, request, dispatch, chat, advance: ms => { time += ms; }, time: () => time,
    online: (streamId = '9001', options = {}) => dispatch('stream.online', { id: streamId, type: 'live', started_at: new Date(options.startedAt ?? time).toISOString() }, options),
    offline: options => dispatch('stream.offline', {}, options),
    view: (host = home) => state.getPrivateMarks(host, { broadcasterId: host, chatterId: host }),
  };
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: default unplaced, explicit broadcaster opt-in plus actual stream ID enables signed marks`, async () => {
    const f = fixture(kind); assert.deepEqual(await f.state.getKeeperRegistry(), { holderId: null, originated: false });
    await f.chat('!mark orchid'); await f.chat('!relic keep');
    assert.equal((await f.state.getKeeperRegistry()).holderId, null);
    await f.online('123456789'); await f.chat('!mark orchid');
    assert.equal((await f.state.getKeeperRegistry()).holderId, home);
    const doc = await f.view(); assert.equal(doc.context.streamId, '123456789'); assert.equal(doc.sessions[0].marks.length, 1);
    assert.equal((await f.apps.get(home).dispatch({ method: 'GET', path: '/health' })).status, 200);
    await assert.rejects(Promise.resolve().then(() => f.state.setKeeperContext(home, doc.context)), /injection disabled/);
  });
  test(`${kind}: moderator/viewer cannot opt in or out; other channel cannot originate or take existing holder`, async () => {
    const f = fixture(kind); await f.online();
    await f.chat('!relic keep', { user: '123', badges: [{ set_id: 'moderator', id: '1' }] });
    assert.equal((await f.state.getKeeperRegistry()).holderId, null);
    await f.chat(`!relic keep ${home}`, { user: '123' }); assert.equal((await f.state.getKeeperRegistry()).holderId, null);
    await f.online('9901', { host: other }); await f.chat('!relic opt-in', { host: other });
    assert.equal((await f.state.getKeeperRegistry()).holderId, null);
    await f.chat('!relic keep');
    await f.chat('!relic opt-out', { user: '123', badges: [{ set_id: 'moderator', id: '1' }] });
    assert.equal((await f.state.getStreamStatus(home)).optedIn, true);
    await f.chat('!relic keep', { host: other }); assert.equal((await f.state.getKeeperRegistry()).holderId, home);
    await f.chat('!relic opt-out'); await f.chat('!relic keep', { host: other });
    assert.equal((await f.state.getKeeperRegistry()).holderId, home);
    assert.deepEqual(await f.state.getPublicMarks(home), { marks: [] });
  });
  test(`${kind}: paused/banned home cannot originate, and explicit policy bounds are enforced`, async () => {
    const f = fixture(kind); await f.online(); await f.chat('!relic pause'); await f.chat('!relic keep');
    assert.equal((await f.state.getKeeperRegistry()).holderId, null);
    await f.chat('!relic resume');
    await f.state.setChannelPolicy(home, { banned: true, blockedUserIds: [] }, f.time());
    await f.chat('!relic keep'); assert.equal((await f.state.getKeeperRegistry()).holderId, null);
    await f.state.setChannelPolicy(home, { banned: false, blockedUserIds: [home] }, f.time());
    await f.chat('!relic keep'); assert.equal((await f.state.getKeeperRegistry()).holderId, null);
    await assert.rejects(Promise.resolve().then(() => f.state.setChannelPolicy(home, { banned: false, blockedUserIds: Array(129).fill('1') })), /policy/);
    await f.state.setChannelPolicy(home, { banned: false, blockedUserIds: [] }, f.time());
    f.advance(1); await f.chat('!relic keep'); assert.equal((await f.state.getKeeperRegistry()).holderId, home);
  });
  test(`${kind}: duplicate online/chat cannot reset quota; offline closes without reopening and cooldown crosses streams`, async () => {
    const f = fixture(kind); await f.online('9001'); await f.chat('!relic keep');
    for (let i = 0; i < 5; i++) { await f.chat('!mark orchid', { user: '333' }); f.advance(30000); }
    await f.online('9001', { startedAt: base }); await f.chat('!relic keep'); await f.chat('!mark lantern', { user: '333' });
    assert.equal((await f.view()).sessions[0].spent, 5);
    await f.chat('!mark lantern', { user: '444' }); f.advance(1); await f.offline();
    assert.equal((await f.state.getStreamStatus(home)).online, false);
    await f.online('9001', { startedAt: base }); await f.chat('!mark lantern', { user: '333' });
    assert.equal((await f.state.getStreamStatus(home)).online, false);
    f.advance(1); await f.online('9002'); await f.chat('!mark lantern', { user: '444' });
    assert.equal((await f.view()).sessions[1].spent, 0);
    f.advance(30000); await f.chat('!mark lantern', { user: '444' }); assert.equal((await f.view()).sessions[1].spent, 1);
  });
  test(`${kind}: reordered offline/online and consent notifications fail closed`, async () => {
    const f = fixture(kind); await f.online('9001'); await f.chat('!relic keep');
    f.advance(10000); await f.online('9002');
    await f.offline({ sentAt: base + 5000 }); assert.equal((await f.state.getStreamStatus(home)).streamId, '9002');
    await f.online('9003', { startedAt: base + 2000 }); assert.equal((await f.state.getStreamStatus(home)).streamId, '9002');
    f.advance(1); await f.chat('!relic opt-out');
    await f.chat('!relic keep', { sentAt: base + 1 }); assert.equal((await f.state.getStreamStatus(home)).optedIn, false);
    await f.offline(); await f.online('9002', { startedAt: base + 10000 });
    assert.equal((await f.state.getStreamStatus(home)).online, false);
    await f.chat('!mark orchid', { user: '333' }); assert.equal((await f.view()).sessions[1].spent, 0);
  });
  test(`${kind}: lifecycle condition, schema, future timestamps and invented stream command IDs are rejected`, async () => {
    const f = fixture(kind);
    assert.equal((await f.online('wall-clock-session')).status, 400);
    assert.equal((await f.online('9001', { startedAt: base + 1 })).status, 400);
    assert.equal((await f.online('9001', { condition: { broadcaster_user_id: other } })).status, 400);
    assert.equal((await f.dispatch('stream.offline', { broadcaster_user_id: other })).status, 400);
    await f.chat('!relic keep 9001'); assert.equal((await f.state.getKeeperRegistry()).holderId, null);
    const req = f.request('stream.online', { id: '9001', type: 'live', started_at: new Date(base).toISOString() });
    req.headers['twitch-eventsub-message-signature'] = 'sha256=' + '0'.repeat(64);
    assert.equal((await f.apps.get(home).dispatch(req)).status, 403);
  });
  test(`${kind}: concurrent placement attempts are globally single-holder and event-deduplicated`, async () => {
    const f = fixture(kind); await f.online(); await f.online('9901', { host: other });
    const req = f.request('channel.chat.message', { chatter_user_id: home, message_id: 'keep', message: { text: '!relic keep', fragments: [] } });
    await Promise.all(Array.from({ length: 20 }, (_, i) => i % 2 ? f.apps.get(home).dispatch(req) : f.chat('!relic keep', { host: other })));
    assert.deepEqual(await f.state.getKeeperRegistry(), { holderId: home, originated: true });
    assert.equal((await f.view()).context.holdsRelic, true); assert.equal((await f.view(other)).context.holdsRelic, false);
    await f.dispatch('channel.raid', { from_broadcaster_user_id: home, to_broadcaster_user_id: other, viewers: 9 },
      { host: other, condition: { to_broadcaster_user_id: other } });
    assert.equal((await f.state.getKeeperRegistry()).holderId, home);
    assert.ok(Buffer.byteLength(JSON.stringify(await f.state.getKeeperRegistry())) < LIFECYCLE_LIMITS.registryBytes);
  });
  test(`${kind}: lifecycle opt-out/re-opt-in and self-forget never refund viewer quota or restore erased content`, async () => {
    const f = fixture(kind); await f.online(); await f.chat('!relic keep'); await f.chat('!mark orchid', { user: '333' });
    await f.state.controlMarks(home, { broadcasterId: home, chatterId: home }, { type: 'approve', markId: 'm1' }, f.time());
    assert.equal((await f.state.getPublicMarks(home)).marks.length, 1);
    await f.chat('!relic forgetme', { user: '333' }); await f.chat('!mark lantern', { user: '333' });
    assert.equal((await f.view()).sessions[0].spent, 1); assert.equal((await f.state.getPublicMarks(home)).marks.length, 0);
    await f.chat('!mark amber', { user: '444' }); assert.equal((await f.view()).sessions[0].spent, 2);
    for (let i = 0; i < 4; i++) { f.advance(30000); await f.chat('!mark lantern', { user: '333' }); }
    await f.chat('!relic opt-out'); f.advance(1); await f.chat('!relic keep'); f.advance(30000);
    await f.chat('!mark lantern', { user: '333' });
    const session = (await f.view()).sessions[0]; assert.equal(session.viewers.find(item => item.userId === '333').spent, 5);
    assert.deepEqual(session.marks, []);
  });
}
test('Firestore lifecycle failed commit rolls back event, registry, stream and marks; retried transaction commits once', async () => {
  const f = fixture('firestore'); await f.online();
  const req = f.request('channel.chat.message', { chatter_user_id: home, message_id: 'keep', message: { text: '!relic keep', fragments: [] } });
  const before = structuredClone([...f.db.docs]); f.db.failCommit = true;
  await assert.rejects(f.apps.get(home).dispatch(req), /commit failure/); assert.deepEqual([...f.db.docs], before);
  f.db.failCommit = false; f.db.retry = true; await f.apps.get(home).dispatch(req); await f.apps.get(home).dispatch(req);
  assert.equal((await f.state.getKeeperRegistry()).holderId, home);
});
test('actual runtime enables lifecycle, creates no holder at startup, and has explicit subscription services only', async () => {
  const db = fakeFirestore(); let calls = 0;
  const runtime = await createRuntime({ NODE_ENV: 'production', RELEASE_COMMIT: 'a'.repeat(40), STATE_STORE: 'firestore', GOOGLE_CLOUD_PROJECT: 'raid-relic-hackathon',
    OAUTH_ENABLED: 'true', TWITCH_CLIENT_ID: 'test-client', TWITCH_CLIENT_SECRET: 'test-only', TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    TWITCH_EVENTSUB_SECRET: secret, TWITCH_STREAMER_ID: home, TWITCH_BOT_ID: bot, OAUTH_REDIRECT_URI: 'https://example.test/auth/callback',
    OAUTH_REDIRECT_ALLOWLIST: 'https://example.test/auth/callback', OVERLAY_ORIGIN: 'https://example.test', EVENTSUB_CALLBACK_URL: 'https://example.test/eventsub' },
  { firestoreClient: db, transport: async () => { calls++; throw new Error('No requests at startup'); } });
  assert.equal(runtime.state.lifecycleEnabled, true); assert.ok(runtime.subscriptions.reconcile); assert.ok(runtime.sendOff.processPending);
  assert.equal(calls, 0); assert.equal(db.docs.size, 0);
  const timestamp = new Date().toISOString(); const id = 'runtime-online';
  const payload = { subscription: { type: 'stream.online', version: '1', condition: { broadcaster_user_id: home } },
    event: { id: '9876', broadcaster_user_id: home, type: 'live', started_at: timestamp } };
  const rawBody = Buffer.from(JSON.stringify(payload)); const signature = createHmac('sha256', secret).update(id).update(timestamp).update(rawBody).digest('hex');
  assert.equal((await runtime.dispatch({ method: 'POST', path: '/eventsub', rawBody, headers: { 'twitch-eventsub-message-id': id, 'twitch-eventsub-message-timestamp': timestamp,
    'twitch-eventsub-message-type': 'notification', 'twitch-eventsub-message-signature': `sha256=${signature}` } })).status, 204);
  assert.equal((await runtime.state.getStreamStatus(home)).streamId, '9876');
  assert.equal((await runtime.state.getKeeperRegistry()).holderId, null);
  for (const [i, text] of ['!relic keep', '!mark orchid'].entries()) {
    const sent = new Date().toISOString(); const messageId = `runtime-chat-${i}`;
    const bytes = Buffer.from(JSON.stringify({ subscription: { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: home, user_id: bot } },
      event: { broadcaster_user_id: home, chatter_user_id: i ? '333' : home, message_id: messageId, message: { text, fragments: [] } } }));
    const digest = createHmac('sha256', secret).update(messageId).update(sent).update(bytes).digest('hex');
    assert.equal((await runtime.dispatch({ method: 'POST', path: '/eventsub', rawBody: bytes, headers: { 'twitch-eventsub-message-id': messageId,
      'twitch-eventsub-message-timestamp': sent, 'twitch-eventsub-message-type': 'notification', 'twitch-eventsub-message-signature': `sha256=${digest}` } })).status, 204);
  }
  assert.equal((await runtime.state.getKeeperRegistry()).holderId, home);
  assert.equal((await runtime.state.getPrivateMarks(home, { broadcasterId: home, chatterId: home })).sessions[0].marks.length, 1);
  assert.equal((await runtime.state.getPublicMarks(home)).marks.length, 0);
  assert.equal((await runtime.dispatch({ method: 'POST', path: '/admin/reconcile' })).status, 404);
  assert.equal((await runtime.dispatch({ method: 'GET', path: '/health' })).status, 200);
});
