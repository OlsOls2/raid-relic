import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createOAuth, SCOPES } from '../src/oauth.js';
import { createTokenCipher } from '../src/crypto.js';
import { createMemoryAuthStore } from '../src/store.js';
import { createApp } from '../src/app.js';

const key = Buffer.alloc(32, 7).toString('base64');
const config = {
  clientId: 'public-client',
  clientSecret: 'synthetic-client-secret',
  redirectUri: 'https://local.example/oauth/callback',
  redirectAllowlist: ['https://local.example/oauth/callback'],
  streamerId: '111',
  botId: '222',
  encryptionKey: key,
};
function harness(options = {}) {
  const store = options.store ?? createMemoryAuthStore();
  const calls = [];
  let time = 1000;
  const transport =
    options.transport ??
    (async (url, input) => {
      calls.push({ url, ...input });
      if (url.endsWith('/token'))
        return {
          status: 200,
          data: {
            access_token: 'synthetic-access',
            refresh_token: 'synthetic-refresh',
            token_type: 'bearer',
          },
        };
      return {
        status: 200,
        data: {
          client_id: config.clientId,
          user_id: options.account ?? '222',
          scopes: options.scopes ?? SCOPES.bot,
          expires_in: 3600,
        },
      };
    });
  const oauth = createOAuth({ ...config, store, transport, now: () => time, ...options });
  return {
    oauth,
    store,
    calls,
    advance: (ms) => {
      time += ms;
    },
  };
}
async function start(oauth, role = 'bot') {
  const response = await oauth.route({ path: `/oauth/${role}/start`, method: 'GET', headers: {} });
  assert.equal(response.status, 302);
  return {
    response,
    state: new URL(response.headers.location).searchParams.get('state'),
    cookie: response.headers['set-cookie'].split(';')[0],
  };
}
function callback(oauth, login, query = 'code=synthetic-code', cookie = login.cookie) {
  return oauth.route({
    path: `/oauth/callback?state=${login.state}&${query}`,
    method: 'GET',
    headers: { cookie },
  });
}

