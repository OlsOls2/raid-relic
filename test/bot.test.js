import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createBot, parseChat } from '../src/bot.js';
import { createApp } from '../src/app.js';

const config = {
  clientId: 'client',
  clientSecret: 'synthetic-secret',
  streamerId: '111',
  botId: '222',
  callbackUrl: 'https://example.test/eventsub',
  webhookSecret: 'synthetic-webhook-secret',
};
const payload = {
  subscription: {
    type: 'channel.chat.message',
    version: '1',
    condition: { broadcaster_user_id: '111', user_id: '222' },
  },
  event: {
    broadcaster_user_id: '111',
    chatter_user_id: '333',
    message_id: 'message-123',
    message: { text: 'hello 💎', fragments: [{ type: 'text', text: 'hello 💎' }] },
  },
};
test('Helix send uses validated bot token and bot sender, never streamer token', async () => {
  const roles = [];
  const calls = [];
  const bot = createBot({
    ...config,
    oauth: {
      accessToken: async (role) => {
        roles.push(role);
        return 'synthetic-bot-token';
      },
    },
    transport: async (url, input) => {
      calls.push({ url, ...input });
      return { status: 200, data: { data: [{ message_id: 'sent', is_sent: true }] } };
    },
  });
  assert.deepEqual(await bot.sendChat('hello'), { messageId: 'sent' });
  assert.deepEqual(roles, ['bot']);
  assert.equal(calls[0].url, 'https://api.twitch.tv/helix/chat/messages');
  assert.equal(calls[0].headers.Authorization, 'Bearer synthetic-bot-token');
  assert.deepEqual(JSON.parse(calls[0].body), {
    broadcaster_id: '111',
    sender_id: '222',
    message: 'hello',
  });
  for (const message of ['', ' ', 'a'.repeat(501), null])
    await assert.rejects(bot.sendChat(message), /Invalid/);
});
test('chat refreshes once on 401; dropped messages, upstream errors and exceptions are safe', async () => {
  const tokens = [];
  let calls = 0;
  const bot = createBot({
    ...config,
    oauth: {
      accessToken: async (role, options) => {
        tokens.push({ role, ...options });
        return 'test-token';
      },
    },
    transport: async () =>
      ++calls === 1
        ? { status: 401, data: {} }
        : { status: 200, data: { data: [{ message_id: 'sent', is_sent: true }] } },
  });
  await bot.sendChat('hello');
  assert.deepEqual(tokens, [
    { role: 'bot', refresh: false },
    { role: 'bot', refresh: true },
  ]);
  for (const transport of [
    async () => ({
      status: 200,
      data: { data: [{ is_sent: false, drop_reason: { message: 'LEAK' } }] },
    }),
    async () => {
      throw new Error('LEAK');
    },
    async () => ({ status: 401, data: { message: 'LEAK' } }),
  ]) {
    const failed = createBot({
      ...config,
      oauth: { accessToken: async () => 'test-token' },
      transport,
    });
    await assert.rejects(failed.sendChat('hello'), (error) => !error.message.includes('LEAK'));
  }
});
test('webhook subscription verifies prior grants then uses app token, not a user token', async () => {
  const roles = [];
  const calls = [];
  const bot = createBot({
    ...config,
    oauth: {
      accessToken: async (role) => {
        roles.push(role);
        return 'user-token';
      },
    },
    transport: async (url, input) => {
      calls.push({ url, ...input });
      return url.endsWith('/token')
        ? { status: 200, data: { access_token: 'app-token' } }
        : { status: 202, data: { data: [{ id: 'subscription-id' }] } };
    },
  });
  assert.deepEqual(await bot.subscribeChat(), { subscriptionId: 'subscription-id' });
  assert.deepEqual(roles, ['streamer', 'bot']);
  assert.equal(new URLSearchParams(calls[0].body).get('grant_type'), 'client_credentials');
  assert.equal(calls[1].headers.Authorization, 'Bearer app-token');
  assert.deepEqual(JSON.parse(calls[1].body), {
    type: 'channel.chat.message',
    version: '1',
    condition: { broadcaster_user_id: '111', user_id: '222' },
    transport: { method: 'webhook', callback: config.callbackUrl, secret: config.webhookSecret },
  });
  const bad = createBot({ ...config, callbackUrl: 'http://example.test/eventsub', oauth: {} });
  assert.throws(() => bad.chatSubscription(), /configuration/);
});
test('chat payload schema rejects wrong condition, host, version and malformed messages', () => {
  assert.deepEqual(parseChat(payload, config), {
    broadcasterId: '111',
    chatterId: '333',
    messageId: 'message-123',
  });
  for (const mutate of [
    (p) => {
      p.subscription.condition.user_id = '999';
    },
    (p) => {
      p.subscription.version = '2';
    },
    (p) => {
      p.event.broadcaster_user_id = '999';
    },
    (p) => {
      p.event.chatter_user_id = 'bad';
    },
    (p) => {
      p.event.message_id = '';
    },
    (p) => {
      p.event.message.fragments = null;
    },
    (p) => {
      p.event.message.text = 123;
    },
    (p) => {
      p.event.message.fragments = [{ type: 'bad', text: 'x' }];
    },
  ]) {
    const changed = structuredClone(payload);
    mutate(changed);
    assert.throws(() => parseChat(changed, config), /Invalid/);
  }
});
test('signed chat EventSub is deduplicated and stores bounded receipt, never creates ritual or proof of raid membership', async () => {
  const time = Date.parse('2026-10-25T12:00:00Z');
  const timestamp = new Date(time).toISOString();
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = createHmac('sha256', config.webhookSecret)
    .update('chat-event')
    .update(timestamp)
    .update(rawBody)
    .digest('hex');
  const request = {
    method: 'POST',
    path: '/eventsub',
    rawBody,
    headers: {
      'twitch-eventsub-message-id': 'chat-event',
      'twitch-eventsub-message-timestamp': timestamp,
      'twitch-eventsub-message-type': 'notification',
      'twitch-eventsub-message-signature': `sha256=${signature}`,
    },
  };
  const instance = createApp({
    secret: config.webhookSecret,
    chatContext: config,
    now: () => time,
  });
  assert.equal((await instance.dispatch(request)).status, 204);
  assert.equal((await instance.dispatch(request)).status, 204);
  assert.deepEqual(instance.state.getChatReceipt('111'), {
    broadcasterId: '111',
    chatterId: '333',
    messageId: 'message-123',
    receivedAt: time,
  });
  assert.equal(instance.state.getRitual('111'), undefined);
  assert.equal(
    (await createApp({ secret: config.webhookSecret, now: () => time }).dispatch(request)).status,
    503,
  );
  const forged = {
    ...request,
    headers: {
      ...request.headers,
      'twitch-eventsub-message-signature': 'sha256=' + '0'.repeat(64),
    },
  };
  assert.equal((await instance.dispatch(forged)).status, 403);
});

test('at-most-once reply mode never retries a chat POST on401', async () => {
  let posts = 0;
  const bot = createBot({
    ...config,
    oauth: { accessToken: async () => 'synthetic-token' },
    transport: async () => {
      posts++;
      return { status: 401, data: {} };
    },
  });
  await assert.rejects(
    bot.sendChat('public history notice', { retryUnauthorized: false }),
    /Chat message not sent/,
  );
  assert.equal(posts, 1);
});
