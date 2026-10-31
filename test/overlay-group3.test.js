import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  overlayOptions,
  overlayArrival,
  localOverlayArrival,
  acceptedOverlayPreview,
  validSnapshot,
  connectOverlay,
} from '../public/overlay-client.js';
import { BOT_COPY, claimVoteCopy } from '../public/ritual-copy.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { overlaySoakOptions } from '../test-support/overlay-soak.js';

test('whole card plate geometry clears central60 without reducing logical text or cropping', async () => {
  const css = await readFile(new URL('../public/overlay.css', import.meta.url), 'utf8');
  const js = await readFile(new URL('../public/overlay.js', import.meta.url), 'utf8');
  assert.match(js, /options\.layout === 'card' \? 32 : 48/);
  assert.match(
    js,
    /Math\.min\(\s*options\.scale \* fit,\s*\(innerHeight \* 0\.2 - safe - fit\) \/ 180\s*,?\s*\)/,
  );
  assert.match(
    css,
    /body\.layout-card\.arrival-takeover \.relic-overlay\s*\{\s*position: fixed;\s*width: 336px;\s*height: 720px;/,
  );
  for (const size of [44, 72, 32, 28])
    assert.match(css, new RegExp(`(?:font:|font-size:)[^;]*\\b${size}px`));
  for (const fit of [1, 0.5]) {
    const central = { left: 384 * fit, top: 216 * fit, right: 1536 * fit, bottom: 864 * fit };
    const area = (r) =>
      Math.max(0, Math.min(r.right, central.right) - Math.max(r.left, central.left)) *
      Math.max(0, Math.min(r.bottom, central.bottom) - Math.max(r.top, central.top));
    assert.equal(area({ left: 32 * fit, right: 592 * fit, top: 868 * fit, bottom: 1048 * fit }), 0);
    assert.equal(area({ left: 32 * fit, right: 368 * fit, top: 328 * fit, bottom: 1048 * fit }), 0);
  }
});

test('closed overlay layouts, scale, positions, OBS admission and local preview do not widen server authority', () => {
  assert.deepEqual(overlayOptions(), {
    layout: 'card',
    pos: 'bl',
    scale: 1,
    obs: false,
    preview: false,
  });
  assert.equal(overlayOptions('?corner=1').layout, 'corner');
  for (const layout of ['card', 'full', 'corner'])
    for (const pos of ['bl', 'br', 'tl', 'tr'])
      for (const scale of ['0.75', '1', '1.5'])
        assert.equal(
          overlayOptions(`?layout=${layout}&pos=${pos}&scale=${scale}`).scale,
          Number(scale),
        );
  assert.equal(overlayOptions('', 'OBSStudio/30.0').obs, true);
  assert.equal(overlayOptions('?obs=1').obs, true);
  for (const query of [
    '?layout=no',
    '?scale=.75',
    '?scale=0.749',
    '?scale=1.501',
    '?layout=full&corner=1',
    '?pos=bl&pos=tr',
    '?obs=0',
    '?preview=live',
    '?url=https://other.invalid',
  ])
    assert.throws(() => overlayOptions(query));
  const snapshot = localOverlayArrival('host', 1000);
  assert.ok(validSnapshot(snapshot));
  assert.equal(overlayArrival(snapshot, 1000).command, '!accept');
  assert.equal(
    overlayArrival({ ...snapshot, handoff: { ...snapshot.handoff, role: 'source' } }, 1000).command,
    '!offer',
  );
  assert.equal(overlayArrival(snapshot, 61000).seconds, 120);
  assert.equal(overlayArrival(snapshot, 181000), null);
  assert.equal(
    overlayArrival({ ...snapshot, handoff: { ...snapshot.handoff, completed: true } }, 2000),
    null,
  );
  assert.equal(overlayArrival({ ...snapshot, claimMeter: { awaitingRaid: true } }, 2000), null);
  assert.equal(
    overlayArrival(
      { ...snapshot, handoff: { ...snapshot.handoff, clockPolicy: 'preclaim-v1' } },
      2000,
    ),
    null,
  );
  const parent = {},
    value = {
      origin: 'https://local.invalid',
      source: parent,
      data: { type: 'raid-relic-preview-arrival', role: 'host' },
    };
  assert.ok(acceptedOverlayPreview(value, parent, value.origin));
  for (const bad of [
    { ...value, source: {} },
    { ...value, origin: 'https://other.invalid' },
    { ...value, data: { ...value.data, offers: 99 } },
    { ...value, data: { ...value.data, role: 'admin' } },
  ])
    assert.ok(!acceptedOverlayPreview(bad, parent, value.origin));
});
test('OBS read persistence keeps default human-idle suspension separate and cleans every owned timer', () => {
  for (const persistentRead of [false, true]) {
    const timers = new Map(),
      handlers = {},
      sockets = [];
    let next = 0;
    const events = {
      hidden: false,
      addEventListener: (n, f) => {
        handlers[n] = f;
      },
      removeEventListener: (n) => {
        delete handlers[n];
      },
    };
    class Socket {
      constructor() {
        sockets.push(this);
      }
      close() {
        this.closed = true;
      }
    }
    const stop = connectOverlay({
      url: 'wss://local.invalid',
      render() {},
      status() {},
      persistentRead,
      WebSocketImpl: Socket,
      windowEvents: events,
      documentEvents: events,
      setTimer: (fn, delay) => {
        timers.set(++next, { fn, delay });
        return next;
      },
      clearTimer: (id) => timers.delete(id),
    });
    assert.equal(
      [...timers.values()].some((t) => t.delay === 600000),
      !persistentRead,
    );
    events.hidden = true;
    handlers.visibilitychange();
    assert.equal(Boolean(sockets[0].closed), !persistentRead);
    stop();
    assert.equal(timers.size, 0);
    assert.equal(Object.keys(handlers).length, 0);
  }
  assert.throws(() => overlaySoakOptions(['--mode=obs-wall']));
  assert.equal(
    overlaySoakOptions(['--mode=obs-wall', '--duration-ms=3600000']).durationMs,
    3600000,
  );
});
test('fixed friendly replies have an explicit complete catalog snapshot; vote counts remain truthful', async () => {
  const expected = JSON.parse(
    await readFile(new URL('fixtures/bot-copy.snapshot.json', import.meta.url), 'utf8'),
  );
  assert.ok(Object.hasOwn(expected, 'noMarkWasAddedUse'));
  expected.noMarkWasAddedUse =
    'No mark was added. Use one allowed word or emoji, for example !mark light; not !mark first light. Wait 30 seconds between marks and use at most five marks per stream. Private review text is never public.';
  assert.deepEqual(BOT_COPY, expected);
  assert.ok(Object.values(BOT_COPY).every((text) => text.length <= 500));
  assert.equal(
    claimVoteCopy(
      'offers',
      { from: '101', to: '102', threshold: 2, offers: ['1'], accepts: [], verified: true },
      { 101: 'sample_a', 102: 'sample_b' },
    ),
    'Offers 1/2. Waiting for 1 offer in @sample_a and 2 accepts in @sample_b.',
  );
});
for (const kind of ['memory', 'firestore'])
  test(`${kind}: verified arrival plus successfully delivered sender ACK prompts receiver exactly once through replay/concurrency`, async () => {
    const f = await pilotFixture(kind);
    for (const channel of ['raidrelichq', HOME]) {
      const alias = await f.request(`/overlay?channel=${channel}`, 'GET');
      assert.equal(alias.status, 307);
      assert.equal(alias.headers.location, `/overlay/${HOME}`);
      assert.equal(alias.headers['cache-control'], 'no-store');
    }
    for (const channel of [
      'unknown',
      'https://other.invalid',
      '../control',
      `${HOME}&channel=${HOME}`,
      '%72aidrelichq',
      `${HOME}&layout=full`,
    ])
      assert.equal((await f.request(`/overlay?channel=${channel}`, 'GET')).status, 404);
    assert.equal((await f.request('/overlay?channel=raidrelichq', 'POST')).status, 405);
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      f.streams.get(id).viewer_count = 1;
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    await f.control(HOME, `send:${OTHER}`);
    const replies = () =>
      f.calls.filter((c) => c.url.endsWith('/chat/messages')).map((c) => JSON.parse(c.body));
    assert.equal(replies().length, 0);
    await f.raid();
    assert.equal(replies().length, 0, 'arrival alone cannot precede sender ACK');
    await Promise.all([
      f.chat(HOME, '7101', '!offer', { messageId: 'one-offer' }),
      f.chat(HOME, '7101', '!offer', { messageId: 'one-offer' }),
    ]);
    assert.equal(replies()[0].broadcaster_id, HOME);
    assert.match(replies()[0].message, /Offers 1\/1/);
    assert.deepEqual(
      replies()
        .filter((r) => r.message === BOT_COPY.arrival)
        .map((r) => r.broadcaster_id),
      [OTHER],
    );
    if (kind === 'firestore') await f.restart();
    await f.chat(HOME, '7101', '!offer', { messageId: 'one-offer' });
    await f.raid();
    assert.equal(replies().filter((r) => r.message === BOT_COPY.arrival).length, 1);
    await f.chat(OTHER, '7102', '!accept');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    assert.equal(replies().filter((r) => r.message.startsWith('Claim complete:')).length, 2);
    assert.equal(
      f.calls.filter(
        (c) =>
          c.method === 'POST' &&
          new URL(c.url).origin === 'https://api.twitch.tv' &&
          new URL(c.url).pathname === '/helix/raids',
      ).length,
      1,
    );
  });
for (const kind of ['memory', 'firestore'])
  test(`${kind}: unknown sender ACK delivery cannot trigger a receiving prompt or automatic retry`, async () => {
    const f = await pilotFixture(kind);
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      f.streams.get(id).viewer_count = 1;
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    await f.control(HOME, `send:${OTHER}`);
    await f.raid();
    f.chatFailure('transport');
    await f.chat(HOME, '7201', '!offer', { messageId: 'unknown-offer' });
    f.chatFailure(null);
    await f.chat(HOME, '7201', '!offer', { messageId: 'unknown-offer' });
    const messages = f.calls
      .filter((c) => c.url.endsWith('/chat/messages'))
      .map((c) => JSON.parse(c.body));
    assert.equal(messages.length, 1);
    assert.equal(messages.filter((r) => r.message === BOT_COPY.arrival).length, 0);
  });

test('all parameterized ledger/where/Seeker reply templates have explicit deterministic snapshots', async () => {
  const {
    scoreMessage,
    ownScoreStatus,
    whereReply,
    scoreConsentReply,
    seekerStatusMessage,
    claimComplete,
  } = await import('../public/ritual-copy.js');
  assert.equal(
    whereReply('sample_a', 0),
    '@sample_a holds the relic. Held since: 1970-01-01 00:00:00 UTC. Watch: https://twitch.tv/sample_a · https://raid-relic-760724762396.us-central1.run.app/keeper/sample_a',
  );
  assert.equal(
    scoreConsentReply('sample_a'),
    '@sample_a: public scores on for future completed claims. Anyone can see this name and count. Use !relic scores off to erase them.',
  );
  assert.equal(
    ownScoreStatus({ players: [{ key: 'own', joined: 2 }] }, 'own'),
    'Scores are on for you: 2 recorded raids. !relic scores off to leave.',
  );
  assert.equal(
    claimComplete('sample_a'),
    'Claim complete: the relic transferred to @sample_a; one new ring.',
  );
  const view = {
    channels: [
      {
        channelId: '101',
        login: 'sample_a',
        hopsCarried: 2,
        knownHoldSeconds: 60,
        badges: ['24h Keeper'],
      },
    ],
    raiders: [{ login: 'sample_b', claimsJoined: 1 }],
  };
  assert.equal(
    scoreMessage('top', view, '101'),
    'Recorded Keepers: sample_a: 2 hops, 60s known hold. Opted-in raiders: @sample_b 1. Not all-time history.',
  );
  assert.equal(
    scoreMessage('badges', view, '101'),
    'Keeper badges: 24h Keeper. Retained completed archive only.',
  );
  assert.equal(
    seekerStatusMessage({ member: true, reason: 'holding' }),
    'You hold the relic. Seeker queue off; pass it on before joining again.',
  );
  assert.equal(
    seekerStatusMessage({ member: false, reason: 'needs-rejoin' }),
    'Seeker status: off. Your earlier choice predates a hand-off; type !seek to rejoin.',
  );
  assert.equal(
    seekerStatusMessage({ member: false, reason: 'not-opted-in' }),
    'Seeker status: off. Opt in as a Keeper first, then !seek.',
  );
  assert.equal(
    seekerStatusMessage({ member: true, position: 1, total: 2 }),
    'Seeker status: on. Eligible live suggestion 1 of 2, ordered by viewers then login. !seek off to leave.',
  );
  for (const [reason, text] of Object.entries({
    paused: 'channel paused',
    'offline-or-stale': 'offline or stream not confirmed',
    'policy-blocked': 'channel policy',
    'observations-required': 'live permissions/readiness not confirmed',
  }))
    assert.equal(
      seekerStatusMessage({ member: true, reason }),
      `Seeker status: on. Position not confirmed: ${text}. !seek off to leave.`,
    );
});
test('critical pale ink exceeds7:1 even over the brightest busy-gameplay plate blend', () => {
  const lum = (rgb) =>
    rgb
      .map((c) => {
        c /= 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce((n, c, i) => n + c * [0.2126, 0.7152, 0.0722][i], 0);
  const worst = [16, 29, 48].map((c) => c * 0.86 + 255 * 0.14);
  assert.ok((lum([227, 232, 239]) + 0.05) / (lum(worst) + 0.05) >= 7);
});
for (const kind of ['memory', 'firestore'])
  test(`${kind}: preview HTML has no connection capability, query failures stay closed, API queries remain forbidden`, async () => {
    const f = await pilotFixture(kind);
    const before = await f.runtime.state.getKeeperRegistry();
    const response = await f.request(
      `/overlay/${HOME}?preview=arrival&layout=card&scale=0.75`,
      'GET',
    );
    assert.equal(response.status, 200);
    assert.match(
      response.body.toString(),
      /<p[^>]*id="simulator"[^>]*>LOCAL TEST · fictional arrival · no live connection<\/p>/,
    );
    assert.doesNotMatch(response.body.toString(), /SIMULATOR · local test data/);
    assert.doesNotMatch(response.body.toString(), /data-local-preview-ready/);
    assert.match(response.headers['content-security-policy'], /connect-src 'none'/);
    assert.match(response.headers['content-security-policy'], /frame-ancestors 'self'/);
    assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
    const parent = await f.request('/overlay', 'GET');
    assert.equal(parent.status, 200);
    const parentPolicy = parent.headers['content-security-policy'];
    assert.equal(
      parentPolicy
        .split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('frame-src ')),
      "frame-src 'self'",
    );
    assert.match(parentPolicy, /default-src 'none'/);
    assert.match(parentPolicy, /script-src 'none'/);
    assert.match(parentPolicy, /connect-src 'none'/);
    assert.equal(parent.headers['x-frame-options'], 'DENY');
    for (const path of ['/demo/film', '/demo/judge']) {
      const other = await f.request(path, 'GET');
      assert.equal(other.status, 200);
      assert.match(other.headers['content-security-policy'], /default-src 'none'/);
      assert.doesNotMatch(other.headers['content-security-policy'], /(?:^|;)\s*frame-src\s/);
    }
    const live = await f.request(`/overlay/${HOME}`, 'GET');
    assert.equal(live.status, 200);
    assert.match(live.body.toString(), /SIMULATOR · local test data/);
    assert.doesNotMatch(live.body.toString(), /LOCAL TEST|data-local-preview-ready/);
    assert.doesNotMatch(live.headers?.['content-security-policy'] ?? '', /(?:^|;)\s*frame-src\s/);
    assert.notEqual(live.headers?.['x-frame-options'], 'SAMEORIGIN');
    for (const path of [`/control/${HOME}`, '/auth/callback']) {
      const protectedPage = await f.request(path, 'GET');
      assert.equal(protectedPage.headers['x-frame-options'], 'DENY');
      assert.match(protectedPage.headers['content-security-policy'], /frame-ancestors 'none'/);
      assert.doesNotMatch(
        protectedPage.headers['content-security-policy'],
        /(?:^|;)\s*frame-src\s/,
      );
    }
    assert.equal((await f.request('/overlay?preview=arrival', 'GET')).status, 404);
    assert.equal((await f.request(`/overlay/${HOME}?scale=9`, 'GET')).status, 400);
    assert.equal((await f.request(`/api/overlay/${HOME}?obs=1`, 'GET')).status, 400);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(await f.runtime.state.getKeeperRegistry(), before);
  });

test('local preview readiness follows local render and guarded listener installation only', async () => {
  const source = await readFile(new URL('../public/overlay.js', import.meta.url), 'utf8');
  assert.match(
    source,
    /if \(options\.preview\) \{[\s\S]*?render\(localOverlayArrival\('host', Date\.now\(\)\)\);\s*addEventListener\('message', previewMessage\);[\s\S]*?document\.body\.dataset\.localPreviewReady = 'true'/,
  );
  assert.equal((source.match(/localPreviewReady = 'true'/g) ?? []).length, 1);
  assert.match(source, /delete document\.body\.dataset\.localPreviewReady/);
});

test('opted-in mark share copy snapshots only a synthetic capability URL', async () => {
  const { marksShareReply } = await import('../public/ritual-copy.js');
  assert.equal(
    marksShareReply('sample_a', 2, 'https://local.invalid/my-marks#synthetic'),
    '@sample_a: 2 approved retained entries. PUBLIC CHAT share; anyone can open (10min): https://local.invalid/my-marks#synthetic',
  );
});

test('full and corner preserve historical framing while only card owns the verified takeover', async () => {
  const source = await readFile(new URL('../public/overlay.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../public/overlay.css', import.meta.url), 'utf8');
  assert.match(
    source,
    /const\s+takeover\s*=\s*options\.layout\s*===\s*'card'\s*\?\s*overlayArrival\(\s*current,\s*time\s*\)\s*:\s*null/,
  );
  assert.match(
    source,
    /setProperty\(\s*'--overlay-requested-scale',\s*String\(options\.scale\)\s*,?\s*\)/,
  );
  assert.doesNotMatch(source, /legacyScale|main\.offsetHeight|main\.offsetWidth/);
  assert.match(
    source,
    /options\.layout\s*===\s*'full'\s*&&\s*new\s+URLSearchParams\(location\.search\)\.has\('pos'\)/,
  );
  assert.doesNotMatch(css, /body\.layout-full\s*\{[^}]*padding/);
  assert.match(css, /body\.layout-card\.arrival-takeover\s+\.archive/);
  assert.match(css, /body\.layout-card\.arrival-takeover\s+\.relic-overlay/);
  assert.match(css, /body:not\(\.corner\)\s+\.archive\s*\{\s*width:\s*min\(100%,\s*360px\)/);
  assert.match(css, /body\.layout-full\[data-full-position\]\.pos-bl/);
  assert.match(
    source,
    /Boolean\(\s*options\.layout === 'card'\s*&&\s*current\?\.handoff\?\.clockPolicy\s*===\s*'landing-v2'/,
  );
  assert.match(source, /#command-coach'\)\.hidden\s*=\s*options\.layout !== 'card'/);
  assert.match(
    css,
    /body\.layout-corner\s+\.relic-overlay\s*\{\s*position:\s*fixed;\s*scale:\s*var\(--corner-scale,\s*1\)/,
  );
  assert.doesNotMatch(css, /body\.arrival-takeover(?::not|:is|\s)/);
  assert.match(css, /body\.layout-card\.ring-forged\s+\.archive/);
  // All layouts receive the same authoritative arrival; presentation alone differs.
  const verified = localOverlayArrival('host', 1000);
  for (const layout of ['full', 'card', 'corner']) {
    assert.equal(overlayOptions(`?layout=${layout}`).scale, 1);
    assert.equal(overlayArrival(verified, 2000).seconds, 179);
    assert.equal(overlayArrival({ ...verified, claimMeter: { awaitingRaid: true } }, 2000), null);
  }
});
