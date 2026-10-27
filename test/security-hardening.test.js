import test from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryState } from '../src/state.js';
import { createFirestoreStore } from '../src/store.js';
import { fakeFirestore } from '../test-support/fake-firestore.js';
import { reduceScores } from '../src/scoreboard.js';
import { ackDocument, ackStep, completionAck } from '../src/claim-ack.js';
import { reserveShare } from '../src/my-marks.js';
import { updatePresence, revokePresenceActor, presenceKey } from '../src/presence.js';
import { reduceLifecycle, emptyRegistry } from '../src/lifecycle.js';
import { reduceMark, setMarkContext, markReviewPolicy } from '../src/marks.js';
import { hash } from '../src/crypto.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';

// Post-fix regressions retain the bounded baseline scenarios and assert isolation.
// No HTTP/provider transport is needed: these are the actual transaction/reducer
// interfaces after signature parsing. They do NOT establish signed end-to-end delivery.
const NOW = 1800000000000;
const ROOMS = ['201', '202'];
const chat = (host, actor, messageId, type) => ({
  broadcasterId: host,
  chatterId: actor,
  chatterLogin: actor === '101' ? 'sample_a' : 'sample_b',
  messageId,
  isBot: false,
  copied: false,
  ...(type ? { markAction: { type } } : {}),
});
const dummyShare = (actor, login) => ({
  host: '201',
  actor,
  login,
  nonce: `dummy-${actor}`,
  token: `dummy-${actor}`,
  expiresAt: NOW + 600000,
});
function liveRoom(host) {
  const online = reduceLifecycle({
    registry: emptyRegistry(),
    host,
    now: NOW - 2,
    sentAt: NOW - 2,
    event: {
      type: 'online',
      host,
      streamId: host + '01',
      startedAt: NOW - 2,
      sentAt: NOW - 2,
    },
  });
  return reduceLifecycle({
    ...online,
    host,
    now: NOW - 1,
    sentAt: NOW - 1,
    chat: chat(host, host, 'setup', 'keep'),
  });
}
const rooms = Object.fromEntries(ROOMS.map((host) => [host, liveRoom(host)]));
const channels = Object.fromEntries(ROOMS.map((h) => [h, rooms[h].channel]));
const marks = Object.fromEntries(ROOMS.map((h) => [h, rooms[h].marks]));

test('security regression score receipts: one actor cannot exhaust another room before its reply budget', () => {
  for (const host of ROOMS) {
    assert.equal(channels[host].online, true);
    assert.equal(channels[host].streamId, host + '01');
    assert.equal(marks[host].context.optedIn, true);
    const control = reduceScores(undefined, {
      channels,
      marks,
      now: NOW,
      chat: chat(host, '102', `unflooded-${host}`, 'scores-status'),
    });
    assert.equal(control.reason, 'queued');
    assert.equal(typeof control.message, 'string');
    assert.ok(control.message.length > 0);
  }
  let previous;
  for (let i = 0; i < 128; i++) {
    const next = reduceScores(previous, {
      channels,
      marks,
      now: NOW,
      chat: chat('201', '101', `score-${i}`, 'scores-status'),
    });
    if (i > 2) assert.ok(['cooldown-quiet', 'budget'].includes(next.reason));
    previous = next.doc;
  }
  assert.equal(previous.receipts.length, 8);
  const denied = reduceScores(previous, {
    channels,
    marks,
    now: NOW,
    chat: chat('202', '102', 'other-room', 'scores-status'),
  });
  assert.equal(denied.reason, 'queued');
  assert.ok(denied.message.length > 0);
  assert.equal(previous.replyBudget.channels['202'], undefined);
});

test('security regression ignored ACKs leave room for earned completion', () => {
  let previous;
  for (let i = 0; i < 128; i++)
    previous = ackDocument(
      previous,
      chat('201', '101', `offer-${i}`, 'offer'),
      null,
      channels['201'],
      marks['201'],
      NOW,
    );
  assert.equal(previous.rows.length, 8);
  assert.ok(previous.rows.every((r) => r.status === 'ignored'));
  // Only the exported completion reservation is exercised here, NOT a verified claim.
  const reserved = completionAck(
    previous,
    '201',
    'completed-dummy',
    NOW + 90000,
    NOW,
    { from: '201', to: '202' },
    channels,
    { 201: 'sample_room_a', 202: 'sample_room_b' },
  );
  assert.ok(reserved.key);
  assert.equal(reserved.doc.rows.length, 9);
});

