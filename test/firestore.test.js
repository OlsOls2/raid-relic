import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirestoreStore } from '../src/store.js';
import { createRuntime, PROJECT_ID } from '../src/runtime.js';
import { createOAuth, SCOPES } from '../src/oauth.js';
import { hash } from '../src/crypto.js';

// Serialized, staged transactions: writes commit together or are discarded.
// Optional retry executes and discards the first attempt, as an SDK retry can.
function fakeFirestore() {
  const docs = new Map(); let queue = Promise.resolve();
  const db = {
    docs, failCommit: false, retry: false,
    collection(name) { return { doc(id) {
      const key = `${name}/${id}`;
      return { key, async get() { return snapshot(docs.get(key)); },
        async create(value) { return db.runTransaction(async tx => {
          const ref = { key }; if ((await tx.get(ref)).exists) throw new Error('Already exists'); tx.set(ref, value);
        }); } };
    } }; },
    runTransaction(operation) {
      const execute = async () => {
        const attempt = async () => {
          const staged = new Map(); let writing = false;
          const tx = {
            async get(ref) { assert.equal(writing, false, 'All transaction reads precede writes'); return snapshot(docs.get(ref.key)); },
            set(ref, value) { writing = true; staged.set(ref.key, structuredClone(value)); },
            delete(ref) { writing = true; staged.set(ref.key, undefined); },
          };
          return { result: await operation(tx), staged };
        };
        if (db.retry) { db.retry = false; await attempt(); }
        const { result, staged } = await attempt();
        if (db.failCommit) throw new Error('Synthetic commit failure');
        for (const [key, value] of staged) { if (value === undefined) docs.delete(key); else docs.set(key, value); }
        return result;
      };
      const result = queue.then(execute); queue = result.catch(() => {}); return result;
    },
  };
  function snapshot(value) { return { exists: value !== undefined, data: () => structuredClone(value) }; }
  return db;
}
const raid = { from_broadcaster_user_id: '111', to_broadcaster_user_id: '222', viewers: 10 };
const event = { id: 'event/id-with-slash', now: 1000, expiresAt: 2000, raid };
test('Firestore dedupe and ritual commit atomically, including concurrent instances and SDK retry', async () => {
  const db = fakeFirestore(); const one = createFirestoreStore(db); const two = createFirestoreStore(db); db.retry = true;
  const responses = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? one : two).accept(event)));
  assert.equal(responses.filter(response => response === 'accepted').length, 1);
  assert.equal(responses.filter(response => response === 'duplicate').length, 29);
  assert.equal(db.docs.size, 2);
  assert.equal((await one.getRitual('222')).endsAt, 91000);
  assert.equal((await two.getRitual('222')).eventId, event.id);
  assert.ok([...db.docs.keys()].every(key => /^[^/]+\/[a-f0-9]{64}$/.test(key)));
});
test('Firestore failed commit writes neither event nor ritual; retry succeeds', async () => {
  const db = fakeFirestore(); const store = createFirestoreStore(db); db.failCommit = true;
  await assert.rejects(store.accept(event), /commit failure/); assert.equal(db.docs.size, 0);
  db.failCommit = false; assert.equal(await store.accept(event), 'accepted');
  assert.equal(await store.accept({ ...event, now: 1500 }), 'duplicate');
  assert.equal((await store.getRitual('222')).startedAt, 1000);
});
test('Firestore expired event ID can be reused and chat metadata is atomic without raw text', async () => {
  const db = fakeFirestore(); const store = createFirestoreStore(db);
  await store.accept(event);
  assert.equal(await store.accept({ ...event, now: 2001, expiresAt: 3000 }), 'accepted');
  assert.equal((await store.getRitual('222')).startedAt, 2001);
  await store.accept({ id: 'chat', now: 2001, expiresAt: 3000, chat: { broadcasterId: '222', chatterId: '333', messageId: 'msg', text: 'DO NOT STORE' } });
  assert.ok(!JSON.stringify([...db.docs.values()]).includes('DO NOT STORE'));
});
test('Firestore OAuth state expiry and browser binding are enforced transactionally once', async () => {
  const db = fakeFirestore(); const one = createFirestoreStore(db); const two = createFirestoreStore(db);
  await one.createState('state', { binding: 'browser-hash', role: 'bot', expiresAt: 2000 });
  assert.equal(await two.consumeState('state', 'wrong-browser', 1000), null);
  const results = await Promise.all([one.consumeState('state', 'browser-hash', 1000), two.consumeState('state', 'browser-hash', 1000)]);
  assert.equal(results.filter(Boolean).length, 1);
  await one.createState('expired', { binding: 'browser-hash', role: 'bot', expiresAt: 1000 });
  assert.equal(await two.consumeState('expired', 'browser-hash', 1000), null);
});
test('Firestore token lease rejects races, expired owners and stale release', async () => {
  const db = fakeFirestore(); const one = createFirestoreStore(db); const two = createFirestoreStore(db);
  assert.equal(await one.acquire('bot', 'one', 1000), true);
  assert.equal(await two.acquire('bot', 'two', 1000), false);
  await assert.rejects(two.saveToken('bot', { ciphertext: 'x' }, 'two', 1000), /lease lost/);
  await assert.rejects(one.saveToken('bot', { ciphertext: 'x' }, 'one', 31000), /lease lost/);
  assert.equal(await two.acquire('bot', 'two', 31000), true);
  await one.release('bot', 'one');
  await two.saveToken('bot', { ciphertext: 'test-only' }, 'two', 31001);
  assert.deepEqual(await one.getToken('bot'), { ciphertext: 'test-only' });
  await two.release('bot', 'two'); assert.equal(await one.acquire('bot', 'three', 31002), true);
});
test('OAuth callback and encrypted tokens persist across instances using Firestore fake', async () => {
  const db = fakeFirestore(); const config = {
    clientId: 'client', clientSecret: 'test-secret', redirectUri: 'https://example.test/oauth/callback', redirectAllowlist: ['https://example.test/oauth/callback'],
    streamerId: '111', botId: '222', encryptionKey: Buffer.alloc(32, 9).toString('base64'), now: () => 1000,
    transport: async url => url.endsWith('/token')
      ? { status: 200, data: { access_token: 'synthetic-access', refresh_token: 'synthetic-refresh', token_type: 'bearer' } }
      : { status: 200, data: { client_id: 'client', user_id: '222', scopes: SCOPES.bot, expires_in: 1000 } },
  };
  const one = createOAuth({ ...config, store: createFirestoreStore(db) }); const two = createOAuth({ ...config, store: createFirestoreStore(db) });
  const login = await one.route({ path: '/oauth/bot/start', method: 'GET', headers: {} });
  const state = new URL(login.headers.location).searchParams.get('state');
  const cookie = login.headers['set-cookie'].split(';')[0];
  assert.ok(db.docs.has(`oauthStates/${hash(hash(state))}`));
  const request = { path: `/oauth/callback?state=${state}&code=synthetic-code`, method: 'GET', headers: { cookie } };
  assert.equal((await two.route(request)).status, 200);
  assert.equal((await one.route(request)).status, 400);
  assert.equal(await one.accessToken('bot'), 'synthetic-access');
  const serialized = JSON.stringify([...db.docs.values()]);
  for (const value of ['synthetic-access', 'synthetic-refresh', 'synthetic-code', cookie.split('=')[1], state]) assert.ok(!serialized.includes(value));
});