test('authorization uses minimum role scopes, cryptographic state and secure browser cookie', async () => {
  const { oauth } = harness();
  for (const role of ['streamer', 'bot']) {
    const login = await start(oauth, role);
    const url = new URL(login.response.headers.location);
    assert.equal(url.origin, 'https://id.twitch.tv');
    assert.equal(
      url.searchParams.get('scope'),
      role === 'streamer'
        ? 'channel:bot channel:manage:raids'
        : 'user:read:chat user:write:chat user:bot',
    );
    assert.equal(url.searchParams.get('redirect_uri'), config.redirectUri);
    assert.match(login.state, /^[\w-]{43}$/);
    assert.match(login.response.headers['set-cookie'], /^__Host-rr_oauth=/);
    for (const flag of ['HttpOnly', 'SameSite=Lax', 'Secure', 'Path=/', 'Max-Age=300'])
      assert.ok(login.response.headers['set-cookie'].includes(flag));
    assert.equal(login.response.headers['referrer-policy'], 'no-referrer');
  }
  assert.notEqual((await start(oauth)).state, (await start(oauth)).state);
});
test('successful exchange validates identity before storing encrypted tokens; state is one use', async () => {
  const { oauth, store, calls } = harness();
  const login = await start(oauth);
  assert.equal((await callback(oauth, login)).status, 200);
  const record = await store.getToken('bot');
  assert.equal(record.v, 1);
  assert.ok(!JSON.stringify(record).includes('synthetic-access'));
  assert.equal((await callback(oauth, login)).status, 400);
  assert.equal(calls.filter((call) => call.url.endsWith('/token')).length, 1);
  const parameters = new URLSearchParams(calls[0].body);
  assert.equal(parameters.get('grant_type'), 'authorization_code');
  assert.equal(parameters.get('redirect_uri'), config.redirectUri);
  assert.equal(calls[1].headers.Authorization, 'OAuth synthetic-access');
});
test('state is browser-bound; absent, altered and duplicate cookies fail before exchange', async () => {
  const { oauth, calls } = harness();
  const login = await start(oauth);
  const other = await start(oauth);
  for (const cookie of ['', other.cookie, `${login.cookie}; ${login.cookie}`])
    assert.equal((await callback(oauth, login, 'code=x', cookie)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await callback(oauth, login)).status, 200);
});
test('expired and adversarial state and duplicate query parameters are rejected', async () => {
  const h = harness();
  const login = await start(h.oauth);
  for (const query of ['code=x&state=another', 'code=x&code=y', 'code=x&role=streamer'])
    assert.equal((await callback(h.oauth, login, query)).status, 400);
  assert.equal((await callback(h.oauth, { ...login, state: 'a'.repeat(43) })).status, 400);
  h.advance(300000);
  assert.equal((await callback(h.oauth, login)).status, 400);
  assert.equal(h.calls.length, 0);
});
test('simultaneous callbacks consume state once across OAuth service instances', async () => {
  const one = harness();
  const two = harness({ store: one.store });
  const login = await start(one.oauth);
  const responses = await Promise.all([callback(one.oauth, login), callback(two.oauth, login)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 400]);
  assert.equal(one.calls.length + two.calls.length, 2);
});
test('provider denial, missing code and token errors consume state without reflecting secrets', async () => {
  for (const query of [
    'error=access_denied&error_description=synthetic-secret',
    'code=',
    'code=bad-code',
  ]) {
    const h = harness({
      transport: async () => ({ status: 400, data: { message: 'synthetic-secret' } }),
    });
    const login = await start(h.oauth);
    const response = await callback(h.oauth, login, query);
    assert.equal(response.status, 400);
    assert.ok(!response.body.includes('synthetic-secret'));
    assert.match(response.headers['set-cookie'], /Max-Age=0/);
    assert.equal((await callback(h.oauth, login)).status, 400);
    assert.equal(await h.store.getToken('bot'), undefined);
  }
});
test('wrong user, wrong role grants and wrong OAuth client cannot be saved', async () => {
  for (const options of [{ account: '111' }, { scopes: SCOPES.streamer }, { scopes: [] }]) {
    const h = harness(options);
    const login = await start(h.oauth);
    assert.equal((await callback(h.oauth, login)).status, 400);
    assert.equal(await h.store.getToken('bot'), undefined);
  }
  const h = harness({
    transport: async (url) =>
      url.endsWith('/token')
        ? { status: 200, data: { access_token: 'x', refresh_token: 'y', token_type: 'bearer' } }
        : {
            status: 200,
            data: { client_id: 'wrong', user_id: '222', scopes: SCOPES.bot, expires_in: 3600 },
          },
  });
  assert.equal((await callback(h.oauth, await start(h.oauth))).status, 400);
});
test('streamer authorization cannot be repurposed as bot credentials', async () => {
  const h = harness({ account: '111', scopes: SCOPES.streamer });
  const login = await start(h.oauth, 'streamer');
  assert.equal((await callback(h.oauth, login)).status, 200);
  await assert.rejects(h.oauth.accessToken('bot'), /Authorization required/);
  assert.equal(await h.oauth.accessToken('streamer'), 'synthetic-access');
});
test('streamer consent requires both chat bot and committed Send Off raid grants', async () => {
  for (const scopes of [['channel:bot'], ['channel:manage:raids']]) {
    const h = harness({ account: '111', scopes });
    const login = await start(h.oauth, 'streamer');
    assert.equal((await callback(h.oauth, login)).status, 400);
    assert.equal(await h.store.getToken('streamer'), undefined);
  }
});
test('refresh on validation 401 rotates encrypted refresh token and validates new identity', async () => {
  let invalid = false;
  const calls = [];
  const h = harness({
    transport: async (url, input) => {
      calls.push({ url, ...input });
      if (url.endsWith('/token')) {
        const refresh = new URLSearchParams(input.body).get('grant_type') === 'refresh_token';
        return {
          status: 200,
          data: {
            access_token: refresh ? 'new-access' : 'old-access',
            refresh_token: refresh ? 'new-refresh' : 'old-refresh',
            token_type: 'bearer',
          },
        };
      }
      if (invalid && input.headers.Authorization === 'OAuth old-access')
        return { status: 401, data: {} };
      return {
        status: 200,
        data: { client_id: config.clientId, user_id: '222', scopes: SCOPES.bot, expires_in: 3600 },
      };
    },
  });
  assert.equal((await callback(h.oauth, await start(h.oauth))).status, 200);
  invalid = true;
  assert.equal(await h.oauth.accessToken('bot'), 'new-access');
  const refresh = calls.find(
    (call) => new URLSearchParams(call.body).get('grant_type') === 'refresh_token',
  );
  assert.equal(new URLSearchParams(refresh.body).get('refresh_token'), 'old-refresh');
  const stored = createTokenCipher(key).open(
    await h.store.getToken('bot'),
    'public-client:bot:222',
  );
  assert.equal(stored.refresh_token, 'new-refresh');
});
test('refresh failures and transport exceptions do not expose upstream secrets', async () => {
  const h = harness();
  assert.equal((await callback(h.oauth, await start(h.oauth))).status, 200);
  for (const transport of [
    async () => {
      throw new Error('LEAK-access-token');
    },
    async () => ({ status: 500, data: { message: 'LEAK-access-token' } }),
  ]) {
    const other = harness({ store: h.store, transport });
    await assert.rejects(
      other.oauth.accessToken('bot'),
      (error) => !error.message.includes('LEAK'),
    );
    const login = await start(other.oauth);
    assert.ok(!JSON.stringify(await callback(other.oauth, login)).includes('LEAK'));
  }
});
test('fresh validation in another instance does not acquire a lease or block fresh use', async () => {
  const h = harness();
  assert.equal((await callback(h.oauth, await start(h.oauth))).status, 200);
  let unlock;
  const blocked = new Promise((resolve) => {
    unlock = resolve;
  });
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const second = harness({
    store: h.store,
    transport: async () => {
      entered();
      await blocked;
      return {
        status: 200,
        data: { client_id: config.clientId, user_id: '222', scopes: SCOPES.bot, expires_in: 3600 },
      };
    },
  });
  const pending = second.oauth.accessToken('bot');
  await ready;
  assert.equal(await h.oauth.accessToken('bot'), 'synthetic-access');
  unlock();
  await pending;
  assert.equal(await h.oauth.accessToken('bot'), 'synthetic-access');
});
test('invalid refresh grant and changed refreshed identity fail closed without overwriting encrypted tokens', async () => {
  for (const failExchange of [true, false]) {
    const h = harness();
    assert.equal((await callback(h.oauth, await start(h.oauth))).status, 200);
    const before = await h.store.getToken('bot');
    const next = harness({
      store: h.store,
      transport: async (url, input) => {
        if (url.endsWith('/token'))
          return failExchange
            ? { status: 400, data: { message: 'LEAK-refresh-token' } }
            : {
                status: 200,
                data: {
                  access_token: 'changed-access',
                  refresh_token: 'changed-refresh',
                  token_type: 'bearer',
                },
              };
        if (input.headers.Authorization === 'OAuth synthetic-access')
          return { status: 401, data: {} };
        return {
          status: 200,
          data: {
            client_id: config.clientId,
            user_id: '111',
            scopes: SCOPES.bot,
            expires_in: 3600,
          },
        };
      },
    });
    await assert.rejects(next.oauth.accessToken('bot'), (error) => !error.message.includes('LEAK'));
    assert.deepEqual(await h.store.getToken('bot'), before);
  }
});
test('AES-GCM rejects corruption, wrong key and role/account substitution', () => {
  const cipher = createTokenCipher(key);
  const token = { access_token: 'test-only', refresh_token: 'test-only-refresh' };
  const record = cipher.seal(token, 'bot:222');
  assert.deepEqual(cipher.open(record, 'bot:222'), token);
  assert.notEqual(record.iv, cipher.seal(token, 'bot:222').iv);
  assert.throws(() => cipher.open(record, 'streamer:111'), /unavailable/);
  assert.throws(
    () => createTokenCipher(Buffer.alloc(32, 8).toString('base64')).open(record, 'bot:222'),
    /unavailable/,
  );
  assert.throws(() => cipher.open({ ...record, ciphertext: 'AAAA' }, 'bot:222'), /unavailable/);
  assert.throws(() => createTokenCipher('placeholder'));
});
test('OAuth requires exact configured allowlisted redirect, distinct accounts and encryption key', () => {
  for (const options of [
    { clientSecret: '' },
    { encryptionKey: '' },
    { botId: '111' },
    { redirectAllowlist: [] },
    {
      redirectUri: 'https://local.example/other/callback',
      redirectAllowlist: ['https://local.example/other/callback'],
    },
    { redirectUri: 'https://evil.example/oauth/callback' },
    {
      redirectUri: 'http://localhost/oauth/callback',
      redirectAllowlist: ['http://localhost/oauth/callback'],
      production: true,
    },
    {
      redirectUri: 'https://local.example/oauth/callback?next=evil',
      redirectAllowlist: ['https://local.example/oauth/callback?next=evil'],
    },
  ])
    assert.throws(() => harness(options));
  const h = harness({
    redirectUri: 'http://localhost:5191/oauth/callback',
    redirectAllowlist: ['http://localhost:5191/oauth/callback'],
  });
  assert.ok(h.oauth);
});
for (const callbackPath of ['/auth/callback', '/oauth/callback']) {
  test(`configured ${callbackPath} accepts callback only there and exchanges exact redirect`, async () => {
    const redirectUri = `https://local.example${callbackPath}`;
    const h = harness({ redirectUri, redirectAllowlist: [redirectUri] });
    const instance = createApp({ oauth: h.oauth });
    const login = await start(h.oauth);
    assert.equal(
      new URL(login.response.headers.location).searchParams.get('redirect_uri'),
      redirectUri,
    );
    const wrong = callbackPath === '/auth/callback' ? '/oauth/callback' : '/auth/callback';
    const suffix = `?state=${login.state}&code=synthetic-code`;
    assert.equal(
      (
        await instance.dispatch({
          method: 'GET',
          path: wrong + suffix,
          headers: { cookie: login.cookie },
        })
      ).status,
      404,
    );
    assert.equal(
      (
        await h.oauth.route({
          method: 'GET',
          path: callbackPath.replace('/callback', '/x/../callback') + suffix,
          headers: { cookie: login.cookie },
        })
      ).status,
      404,
    );
    assert.equal(h.calls.length, 0);
    assert.equal(
      (await instance.dispatch({ method: 'GET', path: callbackPath + suffix, headers: {} })).status,
      400,
    );
    assert.equal(
      (
        await instance.dispatch({
          method: 'GET',
          path: callbackPath + suffix,
          headers: { cookie: login.cookie },
        })
      ).status,
      200,
    );
    assert.equal(new URLSearchParams(h.calls[0].body).get('redirect_uri'), redirectUri);
    assert.equal(
      (
        await instance.dispatch({
          method: 'GET',
          path: callbackPath + suffix,
          headers: { cookie: login.cookie },
        })
      ).status,
      400,
    );
  });
}
test('HTTP OAuth boundary preserves cookie/location and disables caching without listening', async () => {
  const h = harness();
  const instance = createApp({ oauth: h.oauth });
  const req = Readable.from([]);
  Object.assign(req, { method: 'GET', url: '/oauth/bot/start', headers: {} });
  const res = {
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
  await instance.handler(req, res);
  assert.equal(res.status, 302);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.match(res.headers['set-cookie'], /HttpOnly/);
  assert.match(res.headers.location, /^https:\/\/id.twitch.tv/);
  assert.equal(res.headers['content-length'], 0);
  assert.equal(
    (await createApp().dispatch({ method: 'GET', path: '/oauth/bot/start' })).status,
    503,
  );
  assert.equal((await instance.dispatch({ method: 'GET', path: '/auth/callback' })).status, 404);
});
