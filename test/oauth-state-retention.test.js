import test from 'node:test';
import assert from 'node:assert/strict';
import { hash } from '../src/crypto.js';
import { createOAuth, SCOPES } from '../src/oauth.js';
import {
  createMemoryAuthStore,
  createFirestoreStore,
  oauthStateSlots,
  OAUTH_STATE_LIMITS,
} from '../src/store.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';

const config = {
  clientId: 'public-dummy-client',
  clientSecret: 'dummy-client-secret',
  encryptionKey: Buffer.alloc(32, 9).toString('base64'),
  streamerId: '201',
  botId: '202',
  redirectUri: 'https://local.example/oauth/callback',
  redirectAllowlist: ['https://local.example/oauth/callback'],
};
function fixture(kind) {
  const db = kind === 'firestore' ? fakeFirestore() : null;
  const store = db ? createFirestoreStore(db) : createMemoryAuthStore();
  let now = 1000;
  let calls = 0;
  let exchanges = 0;
  let saves = 0;
  let stateQueryCount = 0;
  const saveToken = store.saveToken;
  store.saveToken = async (...args) => {
    const result = await saveToken(...args);
    saves++;
    return result;
  };
  const oauth = createOAuth({
    ...config,
    store,
    now: () => now,
    transport: async (url) => {
      calls++;
      if (url.endsWith('/token')) exchanges++;
      return url.endsWith('/token')
        ? {
            status: 200,
            data: {
              access_token: 'dummy-access',
              refresh_token: 'dummy-refresh',
              token_type: 'bearer',
            },
          }
        : {
            status: 200,
            data: {
              client_id: config.clientId,
              user_id: '202',
              scopes: SCOPES.bot,
              expires_in: 3600,
            },
          };
    },
  });
  const start = () => oauth.route({ method: 'GET', path: '/oauth/bot/start', headers: {} });
  const login = (response) => ({
    state: new URL(response.headers.location).searchParams.get('state'),
    cookie: response.headers['set-cookie'].split(';')[0],
  });
  const callback = (flow, cookie = flow.cookie, suffix = '') => {
    const path = `/oauth/callback?state=${flow.state}&code=dummy-code${suffix}`;
    stateQueryCount = new URL(path, config.redirectUri).searchParams.getAll('state').length;
    return oauth.route({
      method: 'GET',
      path,
      headers: { cookie },
    });
  };
  return {
    db,
    store,
    oauth,
    start,
    login,
    callback,
    calls: () => calls,
    exchanges: () => exchanges,
    saves: () => saves,
    stateQueryCount: () => stateQueryCount,
    advance: (ms) => {
      now += ms;
    },
  };
}
// Finite deterministic IDs covering every first-choice slot; no provider input.
function representatives() {
  const found = new Map();
  for (let i = 0; i < 16384 && found.size < OAUTH_STATE_LIMITS.slots; i++) {
    const id = hash(`dummy-state-${i}`);
    if (!found.has(oauthStateSlots(id)[0])) found.set(oauthStateSlots(id)[0], id);
  }
  assert.equal(found.size, OAUTH_STATE_LIMITS.slots);
  return [...found.values()];
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: OAuth slots bound retained allocations, deny full starts and safely reuse expiry`, async () => {
    const f = fixture(kind);
    const ids = representatives();
    for (const id of ids)
      assert.equal(
        await f.store.createState(
          id,
          { binding: 'dummy-binding', role: 'bot', expiresAt: 301000 },
          1000,
        ),
        true,
      );
    assert.equal((await f.start()).status, 429);
    assert.equal(f.calls(), 0);
    if (f.db)
      assert.equal([...f.db.docs.keys()].filter((k) => k.startsWith('oauthStates/')).length, 256);
    assert.equal(await f.store.consumeState(ids[0], 'wrong-browser', 1000), null);
    f.advance(300001);
    assert.equal(await f.store.consumeState(ids[0], 'dummy-binding', 301001), null);
    const fresh = await f.start();
    assert.equal(fresh.status, 302);
    const flow = f.login(fresh);
    assert.equal((await f.callback(flow)).status, 200);
    assert.equal((await f.callback(flow)).status, 400);
    assert.equal(await f.store.consumeState(ids[0], 'dummy-binding', 301001), null);
    if (f.db)
      assert.ok([...f.db.docs.keys()].filter((k) => k.startsWith('oauthStates/')).length <= 256);
    // A later expired batch reuses those same physical slots rather than adding documents.
    for (const id of ids)
      assert.equal(
        await f.store.createState(
          id,
          { binding: 'second-binding', role: 'bot', expiresAt: 601002 },
          301002,
        ),
        true,
      );
    if (f.db)
      assert.equal([...f.db.docs.keys()].filter((k) => k.startsWith('oauthStates/')).length, 256);
  });

  test(`${kind}: colliding state hashes cannot overwrite or consume a different live browser/role`, async () => {
    const f = fixture(kind);
    const ids = [];
    let bucket;
    for (let i = 0; i < 16384 && ids.length < 9; i++) {
      const id = hash(`collision-${i}`),
        first = oauthStateSlots(id)[0];
      bucket ??= first;
      if (first === bucket) ids.push(id);
    }
    assert.equal(ids.length, 9);
    for (let i = 0; i < 8; i++)
      assert.equal(
        await f.store.createState(
          ids[i],
          { binding: `browser-${i}`, role: i % 2 ? 'streamer' : 'bot', expiresAt: 301000 },
          1000,
        ),
        true,
      );
    assert.equal(
      await f.store.createState(
        ids[8],
        { binding: 'intruder', role: 'bot', expiresAt: 301000 },
        1000,
      ),
      false,
    );
    assert.equal(
      await f.store.createState(
        ids[0],
        { binding: 'intruder', role: 'streamer', expiresAt: 301000 },
        1000,
      ),
      false,
    );
    assert.equal(await f.store.consumeState(ids[8], 'browser-0', 1000), null);
    assert.equal(await f.store.consumeState(ids[0], 'browser-1', 1000), null);
    const original = await f.store.consumeState(ids[0], 'browser-0', 1000);
    assert.deepEqual(original, { binding: 'browser-0', role: 'bot', expiresAt: 301000 });
    assert.equal(await f.store.consumeState(ids[0], 'browser-0', 1000), null);
    for (let i = 1; i < 8; i++)
      assert.equal(
        (await f.store.consumeState(ids[i], `browser-${i}`, 1000)).role,
        i % 2 ? 'streamer' : 'bot',
      );
  });

  test(`${kind}: actual parallel OAuth callbacks remain browser-bound and one-use`, async () => {
    const f = fixture(kind);
    const [a, b] = (await Promise.all([f.start(), f.start()])).map(f.login);
    assert.notEqual(a.state, b.state);
    assert.equal((await f.callback(a, b.cookie)).status, 400);
    assert.equal(f.calls(), 0);
    assert.equal((await f.callback(a, a.cookie, '&state=duplicate')).status, 400);
    assert.equal(f.stateQueryCount(), 2);
    assert.equal(f.calls(), 0);
    const distinct = await Promise.all([f.callback(a), f.callback(b)]);
    assert.deepEqual(
      distinct.map((r) => r.status),
      [200, 200],
    );
    assert.equal(f.exchanges(), 2);
    assert.equal(f.saves(), 2);
    const contested = f.login(await f.start());
    const raced = await Promise.all([f.callback(contested), f.callback(contested)]);
    assert.deepEqual(raced.map((r) => r.status).sort(), [200, 400]);
    assert.equal(f.exchanges(), 3);
    assert.equal(f.saves(), 3);
    const calls = f.calls();
    assert.equal((await f.callback(a)).status, 400);
    assert.equal(f.calls(), calls);
    const pending = f.login(await f.start());
    f.advance(300001);
    assert.equal((await f.callback(pending)).status, 400);
    assert.equal(f.calls(), calls);
  });

  test(`${kind}: expired colliding state cannot consume a live replacement with the same browser binding`, async () => {
    const f = fixture(kind);
    const old = hash('expired-collision-original');
    let replacement;
    for (let i = 0; i < 16384 && !replacement; i++) {
      const candidate = hash(`replacement-${i}`);
      if (candidate !== old && oauthStateSlots(candidate)[0] === oauthStateSlots(old)[0])
        replacement = candidate;
    }
    assert.ok(replacement);
    assert.equal(
      await f.store.createState(
        old,
        { binding: 'same-browser', role: 'bot', expiresAt: 2000 },
        1000,
      ),
      true,
    );
    assert.equal(
      await f.store.createState(
        replacement,
        { binding: 'same-browser', role: 'bot', expiresAt: 4000 },
        2001,
      ),
      true,
    );
    if (f.db) {
      const slot = f.db.docs.get(`oauthStates/${hash(oauthStateSlots(old)[0])}`);
      assert.equal(slot.stateHash, replacement);
    }
    assert.equal(await f.store.consumeState(old, 'same-browser', 2001), null);
    assert.deepEqual(await f.store.consumeState(replacement, 'same-browser', 2001), {
      binding: 'same-browser',
      role: 'bot',
      expiresAt: 4000,
    });
    assert.equal(await f.store.consumeState(replacement, 'same-browser', 2001), null);
    assert.equal(f.calls(), 0);
  });
}
test('Firestore bounded legacy consume preserves one issued flow without allocating or scanning legacy records', async () => {
  const db = fakeFirestore(),
    store = createFirestoreStore(db);
  db.docs.set(`oauthStates/${hash('legacy-hash')}`, {
    binding: 'browser',
    role: 'bot',
    expiresAt: 2000,
  });
  assert.equal(await store.consumeState('legacy-hash', 'wrong', 1000), null);
  assert.equal((await store.consumeState('legacy-hash', 'browser', 1000)).role, 'bot');
  assert.equal(await store.consumeState('legacy-hash', 'browser', 1000), null);
  assert.ok(db.reads.length <= 3 * (OAUTH_STATE_LIMITS.probes + 1));
});
