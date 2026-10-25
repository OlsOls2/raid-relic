import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createMarkShares, createShareReplies, reserveShare, ownHistory } from '../src/my-marks.js';
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
  test(`${kind}: signed mymarks opt-in is deduped/rate-bounded, automatic exact-request reply runs once`, async () => {
    const f = await setup(kind); const calls = f.calls.length;
    await Promise.all(Array.from({ length: 8 }, () => f.chat(HOME, '811', '!relic mymarks')));
    assert.equal(f.calls.slice(calls).filter(c => c.url.endsWith('/chat/messages')).length, 1); const row = await f.row(); assert.ok(row); assert.ok(!Buffer.from(row.token, 'base64url').includes(Buffer.from('"u":"811"')));
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
    const cross = f.runtime.shares.issue(OTHER, '811', f.now(), 'viewer811'); assert.equal((await f.page(cross.token)).status, 403);
    const forged = f.runtime.shares.issue(HOME, '999', f.now(), 'viewer999'); assert.equal((await f.page(forged.token)).status, 403);
    assert.equal((await f.page(row.token.slice(0, -3) + 'abc')).status, 403);
    f.advance(600001); assert.equal((await f.page(row.token)).status, 403);
    assert.equal((await f.request(`/api/my-marks?capability=${row.token}`, 'POST')).status, 400);
  });
}
test('capability uses a separate authenticated key context; own history pages all2560 safe stored entries', async () => {
  const a = createMarkShares({ key: Buffer.alloc(32, 3).toString('base64'), channels: [HOME], origin: 'https://test.example', now: () => 100 });
  const b = createMarkShares({ key: Buffer.alloc(32, 4).toString('base64'), channels: [HOME], origin: 'https://test.example', now: () => 100 });
  const cap = a.issue(HOME, '811', 100, 'viewer811'); assert.throws(() => b.open(cap.token)); assert.equal(a.open(cap.token).actor, '811');
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
  assert.equal(row.status, 'sent');
  // Crash at/after marked dispatch boundary: no automatic second send.
  assert.deepEqual(await f.runtime.replies.processPending(HOME), { status: 'idle' });
  assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 1);
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
  assert.equal(shares.open(shares.issue(HOME, '811', 100, 'viewer811').token).expiresAt, 600100); //receipt-based issue survives processing milliseconds
});

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: exact message hash isolates queued viewers, retries and ambiguous reply dispatch`, async () => {
    const f = await setup(kind), replies = f.runtime.replies, original = replies.processPending;
    // Durable queue exists, but simulate a request ending before the exact claim.
    replies.processPending = async () => ({ status: 'idle' });
    await f.chat(HOME, '812', '!relic mymarks');
    replies.processPending = original;
    const event = { broadcaster_user_id: HOME, chatter_user_id: '811', chatter_user_login: 'viewer811', message_id: 'stable-original', message: { text: '!relic mymarks', fragments: [] } };
    const send = () => f.signed('channel.chat.message', event, HOME, { broadcaster_user_id: HOME, user_id: BOT });
    await Promise.all(Array.from({ length: 8 }, send));
    assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 1);
    let doc = await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME });
    assert.equal(doc.shares.find(s => s.actor === '812').status, 'queued');
    assert.equal(doc.shares.find(s => s.actor === '811').status, 'sent');
    await f.chat(HOME, '811', '!relic mymarks'); //rate rejection cannot flush812
    assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 1);
    // Fresh privacy recheck before HTTP, even if the queued row was claimed.
    const get = f.runtime.state.getOwnMarks;
    f.runtime.state.getOwnMarks = async () => { throw Error('synthetic revoked'); };
    await replies.processPending(HOME);
    f.runtime.state.getOwnMarks = get;
    assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 1);
    f.advance(60001);
    // Ambiguous bot call and finalize failure never expose details or retry.
    const step = f.runtime.state.shareReplyStep;
    f.runtime.state.shareReplyStep = async (...args) => { if (args[1].type === 'finish') throw Error('synthetic commit failure'); return step(...args); };
    await f.chat(HOME, '813', '!relic mymarks');
    f.runtime.state.shareReplyStep = step;
    await replies.processPending(HOME);
    doc = await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME });
    assert.equal(doc.shares.find(s => s.actor === '813').status, 'dispatching');
    assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 2);
  });
}

for (const kind of ['memory', 'firestore']) test(`${kind}: failed chat POST is marked unknown and never retried`, async () => {
  const f = await setup(kind); f.runtime.replies.processPending = async () => ({ status: 'idle' });
  await f.chat(HOME, '811', '!relic mymarks'); const row = await f.row(); let posts = 0;
  const service = createShareReplies({ state: f.runtime.state, shares: f.runtime.shares, now: f.now,
    bots: { [HOME]: { async sendChat(_message, options) { assert.equal(options.retryUnauthorized, false); posts++; throw Error('synthetic timeout'); } } } });
  assert.deepEqual(await service.processPending(HOME, row.requestHash), { status: 'unknown' });
  assert.deepEqual(await service.processPending(HOME, row.requestHash), { status: 'idle' });
  assert.deepEqual(await service.processPending(HOME, '0'.repeat(64)), { status: 'idle' });
  assert.equal(posts, 1); assert.equal((await f.row()).status, 'unknown');
});

for (const kind of ['memory', 'firestore']) test(`${kind}: signed self-login joins immutable author ID, denies name claims and revokes renamed/reused aliases`, async () => {
  const f = await setup(kind); let n = 0;
  const command = (actor, login, text = '!relic mymarks', extra = {}) => f.signed('channel.chat.message', {
    broadcaster_user_id: HOME, chatter_user_id: actor, chatter_user_login: login, chatter_user_name: 'Viewer811', message_id: `named-${++n}`,
    message: { text, fragments: [] }, ...extra }, HOME, { broadcaster_user_id: HOME, user_id: BOT });
  const page = (token, fields = {}) => f.request('/api/my-marks', 'POST', { 'content-type': 'application/json' }, Buffer.from(JSON.stringify({ capability: token, ...fields })));
  for (const login of [undefined, '', '@viewer811', 'bad name', 'écho', 'a'.repeat(26)]) await command('811', login);
  await command('811', 'viewer811', '!relic mymarks @other');
  await command(BOT, 'viewer811');
  await command('811', 'viewer811', '!relic mymarks', { source_broadcaster_user_id: OTHER, source_message_id: '00000000-0000-4000-8000-000000000001' });
  assert.equal(await f.row(), undefined);
  await Promise.all([command('811', 'VIEWER811', '!relic mymarks @ViEwEr811'), command('811', 'viewer811')]);
  const first = await f.row(); assert.equal(first.login, 'viewer811');
  let response = await page(first.token, { login: '@VIEWER811' }); assert.equal(response.status, 200);
  let data = JSON.parse(response.body); assert.equal(data.login, 'viewer811'); assert.equal(data.total, 1); assert.equal(data.matches[0].text, 'moon'); //not username text
  assert.ok(!response.body.includes('userId')); assert.ok(!response.body.includes('"actor"')); assert.ok(!response.body.includes('"811"'));
  for (const fields of [{ login: 'other' }, { login: null }, { login: '' }, { login: 'bad name' }, { actor: '811' }, { limit: 21 }]) assert.equal((await page(first.token, fields)).status, 403);
  assert.equal((await page(undefined, { login: 'viewer811' })).status, 403);
  f.advance(60001); await command('811', 'renamed');
  assert.equal((await page(first.token)).status, 403);
  let doc = await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME });
  const renamed = doc.shares.find(s => s.actor === '811');
  assert.equal(JSON.parse((await page(renamed.token)).body).total, 1); //same ID retains own archive
  await command('999', 'viewer811'); doc = await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME });
  const reused = doc.shares.find(s => s.actor === '999'); assert.equal(JSON.parse((await page(reused.token)).body).total, 0);
  await command('811', 'renamed', '!relic forgetme'); assert.equal((await page(renamed.token)).status, 403);
  assert.equal(JSON.parse((await page(reused.token)).body).total, 0);
  assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 3);
});

for (const kind of ['memory', 'firestore']) test(`${kind}: named share is immediately revoked by known block without association resurrection`, async () => {
  const f = await setup(kind); await f.chat(HOME, '811', '!relic mymarks @VIEWER811'); const row = await f.row();
  assert.equal(JSON.parse((await f.page(row.token)).body).login, 'viewer811');
  await f.runtime.state.setChannelPolicy(HOME, { banned: false, blockedUserIds: ['811'] }, f.now());
  assert.equal((await f.page(row.token)).status, 403);
  await f.runtime.state.setChannelPolicy(HOME, { banned: false, blockedUserIds: [] }, f.now());
  assert.equal((await f.page(row.token)).status, 403);
  assert.equal((await f.runtime.state.getPublicJourney()).stops[0].marks?.length ?? 0, 0);
});

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: rename then original payload replay preserves current grant and one-dispatch receipt`, async () => {
    const f = await setup(kind);
    const command = (login, messageId) => f.signed('channel.chat.message', { broadcaster_user_id: HOME, chatter_user_id: '811',
      chatter_user_login: login, message_id: messageId, message: { text: '!relic mymarks', fragments: [] } }, HOME, { broadcaster_user_id: HOME, user_id: BOT });
    await command('old_name', 'stable-original'); f.advance(60001);
    await command('new_name', 'new-command'); const current = await f.row();
    f.advance(60001); await Promise.all([command('old_name', 'stable-original'), command('old_name', 'stable-original')]);
    assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 2);
    assert.equal((await f.row()).login, 'new_name'); assert.equal((await f.page(current.token)).status, 200);
    const doc = await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME });
    assert.equal(doc.shareReceipts.length, 2);
    for (const row of doc.shareReceipts) { assert.deepEqual(Object.keys(row).sort(), ['expiresAt', 'key']); assert.match(row.key, /^[a-f0-9]{64}$/); }
  });
  for (const revoke of ['forget', 'ban', 'lifecycle']) test(`${kind}: ${revoke} cannot erase reply receipt or let old chat recreate aliases`, async () => {
    const f = await setup(kind);
    const event = { broadcaster_user_id: HOME, chatter_user_id: '811', chatter_user_login: 'old_name', message_id: 'retained-request', message: { text: '!relic mymarks', fragments: [] } };
    const send = () => f.signed('channel.chat.message', event, HOME, { broadcaster_user_id: HOME, user_id: BOT });
    await send();
    if (revoke === 'forget') await f.chat(HOME, '811', '!relic forgetme');
    if (revoke === 'ban') {
      await f.runtime.state.setChannelPolicy(HOME, { banned: false, blockedUserIds: ['811'] }, f.now());
      await f.runtime.state.setChannelPolicy(HOME, { banned: false, blockedUserIds: [] }, f.now());
    }
    if (revoke === 'lifecycle') await f.signed('stream.offline', { broadcaster_user_id: HOME }, HOME);
    f.advance(60001); await send();
    assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 1);
    const doc = await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME });
    assert.equal(doc.shares?.length ?? 0, 0); assert.equal(doc.shareReceipts.length, 1);
    assert.ok(!JSON.stringify(doc.shareReceipts).includes('old_name'));
  });
  test(`${kind}: rate-rejected replay remains rejected after cooldown and cannot flush another row`, async () => {
    const f = await setup(kind); await f.chat(HOME, '811', '!relic mymarks');
    const event = { broadcaster_user_id: HOME, chatter_user_id: '811', chatter_user_login: 'viewer811', message_id: 'rate-rejected', message: { text: '!relic mymarks', fragments: [] } };
    const send = () => f.signed('channel.chat.message', event, HOME, { broadcaster_user_id: HOME, user_id: BOT });
    await send(); const process = f.runtime.replies.processPending;
    f.runtime.replies.processPending = async () => ({ status: 'idle' }); await f.chat(HOME, '812', '!relic mymarks'); f.runtime.replies.processPending = process;
    f.advance(60001); await send();
    assert.equal(f.calls.filter(c => c.url.endsWith('/chat/messages')).length, 1);
    const doc = await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME });
    assert.equal(doc.shares.find(s => s.actor === '812').status, 'queued');
    assert.equal(doc.shareReceipts.length, 3);
  });
}

test('minimal share receipts cap128, prune expired hashes, and fail closed at the128KiB document bound', () => {
  const now = 1000000, chat = { broadcasterId: HOME, chatterId: '811', messageId: 'new', markAction: { type: 'mymarks' } };
  const receipts = Array.from({ length: 128 }, (_, n) => ({ key: String(n).padStart(64, '0'), expiresAt: now + 600000 }));
  assert.throws(() => reserveShare({ shareReceipts: receipts }, null, chat, undefined, now), /receipt capacity/);
  const pruned = reserveShare({ shareReceipts: receipts, blocked: [] }, null, chat, undefined, now + 600001);
  assert.equal(pruned.shareReceipts.length, 1);
  assert.throws(() => reserveShare({ padding: 'x'.repeat(131072) }, null, chat, undefined, now), /storage capacity/);
  assert.equal(receipts.length, 128);
});
