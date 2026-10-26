import test from 'node:test';
import assert from 'node:assert/strict';
import {
  markReviewPolicy,
  normalizeMark,
  parseMarkCommand,
  setMarkContext,
  reduceMark,
  markPrivacyChange,
} from '../src/marks.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
export async function reviewFixture(kind = 'memory', origin = 'https://pilot.example') {
  const f = await pilotFixture(kind, {
    origin,
    chronicleEnv: { MARK_AUTO_APPROVE_ENABLED: 'true', MARK_REVIEW_BLOCKLIST: '["spoiler"]' },
  });
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  return f;
}
const own = { broadcasterId: HOME, chatterId: HOME },
  viewer = { broadcasterId: HOME, chatterId: '811' };
const context = () =>
  setMarkContext(null, HOME, {
    streamId: '9001',
    keeperId: HOME,
    optedIn: true,
    holdsRelic: true,
    blockedUserIds: [],
  });
test('operator review policy is bounded literal NFKC matching; invalid configuration and forged objects stay manual', () => {
  for (const env of [
    {},
    { MARK_AUTO_APPROVE_ENABLED: 'TRUE' },
    { MARK_AUTO_APPROVE_ENABLED: 'true', MARK_REVIEW_BLOCKLIST: '[' },
    { MARK_AUTO_APPROVE_ENABLED: 'true', MARK_REVIEW_BLOCKLIST: '["(a+)+$"]' },
    {
      MARK_AUTO_APPROVE_ENABLED: 'true',
      MARK_REVIEW_BLOCKLIST: JSON.stringify(Array(33).fill('moon')),
    },
    { MARK_AUTO_APPROVE_ENABLED: 'true', MARK_REVIEW_BLOCKLIST: 'x'.repeat(4097) },
  ])
    assert.equal(markReviewPolicy(env).autoApprove, false);
  const policy = markReviewPolicy({
    MARK_AUTO_APPROVE_ENABLED: 'true',
    MARK_REVIEW_BLOCKLIST: '["ＳＰＯＩＬＥＲ","Straße"]',
  });
  assert.deepEqual(policy.terms, ['spoiler', 'strasse']);
  let d = reduceMark(
    context(),
    HOME,
    viewer,
    { type: 'mark', text: 'ＳＰＯＩＬＥＲ' },
    100,
    policy,
  );
  assert.equal(d.sessions[0].marks[0].status, 'pending');
  assert.equal(normalizeMark('https://unsafe'), null);
  d = reduceMark(context(), HOME, viewer, { type: 'mark', text: 'moon', status: 'approved' }, 100, {
    autoApprove: true,
    terms: [],
  });
  assert.equal(d.sessions[0].marks[0].status, 'pending');
  d = reduceMark(
    context(),
    HOME,
    viewer,
    { type: 'mark', text: 'moon' },
    100,
    markReviewPolicy({ MARK_AUTO_APPROVE_ENABLED: 'true' }),
  );
  assert.equal(d.sessions[0].marks[0].status, 'approved');
  assert.deepEqual(parseMarkCommand('!relic veto'), { type: 'veto-last' });
  assert.deepEqual(parseMarkCommand('!relic veto-last'), { type: 'veto-last' });
});
test('turning policy on never auto-approves old pending marks, and veto never refunds quota or cooldown', () => {
  let d = reduceMark(context(), HOME, viewer, { type: 'mark', text: 'moon' }, 100);
  d = reduceMark(
    d,
    HOME,
    { ...viewer, chatterId: '812' },
    { type: 'mark', text: 'star' },
    101,
    markReviewPolicy({ MARK_AUTO_APPROVE_ENABLED: 'true' }),
  );
  assert.deepEqual(
    d.sessions[0].marks.map((m) => m.status),
    ['pending', 'approved'],
  );
  const next = reduceMark(d, HOME, own, { type: 'veto-last' }, 102);
  assert.equal(next.sessions[0].spent, 2);
  assert.equal(next.cooldowns.length, 2);
  assert.equal(markPrivacyChange(d, next, own, HOME, { type: 'veto-last' }), true);
  assert.equal(markPrivacyChange(d, next, viewer, HOME, { type: 'veto-last' }), false);
});
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: clean signed marks approved atomically, custom matches held private, mod approval and veto work without quota refund`, async () => {
    const f = await reviewFixture(kind);
    await f.chat(HOME, '811', '!mark moon', { messageId: 'auto-once' });
    await f.chat(HOME, '811', '!mark moon', { messageId: 'auto-once' });
    let d = await f.runtime.state.getPrivateMarks(HOME, own);
    assert.equal(d.sessions[0].spent, 1);
    assert.equal(d.sessions[0].marks[0].status, 'approved');
    assert.equal((await f.runtime.overlayFeeds[HOME].snapshot()).approvedCount, 1);
    await f.chat(HOME, '812', '!mark spoiler');
    d = await f.runtime.state.getPrivateMarks(HOME, own);
    assert.equal(d.sessions[0].marks[1].status, 'pending');
    assert.equal((await f.runtime.overlayFeeds[HOME].snapshot()).approvedCount, 1);
    assert.doesNotMatch(JSON.stringify(await f.runtime.state.getPublicMarks(HOME)), /spoiler/);
    await f.chat(HOME, '813', '!relic veto');
    assert.equal((await f.runtime.state.getPrivateMarks(HOME, own)).sessions[0].marks.length, 2);
    await f.signed(
      'channel.chat.message',
      {
        broadcaster_user_id: HOME,
        chatter_user_id: '814',
        message_id: 'mod-approve',
        badges: [{ set_id: 'moderator', id: '1' }],
        message: { text: '!relic approve m2', fragments: [] },
      },
      HOME,
      { broadcaster_user_id: HOME, user_id: BOT },
    );
    assert.equal((await f.runtime.overlayFeeds[HOME].snapshot()).approvedCount, 2);
    await f.chat(HOME, HOME, '!relic veto');
    assert.equal((await f.runtime.overlayFeeds[HOME].snapshot()).approvedCount, 1);
    d = await f.runtime.state.getPrivateMarks(HOME, own);
    assert.equal(d.sessions[0].spent, 2);
    assert.equal(d.sessions[0].viewers.find((v) => v.userId === '812').spent, 1);
    await f.chat(HOME, HOME, '!relic veto', { messageId: 'veto-once' });
    await f.chat(HOME, HOME, '!relic veto', { messageId: 'veto-once' });
    assert.equal((await f.runtime.overlayFeeds[HOME].snapshot()).approvedCount, 0);
  });
  test(`${kind}: five-per-viewer quota/cooldown, carried-content privacy erasure and bot/copy blocking remain`, async () => {
    const f = await reviewFixture(kind);
    await f.chat(HOME, '811', '!mark moon');
    await f.chat(HOME, '811', '!mark star');
    for (let i = 0; i < 5; i++) {
      f.advance(30001);
      await f.chat(HOME, '811', '!mark star');
    }
    let d = await f.runtime.state.getPrivateMarks(HOME, own);
    assert.equal(d.sessions[0].viewers.find((v) => v.userId === '811').spent, 5);
    assert.equal(d.sessions[0].marks.length, 5);
    await f.chat(HOME, BOT, '!mark bright');
    assert.equal((await f.runtime.state.getPrivateMarks(HOME, own)).sessions[0].marks.length, 5);
    await f.control(HOME, `send:${OTHER}`);
    f.advance();
    await f.raid();
    await f.chat(HOME, HOME, '!offer');
    await f.chat(OTHER, OTHER, '!accept');
    assert.equal((await f.runtime.state.getPublicJourney()).stops[0].marks.length, 5);
    await f.chat(HOME, '811', '!relic forgetme');
    assert.equal((await f.runtime.state.getPublicJourney()).stops[0].marks.length, 0);
    assert.equal((await f.runtime.overlayFeeds[OTHER].snapshot()).approvedCount, 0);
    d = await f.runtime.state.getPrivateMarks(HOME, own);
    assert.equal(d.sessions[0].viewers.find((v) => v.userId === '811').spent, 5);
  });
}
for (const kind of ['memory', 'firestore'])
  test(`${kind}: copied/unsigned/blocked actors cannot publish or veto; held latest can be vetoed directly`, async () => {
    const f = await reviewFixture(kind);
    await f.chat(HOME, '811', '!mark moon');
    let retained = await f.runtime.state.getPrivateMarks(HOME, own);
    assert.equal(retained.sessions[0].marks[0].status, 'approved');
    assert.equal(
      JSON.parse(f.calls.filter((c) => c.url.endsWith('/chat/messages')).at(-1).body).message,
      'Your mark is public on the relic.',
    );
    await f.chat(HOME, '812', '!mark spoiler');
    retained = await f.runtime.state.getPrivateMarks(HOME, own);
    assert.equal(retained.sessions[0].marks[1].status, 'pending');
    assert.equal(
      JSON.parse(f.calls.filter((c) => c.url.endsWith('/chat/messages')).at(-1).body).message,
      'Waiting for moderator approval. Your mark is private and is not visible on the relic.',
    );
    await f.signed(
      'channel.chat.message',
      {
        broadcaster_user_id: HOME,
        chatter_user_id: HOME,
        message_id: 'copied-veto',
        source_broadcaster_user_id: OTHER,
        source_message_id: '00000000-0000-4000-8000-000000000001',
        badges: [{ set_id: 'moderator', id: '1' }],
        source_badges: [{ set_id: 'moderator', id: '1' }],
        message: { text: '!relic veto', fragments: [] },
      },
      HOME,
      { broadcaster_user_id: HOME, user_id: BOT },
    );
    assert.equal((await f.runtime.state.getPrivateMarks(HOME, own)).sessions[0].marks.length, 2);
    const response = await f.request(
      '/eventsub',
      'POST',
      { 'content-type': 'application/json' },
      Buffer.from('{}'),
    );
    assert.equal(response.status, 403);
    await f.runtime.state.setChannelPolicy(
      HOME,
      { banned: false, blockedUserIds: ['814'] },
      f.now(),
    );
    await f.signed(
      'channel.chat.message',
      {
        broadcaster_user_id: HOME,
        chatter_user_id: '814',
        message_id: 'blocked-mod-veto',
        badges: [{ set_id: 'moderator', id: '1' }],
        message: { text: '!relic veto', fragments: [] },
      },
      HOME,
      { broadcaster_user_id: HOME, user_id: BOT },
    );
    assert.equal((await f.runtime.state.getPrivateMarks(HOME, own)).sessions[0].marks.length, 2);
    await f.chat(HOME, HOME, '!relic veto');
    const d = await f.runtime.state.getPrivateMarks(HOME, own);
    assert.equal(d.sessions[0].marks.length, 1);
    assert.equal(d.sessions[0].marks[0].text, 'moon');
    assert.equal(d.sessions[0].spent, 2);
    const replies = f.calls
      .filter((c) => c.url.endsWith('/chat/messages'))
      .map((c) => JSON.parse(c.body).message);
    assert.ok(replies.includes('Your mark is public on the relic.'));
    assert.ok(
      replies.includes(
        'Waiting for moderator approval. Your mark is private and is not visible on the relic.',
      ),
    );
    assert.ok(replies.every((m) => !m.includes('spoiler')));
    assert.ok(replies.every((m) => [...m].length <= 500));
  });
