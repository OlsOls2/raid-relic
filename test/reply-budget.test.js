import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { hash } from '../src/crypto.js';
import { LINEAGE_LIMITS } from '../src/claims.js';
import { handoffView } from '../src/public-view.js';
import { claimComplete, wanderNotice, BOT_COPY, claimVoteCopy } from '../public/ritual-copy.js';
import { createMarkService } from '../src/marks.js';
import {
  completionAck,
  completionEligible,
  ackStep,
  carriedApprovedCount,
  reserveHopNotice,
  trackHopNotices,
  announcementBudgetAvailable,
  HOP_NOTICE_POLICY,
} from '../src/claim-ack.js';

// All transport below is the injected pilot mock; chat inputs pass the real
// signed EventSub/runtime path. No stored result is substituted for a vote.
const posts = (f) =>
  f.calls
    .filter((c) => c.method === 'POST' && new URL(c.url).pathname === '/helix/chat/messages')
    .map((c) => JSON.parse(c.body));
async function ready(kind, viewers = 100) {
  const f = await pilotFixture(kind);
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    f.streams.get(id).viewer_count = viewers;
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  return f;
}
async function retainedBounds(f) {
  for (const host of [HOME, OTHER]) {
    const doc = await f.runtime.state.getPrivateClaimAcks(host);
    assert.ok((doc?.rows.length ?? 0) <= 128);
    assert.ok(Buffer.byteLength(JSON.stringify(doc ?? {})) <= 65536);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(await f.runtime.state.getKeeperRegistry())) <= 4096);
  assert.deepEqual(LINEAGE_LIMITS, { stops: 16, marksPerStop: 160, bytes: 524288 });
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: 300 signed distinct votes, delayed actual landing, POST ceiling, replay, closed spam and independent next hop`, async () => {
    const f = await ready(kind);
    await f.control(HOME, `send:${OTHER}`);
    // 150 genuine distinct sending voters; all valid votes up to the unchanged
    // per-side cap survive even after progress notices have been exhausted.
    await Promise.all(
      Array.from({ length: 150 }, (_, i) => f.chat(HOME, String(10000 + i), '!offer')),
    );
    let root = await f.runtime.state.getKeeperRegistry();
    assert.equal(root.pendingHop.verified, false);
    assert.equal(root.pendingHop.threshold, 10);
    assert.equal(root.pendingHop.offers.length, 10);
    assert.equal(root.holderId, HOME);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
    assert.equal(posts(f).length, 2);
    assert.equal(posts(f)[0].broadcaster_id, HOME);
    assert.equal(
      posts(f)[0].message,
      'Offers 1/10. Waiting for Twitch to confirm the raid. Waiting for 9 offers in @raidrelichq and 10 accepts in @olsols2.',
    );
    f.advance(90000);
    const landed = f.now();
    await f.raid(HOME, OTHER, 100);
    root = await f.runtime.state.getKeeperRegistry();
    assert.equal(root.pendingHop.endsAt, landed + 180000);
    assert.equal(root.pendingHop.claimStartedAt, landed);
    assert.equal(root.pendingHop.threshold, 10);
    assert.equal(root.pendingHop.offers.length, 10);
    assert.deepEqual(
      posts(f)
        .filter((p) => p.message === BOT_COPY.arrival)
        .map((p) => p.broadcaster_id),
      [OTHER],
    );
    if (kind === 'firestore') await f.restart();
    await Promise.all(
      Array.from({ length: 9 }, (_, i) => f.chat(OTHER, String(20000 + i), '!accept')),
    );
    root = await f.runtime.state.getKeeperRegistry();
    assert.equal(root.pendingHop.accepts.length, 9);
    assert.equal(root.pendingHop.offers.length, 10);
    assert.equal(root.holderId, HOME);
    // The tenth is concurrently replayed; the remaining 140 distinct requests
    // are delivered after completion and must not create generic error replies.
    await Promise.all(
      Array.from({ length: 8 }, () =>
        f.chat(OTHER, '20009', '!accept', { messageId: 'budget-final' }),
      ),
    );
    await Promise.all(
      Array.from({ length: 140 }, (_, i) => f.chat(OTHER, String(20010 + i), '!accept')),
    );
    root = await f.runtime.state.getKeeperRegistry();
    assert.equal(root.holderId, OTHER);
    assert.equal(root.pendingHop.finalized, true);
    assert.equal(root.pendingHop.noticeMask, 59);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    assert.equal(
      posts(f).length,
      5,
      'actual mocked transport POST count across both rooms; one slot stays available for optional P7',
    );
    assert.equal(posts(f).filter((p) => p.message.startsWith('Claim complete:')).length, 2);
    assert.deepEqual(
      posts(f)
        .filter((p) => p.message.startsWith('Claim complete:'))
        .map((p) => p.message),
      [
        'Claim complete: the relic transferred to @olsols2; one new ring. 0 approved runes carried.',
        'Claim complete: the relic transferred to @olsols2; one new ring. 0 approved runes carried.',
      ],
    );
    const projection = await f.runtime.overlayFeeds[OTHER].snapshot();
    assert.equal(projection.handoff.carriedApprovedCount, 0);
    for (const privateKey of [
      'chatterId',
      'sourceStreamId',
      'noticeMask',
      'noticePolicy',
      'userId',
    ])
      assert.ok(!JSON.stringify(projection.handoff).includes(privateKey), privateKey);
    f.advance(700000);
    await Promise.all(
      Array.from({ length: 300 }, (_, i) =>
        f.chat(i % 2 ? HOME : OTHER, String(30000 + i), i % 2 ? '!offer' : '!accept'),
      ),
    );
    assert.equal(posts(f).length, 5, 'receipt expiry does not restore notice budget');
    await retainedBounds(f);
    f.advance();
    await f.control(OTHER, `send:${HOME}`);
    f.advance();
    await f.raid(OTHER, HOME, 1);
    await f.chat(OTHER, '41001', '!offer');
    await f.chat(HOME, '41002', '!accept');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 2);
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
    assert.ok(posts(f).length > 5);
    assert.ok(posts(f).length <= 10);
  });

  test(`${kind}: unknown reservations consume slots, never retry, and cannot throttle a real transfer`, async () => {
    const f = await ready(kind);
    await f.control(HOME, `send:${OTHER}`);
    f.chatFailure('transport');
    await f.chat(HOME, '51001', '!offer', { messageId: 'unknown-first' });
    f.chatFailure(null);
    await f.chat(HOME, '51001', '!offer', { messageId: 'unknown-first' });
    assert.equal(posts(f).length, 1);
    await Promise.all(
      Array.from({ length: 149 }, (_, i) => f.chat(HOME, String(51002 + i), '!offer')),
    );
    const root = await f.runtime.state.getKeeperRegistry();
    assert.equal(root.pendingHop.offers.length, 10);
    assert.equal(root.pendingHop.noticeMask, 3);
    assert.equal(
      (await f.runtime.state.getPrivateClaimAcks(HOME)).rows.filter((r) => r.status === 'unknown')
        .length,
      1,
    );
    f.advance(5000);
    await f.raid(HOME, OTHER, 100);
    await Promise.all(
      Array.from({ length: 150 }, (_, i) => f.chat(OTHER, String(61000 + i), '!accept')),
    );
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, OTHER);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    assert.ok(posts(f).length <= 6);
    await retainedBounds(f);
  });

  test(`${kind}: first sender confirmation survives receiving-first completion; arrival never follows a finalized hop`, async () => {
    const f = await ready(kind, 1);
    await f.control(HOME, `send:${OTHER}`);
    f.advance();
    await f.raid(HOME, OTHER, 1);
    await f.chat(OTHER, '64001', '!accept');
    await f.chat(HOME, '64002', '!offer');
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, OTHER);
    assert.equal(
      posts(f).filter((p) => p.message === 'Offers 1/1. Both chats reached the threshold.').length,
      1,
    );
    assert.equal(posts(f).filter((p) => p.message === BOT_COPY.arrival).length, 0);
    assert.equal(posts(f).filter((p) => p.message.startsWith('Claim complete:')).length, 2);
    assert.ok(posts(f).length <= 6);
  });

  test(`${kind}: actual smaller threshold, expiry, forget/block and unrelated actors retain vote authority`, async () => {
    const f = await ready(kind);
    await f.control(HOME, `send:${OTHER}`);
    await f.chat(HOME, '71001', '!offer');
    await f.chat(HOME, '71001', '!relic forgetme');
    await f.runtime.state.setChannelPolicy(
      HOME,
      { banned: false, blockedUserIds: ['71002'] },
      f.now(),
    );
    await f.chat(HOME, '71002', '!offer');
    await f.chat(HOME, '71003', '!offer');
    await f.chat(OTHER, '71003', '!accept'); // cross-side reuse is forbidden
    f.advance(10000);
    await f.raid(HOME, OTHER, 4);
    let root = await f.runtime.state.getKeeperRegistry();
    assert.equal(root.pendingHop.threshold, 2);
    assert.deepEqual(root.pendingHop.offers, ['71003']);
    assert.deepEqual(root.pendingHop.accepts, []);
    await f.chat(HOME, '71004', '!offer');
    await f.chat(OTHER, '72001', '!accept');
    root = await f.runtime.state.getKeeperRegistry();
    f.advance(root.pendingHop.endsAt - f.now());
    await f.chat(OTHER, '72002', '!accept');
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
    const n = posts(f).length;
    await Promise.all(
      Array.from({ length: 300 }, (_, i) => f.chat(OTHER, String(73000 + i), '!accept')),
    );
    assert.equal(posts(f).length, n);
    assert.ok(n <= 6);
  });

  test(`${kind}: approved archive count is fresh after forget/block/veto/opt-out and never exposes pending content`, async () => {
    for (const action of ['forget', 'block', 'veto', 'opt-out']) {
      const f = await ready(kind, 1);
      await f.chat(HOME, '91001', '!mark moon');
      await f.chat(HOME, HOME, '!relic approve m1');
      await f.chat(HOME, '91002', '!mark secretpending');
      await f.control(HOME, `send:${OTHER}`);
      f.advance();
      await f.raid(HOME, OTHER, 1);
      await f.chat(HOME, '92001', '!offer');
      await f.chat(OTHER, '92002', '!accept');
      let journey = await f.runtime.state.getPublicJourney();
      assert.equal(journey.stops[0].marks.length, 1);
      assert.equal(
        (await f.runtime.state.getPublicPresentation(OTHER, f.now())).handoff.carriedApprovedCount,
        1,
      );
      const text = JSON.stringify(journey);
      assert.ok(text.includes('moon'));
      for (const secret of ['secretpending', '91001', '91002', 'userId'])
        assert.ok(!text.includes(secret));
      assert.deepEqual(
        posts(f)
          .filter((p) => p.message.startsWith('Claim complete:'))
          .map((p) => p.message),
        [
          'Claim complete: the relic transferred to @olsols2; one new ring. 1 approved rune carried.',
          'Claim complete: the relic transferred to @olsols2; one new ring. 1 approved rune carried.',
        ],
      );
      const service = createMarkService(f.runtime.state, { now: f.now });
      const actor = { broadcasterId: HOME, chatterId: HOME };
      if (action === 'forget')
        await service.forgetMe(HOME, { broadcasterId: HOME, chatterId: '91001' });
      if (action === 'block') await service.blockUser(HOME, actor, '91001');
      if (action === 'veto') {
        await service.vetoLast(HOME, actor);
        await service.vetoLast(HOME, actor);
      }
      if (action === 'opt-out') await service.optOut(HOME, actor);
      journey = await f.runtime.state.getPublicJourney();
      assert.equal(journey.stops[0].marks.length, 0);
      const presentation = await f.runtime.state.getPublicPresentation(OTHER, f.now());
      assert.equal(presentation.handoff.carriedApprovedCount, 0, action);
      assert.ok(!JSON.stringify(presentation).includes('secretpending'));
      assert.ok(!JSON.stringify(presentation).includes('91001'));
      assert.equal(journey.rings, 1);
    }
  });

  test(`${kind}: forgetting after completion commit cancels queued completion content before the POST boundary`, async () => {
    const f = await ready(kind, 1);
    await f.chat(HOME, '93001', '!mark moon');
    await f.chat(HOME, HOME, '!relic approve m1');
    await f.control(HOME, `send:${OTHER}`);
    f.advance();
    await f.raid(HOME, OTHER, 1);
    const process = f.runtime.claimAcks.process;
    f.runtime.claimAcks.process = async () => {};
    await f.chat(HOME, '93002', '!offer');
    await f.chat(OTHER, '93003', '!accept');
    const keys = [];
    for (const host of [HOME, OTHER])
      for (const row of (await f.runtime.state.getPrivateClaimAcks(host)).rows)
        if (row.completion) keys.push({ host, key: row.key });
    assert.equal(keys.length, 2);
    const service = createMarkService(f.runtime.state, { now: f.now });
    await service.forgetMe(HOME, { broadcasterId: HOME, chatterId: '93001' });
    const before = posts(f).length;
    f.runtime.claimAcks.process = process;
    for (const { host, key } of keys) await process(host, key);
    assert.equal(posts(f).length, before);
    assert.equal((await f.runtime.state.getPublicJourney()).stops[0].marks.length, 0);
    for (const { host, key } of keys) {
      const row = (await f.runtime.state.getPrivateClaimAcks(host)).rows.find((r) => r.key === key);
      assert.equal(row.status, 'cancelled');
      assert.equal(row.message, undefined);
    }
  });

  test(`${kind}: forgetting an approved source mark before the real final vote produces fresh zero completion copy`, async () => {
    const f = await ready(kind, 1);
    await f.chat(HOME, '94001', '!mark moon');
    await f.chat(HOME, HOME, '!relic approve m1');
    await f.control(HOME, `send:${OTHER}`);
    f.advance();
    await f.raid(HOME, OTHER, 1);
    await f.chat(HOME, '94002', '!offer');
    const service = createMarkService(f.runtime.state, { now: f.now });
    await service.forgetMe(HOME, { broadcasterId: HOME, chatterId: '94001' });
    assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop.offers, ['94002']);
    await f.chat(OTHER, '94003', '!accept');
    const journey = await f.runtime.state.getPublicJourney();
    assert.equal(journey.rings, 1);
    assert.deepEqual(journey.stops[0].marks, []);
    assert.deepEqual(
      posts(f)
        .filter((p) => p.message.startsWith('Claim complete:'))
        .map((p) => p.message),
      [
        'Claim complete: the relic transferred to @olsols2; one new ring. 0 approved runes carried.',
        'Claim complete: the relic transferred to @olsols2; one new ring. 0 approved runes carried.',
      ],
    );
    assert.equal(
      (await f.runtime.state.getPublicPresentation(OTHER, f.now())).handoff.carriedApprovedCount,
      0,
    );
  });
}

test('Firestore retry and failed commit roll back notice reservation, vote, content and dedupe together', async () => {
  const f = await ready('firestore');
  await f.control(HOME, `send:${OTHER}`);
  f.advance();
  await f.raid(HOME, OTHER, 1);
  const before = structuredClone([...f.db.docs]);
  const n = posts(f).length;
  f.db.failCommit = true;
  await assert.rejects(f.chat(HOME, '81001', '!offer', { messageId: 'rollback-offer' }));
  assert.deepEqual([...f.db.docs], before);
  assert.equal(posts(f).length, n);
  f.db.failCommit = false;
  f.db.retry = true;
  await f.chat(HOME, '81001', '!offer', { messageId: 'rollback-offer' });
  assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop.offers, ['81001']);
  assert.equal(posts(f).filter((p) => p.message === BOT_COPY.arrival).length, 1);
  await f.chat(OTHER, '82001', '!accept');
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
  assert.ok(posts(f).length <= 6);
});

test('fixed slot reservations cannot wrap, refund, or exceed six and each next hop starts independently', () => {
  const hop = {};
  const slots = [
    'sender',
    'progress1',
    'announcement',
    'arrival',
    'sourceComplete',
    'targetComplete',
  ];
  for (const slot of slots) assert.equal(reserveHopNotice(hop, slot), true);
  assert.equal(hop.noticeMask, 63);
  for (const slot of slots) assert.equal(reserveHopNotice(hop, slot), false);
  for (const noticeMask of [-1, 64, 1.5, '0', null])
    assert.equal(reserveHopNotice({ noticeMask }, 'sender'), false);
  assert.equal(reserveHopNotice({}, 'sender'), true);
});

test('new-hop provenance is explicit; landing preserves reservations and legacy hops never gain announcement eligibility', () => {
  const provisional = {
    eventId: 'intent',
    intentId: 'intent',
    from: HOME,
    to: OTHER,
    sourceStreamId: '9001',
    targetStreamId: '9002',
    policy: 'preclaim-v1',
    verified: false,
  };
  const fresh = { pendingHop: structuredClone(provisional) };
  trackHopNotices({}, fresh);
  assert.equal(fresh.pendingHop.noticePolicy, HOP_NOTICE_POLICY);
  assert.equal(announcementBudgetAvailable(fresh.pendingHop), true);
  reserveHopNotice(fresh.pendingHop, 'sender');
  reserveHopNotice(fresh.pendingHop, 'progress1');
  const landed = { pendingHop: { ...provisional, eventId: 'raid', verified: true } };
  trackHopNotices(fresh, landed);
  assert.equal(landed.pendingHop.noticeMask, 3);
  assert.equal(landed.pendingHop.noticePolicy, HOP_NOTICE_POLICY);
  const legacy = { pendingHop: { ...provisional, noticeMask: 7 } };
  const legacyLanding = { pendingHop: { ...provisional, eventId: 'legacy-raid', verified: true } };
  trackHopNotices(legacy, legacyLanding);
  assert.equal(legacyLanding.pendingHop.noticeMask, 7);
  assert.equal(legacyLanding.pendingHop.noticePolicy, undefined);
  assert.equal(announcementBudgetAvailable(legacyLanding.pendingHop), false);
  const reconnect = structuredClone(legacy);
  trackHopNotices(legacy, reconnect);
  assert.equal(reconnect.pendingHop.noticePolicy, undefined);
  assert.equal(reconnect.pendingHop.noticeMask, 7);
  const next = { pendingHop: { ...provisional, eventId: 'next', intentId: 'next' } };
  trackHopNotices(landed, next);
  assert.equal(next.pendingHop.noticeMask, 0);
  assert.equal(announcementBudgetAvailable(next.pendingHop), true);
});

test('count-only completion projection matches exact verified archive; absent/invalid/mismatched omit', () => {
  const hop = {
    eventId: 'verified',
    from: HOME,
    to: OTHER,
    sourceStreamId: '9001',
    verified: true,
    finalized: true,
    startedAt: 0,
    endsAt: 180000,
    threshold: 1,
  };
  const stop = {
    eventId: 'verified',
    stopId: hash('verified'),
    from: HOME,
    to: OTHER,
    streamId: '9001',
    claimedAt: 1,
    marks: [{ id: 'm1', userId: 'private-author', text: 'moon' }],
  };
  assert.equal(carriedApprovedCount(hop, { stops: [stop] }), 1);
  const view = handoffView({ pendingHop: hop }, OTHER, 2, { stops: [stop] });
  assert.equal(view.carriedApprovedCount, 1);
  assert.ok(!JSON.stringify(view).includes('private-author'));
  assert.ok(!JSON.stringify(view).includes('moon'));
  assert.equal(carriedApprovedCount(hop, { stops: [{ ...stop, marks: [] }] }), 0);
  for (const patch of [
    { eventId: 'other' },
    { from: OTHER },
    { to: HOME },
    { streamId: 'other' },
    { stopId: 'other' },
    { kind: 'wander' },
    { marks: Array(161).fill({}) },
    { marks: null },
    { marks: [null] },
    { marks: [{ id: 'm2', userId: 'private', text: 'secret', status: 'pending' }] },
  ])
    assert.equal(carriedApprovedCount(hop, { stops: [{ ...stop, ...patch }] }), undefined);
  for (const patch of [{ verified: false }, { finalized: false }, { cancelled: true }])
    assert.equal(carriedApprovedCount({ ...hop, ...patch }, { stops: [stop] }), undefined);
  assert.equal(carriedApprovedCount(hop), undefined);
  assert.equal(carriedApprovedCount(hop, { stops: {} }), undefined);
  assert.equal(carriedApprovedCount(hop, { stops: [stop, stop] }), undefined);
});

test('dispatch derives count from the current matching stop, never the queued snapshot; old fixtures omit count', () => {
  const hop = {
    eventId: 'fresh',
    from: HOME,
    to: OTHER,
    sourceStreamId: '9001',
    targetStreamId: '9002',
    verified: true,
    finalized: true,
    raidSentAt: 1,
    endsAt: 180001,
  };
  const channels = Object.fromEntries(
    [HOME, OTHER].map((id, i) => [
      id,
      {
        online: true,
        streamId: String(9001 + i),
        consentAt: 0,
        optedIn: true,
        blockedUserIds: [],
      },
    ]),
  );
  const marks = Object.fromEntries(
    [HOME, OTHER].map((id, i) => [
      id,
      {
        context: { optedIn: true, streamId: String(9001 + i) },
        blocked: [],
      },
    ]),
  );
  const registry = { pendingHop: hop, holderId: OTHER, raidWatermark: 1 };
  const notice = completionAck(null, OTHER, 'fresh', hop.endsAt, 2, hop, channels);
  const lineage = {
    stops: [
      {
        stopId: hash('fresh'),
        eventId: 'fresh',
        from: HOME,
        to: OTHER,
        streamId: '9001',
        marks: [],
      },
    ],
  }; // current archive after erasure, no cached count
  assert.equal(
    completionEligible(notice.doc, notice.key, registry, channels, marks, 3, lineage),
    true,
  );
  assert.equal(
    ackStep(notice.doc, { type: 'claim', key: notice.key }, channels[OTHER], marks[OTHER], 3, true)
      .result.message,
    'Claim complete: the relic transferred to @olsols2; one new ring. 0 approved runes carried.',
  );
  assert.equal(completionEligible(notice.doc, notice.key, registry, channels, marks, 3), true);
  assert.equal(
    notice.doc.rows[0].message,
    'Claim complete: the relic transferred to @olsols2; one new ring.',
  );
  const mismatch = structuredClone(lineage);
  mismatch.stops[0].streamId = 'other';
  assert.equal(
    completionEligible(notice.doc, notice.key, registry, channels, marks, 3, mismatch),
    true,
  );
  assert.equal(
    notice.doc.rows[0].message,
    'Claim complete: the relic transferred to @olsols2; one new ring.',
  );
  channels[HOME].paused = true;
  assert.equal(
    completionEligible(notice.doc, notice.key, registry, channels, marks, 3, lineage),
    false,
  );
});

test('completion and Wander zero/one/plural full-string fixtures and actual producer inventory', async () => {
  assert.equal(
    claimComplete('olsols2'),
    'Claim complete: the relic transferred to @olsols2; one new ring.',
  );
  assert.equal(
    claimComplete('olsols2', 0),
    'Claim complete: the relic transferred to @olsols2; one new ring. 0 approved runes carried.',
  );
  assert.equal(
    claimComplete('olsols2', 1),
    'Claim complete: the relic transferred to @olsols2; one new ring. 1 approved rune carried.',
  );
  assert.equal(
    claimComplete('olsols2', 2),
    'Claim complete: the relic transferred to @olsols2; one new ring. 2 approved runes carried.',
  );
  assert.equal(
    claimComplete('olsols2', 160),
    'Claim complete: the relic transferred to @olsols2; one new ring. 160 approved runes carried.',
  );
  for (const invalid of [undefined, null, -1, 161, 1.1, '1', NaN, Infinity])
    assert.equal(
      claimComplete('olsols2', invalid),
      'Claim complete: the relic transferred to @olsols2; one new ring.',
    );
  assert.equal(
    wanderNotice('warning'),
    'The relic has been idle. It may wander to an opted-in Keeper after the warning period. Add an approved mark or start a valid Send Off to keep playing.',
  );
  for (const [login, expected] of [
    [
      'raidrelichq',
      'The relic wandered here to @raidrelichq; no raid or audience transfer occurred. Leave !mark word to add a community rune.',
    ],
    [
      'olsols2',
      'The relic wandered here to @olsols2; no raid or audience transfer occurred. Leave !mark word to add a community rune.',
    ],
    [
      'olsols3',
      'The relic wandered here to @olsols3; no raid or audience transfer occurred. Leave !mark word to add a community rune.',
    ],
  ])
    assert.equal(wanderNotice('arrival', login), expected);
  assert.throws(() => wanderNotice('arrival', '@untrusted'));
  assert.throws(() => wanderNotice('other', 'olsols2'));
  assert.equal(
    claimVoteCopy(
      'offers',
      { from: HOME, to: OTHER, threshold: 1, offers: ['1'], accepts: ['2'], verified: true },
      { [HOME]: 'raidrelichq', [OTHER]: 'olsols2' },
    ),
    'Offers 1/1. Both chats reached the threshold.',
  );
  // Inventory: claim/command outboxes -> catalog + parameterized snapshots in
  // overlay-group3; share outbox -> marksShareReply there; Wander -> this full
  // fixture + wander.test delivery fixtures; P7 announcement -> existing exact
  // POST-body expectation in p7.test (intentionally unchanged). Scoreboard's
  // two existing inline outcome strings are fully covered in recording-replies;
  // moving their source would require the separately owned scoreboard module.
  const inventory = [
    ['src/claim-ack.js', /sendChat\(message,\s*\{\s*retryUnauthorized: false/],
    ['src/my-marks.js', /sendChat\(marksShareReply\(/],
    ['src/wander.js', /wanderNotice\(row.kind, keepers\[row.host\]\)/],
    [
      'test/p7.test.js',
      /The relic is bound to @olsols2\. Ring 1\. Thank you, @raidrelichq\. Welcome raiders—leave !mark to add a community rune\./,
    ],
    [
      'test/recording-replies.test.js',
      /assert\.equal\(replies\(\)\.at\(-1\), 'Your mark is public on the relic\.'\)/,
    ],
    [
      'test/recording-replies.test.js',
      /assert\.equal\(replies\(\)\.at\(-1\), 'Vetoed latest mark\.'\)/,
    ],
  ];
  for (const [path, pattern] of inventory)
    assert.match(await readFile(new URL('../' + path, import.meta.url), 'utf8'), pattern);
});
