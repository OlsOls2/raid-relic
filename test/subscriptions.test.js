import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubscriptionManager } from '../src/subscriptions.js';
import { createBot } from '../src/bot.js';

function fixture(mode = 'empty') {
  const calls = []; const roles = []; const oauth = { accessToken: async role => { roles.push(role); return 'synthetic-user-token'; } };
  const config = { oauth, clientId: 'client', clientSecret: 'synthetic-secret', streamerId: '1591805230', botId: '1591804828',
    callbackUrl: 'https://example.test/eventsub', webhookSecret: 'synthetic-webhook-secret' };
  const bot = createBot(config); let manager;
  const transport = async (url, input) => {
    calls.push({ url, ...input });
    if (mode === 'error') throw new Error('PRIVATE token');
    if (url.endsWith('/token')) return { status: 200, data: { access_token: 'synthetic-app-token' } };
    if (!input.method) return { status: 200, data: { data: mode === 'existing' ? manager.payloads().map(item => ({ ...item, status: 'enabled' })) : [],
      pagination: mode === 'cursor-loop' ? { cursor: 'same-cursor' } : {} } };
    return { status: 202, data: { data: [{ id: 'created-id' }] } };
  };
  manager = createSubscriptionManager({ ...config, bot, transport });
  return { manager, calls, roles };
}
test('subscription plan binds online/offline/raid/chat conditions to one configured keeper and bot', () => {
  const f = fixture(); const payloads = f.manager.payloads(); assert.equal(f.calls.length, 0);
  assert.deepEqual(payloads.map(item => item.type), ['stream.online', 'stream.offline', 'channel.raid', 'channel.raid', 'channel.chat.message']);
  assert.deepEqual(payloads[0].condition, { broadcaster_user_id: '1591805230' });
  assert.deepEqual(payloads[2].condition, { to_broadcaster_user_id: '1591805230' });
  assert.deepEqual(payloads[3].condition, { from_broadcaster_user_id: '1591805230' });
  assert.deepEqual(payloads[4].condition, { broadcaster_user_id: '1591805230', user_id: '1591804828' });
});
test('explicit setup validates both identities, lists with app token and creates only missing subscriptions', async () => {
  const f = fixture(); const result = await f.manager.setup(); assert.equal(result.length, 5);
  assert.deepEqual(f.roles, ['streamer', 'bot']);
  assert.ok(f.calls.slice(1).every(call => call.headers.Authorization === 'Bearer synthetic-app-token'));
  assert.equal(f.calls.filter(call => call.method === 'POST' && call.url.includes('/eventsub/')).length, 5);
  const existing = fixture('existing'); assert.ok((await existing.manager.reconcile()).every(item => item.status === 'existing'));
  assert.equal(existing.calls.length, 2);
});
test('bounded reconciliation and safe failures never delete subscriptions or expose upstream errors', async () => {
  await assert.rejects(fixture('cursor-loop').manager.reconcile(), /pagination/);
  await assert.rejects(fixture('error').manager.reconcile(), error => !error.message.includes('PRIVATE'));
});