test('security regression unsuccessful sharing is bounded per actor', () => {
  let doc = marks['201'];
  for (let i = 0; i < 128; i++)
    doc = reserveShare(
      doc,
      { stops: [] },
      chat('201', '101', `share-${i}`, 'mymarks'),
      dummyShare('101', 'sample_a'),
      NOW,
    );
  assert.equal(doc.shareReceipts.length, 8);
  assert.equal(doc.shares.length, 1);
  const before = structuredClone(doc);
  const other = chat('201', '102', 'other-share', 'mymarks');
  const shared = reserveShare(
    doc,
    { stops: [] },
    other,
    {
      host: '201',
      actor: '102',
      login: 'sample_b',
      nonce: 'dummy-nonce',
      token: 'dummy-token',
      expiresAt: NOW + 600000,
    },
    NOW,
  );
  assert.equal(shared.shares.length, 2);
  assert.ok(shared.shares.some((s) => s.actor === '102'));
  assert.deepEqual(doc, before);
  // A duplicate is still recognized before the full-capacity rejection.
  assert.deepEqual(
    reserveShare(doc, { stops: [] }, chat('201', '101', 'share-0', 'mymarks'), null, NOW),
    doc,
  );
});

async function fixture(kind) {
  const db = kind === 'firestore' ? fakeFirestore() : null;
  const options = {
    lifecycle: { channels: ROOMS, logins: { sample_room_a: '201', sample_room_b: '202' } },
  };
  const state = db ? createFirestoreStore(db, options) : createMemoryState(options);
  let serial = 0;
  const accept = (host, actor, type, at = NOW, share) =>
    state.accept({
      id: `dummy-${++serial}`,
      expiresAt: NOW + 600000,
      now: at,
      sentAt: at,
      chat: chat(host, actor, `message-${serial}`, type),
      share,
    });
  for (const host of ROOMS) {
    await state.accept({
      id: `online-${host}`,
      expiresAt: NOW + 600000,
      now: NOW - 20,
      sentAt: NOW - 20,
      lifecycle: {
        type: 'online',
        host,
        streamId: host + '01',
        startedAt: NOW - 20,
        sentAt: NOW - 20,
      },
    });
  }
  for (const host of ROOMS) await accept(host, host, 'keep', NOW - 10);
  // Ordinary original chat occurs strictly after consent and any privacy
  // watermark. KEEP itself need not qualify as a presence proof.
  const ordinary = new Map();
  for (const host of ROOMS) {
    const nextChat = chat(host, host, `message-${serial + 1}`);
    const priorProof = db?.docs.get(`events/${hash(presenceKey(nextChat))}`);
    const before = db?.docs.get(`presence/${hash(host)}`);
    const ownerBefore = before?.actors.find((a) => a.id === host);
    if (db) {
      assert.ok(before.actors.length <= 1);
      assert.ok(before.actors.every((a) => a.id === host));
      if (ownerBefore) {
        const channelBefore = await state.getStreamStatus(host);
        assert.equal(ownerBefore.id, host);
        assert.ok(ownerBefore.seenAt >= channelBefore.consentAt);
        assert.ok(ownerBefore.seenAt <= NOW - 5);
        assert.equal(ownerBefore.seenAt, NOW - 10);
      }
    }
    const result = await accept(host, host, undefined, NOW - 5);
    ordinary.set(host, {
      closedAcceptOutcome: ['accepted', 'duplicate', 'full'].includes(result) ? result : 'other',
      proofSeenBoolean: Boolean(priorProof && priorProof.expiresAt >= NOW - 5),
      ownerBeforeOffset: ownerBefore ? ownerBefore.seenAt - NOW : null,
    });
  }
  for (const host of ROOMS) {
    const channel = await state.getStreamStatus(host);
    const doc = await state.getPrivateMarks(host, chat(host, host, 'setup-read'));
    assert.equal(channel.online, true);
    assert.equal(channel.streamId, host + '01');
    assert.equal(channel.startedAt, NOW - 20);
    assert.equal(channel.optedIn, true);
    assert.equal(channel.consentAt, NOW - 10);
    assert.equal(channel.paused, false);
    assert.equal(channel.banned, false);
    assert.equal(doc.context.streamId, channel.streamId);
    assert.equal(doc.context.optedIn, true);
    assert.equal(doc.paused, false);
    // There is no public presence getter in the memory implementation. Check
    // eligibility with the actual reducer; inspect persisted state only where
    // the fake Firestore fixture exposes it.
    const proof = updatePresence(
      null,
      host,
      channel,
      doc,
      chat(host, '102', 'eligibility-control'),
      NOW,
      NOW,
    );
    assert.deepEqual(proof.actors, [{ id: '102', seenAt: NOW }]);
    if (db) {
      const presence = db.docs.get(`presence/${hash(host)}`);
      assert.equal(presence.streamId, channel.streamId);
      const known = ['201', '202', '101', '102'];
      const owner = presence.actors.find((a) => a.id === host);
      // Closed, finite diagnostic: no arbitrary actor IDs, text or grant data.
      // Expected first-seen time comes from the independently validated snapshot
      // taken before ordinary chat, never from the post-chat result.
      assert.deepEqual(
        {
          host,
          actorCount: presence.actors.length,
          onlyDummyIds: presence.actors
            .filter((a) => known.includes(a.id))
            .map((a) => a.id)
            .sort(),
          otherActorCount: presence.actors.filter((a) => !known.includes(a.id)).length,
          notBeforeOffset: Number.isFinite(presence.notBefore) ? presence.notBefore - NOW : null,
          ownerSeenAtOffset: owner ? owner.seenAt - NOW : null,
          channelOnline: channel.online,
          channelOptedIn: channel.optedIn,
          channelPaused: channel.paused,
          channelBanned: channel.banned,
          marksOptedIn: doc.context.optedIn,
          marksPaused: doc.paused,
          streamMatches: presence.streamId === channel.streamId,
          revokedBoolean: (presence.revocations ?? []).some(
            (r) => r.key === hash(JSON.stringify([host, host])) && NOW - 5 <= r.through,
          ),
          ...ordinary.get(host),
        },
        {
          host,
          actorCount: 1,
          onlyDummyIds: [host],
          otherActorCount: 0,
          // Room 202 remains opted out during room 201's KEEP at NOW-10.
          notBeforeOffset: host === '201' ? -20 : -10,
          ownerSeenAtOffset: ordinary.get(host).ownerBeforeOffset ?? -5,
          channelOnline: true,
          channelOptedIn: true,
          channelPaused: false,
          channelBanned: false,
          marksOptedIn: true,
          marksPaused: false,
          streamMatches: true,
          revokedBoolean: false,
          closedAcceptOutcome: 'accepted',
          proofSeenBoolean: false,
          ownerBeforeOffset: ordinary.get(host).ownerBeforeOffset,
        },
      );
    }
  }
  assert.equal((await state.getKeeperRegistry()).holderId, null);
  return { state, db, accept };
}

