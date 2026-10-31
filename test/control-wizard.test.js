import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createControlPoller, controlPollDelay } from '../public/control-read.js';
import {
  setupRetryAllowed,
  readinessLights,
  targetObservationText,
} from '../public/control-view.js';
import { setupReadiness, wizardPrimary } from '../public/onboarding.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

test('current primary transitions keep subscription setup, explicit opt-in and manual OBS confirmation independent', () => {
  const initial = { subscriptions: { ready: false }, optedIn: false };
  const saved = structuredClone(initial);
  assert.deepEqual(wizardPrimary(null), { setup: 'first-bootstrap', overlay: 'first-obs-copy' });
  assert.equal(wizardPrimary(initial).setup, 'first-bootstrap');
  const reconciled = { ...initial, subscriptions: { ready: true } };
  assert.equal(wizardPrimary(reconciled).setup, 'first-keep');
  assert.equal(reconciled.optedIn, false, 'Choosing the next control cannot opt in');
  assert.equal(wizardPrimary(reconciled, { copied: true }).overlay, 'first-obs-check');
  assert.equal(wizardPrimary(reconciled, { copied: false, obs: false }).overlay, 'first-obs-copy');
  assert.equal(wizardPrimary(reconciled, { copied: true, obs: true }).overlay, 'first-obs-copy');
  const opted = { ...reconciled, optedIn: true };
  assert.equal(
    wizardPrimary(opted).setup,
    'first-bootstrap',
    'Already opted in offers only an observation recheck',
  );
  assert.equal(
    wizardPrimary({ ...opted, subscriptions: { ready: false } }).setup,
    'first-bootstrap',
  );
  assert.deepEqual(initial, saved);
  assert.equal(reconciled.optedIn, false);
});

test('readiness fixes map to existing controls with one reason and no invented moderator authority', () => {
  const unknown = readinessLights(null);
  for (const value of Object.values(unknown)) {
    assert.equal(value.fix, 'reconnect');
    assert.match(value.reason, /Sign in first/);
  }
  const pilot = { botGrantStored: false, subscriptions: { ready: false }, online: false };
  const before = structuredClone(pilot);
  const missing = readinessLights(pilot, ['bootstrap']);
  assert.equal(missing.bot.fix, null, 'Missing bot grant needs owner, not extra optional scopes');
  assert.match(missing.bot.reason, /owner.*raidrelicbot/);
  assert.equal(missing.subscriptions.fix, 'first-bootstrap');
  assert.equal(missing.live.fix, 'first-bootstrap');
  assert.match(missing.live.reason, /offline.*requires a live stream/);
  for (const value of Object.values(readinessLights(pilot, []))) assert.equal(value.fix, null);
  const ready = readinessLights(
    { botGrantStored: true, subscriptions: { ready: true }, online: true },
    ['bootstrap'],
  );
  for (const value of Object.values(ready)) {
    assert.equal(value.state, 'ready');
    assert.equal(value.fix, null);
    assert.equal(typeof value.reason, 'string');
  }
  assert.match(ready.bot.reason, /moderator role is not verified/);
  assert.deepEqual(pilot, before, 'Rendering cannot reconcile or mutate channel state');
});

