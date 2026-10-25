import test from 'node:test';
import assert from 'node:assert/strict';
import { createSendOff } from '../src/send-off.js';
import { raidDiagnostic } from '../src/raid-diagnostic.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
async function setup(kind) {
  const f = await pilotFixture(kind); for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) { await f.control(id, 'bootstrap'); f.advance(); await f.control(id, 'keep'); f.advance(); }
  await f.chat(HOME, HOME, '!relic send @olsols2'); return f;
}
for (const kind of ['memory', 'firestore']) test(`${kind}: dispatch preserves safe exact message/status, correct source token, one POST and private-only diagnostic`, async () => {
  for (const code of [200, 400, 401, 403, 429, 503, 'network', 'malformed']) {
    const f = await setup(kind), logs = [], requests = []; const token = 'synthetic-source-access-secret';
    const worker = createSendOff({ state: f.runtime.state, streamerId: HOME, clientId: 'public-client', now: f.now,
      oauth: { accessToken: async role => { assert.equal(role, 'streamer'); return token; } }, logger: line => logs.push(JSON.parse(line)),
      transport: async (url, input) => {
        requests.push({ url, input }); assert.equal(input.headers.Authorization, `Bearer ${token}`);
        if (url.includes('/users?')) return { status: 200, data: { data: [{ id: OTHER, login: 'olsols2' }] } };
        if (url.includes('/streams?')) return { status: 200, data: { data: [...f.streams.values()] } };
        assert.equal(url, `https://api.twitch.tv/helix/raids?from_broadcaster_id=${HOME}&to_broadcaster_id=${OTHER}`);
        assert.equal(input.method, 'POST');
        if (code === 'network') throw Error(`never serialize ${token}`);
        return { status: code === 'malformed' ? 400 : code, malformed: code === 'malformed', data: { message: 'Safe exact Twitch explanation.', error: 'Forbidden' }, rate: { reset: '1792920000', retryAfter: '12' } };
      } });
    const result = await worker.processPending(); const intent = (await f.runtime.state.getKeeperRegistry()).send;
    assert.equal(result.status, code === 200 ? 'accepted' : code === 'network' || code === 'malformed' || code === 503 ? 'unknown' : 'rejected');
    assert.equal(intent.diagnostic.httpStatus, code === 'network' ? null : code === 'malformed' ? 400 : code);
    if (code !== 'network') assert.equal(intent.diagnostic.message, 'Safe exact Twitch explanation.');
    assert.equal(intent.diagnostic.expectedPrincipal, HOME); assert.equal(intent.diagnostic.targetId, OTHER);
    assert.equal(logs.length, 1); assert.equal(logs[0].event, 'raid_relic_raid_dispatch');
    assert.ok(!JSON.stringify(logs).includes(token)); assert.ok(Buffer.byteLength(JSON.stringify(intent.diagnostic)) <= 1024);
    await worker.processPending(); assert.equal(requests.filter(r => r.input.method === 'POST').length, 1);
    for (const host of [HOME, OTHER]) assert.ok(!JSON.stringify(await f.runtime.state.getOverlayState(host, f.now())).includes('diagnostic'));
    assert.ok(!JSON.stringify(await f.runtime.state.getPublicJourney()).includes('diagnostic'));
    const own = JSON.parse((await f.request(`/control/${HOME}/status`, 'GET', { cookie: f.cookies[HOME] })).body).pilot;
    const other = JSON.parse((await f.request(`/control/${OTHER}/status`, 'GET', { cookie: f.cookies[OTHER] })).body).pilot;
    assert.deepEqual(own.dispatchDiagnostic, intent.diagnostic); assert.equal(other.dispatchDiagnostic, null);
  }
});
test('message scrubber redacts actual token/credential echoes, URLs and high-entropy values with bounded flags', () => {
  const intent = { id: 'a'.repeat(64), sourceId: HOME, targetId: OTHER }, token = 'synthetic-token';
  const d = raidDiagnostic(intent, { status: 403, data: { message: `${token} Bearer otherSecret access_token=abc refresh_token=def client_secret=ghi code=jkl https://example.test/?secret=abc ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ${'💎'.repeat(500)}`, error: 'safe' }, rate: { reset: 'invalid', retryAfter: '99999999999999999' } }, token, 1, 2);
  for (const secret of [token, 'otherSecret', '=abc', '=def', '=ghi', '=jkl', 'https://', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ']) assert.ok(!JSON.stringify(d).includes(secret));
  assert.equal(d.redacted, true); assert.equal(d.truncated, true); assert.equal(d.reset, null); assert.equal(d.retryAfter, null);
  assert.ok(Buffer.byteLength(JSON.stringify(d)) <= 1024);
});
for (const kind of ['memory', 'firestore']) test(`${kind}: finalize/logging failures and concurrent confirmation cannot replay POST or overwrite settled intent`, async () => {
  for (const mode of ['finalize', 'logger', 'confirmed']) {
    const f = await setup(kind); let posts = 0; const logs = []; const step = f.runtime.state.sendOffStep;
    if (mode === 'finalize') f.runtime.state.sendOffStep = (op, now) => { if (op.type === 'finish') throw Error('synthetic-db-failure'); return step(op, now); };
    const worker = createSendOff({ state: f.runtime.state, streamerId: HOME, clientId: 'client', now: f.now, oauth: { accessToken: async () => 'synthetic-token' },
      logger: line => { logs.push(line); if (mode === 'logger') throw Error('synthetic-log-failure'); },
      transport: async (url, input) => {
        if (url.includes('/users?')) return { status: 200, data: { data: [{ id: OTHER, login: 'olsols2' }] } };
        if (url.includes('/streams?')) return { status: 200, data: { data: [...f.streams.values()] } };
        posts++; if (mode === 'confirmed') { f.advance(); await f.raid(); }
        return { status: 200, data: { data: [{}] } };
      } });
    await worker.processPending(); f.runtime.state.sendOffStep = step;
    await worker.processPending(); assert.equal(posts, 1); assert.equal(logs.length, 1);
    const intent = (await f.runtime.state.getKeeperRegistry()).send;
    assert.equal(intent.status, mode === 'finalize' ? 'dispatching' : mode === 'confirmed' ? 'confirmed' : 'accepted');
    if (mode === 'confirmed') assert.equal(intent.diagnostic, undefined);
    assert.ok(Buffer.byteLength(JSON.stringify(await f.runtime.state.getKeeperRegistry())) <= 4096);
  }
});

test('raid-only transport preserves status on invalid/oversized JSON and selects only numeric rate fields', async () => {
  const { raidHTTP } = await import('../src/raid-diagnostic.js'); const original = globalThis.fetch;
  try {
    for (const body of ['not-json', 'x'.repeat(17000)]) {
      globalThis.fetch = async () => new Response(body, { status: 401, headers: { 'ratelimit-reset': '1234', 'retry-after': '7', 'authorization': 'NEVER COPY' } });
      const response = await raidHTTP('https://mock.invalid/', {});
      assert.equal(response.status, 401); assert.equal(response.malformed, true); assert.equal(response.data, null);
      assert.deepEqual(response.rate, { reset: '1234', retryAfter: '7' }); assert.ok(!JSON.stringify(response).includes('NEVER COPY'));
    }
  } finally { globalThis.fetch = original; }
});

test('canonical human OAuth token explanation is exact; actual tokens before/after and credential values remain scrubbed', () => {
  const intent = { id: 'a'.repeat(64), sourceId: HOME, targetId: OTHER };
  const message = 'The ID in from_broadcaster_id must match the user ID found in the OAuth token.';
  const make = text => raidDiagnostic(intent, { status: 401, data: { message: text } }, 'synthetic-secret-value', 1, 2);
  const safe = make(message); assert.equal(safe.message, message); assert.equal(safe.redacted, false);
  for (const text of [`synthetic-secret-value ${message}`, `${message} synthetic-secret-value`, 'Bearer otherSecret OAuth privateValue']) {
    const result = make(text); assert.equal(result.redacted, true);
    for (const secret of ['synthetic-secret-value', 'otherSecret', 'privateValue']) assert.ok(!result.message.includes(secret));
  }
});
test('documented raid status categories guide owner without guessing historical cause or retrying', () => {
  const intent = { id: 'b'.repeat(64), sourceId: HOME, targetId: OTHER };
  for (const [status, message, category] of [[400, 'The source is blocked by target', 'incoming-raid-policy'],
    [400, 'Target does not accept raids', 'incoming-raid-policy'], [400, 'Too many viewers', 'incoming-raid-policy'],
    [400, 'Invalid equal IDs', 'native-state-review'], [404, 'Target not found', 'target-not-found'],
    [409, 'Already in process of raiding another channel', 'pending-native-raid'], [403, 'Forbidden', 'provider-forbidden'], [429, 'Too many requests', 'rate-limited']]) {
    const d = raidDiagnostic(intent, { status, data: { message } }, 'synthetic-secret', 1, 2);
    assert.equal(d.category, category); assert.equal(d.message, message); assert.equal(d.redacted, false);
    assert.ok(Buffer.byteLength(JSON.stringify(d)) <= 1024);
    if (status === 409) assert.match(d.nextStep, /STOP.*No new Send Off or Process/);
    if (status === 429) assert.match(d.nextStep, /10 requests per 10 minutes/);
  }
});
