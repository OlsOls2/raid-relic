import test from 'node:test';
import assert from 'node:assert/strict';
import { createCueTracker, createOverlayAudio } from '../public/overlay-audio.js';
import { createOverlayFixture } from '../test-support/overlay-fixture.js';
function snapshot(
  revision,
  hop = null,
  status = hop ? (hop.role === 'host' ? 'incoming' : 'ready') : 'ready',
  time = 1000,
) {
  return {
    type: 'snapshot',
    revision,
    serverNow: time,
    mode: 'live',
    status,
    marks: [],
    approvedCount: 0,
    lineageRings: 0,
    handoff: hop,
  };
}
const hop = (role = 'source', startedAt = 1000, completed = false) => ({
  role,
  startedAt,
  endsAt: startedAt + 90000,
  completed,
  threshold: 1,
  offers: completed ? 1 : 0,
  accepts: completed ? 1 : 0,
});
function fakeAudio({ blocked = false } = {}) {
  const contexts = [],
    oscillators = [],
    gains = [];
  class Audio {
    state = 'suspended';
    currentTime = 10;
    destination = {};
    constructor() {
      contexts.push(this);
    }
    async resume() {
      if (blocked) throw Error('Autoplay denied');
      this.state = 'running';
    }
    async close() {
      this.state = 'closed';
    }
    createOscillator() {
      const o = {
        frequency: {
          setValueAtTime(value) {
            o.hz = value;
          },
        },
        connect() {},
        disconnect() {
          o.disconnected = true;
        },
        start(value) {
          o.startAt = value;
        },
        stop(value) {
          o.stopAt ??= value;
        },
      };
      oscillators.push(o);
      return o;
    }
    createGain() {
      const events = [];
      const g = {
        gain: Object.fromEntries(
          ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime'].map(
            (name) => [name, (value, time) => events.push({ value, time })],
          ),
        ),
        events,
        connect() {},
        disconnect() {
          g.disconnected = true;
        },
      };
      gains.push(g);
      return g;
    }
  }
  return { Audio, contexts, oscillators, gains };
}
test('default/muted sound creates zero contexts and oscillators even if arm/cue is requested', async () => {
  const f = fakeAudio();
  const audio = createOverlayAudio({ AudioContextImpl: f.Audio });
  audio.cue('send');
  assert.equal(await audio.arm(), false);
  await audio.teardown();
  assert.equal(f.contexts.length, 0);
  assert.equal(f.oscillators.length, 0);
});
test('opt-in still needs arm/resume; blocked autoplay never queues later sound', async () => {
  const f = fakeAudio({ blocked: true });
  const audio = createOverlayAudio({ optedIn: true, AudioContextImpl: f.Audio });
  assert.equal(audio.cue('arrival'), false);
  assert.equal(f.contexts.length, 0);
  assert.equal(await audio.arm(), false);
  assert.equal(audio.cue('claim'), false);
  assert.equal(f.oscillators.length, 0);
  assert.equal(f.contexts[0].state, 'closed');
});
test('original gentle cues have distinct frequencies, bounded envelope/duration and clean resource teardown', async () => {
  const f = fakeAudio();
  const audio = createOverlayAudio({ optedIn: true, AudioContextImpl: f.Audio });
  await audio.arm();
  const frequencies = [];
  for (const cue of ['send', 'arrival', 'claim']) {
    assert.equal(audio.cue(cue), true);
    frequencies.push(f.oscillators.at(-1).hz);
  }
  assert.equal(new Set(frequencies).size, 3);
  for (const o of f.oscillators) {
    assert.ok(o.stopAt - o.startAt < 1);
    assert.equal(o.type, 'sine');
  }
  for (const g of f.gains) assert.ok(g.events.every((e) => e.value >= 0 && e.value <= 0.025));
  assert.ok(f.oscillators.slice(0, 4).every((o) => o.disconnected));
  await audio.mute();
  assert.ok(f.oscillators.every((o) => o.disconnected));
  assert.ok(f.gains.every((g) => g.disconnected));
  assert.equal(f.contexts[0].state, 'closed');
  assert.equal(audio.cue('send'), false);
  await audio.arm();
  assert.equal(f.contexts.length, 2);
  await audio.teardown();
});
test('pending arm cannot resurrect sound after mute', async () => {
  const f = fakeAudio();
  let release;
  f.Audio.prototype.resume = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const audio = createOverlayAudio({ optedIn: true, AudioContextImpl: f.Audio });
  const arming = audio.arm();
  await audio.mute();
  release();
  assert.equal(await arming, false);
  assert.equal(audio.cue('send'), false);
});
for (const role of ['source', 'host'])
  test(`${role}: only new verified receipt and genuine completion transitions cue once`, () => {
    const track = createCueTracker();
    assert.equal(track(snapshot(0)), null); // accepted API/ordinary state: no handoff.
    assert.equal(track(snapshot(1, hop(role))), role === 'source' ? 'send' : 'arrival');
    assert.equal(track(snapshot(2, { ...hop(role), offers: 1 })), null);
    assert.equal(track(snapshot(1, hop(role))), null); // stale revision before sound.
    const completed = snapshot(3, hop(role, 1000, true), role === 'source' ? 'waiting' : 'ready');
    assert.equal(track(completed), 'claim');
    assert.equal(track(snapshot(4, completed.handoff, completed.status)), null);
    assert.equal(track(snapshot(5, hop(role))), null);
    assert.equal(track(snapshot(6, completed.handoff, completed.status)), null);
    track(null);
    assert.equal(track(snapshot(0, completed.handoff, completed.status)), null);
  });
