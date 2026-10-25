import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/runtime.js';
import { createServer } from 'node:http';
import { once } from 'node:events';
import WebSocket from 'ws';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';

async function ready(f) {
  assert.equal(f.calls.length, 0); for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) { assert.equal((await f.control(id, 'bootstrap')).status, 200); f.advance(); assert.equal((await f.control(id, 'keep')).status, 200); f.advance(); }
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: authenticated two-channel pilot completes mocked raid/claim/return with both feed updates and safe Atlas`, async () => {
    const f = await pilotFixture(kind); await ready(f); const r = f.runtime;
    assert.equal(f.subscriptions.length, 10); assert.ok(f.calls.every(c => !c.url.includes('/raids')));
    const health = JSON.parse((await f.request('/health')).body); assert.equal(health.readiness, 'owner-test-ready'); assert.equal(health.liveValidated, false);
    const updates = { [HOME]: [], [OTHER]: [] };
    for (const id of [HOME, OTHER]) r.overlayFeeds[id].subscribe(value => updates[id].push(value));
    await f.chat(HOME, '811', '!mark moon'); await f.chat(HOME, HOME, '!relic approve m1');
    const before = f.calls.filter(c => c.url.includes('/raids')).length;
    assert.equal((await f.control(HOME, `send:${OTHER}`)).status, 200);
    await f.control(HOME, 'process'); assert.equal(f.calls.filter(c => c.url.includes('/raids')).length, before + 1);
    assert.equal((await r.state.getKeeperRegistry()).holderId, HOME); assert.equal((await r.state.getPublicJourney()).rings, 0);
    f.advance(); await f.raid(); assert.equal(updates[OTHER].at(-1).status, 'incoming');
    await f.chat(HOME, '901', '!offer'); await f.chat(OTHER, '902', '!accept');
    assert.equal((await r.state.getKeeperRegistry()).holderId, OTHER);
    assert.equal(updates[HOME].at(-1).status, 'waiting'); assert.equal(updates[OTHER].at(-1).approvedCount, 1);
    assert.equal(updates[OTHER].at(-1).lineageRings, 1); assert.equal(updates[HOME].at(-1).revision, updates[OTHER].at(-1).revision);
    const atlas = JSON.parse((await f.request('/api/atlas')).body); assert.equal(atlas.rings, 1);
    await f.chat(HOME, '811', '!relic forgetme'); assert.equal(updates[OTHER].at(-1).approvedCount, 0);
    const stop = JSON.parse((await f.request(`/api/atlas/stops/${atlas.stops[0].stopId}`)).body); assert.equal(stop.marks.length, 0);
    f.advance(); await f.control(OTHER, `send:${HOME}`);
    const posted = f.calls.filter(c => c.url.includes('/raids')); assert.equal(posted.length, 2);
    assert.equal(posted[1].headers.Authorization, `Bearer access-${OTHER}`);
    f.advance(); await f.raid(OTHER, HOME); await f.chat(OTHER, OTHER, '!offer'); await f.chat(HOME, HOME, '!accept');
    assert.equal((await r.state.getKeeperRegistry()).holderId, HOME); assert.equal((await r.state.getPublicJourney()).rings, 2);
    for (const id of [HOME, OTHER]) assert.equal((await f.request(`/overlay/${id}`)).status, 200);
    assert.equal((await f.request('/overlay/777')).status, 404);
  });
  test(`${kind}: bootstrap lease, idempotency, 409 recovery and offline during observation win without quota reset`, async () => {
    const f = await pilotFixture(kind); for (const id of [BOT, HOME, OTHER]) await f.login(id);
    f.conflict(); const concurrent = await Promise.all([f.control(HOME, 'bootstrap'), f.control(HOME, 'bootstrap')]);
    assert.ok(concurrent.some(result => result.status === 409));
    assert.equal(f.subscriptions.length, 5); await f.control(HOME, 'keep');
    await f.chat(HOME, '811', '!mark moon');
    await f.control(HOME, 'bootstrap'); assert.equal(f.subscriptions.length, 5);
    const doc = await f.runtime.marks.moderationView(HOME, { broadcasterId: HOME, chatterId: HOME });
    assert.equal(doc.sessions[0].spent, 1); assert.equal((await f.runtime.state.getStreamStatus(HOME)).streamId, '9001');
    f.advance(); f.hook(async () => { f.hook(null); f.advance(); await f.signed('stream.offline', { broadcaster_user_id: HOME }, HOME); });
    const result = JSON.parse((await f.control(HOME, 'bootstrap')).body); assert.equal(result.observation, 'superseded');
    assert.equal((await f.runtime.state.getStreamStatus(HOME)).online, false);
    f.hook(null); f.advance(); await f.control(HOME, 'bootstrap'); assert.equal((await f.runtime.state.getStreamStatus(HOME)).online, false);
  });
  test(`${kind}: unauthenticated/cross-account actions have no external calls; ambiguous dispatch stays unknown`, async () => {
    const f = await pilotFixture(kind); await ready(f); const count = f.calls.length;
    for (const headers of [{ origin: undefined }, { origin: 'https://evil.example' }, { cookie: f.cookies[OTHER] }, { cookie: `${f.cookies[HOME]}; ${f.cookies[HOME]}` }]) {
      assert.equal((await f.control(HOME, 'bootstrap', headers)).status, 403);
      assert.equal((await f.control(HOME, `send:${OTHER}`, headers)).status, 403);
    }
    assert.equal((await f.control(HOME, `send:${HOME}`)).status, 403);
    const privateStatus = JSON.parse((await f.request(`/control/${HOME}/status`, 'GET', { cookie: f.cookies[HOME] })).body);
    const duplicate = Buffer.from(`{"action":"bootstrap","action":"bootstrap","csrf":"${privateStatus.csrf}"}`);
    assert.equal((await f.request(`/control/${HOME}`, 'POST', { cookie: f.cookies[HOME], origin: 'https://pilot.example', 'content-type': 'application/json' }, duplicate)).status, 403);
    assert.equal(f.calls.length, count);
    f.timeout(); await f.control(HOME, `send:${OTHER}`); await f.control(HOME, 'process');
    assert.equal((await f.runtime.state.getKeeperRegistry()).send.status, 'unknown');
    assert.equal(f.calls.filter(c => c.url.includes('/raids')).length, 1);
    f.advance(3600001); assert.equal((await f.control(HOME, 'bootstrap')).status, 403);
  });
  test(`${kind}: empty stream observation is offline; inconsistent GetStreams account rejected`, async () => {
    const f = await pilotFixture(kind); for (const id of [BOT, HOME, OTHER]) await f.login(id);
    f.streams.delete(HOME); await f.control(HOME, 'bootstrap'); assert.equal((await f.runtime.state.getStreamStatus(HOME)).online, false);
    f.streams.set(HOME, { user_id: OTHER, id: '999', type: 'live', started_at: new Date(f.now() - 100).toISOString() });
    assert.equal((await f.control(HOME, 'bootstrap')).status, 502); assert.equal((await f.runtime.state.getStreamStatus(HOME)).online, false);
  });
}
test('both real WebSocket channels share one ordered hub and global client limit', async t => {
  const f = await pilotFixture(); await ready(f); const r = f.runtime; const server = createServer(r.handler);
  const sockets = attachOverlaySockets(server, r.overlayFeeds, { origins: ['http://127.0.0.1:5191'], maxClients: 2, allowRead: r.allowPublicRead });
  t.after(async () => { sockets.close(); server.closeAllConnections(); if (server.listening) await new Promise(resolve => server.close(resolve)); });
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5191, '127.0.0.1', resolve); }); }
  catch (e) { if (e.code !== 'EPERM') throw e; t.skip('Sandbox EPERM on authorized fixed loopback5191'); return; }
  const clients = [];
  for (const id of [HOME, OTHER]) {
    const ws = new WebSocket(`ws://127.0.0.1:5191/ws/${id}`, { origin: 'http://127.0.0.1:5191' }); clients.push(ws); t.after(() => ws.terminate());
    await once(ws, 'message');
  }
  const next = clients.map(ws => once(ws, 'message'));
  await f.control(HOME, 'pause'); const values = await Promise.all(next); const snapshots = values.map(([bytes]) => JSON.parse(bytes));
  assert.equal(snapshots[0].revision, snapshots[1].revision); assert.equal(snapshots[0].status, 'paused');
  await new Promise((resolve, reject) => { const extra = new WebSocket(`ws://127.0.0.1:5191/ws/${OTHER}`, { origin: 'http://127.0.0.1:5191' }); extra.on('error', () => {});
    extra.on('unexpected-response', (_req, res) => { assert.equal(res.statusCode, 403); res.resume(); extra.terminate(); resolve(); }); extra.on('open', () => { extra.terminate(); reject(new Error('Global cap bypassed')); }); });
});

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: other authenticated Keeper cannot drain source chat intent; duplicate deliveries do not dispatch`, async () => {
    const f = await pilotFixture(kind); await ready(f);
    await f.chat(HOME, HOME, '!relic send @olsols2');
    const count = f.calls.length; const result = JSON.parse((await f.control(OTHER, 'process')).body);
    assert.equal(result.status, 'blocked'); assert.equal(result.reason, 'no-own-queued-intent'); assert.equal(f.calls.length, count);
    await Promise.all([f.control(HOME, 'process'), f.control(HOME, 'process')]);
    assert.equal(f.calls.filter(c => c.url.includes('/raids')).length, 1);
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
  });
}
test('Firestore observation commit failure rolls back channel, marks, registry and dedupe without HTTP in transaction', async () => {
  const f = await pilotFixture('firestore'); for (const id of [BOT, HOME, OTHER]) await f.login(id);
  const before = structuredClone([...f.db.docs].filter(([key]) => !key.startsWith('bootstrapJobs/')));
  f.hook(() => { f.db.failCommit = true; });
  await f.control(HOME, 'bootstrap'); f.db.failCommit = false;
  assert.deepEqual([...f.db.docs].filter(([key]) => !key.startsWith('bootstrapJobs/')), before);
  assert.equal(await f.runtime.state.getStreamStatus(HOME), undefined);
  assert.equal(f.calls.filter(c => c.url.includes('/raids')).length, 0);
});

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: abandoned bootstrap lease is channel-scoped and expires without stale owner overwriting results`, async () => {
    const f = await pilotFixture(kind); for (const id of [BOT, HOME, OTHER]) await f.login(id);
    await f.runtime.store.acquireJob(HOME, 'abandoned', f.now()); const before = f.calls.length;
    assert.equal((await f.control(HOME, 'bootstrap')).status, 409); assert.equal(f.calls.length, before);
    assert.equal((await f.control(OTHER, 'bootstrap')).status, 200);
    f.advance(300001); assert.equal((await f.control(HOME, 'bootstrap')).status, 200);
    const result = await f.runtime.store.getJob(HOME);
    await f.runtime.store.finishJob(HOME, 'abandoned', { status: 'stale' });
    assert.deepEqual(await f.runtime.store.getJob(HOME), result);
  });
}

