import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { createApp, MAX_BODY_BYTES, REPLAY_WINDOW_MS } from '../src/app.js';
import { createMemoryState } from '../src/state.js';

const secret = 'synthetic-unit-test-secret-only';
const time = Date.parse('2026-10-25T12:00:00.000Z');
const raid = { subscription: { type: 'channel.raid', version: '1' }, event: {
  from_broadcaster_user_id: '123', to_broadcaster_user_id: '456', viewers: 12,
} };
function signed({ body = raid, rawBody, id = 'test-event-1', timestamp = new Date(time).toISOString(), type = 'notification' } = {}) {
  const bytes = rawBody ?? Buffer.from(JSON.stringify(body));
  const signature = createHmac('sha256', secret).update(id).update(timestamp).update(bytes).digest('hex');
  return { method: 'POST', path: '/eventsub', rawBody: bytes, headers: {
    'twitch-eventsub-message-id': id, 'twitch-eventsub-message-timestamp': timestamp,
    'twitch-eventsub-message-signature': `sha256=${signature}`, 'twitch-eventsub-message-type': type,
  } };
}
function app(options = {}) { return createApp({ secret, now: () => time, ...options }); }

async function httpResponse(instance, input) {
  const request = Readable.from([input.rawBody]);
  Object.assign(request, { method: input.method, url: input.path, headers: input.headers });
  const response = {
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(...args) { this.endArgs = args; },
  };
  await instance.handler(request, response);
  return response;
}