for (const kind of ['memory', 'firestore']) {
  test(`security regression ${kind}: full presence permits direct commands without adding proof`, async () => {
    const f = await fixture(kind);
    // KEEP or the later ordinary chat established exactly one owner actor.
    for (let i = 0; i < 255; i++) await f.accept('201', String(1000 + i));
    await assert.doesNotReject(async () => f.accept('201', '1000'));
    if (f.db) {
      const presence = f.db.docs.get(`presence/${hash('201')}`);
      assert.equal(presence.actors.length, 256);
      assert.equal(
        presence.actors.some((a) => a.id === '101'),
        false,
      );
    }
    const reply = await f.accept('201', '101', 'scores-status');
    assert.equal(reply.commandReply.reason, 'queued');
    if (f.db) {
      const saturated = f.db.docs.get(`presence/${hash('201')}`);
      assert.equal(saturated.actors.length, 256);
      assert.equal(
        saturated.actors.some((a) => a.id === '101'),
        false,
      );
    }
    await assert.doesNotReject(async () => f.accept('201', '1000'));
    assert.equal((await f.state.getStreamStatus('202')).optedIn, true);
  });

  test(`security regression ${kind}: full revocations allow forget with conservative invalidation`, async () => {
    const f = await fixture(kind);
    for (let i = 0; i < 256; i++) await f.accept('201', String(2000 + i), 'forgetme');
    const before = await f.state.getPrivateMarks('201', chat('201', '201', 'private-read'));
    await assert.doesNotReject(async () => f.accept('201', '102', 'forgetme'));
    assert.deepEqual(
      await f.state.getPrivateMarks('201', chat('201', '201', 'private-read')),
      before,
    );
    if (f.db) {
      const presence = f.db.docs.get(`presence/${hash('201')}`);
      assert.ok(presence.revocations.length <= 256);
      assert.equal(presence.notBefore, NOW);
      assert.equal(presence.actors.length, 0);
      assert.equal(
        presence.revocations.some((r) => r.key === hash(JSON.stringify(['201', '102']))),
        true,
      );
    }
    // These dummy rooms never originate a relic: no retained-content erasure
    // or memory partial-mutation conclusion follows from this empty-mark case.
  });
}

