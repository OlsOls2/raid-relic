import test from 'node:test';
import assert from 'node:assert/strict';
import { parseChat, verifiedMentionTarget } from '../src/bot.js';
import {
  parseMarkCommand,
  setMarkContext,
  reduceMark,
  markCommandOutcome,
  markPrivacyChange,
  publicMarks,
} from '../src/marks.js';
import { ackKey } from '../src/claim-ack.js';
import { reduceScores } from '../src/scoreboard.js';
import { BOT_COPY, pendingReviewReply } from '../public/ritual-copy.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';

for (const [name, text, expected] of [
  ['pending', '!relic pending', { type: 'pending' }],
  ['approve last', '!relic approve last', { type: 'approve-last' }],
  ['reject last', '!relic reject last', { type: 'reject-last' }],
  ['canonical named block', '!relic block @Sample_A', { type: 'block-login', login: 'sample_a' }],
  [
    'prototype spelling is data not lookup',
    '!relic block @__proto__',
    { type: 'block-login', login: '__proto__' },
  ],
  [
    'constructor spelling is data not lookup',
    '!relic block @constructor',
    { type: 'block-login', login: 'constructor' },
  ],
  ['numeric block unchanged', '!relic block 101', { type: 'block', userId: '101' }],
  ['ID approve unchanged', '!relic approve m2', { type: 'approve', markId: 'm2' }],
  ['uppercase command unsupported', '!relic PENDING', { type: 'help' }],
  ['uppercase last unsupported', '!relic approve LAST', { type: 'help' }],
  ['overlong login unsupported', '!relic block @' + 'a'.repeat(26), { type: 'help' }],
  ['URL not login', '!relic block @https://example.test', { type: 'help' }],
  ['display name unsupported', '!relic block @sample a', { type: 'help' }],
  ['empty login unsupported', '!relic block @', { type: 'help' }],
  ['trailing command data unsupported', '!relic reject last extra', { type: 'help' }],
  ['newline cannot name block', '!relic block @sample\n', { type: 'help' }],
])
  test('moderator grammar: ' + name, () => assert.deepEqual(parseMarkCommand(text), expected));

test('bounded count reply has explicit snapshots and cannot expose private values', () => {
  for (const count of [0, 2, 160])
    assert.equal(
      pendingReviewReply(count),
      `${count} pending marks in this active stream. Moderators: !relic approve last or !relic reject last. Only the latest eligible pending mark is selected; no text is shared here.`,
    );
  for (const count of [-1, 161, 1.5, '2', null, Infinity])
    assert.throws(() => pendingReviewReply(count));
});

const host = '201',
  owner = { broadcasterId: host, chatterId: host },
  mod = { broadcasterId: host, chatterId: '501', isModerator: true };
