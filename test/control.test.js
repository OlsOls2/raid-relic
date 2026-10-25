import test from 'node:test';
import assert from 'node:assert/strict';
import { createOAuth, SCOPES } from '../src/oauth.js';
import { createMemoryAuthStore, createFirestoreStore } from '../src/store.js';
import { createApp } from '../src/app.js';
import { createTokenCipher, hash } from '../src/crypto.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';
const home = '1591805230', second = '1591806023', bot = '1591804828';
const key = Buffer.alloc(32, 8).toString('base64');
function fixture(kind) {
  const db = kind === 'firestore' ? fakeFirestore() : null;
  const store = db ? createFirestoreStore(db) : createMemoryAuthStore();
  let time = 1000, account = home, scopes = SCOPES.streamer; const calls = [];
  const oauth = createOAuth({ clientId: 'public-test-client', clientSecret: 'synthetic-client-secret', redirectUri: 'https://local.example/auth/callback',
    redirectAllowlist: ['https://local.example/auth/callback'], streamerId: home, botId: bot, keeperIds: [home, second], encryptionKey: key, store,
    now: () => time, production: true, transport: async (url, input) => {
      calls.push({ url, ...input });
      if (url.endsWith('/token')) return { status: 200, data: { access_token: `access-${account}`, refresh_token: `refresh-${account}`, token_type: 'bearer' } };
      return { status: 200, data: { client_id: 'public-test-client', user_id: account, scopes, expires_in: 3600 } };
    } });
  const app = createApp({ oauth, now: () => time });
  const request = (path, headers = {}, method = 'GET', body) => app.dispatch({ path, headers, method, rawBody: body === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(body)) });
  const start = async path => { const r = await request(path); assert.equal(r.status, 302); return { state: new URL(r.headers.location).searchParams.get('state'), cookie: r.headers['set-cookie'].split(';')[0], url: r.headers.location }; };
  const finish = (login, suffix = 'code=synthetic-code') => request(`/auth/callback?state=${login.state}&${suffix}`, { cookie: login.cookie });
  async function login(id, path = `/oauth/keeper/${id}/start`) {
    account = id; scopes = id === bot ? SCOPES.bot : SCOPES.streamer;
    const flow = await start(path); const result = await finish(flow); assert.equal(result.status, 200);
    const cookies = result.headers['set-cookie']; return { cookie: Array.isArray(cookies) ? cookies[1].split(';')[0] : cookies.split(';')[0], result };
  }
  return { db, store, oauth, request, start, finish, login, calls, advance(ms) { time += ms; }, identity(id, grants = SCOPES.streamer) { account = id; scopes = grants; } };
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: two Keeper grants preserve legacy namespaces, exact scopes, AAD and refresh isolation`, async () => {
    const f = fixture(kind); await f.login(home, '/oauth/streamer/start'); const original = await f.store.getToken('streamer');
    await f.login(second); assert.deepEqual(await f.store.getToken('streamer'), original);
    assert.ok(await f.store.getToken(`keeper:${second}`)); assert.equal(await f.store.getToken(`keeper:${home}`), undefined);
    const cipher = createTokenCipher(key);
    assert.throws(() => cipher.open(original, `public-test-client:keeper:${second}:${second}`));
    f.identity(home); assert.equal(await f.oauth.accessToken('streamer'), `access-${home}`);
    assert.equal(await f.oauth.accessTokenForKeeper(home), `access-${home}`);
    f.identity(second); assert.equal(await f.oauth.accessTokenForKeeper(second, { refresh: true }), `access-${second}`);
    assert.deepEqual(await f.store.getToken('streamer'), original);
    const secondRecord = await f.store.getToken(`keeper:${second}`);
    await f.store.acquire(`keeper:${second}`, 'synthetic-owner', 1000);
    await f.store.saveToken(`keeper:${second}`, original, 'synthetic-owner', 1000);
    await f.store.release(`keeper:${second}`, 'synthetic-owner');
    await assert.rejects(f.oauth.accessTokenForKeeper(second));
    await f.store.acquire(`keeper:${second}`, 'synthetic-owner', 1000);
    await f.store.saveToken(`keeper:${second}`, secondRecord, 'synthetic-owner', 1000);
    await f.store.release(`keeper:${second}`, 'synthetic-owner');
    assert.throws(() => f.oauth.accessTokenForKeeper('777'));
    const flow = await f.start(`/oauth/keeper/${home}/start`); assert.equal(new URL(flow.url).searchParams.get('scope'), SCOPES.streamer.join(' '));
    assert.ok(f.calls.filter(c => c.url.endsWith('/token')).every(c => new URLSearchParams(c.body).get('grant_type') !== 'authorization_code' || new URLSearchParams(c.body).get('redirect_uri') === 'https://local.example/auth/callback'));
  });
  test(`${kind}: sequential same-browser sessions are scoped, hash-only, rotating, and expire`, async () => {
    const f = fixture(kind); const first = await f.login(home); const next = await f.login(second);
    const cookie = `${first.cookie}; ${next.cookie}`;
    for (const id of [home, second]) assert.equal((await f.request(`/control/${id}/status`, { cookie })).status, 200);
    assert.match(first.result.headers['set-cookie'][1], /HttpOnly; SameSite=Lax; Max-Age=43200; Secure/);
    const secret = first.cookie.split('=')[1]; const stored = await f.store.getControlSession(home, hash(secret), 1000);
    assert.equal(stored.role, 'keeper'); assert.ok(!JSON.stringify(stored).includes(secret));
    if (f.db) { const contents = JSON.stringify([...f.db.docs]); assert.ok(!contents.includes(secret)); assert.ok(!contents.includes('access-')); assert.ok(!contents.includes('refresh-')); }
    const renewed = await f.login(home); assert.notEqual(renewed.cookie, first.cookie);
    assert.equal((await f.request(`/control/${home}`, { cookie: first.cookie })).status, 401);
    assert.equal((await f.request(`/control/${second}`, { cookie: next.cookie })).status, 200);
    f.advance(43200001); assert.equal((await f.request(`/control/${home}`, { cookie: renewed.cookie })).status, 401);
  });
  test(`${kind}: POST helper rejects CSRF/origin/role/cookie/body/action attacks; logout is session-only`, async () => {
    const f = fixture(kind); const a = await f.login(home); const b = await f.login(second);
    const status = await f.request(`/control/${home}/status`, { cookie: a.cookie }); const csrf = JSON.parse(status.body).csrf;
    const headers = { cookie: a.cookie, origin: 'https://local.example', 'content-type': 'application/json' };
    const body = { action: 'logout', csrf };
    for (const changed of [{ origin: undefined }, { origin: 'https://evil.example' }, { cookie: '' }, { cookie: b.cookie }, { cookie: `${a.cookie}; ${a.cookie}` }, { 'content-type': 'text/plain' }]) {
      assert.equal((await f.request(`/control/${home}`, { ...headers, ...changed }, 'POST', body)).status, 403);
    }
    for (const changed of [{ csrf: 'forged' }, { action: 'bootstrap' }, { actorId: second }, { csrf: 'x'.repeat(2000) }]) assert.equal((await f.request(`/control/${home}`, headers, 'POST', { ...body, ...changed })).status, 403);
    const tokenBefore = await f.store.getToken('streamer');
    assert.equal((await f.request(`/control/${home}`, headers, 'POST', body)).status, 200);
    assert.deepEqual(await f.store.getToken('streamer'), tokenBefore);
    assert.equal((await f.request(`/control/${home}`, headers, 'POST', body)).status, 403);
    assert.equal((await f.request(`/control/${second}`, { cookie: b.cookie })).status, 200);
  });
  test(`${kind}: wrong account/scopes and denied/replayed state create no Keeper session; bot never authorizes`, async () => {
    const f = fixture(kind);
    for (const scopes of [SCOPES.streamer, ['channel:bot']]) {
      const flow = await f.start(`/oauth/keeper/${second}/start`); f.identity(scopes.length === 2 ? home : second, scopes);
      assert.equal((await f.finish(flow)).status, 400); assert.equal(await f.store.getToken(`keeper:${second}`), undefined);
    }
    const denied = await f.start(`/oauth/keeper/${second}/start`);
    assert.equal((await f.finish(denied, 'error=access_denied')).status, 400); assert.equal((await f.finish(denied)).status, 400);
    const botLogin = await f.login(bot, '/oauth/bot/start'); assert.equal(typeof botLogin.result.headers['set-cookie'], 'string');
    assert.equal((await f.request(`/control/${home}`, { cookie: botLogin.cookie })).status, 401);
    assert.equal((await f.request('/oauth/keeper/777/start')).status, 404);
    assert.equal((await f.request('/control/777')).status, 404);
    const forged = 'X'.repeat(43);
    await f.store.createControlSession(home, { keeperId: home, role: 'bot', sessionHash: hash(forged), csrfHash: hash('fake'), expiresAt: 100000 });
    assert.equal((await f.request(`/control/${home}`, { cookie: `__Host-rr_control_${home}=${forged}` })).status, 401);
    assert.equal((await f.request(`/control/${home}?returnTo=https://evil.example`)).status, 404);
  });
}

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: OAuth redirects/callbacks and private control responses deny framing and referrers`, async () => {
    const f = fixture(kind); const flow = await f.start(`/oauth/keeper/${home}/start`);
    const connected = await f.finish(flow); assert.equal(connected.status, 200);
    const cookie = connected.headers['set-cookie'][1].split(';')[0];
    const responses = [connected, await f.request(`/oauth/keeper/${home}/start`), await f.request(`/control/${home}`, { cookie }),
      await f.request(`/control/${home}/status`, { cookie }), await f.request(`/control/${home}`),
      await f.request(`/control/${home}`, {}, 'POST', { action: 'logout', csrf: 'forged' })];
    const denied = await f.start(`/oauth/keeper/${second}/start`); responses.push(await f.finish(denied, 'error=access_denied'));
    for (const r of responses) {
      assert.equal(r.headers['content-security-policy'], "frame-ancestors 'none'; base-uri 'none'");
      assert.equal(r.headers['x-frame-options'], 'DENY'); assert.equal(r.headers['referrer-policy'], 'no-referrer');
    }
    assert.equal(responses[1].status, 302); assert.equal(new URL(responses[1].headers.location).origin, 'https://id.twitch.tv');
  });
}