test('initial/reconnect, historical, expired, cancelled/offline/paused and invalid snapshots stay quiet', () => {
  const track = createCueTracker();
  assert.equal(track(snapshot(1, hop())), null);
  track(null);
  assert.equal(track(snapshot(0, hop())), null);
  assert.equal(track(snapshot(1, hop('source', 500))), null); // older receipt.
  assert.equal(track(snapshot(2, hop('source', 2000), 'ready', 1000)), null); // future.
  assert.equal(track(snapshot(3, hop('source', 2000), 'paused', 2001)), null);
  assert.equal(track(snapshot(4, hop('source', 2000), 'waiting', 2001)), null);
  assert.equal(track(snapshot(5, hop('host', 2000), 'incoming', 93000)), null);
  assert.equal(track(snapshot(6, null)), null); // cancelled.
  assert.equal(track(snapshot(7, hop('host', 3000), 'incoming', 10000)), null); // historical seek.
  assert.equal(track({ ...snapshot(8), handoff: { bad: true } }), null);
  track(null);
  assert.equal(track(snapshot(0, hop('host', 4000), 'incoming', 4000)), null);
});
test('overlay query whitelist accepts opt-in plus corner in either order; API stays query-free', async (t) => {
  const f = await createOverlayFixture();
  t.after(() => f.close());
  for (const query of ['', '?sound=0', '?sound=1', '?corner=1&sound=1', '?sound=1&corner=1'])
    assert.equal(
      (await f.app.dispatch({ method: 'GET', path: `/overlay/111${query}` })).status,
      200,
    );
  for (const query of [
    '?sound=2',
    '?sound=1&sound=0',
    '?corner=1&corner=1',
    '?x=1',
    '?corner=0',
    '?sound=',
    '?sound=1&x=0',
  ])
    assert.equal(
      (await f.app.dispatch({ method: 'GET', path: `/overlay/111${query}` })).status,
      400,
    );
  assert.equal(
    (await f.app.dispatch({ method: 'GET', path: '/api/overlay/111?sound=1' })).status,
    400,
  );
  assert.equal((await f.app.dispatch({ method: 'GET', path: '/overlay/999?sound=1' })).status, 404);
});
test('pre-gesture cues are dropped, not replayed on arm; unavailable and policy changes cannot revive receipt audio', async () => {
  const f = fakeAudio();
  const audio = createOverlayAudio({ optedIn: true, AudioContextImpl: f.Audio });
  const track = createCueTracker();
  track(snapshot(0));
  assert.equal(audio.cue(track(snapshot(1, hop()))), false);
  await audio.arm();
  assert.equal(track(snapshot(2, hop())), null);
  assert.equal(f.oscillators.length, 0);
  track({ ...snapshot(3), status: 'unavailable' });
  track(snapshot(0, hop()));
  assert.equal(track(snapshot(1, hop('source', 1000, true), 'waiting')), null);
  const next = hop('host', 2000);
  assert.equal(track(snapshot(2, next, 'incoming', 2000)), 'arrival');
  assert.equal(track(snapshot(3, next, 'paused', 2001)), null);
  assert.equal(track(snapshot(4, next, 'incoming', 2002)), null);
  assert.equal(track(snapshot(5, hop('host', 2000, true), 'ready', 2003)), null);
  await audio.teardown();
});
test('unsupported overlay methods preserve 404 without sockets, snapshot reads or query-dependent exceptions', async (t) => {
  const f = await createOverlayFixture();
  t.after(() => f.close());
  f.feed.snapshot = () => {
    assert.fail('Unsupported method must not read snapshot');
  };
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
    for (const path of [
      '/api/overlay/111',
      '/overlay/111',
      '/overlay/111?sound=1&corner=1',
      '/overlay/111?sound=invalid',
      '/api/overlay/111?sound=1',
    ]) {
      assert.equal((await f.app.dispatch({ method, path })).status, 404, `${method} ${path}`);
    }
  }
});