test('security regression privacy erasure retains quota and invalidates delayed proof at capacity', () => {
  const policy = markReviewPolicy({ MARK_AUTO_APPROVE_ENABLED: 'true' });
  let doc = setMarkContext(null, '201', {
    streamId: '20101',
    keeperId: '201',
    optedIn: true,
    holdsRelic: true,
    blockedUserIds: [],
  });
  const actor = chat('201', '102', 'approved-mark', 'mark');
  doc = reduceMark(doc, '201', actor, { type: 'mark', text: 'moon' }, NOW, policy);
  assert.equal(doc.sessions[0].marks.length, 1);
  const erased = reduceMark(doc, '201', actor, { type: 'forgetme' }, NOW + 1, policy);
  assert.equal(erased.sessions[0].marks.length, 0);
  assert.equal(erased.sessions[0].viewers[0].spent, 1);
  let presence = updatePresence(null, '201', channels['201'], marks['201'], null, NOW, NOW);
  for (let i = 0; i < 256; i++)
    presence = revokePresenceActor(presence, '201', String(3000 + i), NOW);
  presence = revokePresenceActor(presence, '201', '102', NOW);
  assert.equal(presence.notBefore, NOW);
  assert.equal(presence.actors.length, 0);
  const delayed = updatePresence(
    presence,
    '201',
    channels['201'],
    marks['201'],
    chat('201', '102', 'delayed'),
    NOW + 1,
    NOW,
  );
  assert.equal(delayed.actors.length, 0);
  assert.equal(doc.sessions[0].marks.length, 1);
});

for (const kind of ['memory', 'firestore']) {
  test(`security regression ${kind}: real accept score receipts preserve another room`, async () => {
    const control = await fixture(kind);
    for (const host of ROOMS) {
      const reply = await control.accept(host, '102', 'scores-status');
      assert.equal(reply.commandReply.reason, 'queued');
    }
    const f = await fixture(kind);
    for (let i = 0; i < 128; i++) await f.accept('201', '101', 'scores-status');
    const denied = await f.accept('202', '102', 'scores-status');
    assert.equal(denied.commandReply.reason, 'queued');
  });

  test(`security regression ${kind}: no active offer cannot exhaust completion reservation`, async () => {
    const f = await fixture(kind);
    for (let i = 0; i < 128; i++) await f.accept('201', '101', 'offer');
    const ack = await f.state.getPrivateClaimAcks('201');
    assert.equal(ack.rows.length, 8);
    assert.ok(ack.rows.filter((r) => r.status === 'ignored').length >= 7);
    const result = completionAck(
      ack,
      '201',
      'dummy-completion',
      NOW + 90000,
      NOW,
      { from: '201', to: '202' },
      channels,
      { 201: 'sample_room_a', 202: 'sample_room_b' },
    );
    assert.ok(result.key);
  });

  test(`security regression ${kind}: unsuccessful sharing transactions preserve another actor`, async () => {
    const f = await fixture(kind);
    for (let i = 0; i < 128; i++)
      await f.accept('201', '101', 'mymarks', NOW, dummyShare('101', 'sample_a'));
    const doc = await f.state.getPrivateMarks('201', chat('201', '201', 'read'));
    assert.equal(doc.shareReceipts.length, 8);
    await assert.doesNotReject(async () =>
      f.accept('201', '102', 'mymarks', NOW, dummyShare('102', 'sample_b')),
    );
    const next = await f.state.getPrivateMarks('201', chat('201', '201', 'read-next'));
    assert.equal(next.shareReceipts.length, 9);
  });
}

