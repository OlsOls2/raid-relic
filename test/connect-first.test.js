import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createOAuth, SCOPES } from '../src/oauth.js';
import { createMemoryAuthStore, createFirestoreStore } from '../src/store.js';
import { createTokenCipher } from '../src/crypto.js';
import { createApp } from '../src/app.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';
const config = {
  clientId: 'dummy-connect-client',
  clientSecret: 'synthetic-client-secret',
  streamerId: '201',
  keeperIds: ['201', '202'],
  botId: '101',
  encryptionKey: Buffer.alloc(32, 7).toString('base64'),
  redirectUri: 'https://fixture.example/auth/callback',
  redirectAllowlist: ['https://fixture.example/auth/callback'],
};
function fixture(kind, proof = {}) {
  const db = kind === 'firestore' ? fakeFirestore() : null;
  const store = db ? createFirestoreStore(db) : createMemoryAuthStore();
  const writes = [],
    calls = [];
  let time = 1000,
    providerDelay = 0;
  for (const method of ['createState', 'saveToken', 'acquire', 'createControlSession']) {
    const original = store[method].bind(store);
    store[method] = async (...args) => {
      writes.push({ method, args });
      return original(...args);
    };
  }
  const oauth = createOAuth({
    ...config,
    store,
    now: () => time,
    transport: async (url, options) => {
      calls.push({ url, method: options.method ?? 'GET' });
      if (url === 'https://id.twitch.tv/oauth2/token') {
        time += providerDelay;
        return {
          status: 200,
          data: {
            access_token: 'synthetic-access',
            refresh_token: 'synthetic-refresh',
            token_type: 'bearer',
          },
        };
      }
      assert.equal(url, 'https://id.twitch.tv/oauth2/validate');
      return {
        status: 200,
        data: {
          client_id: config.clientId,
          user_id: '201',
          scopes: [...SCOPES.streamer],
          expires_in: 3600,
          ...proof,
        },
      };
    },
  });
  const app = createApp({ oauth, now: () => time });
  const start = async (path = '/oauth/keeper/start') => {
    const response = await app.dispatch({ path, method: 'GET' });
    if (response.status !== 302) return { response };
    return {
      response,
      state: new URL(response.headers.location).searchParams.get('state'),
      cookie: response.headers['set-cookie'].split(';')[0],
    };
  };
  const callback = (flow, suffix = '', cookie = flow.cookie) =>
    app.dispatch({
      method: 'GET',
      path: `/auth/callback?state=${flow.state}&code=synthetic-code${suffix}`,
      headers: { cookie },
    });
  return {
    oauth,
    store,
    app,
    db,
    writes,
    calls,
    start,
    callback,
    advance(ms) {
      time += ms;
    },
    delay(ms) {
      providerDelay = ms;
    },
  };
}
const grants = (f) =>
  f.writes.filter((w) => ['saveToken', 'acquire', 'createControlSession'].includes(w.method));
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: connect-first state uses only fixed namespace/minimal scopes, validated identity selects own encrypted role and relative control303`, async () => {
    for (const id of ['201', '202']) {
      const f = fixture(kind, {
          user_id: id,
          login: 'ignored_wrong_account',
          display_name: 'Ignored',
        }),
        flow = await f.start();
      assert.equal(flow.response.status, 302);
      assert.equal(f.calls.length, 0);
      const auth = new URL(flow.response.headers.location);
      assert.equal(auth.searchParams.get('scope'), SCOPES.streamer.join(' '));
      assert.equal(auth.searchParams.get('force_verify'), 'true');
      assert.equal(f.writes[0].args[1].role, 'keeper-detect');
      assert.deepEqual(Object.keys(f.writes[0].args[1]).sort(), ['binding', 'expiresAt', 'role']);
      const result = await f.callback(flow);
      assert.equal(result.status, 303);
      assert.equal(result.headers.location, '/control/' + id);
      assert.equal(result.body, '');
      assert.equal(result.headers['set-cookie'].length, 2);
      const role = id === '201' ? 'streamer' : 'keeper:202';
      const record = await f.store.getToken(role);
      assert.ok(record);
      const token = createTokenCipher(config.encryptionKey).open(
        record,
        `${config.clientId}:${role}:${id}`,
      );
      assert.equal(token.access_token, 'synthetic-access');
      assert.equal(await f.store.getToken('keeper-detect'), undefined);
      assert.equal(f.writes.filter((w) => w.method === 'saveToken').length, 1);
      assert.equal(f.writes.filter((w) => w.method === 'createControlSession').length, 1);
      const session = f.writes.find((w) => w.method === 'createControlSession');
      assert.equal(session.args[0], id);
      assert.deepEqual(f.calls, [
        { url: 'https://id.twitch.tv/oauth2/token', method: 'POST' },
        { url: 'https://id.twitch.tv/oauth2/validate', method: 'GET' },
      ]);
      const replay = await f.callback(flow);
      assert.equal(replay.status, 400);
      assert.equal(f.calls.length, 2);
      assert.equal(
        (
          await f.oauth.control.route({
            path: '/control/' + id + '/status',
            method: 'GET',
            headers: {},
            rawBody: Buffer.alloc(0),
          })
        ).status,
        401,
      );
    }
  });
  test(`${kind}: provider-returned nonadmitted/bot identity gets invitation, no token lease, encrypted grant, session, game or identity-index writes`, async () => {
    for (const id of ['999', '101']) {
      const f = fixture(kind, { user_id: id, login: 'raidrelichq', display_name: 'Known channel' });
      const gameBefore = await f.app.state.getKeeperRegistry();
      assert.ok(gameBefore && typeof gameBefore === 'object');
      const flow = await f.start(),
        result = await f.callback(flow);
      assert.equal(result.status, 403);
      assert.match(result.body, /not admitted.*invitation/);
      assert.doesNotMatch(result.body, /999|101|Known channel|synthetic-access|synthetic-refresh/);
      assert.equal(grants(f).length, 0);
      assert.match(result.headers['set-cookie'], /Max-Age=0/);
      assert.equal(await f.store.getToken('streamer'), undefined);
      assert.equal(await f.store.getToken('keeper:202'), undefined);
      assert.deepEqual(await f.app.state.getKeeperRegistry(), gameBefore);
      assert.deepEqual(config.keeperIds, ['201', '202']);
      if (f.db) assert.equal(f.db.docs.size, 0); // Pending state consumed; no unknown grant/session/index remains.
      assert.equal(f.calls.length, 2);
      assert.equal((await f.callback(flow)).status, 400);
      assert.equal(f.calls.length, 2);
    }
  });
  for (const [name, proof] of [
    ['wrong-client', { client_id: 'other-client' }],
    ['wrong-scope', { scopes: [...SCOPES.bot] }],
    ['missing-scope', { scopes: ['channel:bot'] }],
    ['extra-scope', { scopes: [...SCOPES.streamer, 'channel:moderate'] }],
    ['duplicate-scope', { scopes: ['channel:bot', 'channel:bot'] }],
    ['no-scopes', { scopes: null }],
    ['missing-identity', { user_id: undefined }],
    ['numeric-identity', { user_id: 201 }],
    ['oversize-identity', { user_id: '1'.repeat(33) }],
    ['malformed-identity', { user_id: '__proto__' }],
    ['expired-token', { expires_in: 0 }],
    ['unfresh-token', { expires_in: 120 }],
  ])
    test(`${kind}: connect-first rejects ${name} before any grant/session writes`, async () => {
      const f = fixture(kind, proof),
        flow = await f.start(),
        result = await f.callback(flow);
      assert.equal(result.status, 400);
      assert.equal(grants(f).length, 0);
      assert.equal(f.calls.length, 2);
      assert.equal((await f.callback(flow)).status, 400);
      assert.equal(f.calls.length, 2);
    });
  test(`${kind}: browser binding, expiry, duplicate callback fields and parallel replay preserve state/CSRF authority`, async () => {
    const f = fixture(kind),
      flow = await f.start();
    assert.equal((await f.callback(flow, '', '__Host-rr_oauth=' + 'x'.repeat(43))).status, 400);
    assert.equal(f.calls.length, 0);
    const results = await Promise.all([f.callback(flow), f.callback(flow)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [303, 400]);
    assert.equal(f.calls.length, 2);
    const expired = await f.start();
    f.advance(300000);
    assert.equal((await f.callback(expired)).status, 400);
    assert.equal(f.calls.length, 2);
    const dup = await f.start();
    assert.equal((await f.callback(dup, '&state=' + dup.state)).status, 400);
    assert.equal(f.calls.length, 2);
    const forged = await f.start();
    assert.equal((await f.callback(forged, '&user_id=202')).status, 400);
    assert.equal(f.calls.length, 2);
    const denied = await f.start();
    assert.equal((await f.callback(denied, '&error=access_denied')).status, 400);
    assert.equal(f.calls.length, 2);
    assert.equal((await f.callback(denied)).status, 400);
    assert.equal(f.calls.length, 2);
  });
  test(`${kind}: generic state expiry during provider exchange cannot persist a late grant`, async () => {
    const f = fixture(kind),
      flow = await f.start();
    f.delay(300000);
    assert.equal((await f.callback(flow)).status, 400);
    assert.equal(grants(f).length, 0);
  });
  test(`${kind}: existing account-bound and bot routes retain200 callback semantics and scopes`, async () => {
    for (const [path, id, scopes, role] of [
      ['/oauth/streamer/start', '201', SCOPES.streamer, 'streamer'],
      ['/oauth/keeper/202/start', '202', SCOPES.streamer, 'keeper:202'],
      ['/oauth/bot/start', '101', SCOPES.bot, 'bot'],
    ]) {
      const f = fixture(kind, { user_id: id, scopes }),
        flow = await f.start(path);
      assert.equal(
        new URL(flow.response.headers.location).searchParams.get('scope'),
        scopes.join(' '),
      );
      assert.equal((await f.callback(flow)).status, 200);
      assert.ok(await f.store.getToken(role));
    }
  });
}
test('generic route rejects hints/methods/unknown IDs and uses existing state-capacity refusal with zero provider work', async () => {
  const f = fixture('memory');
  for (const path of [
    '/oauth/keeper/start?user_id=201',
    '/oauth/keeper/start?features=p7',
    '/oauth/keeper/start?role=bot',
  ])
    assert.equal((await f.start(path)).response.status, 400);
  for (const path of ['/oauth/keeper/start/', '/oauth/keeper/999/start'])
    assert.equal((await f.start(path)).response.status, 404);
  assert.equal((await f.app.dispatch({ path: '/oauth/keeper/start', method: 'POST' })).status, 405);
  f.store.createState = async () => false;
  assert.equal((await f.start()).response.status, 429);
  assert.equal(f.calls.length, 0);
  assert.equal(grants(f).length, 0);
});
test('read-only preview denies generic OAuth before state allocation or provider work', async () => {
  const f = fixture('memory'),
    app = createApp({ oauth: f.oauth, previewReadOnly: true });
  const result = await app.dispatch({ path: '/oauth/keeper/start', method: 'GET' });
  assert.equal(result.status, 403);
  assert.equal(f.writes.length, 0);
  assert.equal(f.calls.length, 0);
});
test('Connect is an enabled relative first action; optional typed preview cannot choose OAuth identity or perform network/storage work', async () => {
  const html = await readFile(new URL('../public/start.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../public/start.js', import.meta.url), 'utf8');
  const anchor = /<a\b[^>]*id="start-connect"[^>]*>\s*Connect Twitch\s*<\/a\s*>/.exec(html)?.[0];
  assert.ok(anchor);
  assert.match(anchor, /href="\/oauth\/keeper\/start"/);
  assert.doesNotMatch(anchor, /aria-disabled="true"/);
  assert.ok(html.indexOf('id="start-connect"') < html.indexOf('id="start-channel"'));
  const review = /<p\b[^>]*id="start-review"[^>]*>([\s\S]*?)<\/p>/
    .exec(html)?.[1]
    .replace(/\s+/g, ' ')
    .trim();
  assert.ok(
    review?.startsWith(
      'Read-only review: connection occurs only when the owner activates an approved runtime.',
    ),
  );
  assert.match(html, /Optional: configured channel name/);
  assert.doesNotMatch(js, /\['start-connect'|fetch\(|WebSocket|localStorage|sessionStorage/);
});
