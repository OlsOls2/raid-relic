import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createReceiving, keeperNetwork, currentApprovedView } from '../src/receiving.js';
import { keeperCardFilename } from '../public/keeper-card.js';
import { parseMarkCommand, runeSvg } from '../src/marks.js';

const posts = (f) =>
  f.calls.filter((c) => c.url.endsWith('/chat/messages')).map((c) => JSON.parse(c.body));
test('current hold projection is bounded, distinct and fails closed for revoked or inactive contexts', () => {
  const registry = { holderId: HOME },
    lineage = { stops: [{}] };
  const config = { channels: [HOME, OTHER], logins: { raidrelichq: HOME, olsols2: OTHER } };
  const channel = {
    online: true,
    optedIn: true,
    paused: false,
    streamId: 'stream-one',
    blockedUserIds: [],
  };
  const doc = {
    context: {
      streamId: 'stream-one',
      keeperId: HOME,
      holdsRelic: true,
      optedIn: true,
      blockedUserIds: [],
    },
    paused: false,
    blocked: [],
    sessions: [
      {
        streamId: 'stream-one',
        closed: false,
        marks: Array.from({ length: 160 }, (_, i) => ({
          id: 'm' + (i + 1),
          text: 'light',
          userId: String(9000 + i),
          status: 'approved',
        })),
      },
    ],
  };
  const project = (c = channel, d = doc, r = registry) =>
    currentApprovedView(r, { [HOME]: c }, { [HOME]: d }, lineage, config);
  assert.equal(project().approvedCount, 160);
  assert.equal(new Set(project().marks.map((m) => m.id)).size, 160);
  assert.doesNotMatch(JSON.stringify(project()), /userId|9000|stream-one/);
  for (const patch of [
    { online: false },
    { optedIn: false },
    { paused: true },
    { banned: true },
    { streamId: 'another' },
    { blockedUserIds: [HOME] },
  ])
    assert.equal(project({ ...channel, ...patch }), null);
  for (const patch of [
    { paused: true },
    { blocked: [HOME] },
    { context: { ...doc.context, holdsRelic: false } },
    { context: { ...doc.context, optedIn: false } },
    { context: { ...doc.context, keeperId: OTHER } },
  ])
    assert.equal(project(channel, { ...doc, ...patch }), null);
  const closed = structuredClone(doc);
  closed.sessions[0].closed = true;
  assert.equal(project(channel, closed), null);
  const over = structuredClone(doc);
  over.sessions[0].marks.push({ ...over.sessions[0].marks[0], id: 'm161' });
  assert.equal(project(channel, over), null);
  const privateDoc = structuredClone(doc);
  privateDoc.sessions[0].marks[0].status = 'pending';
  privateDoc.sessions[0].marks[1].status = 'rejected';
  privateDoc.blocked.push('9002');
  privateDoc.context.blockedUserIds.push('9003');
  assert.equal(project({ ...channel, blockedUserIds: ['9004'] }, privateDoc).approvedCount, 155);
  assert.equal(project(channel, doc, { holderId: OTHER }), null);
});
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
    // Current-hold approval is public on the live overlay, not a rewrite of the
    // immutable completed ring's source-mark archive.
    await f.chat(OTHER, '7401', '!mark light');
    assert.equal(posts(f).at(-1).message, 'Your mark is public on the relic.');
    const current = JSON.parse((await f.request(`/api/overlay/${OTHER}`)).body.toString());
    assert.equal(current.lineageRings, 1);
    assert.ok(current.marks.some((m) => m.id && m.runeSvg === runeSvg('light')));
    const currentIds = current.marks.map((m) => m.id);
    f.advance(30001);
    await f.chat(OTHER, '7402', '!mark spoiler');
    assert.match(posts(f).at(-1).message, /Waiting for moderator approval.*private/);
    const held = JSON.parse((await f.request(`/api/overlay/${OTHER}`)).body.toString());
    assert.deepEqual(
      held.marks.map((m) => m.id),
      currentIds,
    );
    assert.ok(!JSON.stringify(held).includes('spoiler'));
    const archive = JSON.parse((await f.request('/api/atlas')).body.toString());
    assert.equal(archive.rings, 1);
    assert.equal(archive.stops[0].approvedCount, 1);
    assert.equal(archive.current.login, 'olsols2');
    assert.equal(archive.current.ringCount, 1);
    assert.equal(archive.current.approvedCount, 1);
    assert.deepEqual(
      archive.current.marks.map((m) => m.text),
      ['light'],
    );
    const profile = JSON.parse((await f.request('/api/keeper/olsols2')).body.toString()).profile;
    assert.deepEqual(profile.current, archive.current);
    assert.equal(profile.glyphTotal, 1, 'Arrival archive remains moon only');
    assert.equal(
      JSON.parse((await f.request('/api/keeper/raidrelichq')).body.toString()).profile.current,
      undefined,
    );
    assert.doesNotMatch(JSON.stringify(archive.current), /spoiler|7401|7402|userId|streamId/);
    await f.chat(OTHER, '7403', '!mark first light');
    assert.match(posts(f).at(-1).message, /one allowed word or emoji.*!mark light/);
    assert.deepEqual(
      JSON.parse((await f.request(`/api/overlay/${OTHER}`)).body.toString()).marks.map((m) => m.id),
      currentIds,
    );
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
    await f.chat(OTHER, '7401', '!relic forgetme');
    assert.equal(
      JSON.parse((await f.request('/api/atlas')).body.toString()).current.approvedCount,
      0,
    );
    await f.chat(OTHER, '7404', '!mark star');
    f.advance(10001);
    await f.chat(OTHER, OTHER, '!relic block 7404');
    assert.equal(
      JSON.parse((await f.request('/api/atlas')).body.toString()).current.approvedCount,
      0,
    );
    await f.chat(OTHER, '7405', '!mark dawn');
    await f.control(OTHER, 'pause');
    assert.equal(JSON.parse((await f.request('/api/atlas')).body.toString()).current, null);
    await f.control(OTHER, 'resume');
    assert.deepEqual(
      JSON.parse((await f.request('/api/atlas')).body.toString()).current.marks.map((m) => m.text),
      ['dawn'],
    );
    await f.control(OTHER, 'send:' + HOME);
    f.advance();
    await f.raid(OTHER, HOME, 1);
    await f.chat(OTHER, '7501', '!offer');
    await f.chat(HOME, '7502', '!accept', { messageId: 'return-accept' });
    const moved = JSON.parse((await f.request('/api/atlas')).body.toString());
    assert.equal(moved.rings, 2);
    assert.equal(moved.current.login, 'raidrelichq');
    assert.ok(!moved.current.marks.some((m) => m.text === 'dawn'));
    assert.equal(moved.stops.at(-1).approvedCount, 1);
    assert.equal(
      JSON.parse((await f.request('/api/keeper/olsols2')).body.toString()).profile.current,
      undefined,
    );
    await f.chat(HOME, '7502', '!accept', { messageId: 'return-accept' });
    assert.deepEqual(JSON.parse((await f.request('/api/atlas')).body.toString()), moved);
    await f.chat(OTHER, '7405', '!relic forgetme');
    assert.equal(
      JSON.parse((await f.request('/api/atlas')).body.toString()).stops.at(-1).approvedCount,
      0,
    );
    await f.signed('stream.offline', { broadcaster_user_id: HOME }, HOME);
    assert.equal(JSON.parse((await f.request('/api/atlas')).body.toString()).current, null);
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
    getStreamStatus: (id) => ({ streamId: id === HOME ? '1' : '2' }),
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
  test(`${kind}: manual raid retains full preflight eligibility when an otherwise-ready target leaves the optional Seeker queue`, async () => {
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
    assert.equal(JSON.parse(response.body).status, 'accepted');
    assert.equal(f.calls.filter((c) => c.url.includes('/helix/raids?')).length, 1);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
  });
  test(`${kind}: rejected refresh remains ineligible and own status does not enroll in Seekers`, async () => {
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
    assert.equal(f.calls.filter((c) => c.url.endsWith('/token')).length, saved + 1);
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
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

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: expired access renews through existing grants without consent; own CSRF controls and non-Seeker boundaries remain`, async () => {
    const f = await setup(kind);
    await f.control(OTHER, 'seek-on');
    assert.equal(JSON.parse((await f.control(HOME, 'send:' + OTHER)).body).status, 'accepted');
    await f.raid();
    await f.chat(HOME, '7001', '!offer');
    await f.chat(OTHER, '7002', '!accept');
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, OTHER);
    f.advance(60001);
    f.expire(HOME);
    f.expire(OTHER);
    const initial = f.calls.filter((c) => c.url.endsWith('/token')).length;
    await assert.rejects(() => f.runtime.oauth.validateAccessToken('streamer'));
    await assert.rejects(() => f.runtime.oauth.validateAccessToken('keeper:' + OTHER));
    assert.equal(f.calls.filter((c) => c.url.endsWith('/token')).length, initial);
    assert.deepEqual(
      (await f.runtime.receiving.candidates(OTHER)).map((r) => r.login),
      ['raidrelichq'],
    );
    assert.deepEqual((await f.runtime.receiving.page()).seekers, []); // Holder is dequeued.
    await f.runtime.oauth.accessTokenForKeeper(OTHER); // Maintain its grant on actual use.
    assert.equal(f.calls.filter((c) => c.url.endsWith('/token')).length, initial + 2);
    const before = initial + 2;
    const blocked = await f.request(
      '/control/' + HOME,
      'POST',
      {
        origin: 'https://foreign.example',
        'content-type': 'application/json',
      },
      Buffer.from(JSON.stringify({ action: 'refresh-authorization', csrf: 'wrong' })),
    );
    assert.equal(blocked.status, 403);
    for (const cookie of [f.cookies[HOME], f.cookies[OTHER]]) {
      const denied = await f.request(
        '/control/' + HOME,
        'POST',
        {
          cookie,
          origin: 'https://pilot.example',
          'content-type': 'application/json',
        },
        Buffer.from(JSON.stringify({ action: 'refresh-authorization', csrf: 'wrong' })),
      );
      assert.equal(denied.status, 403);
    }
    assert.equal(f.calls.filter((c) => c.url.endsWith('/token')).length, before);
    const recovered = await f.control(OTHER, 'refresh-authorization');
    assert.equal(recovered.status, 200);
    assert.equal(JSON.parse(recovered.body).authorization, 'ready');
    let refreshes = f.calls.filter((c) => c.url.endsWith('/token')).slice(before);
    assert.equal(refreshes.length, 0); // Already-valid authorization does not rotate again.
    assert.deepEqual((await f.runtime.receiving.page()).seekers, []);
    assert.deepEqual(
      (await f.runtime.receiving.candidates(OTHER)).map((r) => r.login),
      ['raidrelichq'],
    );
    assert.equal((await f.control(HOME, 'refresh-authorization')).status, 200);
    assert.deepEqual(
      (await f.runtime.receiving.candidates(OTHER)).map((r) => r.login),
      ['raidrelichq'],
    );
    assert.ok(!(await f.runtime.receiving.page()).seekers.some((r) => r.login === 'raidrelichq'));
    const calls = f.calls.length;
    await f.runtime.receiving.authorize(OTHER, HOME);
    assert.ok(f.calls.length > calls); // Dispatch revalidates rather than trusting selection.
    const homeSend = await f.control(OTHER, 'send:' + HOME);
    assert.equal(homeSend.status, 200);
    assert.equal(JSON.parse(homeSend.body).status, 'accepted');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1); // No fabricated arrival/binding.
    f.revoke(HOME);
    await assert.rejects(() => f.runtime.receiving.authorize(OTHER, HOME));
    assert.equal(
      JSON.parse((await f.control(HOME, 'refresh-authorization')).body).authorization,
      'needs-reconnect',
    );
  });
}
test('receiving warnings are closed, throttled and logger failure cannot admit a target', async () => {
  let now = 1000;
  const logs = [];
  const service = createReceiving({
    enabled: true,
    now: () => now,
    state: { getReceivingView: () => ({ seekers: [] }), getKeeperCandidates: () => [] },
    oauth: {
      readAccessToken() {
        throw Error('private secret URL body');
      },
    },
    store: {},
    logger: (value) => {
      logs.push(JSON.parse(value));
      throw Error('logger failed');
    },
    transport() {
      throw Error('must not call');
    },
  });
  await service.page();
  await service.page();
  assert.deepEqual(logs, [
    {
      severity: 'WARNING',
      event: 'raid_relic_receiving_unavailable',
      reason: 'bot-grant-unavailable',
      stage: 'observation',
    },
  ]);
  now += 60000;
  await service.page();
  assert.equal(logs.length, 2);
  assert.ok(!JSON.stringify(logs).includes('private'));
});

test('master read-only denies authorization refresh before any grant/provider access', async () => {
  const f = await pilotFixture('memory', {
    chronicleEnv: { P5_PREVIEW_READ_ONLY: 'true', SEEKERS_ENABLED: 'true' },
  });
  const before = f.calls.length;
  const response = await f.request(
    '/control/' + HOME,
    'POST',
    { origin: 'https://pilot.example', 'content-type': 'application/json' },
    Buffer.from(JSON.stringify({ action: 'refresh-authorization', csrf: 'invalid' })),
  );
  assert.equal(response.status, 403);
  assert.equal(f.calls.length, before);
});

test('manual targets prefer opted Seekers even when a non-Seeker has fewer viewers; public queue does not enroll it', async () => {
  const third = '1593561134';
  const keepers = { [HOME]: 'raidrelichq', [OTHER]: 'olsols2', [third]: 'olsols3' };
  const service = createReceiving({
    enabled: true,
    keepers,
    clientId: 'synthetic',
    botId: BOT,
    now: () => 1000,
    state: {
      getReceivingView: () => ({
        seekers: [{ id: OTHER, login: 'olsols2', streamId: '2' }],
        holder: null,
      }),
      getKeeperCandidates: () =>
        [HOME, OTHER].map((id) => ({ id, login: keepers[id], eligible: true })),
      getStreamStatus: (id) => ({ streamId: id === HOME ? '1' : '2' }),
    },
    store: { getToken: () => ({}), getJob: () => ({ ready: true }) },
    oauth: { readAccessToken: () => 'synthetic' },
    transport: async (url) =>
      new URL(url).pathname.endsWith('/streams')
        ? {
            status: 200,
            data: {
              data: [
                { user_id: HOME, id: '1', type: 'live', viewer_count: 1 },
                { user_id: OTHER, id: '2', type: 'live', viewer_count: 100 },
              ],
            },
          }
        : {
            status: 200,
            data: {
              data: [HOME, OTHER].map((broadcaster_id) => ({ broadcaster_id })),
              pagination: {},
            },
          },
  });
  assert.deepEqual(
    (await service.candidates(third)).map((row) => row.login),
    ['olsols2', 'raidrelichq'],
  );
  assert.deepEqual(
    (await service.page()).seekers.map((row) => row.login),
    ['olsols2'],
  );
});

test('async logger rejection is contained without awaiting logging or changing fail-closed eligibility', async () => {
  const logs = [];
  let rejectLog;
  const service = createReceiving({
    enabled: true,
    state: { getReceivingView: () => ({ seekers: [] }), getKeeperCandidates: () => [] },
    oauth: {
      readAccessToken() {
        throw Error('private upstream detail');
      },
    },
    store: {},
    logger: (payload) => {
      logs.push(JSON.parse(payload));
      return new Promise((_, reject) => {
        rejectLog = reject;
      });
    },
  });
  assert.deepEqual((await service.page()).seekers, []);
  assert.equal(logs.length, 1);
  assert.deepEqual(Object.keys(logs[0]).sort(), ['event', 'reason', 'severity', 'stage']);
  assert.equal(logs[0].severity, 'WARNING');
  rejectLog(Error('private logger failure'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual((await service.page()).seekers, []);
  assert.equal(logs.length, 1);
});
