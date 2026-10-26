import test from 'node:test';
import assert from 'node:assert/strict';
import { createOAuth, SCOPES } from '../src/oauth.js';
import { createTokenCipher } from '../src/crypto.js';
import { createMemoryAuthStore, createFirestoreStore } from '../src/store.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';
const encryptionKey = Buffer.alloc(32, 7).toString('base64');
for (const kind of ['memory', 'firestore']) {
  async function fixture(options = {}) {
    const store =
      kind === 'memory' ? createMemoryAuthStore() : createFirestoreStore(fakeFirestore());
    const cipher = createTokenCipher(encryptionKey);
    const context = (role) => 'public-client:' + role + ':' + (role === 'bot' ? '222' : '111');
    for (const role of ['bot', 'streamer']) {
      await store.acquire(role, 'seed', 1000);
      await store.saveToken(
        role,
        cipher.seal(
          { access_token: 'old-' + role, refresh_token: 'refresh-' + role },
          context(role),
        ),
        'seed',
        1000,
      );
      await store.release(role, 'seed');
    }
    let refreshes = 0,
      clock = 1000;
    const transport = async (url, input) => {
      if (url.endsWith('/token')) {
        refreshes++;
        if (options.stealLease) {
          clock += 30001;
          await store.acquire('bot', 'new-owner', clock);
          await store.saveToken(
            'bot',
            cipher.seal({ access_token: 'new-bot', refresh_token: 'winner' }, context('bot')),
            'new-owner',
            clock,
          );
        }
        if (options.refreshStatus) return { status: options.refreshStatus, data: {} };
        if (options.badShape) return { status: 200, data: {} };
        const role = new URLSearchParams(input.body).get('refresh_token').slice(8);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return {
          status: 200,
          data: {
            access_token: 'new-' + role,
            refresh_token: 'rotated-' + role,
            token_type: 'bearer',
          },
        };
      }
      if (options.beforeValidate) await options.beforeValidate();
      const token = input.headers.Authorization.slice(6),
        role = token.endsWith('bot') ? 'bot' : 'streamer';
      if (token.startsWith('old-') && !options.near) return { status: 401, data: {} };
      return {
        status: 200,
        data: {
          client_id: 'public-client',
          user_id: options.wrongIdentity ? '333' : role === 'bot' ? '222' : '111',
          scopes: SCOPES[role],
          expires_in: token.startsWith('old-') ? 120 : 3600,
        },
      };
    };
    const config = {
      store,
      transport,
      encryptionKey,
      clientId: 'public-client',
      clientSecret: 'synthetic',
      streamerId: '111',
      botId: '222',
      redirectUri: 'https://local.example/oauth/callback',
      redirectAllowlist: ['https://local.example/oauth/callback'],
      now: () => clock,
    };
    return {
      oauth: createOAuth(config),
      second: createOAuth(config),
      store,
      cipher,
      context,
      refreshes: () => refreshes,
    };
  }
  test(`${kind}: valid fresh use has zero lease writes and optional P7 failure cannot poison base callers`, async () => {
    const f = await fixture();
    await f.oauth.accessToken('bot');
    let leases = 0,
      releases = 0,
      saves = 0;
    for (const [name, count] of [
      ['acquire', () => leases++],
      ['release', () => releases++],
      ['saveToken', () => saves++],
    ]) {
      const original = f.store[name].bind(f.store);
      f.store[name] = (...args) => {
        count();
        return original(...args);
      };
    }
    const results = await Promise.allSettled([
      f.oauth.accessToken('bot'),
      f.oauth.accessTokenForP7(),
    ]);
    assert.equal(results[0].value, 'new-bot');
    assert.equal(results[1].reason.code, 'permission-unavailable');
    assert.deepEqual([leases, releases, saves], [0, 0, 0]);
    assert.equal(f.refreshes(), 1);
  });
  test(`${kind}: forced renewal joining delayed base validation is honored once`, async () => {
    let release,
      entered,
      hold = false;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const ready = new Promise((resolve) => {
      entered = resolve;
    });
    const f = await fixture({
      beforeValidate: async () => {
        if (hold) {
          hold = false;
          entered();
          await gate;
        }
      },
    });
    await f.oauth.accessToken('bot');
    hold = true;
    const base = f.oauth.accessToken('bot');
    await ready;
    const forced = [
      f.oauth.accessToken('bot', { refresh: true }),
      f.oauth.accessToken('bot', { refresh: true }),
    ];
    release();
    assert.deepEqual(await Promise.all([base, ...forced]), ['new-bot', 'new-bot', 'new-bot']);
    assert.equal(f.refreshes(), 2);
  });
  test(`${kind}: near-expiry and 401 maintenance rotate once per role under concurrent callers and instances`, async () => {
    for (const near of [false, true]) {
      const f = await fixture({ near });
      const values = await Promise.all([
        f.oauth.readAccessToken('bot'),
        f.oauth.accessToken('bot'),
        f.second.accessToken('bot'),
        f.oauth.accessToken('streamer'),
      ]);
      assert.deepEqual(values, ['new-bot', 'new-bot', 'new-bot', 'new-streamer']);
      assert.equal(f.refreshes(), 2);
      assert.equal(await f.oauth.accessToken('bot'), 'new-bot');
      assert.equal(f.refreshes(), 2);
      assert.equal(
        f.cipher.open(await f.store.getToken('bot'), f.context('bot')).refresh_token,
        'rotated-bot',
      );
    }
  });
  test(`${kind}: only refresh 400/401 asks for consent; transient/malformed failures preserve saved pair`, async () => {
    for (const refreshStatus of [400, 401, 429, 500]) {
      const f = await fixture({ refreshStatus });
      const original = await f.store.getToken('bot');
      await assert.rejects(
        f.oauth.accessToken('bot'),
        (error) =>
          error.code ===
          ([400, 401].includes(refreshStatus) ? 'reconsent-required' : 'transient-unavailable'),
      );
      assert.deepEqual(await f.store.getToken('bot'), original);
    }
    const f = await fixture({ badShape: true });
    await assert.rejects(
      f.oauth.accessToken('bot'),
      (error) => error.code === 'transient-unavailable',
    );
    const wrong = await fixture({ near: true, wrongIdentity: true });
    await assert.rejects(wrong.oauth.accessToken('bot'));
    assert.equal(wrong.refreshes(), 0);
  });
  test(`${kind}: expired lease owner cannot overwrite a newer rotated pair`, async () => {
    const f = await fixture({ stealLease: true });
    await assert.rejects(f.oauth.accessToken('bot'), /lease lost/);
    assert.equal(
      f.cipher.open(await f.store.getToken('bot'), f.context('bot')).refresh_token,
      'winner',
    );
  });
  test(`${kind}: an extra-scope waiter cannot use a base-only grant and pure validation never refreshes`, async () => {
    const f = await fixture();
    await assert.rejects(f.oauth.validateAccessToken('bot'));
    assert.equal(f.refreshes(), 0);
    const results = await Promise.allSettled([
      f.oauth.accessToken('bot'),
      f.oauth.readAccessToken('bot', ['user:read:moderated_channels']),
    ]);
    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[0].value, 'new-bot');
    assert.equal(results[1].status, 'rejected');
    assert.equal(results[1].reason.code, 'permission-unavailable');
    assert.equal(f.refreshes(), 1);
    assert.equal(
      f.cipher.open(await f.store.getToken('bot'), f.context('bot')).access_token,
      'new-bot',
    );
  });
}