const env = { NODE_ENV: 'production', STATE_STORE: 'firestore', GOOGLE_CLOUD_PROJECT: PROJECT_ID, TWITCH_EVENTSUB_SECRET: 'synthetic-webhook-secret',
  OAUTH_ENABLED: 'true', TWITCH_CLIENT_ID: 'client', TWITCH_CLIENT_SECRET: 'synthetic-client-secret', TWITCH_STREAMER_ID: '111', TWITCH_BOT_ID: '222',
  OAUTH_REDIRECT_URI: 'https://example.test/oauth/callback', OAUTH_REDIRECT_ALLOWLIST: 'https://example.test/oauth/callback',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'), EVENTSUB_CALLBACK_URL: 'https://example.test/eventsub' };
test('runtime explicitly selects Firestore for only the approved project; never falls back in production', async () => {
  const instance = await createRuntime(env, { firestoreClient: fakeFirestore() }); assert.ok(instance.oauth && instance.bot);
  for (const change of [{ STATE_STORE: 'memory' }, { STATE_STORE: '' }, { GOOGLE_CLOUD_PROJECT: 'another-project' },
    { FIRESTORE_EMULATOR_HOST: 'localhost:8080' }, { TWITCH_CLIENT_SECRET: '' }, { TOKEN_ENCRYPTION_KEY: '' }, { TWITCH_EVENTSUB_SECRET: '' }, { OAUTH_ENABLED: 'false' }, { EVENTSUB_CALLBACK_URL: '' }]) {
    await assert.rejects(createRuntime({ ...env, ...change }, { firestoreClient: fakeFirestore() }));
  }
});
test('SDK loading is lazy, configured with exact project, and failure is explicit', async () => {
  let settings;
  await createRuntime(env, { loadSDK: async () => ({ Firestore: class { constructor(input) { settings = input; return fakeFirestore(); } } }) });
  assert.deepEqual(settings, { projectId: PROJECT_ID });
  await assert.rejects(createRuntime(env, { loadSDK: async () => { throw new Error('Synthetic SDK missing'); } }), /SDK missing/);
  const local = await createRuntime({ STATE_STORE: 'memory', OAUTH_ENABLED: 'false', TWITCH_EVENTSUB_SECRET: 'synthetic-webhook-secret' },
    { loadSDK: () => { throw new Error('must not load'); } });
  assert.equal((await local.dispatch({ method: 'GET', path: '/health' })).status, 200);
});