test('health is available without a webhook secret', async () => {
  const response = await createApp().dispatch({ method: 'GET', path: '/health' });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { status: 'ok', releaseCommit: null, phase: 'foundation', readiness: 'not-ready-for-raids' });
});
test('valid raid starts a local 90-second ritual', async () => {
  const instance = app();
  assert.equal((await instance.dispatch(signed())).status, 204);
  assert.deepEqual(instance.state.getRitual('456'), {
    eventId: 'test-event-1', incomingBroadcasterId: '123', hostBroadcasterId: '456',
    startedAt: time, endsAt: time + 90000,
  });
});
test('HMAC uses original whitespace and bytes', async () => {
  const request = signed({ rawBody: Buffer.from(JSON.stringify(raid, null, 2)) });
  assert.equal((await app().dispatch(request)).status, 204);
  request.rawBody = Buffer.from(JSON.stringify(raid));
  assert.equal((await app().dispatch(request)).status, 403);
});
test('forged and malformed signatures are rejected without state changes', async () => {
  for (const signature of ['sha256=' + '0'.repeat(64), 'sha256=abc', 'sha256=' + 'g'.repeat(64), '', ['sha256=abc']]) {
    const instance = app();
    const request = signed();
    request.headers['twitch-eventsub-message-signature'] = signature;
    assert.equal((await instance.dispatch(request)).status, 403);
    assert.equal(instance.state.getRitual('456'), undefined);
  }
});
test('tampered body, message id and timestamp fail authentication', async () => {
  for (const mutate of [
    req => { req.rawBody = Buffer.from('{}'); },
    req => { req.headers['twitch-eventsub-message-id'] = 'changed'; },
    req => { req.headers['twitch-eventsub-message-timestamp'] = '2026-10-25T11:59:59Z'; },
  ]) {
    const request = signed(); mutate(request);
    assert.equal((await app().dispatch(request)).status, 403);
  }
});
test('stale, future and malformed signed timestamps fail', async () => {
  for (const timestamp of [new Date(time - REPLAY_WINDOW_MS - 1).toISOString(), new Date(time + 1).toISOString(), 'invalid', '2026-10-25']) {
    assert.equal((await app().dispatch(signed({ timestamp }))).status, 403);
  }
  assert.equal((await app().dispatch(signed({ timestamp: new Date(time - REPLAY_WINDOW_MS).toISOString() }))).status, 204);
});
test('duplicate delivery acknowledges without restarting ritual', async () => {
  let clock = time;
  const instance = app({ now: () => clock });
  const request = signed();
  assert.equal((await instance.dispatch(request)).status, 204);
  clock += 5000;
  assert.equal((await instance.dispatch(request)).status, 204);
  assert.equal(instance.state.getRitual('456').startedAt, time);
});
test('concurrent duplicates are accepted once by shared memory state', async () => {
  const memory = createMemoryState();
  let accepted = 0;
  const state = { accept(input) { const outcome = memory.accept(input); if (outcome === 'accepted') accepted++; return outcome; } };
  const instances = [app({ state }), app({ state })];
  const responses = await Promise.all(Array.from({ length: 40 }, (_, i) => instances[i % 2].dispatch(signed())));
  assert.ok(responses.every(response => response.status === 204));
  assert.equal(accepted, 1);
});
test('signed challenge is returned verbatim and retryable, without ritual', async () => {
  const instance = app();
  const request = signed({ type: 'webhook_callback_verification', body: { challenge: 'challenge-text' } });
  for (let i = 0; i < 2; i++) {
    const response = await instance.dispatch(request);
    assert.equal(response.status, 200);
    assert.equal(response.body, 'challenge-text');
    assert.equal(response.type, 'text/plain; charset=utf-8');
  }
  assert.equal(instance.state.getRitual('456'), undefined);
  request.headers['twitch-eventsub-message-signature'] = 'sha256=' + '0'.repeat(64);
  assert.equal((await instance.dispatch(request)).status, 403);
});
for (const challenge of ['challenge-text', 'Relic café · 星 💎\n']) {
  test(`HTTP challenge returns raw UTF-8 text with byte length: ${JSON.stringify(challenge)}`, async () => {
    const response = await httpResponse(app(), signed({
      type: 'webhook_callback_verification', body: { challenge },
    }));
    assert.equal(response.status, 200);
    assert.equal(response.headers['content-type'], 'text/plain; charset=utf-8');
    assert.equal(response.headers['content-length'], Buffer.byteLength(challenge, 'utf8'));
    assert.equal(response.headers['transfer-encoding'], undefined);
    assert.deepEqual(response.endArgs, [challenge]);
    assert.deepEqual(Buffer.from(response.endArgs[0], 'utf8'), Buffer.from(challenge, 'utf8'));
  });
}
test('HTTP 204 acknowledgements omit body and framing for notifications, duplicates and revocations', async () => {
  const instance = app();
  for (const input of [signed(), signed(), signed({
    id: 'revoked', type: 'revocation', body: { subscription: { type: 'channel.raid' } },
  })]) {
    const response = await httpResponse(instance, input);
    assert.equal(response.status, 204);
    assert.deepEqual(response.endArgs, []);
    for (const name of ['content-length', 'transfer-encoding', 'content-type']) {
      assert.equal(Object.hasOwn(response.headers, name), false);
    }
  }
});
test('malformed JSON, invalid UTF-8, invalid schema and missing challenge fail', async () => {
  for (const rawBody of [Buffer.from('{'), Buffer.from([0xff]), Buffer.from('null'), Buffer.from('[]')]) {
    assert.equal((await app().dispatch(signed({ rawBody }))).status, 400);
  }
  for (const body of [{}, { ...raid, event: {} }, { ...raid, event: { ...raid.event, viewers: -1 } }, { subscription: { type: 'other' } }]) {
    assert.equal((await app().dispatch(signed({ body }))).status, 400);
  }
  assert.equal((await app().dispatch(signed({ type: 'webhook_callback_verification', body: {} }))).status, 400);
});
test('oversized signed body rejected before parsing or state mutation', async () => {
  const instance = app();
  assert.equal((await instance.dispatch(signed({ rawBody: Buffer.alloc(MAX_BODY_BYTES + 1, 32) }))).status, 413);
  assert.equal(instance.state.getRitual('456'), undefined);
});
test('HTTP stream adapter enforces body limit across chunks without listening', async () => {
  const request = Readable.from([Buffer.alloc(MAX_BODY_BYTES), Buffer.from('x')]);
  Object.assign(request, { method: 'POST', url: '/eventsub', headers: {} });
  const response = { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  await app().handler(request, response);
  assert.equal(response.status, 413);
});
test('HTTP stream adapter preserves signed raw bytes and handles health', async () => {
  for (const input of [signed(), { method: 'GET', path: '/health', headers: {}, rawBody: Buffer.alloc(0) }]) {
    const request = Readable.from([input.rawBody.subarray(0, 5), input.rawBody.subarray(5)]);
    Object.assign(request, { method: input.method, url: input.path, headers: input.headers });
    const response = { writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
    await app().handler(request, response);
    assert.equal(response.status, input.path === '/health' ? 200 : 204);
  }
});
test('memory state is isolated by default; bounded capacity fails safely', async () => {
  const instance = app({ state: createMemoryState({ maxEvents: 1 }) });
  assert.equal((await instance.dispatch(signed())).status, 204);
  assert.equal((await instance.dispatch(signed({ id: 'second' }))).status, 503);
  assert.equal(app().state.getRitual('456'), undefined);
  const snapshot = instance.state.getRitual('456'); snapshot.endsAt = 0;
  assert.equal(instance.state.getRitual('456').endsAt, time + 90000);
});
test('expired dedupe entries release capacity', () => {
  const state = createMemoryState({ maxEvents: 1 });
  assert.equal(state.accept({ id: 'a', now: time, expiresAt: time + 1 }), 'accepted');
  assert.equal(state.accept({ id: 'b', now: time + 2, expiresAt: time + 3 }), 'accepted');
});
test('revocation acknowledges without creating a ritual', async () => {
  const instance = app();
  assert.equal((await instance.dispatch(signed({ type: 'revocation', body: { subscription: { type: 'channel.raid' } } }))).status, 204);
  assert.equal(instance.state.getRitual('456'), undefined);
});
test('configuration, routes and static assets', async () => {
  assert.equal((await createApp().dispatch(signed())).status, 503);
  assert.equal((await app().dispatch({ method: 'GET', path: '/eventsub' })).status, 405);
  assert.equal((await app().dispatch({ method: 'GET', path: '/missing' })).status, 404);
  for (const path of ['/', '/overlay', '/relic.svg', '/style.css']) {
    assert.equal((await app().dispatch({ method: 'GET', path })).status, 200);
  }
});

test('signed raid notifications accept only the unused empty opposite key; challenge bypasses condition matching safely', async () => {
  const instance = app({ chatContext: { streamerId: '123', botId: '999', keeperIds: ['123', '456'] } });
  for (const [active, opposite, host] of [['from_broadcaster_user_id', 'to_broadcaster_user_id', '123'], ['to_broadcaster_user_id', 'from_broadcaster_user_id', '456']]) {
    const condition = { [active]: host, [opposite]: '' };
    assert.equal((await instance.dispatch(signed({ id: `empty-${active}`, body: { ...raid, subscription: { ...raid.subscription, condition } } }))).status, 204);
    for (const bad of [{ ...condition, [opposite]: '777' }, { ...condition, unknown: '' }, { ...condition, [opposite]: null }]) {
      assert.equal((await instance.dispatch(signed({ body: { ...raid, subscription: { ...raid.subscription, condition: bad } } }))).status, 400);
    }
    const request = signed({ type: 'webhook_callback_verification', body: { subscription: { ...raid.subscription, condition }, challenge: 'raid café 星' } });
    const response = await httpResponse(instance, request);
    assert.equal(response.status, 200); assert.deepEqual(response.endArgs, ['raid café 星']);
    assert.equal(response.headers['content-length'], Buffer.byteLength('raid café 星'));
    request.headers['twitch-eventsub-message-signature'] = `sha256=${'0'.repeat(64)}`;
    assert.equal((await instance.dispatch(request)).status, 403);
  }
});