test('target observation age never substitutes status-read age, null or malformed timestamps', () => {
  assert.match(
    targetObservationText({ candidatesObservedAt: null, statusReadAt: 30000 }, 30000),
    /not observed/,
  );
  assert.match(
    targetObservationText({ candidatesObservedAt: 1000, statusReadAt: 31000 }, 31000),
    /30 s ago.*not a fresh Twitch check/,
  );
  assert.match(
    targetObservationText({ candidatesObservedAt: 1000, statusReadAt: 42000 }, 42000),
    /41 s ago/,
  );
  for (const at of [undefined, '1000', NaN, Infinity, -1, 40000])
    assert.match(
      targetObservationText({ candidatesObservedAt: at, statusReadAt: 30000 }, 30000),
      /unavailable.*not provider freshness/,
    );
  assert.match(targetObservationText({ candidatesObservedAt: 0 }, 0), /0 s ago/);
});
function clock() {
  const timers = new Map();
  let id = 0;
  return {
    timers,
    setTimer: (fn, ms) => {
      timers.set(++id, { fn, ms });
      return id;
    },
    clearTimer: (i) => timers.delete(i),
    fire: async () => {
      assert.equal(timers.size, 1);
      const [id, t] = [...timers][0];
      timers.delete(id);
      t.fn();
      await settle();
    },
    delay: () => [...timers.values()][0]?.ms,
  };
}
test('control poller schedules visible pending5s/idle30s, one flight, hidden stop and finite failure backoff', async () => {
  const c = clock();
  let hidden = false,
    pending = true,
    reads = 0;
  const p = createControlPoller({
    ...c,
    hidden: () => hidden,
    pending: () => pending,
    read: async () => {
      reads++;
      return true;
    },
  });
  p.start();
  assert.equal(c.delay(), 0);
  await c.fire();
  assert.equal(reads, 1);
  assert.equal(c.delay(), 5000);
  pending = false;
  await c.fire();
  assert.equal(reads, 2);
  assert.equal(c.delay(), 30000);
  hidden = true;
  p.visibility();
  await settle();
  assert.equal(c.timers.size, 0);
  hidden = false;
  p.visibility();
  await settle();
  assert.equal(c.delay(), 0);
  await c.fire();
  assert.equal(reads, 3);
  p.stop();
  assert.equal(c.timers.size, 0);
  assert.equal(controlPollDelay(true, 1), 10000);
  assert.equal(controlPollDelay(true, 2), 20000);
  assert.equal(controlPollDelay(false, 100), 60000);
  const fail = clock();
  const f = createControlPoller({ ...fail, read: async () => false });
  f.start();
  await fail.fire();
  assert.equal(fail.delay(), 10000);
  await fail.fire();
  assert.equal(fail.delay(), 20000);
  f.stop();
});
test('read generations join a real abort before resume and never overlap or schedule after disposal', async () => {
  const c = clock();
  let active = 0,
    max = 0,
    reads = 0,
    signal;
  const p = createControlPoller({
    ...c,
    read: (s) => {
      signal = s;
      reads++;
      active++;
      max = Math.max(max, active);
      return new Promise((resolve) =>
        s.addEventListener(
          'abort',
          () => {
            active--;
            resolve(false);
          },
          { once: true },
        ),
      );
    },
  });
  p.start();
  await c.fire();
  const same = p.request();
  await settle();
  assert.equal(reads, 1);
  await p.pause();
  await same;
  assert.equal(signal.aborted, true);
  assert.equal(active, 0);
  assert.equal(c.timers.size, 0);
  p.resume({ immediate: true });
  await c.fire();
  assert.equal(reads, 2);
  assert.equal(max, 1);
  p.stop();
  await settle();
  assert.equal(active, 0);
  assert.equal(c.timers.size, 0);
});
test('only the explicit finite setup flow can repeat a busy/unverified reconcile, never a send/unknown/failure', () => {
  const options = { remaining: 2, deadline: 45000, now: 5000, visible: true };
  assert.ok(setupRetryAllowed({ status: 'reconciled', ready: false }, options));
  assert.ok(setupRetryAllowed({ status: 'busy' }, options));
  for (const value of [
    { status: 'accepted' },
    { status: 'unknown' },
    { status: 'failed' },
    { status: 'processed' },
    { status: 'reconciled', ready: true },
    null,
  ])
    assert.equal(setupRetryAllowed(value, options), false);
  for (const patch of [
    { remaining: 0 },
    { remaining: 3 },
    { visible: false },
    { now: 45000 },
    { deadline: Infinity },
    { now: -1 },
  ])
    assert.equal(setupRetryAllowed({ status: 'busy' }, { ...options, ...patch }), false);
  const pilot = {
    optedIn: true,
    subscriptions: { ready: true },
    holder: OTHER,
    seekers: { enabled: true },
  };
  const r = setupReadiness(pilot, { own: true, id: HOME, readAt: 1000, now: 31000 });
  assert.equal(r.optedIn, true);
  assert.equal(r.subscriptions, true);
  assert.equal(r.ageSeconds, 30);
});
for (const kind of ['memory', 'firestore'])
  test(`${kind}: visible status reads cannot call providers/rotate grants/renew sessions/change gameplay; explicit Setup still works`, async () => {
    const f = await pilotFixture(kind, {
      extraBotScopes: ['user:read:moderated_channels'],
      chronicleEnv: { SEEKERS_ENABLED: 'true' },
    });
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    const beforeRegistry = await f.runtime.state.getKeeperRegistry();
    const digest = async () =>
      createHash('sha256')
        .update(JSON.stringify(await f.runtime.store.getToken('streamer')))
        .digest('hex');
    const beforeToken = await digest();
    const beforeCalls = f.calls.length;
    let writes = 0;
    for (const name of [
      'acquireJob',
      'finishJob',
      'renewControlSession',
      'acquire',
      'saveToken',
      'createState',
    ]) {
      const original = f.runtime.store[name].bind(f.runtime.store);
      f.runtime.store[name] = async (...args) => {
        writes++;
        return original(...args);
      };
    }
    // Expire both observation cache and the old five-minute renewal threshold.
    f.advance(300001);
    for (let i = 0; i < 3; i++) {
      const response = await f.request(`/control/${HOME}/status`, 'GET', {
        cookie: f.cookies[HOME],
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers['set-cookie'], undefined);
      const v = JSON.parse(response.body);
      assert.equal(v.keeperId, HOME);
      assert.equal(v.pilot.authorization, 'not-checked');
      assert.equal(v.pilot.candidatesObservedAt, null);
      assert.deepEqual(v.pilot.candidates, []);
    }
    assert.equal(f.calls.length, beforeCalls);
    assert.equal(writes, 0);
    assert.equal(await digest(), beforeToken);
    assert.deepEqual(await f.runtime.state.getKeeperRegistry(), beforeRegistry);
    const bad = await f.control(HOME, 'bootstrap', { origin: 'https://evil.invalid' });
    assert.equal(bad.status, 403);
    assert.equal(writes, 0);
    const setup = await f.control(HOME, 'bootstrap');
    assert.equal(setup.status, 200);
    assert.equal(JSON.parse(setup.body).status, 'reconciled');
    assert.ok(writes > 0);
    assert.ok(f.calls.length > beforeCalls);
    const n = f.calls.length;
    const observed = JSON.parse(
      (await f.request(`/control/${HOME}/status`, 'GET', { cookie: f.cookies[HOME] })).body,
    );
    assert.equal(observed.pilot.subscriptions.ready, true);
    assert.equal(f.calls.length, n);
    assert.ok(
      f.calls.every(
        (c) =>
          new URL(c.url).pathname != '/helix/raids' &&
          new URL(c.url).pathname != '/helix/chat/messages',
      ),
    );
  });
test('wizard has four tasks, unique action controls, Advanced-only operator details and local-only iframe', async () => {
  const html = await readFile('public/control.html', 'utf8');
  for (const id of [
    'connect-step',
    'setup-step',
    'overlay-step',
    'send-step',
    'first-bootstrap',
    'first-keep',
    'first-authorize',
    'first-obs-copy',
    'result',
  ])
    assert.equal((html.match(new RegExp(`id="${id}"`, 'g')) ?? []).length, 1);
  assert.ok(html.indexOf('id="control-advanced"') < html.indexOf('P7_BOT_ACTIONS_ENABLED'));
  assert.ok(html.indexOf('id="result"') < html.indexOf('id="first-run"'));
  assert.ok(html.indexOf('id="send-step"') < html.indexOf('id="send-result"'));
  assert.equal((html.match(/id="result"/g) ?? []).length, 1);
  assert.equal((html.match(/id="send-result"/g) ?? []).length, 1);
  assert.match(html, /id="local-overlay-preview"[^>]*hidden/);
  assert.match(html, /id="first-freshness" aria-live="off"/);
  const css = await readFile('public/control.css', 'utf8');
  assert.match(css, /\.wizard-steps > li\s*\{\s*list-style-position:\s*inside;/);
  assert.match(html, /<ol class="wizard-steps">/);
  const js = await readFile('public/first-run.js', 'utf8');
  assert.match(js, /localPreviewReady\s*===\s*'true'/);
  assert.match(
    js,
    /postMessage\(\s*\{\s*type:\s*'raid-relic-preview-arrival',\s*role:\s*'host',?\s*\},\s*location\.origin,?\s*\)/,
  );
  assert.doesNotMatch(js, /10001|\/api\/|WebSocket|localStorage|sessionStorage/);
});

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: explicit target observations stay bounded and fresh without Setup, session renewal or game actions`, async () => {
    const f = await pilotFixture(kind, {
      extraBotScopes: ['user:read:moderated_channels'],
      chronicleEnv: { SEEKERS_ENABLED: 'true' },
    });
    for (const id of [HOME, OTHER]) f.streams.set(id, { ...f.streams.get(id), viewer_count: 5 });
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    const ownStatus = async () => {
      const response = await f.request(`/control/${HOME}/status`, 'GET', {
        cookie: f.cookies[HOME],
      });
      assert.equal(response.status, 200);
      return JSON.parse(response.body);
    };
    const sessionHash = createHash('sha256').update(f.cookies[HOME].split('=')[1]).digest('hex');
    const originalSession = await f.runtime.store.getControlSession(HOME, sessionHash, f.now());
    const originalRegistry = await f.runtime.state.getKeeperRegistry();
    const jobs = await Promise.all([HOME, OTHER].map((id) => f.runtime.store.getJob(id)));
    f.advance(60001);
    const stale = await ownStatus();
    assert.deepEqual(stale.pilot.candidates, []);
    assert.equal(stale.pilot.candidatesObservedAt, null);
    const beforeDenied = f.calls.length;
    assert.equal(
      (await f.control(HOME, 'observe-targets', { origin: 'https://wrong.invalid' })).status,
      403,
    );
    assert.equal((await f.control(HOME, 'observe-targets', {}, { csrf: 'forged' })).status, 403);
    assert.equal(
      (
        await f.request(
          `/control/${HOME}`,
          'POST',
          { origin: 'https://pilot.example', 'content-type': 'application/json' },
          Buffer.from(JSON.stringify({ action: 'observe-targets', csrf: stale.csrf })),
        )
      ).status,
      403,
    );
    assert.equal(f.calls.length, beforeDenied);
    const streamCalls = () =>
      f.calls.filter((call) => new URL(call.url).pathname === '/helix/streams').length;
    const initialStreams = streamCalls();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => f.control(HOME, 'observe-targets')),
    );
    for (const response of results) {
      assert.equal(response.status, 200);
      assert.equal(response.headers['set-cookie'], undefined);
      assert.equal(JSON.parse(response.body).status, 'observed');
    }
    assert.equal(streamCalls(), initialStreams + 1);
    const fresh = await ownStatus();
    assert.deepEqual(
      fresh.pilot.candidates.map((row) => row.id),
      [OTHER],
    );
    assert.equal(fresh.pilot.candidatesObservedAt, f.now());
    const activeStream = f.streams.get(OTHER);
    f.advance(60001);
    let releaseObservation, signalObservation;
    const held = new Promise((resolve) => {
      releaseObservation = resolve;
    });
    const started = new Promise((resolve) => {
      signalObservation = resolve;
    });
    f.hook(async () => {
      signalObservation();
      await held;
    });
    const inFlightObservation = f.control(HOME, 'observe-targets');
    await started;
    const joinedStatus = ownStatus();
    releaseObservation();
    assert.equal((await inFlightObservation).status, 200);
    assert.deepEqual(
      (await joinedStatus).pilot.candidates.map((row) => row.id),
      [OTHER],
    );
    f.hook(undefined);
    for (let i = 0; i < 3; i++) {
      f.advance(60001);
      assert.equal((await f.control(HOME, 'observe-targets')).status, 200);
      assert.deepEqual(
        (await ownStatus()).pilot.candidates.map((row) => row.id),
        [OTHER],
      );
    }
    f.streams.delete(OTHER);
    f.advance(60001);
    await f.control(HOME, 'observe-targets');
    assert.deepEqual(
      (await ownStatus()).pilot.candidates,
      [],
      'provider-offline cannot survive an older live observation',
    );
    f.streams.set(OTHER, activeStream);
    f.advance(60001);
    await f.control(HOME, 'observe-targets');
    assert.deepEqual(
      (await ownStatus()).pilot.candidates.map((row) => row.id),
      [OTHER],
    );
    assert.deepEqual(
      await f.runtime.store.getControlSession(HOME, sessionHash, f.now()),
      originalSession,
    );
    assert.deepEqual(await f.runtime.state.getKeeperRegistry(), originalRegistry);
    assert.deepEqual(
      await Promise.all([HOME, OTHER].map((id) => f.runtime.store.getJob(id))),
      jobs,
    );
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
    assert.equal(
      f.calls.filter((call) =>
        ['/helix/raids', '/helix/chat/messages'].includes(new URL(call.url).pathname),
      ).length,
      0,
    );
    const callsBeforeExpiry = f.calls.length;
    f.advance(originalSession.expiresAt - f.now());
    assert.equal((await f.control(HOME, 'observe-targets', {}, { csrf: fresh.csrf })).status, 403);
    assert.equal(
      (await f.request(`/control/${HOME}/status`, 'GET', { cookie: f.cookies[HOME] })).status,
      401,
    );
    assert.equal(f.calls.length, callsBeforeExpiry);
    await f.login(HOME);
    assert.equal(
      (await f.request(`/control/${HOME}/status`, 'GET', { cookie: f.cookies[HOME] })).status,
      200,
    );
  });
}

test('background control refresh keeps keyed action nodes and reports initial read/action outcomes', async () => {
  const source = await readFile('public/control.js', 'utf8');
  const refresh = source.slice(
    source.indexOf('async function refresh('),
    source.indexOf('const poller ='),
  );
  assert.match(refresh, /if \(!csrf\) disable\(true\)/);
  assert.doesNotMatch(
    refresh,
    /target\.replaceChildren|document\.getElementById\('raid'\)\.replaceChildren/,
  );
  assert.match(source, /const sendButton = document\.createElement\('button'\)/);
  assert.match(refresh, /reconcileTargets\(candidates, selectedTarget\)/);
  assert.match(refresh, /node\.dataset\.controlAction === action/);
  assert.match(refresh, /status\.textContent === 'Reading your session…'/);
  assert.match(source, /sendResult\.textContent = status\.textContent;\s*await poller\.pause\(\)/);
  assert.match(refresh, /sessionRemaining = value\.expiresAt - serverNow/);
});