// Observed Twitch response shape: both raid keys, unused direction empty.
function observedFixture(streamerId, { conflict = false, pending = false, wrongCallback = false, badOpposite = false } = {}) {
  const calls = []; let lists = 0; let manager;
  const config = { oauth: { accessToken: async () => 'synthetic-user-token' }, clientId: 'client', clientSecret: 'synthetic-secret', streamerId,
    botId: '1591804828', callbackUrl: 'https://example.test/eventsub', webhookSecret: 'synthetic-webhook-secret' };
  const transport = async (url, input) => {
    calls.push({ method: input.method ?? 'GET' });
    if (url.endsWith('/token')) return { status: 200, data: { access_token: 'synthetic-app-token' } };
    if (input.method === 'POST') return { status: 409, data: { message: 'UPSTREAM_PRIVATE_CANARY' } };
    lists++;
    const data = manager.payloads().map(item => ({ ...item, status: pending ? 'webhook_callback_verification_pending' : 'enabled',
      transport: { ...item.transport, ...(wrongCallback ? { callback: 'https://old.example/eventsub' } : {}) },
      condition: item.type === 'channel.raid' ? { from_broadcaster_user_id: '', to_broadcaster_user_id: '', ...item.condition,
        ...(badOpposite && item.condition.to_broadcaster_user_id ? { from_broadcaster_user_id: '999' } : {}) } : item.condition }));
    return { status: 200, data: { data: conflict && lists === 1 ? data.filter(item => !(item.type === 'channel.raid' && item.condition.to_broadcaster_user_id)) : data, pagination: {} } };
  };
  manager = createSubscriptionManager({ ...config, bot: createBot(config), transport }); return { manager, calls };
}
for (const keeper of ['1591805230', '1591806023']) {
  test(`observed raid empty opposite key for ${keeper}: initial and readiness reuse enabled subscriptions without POST`, async () => {
    const f = observedFixture(keeper); const result = await f.manager.reconcile({ readiness: true });
    assert.equal(result.ready, true); assert.equal(result.conditions.length, 5); assert.ok(result.conditions.every(item => item.status === 'enabled'));
    assert.equal(f.calls.filter(call => call.method === 'POST').length, 1); // app-token exchange only
    assert.ok(result.results.every(item => item.status === 'existing'));
    const pending = await observedFixture(keeper, { pending: true }).manager.reconcile({ readiness: true });
    assert.equal(pending.ready, false); assert.ok(pending.conditions.every(item => item.status === 'pending'));
  });
}
test('409 relist uses identical strict matcher; only one create attempt and bounded final readiness list', async () => {
  const f = observedFixture('1591805230', { conflict: true }); const result = await f.manager.reconcile({ readiness: true });
  assert.equal(result.ready, true); assert.equal(f.calls.filter(call => call.method === 'POST').length, 2);
  assert.equal(f.calls.filter(call => call.method === 'GET').length, 3);
  assert.ok(!f.calls.some(call => call.method === 'DELETE'));
});
test('shared condition matcher rejects populated opposite, null, unknown keys and all nonraid extra keys', async () => {
  const { matchesSubscriptionCondition: match } = await import('../src/subscriptions.js');
  for (const active of ['from_broadcaster_user_id', 'to_broadcaster_user_id']) {
    const opposite = active === 'from_broadcaster_user_id' ? 'to_broadcaster_user_id' : 'from_broadcaster_user_id'; const desired = { [active]: '1591805230' };
    assert.equal(match('channel.raid', desired, desired), true);
    assert.equal(match('channel.raid', { ...desired, [opposite]: '' }, desired), true);
    for (const condition of [{ ...desired, [opposite]: '1591806023' }, { ...desired, [opposite]: null }, { ...desired, [opposite]: undefined }, { ...desired, extra: '' }, { [opposite]: '1591805230' }, [], null]) assert.equal(match('channel.raid', condition, desired), false);
  }
  assert.equal(match('stream.online', { broadcaster_user_id: '1591805230', extra: '' }, { broadcaster_user_id: '1591805230' }), false);
  assert.equal(match('channel.chat.message', { broadcaster_user_id: '1591805230', user_id: '999' }, { broadcaster_user_id: '1591805230', user_id: '1591804828' }), false);
});
test('bootstrap failure diagnostic is bounded and does not leak upstream payload/error; wrong callback never matches', async () => {
  const { subscriptionFailureDiagnostic } = await import('../src/subscriptions.js');
  for (const options of [{ wrongCallback: true }, { badOpposite: true }]) {
    const f = observedFixture('1591805230', options);
    await assert.rejects(f.manager.reconcile({ readiness: true }), error => {
      const safe = subscriptionFailureDiagnostic(error); assert.equal(safe.stage, 'create'); assert.equal(safe.httpStatus, 409);
      if (options.badOpposite) assert.equal(safe.direction, 'incoming');
      assert.ok(JSON.stringify(safe).length < 180); assert.ok(!JSON.stringify(safe).includes('UPSTREAM_PRIVATE_CANARY')); assert.ok(!error.message.includes('UPSTREAM_PRIVATE_CANARY')); return true;
    });
    assert.ok(!f.calls.some(call => call.method === 'DELETE'));
  }
  assert.equal(subscriptionFailureDiagnostic(Object.assign(new Error('PRIVATE'), { diagnostic: { stage: 'PRIVATE' } })), null);
});

test('diagnostic subscription types and fields are re-whitelisted, never copied from raw config/error fields', async () => {
  const { subscriptionFailureDiagnostic } = await import('../src/subscriptions.js');
  const f = observedFixture('1591805230', { badOpposite: true });
  await assert.rejects(f.manager.reconcile(), error => {
    assert.deepEqual(subscriptionFailureDiagnostic(error), { stage: 'create', httpStatus: 409, type: 'channel.raid', direction: 'incoming' });
    error.diagnostic = { stage: 'PRIVATE_CONFIG_CANARY', type: 'PRIVATE_CONFIG_CANARY', httpStatus: 'PRIVATE', direction: 'PRIVATE', token: 'PRIVATE' };
    assert.deepEqual(subscriptionFailureDiagnostic(error), { stage: 'subscriptions' }); return true;
  });
  const badChat = { type: 'PRIVATE_CONFIG_CANARY', version: '1', condition: { broadcaster_user_id: '1591805230' }, transport: { method: 'webhook', callback: 'https://example.test/eventsub' } };
  // Build a failure for the untrusted type without bypassing the four fixed
  // plan entries: let those creates succeed, then reject only the custom one.
  let creates = 0;
  const badConfig = createSubscriptionManager({ streamerId: '1591805230', oauth: { accessToken: async () => 'synthetic' },
    bot: { chatSubscription: () => badChat },
    transport: async (url, options) => url.endsWith('/token') ? { status: 200, data: { access_token: 'synthetic' } }
      : options.method === 'POST' ? (++creates <= 4 ? { status: 202, data: { data: [{ id: 'synthetic' }] } } : { status: 409, data: {} }) : { status: 200, data: { data: [] } } });
  await assert.rejects(badConfig.reconcile(), error => {
    assert.deepEqual(subscriptionFailureDiagnostic(error), { stage: 'create', httpStatus: 409 }); assert.ok(!error.message.includes('PRIVATE_CONFIG_CANARY')); return true;
  });
});
