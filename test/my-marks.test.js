import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createMarkShares, ownHistory } from '../src/my-marks.js';
import { readFile } from 'node:fs/promises';
async function setup(kind) {
  const f = await pilotFixture(kind); for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) { await f.control(id, 'bootstrap'); f.advance(); await f.control(id, 'keep'); }
  await f.chat(HOME, '811', '!mark moon'); await f.chat(HOME, HOME, '!relic approve m1');
  await f.chat(HOME, '812', '!mark private'); f.advance(); await f.raid(); await f.chat(HOME, HOME, '!offer'); await f.chat(OTHER, OTHER, '!accept');
  f.page = token => f.request('/api/my-marks', 'POST', { 'content-type': 'application/json' }, Buffer.from(JSON.stringify({ capability: token })));
  f.row = async () => (await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME })).shares?.[0];
  return f;
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: signed mymarks opt-in is deduped/rate-bounded, no webhook HTTP; explicit own request replies once`, async () => {
    const f = await setup(kind); const calls = f.calls.length;
    await Promise.all(Array.from({ length: 8 }, () => f.chat(HOME, '811', '!relic mymarks')));
    assert.equal(f.calls.length, calls); const row = await f.row(); assert.ok(row); assert.ok(!Buffer.from(row.token, 'base64url').includes(Buffer.from('"u":"811"')));
    const record = await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME }); assert.equal(record.shares.length, 1);
    const page = JSON.parse((await f.page(row.token)).body); assert.equal(page.total, 1); assert.equal(page.matches[0].text, 'moon');
    for (const forbidden of ['userId', 'actor', 'nonce', 'private', 'capability']) assert.ok(!JSON.stringify(page).includes(forbidden));
    const responses = await Promise.all([f.control(HOME, 'mark-links'), f.control(HOME, 'mark-links')]); assert.ok(responses.every(r => r.status === 200));
    const replies = f.calls.filter(c => c.url.endsWith('/chat/messages')); assert.equal(replies.length, 1);
    const message = JSON.parse(replies[0].body).message; assert.ok(message.includes('PUBLIC CHAT')); assert.ok(message.includes('/my-marks#')); assert.ok(message.length <= 500);
    assert.equal(replies[0].headers.Authorization, `Bearer access-${BOT}`);
    await f.chat(HOME, '811', '!relic forgetme'); assert.equal((await f.page(row.token)).status, 403);
    await f.chat(HOME, '811', '!relic mymarks'); assert.equal(await f.row(), undefined); //forget doesn't refund reply cooldown
  });
  test(`${kind}: scope, tamper, expiry, copied and bot commands fail closed; own filtered text never pending`, async () => {
    const f = await setup(kind);
    await f.chat(HOME, BOT, '!relic mymarks'); assert.equal(await f.row(), undefined);
    await f.signed('channel.chat.message', { broadcaster_user_id: HOME, chatter_user_id: '811', message_id: 'copied', source_broadcaster_user_id: OTHER,
      source_message_id: '00000000-0000-4000-8000-000000000001', message: { text: '!relic mymarks', fragments: [] } }, HOME, { broadcaster_user_id: HOME, user_id: BOT });
    assert.equal(await f.row(), undefined);
    await f.chat(HOME, '811', '!relic mymarks'); const row = await f.row();
    const cross = f.runtime.shares.issue(OTHER, '811'); assert.equal((await f.page(cross.token)).status, 403);
    const forged = f.runtime.shares.issue(HOME, '999'); assert.equal((await f.page(forged.token)).status, 403);
    assert.equal((await f.page(row.token.slice(0, -3) + 'abc')).status, 403);
    f.advance(600001); assert.equal((await f.page(row.token)).status, 403);
    assert.equal((await f.request(`/api/my-marks?capability=${row.token}`, 'POST')).status, 400);
  });
}
test('capability uses a separate authenticated key context; own history pages all2560 safe stored entries', async () => {
  const a = createMarkShares({ key: Buffer.alloc(32, 3).toString('base64'), channels: [HOME], origin: 'https://test.example', now: () => 100 });
  const b = createMarkShares({ key: Buffer.alloc(32, 4).toString('base64'), channels: [HOME], origin: 'https://test.example', now: () => 100 });
  const cap = a.issue(HOME, '811'); assert.throws(() => b.open(cap.token)); assert.equal(a.open(cap.token).actor, '811');
  const stops = Array.from({ length: 16 }, (_, n) => ({ from: HOME, to: OTHER, stopId: String(n), claimedAt: n, ringIndex: n + 1,
    marks: Array.from({ length: 160 }, () => ({ userId: '811', text: 'moon' })) }));
  for (let n = 0; n < 2560; n += 20) assert.equal(ownHistory({ stops }, HOME, '811', n).matches.length, 20);
  assert.throws(() => ownHistory({ stops }, HOME, '811', 0, 21)); assert.equal(ownHistory({ stops }, HOME, '812').total, 0);
  const js = await readFile('public/my-marks.js', 'utf8'); assert.match(js, /history.replaceState/); assert.ok(!/innerHTML|localStorage|sessionStorage|console\./.test(js));
});

test('Firestore share reservation rollback and reply crash stay at most once', async () => {
  const f = await setup('firestore'); f.db.failCommit = true;
  await assert.rejects(f.chat(HOME, '811', '!relic mymarks')); f.db.failCommit = false; assert.equal(await f.row(), undefined);
  await f.chat(HOME, '811', '!relic mymarks'); const row = await f.row();
  const claim = await f.runtime.state.shareReplyStep(HOME, { type: 'claim' }, f.now()); assert.equal(claim.nonce, row.nonce);
  // Crash at/after marked dispatch boundary: no automatic second send.
  assert.deepEqual(await f.runtime.replies.processPending(HOME), { status: 'idle' });
  assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 0);
});

test('shared-history HTTP boundary is no-store/no-referrer, rejects invalid paging and clears revoked capability', async () => {
  const { Readable } = await import('node:stream'); const f = await setup('firestore'); await f.chat(HOME, '811', '!relic mymarks'); const row = await f.row();
  async function http() {
    const req = Readable.from([Buffer.from(JSON.stringify({ capability: row.token }))]); req.url = '/api/my-marks'; req.method = 'POST'; req.headers = { 'content-type': 'application/json' };
    const result = {}; await f.runtime.handler(req, { writeHead(code, headers) { result.code = code; result.headers = headers; }, end(body) { result.body = body; } }); return result;
  }
  const result = await http(); assert.equal(result.code, 200); assert.equal(result.headers['cache-control'], 'no-store'); assert.equal(result.headers['referrer-policy'], 'no-referrer');
  const before = f.db.reads.length;
  for (const value of [{ offset: null }, { limit: 21 }, { limit: null }, { actor: '811' }, { offset: 2561 }]) assert.equal((await f.request('/api/my-marks', 'POST', { 'content-type': 'application/json' }, Buffer.from(JSON.stringify({ capability: row.token, ...value })))).status, 403);
  assert.equal(f.db.reads.length, before);
  await f.chat(HOME, '811', '!relic forgetme'); const gone = await http(); assert.equal(gone.code, 403); assert.equal(gone.headers['cache-control'], 'no-store'); assert.ok(!gone.body.includes('moon'));
  const shares = createMarkShares({ key: Buffer.alloc(32, 3).toString('base64'), channels: [HOME], origin: 'https://test.example', now: () => 101 });
  assert.equal(shares.open(shares.issue(HOME, '811', 100).token).expiresAt, 600100); //receipt-based issue survives processing milliseconds
});