test('pilot gate requires both explicit accounts and OAuth before constructing stores or doing network work', async () => {
  await assert.rejects(createRuntime({ RAID_PILOT_ENABLED: 'true', OAUTH_ENABLED: 'true', TWITCH_STREAMER_ID: HOME,
    TWITCH_BOT_ID: BOT, KEEPER_CHANNEL_IDS: HOME, STATE_STORE: 'memory' }), /both configured/);
  await assert.rejects(createRuntime({ RAID_PILOT_ENABLED: 'true', OAUTH_ENABLED: 'false', TWITCH_STREAMER_ID: HOME,
    TWITCH_BOT_ID: BOT, KEEPER_CHANNEL_IDS: `${HOME},${OTHER}`, STATE_STORE: 'memory' }), /both configured/);
});

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: pending chat callbacks on either side block Send Off/process until explicit enabled reconcile`, async () => {
    for (const channel of [HOME, OTHER]) {
      const f = await pilotFixture(kind); await ready(f);
      const chat = f.subscriptions.find(s => s.type === 'channel.chat.message' && s.condition.broadcaster_user_id === channel);
      chat.status = 'webhook_callback_verification_pending';
      const result = JSON.parse((await f.control(channel, 'bootstrap')).body); assert.equal(result.ready, false);
      assert.ok(result.conditions.some(c => c.type === 'channel.chat.message' && c.status === 'pending'));
      assert.deepEqual(result.conditions.filter(c => c.type === 'channel.raid').map(c => c.direction).sort(), ['incoming', 'outgoing']);
      assert.equal(JSON.parse((await f.control(HOME, `send:${OTHER}`)).body).status, 'blocked');
      await f.chat(HOME, HOME, '!relic send @olsols2');
      assert.equal(JSON.parse((await f.control(HOME, 'process')).body).status, 'blocked');
      assert.equal(f.calls.filter(c => c.url.includes('/raids')).length, 0);
      chat.status = 'enabled'; f.advance(); assert.equal(JSON.parse((await f.control(channel, 'bootstrap')).body).ready, true);
      assert.equal(JSON.parse((await f.control(HOME, 'process')).body).status, 'accepted');
      assert.equal(f.calls.filter(c => c.url.includes('/raids')).length, 1);
    }
  });
  test(`${kind}: missing target/bot and revoked grants cannot dispatch despite persisted ready flags`, async () => {
    for (const account of [OTHER, BOT]) {
      const f = await pilotFixture(kind); await ready(f); f.revoke(account);
      const result = JSON.parse((await f.control(HOME, `send:${OTHER}`)).body);
      assert.equal(result.status, 'blocked'); assert.ok(result.message.includes('grants'));
      assert.equal(f.calls.filter(c => c.url.includes('/raids')).length, 0);
      const g = await pilotFixture(kind); await ready(g);
      const original = g.runtime.store.getToken.bind(g.runtime.store);
      g.runtime.store.getToken = role => role === (account === BOT ? 'bot' : `keeper:${OTHER}`) ? undefined : original(role);
      assert.equal(JSON.parse((await g.control(HOME, `send:${OTHER}`)).body).status, 'blocked');
      assert.equal(g.calls.filter(c => c.url.includes('/raids')).length, 0);
    }
  });
  test(`${kind}: incoming approved rune preview follows signed receipt and immediate source privacy controls`, async () => {
    for (const action of ['forgetme', 'block', 'veto-last', 'opt-out']) {
      const f = await pilotFixture(kind); await ready(f); await f.chat(HOME, '811', '!mark moon'); await f.chat(HOME, HOME, '!relic approve m1');
      let host; f.runtime.overlayFeeds[OTHER].subscribe(snapshot => { host = snapshot; });
      await f.control(HOME, `send:${OTHER}`); assert.equal((await f.runtime.overlayFeeds[OTHER].snapshot()).marks.length, 0);
      f.advance(); await f.raid(); assert.equal(host.status, 'incoming'); assert.equal(host.marks.length, 1);
      assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
      assert.ok(!JSON.stringify(host).includes('moon')); assert.ok(!JSON.stringify(host).includes('userId'));
      const text = action === 'forgetme' ? '!relic forgetme' : action === 'block' ? '!relic block 811' : `!relic ${action}`;
      await f.chat(HOME, action === 'forgetme' ? '811' : HOME, text);
      assert.equal(host.marks.length, 0, action); assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
    }
  });
}
test('ordinary managed chat and duplicate actions do not read/write ledgers or cause public fanout', async () => {
  const f = await pilotFixture('firestore'); await ready(f); const received = [];
  for (const feed of Object.values(f.runtime.overlayFeeds)) feed.subscribe(s => received.push(s));
  f.db.reads.length = 0; f.db.writes.length = 0;
  await f.chat(HOME, '811', 'ordinary chatter');
  assert.equal(f.db.reads.length, 5); assert.equal(f.db.writes.length, 4);
  assert.ok(f.db.reads.every(key => ['events/', 'streamChannels/', 'markChannels/', 'presence/'].some(prefix => key.startsWith(prefix))));
  assert.ok(f.db.writes.every(key => /^(events|chatReceipts|presence)\//.test(key))); assert.equal(received.length, 0);
  const input = { id: 'quiet-duplicate', now: f.now(), expiresAt: f.now() + 600000, chat: { broadcasterId: HOME, chatterId: '811', messageId: 'receipt' } };
  await f.runtime.state.accept(input); await f.runtime.state.accept(input); assert.equal(received.length, 0);
  const mark = { ...input, id: 'mark-duplicate', chat: { ...input.chat, markAction: { type: 'mark', text: 'moon' } } };
  await f.runtime.state.accept(mark); assert.equal(received.length, 2);
  f.db.reads.length = 0; await f.runtime.state.accept(mark); assert.equal(received.length, 2); assert.equal(f.db.reads.length, 1);
});

for (const kind of ['memory', 'firestore']) test(`${kind}: bootstrap failures persist safe stage-only diagnostics without upstream text`, async () => {
  const f = await pilotFixture(kind); for (const id of [BOT, HOME, OTHER]) await f.login(id);
  f.runtime.subscriptionManagers[HOME].reconcile = async () => { throw Object.assign(new Error('UPSTREAM_PRIVATE_CANARY'), { diagnostic: { stage: 'UPSTREAM_PRIVATE_CANARY', token: 'UPSTREAM_PRIVATE_CANARY' } }); };
  const failed = await f.control(HOME, 'bootstrap'); assert.equal(failed.status, 502);
  const body = JSON.parse(failed.body); assert.equal(body.ready, false); assert.deepEqual(body.diagnostic, { stage: 'subscriptions' });
  assert.ok(!failed.body.includes('UPSTREAM_PRIVATE_CANARY'));
  const status = await f.runtime.pilot.status(HOME); assert.deepEqual(status.subscriptions.diagnostic, { stage: 'subscriptions' });
  assert.equal(status.bothReadiness.raidrelichq, false);
});

test('failed explicit bootstrap logs exactly one bounded structured warning; logger failures cannot change outcome', async () => {
  const { createPilot } = await import('../src/pilot.js');
  for (const logging of ['capture', 'throw', 'reject']) {
    const lines = []; let saved;
    const pilot = createPilot({ state: { getStreamStatus: async () => null },
      store: { acquireJob: async () => true, finishJob: async (_id, _owner, result) => { saved = result; } },
      subscriptions: { [HOME]: { reconcile: async () => { throw Object.assign(new Error('UPSTREAM_PRIVATE_CANARY\nstack'), { diagnostic: { type: 'PRIVATE', stage: 'PRIVATE' }, headers: { Authorization: 'PRIVATE' } }); } } },
      logger: line => { lines.push(line); if (logging === 'throw') throw Error('logger failed'); if (logging === 'reject') return Promise.reject(Error('logger rejected')); } });
    const result = await pilot.execute(HOME, 'bootstrap');
    assert.equal(result.status, 'failed'); assert.equal(result.ready, false); assert.deepEqual(saved, result);
    assert.equal(lines.length, 1); assert.ok(lines[0].length < 300); assert.equal(lines[0].includes('\n'), false);
    assert.deepEqual(JSON.parse(lines[0]), { severity: 'WARNING', event: 'raid_relic_bootstrap_failed', keeperId: HOME, diagnostic: { stage: 'subscriptions' } });
    assert.ok(!lines[0].includes('PRIVATE')); assert.ok(!lines[0].includes('stack')); assert.ok(!lines[0].includes('Authorization'));
  }
});
test('default logger emits one JSON console.warn; successful/busy/invalid bootstrap emits none', async () => {
  const { createPilot } = await import('../src/pilot.js'); const lines = []; const previous = console.warn;
  let busy = false, fail = true;
  const pilot = createPilot({ state: { getStreamStatus: async () => null, accept: async () => 'accepted' },
    store: { acquireJob: async () => !busy, finishJob: async () => {} }, oauth: { accessTokenForKeeper: async () => 'synthetic-user-token' },
    subscriptions: { [HOME]: { reconcile: async () => { if (fail) throw Error('PRIVATE'); return { results: [], conditions: [], ready: true }; } } },
    transport: async () => ({ status: 200, data: { data: [] } }) });
  console.warn = (...args) => lines.push(args);
  try {
    assert.equal((await pilot.execute(HOME, 'bootstrap')).status, 'failed');
    assert.equal(lines.length, 1); assert.equal(lines[0].length, 1); assert.equal(JSON.parse(lines[0][0]).severity, 'WARNING');
    fail = false; assert.equal((await pilot.execute(HOME, 'bootstrap')).status, 'reconciled');
    busy = true; assert.equal((await pilot.execute(HOME, 'bootstrap')).status, 'busy');
    await assert.rejects(pilot.execute('999', 'bootstrap')); assert.equal(lines.length, 1);
  } finally { console.warn = previous; }
});
