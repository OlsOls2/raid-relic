import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import WebSocket from 'ws';
import { createOverlayFixture } from '../test-support/overlay-fixture.js';
import { createOverlayFeed } from '../src/overlay-feed.js';
import { createMemoryState } from '../src/state.js';
import { connectOverlay } from '../public/overlay-client.js';

const origin = 'http://127.0.0.1:5191';
function inbox(ws) {
  const messages = [];
  const waiters = [];
  ws.on('message', (bytes) => {
    const value = JSON.parse(bytes);
    if (value.type !== 'snapshot') return;
    if (waiters.length) waiters.shift()(value);
    else messages.push(value);
  });
  return () =>
    messages.length
      ? Promise.resolve(messages.shift())
      : new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Snapshot timeout')), 2000);
          waiters.push((value) => {
            clearTimeout(timer);
            resolve(value);
          });
        });
}
async function socket(t) {
  const ws = new WebSocket(`${origin.replace('http', 'ws')}/ws/111`, { origin });
  const next = inbox(ws);
  t.after(() => ws.terminate());
  await once(ws, 'open');
  return { ws, next };
}
async function local(t, options) {
  const fixture = await createOverlayFixture(options);
  t.after(() => fixture.close());
  try {
    await fixture.listen();
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    t.skip('Sandbox denies loopback listen on fixed 127.0.0.1:5191 (EPERM)');
    return null;
  }
  return fixture;
}
test('public HTTP and real WebSocket deliver safe initial state, signed-event updates, moderation and immediate forget removal', async (t) => {
  const f = await local(t);
  if (!f) return;
  const { next } = await socket(t);
  assert.equal((await next()).status, 'waiting');
  await f.app.marks.setKeeperContext('111', {
    streamId: 'test-explicit-stream',
    keeperId: '111',
    optedIn: true,
    holdsRelic: true,
    blockedUserIds: [],
  });
  assert.equal((await next()).approvedCount, 0);
  const timestamp = new Date().toISOString();
  const id = 'signed-overlay-test';
  const body = JSON.stringify({
    subscription: {
      type: 'channel.chat.message',
      version: '1',
      condition: { broadcaster_user_id: '111', user_id: '222' },
    },
    event: {
      broadcaster_user_id: '111',
      chatter_user_id: '987654321',
      message_id: 'private-message-id',
      badges: [],
      message: { text: '!mark orchid', fragments: [{ type: 'text', text: '!mark orchid' }] },
    },
  });
  const signature = createHmac('sha256', 'synthetic-overlay-test-secret')
    .update(id)
    .update(timestamp)
    .update(body)
    .digest('hex');
  const response = await fetch(`${origin}/eventsub`, {
    method: 'POST',
    body,
    headers: {
      'twitch-eventsub-message-id': id,
      'twitch-eventsub-message-timestamp': timestamp,
      'twitch-eventsub-message-type': 'notification',
      'twitch-eventsub-message-signature': `sha256=${signature}`,
    },
  });
  assert.equal(response.status, 204);
  assert.equal((await next()).marks.length, 0);
  await f.app.marks.approve('111', f.admin, 'm1');
  const approved = await next();
  assert.equal(approved.marks.length, 1);
  const beforeRead = Date.now();
  const snapshot = await (await fetch(`${origin}/api/overlay/111`)).json();
  const afterRead = Date.now();
  const { serverNow: pushedAt, ...pushedState } = approved;
  const { serverNow: readAt, ...readState } = snapshot;
  assert.deepEqual(readState, pushedState); // All committed fields, including revision/privacy.
  assert.ok(Number.isFinite(pushedAt) && Number.isFinite(readAt));
  assert.ok(readAt >= pushedAt && readAt >= beforeRead && readAt <= afterRead);
  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [
    'orchid',
    '987654321',
    'private-message-id',
    'userId',
    'spent',
    'token',
    'cooldown',
  ])
    assert.ok(!serialized.includes(forbidden));
  await f.app.marks.forgetMe('111', { broadcasterId: '111', chatterId: '987654321' });
  const forgotten = await next();
  assert.equal(forgotten.marks.length, 0);
  assert.ok(forgotten.revision > approved.revision);
  await f.app.marks.approve('111', f.admin, 'm1');
  assert.equal((await next()).marks.length, 0);
  for (const path of ['/api/overlay/222', '/overlay/222', '/marks/approve'])
    assert.equal((await fetch(origin + path)).status, 404);
  assert.equal((await fetch(`${origin}/api/overlay/111`, { method: 'POST' })).status, 404);
  assert.match(await (await fetch(`${origin}/overlay/111`)).text(), /0 growth rings/);
});
test('reconnect obtains current snapshot and socket messages cannot mutate state', async (t) => {
  const f = await local(t, { seed: true });
  if (!f) return;
  const { ws, next } = await socket(t);
  assert.equal((await next()).approvedCount, 8);
  const closed = once(ws, 'close');
  ws.send('approve m99');
  assert.equal((await closed)[0], 1008);
  await f.app.marks.vetoLast('111', f.admin);
  const second = await socket(t);
  assert.equal((await second.next()).approvedCount, 7);
});
test('upgrade channel/path/origin and client resource limits are enforced', async (t) => {
  if (!(await local(t, { socketOptions: { maxClients: 1 } }))) return;
  const first = await socket(t);
  await first.next();
  async function rejected(path, requestOrigin) {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:5191${path}`, { origin: requestOrigin });
      ws.on('error', () => {});
      ws.on('unexpected-response', (_req, response) => {
        assert.equal(response.statusCode, 403);
        response.resume();
        ws.terminate();
        resolve();
      });
      ws.on('open', () => {
        ws.terminate();
        reject(new Error('Unexpected upgrade'));
      });
    });
  }
  await rejected('/ws/222', origin);
  await rejected('/ws/111?control=1', origin);
  await rejected('/ws/111', 'https://evil.example');
  await rejected('/ws/111', origin);
});
test('oversized incoming frames and missing heartbeat pong disconnect', async (t) => {
  if (!(await local(t, { socketOptions: { heartbeatMs: 30 } }))) return;
  const { ws, next } = await socket(t);
  await next();
  const closed = once(ws, 'close');
  ws.send('x'.repeat(1025));
  assert.equal((await closed)[0], 1009);
  const silent = new WebSocket('ws://127.0.0.1:5191/ws/111', { origin, autoPong: false });
  silent.on('error', () => {});
  t.after(() => silent.terminate());
  await once(silent, 'open');
  await once(silent, 'close');
});
test('commit/read/publish queue preserves order and failed commits do not publish', async () => {
  const store = createMemoryState();
  const feed = createOverlayFeed(store, '111');
  const received = [];
  const unsubscribe = feed.subscribe((snapshot) => received.push(snapshot));
  await feed.store.setKeeperContext('111', {
    streamId: 'test',
    keeperId: '111',
    optedIn: true,
    holdsRelic: true,
    blockedUserIds: [],
  });
  await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      feed.store.accept({
        id: String(i),
        now: 1000,
        expiresAt: 2000,
        chat: {
          broadcasterId: '111',
          chatterId: String(1000 + i),
          markAction: { type: 'mark', text: 'orchid' },
        },
      }),
    ),
  );
  await feed.store.controlMarks(
    '111',
    { broadcasterId: '111', chatterId: '111' },
    { type: 'approve', markId: 'm1' },
    1000,
  );
  assert.equal(received.at(-1).approvedCount, 1);
  assert.ok(received.every((snapshot, i) => !i || snapshot.revision > received[i - 1].revision));
  const count = received.length;
  await assert.rejects(
    feed.store.controlMarks(
      '111',
      { broadcasterId: '111', chatterId: '999' },
      { type: 'pause', paused: true },
      1000,
    ),
  );
  assert.equal(received.length, count);
  unsubscribe();
});
test('read failures clear public data without exposing exception details', async () => {
  const feed = createOverlayFeed(
    {
      getOverlayState() {
        throw new Error('PRIVATE token');
      },
    },
    '111',
  );
  const snapshot = await feed.snapshot();
  assert.equal(snapshot.status, 'unavailable');
  assert.deepEqual(snapshot.marks, []);
  assert.ok(!JSON.stringify(snapshot).includes('PRIVATE'));
});
test('socket-free signed webhook to committed public feed removes forgotten runes and never projects private fields', async () => {
  const f = await createOverlayFixture();
  const received = [];
  const unsubscribe = f.feed.subscribe((value) => received.push(value));
  try {
    await f.app.marks.setKeeperContext('111', {
      streamId: 'test-explicit',
      keeperId: '111',
      optedIn: true,
      holdsRelic: true,
      blockedUserIds: [],
    });
    const timestamp = new Date().toISOString();
    const id = 'private-signed-test';
    const rawBody = Buffer.from(
      JSON.stringify({
        subscription: {
          type: 'channel.chat.message',
          version: '1',
          condition: { broadcaster_user_id: '111', user_id: '222' },
        },
        event: {
          broadcaster_user_id: '111',
          chatter_user_id: '987654321',
          message_id: id,
          message: { text: '!mark orchid', fragments: [] },
        },
      }),
    );
    const signature = createHmac('sha256', 'synthetic-overlay-test-secret')
      .update(id)
      .update(timestamp)
      .update(rawBody)
      .digest('hex');
    const request = {
      method: 'POST',
      path: '/eventsub',
      rawBody,
      headers: {
        'twitch-eventsub-message-id': id,
        'twitch-eventsub-message-timestamp': timestamp,
        'twitch-eventsub-message-type': 'notification',
        'twitch-eventsub-message-signature': `sha256=${signature}`,
      },
    };
    assert.equal((await f.app.dispatch(request)).status, 204);
    assert.equal(received.at(-1).marks.length, 0);
    await f.app.marks.approve('111', f.admin, 'm1');
    assert.equal(received.at(-1).marks.length, 1);
    await f.app.marks.forgetMe('111', { broadcasterId: '111', chatterId: '987654321' });
    assert.equal(received.at(-1).marks.length, 0);
    await f.app.dispatch(request);
    await f.app.marks.approve('111', f.admin, 'm1');
    assert.equal(received.at(-1).marks.length, 0);
    const projection = await f.app.dispatch({ method: 'GET', path: '/api/overlay/111' });
    assert.equal(projection.status, 200);
    for (const word of ['orchid', '987654321', 'spent', 'cooldowns', 'token', id])
      assert.ok(!JSON.stringify(received).includes(word));
    assert.equal((await f.app.dispatch({ method: 'GET', path: '/api/overlay/222' })).status, 404);
  } finally {
    unsubscribe();
    await f.close();
  }
  const feed = createOverlayFeed(
    { getOverlayState: () => ({ status: 'ready', marks: [], privateToken: 'do-not-project' }) },
    '111',
  );
  assert.ok(!JSON.stringify(await feed.snapshot()).includes('do-not-project'));
});
test('browser connection state ignores older snapshots, clears on loss, reconnects and resets revision on server restart', () => {
  const sockets = [];
  const timers = new Map();
  let timerId = 0;
  const views = [];
  const statuses = [];
  class FakeSocket {
    constructor() {
      sockets.push(this);
    }
    close() {
      this.onclose?.();
    }
  }
  const stop = connectOverlay({
    url: 'ws://local',
    WebSocketImpl: FakeSocket,
    render: (value) => views.push(value),
    status: (value) => statuses.push(value),
    setTimer: (fn, delay) => {
      const id = ++timerId;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
  });
  const value = (revision) => ({
    type: 'snapshot',
    revision,
    mode: 'live',
    status: 'ready',
    marks: [],
    approvedCount: 0,
    lineageRings: 0,
  });
  sockets[0].onopen();
  sockets[0].onmessage({ data: JSON.stringify(value(10)) });
  sockets[0].onmessage({ data: JSON.stringify(value(9)) });
  assert.equal(views.length, 1);
  sockets[0].close();
  assert.equal(views.at(-1), null);
  [...timers.values()].find((timer) => timer.delay === 500).fn();
  assert.equal(sockets.length, 2);
  sockets[1].onmessage({ data: JSON.stringify(value(0)) });
  assert.equal(views.at(-1).revision, 0);
  [...timers.values()].find((timer) => timer.delay === 35000).fn();
  assert.ok(statuses.includes('stale'));
  assert.equal(views.at(-1), null);
  stop();
  assert.ok(statuses.includes('reconnecting'));
});

test('fresh server clock changes across reads while committed snapshot revision/state stays stable', async () => {
  let time = 1000;
  const feed = createOverlayFeed(createMemoryState(), '111', { now: () => time });
  const first = await feed.snapshot();
  time += 3;
  const second = await feed.snapshot();
  const { serverNow: firstTime, ...firstState } = first;
  const { serverNow: secondTime, ...secondState } = second;
  assert.deepEqual(firstState, secondState);
  assert.equal(firstTime, 1000);
  assert.equal(secondTime, 1003);
});

test('five-ring live-shape snapshot accepts canonical WSS Origin only; old tag HTTP stays public without origin expansion', async (t) => {
  const { createServer } = await import('node:http');
  const { attachOverlaySockets } = await import('../src/overlay-sockets.js');
  const { pilotFixture, HOME, OTHER, BOT } = await import('../test-support/pilot-fixture.js');
  const canonical = 'https://raid-relic-760724762396.us-central1.run.app',
    oldTag = 'https://p5-scoreboard---raid-relic-vz4bhnskgq-uc.a.run.app';
  for (const kind of ['memory', 'firestore']) {
    const f = await pilotFixture(kind);
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    for (let i = 0; i < 5; i++) {
      const from = i % 2 ? OTHER : HOME,
        to = i % 2 ? HOME : OTHER;
      await f.control(from, `send:${to}`);
      f.advance();
      await f.raid(from, to, 1);
      await f.chat(from, from, '!offer');
      await f.chat(to, to, '!accept');
      f.advance();
    }
    f.advance(180001);
    await f.signed('stream.offline', { broadcaster_user_id: OTHER }, OTHER);
    const calls = f.calls.length;
    if (f.db) f.db.writes.length = 0;
    const server = createServer(f.runtime.handler),
      sockets = attachOverlaySockets(server, f.runtime.overlayFeeds, { origins: [canonical] });
    let ws;
    try {
      try {
        await new Promise((r, j) => {
          server.once('error', j);
          server.listen(5191, '127.0.0.1', r);
        });
      } catch (error) {
        if (error.code !== 'EPERM') throw error;
        t.skip('Sandbox denies fixed loopback5191 (EPERM)');
        return;
      }
      const http = await (
        await fetch(`${origin}/api/overlay/${OTHER}`, { headers: { Origin: oldTag } })
      ).json();
      assert.equal(http.lineageRings, 5);
      assert.equal(http.status, 'waiting');
      ws = new WebSocket(`ws://127.0.0.1:5191/ws/${OTHER}`, { origin: canonical });
      const next = inbox(ws);
      await once(ws, 'open');
      const pushed = await next();
      assert.equal(pushed.lineageRings, 5);
      assert.equal(pushed.status, 'waiting');
      assert.equal(sockets.clients.size, 1);
      const denied = await new Promise((resolve, reject) => {
        const bad = new WebSocket(`ws://127.0.0.1:5191/ws/${OTHER}`, { origin: oldTag });
        bad.on('error', () => {});
        bad.once('open', () => {
          bad.terminate();
          reject(Error('Wrong Origin accepted'));
        });
        bad.once('unexpected-response', (_req, res) => {
          const status = res.statusCode;
          res.resume();
          bad.terminate();
          resolve(status);
        });
      });
      assert.equal(denied, 403);
      assert.equal(sockets.clients.size, 1);
      assert.equal(f.calls.length, calls);
      if (f.db) assert.equal(f.db.writes.length, 0);
    } finally {
      ws?.terminate();
      sockets.close();
      server.closeAllConnections();
      if (server.listening) await new Promise((r) => server.close(r));
    }
  }
});