function pendingDoc() {
  let doc = setMarkContext(null, host, {
    streamId: 'review-current',
    keeperId: host,
    optedIn: true,
    holdsRelic: true,
    blockedUserIds: [],
  });
  for (const [id, text] of [
    ['101', 'moon'],
    ['102', 'star'],
    ['103', 'orchid'],
  ])
    doc = reduceMark(
      doc,
      host,
      { broadcasterId: host, chatterId: id },
      { type: 'mark', text },
      100,
    );
  return reduceMark(doc, host, owner, { type: 'approve', markId: 'm1' }, 101);
}
test('latest eligible pending excludes approved, blocked and historical records; quotas/cooldowns survive rejection', () => {
  let doc = pendingDoc();
  assert.equal(
    reduceMark(doc, host, owner, { type: 'approve-last' }, 102).sessions[0].marks.at(-1).status,
    'approved',
  );
  // Earlier stream content is retained but never selected by last.
  doc = setMarkContext(doc, host, { ...doc.context, streamId: 'review-next' });
  const historical = structuredClone(doc.sessions[0]);
  doc = reduceMark(
    doc,
    host,
    { broadcasterId: host, chatterId: '104' },
    { type: 'mark', text: 'bright' },
    200,
  );
  let next = reduceMark(doc, host, mod, { type: 'approve-last' }, 201);
  assert.equal(next.sessions[1].marks[0].status, 'approved');
  assert.deepEqual(next.sessions[0], historical);
  assert.equal(markCommandOutcome(doc, next, host, mod, { type: 'approve-last' }), 'approved-last');
  assert.deepEqual(reduceMark(next, host, mod, { type: 'reject-last' }, 202), next);
  doc = pendingDoc();
  doc.context.blockedUserIds = ['103'];
  next = reduceMark(doc, host, mod, { type: 'reject-last' }, 103);
  assert.deepEqual(
    next.sessions[0].marks.map((m) => m.id),
    ['m1', 'm3'],
  );
  assert.equal(next.sessions[0].spent, 3);
  assert.deepEqual(next.sessions[0].viewers, doc.sessions[0].viewers);
  assert.deepEqual(next.cooldowns, doc.cooldowns);
});
test('read-only pending/unresolved login preserve actual document data; forged target IDs never resolve names', () => {
  const doc = pendingDoc();
  for (const action of [
    { type: 'pending' },
    { type: 'block-login', login: '__proto__', userId: '101' },
    { type: 'block-login', login: 'viewer101', userId: '101' },
  ]) {
    const next = reduceMark(doc, host, mod, action, 102);
    assert.deepEqual(next, doc);
    assert.equal(
      markCommandOutcome(doc, next, host, mod, action),
      action.type === 'pending' ? 'pending:2' : 'login-unresolved',
    );
  }
  for (const actor of [
    { ...mod, broadcasterId: '202' },
    { ...mod, isBot: true },
    { ...mod, copied: { origin: '202' } },
    { ...mod, isModerator: false },
  ])
    for (const type of ['pending', 'approve-last', 'reject-last', 'block-login']) {
      const next = reduceMark(doc, host, actor, { type, login: 'viewer101' }, 102);
      assert.deepEqual(next, doc);
      assert.equal(markCommandOutcome(doc, next, host, actor, { type }), 'review-denied');
    }
  for (const change of ['paused', 'opted-out', 'closed', 'blocked-moderator']) {
    const value = structuredClone(doc);
    if (change === 'paused') value.paused = true;
    if (change === 'opted-out') value.context.optedIn = false;
    if (change === 'closed') value.sessions[0].closed = true;
    if (change === 'blocked-moderator') value.blocked.push('501');
    for (const type of ['pending', 'approve-last', 'reject-last', 'block-login'])
      assert.deepEqual(reduceMark(value, host, mod, { type, login: 'viewer101' }, 102), value);
  }
  assert.equal(publicMarks(doc, host).marks.length, 1);
});
test('moderator replies keep existing per-actor/room/global budgets and unauthorized/future/stale requests stay quiet', () => {
  const marks = pendingDoc(),
    now = 1000000,
    channel = {
      online: true,
      optedIn: true,
      paused: false,
      banned: false,
      blockedUserIds: [],
      streamId: 'review-current',
      startedAt: 1,
      consentAt: 1,
      closedThrough: 0,
    };
  const args = {
    channels: { [host]: channel },
    marks: { [host]: marks },
    now,
    sentAt: now,
    markOutcome: 'pending:2',
  };
  let scores;
  const chat = (i, actor = mod) => ({
    ...actor,
    messageId: 'review-' + i,
    markAction: { type: 'pending' },
  });
  const first = reduceScores(scores, { ...args, chat: chat(0) });
  assert.equal(
    first.message,
    '2 pending marks in this active stream. ' + BOT_COPY.reviewInstructions,
  );
  scores = first.doc;
  for (let i = 1; i < 20; i++) scores = reduceScores(scores, { ...args, chat: chat(i) }).doc;
  assert.ok(scores.receipts.length <= 8);
  for (const patch of [
    { chat: chat(30, { ...mod, isModerator: false }) },
    { sentAt: now + 1 },
    { sentAt: now - 600001 },
  ])
    assert.equal(reduceScores(scores, { ...args, chat: chat(31), ...patch }).message, null);
  const full = {
    version: 1,
    players: [],
    receipts: Array.from({ length: 128 }, (_, i) => ({ key: 'full-' + i, until: now + 10000 })),
  };
  const denied = reduceScores(full, { ...args, chat: chat(32) });
  assert.equal(denied.reason, 'capacity');
  assert.equal(denied.message, null);
  assert.equal(denied.doc.receipts.length, 128);
});

async function ready(kind) {
  const f = await pilotFixture(kind);
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  for (const [id, text] of [
    ['101', 'moon'],
    ['102', 'star'],
    ['103', 'orchid'],
  ])
    await f.chat(HOME, id, '!mark ' + text);
  await f.chat(HOME, HOME, '!relic approve m1');
  return f;
}
let sequence = 0;
function review(
  f,
  text,
  {
    actor = HOME,
    mod = false,
    room = HOME,
    eventRoom = room,
    messageId = 'review-message-' + ++sequence,
    copied = false,
    login = 'sample_mod',
    sentAt = f.now(),
    fragments = [],
  } = {},
) {
  return f.signed(
    'channel.chat.message',
    {
      broadcaster_user_id: eventRoom,
      chatter_user_id: actor,
      chatter_user_login: login,
      message_id: messageId,
      badges: mod ? [{ set_id: 'moderator', id: '1' }] : [],
      message: { text, fragments },
      ...(copied
        ? {
            source_broadcaster_user_id: OTHER,
            source_message_id: '00000000-0000-4000-8000-000000000001',
          }
        : {}),
    },
    room,
    { broadcaster_user_id: room, user_id: BOT },
    { sentAt },
  );
}
const privateDoc = (f) =>
  f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME });
