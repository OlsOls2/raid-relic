import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/app.js';
import { connectOverlay } from '../public/overlay-client.js';
import { freshDemo, demoStep } from '../public/demo-state.js';
import { dailyCheck } from '../ops/daily-check.mjs';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
async function setup(kind) {
  const f = await pilotFixture(kind);
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  return f;
}
const posts = (f) =>
  f.calls.filter((c) => c.url.endsWith('/chat/messages')).map((c) => JSON.parse(c.body));
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: public top/badges/help reply in exact nonholder/offline room; no consent, stream ID or gameauthority invented`, async () => {
    const f = await setup(kind);
    for (const host of [HOME, OTHER]) {
      f.advance();
      await f.signed('stream.offline', { broadcaster_user_id: host }, host);
      const before = await f.runtime.state.getStreamStatus(host);
      for (const command of ['!relic top', '!relic badges', '!relic help'])
        await f.chat(host, '811', command);
      const after = await f.runtime.state.getStreamStatus(host);
      assert.equal(after.streamId, null);
      assert.deepEqual(after.closedIds, before.closedIds);
      assert.deepEqual(
        posts(f)
          .slice(-3)
          .map((p) => p.broadcaster_id),
        [host, host, host],
      );
      assert.match(posts(f).at(-3).message, /Recorded Keepers/);
      assert.match(posts(f).at(-2).message, /Keeper badges/);
      await f.chat(host, '812', '!offer');
      assert.match(posts(f).at(-1).message, /No active verified claim/);
    }
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
    assert.equal(JSON.parse((await f.request('/api/scores')).body).raiders.length, 0);
  });
  test(`${kind}: independent commands, one cooldownnotice, exactGUID dedupe, globalreplybudget, erasure always wins`, async () => {
    const f = await setup(kind);
    await f.chat(HOME, '811', '!relic scores on');
    await f.chat(HOME, '811', '!relic top', { messageId: 'jtop' });
    await f.chat(HOME, '811', '!relic badges');
    assert.equal(posts(f).length, 3);
    await f.chat(HOME, '811', '!relic top', { messageId: 'jtop' });
    assert.equal(posts(f).length, 3);
    await f.chat(HOME, '811', '!relic top');
    assert.match(posts(f).at(-1).message, /wait ten seconds/);
    const count = posts(f).length;
    await f.chat(HOME, '811', '!relic top');
    assert.equal(posts(f).length, count);
    for (let i = 0; i < 50; i++) await f.chat(i % 2 ? HOME : OTHER, String(1000 + i), '!relic top');
    assert.ok(posts(f).length <= 40);
    await f.chat(HOME, '811', '!relic scores off');
    assert.equal(JSON.parse((await f.request('/api/scores')).body).raiders.length, 0);
  });
  test(`${kind}: blocked/bot/copied commands never reply; invalid mutable commands don't change game`, async () => {
    const f = await setup(kind);
    await f.runtime.state.setChannelPolicy(
      HOME,
      { banned: false, blockedUserIds: ['811'] },
      f.now(),
    );
    await f.chat(HOME, '811', '!relic top');
    await f.chat(HOME, BOT, '!relic help');
    await f.signed(
      'channel.chat.message',
      {
        broadcaster_user_id: HOME,
        chatter_user_id: '812',
        message_id: 'shared-top',
        source_broadcaster_user_id: OTHER,
        source_message_id: '00000000-0000-4000-8000-000000000001',
        message: { text: '!relic top', fragments: [] },
      },
      HOME,
      { broadcaster_user_id: HOME, user_id: BOT },
    );
    assert.equal(posts(f).length, 0);
    await f.chat(HOME, '812', '!relic approve m1');
    assert.match(posts(f).at(-1).message, /Only this broadcaster/);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
  });
}
test('demo static routes touch no store/OAuth/SDK and deny mutations; cache/CSP scoped to demo only', async () => {
  let touched = 0;
  const trap = new Proxy(
      {},
      {
        get() {
          touched++;
          throw Error();
        },
      },
    ),
    app = createApp({ state: trap, oauth: trap });
  for (const path of [
    '/demo',
    '/demo/',
    '/demo?host=https://untrusted.invalid',
    '/demo.js',
    '/demo-state.js',
    '/demo.css',
    '/ritual-copy.js',
    '/ring-card.js',
  ]) {
    const r = await app.dispatch({ method: 'GET', path });
    assert.equal(r.status, 200);
    assert.match(r.headers['content-security-policy'], /connect-src 'none'/);
    assert.equal(r.headers['cache-control'], 'public, max-age=3600');
    if (path.startsWith('/demo?') || path === '/demo/')
      assert.match(
        String(r.body),
        /SIMULATED DEMO: no Twitch connection; does not affect the real relic\./,
      );
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
    assert.equal((await app.dispatch({ method, path: '/demo' })).status, 405);
  assert.equal(touched, 0);
  const health = JSON.parse((await app.dispatch({ method: 'GET', path: '/health' })).body);
  assert.equal(Object.hasOwn(health, 'liveValidated'), false);
});
test('demo fictional earlyoffer never transfers until fake receipt + distinct hostaccept; boundedrings/reset', () => {
  let s = freshDemo();
  s = demoStep(s, { type: 'send', source: 'demo_keeper_a', target: 'demo_keeper_b' });
  s = demoStep(s, { type: 'offer' });
  s = demoStep(s, { type: 'accept' });
  assert.equal(s.rings, 0);
  assert.equal(s.offer, true);
  assert.equal(s.receiptAt, null);
  s = demoStep(s, { type: 'raid' });
  s = demoStep(s, { type: 'accept' });
  assert.equal(s.rings, 1);
  assert.equal(demoStep(s, { type: 'accept' }).rings, 1);
  assert.deepEqual(demoStep(s, { type: 'reset' }), freshDemo());
  for (let i = 1; i < 16; i++) {
    s = demoStep(s, { type: 'settle' });
    s = demoStep(s, { type: 'send', source: 'demo_keeper_a', target: 'demo_keeper_b' });
    s = demoStep(s, { type: 'raid' });
    s = demoStep(s, { type: 'offer' });
    s = demoStep(s, { type: 'accept' });
  }
  assert.equal(s.rings, 16);
  assert.equal(
    demoStep(demoStep(s, { type: 'settle' }), {
      type: 'send',
      source: 'demo_keeper_a',
      target: 'demo_keeper_b',
    }).rings,
    16,
  );
});
test('demo graph is presentation-only with no network/controller/state imports or real Keeper identities', async () => {
  for (const file of ['public/demo.js', 'public/demo-state.js']) {
    const s = await readFile(file, 'utf8');
    assert.doesNotMatch(
      s,
      /fetch\s*\(|new\s+(?:WebSocket|XMLHttpRequest)|sendBeacon\s*\(|localStorage|sessionStorage|postMessage|serviceWorker|159180|src\/|overlay-client/,
    );
    assert.doesNotMatch(s, /https?:\/\//);
  }
  const html = await readFile('public/demo.html', 'utf8');
  assert.match(html, /SIMULATED DEMO:/);
  assert.doesNotMatch(html, /raidrelichq|olsols2/);
});
test('hidden/idle sockets close immediately, free slots and do not retry until human wake; stale epochs ignored', () => {
  const sockets = [],
    timers = new Map(),
    handlers = {},
    views = [],
    statuses = [];
  let id = 0;
  class Socket {
    constructor() {
      sockets.push(this);
    }
    close() {
      this.onclose?.();
    }
  }
  const events = {
    hidden: true,
    addEventListener(k, v) {
      handlers[k] = v;
    },
    removeEventListener(k) {
      delete handlers[k];
    },
  };
  const stop = connectOverlay({
    url: 'ws://local',
    WebSocketImpl: Socket,
    windowEvents: events,
    documentEvents: events,
    render: (v) => views.push(v),
    status: (v) => statuses.push(v),
    setTimer: (fn, ms) => {
      timers.set(++id, { fn, ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  assert.equal(sockets.length, 0);
  assert.equal(timers.size, 0);
  events.hidden = false;
  handlers.visibilitychange();
  assert.equal(sockets.length, 1);
  const value = {
    type: 'snapshot',
    revision: 1,
    mode: 'live',
    status: 'ready',
    marks: [],
    approvedCount: 0,
    lineageRings: 0,
  };
  sockets[0].onmessage({ data: JSON.stringify(value) });
  const idle = [...timers.values()].find((t) => t.ms === 600000);
  sockets[0].onmessage({ data: '{"type":"heartbeat"}' });
  assert.equal(
    [...timers.values()].find((t) => t.ms === 600000),
    idle,
  );
  idle.fn();
  assert.equal(views.at(-1), null);
  assert.equal(statuses.at(-1), 'suspended');
  assert.equal(timers.size, 0);
  handlers.online({ type: 'online' });
  assert.equal(sockets.length, 1);
  handlers.focus({ type: 'focus', isTrusted: true });
  assert.equal(sockets.length, 2);
  handlers.focus({ type: 'focus', isTrusted: true });
  assert.equal(sockets.length, 2);
  sockets[0].onmessage({ data: JSON.stringify({ ...value, revision: 99 }) });
  assert.equal(views.at(-1), null);
  events.hidden = true;
  handlers.visibilitychange();
  assert.equal(timers.size, 0);
  stop();
  assert.equal(Object.keys(handlers).length, 0);
});
test('read-only dailychecker has exact10 conditions, validates bot only and never refreshes/saves/writes', async () => {
  const config = {
      origin: 'https://local.example',
      callback: 'https://local.example/eventsub',
      clientId: 'public-client',
      clientSecret: 'synthetic-secret',
      botId: BOT,
      keeperIds: [HOME, OTHER],
      botAccessToken: 'synthetic-existing-token',
    },
    calls = [];
  const request = async (url, o = {}) => {
    calls.push({ url, ...o });
    if (url.endsWith('/health')) return { status: 200, data: { status: 'ok' } };
    if (url.endsWith('/validate'))
      return {
        status: 200,
        data: {
          client_id: config.clientId,
          user_id: BOT,
          expires_in: 60,
          scopes: ['user:read:chat', 'user:write:chat', 'user:bot'],
        },
      };
    if (url.endsWith('/token')) {
      assert.equal(new URLSearchParams(o.body).get('grant_type'), 'client_credentials');
      return { status: 200, data: { access_token: 'synthetic-app' } };
    }
    return {
      status: 200,
      data: {
        data: config.keeperIds
          .flatMap((id) => [
            { type: 'stream.online', condition: { broadcaster_user_id: id } },
            { type: 'stream.offline', condition: { broadcaster_user_id: id } },
            {
              type: 'channel.raid',
              condition: { from_broadcaster_user_id: id, to_broadcaster_user_id: '' },
            },
            { type: 'channel.raid', condition: { to_broadcaster_user_id: id } },
            { type: 'channel.chat.message', condition: { broadcaster_user_id: id, user_id: BOT } },
          ])
          .map((s) => ({
            ...s,
            version: '1',
            status: 'enabled',
            transport: { method: 'webhook', callback: config.callback },
          })),
        pagination: {},
      },
    };
  };
  const r = await dailyCheck(config, request);
  assert.equal(r.status, 'ok');
  assert.equal(calls.length, 4);
  assert.doesNotMatch(JSON.stringify(r), /synthetic|Authorization|token/);
  const denied = await dailyCheck(config, async (url, o) =>
    url.endsWith('/validate') ? { status: 401, data: {} } : request(url, o),
  );
  assert.equal(denied.status, 'attention');
  assert.ok(denied.checks.some((c) => c.status === 'reauth-or-explicit-refresh-required'));
});
test('awaited reply scheduler prioritizes gameplay ahead of queued public reads', async () => {
  const { createBotReplyQueue } = await import('../src/claim-ack.js');
  const run = createBotReplyQueue(),
    order = [];
  let release;
  const first = run(
      () =>
        new Promise((r) => {
          release = r;
        }),
      1,
    ),
    read = run(async () => {
      order.push('read');
    }, 1),
    claim = run(async () => {
      order.push('claim');
    }, 0);
  await Promise.resolve();
  release();
  await Promise.all([first, read, claim]);
  assert.deepEqual(order, ['claim', 'read']);
});

test('demo and real completion share bounded trusted-login presentation copy', async () => {
  const { claimComplete } = await import('../public/ritual-copy.js');
  assert.equal(
    claimComplete('demo_keeper_b'),
    'Claim complete: the relic transferred to @demo_keeper_b; one new ring.',
  );
  assert.equal(
    claimComplete('<script>'),
    'Claim complete: the relic transferred to its new Keeper; one new ring.',
  );
  let s = demoStep(freshDemo(), { type: 'send', source: 'demo_keeper_a', target: 'demo_keeper_b' });
  for (const type of ['offer', 'raid', 'accept']) s = demoStep(s, { type });
  assert.equal(s.notice, claimComplete('demo_keeper_b'));
  const real = await readFile('src/claim-ack.js', 'utf8');
  assert.match(real, /message:\s*claimComplete\(\s*names\[hop\?\.to\]\s*\)/);
});
test('cleanup API array is dry-run preparation only, untagged-only delete plus five-version keep', async () => {
  const rules = JSON.parse(await readFile('ops/artifact-cleanup-dry-run.json', 'utf8'));
  assert.deepEqual(rules, [
    {
      name: 'delete-untagged-14d',
      action: { type: 'Delete' },
      condition: { tagState: 'untagged', packageNamePrefixes: ['app'], olderThan: '14d' },
    },
    {
      name: 'keep-five-recent',
      action: { type: 'Keep' },
      mostRecentVersions: { packageNamePrefixes: ['app'], keepCount: 5 },
    },
  ]);
  const intent = JSON.parse(await readFile('ops/image-retention-policy.json', 'utf8'));
  assert.equal(intent.deletionAuthorized, false);
});

test('35-second demo total and phase guidance are presentation-only; countdown advances', async () => {
  const { DEMO_TOUR_MS, demoProgress } = await import('../public/demo-state.js');
  assert.equal(DEMO_TOUR_MS, 35000);
  let s = demoStep(freshDemo(), { type: 'send', source: 'demo_keeper_a', target: 'demo_keeper_b' });
  assert.match(demoProgress(s), /Step 2\/5/);
  s = demoStep(s, { type: 'advance', ms: 1000 });
  assert.equal(Math.ceil(10 - (s.clock - s.acceptedAt) / 1000), 9);
  for (let i = 0; i < 4; i++) s = demoStep(s, { type: 'advance', ms: 1000 });
  assert.equal(Math.ceil(10 - (s.clock - s.acceptedAt) / 1000), 5);
  assert.equal(s.rings, 0);
  for (const type of ['offer', 'raid', 'accept']) s = demoStep(s, { type });
  assert.match(demoProgress(s), /Step 4\/5/);
  assert.equal(s.rings, 1);
  const { raiderCount } = await import('../public/journey-map.js');
  assert.deepEqual([0, 1, 2].map(raiderCount), ['0 raiders', '1 raider', '2 raiders']);
  for (const file of ['public/atlas.html', 'public/forge.html', 'public/recap.html'])
    assert.doesNotMatch(await readFile(file, 'utf8'), /href="\/control\//);
});

for (const kind of ['memory', 'firestore'])
  test(`${kind}: badge command returns in both issuing live/nonholder and offline rooms without changing holder or consent`, async () => {
    const f = await setup(kind);
    const before = await f.runtime.state.getKeeperRegistry();
    for (const host of [HOME, OTHER])
      for (const offline of [false, true]) {
        if (offline) {
          f.advance();
          await f.signed('stream.offline', { broadcaster_user_id: host }, host);
        }
        const messageId = `badges-${host}-${offline}`;
        const count = posts(f).length,
          logs = [],
          warn = console.warn;
        try {
          console.warn = (line) => logs.push(JSON.parse(line));
          await f.chat(host, '813', '!relic badges', { messageId });
        } finally {
          console.warn = warn;
        }
        assert.ok(
          logs.some(
            (l) =>
              l.event === 'command_reply' &&
              l.kind === 'badges' &&
              l.host === host &&
              l.outcome === 'sent',
          ),
        );
        assert.equal(posts(f).length, count + 1);
        assert.equal(posts(f).at(-1).broadcaster_id, host);
        assert.match(posts(f).at(-1).message, /^Keeper badges:/);
        await f.chat(host, '813', '!relic badges', { messageId });
        assert.equal(posts(f).length, count + 1);
        f.advance(10001);
      }
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, before.holderId);
    assert.equal(JSON.parse((await f.request('/api/scores')).body).raiders.length, 0);
  });
test('demo takeover locks only active tour; completed tour offers replay, favicon reads are pure', async () => {
  const { demoControls } = await import('../public/demo-state.js');
  let s = demoStep(freshDemo(), { type: 'send', source: 'demo_keeper_a', target: 'demo_keeper_b' });
  assert.equal(demoControls(s, { playing: true, tour: true }).locked, true);
  assert.match(demoControls(s, { playing: true, tour: true }).notice, /Press Pause to take over/);
  assert.equal(demoControls(s, { playing: false, tour: true }).locked, false);
  for (const type of ['offer', 'raid', 'accept', 'settle']) s = demoStep(s, { type });
  assert.equal(demoControls(s).tourLabel, 'Replay tour');
  assert.equal(demoControls(s).pauseLabel, 'Resume');
  assert.equal(demoControls(s).pauseDisabled, true);
  let touched = 0;
  const trap = new Proxy(
      {},
      {
        get() {
          touched++;
          throw Error();
        },
      },
    ),
    app = createApp({ state: trap, oauth: trap });
  for (const path of ['/favicon.svg', '/favicon.ico']) {
    const r = await app.dispatch({ method: 'GET', path });
    assert.equal(r.status, 200);
    assert.equal(r.type, 'image/svg+xml');
    assert.match(String(r.body), /<svg/);
    assert.equal((await app.dispatch({ method: 'POST', path })).status, 405);
  }
  assert.equal(touched, 0);
});

test('fictional holder/streak and moderation retain quota on veto, reset and known lapse stay local', async () => {
  const { demoHolder, demoControls, demoSendReason } = await import('../public/demo-state.js');
  let s = freshDemo();
  assert.equal(demoHolder(s), null);
  for (const action of [
    { type: 'send', source: 'demo_keeper_a', target: 'demo_keeper_b' },
    { type: 'offer' },
    { type: 'raid' },
    { type: 'accept' },
  ])
    s = demoStep(s, action);
  assert.equal(s.streak, 1);
  assert.equal(demoHolder(s), 'demo_keeper_b');
  s = demoStep(s, { type: 'mark-held' });
  assert.deepEqual(s.marks, [{ text: 'spoiler', approved: false }]);
  s = demoStep(s, { type: 'review-wait' });
  s = demoStep(s, { type: 'mark-clean' });
  assert.equal(s.marks.at(-1).approved, true);
  const used = s.markUsed,
    last = s.markLastAt;
  s = demoStep(s, { type: 'veto' });
  assert.equal(s.marks.length, 1);
  assert.equal(s.markUsed, used);
  assert.equal(s.markLastAt, last);
  s = demoStep(s, { type: 'veto' });
  assert.deepEqual(s.marks, []);
  assert.equal(s.markUsed, used);
  assert.equal(s.markLastAt, last);
  s = demoStep(s, { type: 'settle' });
  assert.equal(demoControls(s).tourLabel, 'Replay tour');
  assert.equal(demoControls(s).pauseDisabled, true);
  s = demoStep(s, { type: 'send', source: 'demo_keeper_b', target: 'demo_keeper_a' });
  assert.match(demoSendReason(s), /unavailable during/);
  s = demoStep(s, { type: 'raid' });
  s = demoStep(s, { type: 'lapse' });
  assert.equal(s.streak, 0);
  assert.equal(s.rings, 1);
  s = demoStep(s, { type: 'reset' });
  assert.equal(s.streak, 0);
  assert.equal(demoHolder(s), null);
  assert.deepEqual(s.marks, []);
});

test('simulated consecutive completed bindings increment once and a demonstrated lapse starts the next at one', () => {
  let s = freshDemo();
  for (let i = 1; i <= 3; i++) {
    s = demoStep(s, { type: 'send', source: 'demo_keeper_a', target: 'demo_keeper_b' });
    for (const type of ['offer', 'raid', 'accept']) s = demoStep(s, { type });
    assert.equal(s.streak, i);
    assert.equal(demoStep(s, { type: 'accept' }).streak, i);
    s = demoStep(s, { type: 'settle' });
  }
  s = demoStep(s, { type: 'send', source: 'demo_keeper_a', target: 'demo_keeper_b' });
  s = demoStep(s, { type: 'raid' });
  s = demoStep(s, { type: 'lapse' });
  assert.equal(s.streak, 0);
  s = demoStep(s, { type: 'send', source: 'demo_keeper_a', target: 'demo_keeper_b' });
  for (const type of ['raid', 'offer', 'accept']) s = demoStep(s, { type });
  assert.equal(s.streak, 1);
  assert.equal(s.rings, 4);
});