test('security regression firestore: full revocations permit retained-content erasure', async () => {
  const f = await fixture('firestore');
  for (let i = 0; i < 256; i++) await f.accept('201', String(4000 + i), 'forgetme');
  // Explicit bounded initial-holder fixture, not a claim/raid or fabricated DTO:
  // use the actual context and mark constructors and keep registry/context coherent.
  const registry = { ...emptyRegistry(), holderId: '201', originated: true };
  let doc = setMarkContext(
    await f.state.getPrivateMarks('201', chat('201', '201', 'read')),
    '201',
    {
      streamId: '20101',
      keeperId: '201',
      optedIn: true,
      holdsRelic: true,
      blockedUserIds: [],
    },
  );
  doc = reduceMark(
    doc,
    '201',
    chat('201', '102', 'retained', 'mark'),
    { type: 'mark', text: 'moon' },
    NOW,
    markReviewPolicy({ MARK_AUTO_APPROVE_ENABLED: 'true' }),
  );
  assert.equal(doc.sessions[0].marks[0].status, 'approved');
  f.db.docs.set(`keeperRegistry/${hash('single')}`, structuredClone(registry));
  f.db.docs.set(`markChannels/${hash('201')}`, structuredClone(doc));
  await assert.doesNotReject(async () => f.accept('201', '102', 'forgetme'));
  const retained = await f.state.getPrivateMarks('201', chat('201', '201', 'read-after'));
  assert.equal(retained.sessions[0].marks.length, 0);
  assert.equal(retained.sessions[0].viewers[0].spent, 1);
});

