import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createRuntime } from '../src/runtime.js';
import { fakeFirestore } from './fake-firestore.js';
export const HOME = '1591805230', OTHER = '1591806023', BOT = '1591804828';
export async function pilotFixture(kind = 'memory', { simulator = true, extraKeeperScopes = [], extraBotScopes = [], p7HTTP, chronicleEnv = {}, chronicleHTTP, forgeHTTP, origin = 'https://pilot.example' } = {}) {
  const db = kind === 'firestore' ? fakeFirestore() : undefined;
  let time = Date.parse('2026-10-25T12:00:00Z'); let seq = 0;
  const secret = 'synthetic-pilot-hmac-secret';
  const streams = new Map([[HOME, { user_id: HOME, id: '9001', type: 'live', started_at: new Date(time - 10000).toISOString() }],
    [OTHER, { user_id: OTHER, id: '9002', type: 'live', started_at: new Date(time - 10000).toISOString() }]]);
  const calls = [], subscriptions = []; const revoked = new Set(); let streamsHook; let conflict = false; let timeoutRaid = false; let chatFailure = null;
  const transport = async (url, options = {}) => {
    calls.push({ url, ...options }); const u = new URL(url);
    if (u.pathname.endsWith('/token')) {
      const form = new URLSearchParams(options.body);
      if (form.get('grant_type') === 'client_credentials') return { status: 200, data: { access_token: 'synthetic-app' } };
      const id = form.get('code') ?? form.get('refresh_token')?.slice('refresh-'.length);
      if (revoked.has(id)) return { status: 400, data: {} };
      return { status: 200, data: { access_token: `access-${id}`, refresh_token: `refresh-${id}`, token_type: 'bearer' } };
    }
    if (u.pathname.endsWith('/validate')) {
      const id = options.headers.Authorization.slice('OAuth access-'.length);
      if (revoked.has(id)) return { status: 401, data: {} };
      return { status: 200, data: { client_id: 'public-client', user_id: id, expires_in: 3600,
        scopes: id === BOT ? ['user:read:chat', 'user:write:chat', 'user:bot', ...extraBotScopes] : ['channel:bot', 'channel:manage:raids', ...extraKeeperScopes] } };
    }
    if (u.pathname.endsWith('/subscriptions')) {
      if (options.method === 'POST') {
        const payload = JSON.parse(options.body); subscriptions.push({ ...payload, id: String(subscriptions.length + 1), status: 'enabled' });
        if (conflict) { conflict = false; return { status: 409, data: {} }; }
        return { status: 202, data: { data: [{ id: String(subscriptions.length) }] } };
      }
      return { status: 200, data: { data: subscriptions, pagination: {} } };
    }
    if (u.pathname.endsWith('/streams')) { await streamsHook?.(u); return { status: 200, data: { data: u.searchParams.getAll('user_id').map(id => streams.get(id)).filter(Boolean) } }; }
    if (u.pathname.endsWith('/users')) { const id = u.searchParams.get('login') === 'raidrelichq' ? HOME : OTHER; return { status: 200, data: { data: [{ id, login: u.searchParams.get('login') }] } }; }
    if (u.pathname === '/helix/chat/messages') {
      assert.equal(options.method, 'POST'); assert.equal(options.headers.Authorization, `Bearer access-${BOT}`);
      const body = JSON.parse(options.body); assert.deepEqual(Object.keys(body).sort(), ['broadcaster_id', 'message', 'sender_id']);
      assert.equal(body.sender_id, BOT); assert.ok([HOME, OTHER].includes(body.broadcaster_id)); assert.equal(typeof body.message, 'string'); assert.ok(body.message.length <= 500);
      if (chatFailure === 'transport') throw Error('synthetic-token-sensitive-network-error');
      if (chatFailure === '401') return { status: 401, data: { message: 'synthetic-sensitive-body' } };
      if (chatFailure === 'drop') return { status: 200, data: { data: [{ is_sent: false, drop_reason: { code: 'untrusted-sensitive-code', message: 'synthetic-sensitive-body' } }] } };
      return { status: 200, data: { data: [{ is_sent: true, message_id: `mock-chat-${calls.length}` }] } };
    }
    if (u.pathname.endsWith('/raids')) { if (timeoutRaid) throw new Error('synthetic ambiguous result'); return { status: 200, data: { data: [{}] } }; }
    throw new Error('Unexpected mocked route');
  };
  const runtime = await createRuntime({ ...chronicleEnv, NODE_ENV: 'development', STATE_STORE: db ? 'firestore' : 'memory', GOOGLE_CLOUD_PROJECT: 'raid-relic-hackathon',
    OAUTH_ENABLED: 'true', RAID_PILOT_ENABLED: 'true', KEEPER_CHANNEL_IDS: `${HOME},${OTHER}`, TWITCH_STREAMER_ID: HOME, TWITCH_BOT_ID: BOT,
    TWITCH_CLIENT_ID: 'public-client', TWITCH_CLIENT_SECRET: 'synthetic-client-secret', TWITCH_EVENTSUB_SECRET: secret,
    TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'), OAUTH_REDIRECT_URI: `${origin}/auth/callback`, OAUTH_REDIRECT_ALLOWLIST: `${origin}/auth/callback`, EVENTSUB_CALLBACK_URL: `${origin}/eventsub` },
  { firestoreClient: db, transport, p7HTTP, chronicleHTTP, forgeHTTP, simulator, now: () => time });
  const cookies = {};
  const request = (path, method = 'GET', headers = {}, rawBody = Buffer.alloc(0)) => runtime.dispatch({ path, method, headers, rawBody });
  async function login(id, { p7 = false } = {}) {
    const start = await request(id === BOT ? `/oauth/bot/start${p7?'?features=p7':''}` : `/oauth/keeper/${id}/start`);
    const state = new URL(start.headers.location).searchParams.get('state');
    const result = await request(`/auth/callback?state=${state}&code=${id}`, 'GET', { cookie: start.headers['set-cookie'].split(';')[0] });
    if (result.status !== 200) throw new Error('Synthetic OAuth failed');
    if (id !== BOT) cookies[id] = result.headers['set-cookie'][1].split(';')[0]; return result;
  }
  async function control(id, action, overrides = {}, cached = {}) {
    const status = cached.csrf ? null : await request(`/control/${id}/status`, 'GET', { cookie: cookies[id] });
    const csrf = cached.csrf ?? (status.status === 200 ? JSON.parse(status.body).csrf : 'expired');
    return request(`/control/${id}`, 'POST', { cookie: cookies[id], origin, 'content-type': 'application/json', ...overrides }, Buffer.from(JSON.stringify({ action, csrf })));
  }
  function signed(type, event, host, condition, options = {}) {
    const id = `pilot-event-${++seq}`, timestamp = new Date(options.sentAt ?? time).toISOString();
    const rawBody = Buffer.from(JSON.stringify({ subscription: { type, version: '1', condition: condition ?? { broadcaster_user_id: host } }, event }));
    return request('/eventsub', 'POST', { 'twitch-eventsub-message-id': id, 'twitch-eventsub-message-timestamp': timestamp,
      'twitch-eventsub-message-type': 'notification', 'twitch-eventsub-message-signature': `sha256=${createHmac('sha256', secret).update(id).update(timestamp).update(rawBody).digest('hex')}` }, rawBody);
  }
  const chat = (host, user, text, options = {}) => signed('channel.chat.message', { broadcaster_user_id: host, chatter_user_id: user, chatter_user_login: `viewer${user}`,
    message_id: options.messageId ?? `chat-${++seq}`, badges: [], message: { text, fragments: [] } }, host, { broadcaster_user_id: host, user_id: BOT }, options);
  const raid = (from = HOME, to = OTHER, viewers = 1) => signed('channel.raid', { from_broadcaster_user_id: from, to_broadcaster_user_id: to, viewers }, from, { from_broadcaster_user_id: from });
  return { runtime, db, request, control, login, cookies, calls, subscriptions, streams, chat, raid, signed, now: () => time,
    chatFailure(mode) { chatFailure = mode; },
    revoke(id) { revoked.add(id); }, advance(ms = 1) { time += ms; }, hook(fn) { streamsHook = fn; }, conflict() { conflict = true; }, timeout() { timeoutRaid = true; } };
}
