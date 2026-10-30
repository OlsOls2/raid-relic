import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createControl } from '../src/control.js';
import { createMemoryAuthStore, createFirestoreStore } from '../src/store.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';
import { hash } from '../src/crypto.js';
import { validSnapshot } from '../public/overlay-client.js';
import { actionMessage } from '../public/control-view.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: GET never renews; explicit twelve-hour action renewal is throttled, same-secret and denies expired/cross-role/CSRF activity`, async () => {
    const store =
      kind === 'memory' ? createMemoryAuthStore() : createFirestoreStore(fakeFirestore());
    let now = 1792929600000;
    const control = createControl({
      store,
      keeperIds: [HOME, OTHER],
      origin: 'https://local.example',
      secure: true,
      now: () => now,
    });
    control.bindPilot({
      actions: () => ['keep'],
      status: async () => ({}),
      execute: async () => ({ status: 'processed' }),
    });
    const initial = await control.issue(HOME);
    assert.match(initial, /Max-Age=43200; Secure/);
    const cookie = initial.split(';')[0],
      sessionHash = hash(cookie.slice(cookie.indexOf('=') + 1));
    const request = (path, method = 'GET', headers = {}, body = {}) =>
      control.route({
        path,
        method,
        headers: { cookie, ...headers },
        rawBody: Buffer.from(JSON.stringify(body)),
      });
    const first = await request(`/control/${HOME}/status`);
    assert.equal(first.status, 200);
    const value = JSON.parse(first.body);
    const original = await store.getControlSession(HOME, sessionHash, now);
    assert.equal(original.expiresAt, now + 43200000);
    now += 299999;
    await request(`/control/${HOME}/status`);
    assert.deepEqual(await store.getControlSession(HOME, sessionHash, now), original);
    now++;
    const next = await request(`/control/${HOME}/status`);
    assert.equal(next.status, 200);
    assert.equal(JSON.parse(next.body).csrf, value.csrf);
    assert.equal(next.headers['set-cookie'], undefined);
    assert.deepEqual(await store.getControlSession(HOME, sessionHash, now), original);
    const explicit = await request(
      `/control/${HOME}`,
      'POST',
      { origin: 'https://local.example', 'content-type': 'application/json' },
      { action: 'keep', csrf: value.csrf },
    );
    assert.equal(explicit.status, 200);
    assert.match(explicit.headers['set-cookie'], /Max-Age=43200/);
    const renewed = await store.getControlSession(HOME, sessionHash, now);
    assert.equal(renewed.expiresAt, now + 43200000);
    now += 300000;
    assert.equal(
      (
        await request(
          `/control/${HOME}`,
          'POST',
          { origin: 'https://wrong.example', 'content-type': 'application/json' },
          { action: 'keep', csrf: value.csrf },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await request(
          `/control/${HOME}`,
          'POST',
          { origin: 'https://local.example', 'content-type': 'application/json' },
          { action: 'keep', csrf: 'wrong' },
        )
      ).status,
      403,
    );
    assert.equal((await request(`/control/${OTHER}/status`)).status, 401);
    assert.deepEqual(await store.getControlSession(HOME, sessionHash, now), renewed);
    const post = await request(
      `/control/${HOME}`,
      'POST',
      { origin: 'https://local.example', 'content-type': 'application/json' },
      { action: 'keep', csrf: value.csrf },
    );
    assert.equal(post.status, 200);
    assert.match(post.headers['set-cookie'], /Max-Age=43200/);
    const active = await store.getControlSession(HOME, sessionHash, now);
    assert.equal(active.expiresAt, now + 43200000);
    now = active.expiresAt;
    assert.equal((await request(`/control/${HOME}/status`)).status, 401);
    assert.equal(await store.renewControlSession(HOME, sessionHash, active.expiresAt, now), null);
  });
  test(`${kind}: atomic renewal cannot revive logout/replacement/legacy-expired sessions`, async () => {
    const store =
        kind === 'memory' ? createMemoryAuthStore() : createFirestoreStore(fakeFirestore()),
      now = 1792929600000;
    const row = {
      keeperId: HOME,
      role: 'keeper',
      sessionHash: 'old',
      csrfHash: 'csrf',
      expiresAt: now + 1000,
    };
    await store.createControlSession(HOME, row);
    await Promise.all([
      store.renewControlSession(HOME, 'old', row.expiresAt, now),
      store.revokeControlSession(HOME, 'old', now),
    ]);
    assert.equal(await store.getControlSession(HOME, 'old', now), null);
    await store.createControlSession(HOME, row);
    await Promise.all([
      store.renewControlSession(HOME, 'old', row.expiresAt, now),
      store.createControlSession(HOME, { ...row, sessionHash: 'new' }),
    ]);
    assert.equal(await store.getControlSession(HOME, 'old', now), null);
    assert.equal((await store.getControlSession(HOME, 'new', now)).sessionHash, 'new');
    await store.createControlSession(HOME, { ...row, expiresAt: now });
    assert.equal(await store.renewControlSession(HOME, 'old', now, now), null);
    await store.createControlSession(HOME, { ...row, role: 'bot' });
    assert.equal(await store.renewControlSession(HOME, 'old', row.expiresAt, now), null);
    await store.createControlSession(HOME, row);
    assert.equal(await store.renewControlSession(HOME, 'old', row.expiresAt + 1, now), null);
  });
  test(`${kind}: moved-on name requires actual completed transfer; status cached lights do not call providers`, async () => {
    const f = await pilotFixture(kind, { simulator: false });
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    const n = f.calls.length;
    const status = await f.runtime.pilot.status(HOME);
    assert.equal(status.botGrantStored, true);
    assert.equal(f.calls.length, n);
    await f.control(HOME, `send:${OTHER}`);
    assert.equal((await f.runtime.overlayFeeds[HOME].snapshot()).movedToLogin, undefined);
    f.advance();
    await f.raid(HOME, OTHER, 2);
    assert.equal((await f.runtime.overlayFeeds[HOME].snapshot()).movedToLogin, undefined);
    await f.chat(HOME, HOME, '!offer');
    await f.chat(OTHER, OTHER, '!accept');
    const moved = await f.runtime.overlayFeeds[HOME].snapshot();
    assert.equal(moved.status, 'waiting');
    assert.equal(moved.movedToLogin, 'olsols2');
    assert.equal(moved.lineageRings, 1);
    assert.equal(validSnapshot(moved), true);
    assert.equal(validSnapshot({ ...moved, movedToLogin: 'viewer' }), false);
    assert.equal(validSnapshot({ ...moved, status: 'ready' }), false);
    const http = JSON.parse((await f.request(`/api/overlay/${HOME}`)).body);
    assert.equal(http.movedToLogin, 'olsols2');
    await f.chat(HOME, HOME, '!relic pause');
    assert.equal((await f.runtime.overlayFeeds[HOME].snapshot()).movedToLogin, undefined);
  });
}
test('closed human results never echo arbitrary provider text or guess generic forbidden settings', () => {
  const secret = 'synthetic-do-not-display';
  assert.match(
    actionMessage(
      { status: 'blocked', diagnostic: { category: 'incoming-raid-policy', message: secret } },
      'olsols2',
    ),
    /olsols2 raid settings.*minimum account age\/viewers/,
  );
  const generic = actionMessage(
    {
      status: 'blocked',
      diagnostic: { category: 'provider-forbidden', message: secret, nextStep: secret },
    },
    'olsols2',
  );
  assert.ok(!generic.includes('minimum account'));
  assert.ok(!generic.includes(secret));
  assert.ok(
    !actionMessage({ status: secret, message: secret, diagnostic: { category: secret } }).includes(
      secret,
    ),
  );
  assert.match(
    actionMessage({ status: 'accepted' }),
    /Watch the claim meter: if your offer is not counted yet.*Binding needs both chats and a verified arrival/,
  );
});
test('local Cinzel font and licence match reviewed bytes; only two font assets are vendored', async () => {
  for (const [path, digest] of [
    ['public/fonts/Cinzel.ttf', 'f4d83d34d1f6c741193e4acf4b3dff9531e5a67b6aa65228d00a7db72a4e0f34'],
    [
      'public/fonts/OFL-Cinzel.txt',
      'f2b3029aba64c378bf0963b62945eee15e564fe4330b934c8f2eb058282b5e83',
    ],
  ])
    assert.equal(
      createHash('sha256')
        .update(await readFile(path))
        .digest('hex'),
      digest,
    );
  const f = await pilotFixture();
  for (const [path, type] of [
    ['/fonts/Cinzel.ttf', 'font/ttf'],
    ['/fonts/OFL-Cinzel.txt', 'text/plain'],
  ]) {
    const r = await f.request(path);
    assert.equal(r.status, 200);
    assert.ok(r.type.startsWith(type));
  }
  assert.equal((await f.request('/fonts/other.ttf')).status, 404);
});
for (const kind of ['memory', 'firestore'])
  for (const hung of ['renew', 'fallback'])
    for (const method of ['GET', 'POST'])
      test(`${kind}: ${method} whole-activity deadline bounds hung ${hung}; no late cookie/action/session resurrection`, async () => {
        const store =
          kind === 'memory' ? createMemoryAuthStore() : createFirestoreStore(fakeFirestore());
        let time = 1792929600000,
          executed = 0;
        const control = createControl({
          store,
          keeperIds: [HOME],
          origin: 'https://local.example',
          secure: true,
          now: () => time,
          activityTimeoutMs: 5,
        });
        control.bindPilot({
          actions: () => ['keep'],
          status: async () => ({}),
          execute: async () => {
            executed++;
            return { status: 'processed' };
          },
        });
        const cookie = (await control.issue(HOME)).split(';')[0],
          sessionHash = hash(cookie.slice(cookie.indexOf('=') + 1));
        const first = await control.route({
          path: `/control/${HOME}/status`,
          method: 'GET',
          headers: { cookie },
        });
        assert.equal(first.status, 200);
        const csrf = JSON.parse(first.body).csrf;
        const originalGet = store.getControlSession.bind(store),
          originalRenew = store.renewControlSession.bind(store);
        let release,
          gets = 0,
          renews = 0;
        const gate = new Promise((resolve) => {
          release = resolve;
        });
        time += hung === 'renew' ? 300001 : 1000;
        if (hung === 'renew')
          store.renewControlSession = async (...args) => {
            renews++;
            await gate;
            return originalRenew(...args);
          };
        else
          store.getControlSession = async (...args) => {
            gets++;
            if (gets === (method === 'GET' ? 1 : 3)) await gate;
            return originalGet(...args);
          };
        const response = await control.route({
          path: `/control/${HOME}${method === 'GET' ? '/status' : ''}`,
          method,
          headers: { cookie, origin: 'https://local.example', 'content-type': 'application/json' },
          rawBody: Buffer.from(JSON.stringify({ action: 'keep', csrf })),
        });
        assert.equal(response.status, method === 'GET' && hung === 'renew' ? 200 : 403);
        assert.equal(response.headers['set-cookie'], undefined);
        assert.equal(executed, 0);
        assert.equal(await store.revokeControlSession(HOME, sessionHash, time), true);
        release();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(await originalGet(HOME, sessionHash, time), null);
        assert.equal(response.headers['set-cookie'], undefined);
        assert.equal(executed, 0);
        if (hung === 'renew') assert.equal(renews, method === 'GET' ? 0 : 1);
        else assert.equal(gets, method === 'GET' ? 1 : 3);
      });

for (const kind of ['memory', 'firestore'])
  test(`${kind}: aborted renewal cannot extend an otherwise surviving session`, async () => {
    const store =
        kind === 'memory' ? createMemoryAuthStore() : createFirestoreStore(fakeFirestore()),
      now = 1792929600000;
    const row = {
      keeperId: HOME,
      role: 'keeper',
      sessionHash: 'same',
      csrfHash: 'csrf',
      expiresAt: now + 1000,
    };
    await store.createControlSession(HOME, row);
    const controller = new AbortController();
    controller.abort();
    assert.equal(
      await store.renewControlSession(HOME, 'same', row.expiresAt, now, {
        signal: controller.signal,
      }),
      null,
    );
    assert.deepEqual(await store.getControlSession(HOME, 'same', now), row);
  });
