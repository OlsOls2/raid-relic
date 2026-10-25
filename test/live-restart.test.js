import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { sendState, reservationReason } from '../src/send-state.js';
import { hash } from '../src/crypto.js';

async function setup(kind) {
  const f = await pilotFixture(kind);
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) { await f.control(id, 'bootstrap'); f.advance(); await f.control(id, 'keep'); f.advance(); }
  return f;
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: millisecond offline versus second-precision restart and CAS Helix recovery preserve policy/closed IDs/budget`, async () => {
    const f = await setup(kind); await f.chat(HOME, '811', '!mark moon');
    f.advance(123); const offline = f.now();
    await f.signed('stream.offline', { broadcaster_user_id: HOME }, HOME);
    f.advance(1);
    const rounded = Math.floor(offline / 1000) * 1000;
    await f.signed('stream.online', { broadcaster_user_id: HOME, id: '9100', type: 'live', started_at: new Date(rounded).toISOString() }, HOME);
    assert.equal((await f.runtime.state.getStreamStatus(HOME)).streamId, '9100');
    // Delayed offline delivery crosses start of a genuinely different live ID.
    f.advance(2500); await f.signed('stream.offline', { broadcaster_user_id: HOME }, HOME);
    f.streams.set(HOME, { user_id: HOME, id: '9101', type: 'live', started_at: new Date(rounded + 1000).toISOString() });
    f.advance(); const recovered = JSON.parse((await f.control(HOME, 'bootstrap')).body);
    assert.equal(recovered.observation, 'applied');
    const state = f.runtime.state; const c = await state.getStreamStatus(HOME);
    assert.equal(c.online, true); assert.equal(c.streamId, '9101'); assert.ok(c.closedIds.includes('9001')); assert.ok(c.closedIds.includes('9100'));
    assert.equal(c.optedIn, true); assert.equal((await state.getKeeperRegistry()).holderId, HOME);
    assert.equal((await state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME })).sessions.find(s => s.streamId === '9001').spent, 1);
    f.advance(); assert.equal(JSON.parse((await f.control(HOME, 'bootstrap')).body).observation, 'no-change');
    // Known closed ID cannot reopen, and concurrent signed lifecycle wins CAS.
    f.streams.get(HOME).id = '9001'; f.advance();
    assert.equal(JSON.parse((await f.control(HOME, 'bootstrap')).body).observation, 'closed');
    f.streams.get(HOME).id = '9102';
    f.hook(async () => { f.hook(null); f.advance(); await f.signed('stream.offline', { broadcaster_user_id: HOME }, HOME); });
    f.advance(); assert.equal(JSON.parse((await f.control(HOME, 'bootstrap')).body).observation, 'superseded');
    assert.equal((await state.getStreamStatus(HOME)).online, false);
    const baseline = hash(JSON.stringify(await state.getStreamStatus(HOME)));
    const result = await state.accept({ id: 'stale-observation', now: f.now(), sentAt: offline - 1, expiresAt: f.now() + 600000,
      observation: { baseline, event: { host: HOME, type: 'online', streamId: '9103', startedAt: rounded, sentAt: offline - 1, provenance: 'helix-observation' } } });
    assert.equal(result, 'no-change'); assert.equal((await state.getStreamStatus(HOME)).online, false);
  });
  test(`${kind}: owner Send Off reports target offline and never processes an older intent on failed reserve`, async () => {
    const f = await setup(kind); f.advance(); await f.signed('stream.offline', { broadcaster_user_id: OTHER }, OTHER);
    const blocked = JSON.parse((await f.control(HOME, `send:${OTHER}`)).body);
    assert.equal(blocked.reason, 'target-offline'); assert.match(blocked.message, /target-offline/);
    assert.equal(f.calls.filter(c => c.url.includes('/raids')).length, 0);
    f.advance(); f.streams.set(OTHER, { user_id: OTHER, id: '9200', type: 'live', started_at: new Date(f.now()).toISOString() });
    await f.control(OTHER, 'bootstrap'); f.advance();
    const sent = JSON.parse((await f.control(HOME, `send:${OTHER}`)).body); assert.equal(sent.status, 'accepted');
    const again = JSON.parse((await f.control(HOME, `send:${OTHER}`)).body); assert.equal(again.reason, 'existing-intent');
    assert.equal(f.calls.filter(c => c.url.includes('/raids')).length, 1);
    const view = JSON.parse((await f.request(`/control/${HOME}/status`, 'GET', { cookie: f.cookies[HOME] })).body);
    assert.equal(view.pilot.eligibility.reason, 'existing-intent');
  });
}
test('every reservation guard returns a closed reason and leaves registry unchanged; exact-ID claim never selects old intent', () => {
  const t = Date.parse('2026-10-25T09:32:22.123Z');
  const config = { channels: [HOME, OTHER], logins: { olsols2: OTHER } };
  function fixture() {
    const registry = { holderId: HOME, originated: true };
    const channels = Object.fromEntries([HOME, OTHER].map(id => [id, { online: true, streamId: id, startedAt: t - 1000, consentAt: t - 500, optedIn: true, paused: false, banned: false, blockedUserIds: [] }]));
    const marks = Object.fromEntries([HOME, OTHER].map(id => [id, { context: { keeperId: id, streamId: id, optedIn: true, holdsRelic: id === HOME, blockedUserIds: [] }, paused: false, blocked: [] }]));
    return { registry, channels, marks, op: { type: 'reserve', source: HOME, actor: HOME, login: 'olsols2', id: 'request', sentAt: t } };
  }
  const cases = [['source-actor', f => f.op.actor = OTHER], ['target-config', f => f.op.login = 'unknown'],
    ['existing-intent', f => f.registry.send = { status: 'unknown' }], ['pending-handoff', f => f.registry.pendingHop = { endsAt: t + 1 }],
    ['send-watermark', f => f.registry.sendWatermark = t], ['source-not-holder', f => f.registry.holderId = OTHER],
    ['cross-channel-block', f => f.channels[HOME].blockedUserIds.push(OTHER)]];
  for (const [role, id] of [['source', HOME], ['target', OTHER]]) cases.push(
    [role + '-offline', f => f.channels[id].online = false], [role + '-consent', f => f.channels[id].optedIn = false],
    [role + '-paused', f => f.marks[id].paused = true], [role + '-blocked', f => f.channels[id].banned = true],
    [role + '-mark-context', f => f.marks[id].context.streamId = 'wrong'], [role + '-timestamp', f => f.channels[id].consentAt = t + 1]);
  for (const [reason, change] of cases) {
    const f = fixture(); change(f); const before = structuredClone(f.registry);
    assert.equal(reservationReason(f.registry, f.channels, f.marks, config, f.op, t), reason);
    const next = sendState(f.registry, f.channels, f.marks, config, f.op, t);
    assert.deepEqual(next.result, { status: 'blocked', reason }); assert.deepEqual(next.registry, before);
  }
  const f = fixture(); f.registry.send = { id: 'old', sourceId: HOME, status: 'queued', expiresAt: t + 1000 };
  assert.equal(sendState(f.registry, f.channels, f.marks, config, { type: 'claim', source: HOME, owner: 'worker', expectedId: 'new' }, t).result, null);
});

test('Send Off warnings contain only fixed enums and configured identity; logger failure is harmless', async () => {
  const { createPilot } = await import('../src/pilot.js'); const lines = [];
  const options = { state: { getKeeperRegistry: async () => ({}) }, store: {}, oauth: {}, subscriptions: {}, sends: {},
    logger: line => lines.push(JSON.parse(line)) };
  const result = await createPilot(options).execute(HOME, 'process');
  assert.equal(result.reason, 'no-own-queued-intent');
  assert.deepEqual(lines, [{ severity: 'WARNING', event: 'raid_relic_send_blocked', keeperId: HOME, reason: 'no-own-queued-intent' }]);
  assert.deepEqual(await createPilot({ ...options, logger: () => { throw Error('synthetic-sensitive-error'); } }).execute(HOME, 'process'), result);
  const failure = await createPilot({ ...options, store: { getJob: async () => { throw Error('synthetic-sensitive-error'); } } }).execute(HOME, `send:${OTHER}`);
  assert.equal(failure.reason, 'grants-unavailable'); assert.ok(!JSON.stringify(lines).includes('synthetic-sensitive-error'));
});
