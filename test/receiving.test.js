import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createReceiving, keeperNetwork } from '../src/receiving.js';
import { keeperCardFilename } from '../public/keeper-card.js';
import { parseMarkCommand } from '../src/marks.js';

const posts = (f) =>
  f.calls.filter((c) => c.url.endsWith('/chat/messages')).map((c) => JSON.parse(c.body));
async function setup(kind, enabled = true) {
  const f = await pilotFixture(kind, {
    extraBotScopes: ['user:read:moderated_channels'],
    chronicleEnv: {
      SEEKERS_ENABLED: String(enabled),
      MARK_AUTO_APPROVE_ENABLED: 'true',
      MARK_REVIEW_BLOCKLIST: '["spoiler"]',
    },
  });
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) f.streams.get(id).viewer_count = 1;
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  return f;
}
test('bounded operator Keeper mapping and commands do not admit arbitrary callers', () => {
  assert.equal(Object.keys(keeperNetwork()).length, 2);
  assert.throws(() => keeperNetwork({ 1: 'same', 2: 'same' }));
  assert.throws(() => keeperNetwork({ x: 'bad' }));
  assert.throws(() =>
    keeperNetwork(Object.fromEntries([1, 2, 3, 4, 5].map((x) => [String(x), 'k' + x]))),
  );
  for (const text of ['!seek', '!relic seek', '!seek on'])
    assert.deepEqual(parseMarkCommand(text), { type: 'seek-on' });
  assert.deepEqual(parseMarkCommand('!seek off'), { type: 'seek-off' });
  assert.deepEqual(parseMarkCommand('!relic where'), { type: 'where' });
  assert.equal(parseMarkCommand('!seek @someone'), null);
  assert.equal(
    keeperCardFilename(2, 'olsols2', 'vertical'),
    'raid-relic-keeper-olsols2-ring-2-vertical.png',
  );
  for (const v of [
    [0, 'olsols2', 'vertical'],
    [17, 'olsols2', 'vertical'],
    [1, '../bad', 'vertical'],
    [1, 'olsols2', 'square'],
  ])
    assert.throws(() => keeperCardFilename(...v));
});
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: broadcaster-only Seeker consent, CSRF/room isolation, status and duplicate safety`, async () => {
    const f = await setup(kind);
    await f.signed(
      'channel.chat.message',
      {
        broadcaster_user_id: OTHER,
        chatter_user_id: '7001',
        message_id: 'mod-seek',
        badges: [{ set_id: 'moderator', id: '1' }],
        message: { text: '!seek', fragments: [] },
      },
      OTHER,
      { broadcaster_user_id: OTHER, user_id: BOT },
    );
    assert.notEqual((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
    await f.chat(OTHER, OTHER, '!seek', { messageId: 'seek-own' });
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
    await f.chat(OTHER, OTHER, '!seek', { messageId: 'seek-own' });
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
    assert.equal((await f.control(HOME, 'seek-on')).status, 200);
    assert.equal((await f.control(OTHER, 'seek-off')).status, 200);
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, false);
    const before = await f.runtime.state.getStreamStatus(HOME);
    assert.equal(
      (
        await f.request(
          '/control/' + HOME,
          'POST',
          { origin: 'https://other.example', 'content-type': 'application/json' },
          Buffer.from(JSON.stringify({ action: 'seek-off', csrf: 'bad' })),
        )
      ).status,
      403,
    );
    assert.deepEqual(await f.runtime.state.getStreamStatus(HOME), before);
    f.advance();
    await f.control(HOME, 'opt-out');
    assert.equal((await f.runtime.state.getStreamStatus(HOME)).seeking, false);
  });
  test(`${kind}: exact registry spotlight, completed audience/approved glyphs, erasure and own where reply`, async () => {
    const f = await setup(kind, false);
    let v = await f.runtime.state.getReceivingView(f.now());
    assert.equal(v.holder.login, 'raidrelichq');
    assert.equal(v.holder.heldSince, null);
    await f.chat(HOME, '7101', '!mark moon');
    assert.match(posts(f).at(-1).message, /Your mark is public/);
    f.advance(30001);
    await f.chat(HOME, '7102', '!mark spoiler');
    assert.match(posts(f).at(-1).message, /Waiting for moderator approval.*private/);
    assert.doesNotMatch(posts(f).at(-1).message, /spoiler/);
    await f.control(HOME, 'send:' + OTHER);
    f.advance();
    await f.raid(HOME, OTHER, 1);
    await f.chat(HOME, '7201', '!offer');
    await f.chat(OTHER, '7202', '!accept');
    v = await f.runtime.state.getReceivingView(f.now());
    assert.equal(v.holder.login, 'olsols2');
    assert.equal(v.holder.ringCount, 1);
    assert.ok(Number.isSafeInteger(v.holder.heldSince));
    const p = v.profiles.find((r) => r.login === 'olsols2');
    assert.equal(p.received[0].raidAudience, 1);
    assert.deepEqual(
      p.glyphs.map((m) => m.text),
      ['moon'],
    );
    assert.ok(!JSON.stringify(v).includes('spoiler'));
    assert.ok(!JSON.stringify(v).includes('7101'));
    await f.chat(OTHER, '7301', '!where');
    assert.match(
      posts(f).at(-1).message,
      /@olsols2 holds.*Held since: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC.*keeper\/olsols2/,
    );
    assert.doesNotMatch(posts(f).at(-1).message, /\.\d{3}Z/);
    await f.chat(HOME, '7101', '!relic forgetme');
    const writes = f.db?.writes.length;
    v = await f.runtime.state.getReceivingView(f.now());
    if (f.db) assert.equal(f.db.writes.length, writes);
    assert.ok(!JSON.stringify(v).includes('moon'));
    assert.equal((await f.request('/keeper/unknown')).status, 404);
    assert.equal((await f.request('/api/keeper/unknown')).status, 404);
    const calls = f.calls.length;
    await f.runtime.receiving.page();
    assert.equal(f.calls.length, calls, 'gate off has no provider operations');
  });
}

test('one-minute batched observations, deterministic low-viewer ordering, no stale or revoked/modless suggestions', async () => {
  let now = 100000,
    streamGets = 0,
    blocked = false,
    mods = true;
  const raw = {
    enabled: true,
    holder: { login: 'raidrelichq' },
    profiles: [],
    recent: [],
    seekers: [
      { id: OTHER, login: 'olsols2', streamId: '2' },
      { id: HOME, login: 'raidrelichq', streamId: '1' },
    ],
  };
  const state = {
    getReceivingView: () => structuredClone(raw),
    getKeeperCandidates: () => raw.seekers.map((r) => ({ ...r, eligible: true })),
  };
  const service = createReceiving({
    enabled: true,
    state,
    now: () => now,
    botId: BOT,
    clientId: 'synthetic',
    store: { getToken: () => ({}), getJob: () => ({ ready: true }) },
    oauth: {
      readAccessToken: async () => {
        if (blocked) throw Error('closed');
        return 'synthetic';
      },
    },
    transport: async (url) =>
      new URL(url).pathname.endsWith('/streams')
        ? (streamGets++,
          {
            status: 200,
            data: {
              data: [
                { user_id: HOME, id: '1', type: 'live', viewer_count: 12 },
                { user_id: OTHER, id: '2', type: 'live', viewer_count: 2 },
              ],
            },
          })
        : {
            status: 200,
            data: {
              data: mods ? [{ broadcaster_id: HOME }, { broadcaster_id: OTHER }] : [],
              pagination: {},
            },
          },
  });
  assert.deepEqual(
    (await service.page()).seekers.map((r) => r.login),
    ['olsols2', 'raidrelichq'],
  );
  await Promise.all([service.page(), service.page()]);
  assert.equal(streamGets, 1);
  assert.deepEqual(
    (await service.candidates(HOME)).map((r) => r.login),
    ['olsols2'],
  );
  mods = false;
  await assert.rejects(() => service.authorize(HOME, OTHER));
  blocked = true;
  assert.equal((await service.page()).seekers.length, 0);
  now += 60000;
  assert.equal((await service.page()).live, null);
  assert.equal(streamGets, 1, 'invalid token fails before streams GET');
});

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: actual preflight rechecks queue leave before dispatch, gate-off does not require membership`, async () => {
    const f = await setup(kind);
    await f.control(OTHER, 'seek-on');
    f.advance();
    let left = false;
    f.hook(async () => {
      if (!left) {
        left = true;
        f.advance();
        await f.chat(OTHER, OTHER, '!seek off');
      }
    });
    const response = await f.control(HOME, 'send:' + OTHER);
    assert.equal(response.status, 200);
    assert.equal(JSON.parse(response.body).status, 'blocked');
    assert.equal(f.calls.filter((c) => c.url.includes('/helix/raids?')).length, 0);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
  });
  test(`${kind}: missing grants are not refreshed by public reading; own status does not join`, async () => {
    const f = await setup(kind);
    await f.chat(OTHER, OTHER, '!seek status');
    assert.notEqual((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
    await f.control(OTHER, 'seek-on');
    f.revoke(OTHER);
    const saved = f.calls.filter((c) => c.url.endsWith('/token')).length;
    const page = await f.runtime.receiving.page();
    assert.equal(
      page.seekers.some((r) => r.login === 'olsols2'),
      false,
    );
    assert.equal(f.calls.filter((c) => c.url.endsWith('/token')).length, saved);
  });
}

test('receiving pure assets are exact GET-only routes before OAuth/state access', async () => {
  const { createApp } = await import('../src/app.js');
  let touched = 0;
  const trap = new Proxy(
    {},
    {
      get() {
        touched++;
        throw Error('unavailable');
      },
    },
  );
  const app = createApp({ state: trap, oauth: trap });
  for (const path of ['/receiving.js', '/keeper-card.js']) {
    assert.equal((await app.dispatch({ method: 'GET', path })).status, 200);
    assert.equal((await app.dispatch({ method: 'POST', path })).status, 405);
  }
  assert.equal(touched, 0);
});

test('public receiving reads are no-store, bounded and use the existing request budget', async () => {
  const { createApp } = await import('../src/app.js');
  const app = createApp({
    receiving: { page: async () => ({ holder: null, profiles: [], seekers: [] }) },
    publicBudget: { burst: 1, perSecond: 0 },
  });
  const first = await app.dispatch({ method: 'GET', path: '/api/receiving' });
  assert.equal(first.status, 200);
  assert.equal(first.headers['cache-control'], 'no-store');
  assert.equal((await app.dispatch({ method: 'GET', path: '/api/receiving' })).status, 429);
});

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: queue consent races are idempotent, leave wins same-time ties and public reads never write`, async () => {
    const f = await setup(kind);
    await Promise.all([f.control(OTHER, 'seek-on'), f.control(OTHER, 'seek-on')]);
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
    await f.control(OTHER, 'seek-off');
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, false);
    const writes = f.db?.writes.length;
    const first = await f.runtime.state.getReceivingView(f.now());
    const second = await f.runtime.state.getReceivingView(f.now());
    assert.deepEqual(second, first);
    if (f.db) assert.equal(f.db.writes.length, writes);
    assert.ok(!JSON.stringify(first).includes('seekAt'));
  });
}