const current = (doc) => doc.sessions.find((s) => s.streamId === doc.context.streamId);
const posts = (f) =>
  f.calls
    .filter(
      (c) =>
        new URL(c.url).origin === 'https://api.twitch.tv' &&
        new URL(c.url).pathname === '/helix/chat/messages' &&
        c.method === 'POST',
    )
    .map((c) => JSON.parse(c.body));
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: signed current moderators select once inside the transaction; pending read preserves capabilities and public privacy`, async () => {
    const f = await ready(kind);
    // Actual signed self-share creates a real supported private grant, not a DTO.
    await f.chat(HOME, '101', '!relic mymarks');
    const shares = (await privateDoc(f)).shares;
    assert.ok(shares?.length > 0);
    const old = await privateDoc(f),
      beforePosts = posts(f).length;
    await review(f, '!relic pending', { actor: '501', mod: true });
    assert.deepEqual((await privateDoc(f)).shares, shares);
    assert.deepEqual(current(await privateDoc(f)).marks, current(old).marks);
    const pending = posts(f).slice(beforePosts);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].broadcaster_id, HOME);
    assert.equal(
      pending[0].message,
      '2 pending marks in this active stream. ' + BOT_COPY.reviewInstructions,
    );
    assert.doesNotMatch(pending[0].message, /moon|star|orchid|viewer|https|token/);
    await Promise.all([
      review(f, '!relic reject last', { actor: '501', mod: true, messageId: 'reject-once' }),
      review(f, '!relic reject last', { actor: '501', mod: true, messageId: 'reject-once' }),
    ]);
    assert.deepEqual(
      current(await privateDoc(f)).marks.map((m) => m.id),
      ['m1', 'm2'],
    );
    await review(f, '!relic approve last', { actor: '501', mod: true, messageId: 'approve-once' });
    await f.chat(HOME, '104', '!mark bright');
    await review(f, '!relic approve last', { actor: '501', mod: true, messageId: 'approve-once' });
    const end = await privateDoc(f);
    assert.deepEqual(
      current(end).marks.map((m) => [m.id, m.status]),
      [
        ['m1', 'approved'],
        ['m2', 'approved'],
        ['m4', 'pending'],
      ],
    );
    assert.equal(current(end).spent, 4);
    assert.equal((await f.runtime.state.getPublicMarks(HOME)).marks.length, 2);
    assert.equal(posts(f).filter((p) => p.message === BOT_COPY.reviewRejected).length, 1);
    assert.equal(posts(f).filter((p) => p.message === BOT_COPY.reviewApproved).length, 1);
    assert.ok(posts(f).every((p) => [...p.message].length <= 500));
    assert.ok(!f.calls.some((c) => new URL(c.url).pathname === '/helix/raids'));
  });
  test(`${kind}: viewers, bots, copied/bad-HMAC/cross-room, blocked, paused, expired and old-stream commands cannot review`, async () => {
    const f = await ready(kind),
      before = await privateDoc(f),
      baseline = posts(f).length;
    for (const text of [
      '!relic pending',
      '!relic approve last',
      '!relic reject last',
      '!relic block @sample',
    ])
      for (const options of [
        { actor: '101' },
        { actor: OTHER },
        { actor: BOT, mod: true },
        { actor: '501', mod: true, copied: true },
      ])
        await review(f, text, options);
    assert.equal((await review(f, '!relic pending', { eventRoom: OTHER })).status, 400);
    assert.equal(
      (
        await f.request(
          '/eventsub',
          'POST',
          { 'content-type': 'application/json' },
          Buffer.from('{}'),
        )
      ).status,
      403,
    );
    const forged = Buffer.from(
      JSON.stringify({
        subscription: {
          type: 'channel.chat.message',
          version: '1',
          condition: { broadcaster_user_id: HOME, user_id: BOT },
        },
        event: {
          broadcaster_user_id: HOME,
          chatter_user_id: HOME,
          message_id: 'forged-review',
          message: { text: '!relic approve last', fragments: [] },
        },
      }),
    );
    assert.equal(
      (
        await f.request(
          '/eventsub',
          'POST',
          {
            'content-type': 'application/json',
            'twitch-eventsub-message-id': 'forged-review',
            'twitch-eventsub-message-timestamp': new Date(f.now()).toISOString(),
            'twitch-eventsub-message-signature': 'sha256=' + '0'.repeat(64),
            'twitch-eventsub-message-type': 'notification',
          },
          forged,
        )
      ).status,
      403,
    );
    assert.deepEqual(current(await privateDoc(f)).marks, current(before).marks);
    assert.equal(posts(f).length, baseline);
    await f.runtime.state.setChannelPolicy(
      HOME,
      { banned: false, blockedUserIds: ['501'] },
      f.now(),
    );
    await review(f, '!relic reject last', { actor: '501', mod: true });
    assert.deepEqual(current(await privateDoc(f)).marks, current(before).marks);
    assert.equal(posts(f).length, baseline);
    await f.runtime.state.setChannelPolicy(HOME, { banned: false, blockedUserIds: [] }, f.now());
    await f.control(HOME, 'pause');
    const pausedPosts = posts(f).length;
    await review(f, '!relic approve last');
    assert.equal(posts(f).length, pausedPosts);
    assert.deepEqual(current(await privateDoc(f)).marks, current(before).marks);
    await f.control(HOME, 'resume');
    const oldAt = f.now();
    f.advance(600001);
    const beforeExpired = posts(f).length;
    assert.equal((await review(f, '!relic reject last', { sentAt: oldAt })).status, 403);
    assert.equal(posts(f).length, beforeExpired);
    assert.deepEqual(current(await privateDoc(f)).marks, current(before).marks);
    const oldStart = f.now();
    await f.signed('stream.offline', { broadcaster_user_id: HOME }, HOME);
    f.advance(1000);
    assert.equal(
      (
        await f.signed(
          'stream.online',
          {
            id: '990099',
            type: 'live',
            broadcaster_user_id: HOME,
            started_at: new Date(f.now()).toISOString(),
          },
          HOME,
        )
      ).status,
      204,
    );
    assert.equal((await f.runtime.state.getStreamStatus(HOME)).streamId, '990099');
    const newStream = await privateDoc(f),
      postBaseline = posts(f).length;
    await review(f, '!relic reject last', { sentAt: oldStart });
    assert.deepEqual((await privateDoc(f)).sessions, newStream.sessions);
    assert.equal(posts(f).length, postBaseline);
  });
  test(`${kind}: named block fails closed for signed, guessed, renamed and reused logins; numeric block remains authoritative`, async () => {
    const f = await ready(kind),
      before = await privateDoc(f);
    for (const [i, login] of ['viewer101', 'sample_mod', '__proto__', 'constructor'].entries()) {
      f.advance(10001);
      await review(f, '!relic block @' + login, {
        actor: HOME,
        login: i % 2 ? 'viewer101' : 'new_name',
      });
      assert.deepEqual((await privateDoc(f)).blocked, before.blocked);
      assert.deepEqual(current(await privateDoc(f)).marks, current(before).marks);
    }
    assert.ok(posts(f).some((p) => p.message === BOT_COPY.reviewUnknownLogin));
    await review(f, '!relic block 102');
    const blocked = await privateDoc(f);
    assert.ok(blocked.blocked.includes('102'));
    assert.equal(
      current(blocked).marks.some((m) => m.userId === '102'),
      false,
    );
    assert.equal(current(blocked).spent, 3);
    await f.chat(HOME, '103', '!relic forgetme');
    f.advance(10001);
    await review(f, '!relic pending');
    assert.equal(
      posts(f).at(-1).message,
      '0 pending marks in this active stream. ' + BOT_COPY.reviewInstructions,
    );
    assert.ok(
      !f.calls.some((c) =>
        ['/helix/users', '/helix/moderation/bans', '/helix/raids'].includes(
          new URL(c.url).pathname,
        ),
      ),
    );
  });
}

// Conservative provider shape: one literal prefix plus exactly one mention.
const mentionParts = (id = '101', login = 'viewer101') => [
  { type: 'text', text: '!relic block ', mention: null, emote: null, cheermote: null },
  {
    type: 'mention',
    text: '@' + login,
    mention: { user_id: id, user_login: login, user_name: 'IGNORED display name' },
    emote: null,
    cheermote: null,
  },
];
function mentionPayload(parts = mentionParts(), text = '!relic block @viewer101') {
  return {
    subscription: {
      type: 'channel.chat.message',
      version: '1',
      condition: { broadcaster_user_id: host, user_id: '299' },
    },
    event: {
      broadcaster_user_id: host,
      chatter_user_id: host,
      chatter_user_login: 'owner',
      message_id: 'parsed-mention',
      badges: [],
      message: { text, fragments: parts },
    },
  };
}
const parsedMention = (payload = mentionPayload()) =>
  parseChat(payload, { streamerId: host, botId: '299', includeMarkCommands: true });
test('signed-parser mention proof is object-bound, survives the real reducer call, and cannot be copied or forged as action fields', () => {
  const actor = parsedMention(),
    doc = pendingDoc();
  assert.equal(verifiedMentionTarget(actor, actor.markAction), '101');
  assert.equal(verifiedMentionTarget({ ...actor }, actor.markAction), null);
  assert.equal(verifiedMentionTarget(structuredClone(actor), actor.markAction), null);
  assert.equal(verifiedMentionTarget(actor, { ...actor.markAction, userId: '102' }), null);
  actor.markAction.userId = '103'; // Irrelevant raw fields cannot replace the parsed target.
  const next = reduceMark(doc, host, actor, actor.markAction, 102);
  assert.deepEqual(next.blocked, ['101']);
  assert.equal(
    next.sessions[0].marks.some((m) => m.userId === '101'),
    false,
  );
  assert.equal(next.sessions[0].spent, 3);
  assert.deepEqual(next.cooldowns, doc.cooldowns);
  assert.equal(markPrivacyChange(doc, next, actor, host, actor.markAction), true);
  assert.equal(markCommandOutcome(doc, next, host, actor, actor.markAction), 'login-blocked');
  const plain = {
    ...owner,
    markAction: { type: 'block-login', login: 'viewer101', userId: '101' },
  };
  assert.deepEqual(reduceMark(doc, host, plain, plain.markAction, 102), doc);
  const displayOnly = mentionPayload();
  displayOnly.event.message.fragments[1].mention.user_name = 'another_login';
  const valid = parsedMention(displayOnly);
  assert.equal(verifiedMentionTarget(valid, valid.markAction), '101');
});
for (const [name, alter] of [
  [
    'plaintext only',
    (p) => {
      p.event.message.fragments = [{ type: 'text', text: p.event.message.text }];
    },
  ],
  [
    'missing metadata',
    (p) => {
      delete p.event.message.fragments[1].mention;
    },
  ],
  [
    'null mention',
    (p) => {
      p.event.message.fragments[1].mention = null;
    },
  ],
  [
    'display name only',
    (p) => {
      p.event.message.fragments[1].mention = { user_name: 'viewer101' };
    },
  ],
  [
    'missing ID',
    (p) => {
      delete p.event.message.fragments[1].mention.user_id;
    },
  ],
  [
    'nonstring ID',
    (p) => {
      p.event.message.fragments[1].mention.user_id = 101;
    },
  ],
  [
    'overlong ID',
    (p) => {
      p.event.message.fragments[1].mention.user_id = '1'.repeat(33);
    },
  ],
  [
    'URL ID',
    (p) => {
      p.event.message.fragments[1].mention.user_id = 'https://example.test';
    },
  ],
  [
    'wrong login',
    (p) => {
      p.event.message.fragments[1].mention.user_login = 'viewer102';
    },
  ],
  [
    'missing login',
    (p) => {
      delete p.event.message.fragments[1].mention.user_login;
    },
  ],
  [
    'overlong login',
    (p) => {
      p.event.message.fragments[1].mention.user_login = 'a'.repeat(26);
    },
  ],
  [
    'URL login',
    (p) => {
      p.event.message.fragments[1].mention.user_login = 'https://example.test';
    },
  ],
  [
    'unknown target field',
    (p) => {
      p.event.message.fragments[1].mention.target_id = '102';
    },
  ],
  [
    'prototype target field',
    (p) => {
      p.event.message.fragments[1].mention = JSON.parse(
        '{"user_id":"101","user_login":"viewer101","__proto__":{"user_id":"102"}}',
      );
    },
  ],
  [
    'extra fragment target',
    (p) => {
      p.event.message.fragments[1].user_id = '102';
    },
  ],
  [
    'prefix contains mention',
    (p) => {
      p.event.message.fragments[0].mention = { user_id: '102', user_login: 'other' };
    },
  ],
  [
    'reconstructed mismatch',
    (p) => {
      p.event.message.fragments[1].text = '@viewer102';
    },
  ],
  [
    'prefix mismatch',
    (p) => {
      p.event.message.fragments[0].text = '!relic block  ';
    },
  ],
  [
    'duplicate mentions',
    (p) => {
      p.event.message.fragments.push(structuredClone(p.event.message.fragments[1]));
    },
  ],
  [
    'conflicting mentions',
    (p) => {
      p.event.message.fragments.push(mentionParts('102', 'viewer102')[1]);
    },
  ],
  [
    'extra whitespace fragment',
    (p) => {
      p.event.message.fragments.push({ type: 'text', text: ' ' });
    },
  ],
  [
    'prototype login',
    (p) => {
      p.event.message.text = '!relic block @__proto__';
      p.event.message.fragments = mentionParts('101', '__proto__');
    },
  ],
  [
    'constructor login',
    (p) => {
      p.event.message.text = '!relic block @constructor';
      p.event.message.fragments = mentionParts('101', 'constructor');
    },
  ],
])
  test('mention proof refuses ' + name, () => {
    const payload = mentionPayload();
    alter(payload);
    const actor = parsedMention(payload);
    assert.equal(verifiedMentionTarget(actor, actor.markAction), null);
    assert.deepEqual(reduceMark(pendingDoc(), host, actor, actor.markAction, 102), pendingDoc());
  });
test('fragment global bound, wrong subscription, copied and bot paths cannot mint a mention target', () => {
  const tooMany = mentionPayload(Array.from({ length: 501 }, () => ({ type: 'text', text: '' })));
  assert.throws(() => parsedMention(tooMany), /Invalid chat/);
  const wrong = mentionPayload();
  wrong.subscription.condition.broadcaster_user_id = '202';
  assert.throws(() => parsedMention(wrong), /Invalid chat/);
  for (const edit of [
    (p) => {
      p.event.chatter_user_id = '299';
    },
    (p) => {
      p.event.source_broadcaster_user_id = '202';
      p.event.source_message_id = '00000000-0000-4000-8000-000000000001';
    },
    (p) => {
      p.event.chatter_user_id = '501';
    },
  ]) {
    const payload = mentionPayload();
    edit(payload);
    const actor = parsedMention(payload);
    assert.equal(verifiedMentionTarget(actor, actor.markAction), null);
  }
  const caseFold = mentionPayload(mentionParts('101', 'Viewer101'), '!relic block @Viewer101');
  const actor = parsedMention(caseFold);
  assert.equal(verifiedMentionTarget(actor, actor.markAction), '101');
});
test('resolved mention keeps block128 bound with unchanged original document on capacity rejection', () => {
  let doc = pendingDoc();
  for (let i = 1000; i < 1128; i++)
    doc = reduceMark(doc, host, owner, { type: 'block', userId: String(i) }, 102);
  const before = structuredClone(doc),
    actor = parsedMention();
  assert.equal(doc.blocked.length, 128);
  assert.throws(() => reduceMark(doc, host, actor, actor.markAction, 103), /Block capacity/);
  assert.deepEqual(doc, before);
});
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: actual signed owner/mod mentions block only the target; replay cannot select a new mentioned ID or refund counters`, async () => {
    for (const options of [{ actor: HOME }, { actor: '501', mod: true }]) {
      const f = await ready(kind),
        before = await privateDoc(f),
        startCalls = f.calls.length;
      await review(f, '!relic block @viewer101', {
        ...options,
        fragments: mentionParts(),
        messageId: 'named-block-once',
      });
      const next = await privateDoc(f);
      assert.ok(next.blocked.includes('101'));
      assert.deepEqual(
        current(next).marks.map((m) => m.userId),
        ['102', '103'],
      );
      assert.equal(current(next).spent, current(before).spent);
      assert.deepEqual(current(next).viewers, current(before).viewers);
      assert.deepEqual(next.cooldowns, before.cooldowns);
      assert.equal((await f.runtime.state.getPublicMarks(HOME)).marks.length, 0);
      const sent = posts(f).filter((p) => p.message === BOT_COPY.reviewBlocked);
      assert.equal(sent.length, 1);
      assert.equal(sent[0].broadcaster_id, HOME);
      await Promise.all([
        review(f, '!relic block @viewer101', {
          ...options,
          fragments: mentionParts(),
          messageId: 'named-block-once',
        }),
        review(f, '!relic block @viewer102', {
          ...options,
          fragments: mentionParts('102', 'viewer102'),
          messageId: 'named-block-once',
        }),
      ]);
      assert.deepEqual((await privateDoc(f)).blocked, next.blocked);
      assert.equal(posts(f).filter((p) => p.message === BOT_COPY.reviewBlocked).length, 1);
      // Normal sendChat validates its existing bot grant before one POST.
      // Closed codes keep any unexpected operation diagnosable without bodies,
      // credentials or raw request URLs. No resolver/token/subscription/raid call.
      const operations = f.calls.slice(startCalls).map((c) => {
        const u = new URL(c.url),
          method = c.method ?? 'GET';
        if (u.search || u.hash) return 0;
        if (
          u.origin === 'https://api.twitch.tv' &&
          u.pathname === '/helix/chat/messages' &&
          method === 'POST'
        )
          return 1;
        if (
          u.origin === 'https://id.twitch.tv' &&
          u.pathname === '/oauth2/validate' &&
          method === 'GET'
        )
          return 2;
        return 0;
      });
      assert.deepEqual(operations.slice().sort(), [1, 2]);
    }
  });
  test(`${kind}: structured target cannot bypass actor/stream policy and bad signatures; plaintext stays unresolved`, async () => {
    const f = await ready(kind),
      before = await privateDoc(f),
      baseline = posts(f).length;
    for (const options of [
      { actor: '101' },
      { actor: BOT, mod: true },
      { actor: '501', mod: true, copied: true },
    ])
      await review(f, '!relic block @viewer101', { ...options, fragments: mentionParts() });
    assert.equal(
      (await review(f, '!relic block @viewer101', { fragments: mentionParts(), eventRoom: OTHER }))
        .status,
      400,
    );
    const forged = mentionPayload(mentionParts());
    forged.event.broadcaster_user_id = HOME;
    forged.event.chatter_user_id = HOME;
    forged.subscription.condition = { broadcaster_user_id: HOME, user_id: BOT };
    assert.equal(
      (
        await f.request(
          '/eventsub',
          'POST',
          {
            'content-type': 'application/json',
            'twitch-eventsub-message-id': 'bad-mention',
            'twitch-eventsub-message-timestamp': new Date(f.now()).toISOString(),
            'twitch-eventsub-message-signature': 'sha256=' + '0'.repeat(64),
            'twitch-eventsub-message-type': 'notification',
          },
          Buffer.from(JSON.stringify(forged)),
        )
      ).status,
      403,
    );
    assert.deepEqual(current(await privateDoc(f)).marks, current(before).marks);
    assert.deepEqual((await privateDoc(f)).blocked, []);
    assert.equal(posts(f).length, baseline);
    await f.runtime.state.setChannelPolicy(
      HOME,
      { banned: false, blockedUserIds: ['501'] },
      f.now(),
    );
    await review(f, '!relic block @viewer101', {
      actor: '501',
      mod: true,
      fragments: mentionParts(),
    });
    assert.deepEqual((await privateDoc(f)).blocked, []);
    await f.runtime.state.setChannelPolicy(HOME, { banned: false, blockedUserIds: [] }, f.now());
    await f.control(HOME, 'pause');
    await review(f, '!relic block @viewer101', { fragments: mentionParts() });
    assert.deepEqual((await privateDoc(f)).blocked, []);
    await f.control(HOME, 'resume');
    for (const parts of [
      [{ type: 'text', text: '!relic block @viewer101' }],
      [
        { type: 'text', text: '!relic block ' },
        { type: 'mention', text: '@viewer101', mention: { user_name: 'viewer101' } },
      ],
      [
        { type: 'text', text: '!relic block ' },
        { type: 'mention', text: '@viewer101', mention: { user_login: 'viewer101' } },
      ],
      mentionParts('101', 'viewer102'),
      [...mentionParts(), mentionParts('102', 'viewer102')[1]],
      mentionParts().map((p, i) => (i ? { ...p, text: '@wrong' } : p)),
    ]) {
      assert.equal((await review(f, '!relic block @viewer101', { fragments: parts })).status, 204);
      assert.deepEqual((await privateDoc(f)).blocked, []);
      assert.deepEqual(current(await privateDoc(f)).marks, current(before).marks);
    }
    assert.equal(
      (
        await review(f, '!relic block @viewer101', {
          fragments: Array.from({ length: 501 }, () => ({ type: 'text', text: '' })),
        })
      ).status,
      400,
    );
    const oldAt = f.now();
    f.advance(1000);
    assert.equal(
      (await f.signed('stream.offline', { broadcaster_user_id: HOME }, HOME)).status,
      204,
    );
    f.advance(1000);
    assert.equal(
      (
        await f.signed(
          'stream.online',
          {
            id: '990100',
            type: 'live',
            broadcaster_user_id: HOME,
            started_at: new Date(f.now()).toISOString(),
          },
          HOME,
        )
      ).status,
      204,
    );
    assert.equal((await f.runtime.state.getStreamStatus(HOME)).streamId, '990100');
    await review(f, '!relic block @viewer101', { fragments: mentionParts(), sentAt: oldAt });
    assert.deepEqual((await privateDoc(f)).blocked, []);
    // The earlier negative requests also retain ignored ACK rows under the
    // existing eight-per-actor/ten-minute bound. Ten seconds is not their TTL.
    f.advance(600001);
    assert.equal((await f.control(HOME, 'keep')).status, 200);
    const channel = await f.runtime.state.getStreamStatus(HOME),
      eligible = await privateDoc(f);
    assert.equal(channel.online, true);
    assert.equal(channel.streamId, '990100');
    assert.equal(channel.optedIn, true);
    assert.equal(channel.paused, false);
    assert.equal(channel.banned, false);
    assert.equal(channel.consentAt, f.now());
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
    assert.equal(eligible.context.streamId, channel.streamId);
    assert.equal(eligible.context.optedIn, true);
    assert.equal(eligible.context.holdsRelic, true);
    assert.equal(eligible.paused, false);
    assert.equal(current(eligible).closed, false);
    const newReplies = posts(f).length;
    assert.equal((await review(f, '!relic block @viewer101')).status, 204);
    const replies = posts(f).slice(newReplies);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].broadcaster_id, HOME);
    assert.equal(replies[0].message, BOT_COPY.reviewUnknownLogin);
    assert.deepEqual((await privateDoc(f)).sessions, eligible.sessions);
    assert.deepEqual((await privateDoc(f)).blocked, []);
  });
  test(`${kind}: resolved named block erases carried associations and actual share grants through existing privacy fences`, async () => {
    const f = await ready(kind);
    for (const [from, to, i] of [
      [HOME, OTHER, 1],
      [OTHER, HOME, 2],
    ]) {
      f.advance(31000);
      assert.equal(JSON.parse((await f.control(from, 'send:' + to)).body).status, 'accepted');
      await f.raid(from, to, 1);
      await f.chat(from, '601' + i, '!offer');
      await f.chat(to, '602' + i, '!accept');
    }
    const journey = await f.runtime.state.getPublicJourney();
    assert.equal(journey.rings, 2);
    assert.ok(journey.stops.some((s) => s.marks.length > 0));
    await f.chat(HOME, '101', '!relic mymarks');
    assert.ok((await privateDoc(f)).shares?.length > 0);
    const queuedPayload = {
      subscription: {
        type: 'channel.chat.message',
        version: '1',
        condition: { broadcaster_user_id: HOME, user_id: BOT },
      },
      event: {
        broadcaster_user_id: HOME,
        chatter_user_id: '101',
        message_id: 'pre-block-where',
        badges: [],
        message: { text: '!where', fragments: [{ type: 'text', text: '!where' }] },
      },
    };
    const queuedChat = parseChat(queuedPayload, {
      streamerId: HOME,
      botId: BOT,
      includeMarkCommands: true,
    });
    // Existing transaction seam deliberately leaves this real reply row queued,
    // rather than asking the HTTP handler to dispatch it before the block.
    const queued = await f.runtime.state.accept({
      id: 'pre-block-where-delivery',
      chat: queuedChat,
      now: f.now(),
      sentAt: f.now(),
      expiresAt: f.now() + 600000,
    });
    assert.equal(queued.commandReply.reason, 'queued');
    const before = await privateDoc(f),
      raidPosts = f.calls.filter((c) => new URL(c.url).pathname === '/helix/raids').length;
    await review(f, '!relic block @viewer101', { fragments: mentionParts() });
    const next = await privateDoc(f),
      after = await f.runtime.state.getPublicJourney();
    assert.ok(next.blocked.includes('101'));
    assert.equal(next.shares, undefined);
    assert.equal(
      await f.runtime.state.scoreAckStep(HOME, { type: 'claim', key: ackKey(queuedChat) }, f.now()),
      null,
    );
    assert.ok(next.sessions.every((s) => s.marks.every((m) => m.userId !== '101')));
    assert.equal(current(next).spent, current(before).spent);
    assert.equal(after.rings, 2);
    assert.ok(after.stops.every((s) => s.marks.length === 0));
    assert.equal(
      f.calls.filter((c) => new URL(c.url).pathname === '/helix/raids').length,
      raidPosts,
    );
    assert.doesNotMatch(JSON.stringify(after), /viewer101|user_login|sample_mod/);
  });
}
