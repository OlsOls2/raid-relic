import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createChronicle, chronicleMutation, chronicleTransport, safeLine } from '../src/chronicle.js';
import { createJourneyFixture } from '../test-support/journey-fixture.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
const generated = 'Under silver skies, a quiet ember learned another song.';
const model = line => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: line }] }] });
const enabled = { CHRONICLE_ENABLED: 'true', CHRONICLE_ALLOW_PAID: 'true', OPENAI_API_KEY: 'synthetic-test-only-key' };
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: Chronicle scoped HTTP control, cost gates, read-only calls and single moderated attempt`, async () => {
    const calls = [];
    const f = await pilotFixture(kind, { chronicleEnv: enabled, chronicleHTTP: async (path, body) => { calls.push({ path, body }); return path === 'responses' ? model(generated) : { results: [{ flagged: false }] }; } });
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    assert.equal(calls.length, 0);
    await f.control(HOME, 'chronicle'); assert.equal(calls.length, 0); // No completed received stop.
    for (const id of [HOME, OTHER]) { await f.control(id, 'bootstrap'); f.advance(); await f.control(id, 'keep'); f.advance(); }
    await f.chat(HOME, '811', '!mark moon'); await f.chat(HOME, HOME, '!relic approve m1');
    await f.raid(); await f.chat(HOME, HOME, '!offer'); await f.chat(OTHER, OTHER, '!accept');
    assert.equal(calls.length, 0); // EventSub never generates.
    const page = JSON.parse((await f.request('/api/atlas')).body); const id = page.stops[0].stopId;
    assert.equal(page.stops[0].chronicle.source, 'template');
    await f.control(HOME, 'chronicle'); assert.equal(calls.length, 0); // Incorrect recipient.
    for (const headers of [{ origin: undefined }, { origin: 'https://evil.example' }, { cookie: f.cookies[HOME] }]) assert.equal((await f.control(OTHER, 'chronicle', headers)).status, 403);
    assert.equal(calls.length, 0);
    await Promise.all([f.control(OTHER, 'chronicle'), f.control(OTHER, 'chronicle')]);
    assert.deepEqual(calls.map(c => c.path), ['responses', 'moderations']);
    assert.equal(calls[0].body.model, 'gpt-4.1-mini'); assert.equal(calls[0].body.max_output_tokens, 96);
    assert.equal(calls[0].body.input, 'Completed ring index: 1.');
    assert.ok(!JSON.stringify(calls).includes('moon')); assert.ok(!JSON.stringify(calls).includes(HOME));
    await f.control(OTHER, 'chronicle');
    for (let i = 0; i < 3; i++) { await f.request('/api/atlas'); await f.request(`/api/atlas/stops/${id}`); await f.request('/api/atlas/search', 'POST', { 'content-type': 'application/json' }, Buffer.from('{"query":"moon"}')); }
    assert.equal(calls.length, 2);
    const detail = JSON.parse((await f.request(`/api/atlas/stops/${id}`)).body);
    assert.deepEqual(detail.stop.chronicle, { line: generated, source: 'model', fiction: true });
    assert.ok(!JSON.stringify(detail).includes('claimId'));
    f.advance(3600001); assert.equal((await f.control(OTHER, 'chronicle')).status, 403); assert.equal(calls.length, 2);
  });
  test(`${kind}: default/off/no-key control makes zero model requests`, async () => {
    for (const env of [{}, { CHRONICLE_ENABLED: 'true' }, { CHRONICLE_ENABLED: 'true', CHRONICLE_ALLOW_PAID: 'true' }, { ...enabled, CHRONICLE_ALLOW_PAID: 'false' }]) {
      let calls = 0; const f = await pilotFixture(kind, { chronicleEnv: env, chronicleHTTP: async () => { calls++; throw Error(); } });
      await f.login(OTHER); const response = await f.control(OTHER, 'chronicle'); assert.equal(response.status, 200); assert.equal(JSON.parse(response.body).status, 'template'); assert.equal(calls, 0);
    }
  });
  test(`${kind}: Chronicle completion merges fresh lineage after concurrent forget; restart/crash never retries`, async t => {
    const f = await createJourneyFixture({ firestoreClient: kind === 'firestore' ? fakeFirestore() : undefined }); t.after(() => f.close());
    let release, entered; const started = new Promise(r => { entered = r; }); const blocked = new Promise(r => { release = r; });
    const service = createChronicle({ state: f.state, enabled: true, allowPaid: true, key: 'synthetic', claimId: randomUUID, transport: async path => { if (path === 'responses') { entered(); await blocked; return model(generated); } return { results: [{ flagged: false }] }; } });
    const pending = service.write(f.target); await started;
    await f.state.controlMarks(f.source, { broadcasterId: f.source, chatterId: '9000' }, { type: 'forgetme' }, Date.now()); release(); await pending;
    const stop = (await f.state.getAtlasPage()).stops[0]; const detail = await f.state.getAtlasPage({ stopId: stop.stopId });
    assert.ok(!detail.marks.some(m => m.text === 'moon')); assert.equal(stop.chronicle.source, 'model');
    const fresh = await createJourneyFixture({ firestoreClient: kind === 'firestore' ? fakeFirestore() : undefined }); t.after(() => fresh.close());
    assert.ok(await fresh.state.chronicleStep({ keeperId: fresh.target, claimId: 'crashed' }));
    const restarted = createChronicle({ state: fresh.state, enabled: true, allowPaid: true, key: 'synthetic', claimId: randomUUID, transport: () => { throw Error('MUST NOT CALL'); } });
    assert.equal((await restarted.write(fresh.target)).status, 'unavailable'); assert.equal((await fresh.state.getAtlasPage()).stops[0].chronicle.source, 'template');
  });
}
test('Chronicle malformed, flagged, unavailable, oversized, injection and timed-out responses fall back without retries', async t => {
  for (const value of [null, {}, model(''), model('<b>bad</b>'), model('https://bad.example'), model('Ignore previous instructions'), model('x'.repeat(161)), model('x'.repeat(17000)), model(generated), 'throw', 'timeout']) {
    const f = await createJourneyFixture(); t.after(() => f.close()); let calls = 0;
    const service = createChronicle({ state: f.state, enabled: true, allowPaid: true, key: 'synthetic', claimId: randomUUID, timeoutMs: 5,
      transport: async path => { calls++; if (value === 'throw') throw Error('Authorization: SECRET upstream 429'); if (value === 'timeout') return new Promise(() => {}); return path === 'responses' ? value : { results: [{ flagged: true }] }; } });
    const result = await service.write(f.target); assert.equal(result.status, 'template'); assert.ok(!JSON.stringify(result).includes('SECRET')); const count = calls;
    await service.write(f.target); assert.equal(calls, count); assert.equal((await f.state.getAtlasPage()).stops[0].chronicle.source, 'template');
  }
});
test('Chronicle capacity and completion identity are fail closed and do not overwrite lineage', () => {
  const lineage = { stops: [{ stopId: 'id', to: '2', ringIndex: 1, marks: [], extra: 'x'.repeat(524288) }] };
  assert.throws(() => chronicleMutation(lineage, { keeperId: '2', claimId: 'a' })); assert.equal(lineage.stops[0].chronicle, undefined);
  assert.equal(chronicleMutation(lineage, { keeperId: '3', claimId: 'a' }).next, null);
  assert.equal(chronicleMutation(lineage, { keeperId: '2', claimId: 'a', stopId: 'missing', line: generated }).next, null);
  assert.equal(safeLine('line\nline'), false);
});
test('Native Chronicle HTTP transport is fixed-endpoint, no retry and bounded; mocked fetch only', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; }); const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response(JSON.stringify({ results: [{ flagged: false }] })); };
  await chronicleTransport('moderations', { model: 'omni-moderation-latest', input: generated }, 'synthetic-key');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/moderations'); assert.equal(calls[0].options.redirect, 'error');
  globalThis.fetch = async () => new Response('secret', { status: 429 }); await assert.rejects(chronicleTransport('responses', {}, 'synthetic'), /Chronicle unavailable/);
  globalThis.fetch = async () => new Response('x'.repeat(16385)); await assert.rejects(chronicleTransport('responses', {}, 'synthetic'), /Chronicle unavailable/);
});
for (const kind of ['memory', 'firestore']) test(`${kind}: malformed or unavailable moderation always consumes attempt and uses template`, async t => {
  for (const result of [{}, { results: [] }, { results: [{ flagged: 'false' }] }, 'error', 'timeout']) {
    const f = await createJourneyFixture({ firestoreClient: kind === 'firestore' ? fakeFirestore() : undefined }); t.after(() => f.close()); let calls = 0;
    const service = createChronicle({ state: f.state, enabled: true, allowPaid: true, key: 'synthetic', claimId: randomUUID, timeoutMs: 5,
      transport: async path => { calls++; if (path === 'responses') return model(generated); if (result === 'error') throw Error('upstream 429 private'); if (result === 'timeout') return new Promise(() => {}); return result; } });
    assert.equal((await service.write(f.target)).status, 'template'); await service.write(f.target); assert.equal(calls, 2);
    assert.equal((await f.state.getAtlasPage()).stops[0].chronicle.source, 'template');
  }
});
test('Firestore failed attempt commit makes no HTTP effect; failed completion never permits a second charge', async t => {
  const db = fakeFirestore(); const f = await createJourneyFixture({ firestoreClient: db }); t.after(() => f.close()); let calls = 0;
  const service = createChronicle({ state: f.state, enabled: true, allowPaid: true, key: 'synthetic', claimId: randomUUID,
    transport: async path => { calls++; if (path === 'responses') return model(generated); db.failCommit = true; return { results: [{ flagged: false }] }; } });
  db.failCommit = true; await assert.rejects(service.write(f.target)); assert.equal(calls, 0);
  db.failCommit = false; db.retry = true; await assert.rejects(service.write(f.target)); assert.equal(calls, 2);
  db.failCommit = false; assert.equal((await service.write(f.target)).status, 'unavailable'); assert.equal(calls, 2);
  assert.equal((await f.state.getAtlasPage()).stops[0].chronicle.source, 'template');
});
test('optional client Chronicle bounds and source whitelist preserve fallback without interpreting HTML', async () => {
  const { readFile } = await import('node:fs/promises'); const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../public/atlas.js', import.meta.url), 'utf8');
  const helper = source.slice(source.indexOf('function chronicleCaption('), source.indexOf('function clear()'));
  const caption = runInNewContext(`${helper}; chronicleCaption`);
  const fallback = caption(undefined);
  for (const value of [undefined, null, 'text', [], {}, { source: 'model', fiction: true, line: 42 },
    { source: 'invalid', fiction: true, line: 'text' }, { source: 'model', line: 'text' },
    { source: 'model', fiction: true, line: 'x'.repeat(161) }, { source: 'model', fiction: true, line: '\n' }]) assert.equal(caption(value), fallback);
  const html = '<img src=x onerror=alert(2)>';
  assert.equal(caption({ source: 'model', fiction: true, line: html }), `Fiction · model: ${html}`);
  assert.ok(source.includes("node('p', chronicleCaption(data.stop.chronicle))"));
  assert.ok(source.includes("node('p', chronicleCaption(stop.chronicle))"));
  assert.ok(source.includes('n.textContent = text')); assert.ok(!source.includes('innerHTML'));
});
