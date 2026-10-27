import test from 'node:test';
import assert from 'node:assert/strict';
import { setupLinks, setupReadiness, copyOBS, CANONICAL_APP } from '../public/onboarding.js';
import {
  network3Fixture,
  NETWORK3,
  HOME,
  OTHER,
  THIRD,
  BOT,
} from '../test-support/network3-fixture.js';
import { createApp } from '../src/app.js';
test('public setup links use only configured exact accounts and canonical app starts, not provider state URLs', async () => {
  assert.equal(
    setupLinks(THIRD, NETWORK3).connect,
    CANONICAL_APP + '/oauth/keeper/' + THIRD + '/start',
  );
  assert.equal(setupLinks(THIRD, NETWORK3).overlay, CANONICAL_APP + '/overlay/' + THIRD);
  for (const id of ['999', '../1', '__proto__', BOT, null])
    assert.equal(setupLinks(id, NETWORK3), null);
  const writes = [];
  assert.match(
    await copyOBS(setupLinks(THIRD, NETWORK3).overlay, { writeText: async (s) => writes.push(s) }),
    /does not prove OBS/,
  );
  assert.deepEqual(writes, [CANONICAL_APP + '/overlay/' + THIRD]);
  await assert.rejects(() =>
    copyOBS(setupLinks(THIRD, NETWORK3).overlay, {
      writeText: async () => {
        throw Error('denied');
      },
    }),
  );
  for (const url of [
    'https://evil.invalid/overlay/1',
    CANONICAL_APP + '/overlay/1?token=x',
    CANONICAL_APP + '/control/1',
  ])
    await assert.rejects(() =>
      copyOBS(url, { writeText: async () => assert.fail('invalid clipboard write') }),
    );
});
test('readiness distinguishes own fresh session, expiry, manual OBS and holder-excluded queue without fresh-grant claims', () => {
  const pilot = {
    optedIn: true,
    botGrantStored: true,
    subscriptions: { ready: true },
    seekers: { enabled: true, joined: true },
    holder: HOME,
  };
  const opts = { id: THIRD, own: true, readAt: 1000, now: 1001 };
  const r = setupReadiness(pilot, opts);
  assert.equal(r.optedIn, true);
  assert.equal(r.queue, 'joined');
  assert.equal(r.obs, false);
  for (const patch of [{ own: false }, { now: 11001 }, { now: 999 }]) {
    const stale = setupReadiness(pilot, { ...opts, ...patch });
    assert.equal(stale.fresh, false);
    assert.equal(stale.queue, 'unchecked');
    assert.equal(stale.session, false);
  }
  assert.equal(setupReadiness({ ...pilot, holder: THIRD }, opts).queue, 'holding');
  assert.equal(setupReadiness({ ...pilot, optedIn: false }, opts).queue, 'opt-in-first');
  assert.equal(setupReadiness(null, { ...opts, obs: true }).obs, true);
});
test('public start GET/static assets never access sessions or SDK; writes are refused', async () => {
  const trap = new Proxy(
    {},
    {
      get() {
        throw Error('SDK/private read');
      },
    },
  );
  const app = createApp({ state: trap, oauth: trap, previewReadOnly: true });
  for (const path of [
    '/start',
    '/start/',
    '/start.js',
    '/start.css',
    '/onboarding.js',
    '/first-run.js',
  ]) {
    const r = await app.dispatch({ method: 'GET', path });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-security-policy'], /connect-src 'none'/);
    assert.equal((await app.dispatch({ method: 'POST', path })).status, 403);
  }
});
for (const kind of ['memory', 'firestore'])
  test(`${kind}: genuinely fresh configured third account connects with signed own OAuth then explicitly opts in and joins`, async () => {
    const f = await network3Fixture(kind);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.request('/start')).status, 200);
    assert.equal(f.calls.length, 0);
    assert.ok(!(await f.runtime.store.getToken('keeper:' + THIRD)));
    assert.notEqual((await f.runtime.state.getStreamStatus(THIRD))?.optedIn, true);
    assert.ok([401, 403].includes((await f.request('/control/' + THIRD + '/status')).status));
    await f.login(BOT);
    await f.login(HOME);
    await f.control(HOME, 'bootstrap');
    f.advance();
    await f.control(HOME, 'keep');
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
    const holderStatus = JSON.parse(
      (await f.request('/control/' + HOME + '/status', 'GET', { cookie: f.cookies[HOME] })).body,
    );
    assert.equal(
      setupReadiness(holderStatus.pilot, { own: true, id: HOME, readAt: 1000, now: 1001 }).queue,
      'holding',
    );
    assert.equal((await f.control(HOME, 'seek-on')).status, 200);
    assert.notEqual((await f.runtime.state.getStreamStatus(HOME)).seeking, true);

    const start = await f.request('/oauth/keeper/' + THIRD + '/start');
    const state = new URL(start.headers.location).searchParams.get('state');
    assert.equal(
      (
        await f.request('/auth/callback?state=' + state + '&code=' + OTHER, 'GET', {
          cookie: start.headers['set-cookie'].split(';')[0],
        })
      ).status,
      400,
    );
    assert.ok(!(await f.runtime.store.getToken('keeper:' + THIRD)));
    await f.login(THIRD);
    const own = async () =>
      JSON.parse(
        (await f.request('/control/' + THIRD + '/status', 'GET', { cookie: f.cookies[THIRD] }))
          .body,
      );
    let value = await own();
    assert.equal(value.keeperId, THIRD);
    assert.equal(value.pilot.optedIn, false);
    assert.equal(value.pilot.authorization, 'not-checked');
    const obs = setupLinks(THIRD, NETWORK3).overlay;
    assert.equal(obs, CANONICAL_APP + '/overlay/' + THIRD);
    assert.equal((await f.control(THIRD, 'keep', { origin: 'https://evil.invalid' })).status, 403);
    assert.equal(
      (await f.request('/control/' + HOME + '/status', 'GET', { cookie: f.cookies[THIRD] })).status,
      401,
    );
    assert.equal((await f.control(THIRD, 'bootstrap')).status, 200);
    assert.equal(
      f.subscriptions.filter((s) => Object.values(s.condition).includes(THIRD)).length,
      5,
    );
    value = await own();
    assert.equal(value.pilot.optedIn, false);
    assert.equal(value.pilot.seekers.joined, false);
    f.advance();
    assert.equal((await f.control(THIRD, 'keep')).status, 200);
    value = await own();
    assert.equal(value.pilot.optedIn, true);
    assert.equal(value.pilot.seekers.joined, false);
    f.advance();
    assert.equal((await f.control(THIRD, 'seek-on')).status, 200);
    value = await own();
    assert.equal(value.pilot.seekers.joined, true);
    assert.equal(
      setupReadiness(value.pilot, { own: true, id: THIRD, readAt: 1000, now: 1001 }).queue,
      'joined',
    );
    assert.ok(f.calls.every((c) => !c.url.endsWith('/raids') && !c.url.endsWith('/chat/messages')));
    f.revoke(THIRD);
    const subscriptionCount = f.subscriptions.length;
    const failedSetup = await f.control(THIRD, 'bootstrap');
    assert.equal(JSON.parse(failedSetup.body).status, 'failed');
    assert.equal(f.subscriptions.length, subscriptionCount);
    // Cached own-session status is never mislabelled as fresh grant proof.
    assert.equal((await own()).pilot.authorization, 'not-checked');
    f.advance(12 * 3600000 + 1);
    assert.equal(
      (await f.request('/control/' + THIRD + '/status', 'GET', { cookie: f.cookies[THIRD] }))
        .status,
      401,
    );
  });
