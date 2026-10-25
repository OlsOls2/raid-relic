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
