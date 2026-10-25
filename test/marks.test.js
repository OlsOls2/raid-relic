import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createApp } from '../src/app.js';
import { createMemoryState } from '../src/state.js';
import { createFirestoreStore } from '../src/store.js';
import { MARK_LIMITS, normalizeMark, runeSvg } from '../src/marks.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';

const host = '111'; const bot = '222'; const user = '987654321';
const admin = { broadcasterId: host, chatterId: host };
const viewer = { broadcasterId: host, chatterId: user };
const context = { streamId: 'trusted-stream-1', keeperId: host, optedIn: true, holdsRelic: true, blockedUserIds: [] };
const secret = 'synthetic-test-webhook-secret';
function fixture(kind) {
  const db = kind === 'firestore' ? fakeFirestore() : null;
  const store = db ? createFirestoreStore(db) : createMemoryState();
  let time = Date.parse('2026-10-25T12:00:00Z'); let sequence = 0;
  const instance = createApp({ secret, state: store, chatContext: { streamerId: host, botId: bot }, now: () => time });
  function request(text, { userId = user, badges = [], id = `chat-${++sequence}` } = {}) {
    const timestamp = new Date(time).toISOString();
    const payload = { subscription: { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: host, user_id: bot } },
      event: { broadcaster_user_id: host, chatter_user_id: userId, message_id: id, badges, message: { text, fragments: [{ type: 'text', text }] } } };
    const rawBody = Buffer.from(JSON.stringify(payload));
    const digest = createHmac('sha256', secret).update(id).update(timestamp).update(rawBody).digest('hex');
    return { method: 'POST', path: '/eventsub', rawBody, headers: { 'twitch-eventsub-message-id': id, 'twitch-eventsub-message-timestamp': timestamp,
      'twitch-eventsub-message-signature': `sha256=${digest}`, 'twitch-eventsub-message-type': 'notification' } };
  }
  return { instance, db, store, request, advance: ms => { time += ms; },
    send: (text, options) => instance.dispatch(request(text, options)),
    view: () => instance.marks.moderationView(host, admin),
    setup: override => instance.marks.setKeeperContext(host, { ...context, ...override }),
  };
}
const current = doc => doc.sessions.find(session => session.streamId === doc.context.streamId);

test('NFKC and case normalization accept a word or single emoji grapheme deterministically', () => {
  for (const [input, expected] of [['ＣＡＦÉ', 'café'], ['CAFE\u0301', 'café'], ['Straße', 'strasse'], ['ΣΟΣ', 'σοσ'], ['👩🏽‍🚀', '👩🏽‍🚀'], ['🇬🇧', '🇬🇧'], ['1️⃣', '1️⃣']]) assert.equal(normalizeMark(input), expected);
  assert.equal(runeSvg('CAFE\u0301'), runeSvg('ＣＡＦÉ'));
  assert.equal(runeSvg('Straße'), runeSvg('STRASSE'));
  assert.notEqual(runeSvg('orchid'), runeSvg('lantern'));
});
test('conservative mark filter rejects controls, HTML, links, invisible text and abusive/oversized input', () => {
  for (const input of ['', 'two words', ' orchid ', '<svg>', 'https://a', 'www', '@user', 'a/b', 'nazi', 'ＦＵＣＫ', 'a\n', '\u202Eword', 'a\u200Db', '\u0000', '\ud800', '💎💎', 'a'.repeat(33), '💎'.repeat(100)]) assert.equal(normalizeMark(input), null, JSON.stringify(input));
});
test('original rune is bounded numeric SVG geometry without text, fonts, scripts or external assets', () => {
  for (const input of ['orchid', '💎', '👩🏽‍🚀', 'مرحبا']) {
    const svg = runeSvg(input);
    assert.ok(Buffer.byteLength(svg) < 1024);
    assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" viewBox="0 0 96 96">/);
    assert.ok(!/<(?:text|image|script|foreignObject)|href=|style=|font|orchid|مرحبا/.test(svg));
    assert.equal(svg, runeSvg(input));
  }
  assert.throws(() => runeSvg('<script>'));
});