for (const kind of ['memory', 'firestore']) {
  test(`security regression ${kind}: signed mock completion survives spam; full revocations cannot retain archived content`, async () => {
    // Existing provider transport is entirely mocked; configured identities here
    // are fixture constants, never real login, chat or raid operations.
    const f = await pilotFixture(kind, {
      chronicleEnv: { MARK_AUTO_APPROVE_ENABLED: 'true' },
    });
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      f.streams.get(id).viewer_count = 1;
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    for (let i = 0; i < 128; i++) await f.chat(HOME, '101', '!offer');
    await f.chat(HOME, '102', '!mark moon');
    const marked = await f.runtime.state.getPrivateMarks(HOME, chat(HOME, HOME, 'inspect-mark'));
    const moon = marked.sessions
      .flatMap((s) => s.marks)
      .find((m) => m.userId === '102' && m.text === 'moon');
    assert.ok(moon);
    await f.chat(HOME, HOME, `!relic approve ${moon.id}`);
    const approved = await f.runtime.state.getPrivateMarks(
      HOME,
      chat(HOME, HOME, 'inspect-approved'),
    );
    assert.equal(
      approved.sessions.flatMap((s) => s.marks).find((m) => m.id === moon.id).status,
      'approved',
    );
    assert.ok((await f.runtime.overlayFeeds[HOME].snapshot()).marks.some((m) => m.id === moon.id));
    assert.equal(JSON.parse((await f.control(HOME, `send:${OTHER}`)).body).status, 'accepted');
    await f.raid();
    await f.chat(HOME, '102', '!offer', { messageId: 'honest-offer' });
    await f.chat(OTHER, '103', '!accept', { messageId: 'honest-accept' });
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    const archived = await f.runtime.state.getPublicJourney();
    assert.ok(
      archived.stops.some(
        (s) => s.from === HOME && s.marks.some((m) => m.id === moon.id && m.text === 'moon'),
      ),
    );
    for (const host of [HOME, OTHER]) {
      const acks = await f.runtime.state.getPrivateClaimAcks(host);
      assert.equal(acks.rows.filter((r) => r.completionReceipt).length, 1);
      assert.ok(acks.rows.length <= 128);
    }
    await f.chat(OTHER, '103', '!accept', { messageId: 'honest-accept' });
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    assert.equal(f.calls.filter((c) => c.url.includes('/raids?') && c.method === 'POST').length, 1);
    for (let i = 0; i < 256; i++) {
      await f.runtime.state.accept({
        id: `erase-ledger-${i}`,
        now: f.now(),
        sentAt: f.now(),
        expiresAt: f.now() + 600000,
        chat: chat(HOME, String(5000 + i), `erase-ledger-${i}`, 'forgetme'),
      });
    }
    await f.runtime.state.controlMarks(
      HOME,
      chat(HOME, '102', 'forget-owner'),
      { type: 'forgetme' },
      f.now(),
    );
    if (f.db) {
      const sourcePresence = f.db.docs.get(`presence/${hash(HOME)}`);
      assert.equal(sourcePresence.streamId, f.streams.get(HOME).id);
      assert.equal(
        sourcePresence.actors.some((a) => a.id === '102'),
        false,
      );
    }
    const journey = await f.runtime.state.getPublicJourney();
    assert.ok(journey.stops.every((s) => s.marks.every((m) => m.text !== 'moon')));
    const retained = await f.runtime.state.getPrivateMarks(HOME, chat(HOME, HOME, 'inspect'));
    assert.ok(retained.sessions.every((s) => s.marks.every((m) => m.userId !== '102')));
    assert.equal(
      retained.sessions
        .find((s) => s.viewers.some((v) => v.userId === '102'))
        .viewers.find((v) => v.userId === '102').spent,
      1,
    );
  });
}

test('security regression fair allocations and expiry remain bounded across actors and rooms', () => {
  let scores;
  for (const host of ROOMS)
    for (const actor of ['101', '102', '103', '104'])
      for (let i = 0; i < 16; i++)
        scores = reduceScores(scores, {
          channels,
          marks,
          now: NOW,
          chat: chat(host, actor, `${host}-${actor}-${i}`, 'scores-status'),
        }).doc;
  assert.equal(scores.receipts.length, 64);
  assert.ok(scores.receipts.length <= 128);
  for (const host of ROOMS)
    assert.equal(scores.receipts.filter((r) => r.room === hash(`command-room:${host}`)).length, 32);
  const recovered = reduceScores(scores, {
    channels,
    marks,
    now: NOW + 600001,
    chat: chat('201', '101', 'after-expiry', 'scores-status'),
  });
  assert.equal(recovered.reason, 'queued');
  assert.equal(recovered.doc.receipts.length, 1);
  let acks;
  for (let i = 0; i < 128; i++)
    acks = ackDocument(
      acks,
      chat('201', String(6000 + i), `many-${i}`, 'offer'),
      null,
      channels['201'],
      marks['201'],
      NOW,
    );
  assert.equal(acks.rows.length, 128);
  const completed = completionAck(
    acks,
    '201',
    'earned',
    NOW + 90000,
    NOW,
    { from: '201', to: '202' },
    channels,
    { 202: 'sample_room_b' },
  );
  assert.ok(completed.key);
  assert.equal(completed.doc.rows.length, 128);
  const duplicate = completionAck(
    completed.doc,
    '201',
    'earned',
    NOW + 90000,
    NOW,
    { from: '201', to: '202' },
    channels,
    { 202: 'sample_room_b' },
  );
  assert.equal(duplicate.doc.rows.filter((r) => r.key === completed.key).length, 1);
});

