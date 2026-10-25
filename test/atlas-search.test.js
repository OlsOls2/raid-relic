import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { createJourneyFixture } from '../test-support/journey-fixture.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';
import { createApp } from '../src/app.js';
import { atlasSearch } from '../src/public-view.js';
const query = (app, value) => app.dispatch({ method: 'POST', path: '/api/atlas/search', headers: { 'content-type': 'application/json' }, rawBody: Buffer.from(JSON.stringify(value)) });
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: shared approved text search normalizes Unicode and returns only safe completed fields`, async t => {
    const db = kind === 'firestore' ? fakeFirestore() : undefined;
    const f = await createJourneyFixture({ firestoreClient: db }); t.after(() => f.close());
    if (db) db.reads.length = 0;
    const response = await query(f.app, { query: 'ｍＯＯＮ' }); assert.equal(response.status, 200);
    if (db) { assert.equal(db.reads.length, 1); assert.ok(db.reads[0].startsWith('lineage/')); }
    const result = JSON.parse(response.body); assert.equal(result.total, 1); assert.equal(result.mode, 'simulator');
    assert.deepEqual(Object.keys(result.matches[0]).sort(), ['stopId', 'from', 'to', 'claimedAt', 'ringIndex', 'text', 'runeSvg'].sort());
    assert.equal(result.matches[0].text, 'moon'); assert.ok(!('query' in result));
    assert.equal(JSON.parse((await query(f.app, { query: 'notfound' })).body).total, 0);
    assert.equal(JSON.parse((await query(f.app, { query: '💎' })).body).total, 1);
    assert.equal(JSON.parse((await query(f.app, { query: 'MO' })).body).total, 1); // Literal substring.
    await f.chat(f.source, '9999', { type: 'mark', text: 'pending' });
    assert.equal(JSON.parse((await query(f.app, { query: 'pending' })).body).total, 0);
  });
  test(`${kind}: forget/block/veto/opt-out remove fresh search results permanently`, async t => {
    for (const action of ['forgetme', 'block', 'veto-last', 'opt-out']) {
      const f = await createJourneyFixture({ firestoreClient: kind === 'firestore' ? fakeFirestore() : undefined }); t.after(() => f.close());
      const text = action === 'veto-last' ? '💎' : 'moon';
      assert.equal(JSON.parse((await query(f.app, { query: text })).body).total, 1);
      await f.state.controlMarks(f.source, { broadcasterId: f.source, chatterId: action === 'forgetme' ? '9000' : f.source }, { type: action, userId: '9000' }, Date.now());
      assert.equal(JSON.parse((await query(f.app, { query: text })).body).total, 0, action);
      await f.chat(f.source, f.source, { type: 'approve', markId: action === 'veto-last' ? 'm4' : 'm1' });
      assert.equal(JSON.parse((await query(f.app, { query: text })).body).total, 0);
    }
  });
}
test('invalid search arguments and methods fail before database access; rate budget covers search', async () => {
  let reads = 0;
  const app = createApp({ state: { searchPublicMarks() { reads++; return { total: 0, matches: [] }; } } });
  for (const value of [{}, null, [], { query: '' }, { query: '.*' }, { query: '<script>' }, { query: 'two words' }, { query: 'a'.repeat(129) }, { query: 'moon', offset: -1 }, { query: 'moon', offset: '1' }, { query: 'moon', offset: 2561 }, { query: 'moon', limit: 21 }, { query: 'moon', limit: 0 }, { query: 'moon', limit: null }, { query: 'moon', limit: 1.5 }, { query: 'moon', actorId: '811' }]) assert.equal((await query(app, value)).status, 400);
  for (const rawBody of [Buffer.from('{'), Buffer.from('{"query":"moon","query":"star"}'), Buffer.alloc(1025, 32), Buffer.from([255])]) assert.equal((await app.dispatch({ method: 'POST', path: '/api/atlas/search', headers: { 'content-type': 'application/json' }, rawBody })).status, 400);
  assert.equal((await app.dispatch({ method: 'GET', path: '/api/atlas/search' })).status, 405);
  assert.equal((await app.dispatch({ method: 'POST', path: '/api/atlas' })).status, 405);
  assert.equal((await app.dispatch({ method: 'GET', path: '/api/atlas?q=moon' })).status, 400);
  assert.equal((await app.dispatch({ method: 'POST', path: '/api/atlas/search?q=moon' })).status, 400);
  assert.equal((await app.dispatch({ method: 'POST', path: '/api/atlas/search', headers: { 'content-type': 'text/plain' }, rawBody: Buffer.from('{}') })).status, 400);
  assert.equal(reads, 0);
  const limited = createApp({ publicBudget: { burst: 1, perSecond: 0 }, state: { searchPublicMarks() { reads++; return {}; } } });
  assert.equal((await query(limited, { query: 'moon' })).status, 200); assert.equal((await query(limited, { query: 'moon' })).status, 429); assert.equal(reads, 1);
});
test('bounded deterministic paging is literal and does not echo private associations or query', () => {
  const stop = { stopId: 'a'.repeat(64), from: '1', to: '2', claimedAt: 1, ringIndex: 1, marks: Array.from({ length: 160 }, (_, i) => ({ id: `m${i}`, userId: 'PRIVATE', text: 'moon' })) };
  const seen = [];
  for (let offset = 0; offset < 160; offset += 20) { const page = atlasSearch({ stops: [stop] }, { query: 'moon', offset, limit: 20 }); assert.equal(page.matches.length, 20); assert.equal(page.total, 160); seen.push(...page.matches); }
  assert.equal(seen.length, 160); assert.ok(!JSON.stringify(seen).includes('PRIVATE'));
  assert.equal(atlasSearch({ stops: [stop] }, { query: '.*' }).total, 0);
  assert.throws(() => atlasSearch({ stops: Array(17).fill(stop) }, { query: 'moon' }));
});
test('HTTP search sends no-store and generic failures without reflecting query or internal errors', async () => {
  const app = createApp({ state: { searchPublicMarks() { throw new Error('PRIVATE'); } } });
  const req = Readable.from([Buffer.from('{"query":"moon"}')]); req.method = 'POST'; req.url = '/api/atlas/search'; req.headers = { 'content-type': 'application/json' };
  let code, headers, body;
  await app.handler(req, { writeHead(c, h) { code = c; headers = h; }, end(b) { body = b; } });
  assert.equal(code, 503); assert.equal(headers['cache-control'], 'no-store'); assert.ok(!body.includes('PRIVATE')); assert.ok(!body.includes('moon'));
});

test('search form cannot fall back to GET and client keeps query out of navigation/storage/HTML', async () => {
  const html = await readFile('public/atlas.html', 'utf8');
  assert.match(html, /id="mark-search"[^>]*method="post"[^>]*action="\/api\/atlas\/search"/);
  assert.match(html, /id="search-query"[^>]*disabled/);
  const script = await readFile('public/atlas.js', 'utf8');
  assert.ok(script.includes('event.preventDefault()')); assert.ok(script.includes('JSON.stringify({ query, offset: searchOffset, limit: 20 })'));
  assert.ok(!/localStorage|sessionStorage|pushState|replaceState|innerHTML|console\./.test(script));
});

test('Atlas search heading has a discoverable named anchor and honest name-as-text guidance', async () => {
  const html = await readFile('public/atlas.html', 'utf8');
  assert.match(html, /href="#mark-history"[^>]*>Where has my mark been\?<\/a>/);
  assert.match(html, /id="mark-history"[^>]*aria-labelledby="search-title"/);
  assert.match(html, /id="search-title">Where has my mark been\?/);
  assert.match(html, /approved mark was a name such as Alex/);
  assert.match(html, /not a Twitch account or viewer name/);
});
test('all16 stops ×160 approved name-text entries page completely without an identity lookup', () => {
  const stops = Array.from({ length: 16 }, (_, n) => ({ stopId: (n + 1).toString(16).padStart(64, '0'), from: '1', to: '2', ringIndex: n + 1, claimedAt: n,
    marks: Array.from({ length: 160 }, (_, i) => ({ id: `m${i + 1}`, userId: 'PRIVATE_ASSOCIATION', text: 'alex' })) }));
  let offset = 0; const seen = new Set();
  do {
    const page = atlasSearch({ stops }, { query: 'alex', offset, limit: 20 });
    assert.equal(page.total, 2560); assert.equal(page.matches.length, 20);
    for (const match of page.matches) { seen.add(`${match.stopId}:${match.runeSvg}:${seen.size}`); assert.equal(match.text, 'alex'); assert.ok(!JSON.stringify(match).includes('PRIVATE_ASSOCIATION')); }
    offset = page.nextOffset;
  } while (offset !== null);
  assert.equal(seen.size, 2560);
  const empty = atlasSearch({ stops: [] }, { query: 'alex', limit: 20 }); assert.equal(empty.total, 0); assert.equal(empty.nextOffset, null);
});