for (const kind of ['memory', 'firestore']) {
  test(`${kind}: no authoritative context, absent stream, opt-in or Keeper ownership fails closed`, async () => {
    const f = fixture(kind);
    await f.send('!mark orchid'); assert.deepEqual(await f.instance.marks.publicProjection(host), { marks: [] });
    assert.equal((await f.view()).sessions.length, 0);
    await assert.rejects(Promise.resolve().then(() => f.setup({ streamId: undefined })));
    for (const override of [{ optedIn: false }, { holdsRelic: false }, { keeperId: '444' }]) {
      await f.setup(override); await f.send('!mark orchid'); assert.equal(current(await f.view()).spent, 0);
    }
    await f.setup(); await f.send('!mark orchid'); assert.equal(current(await f.view()).spent, 1);
  });
  test(`${kind}: 30-second cooldown includes exact boundary and survives stream change`, async () => {
    const f = fixture(kind); await f.setup();
    await f.send('!mark orchid'); f.advance(29999); await f.send('!mark lantern');
    assert.equal(current(await f.view()).spent, 1);
    await f.setup({ streamId: 'trusted-stream-2' }); await f.send('!mark lantern');
    assert.equal(current(await f.view()).spent, 0);
    f.advance(1); await f.send('!mark lantern'); assert.equal(current(await f.view()).spent, 1);
  });
  test(`${kind}: mixed concurrent viewers have independent quotas without a five-community-mark ceiling`, async () => {
    const f = fixture(kind); await f.setup();
    const responses = await Promise.all(Array.from({ length: 20 }, (_, i) => f.send('!mark orchid', { userId: String(10000 + i) })));
    assert.ok(responses.every(response => response.status === 204));
    const session = current(await f.view());
    assert.equal(session.spent, 20); assert.equal(session.marks.length, 20);
    assert.ok(session.viewers.every(entry => entry.spent === 1));
    await f.setup(); assert.equal(current(await f.view()).spent, 20);
  });
  test(`${kind}: two viewers each receive five marks and sixth submissions are rejected independently`, async () => {
    const f = fixture(kind); await f.setup();
    for (let round = 0; round < 5; round++) {
      await Promise.all([f.send('!mark orchid'), f.send('!mark lantern', { userId: '555' })]);
      f.advance(30000);
    }
    await f.send('!mark amber');
    assert.equal(current(await f.view()).marks.filter(mark => mark.userId === user).length, 5);
    await f.send('!mark amber', { userId: '555' });
    const session = current(await f.view());
    assert.equal(session.marks.length, 10);
    assert.deepEqual(session.viewers.map(entry => entry.spent), [5, 5]);
    await f.setup({ streamId: 'trusted-stream-2' });
    await f.send('!mark amber'); assert.equal(current(await f.view()).spent, 1);
    await assert.rejects(Promise.resolve().then(() => f.setup()), /Closed stream/);
  });
  test(`${kind}: concurrent duplicate delivery consumes one slot and one cooldown only`, async () => {
    const f = fixture(kind); await f.setup(); const req = f.request('!mark orchid');
    const other = createApp({ secret, state: f.db ? createFirestoreStore(f.db) : f.store, chatContext: { streamerId: host, botId: bot }, now: () => Date.parse('2026-10-25T12:00:00Z') });
    await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? other : f.instance).dispatch(req)));
    const doc = await f.view(); assert.equal(current(doc).spent, 1); assert.equal(current(doc).marks.length, 1); assert.equal(doc.cooldowns.length, 1);
    f.advance(30000); await f.instance.dispatch(req); assert.equal(current(await f.view()).spent, 1);
  });
  test(`${kind}: only approved runes enter public projection, never pending text, raw IDs or pseudonyms`, async () => {
    const f = fixture(kind); await f.setup(); await f.send('!mark orchid');
    assert.deepEqual(await f.instance.marks.publicProjection(host), { marks: [] });
    const privateDoc = await f.view(); assert.equal(current(privateDoc).marks[0].text, 'orchid');
    await f.instance.marks.approve(host, admin, 'm1');
    const projection = await f.instance.marks.publicProjection(host);
    assert.deepEqual(Object.keys(projection.marks[0]).sort(), ['id', 'runeSvg']);
    const serialized = JSON.stringify(projection);
    for (const disallowed of ['orchid', user, 'userId', 'text', 'createdAt', 'cooldown']) assert.ok(!serialized.includes(disallowed));
    await assert.rejects(Promise.resolve().then(() => f.instance.marks.moderationView(host, viewer)), /Moderator/);
    privateDoc.sessions[0].marks[0].text = 'changed'; assert.equal(current(await f.view()).marks[0].text, 'orchid');
  });
  test(`${kind}: broadcaster ID and signed moderator badge authorize commands; chat text cannot grant authority`, async () => {
    const f = fixture(kind); await f.setup(); await f.send('!mark orchid');
    await f.send('!relic approve m1'); assert.equal((await f.instance.marks.publicProjection(host)).marks.length, 0);
    await f.send('!relic approve m1 moderator=true'); assert.equal((await f.instance.marks.publicProjection(host)).marks.length, 0);
    await f.send('!relic approve m1', { userId: '444', badges: [{ set_id: 'vip', id: '1' }] });
    assert.equal((await f.instance.marks.publicProjection(host)).marks.length, 0);
    await f.send('!relic approve m1', { userId: '444', badges: [{ set_id: 'moderator', id: '2' }] });
    assert.equal((await f.instance.marks.publicProjection(host)).marks.length, 0);
    await f.send('!relic approve m1', { userId: '444', badges: [{ set_id: 'moderator', id: '1' }] });
    assert.equal((await f.instance.marks.publicProjection(host)).marks.length, 1);
    await f.send('!relic pause'); assert.equal((await f.view()).paused, false);
    const forged = f.request('!relic pause', { userId: host }); forged.headers['twitch-eventsub-message-signature'] = 'sha256=' + '0'.repeat(64);
    assert.equal((await f.instance.dispatch(forged)).status, 403); assert.equal((await f.view()).paused, false);
    await f.send('!relic pause', { userId: host }); assert.equal((await f.view()).paused, true);
    await assert.rejects(Promise.resolve().then(() => f.instance.marks.vetoLast(host, viewer)), /Moderator/);
  });
  test(`${kind}: pause, configured blocked users, service block and opt-out prevent acceptance`, async () => {
    const f = fixture(kind); await f.setup({ blockedUserIds: [user] }); await f.send('!mark orchid'); assert.equal(current(await f.view()).spent, 0);
    await f.setup(); await f.instance.marks.pause(host, admin); await f.send('!mark orchid'); assert.equal(current(await f.view()).spent, 0);
    await f.instance.marks.pause(host, admin, false); await f.send('!mark orchid');
    await f.instance.marks.approve(host, admin, 'm1'); await f.instance.marks.blockUser(host, admin, user);
    assert.equal(current(await f.view()).marks.length, 0); assert.deepEqual(await f.instance.marks.publicProjection(host), { marks: [] });
    f.advance(30000); await f.send('!mark lantern'); assert.equal(current(await f.view()).spent, 1);
    await f.instance.marks.optOut(host, admin); await f.send('!mark lantern', { userId: '555' });
    assert.equal((await f.view()).context.optedIn, false); assert.equal(current(await f.view()).spent, 1);
  });
  test(`${kind}: veto is deduplicated and never refunds spent slots`, async () => {
    const f = fixture(kind); await f.setup(); await f.send('!mark orchid'); await f.send('!mark lantern', { userId: '555' });
    const veto = f.request('!relic veto-last', { userId: host }); await f.instance.dispatch(veto); await f.instance.dispatch(veto);
    assert.deepEqual(current(await f.view()).marks.map(mark => mark.id), ['m1']); assert.equal(current(await f.view()).spent, 2);
    assert.equal(current(await f.view()).viewers.find(entry => entry.userId === '555').spent, 1);
    for (let i = 0; i < 4; i++) { f.advance(30000); await f.send('!mark lantern', { userId: '555' }); }
    await f.instance.marks.vetoLast(host, admin); f.advance(30000);
    const before = current(await f.view()).spent;
    await f.send('!mark lantern', { userId: '555' }); assert.equal(current(await f.view()).spent, before);
  });
  test(`${kind}: repeated forget with no data never delays others or creates abuse records`, async () => {
    const f = fixture(kind); await f.setup(); const before = await f.view();
    for (let i = 0; i < 10; i++) await f.send('!relic forgetme');
    assert.deepEqual(await f.view(), before);
    await f.send('!mark orchid', { userId: '555' }); assert.equal(current(await f.view()).spent, 1);
    for (let i = 0; i < 10; i++) await f.send('!relic forgetme');
    await f.send('!mark lantern', { userId: '666' }); assert.equal(current(await f.view()).spent, 2);
  });
  test(`${kind}: forget cannot bypass or extend the caller's cooldown or five-mark budget`, async () => {
    const f = fixture(kind); await f.setup(); await f.send('!mark orchid');
    const initial = (await f.view()).cooldowns;
    await f.send('!relic forgetme'); f.advance(29999); await f.send('!relic forgetme');
    assert.deepEqual((await f.view()).cooldowns, initial);
    await f.send('!mark lantern'); assert.equal(current(await f.view()).spent, 1);
    await f.send('!mark amber', { userId: '555' }); assert.equal(current(await f.view()).spent, 2);
    f.advance(1); await f.send('!mark lantern');
    assert.equal(current(await f.view()).viewers.find(entry => entry.userId === user).spent, 2);
    for (let i = 0; i < 3; i++) {
      await f.send('!relic forgetme'); f.advance(30000); await f.send('!mark lantern');
    }
    await f.send('!relic forgetme'); f.advance(30000); await f.send('!relic forgetme');
    await f.send('!mark orchid');
    const session = current(await f.view());
    assert.equal(session.viewers.find(entry => entry.userId === user).spent, 5);
    assert.ok(session.marks.every(mark => mark.userId !== user));
    assert.ok((await f.view()).cooldowns.every(entry => entry.userId !== user));
    await f.instance.marks.approve(host, admin, 'm1');
    assert.deepEqual(await f.instance.marks.publicProjection(host), { marks: [] });
  });
  test(`${kind}: participant and retained-mark caps remain independent of per-viewer quota`, async () => {
    const f = fixture(kind); await f.setup();
    for (let i = 0; i < MARK_LIMITS.participantsPerStream; i++) await f.send('!mark orchid', { userId: String(10000 + i) });
    await f.send('!mark orchid', { userId: '99999' });
    assert.equal(current(await f.view()).viewers.length, MARK_LIMITS.participantsPerStream);
    for (let round = 0; round < 4; round++) {
      f.advance(30000);
      await Promise.all(Array.from({ length: MARK_LIMITS.participantsPerStream }, (_, i) => f.send('!mark orchid', { userId: String(10000 + i) })));
    }
    assert.equal(current(await f.view()).marks.length, MARK_LIMITS.marksPerStream);
    await f.setup({ streamId: 'next-stream' }); f.advance(30000); await f.send('!mark amber');
    assert.equal(current(await f.view()).spent, 0);
    assert.ok(Buffer.byteLength(JSON.stringify(await f.view())) < MARK_LIMITS.bytes);
  });
  test(`${kind}: signed block/opt-out commands require privilege and no public mutation route exists`, async () => {
    const f = fixture(kind); await f.setup(); await f.send('!mark orchid');
    await f.send(`!relic block ${user}`, { userId: '555' }); assert.equal((await f.view()).blocked.length, 0);
    await f.send(`!relic block ${user}`, { userId: host }); assert.deepEqual((await f.view()).blocked, [user]);
    await f.send('!relic opt-out', { userId: '555' }); assert.equal((await f.view()).context.optedIn, true);
    await f.send('!relic opt-out', { userId: '444', badges: [{ set_id: 'moderator', id: '1' }] });
    assert.equal((await f.view()).context.optedIn, false);
    for (const path of ['/marks', '/marks/approve', '/relic/forgetme']) assert.equal((await f.instance.dispatch({ method: 'POST', path })).status, 404);
  });
  test(`${kind}: forgetme erases self content across streams while retaining minimal abuse records`, async () => {
    const f = fixture(kind); await f.setup(); await f.send('!mark orchid'); await f.instance.marks.approve(host, admin, 'm1');
    await assert.rejects(Promise.resolve().then(() => f.instance.marks.forgetMe(host, { ...viewer, broadcasterId: '999' })), /identity required/);
    f.advance(30000); await f.setup({ streamId: 'trusted-stream-2' }); await f.send('!mark lantern');
    await f.send('!mark amber', { userId: '555' });
    await f.send(`!relic forgetme ${user}`); assert.equal(current(await f.view()).marks.length, 2);
    const forget = f.request('!relic forgetme'); await f.instance.dispatch(forget); await f.instance.dispatch(forget);
    const doc = await f.view();
    assert.ok(doc.sessions.every(session => session.marks.every(mark => mark.userId !== user)));
    assert.deepEqual(current(doc).viewers.find(entry => entry.userId === user), { userId: user, spent: 1 });
    assert.deepEqual(Object.keys(doc.cooldowns.find(entry => entry.userId === user)).sort(), ['at', 'userId']);
    assert.ok(!JSON.stringify(doc).includes('orchid') && !JSON.stringify(doc).includes('lantern'));
    assert.equal(doc.sessions[0].viewers.length, 0);
    assert.deepEqual(doc.sessions.map(session => session.spent), [1, 2]);
    assert.deepEqual(current(doc).marks.map(mark => mark.userId), ['555']);
    assert.deepEqual(await f.instance.marks.publicProjection(host), { marks: [] });
    if (f.db) assert.ok(!JSON.stringify([...f.db.docs].filter(([key]) => key.startsWith('chatReceipts/'))).includes(user));
    else assert.equal(f.store.getChatReceipt(host), undefined);
    await f.instance.marks.approve(host, admin, 'm1'); await f.instance.marks.approve(host, admin, 'm2');
    assert.deepEqual(await f.instance.marks.publicProjection(host), { marks: [] });
    await f.send('!mark amber'); assert.equal(current(await f.view()).spent, 2);
    f.advance(30000); await f.send('!mark amber'); assert.equal(current(await f.view()).spent, 3);
  });
  test(`${kind}: stream and block caps fail closed and prevent hot-document growth`, async () => {
    const f = fixture(kind);
    for (let i = 0; i < MARK_LIMITS.sessions; i++) {
      await f.setup({ streamId: `trusted-${i}` });
      for (let j = 0; j < 5; j++) await f.send('!mark orchid', { userId: String(500000 + i * 5 + j) });
    }
    await assert.rejects(Promise.resolve().then(() => f.setup({ streamId: 'overflow' })), /capacity/);
    for (let i = 0; i < MARK_LIMITS.blockedUsers; i++) await f.instance.marks.blockUser(host, admin, String(800000 + i));
    await assert.rejects(Promise.resolve().then(() => f.instance.marks.blockUser(host, admin, '999999')), /capacity/);
    assert.ok(Buffer.byteLength(JSON.stringify(await f.view())) < MARK_LIMITS.bytes);
  });
}

test('Firestore mark failure rolls back dedupe, cooldown and mark together; retry commits exactly once', async () => {
  const f = fixture('firestore'); await f.setup(); const req = f.request('!mark orchid');
  const before = structuredClone([...f.db.docs]); f.db.failCommit = true;
  await assert.rejects(f.instance.dispatch(req), /commit failure/); assert.deepEqual([...f.db.docs], before);
  f.db.failCommit = false; f.db.retry = true;
  assert.equal((await f.instance.dispatch(req)).status, 204); assert.equal((await f.instance.dispatch(req)).status, 204);
  const doc = await f.view(); assert.equal(current(doc).spent, 1); assert.equal(doc.cooldowns.length, 1);
});
test('memory event capacity failure cannot consume marks or cooldown', async () => {
  const store = createMemoryState({ maxEvents: 0 }); await store.setKeeperContext(host, context);
  assert.equal(await store.accept({ id: 'x', now: 1000, expiresAt: 2000, chat: { ...viewer, markAction: { type: 'mark', text: 'orchid' } } }), 'full');
  assert.equal(current(store.getPrivateMarks(host, admin)).spent, 0);
});