test('master read-only onboarding guide never bypasses OAuth/control denial', async () => {
  const f = await network3Fixture('memory', {
    chronicleEnv: { P5_PREVIEW_READ_ONLY: 'true', SEEKERS_ENABLED: 'true' },
  });
  assert.equal((await f.request('/start')).status, 200);
  assert.equal((await f.request('/oauth/keeper/' + THIRD + '/start')).status, 403);
  assert.equal((await f.request('/control/' + THIRD, 'POST', {}, Buffer.from('{}'))).status, 403);
  assert.equal(f.calls.length, 0);
});

test('own checklist uses scoped shrink/wrap rules without hiding overflow or truncating content', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile('public/control.css', 'utf8');
  const block = css.slice(css.indexOf('/* Native details content'));
  assert.match(
    block,
    /#first-run\s*\{[^}]*box-sizing:\s*border-box;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;/s,
  );
  assert.match(block, /overflow-wrap:\s*anywhere/);
  assert.match(block, /white-space:\s*normal/);
  assert.doesNotMatch(
    block,
    /overflow(?:-x)?:\s*(?:hidden|clip)|text-overflow:\s*ellipsis|font-size/,
  );
});

test('private control permission/result text wraps completely without clipping or reducing type', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile('public/control.css', 'utf8');
  const block = css.slice(css.indexOf('/* Private status can contain'));
  assert.match(block, /main\s*\{\s*overflow-wrap:\s*anywhere;/);
  assert.match(
    block,
    /main :is\(code, pre\)\s*\{[^}]*white-space:\s*pre-wrap;[^}]*overflow-wrap:\s*anywhere;/s,
  );
  assert.doesNotMatch(
    block,
    /overflow(?:-x)?:\s*(?:hidden|clip)|text-overflow:\s*ellipsis|font-size/,
  );
});