for (const delivery of ['queued', 'dispatching', 'sent', 'unknown']) {
  test(`security regression completion discriminator survives ${delivery}, persisted restart and full-container reservation`, async () => {
    const earned = completionAck(
      null,
      '201',
      'original-earned',
      NOW + 90000,
      NOW,
      { from: '201', to: '202' },
      channels,
      { 202: 'sample_room_b' },
    );
    let doc = earned.doc;
    if (delivery !== 'queued') {
      doc = ackStep(
        doc,
        { type: 'claim', key: earned.key },
        channels['201'],
        marks['201'],
        NOW,
        true,
      ).doc;
      if (delivery !== 'dispatching')
        doc = ackStep(
          doc,
          { type: 'finish', key: earned.key, sent: delivery === 'sent' },
          channels['201'],
          marks['201'],
          NOW,
          true,
        ).doc;
    }
    assert.equal(doc.rows[0].status, delivery);
    assert.equal(doc.rows[0].completionReceipt, true);
    // Restart-compatible persisted JSON; delivery metadata may have been erased.
    const persisted = fakeFirestore();
    persisted.docs.set(`claimAcks/${hash('201')}`, JSON.parse(JSON.stringify(doc)));
    const restarted = createFirestoreStore(persisted, {
      lifecycle: { channels: ROOMS, logins: { sample_room_a: '201', sample_room_b: '202' } },
    });
    doc = await restarted.getPrivateClaimAcks('201');
    for (let i = 0; i < 127; i++)
      doc = ackDocument(
        doc,
        chat('201', String(8000 + i), `fill-${i}`, 'offer'),
        null,
        channels['201'],
        marks['201'],
        NOW,
      );
    assert.equal(doc.rows.length, 128);
    const next = completionAck(
      doc,
      '201',
      'next-earned',
      NOW + 90000,
      NOW,
      { from: '201', to: '202' },
      channels,
      { 202: 'sample_room_b' },
    );
    assert.ok(next.key);
    assert.equal(next.doc.rows.length, 128);
    assert.equal(next.doc.rows.find((r) => r.key === earned.key).status, delivery);
    const replay = completionAck(
      next.doc,
      '201',
      'original-earned',
      NOW + 90000,
      NOW,
      { from: '201', to: '202' },
      channels,
      { 202: 'sample_room_b' },
    );
    assert.equal(replay.doc.rows.filter((r) => r.key === earned.key).length, 1);
    assert.equal(replay.doc.rows.find((r) => r.key === earned.key).status, delivery);
  });
}

test('security regression ambiguous legacy delivery receipts are never evicted', () => {
  const legacy = {
    rows: Array.from({ length: 128 }, (_, i) => ({
      key: hash(`legacy-${i}`),
      status: 'unknown',
      expiresAt: NOW + 600000,
    })),
  };
  const next = completionAck(
    legacy,
    '201',
    'new-earned',
    NOW + 90000,
    NOW,
    { from: '201', to: '202' },
    channels,
    { 202: 'sample_room_b' },
  );
  assert.equal(next.key, null);
  assert.deepEqual(next.doc, legacy);
});

for (const command of ['scores-on', 'scores-off']) {
  test(`security regression multi-actor ${command} cannot consume another room's allocation`, () => {
    let doc = reduceScores(undefined, {
      channels,
      marks,
      now: NOW,
      chat: chat('201', '102', 'consent-before-flood', 'scores-on'),
    }).doc;
    for (let actor = 0; actor < 16; actor++)
      for (let i = 0; i < 8; i++)
        doc = reduceScores(doc, {
          channels,
          marks,
          now: NOW,
          chat: chat('201', String(9000 + actor), `consent-flood-${actor}-${i}`, command),
        }).doc;
    assert.equal(doc.receipts.filter((r) => r.room === hash('command-room:201')).length, 32);
    const other = reduceScores(doc, {
      channels,
      marks,
      now: NOW,
      chat: chat('202', '101', 'unrelated-room', 'scores-status'),
    });
    assert.equal(other.reason, 'queued');
    const withdrawn = reduceScores(other.doc, {
      channels,
      marks,
      now: NOW,
      chat: chat('201', '102', 'withdraw-at-capacity', 'scores-off'),
    });
    assert.equal(
      withdrawn.doc.players.some((p) => p.key === hash('score-actor-v1:102')),
      false,
    );
    const replay = reduceScores(withdrawn.doc, {
      channels,
      marks,
      now: NOW,
      chat: chat('201', '102', 'consent-before-flood', 'scores-on'),
    });
    assert.equal(replay.reason, 'duplicate');
    assert.equal(
      replay.doc.players.some((p) => p.key === hash('score-actor-v1:102')),
      false,
    );
    assert.ok(replay.doc.receipts.length <= 128);
  });
}

