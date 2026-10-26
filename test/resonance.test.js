import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { parseChat } from '../src/bot.js';
import { resonanceActive, validSnapshot } from '../public/overlay-client.js';
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function fixture(kind) {
  const f = await pilotFixture(kind);
  let seq = 0;
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
  }
  f.copied = (text, options = {}) =>
    f.signed(
      'channel.chat.message',
      {
        broadcaster_user_id: options.host ?? HOME,
        chatter_user_id: options.user ?? '123',
        message_id: `copied-${++seq}`,
        badges: [{ set_id: 'moderator', id: '1' }],
        source_badges: [{ set_id: 'moderator', id: '1' }],
        message: { text, fragments: [] },
        source_broadcaster_user_id: OTHER,
        source_message_id: uuid(seq),
        ...options.event,
      },
      options.host ?? HOME,
      { broadcaster_user_id: options.host ?? HOME, user_id: BOT },
      { sentAt: options.sentAt },
    );
  f.snapshot = (host = HOME) => f.runtime.overlayFeeds[host].snapshot();
  return f;
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: signed copied approved word echo is bounded decorative state only; fanout/HTTP/privacy converge`, async () => {
    const f = await fixture(kind);
    await f.chat(HOME, '811', '!mark moon');
    await f.chat(HOME, HOME, '!relic approve m1');
    const before = await f.runtime.state.getPrivateMarks(HOME, {
      broadcasterId: HOME,
      chatterId: HOME,
    });
    let pushes = 0;
    let last;
    const stop = f.runtime.overlayFeeds[HOME].subscribe((s) => {
      pushes++;
      last = s;
    });
    const providerCount = f.calls.length;
    await f.copied('ＭＯＯＮ');
    assert.equal(f.calls.length, providerCount);
    assert.equal(pushes, 1);
    assert.ok(last.resonance);
    assert.ok(validSnapshot(last));
    assert.equal(
      validSnapshot({
        ...last,
        resonance: { ...last.resonance, expiresAt: String(last.resonance.expiresAt) },
      }),
      false,
    );
    assert.equal(last.resonance.expiresAt - last.resonance.receivedAt, 1200);
    assert.deepEqual(Object.keys(last.resonance).sort(), ['expiresAt', 'id', 'receivedAt']);
    const raw = JSON.stringify(last);
    for (const secret of ['moon', 'source_message_id', 'chatterId', 'echoSeen', 'echoLastAt'])
      assert.ok(!raw.includes(secret));
    assert.deepEqual(
      await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME }),
      before,
    );
    const http = JSON.parse((await f.request(`/api/overlay/${HOME}`)).body);
    assert.deepEqual(http.resonance, last.resonance);
    assert.equal((await f.snapshot(OTHER)).resonance, undefined);
    await f.copied('moon');
    assert.equal(pushes, 1); //10s rate bound
    f.advance(1200);
    assert.equal((await f.snapshot()).resonance, undefined);
    f.advance(9000);
    await f.copied('moon', { event: { source_message_id: uuid(1) } });
    assert.equal(pushes, 1); //source-message dedupe
    await f.copied('moon');
    assert.equal(pushes, 2);
    await f.chat(HOME, '811', '!relic forgetme');
    assert.equal((await f.snapshot()).resonance, undefined);
    assert.equal((await f.snapshot()).marks.length, 0);
    f.advance(10001);
    await f.copied('moon');
    assert.equal((await f.snapshot()).resonance, undefined);
    stop();
    assert.ok(Buffer.byteLength(JSON.stringify(await f.runtime.state.getKeeperRegistry())) <= 4096);
  });
  test(`${kind}: freshness, hash TTL, privacy controls and carried fading stay independent`, async () => {
    const f = await fixture(kind);
    await f.chat(HOME, '811', '!mark moon');
    await f.chat(HOME, HOME, '!relic approve m1');
    await f.copied('moon', { sentAt: f.now() - 5001 });
    assert.equal((await f.snapshot()).resonance, undefined);
    await f.copied('moon', { sentAt: f.now() + 1 });
    assert.equal((await f.snapshot()).resonance, undefined);
    for (let n = 0; n < 10; n++) {
      f.advance(10001);
      await f.copied('moon');
    }
    const reg = await f.runtime.state.getKeeperRegistry();
    assert.ok(reg.echoSeen.length <= 8);
    assert.ok(reg.echoSeen.every((item) => item.until > f.now()));
    await f.chat(HOME, HOME, '!relic veto-last');
    assert.equal((await f.snapshot()).resonance, undefined);
    f.advance(30001);
    await f.chat(HOME, '812', '!mark moon');
    await f.chat(HOME, HOME, '!relic approve m2');
    f.advance();
    await f.raid();
    await f.chat(HOME, HOME, '!offer');
    await f.chat(OTHER, OTHER, '!accept');
    for (let n = 0; n < 3; n++) {
      f.advance();
      await f.signed('stream.offline', { broadcaster_user_id: OTHER }, OTHER);
      f.advance(1000);
      await f.signed(
        'stream.online',
        {
          broadcaster_user_id: OTHER,
          id: String(9700 + n),
          type: 'live',
          started_at: new Date(f.now()).toISOString(),
        },
        OTHER,
      );
    }
    f.advance(10001);
    await f.copied('moon', { host: OTHER, event: { source_broadcaster_user_id: HOME } });
    const snap = await f.snapshot(OTHER);
    assert.ok(snap.resonance);
    assert.equal(snap.marks[0].faded, true);
    assert.equal((await f.runtime.state.getKeeperRegistry()).carriedClosures, 3);
    await f.chat(HOME, HOME, '!relic block 812');
    assert.equal((await f.snapshot(OTHER)).resonance, undefined);
    assert.equal((await f.snapshot(OTHER)).marks.length, 0);
  });
  test(`${kind}: copied commands including foreign moderator/owner/claim text never act; originals still work`, async () => {
    const f = await fixture(kind);
    await f.chat(HOME, '811', '!mark moon');
    for (const text of [
      '!relic approve m1',
      '!relic pause',
      '!relic opt-out',
      '!relic send @olsols2',
      '!mark star',
      '!offer',
      '!accept',
      '!relic forgetme',
      '!relic veto-last',
    ]) {
      await f.copied(text, { user: HOME });
      await f.copied(text, { user: HOME, event: { source_broadcaster_user_id: '999' } });
    }
    const doc = await f.runtime.state.getPrivateMarks(HOME, {
      broadcasterId: HOME,
      chatterId: HOME,
    });
    assert.equal(doc.paused, false);
    assert.equal(doc.context.optedIn, true);
    assert.equal(doc.sessions[0].marks.length, 1);
    assert.equal(doc.sessions[0].marks[0].status, 'pending');
    assert.equal((await f.runtime.state.getKeeperRegistry()).send, undefined);
    await f.raid();
    await f.copied('!offer', { user: HOME });
    await f.copied('!accept', {
      host: OTHER,
      user: OTHER,
      event: { source_broadcaster_user_id: HOME },
    });
    assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 0);
    assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.accepts.length, 0);
    await f.chat(HOME, HOME, '!relic approve m1');
    await f.chat(HOME, HOME, '!offer');
    await f.chat(OTHER, OTHER, '!accept');
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, OTHER);
  });
  test(`${kind}: no echo for unapproved/unmatched/bot/unknown origin/offline/paused or opted out`, async () => {
    const f = await fixture(kind);
    await f.chat(HOME, '811', '!mark moon');
    await f.copied('moon');
    assert.equal((await f.snapshot()).resonance, undefined);
    assert.equal(
      (await f.copied('moon', { event: { source_message_id: 'malformed' } })).status,
      400,
    );
    assert.equal((await f.copied('moon', { event: { source_message_id: null } })).status, 400);
    await f.chat(HOME, HOME, '!relic approve m1');
    await f.chat(HOME, '123', 'moon');
    assert.equal((await f.snapshot()).resonance, undefined);
    for (const [text, opts] of [
      ['privateword', {}],
      ['moon', { user: BOT }],
      ['moon', { event: { source_broadcaster_user_id: '999' } }],
    ]) {
      await f.copied(text, opts);
      assert.equal((await f.snapshot()).resonance, undefined);
    }
    await f.control(OTHER, 'pause');
    await f.copied('moon');
    assert.equal((await f.snapshot()).resonance, undefined);
    await f.control(OTHER, 'resume');
    await f.control(OTHER, 'opt-out');
    await f.copied('moon');
    assert.equal((await f.snapshot()).resonance, undefined);
    f.advance();
    await f.control(OTHER, 'keep');
    f.advance();
    await f.signed('stream.offline', { broadcaster_user_id: OTHER }, OTHER);
    await f.copied('moon');
    assert.equal((await f.snapshot()).resonance, undefined);
  });
}
test('strict optional copied fields; absent/null preserve originals and no source badges gain authority', () => {
  const event = {
    broadcaster_user_id: HOME,
    chatter_user_id: '811',
    message_id: 'x',
    message: { text: '!mark moon', fragments: [] },
  };
  const payload = (e) => ({
    subscription: {
      type: 'channel.chat.message',
      version: '1',
      condition: { broadcaster_user_id: HOME, user_id: BOT },
    },
    event: { ...event, ...e },
  });
  const parse = (e) =>
    parseChat(payload(e), { streamerId: HOME, botId: BOT, includeMarkCommands: true });
  assert.deepEqual(parse({}), parse({ source_broadcaster_user_id: null, source_message_id: null }));
  for (const e of [
    { source_broadcaster_user_id: OTHER },
    { source_message_id: uuid(1) },
    { source_broadcaster_user_id: OTHER, source_message_id: 'invalid' },
    { source_broadcaster_user_id: 'x', source_message_id: uuid(1) },
  ])
    assert.throws(() => parse(e));
  const messageId = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
  assert.equal(
    parse({ source_broadcaster_user_id: OTHER, source_message_id: messageId }).copied.key,
    parse({ source_broadcaster_user_id: OTHER, source_message_id: messageId.toUpperCase() }).copied
      .key,
  );
  assert.equal(
    parse({
      source_broadcaster_user_id: OTHER,
      source_message_id: uuid(1),
      source_badges: [{ set_id: 'moderator', id: '1' }],
    }).markAction,
    undefined,
  );
  assert.equal(resonanceActive({ receivedAt: 100, expiresAt: 1300 }, 99), false);
  assert.equal(resonanceActive({ receivedAt: 100, expiresAt: 1300 }, 100), true);
  assert.equal(resonanceActive({ receivedAt: 100, expiresAt: 1300 }, 1300), false);
});

test('Firestore echo commit failure rolls back cue and dedupe without ledger/receipt writes', async () => {
  const f = await fixture('firestore');
  await f.chat(HOME, '811', '!mark moon');
  await f.chat(HOME, HOME, '!relic approve m1');
  f.db.writes.length = 0;
  f.db.failCommit = true;
  await assert.rejects(f.copied('moon'), /Synthetic commit failure/);
  f.db.failCommit = false;
  assert.equal((await f.snapshot()).resonance, undefined);
  await f.copied('moon');
  assert.ok((await f.snapshot()).resonance);
  assert.ok(
    f.db.writes.every((key) => key.startsWith('events/') || key.startsWith('keeperRegistry/')),
  );
});
