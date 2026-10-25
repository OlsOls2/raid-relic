import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { createJudges, JUDGES_ORIGIN } from '../test-support/judges.js';
import { createApp } from '../src/app.js';
import { releaseFiles } from '../scripts/release-files.js';
const host = { host: '127.0.0.1:5191' };
const request = (f, path, method = 'GET', headers = {}, body = '') => f.dispatch({ path, method, headers: { ...host, ...headers }, rawBody: Buffer.from(body) });
const action = (f, value, headers) => request(f, '/api/judges/action', 'POST', { origin: JUDGES_ORIGIN, 'content-type': 'application/json', ...headers }, JSON.stringify({ action: value }));
const data = response => { assert.equal(response.status, 200, response.body); return JSON.parse(response.body); };
const fresh = t => createJudges({ intent: true, env: {} }).then(f => { t.after(() => f.close()); return f; });
test('judges requires explicit intent and rejects production/cloud; ambient provider/database config is never passed through', async t => {
  for (const options of [{}, { intent: false }, { intent: true, env: { NODE_ENV: 'production' } }, { intent: true, env: { K_SERVICE: 'anything' } }]) await assert.rejects(createJudges(options));
  const original = globalThis.fetch; globalThis.fetch = () => { assert.fail('External fetch forbidden'); }; t.after(() => { globalThis.fetch = original; });
  const f = await createJudges({ intent: true, env: { STATE_STORE: 'firestore', OPENAI_API_KEY: 'do-not-use-synthetic-ambient', CHRONICLE_ENABLED: 'true', CHRONICLE_ALLOW_PAID: 'true', TWITCH_CLIENT_SECRET: 'do-not-use-synthetic-ambient' } }); t.after(() => f.close());
  data(await action(f, 'setup')); data(await action(f, 'send'));
  assert.equal(data(await request(f, '/api/judges/status')).rings, 0);
});
test('every simulator HTML page/loading/error, API and HTTP response is unmistakably labelled; OAuth and actual EventSub blocked', async t => {
  const f = await fresh(t);
  for (const path of ['/judges', '/', '/atlas/', '/overlay/1591805230?corner=1', '/control/1591805230', '/stops/' + 'a'.repeat(64), '/oops', '/oauth/bot/start', '/oauth/keeper/1591805230/start', '/auth/callback?code=fake', '/eventsub', 'https://twitch.tv', '//twitch.tv']) {
    const response = await request(f, path); assert.ok(response.body.toString().includes('SIMULATOR'), path); assert.match(response.body.toString(), /<title>SIMULATOR/); assert.equal(response.headers['x-raid-relic-mode'], 'simulator'); assert.ok(!response.headers.location);
  }
  for (const path of ['/api/atlas', '/api/judges/status', '/api/overlay/1591805230', '/api/unknown']) assert.equal(JSON.parse((await request(f, path)).body).mode, 'simulator');
  const req = Readable.from([]); req.method = 'GET'; req.url = '/judges'; req.headers = host;
  let status, headers, body; await f.handler(req, { writeHead(s, h) { status = s; headers = h; }, end(value) { body = value; } });
  assert.equal(status, 200); assert.equal(headers['x-raid-relic-mode'], 'simulator'); assert.ok(body.includes('SIMULATOR')); assert.equal(headers['cache-control'], 'no-store');
  const overlay = (await request(f, '/overlay/1591805230?corner=1')).body;
  assert.ok(overlay.includes('id="simulator">SIMULATOR')); assert.ok(!overlay.includes('id="simulator" hidden'));
});
test('local mutation guards reject origin/host/config/body attacks before any step; no arbitrary OAuth or target', async t => {
  const f = await fresh(t);
  for (const headers of [{ origin: undefined }, { origin: 'http://localhost:5191' }, { origin: 'https://evil.example' }, { 'content-type': 'text/plain' }, { host: 'evil.example' }]) assert.ok((await action(f, 'setup', headers)).status >= 400);
  for (const body of ['{', '{"action":"setup","action":"reset"}', '{"action":"setup","target":"external"}', '{"url":"https://example.com"}', '{"action":"setup","env":{}}', 'x'.repeat(1025), '{"action":"chronicle"}', '{"action":"send:123"}']) assert.ok((await request(f, '/api/judges/action', 'POST', { origin: JUDGES_ORIGIN, 'content-type': 'application/json' }, body)).status >= 400);
  assert.equal(data(await request(f, '/api/judges/status')).flags.setup, undefined);
  assert.equal((await action(f, 'raid')).status, 400); assert.equal((await request(f, '/api/judges/action?setup=1', 'POST')).status, 404);
});
test('judges full actual-kernel mock flow separates API acceptance/receipt/two chat claim, search/template and erasure', async t => {
  const f = await fresh(t); data(await action(f, 'setup')); data(await action(f, 'mark'));
  const state = data(await request(f, '/api/judges/status')); assert.equal(state.candidates.length, 1); assert.match(state.candidates[0].label, /^Simulated /);
  const accepted = data(await action(f, 'send')); assert.equal(accepted.rings, 0); assert.equal(accepted.handoff, null); assert.equal(accepted.intent, 'accepted');
  assert.equal(data(await request(f, '/api/overlay/1591806023')).approvedCount, 0);
  data(await action(f, 'raid')); const preview = data(await request(f, '/api/overlay/1591806023')); assert.equal(preview.status, 'incoming'); assert.equal(preview.approvedCount, 1); assert.equal(preview.lineageRings, 0);
  data(await action(f, 'offer')); assert.equal(data(await request(f, '/api/atlas')).rings, 0);
  const claimed = data(await action(f, 'accept')); assert.equal(claimed.rings, 1); assert.equal(claimed.holder, 'Simulated 1591806023');
  const atlas = data(await request(f, '/api/atlas')); const stop = atlas.stops[0]; assert.equal(stop.chronicle.source, 'template');
  const detail = data(await request(f, `/api/atlas/stops/${stop.stopId}`)); assert.equal(detail.marks[0].text, 'moon');
  const search = () => request(f, '/api/atlas/search', 'POST', { origin: JUDGES_ORIGIN, 'content-type': 'application/json' }, '{"query":"moon"}');
  assert.equal(data(await search()).total, 1); data(await action(f, 'forget')); assert.equal(data(await search()).total, 0);
  assert.equal(data(await request(f, '/api/overlay/1591806023')).approvedCount, 0);
  const safe = JSON.stringify(detail); for (const text of ['userId', 'actorId', '811', 'access_token', 'refresh_token', 'csrf', 'claimId']) assert.ok(!safe.includes(text));
});
test('reset replaces only local memory, independent instances, expiry and repeat steps remain bounded', async t => {
  const a = await fresh(t), b = await fresh(t); data(await action(a, 'setup')); data(await action(a, 'mark')); data(await action(a, 'send')); data(await action(a, 'raid'));
  data(await action(a, 'expire')); assert.equal(data(await request(a, '/api/overlay/1591806023')).claimMeter, null); assert.equal(data(await request(a, '/api/judges/status')).handoff, null); assert.equal((await action(a, 'accept')).status, 400); assert.equal(data(await request(a, '/api/atlas')).rings, 0);
  for (let i = 0; i < 3; i++) data(await action(a, 'reset'));
  assert.equal(a.server.listenerCount('upgrade'), 1); assert.equal(data(await request(a, '/api/judges/status')).generation, 3);
  assert.equal(data(await request(a, '/api/judges/status')).flags.setup, undefined); assert.equal(data(await request(b, '/api/judges/status')).generation, 0);
  assert.equal(data(await request(a, '/api/overlay/1591805230')).status, 'waiting');
  data(await action(a, 'setup')); assert.equal((await action(a, 'setup')).status, 400);
});
test('judges files cannot enter production release or be activated by query; normal start stays unchanged', async () => {
  const files = await releaseFiles(process.cwd()); assert.ok(files.every(({ file }) => !/judges|test-support|scripts\//.test(file)));
  for (const path of ['/judges', '/api/judges/status', '/api/judges/action', '/atlas/?simulator=1']) assert.notEqual((await createApp().dispatch({ method: 'GET', path })).status, 200);
  const pkg = JSON.parse(await readFile('package.json', 'utf8')); assert.equal(pkg.scripts.start, 'node src/server.js'); assert.equal(pkg.scripts.judges, 'node scripts/judges.js --simulator');
  for (const file of ['.gcloudignore', '.dockerignore']) assert.ok(!(await readFile(file, 'utf8')).includes('!test-support'));
});
test('concurrent simulator Send Off is serialized and JSON HTTP errors retain mode/header without reflecting bodies', async t => {
  const f = await fresh(t); data(await action(f, 'setup'));
  const responses = await Promise.all([action(f, 'send'), action(f, 'send')]); assert.deepEqual(responses.map(r => r.status), [200, 400]);
  assert.equal(data(await request(f, '/api/judges/status')).intent, 'accepted');
  for (const [body, expected] of [['{"UNREFLECTED_TEST"', 400], ['x'.repeat(1025), 400]]) {
    const req = Readable.from([Buffer.from(body)]); req.method = 'POST'; req.url = '/api/judges/action'; req.headers = { ...host, origin: JUDGES_ORIGIN, 'content-type': 'application/json' };
    let status, headers, output; await f.handler(req, { writeHead(s, h) { status = s; headers = h; }, end(value) { output = value; } });
    assert.equal(status, expected); assert.equal(JSON.parse(output).mode, 'simulator'); assert.equal(headers['x-raid-relic-mode'], 'simulator'); assert.ok(!output.includes(body));
  }
});

test('judges overlay serves its complete module graph and projects actual carried/faded runes without changing receipt clocks', async t => {
  const f = await fresh(t);
  const visited = new Set();
  async function module(path) {
    if (visited.has(path)) return; visited.add(path);
    const response = await request(f, path);
    assert.equal(response.status, 200, path); assert.match(response.type, /javascript/, path);
    for (const match of response.body.toString().matchAll(/(?:from\s*|import\s*)['"](\.\/[^'"]+)['"]/g)) {
      await module(new URL(match[1], `http://local${path}`).pathname);
    }
  }
  await module('/overlay.js'); assert.ok(visited.has('/claim-meter.js'));
  const view = () => request(f, '/api/overlay/1591806023').then(data);
  const empty = await view(); assert.equal(empty.status, 'waiting'); assert.equal(empty.approvedCount, 0); assert.equal(empty.handoff, null);
  for (const step of ['setup', 'mark', 'send']) data(await action(f, step));
  const accepted = await view(); assert.equal(accepted.status, 'waiting'); assert.equal(accepted.marks.length, 0); assert.equal(accepted.handoff, null); assert.equal(accepted.claimMeter.awaitingRaid, true);
  data(await action(f, 'raid'));
  const incoming = await view(); assert.equal(incoming.status, 'incoming'); assert.equal(incoming.marks.length, 1); assert.equal(incoming.claimMeter.awaitingRaid, false);
  assert.equal(incoming.handoff.clockPolicy, 'preclaim-v1'); assert.ok(Number.isFinite(incoming.handoff.claimStartedAt));
  for (const step of ['offer', 'accept']) data(await action(f, step));
  const carried = await view(); assert.equal(carried.status, 'ready'); assert.equal(carried.approvedCount, 1); assert.equal(carried.marks.length, 1); assert.equal(carried.lineageRings, 1);
  assert.equal(carried.handoff.startedAt, incoming.handoff.startedAt); assert.equal(carried.handoff.claimStartedAt, incoming.handoff.claimStartedAt);
  for (let i = 0; i < 3; i++) data(await action(f, 'closure'));
  const faded = await view(); assert.equal(faded.marks.length, 1); assert.equal(faded.marks[0].faded, true); assert.equal(faded.marks[0].runeSvg, carried.marks[0].runeSvg);
  data(await action(f, 'forget')); assert.equal((await view()).marks.length, 0);
});