test('security regression overflow floor protects discarded old tombstones after stream reset', () => {
  let doc = updatePresence(null, '201', channels['201'], marks['201'], null, NOW, NOW);
  for (let i = 0; i < 257; i++) doc = revokePresenceActor(doc, '201', String(10000 + i), NOW);
  assert.equal(
    doc.revocations.some((r) => r.key === hash(JSON.stringify(['201', '10000']))),
    false,
  );
  doc = updatePresence(
    doc,
    '201',
    { ...channels['201'], streamId: 'new-stream', lifecycleAt: NOW + 1 },
    marks['201'],
    null,
    NOW + 1,
    NOW + 1,
  );
  const replay = updatePresence(
    doc,
    '201',
    { ...channels['201'], streamId: 'new-stream', lifecycleAt: NOW + 1 },
    marks['201'],
    chat('201', '10000', 'delayed-forgotten'),
    NOW + 2,
    NOW,
  );
  assert.equal(replay.actors.length, 0);
  assert.ok(replay.notBefore >= NOW);
});

for (const kind of ['memory', 'firestore']) {
  test(`security regression ${kind}: full-ledger forget removes authoritative moved-source proof and rejects delayed source chat`, async () => {
    const f = await pilotFixture(kind);
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    f.streams.get(HOME).viewer_count = 4;
    const source = await f.runtime.state.getStreamStatus(HOME);
    const oldProofAt = f.now();
    await f.chat(HOME, '102', 'hello', { messageId: 'original-source-proof' });
    await f.chat(HOME, '104', 'hello', { messageId: 'other-original-source-proof' });
    assert.equal(JSON.parse((await f.control(HOME, `send:${OTHER}`)).body).status, 'accepted');
    await f.chat(OTHER, '102', '!offer');
    await f.chat(OTHER, '104', '!offer');
    assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.sort(), [
      '102',
      '104',
    ]);
    for (let i = 0; i < 256; i++)
      await f.runtime.state.accept({
        id: `presence-erase-${i}`,
        now: f.now(),
        sentAt: f.now(),
        expiresAt: f.now() + 600000,
        chat: chat(HOME, String(12000 + i), `presence-erase-${i}`, 'forgetme'),
      });
    f.advance();
    await f.runtime.state.controlMarks(
      HOME,
      chat(HOME, '102', 'forget-source-proof'),
      { type: 'forgetme' },
      f.now(),
    );
    assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop.offers, []);
    assert.equal((await f.runtime.state.getStreamStatus(HOME)).streamId, source.streamId);
    f.advance();
    // A distinct signed delivery avoids outer duplicate suppression: only the
    // old signed timestamp/current-stream privacy barrier prevents insertion.
    await f.chat(HOME, '102', 'hello', { messageId: 'delayed-source-proof', sentAt: oldProofAt });
    await f.chat(OTHER, '102', '!offer');
    await f.chat(OTHER, '104', '!offer');
    assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop.offers, []);
    if (f.db) {
      const presence = f.db.docs.get(`presence/${hash(HOME)}`);
      assert.equal(presence.streamId, source.streamId);
      assert.equal(
        presence.actors.some((a) => ['102', '104'].includes(a.id)),
        false,
      );
      assert.ok(presence.notBefore >= oldProofAt);
    }
    // Actor 104 has no personal forget tombstone: its moved offer was denied
    // by absence of source proof, while a fresh direct source offer still works.
    await f.chat(HOME, '104', '!offer');
    assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop.offers, ['104']);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
    assert.equal(f.calls.filter((c) => c.url.includes('/raids?') && c.method === 'POST').length, 1);
  });
}
