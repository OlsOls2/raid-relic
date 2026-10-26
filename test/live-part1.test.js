import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { reduceClaims } from '../src/claims.js';
import { reduceScores } from '../src/scoreboard.js';
import { parseMarkCommand } from '../src/marks.js';
const replies = (f) =>
  f.calls.filter((c) => c.url.endsWith('/chat/messages')).map((c) => JSON.parse(c.body));
async function setup(kind) {
  const f = await pilotFixture(kind, {
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
test('bare scores is its own signed read command, not generic help or consent', () => {
  assert.deepEqual(parseMarkCommand('!relic scores'), { type: 'scores-status' });
  assert.deepEqual(parseMarkCommand('!relic scores on'), { type: 'scores-on' });
  assert.deepEqual(parseMarkCommand('!relic scores off'), { type: 'scores-off' });
});
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: legal early source votes and reverse-direction votes survive until verified binding`, async () => {
    const f = await setup(kind);
    for (const [from, to, user, acceptor] of [
      [HOME, OTHER, '811', '812'],
      [OTHER, HOME, '821', '822'],
    ]) {
      const before = (await f.runtime.state.getPublicJourney()).rings;
      assert.equal((await f.control(from, `send:${to}`)).status, 200);
      await f.chat(from, user, '!offer', { messageId: `early-${user}` });
      assert.match(replies(f).at(-1).message, /Offers 1\/1.*Waiting for Twitch/);
      assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop.offers, [user]);
      for (const host of [HOME, OTHER])
        assert.equal((await f.runtime.overlayFeeds[host].snapshot()).claimMeter.offers, 1);
      assert.equal((await f.runtime.state.getPublicJourney()).rings, before);
      const n = replies(f).length;
      await f.chat(from, user, '!offer', { messageId: `early-${user}` });
      assert.equal(replies(f).length, n);
      f.advance();
      await f.raid(from, to, 1);
      assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop.offers, [user]);
      assert.equal((await f.runtime.state.getPublicJourney()).rings, before);
      await f.chat(to, acceptor, '!accept');
      assert.equal((await f.runtime.state.getPublicJourney()).rings, before + 1);
      f.advance(60001);
    }
  });
  test(`${kind}: missing-hop accepted-intent status is transaction-derived, bounded and never counts a vote`, async () => {
    const f = await setup(kind);
    await f.control(HOME, `send:${OTHER}`);
    const root = await f.runtime.state.getKeeperRegistry();
    delete root.pendingHop;
    const channels = {},
      marks = {};
    for (const host of [HOME, OTHER]) {
      channels[host] = await f.runtime.state.getStreamStatus(host);
      marks[host] = await f.runtime.state.getPrivateMarks(host, {
        broadcasterId: host,
        chatterId: host,
      });
    }
    const chat = {
      broadcasterId: HOME,
      chatterId: '831',
      messageId: 'unrecorded-offer',
      markAction: { type: 'offer' },
      isBot: false,
      copied: false,
    };
    const evaluate = (r, c, now = f.now()) =>
      reduceClaims(r, channels, marks, { stops: [] }, c, now, now);
    const result = evaluate(root, chat);
    assert.equal(result.awaitingRaid, true);
    assert.equal(result.acknowledgement, null);
    assert.equal(result.registry.pendingHop, undefined);
    assert.equal(result.lineage.stops.length, 0);
    const reply = reduceScores(undefined, {
      channels,
      marks,
      chat,
      now: f.now(),
      awaitingRaid: result.awaitingRaid,
    });
    assert.equal(
      reply.message,
      'Raid accepted. Wait for it to land, then send !offer again. This early offer was not saved.',
    );
    for (const c of [
      { ...chat, broadcasterId: OTHER },
      { ...chat, copied: true },
      { ...chat, isBot: true },
    ])
      assert.equal(evaluate(root, c).awaitingRaid, false);
    assert.equal(evaluate(root, chat, root.send.acceptedAt + 180000).awaitingRaid, false);
    assert.equal(evaluate({ ...root, send: undefined }, chat).awaitingRaid, false);
    assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.offers.length, 0);
  });
  test(`${kind}: own scores status on/off survives offline nonholder reads without consent or other-actor indexing`, async () => {
    const f = await setup(kind);
    for (const host of [HOME, OTHER]) {
      f.advance(30001);
      await f.chat(host, '811', '!relic scores');
      assert.equal(replies(f).at(-1).broadcaster_id, host);
      assert.equal(replies(f).at(-1).sender_id, BOT);
      assert.match(replies(f).at(-1).message, /Scores are off for you/);
    }
    assert.equal(JSON.parse((await f.request('/api/scores')).body).raiders.length, 0);
    await f.chat(OTHER, '811', '!relic scores on');
    f.advance(30001);
    await f.chat(OTHER, '811', '!relic scores', { messageId: 'status-on' });
    assert.match(replies(f).at(-1).message, /Scores are on for you: 0 recorded raids/);
    const count = replies(f).length;
    await f.chat(OTHER, '811', '!relic scores', { messageId: 'status-on' });
    assert.equal(replies(f).length, count);
    await f.control(HOME, `send:${OTHER}`);
    f.advance();
    await f.raid();
    await f.chat(HOME, '811', '!offer');
    await f.chat(OTHER, '812', '!accept');
    f.advance(30001);
    await f.chat(OTHER, '811', '!relic scores');
    assert.match(replies(f).at(-1).message, /Scores are on for you: 1 recorded raids/);
    f.advance();
    await f.signed('stream.offline', { broadcaster_user_id: OTHER }, OTHER);
    f.advance(30001);
    await f.chat(OTHER, '811', '!relic scores');
    assert.match(replies(f).at(-1).message, /Scores are on for you/);
    await f.chat(OTHER, '811', '!relic scores off');
    f.advance(30001);
    await f.chat(OTHER, '811', '!relic scores');
    assert.match(replies(f).at(-1).message, /Scores are off for you/);
    assert.equal(JSON.parse((await f.request('/api/scores')).body).raiders.length, 0);
    assert.ok(replies(f).every((p) => [...p.message].length <= 500));
  });
  test(`${kind}: signed veto replies reflect committed approved/held/empty effects without quota refund or private content`, async () => {
    const f = await setup(kind),
      actor = { broadcasterId: HOME, chatterId: HOME };
    await f.chat(HOME, '811', '!mark moon');
    await f.chat(HOME, '812', '!relic veto');
    assert.match(replies(f).at(-1).message, /Only this broadcaster/);
    let before = await f.runtime.state.getPrivateMarks(HOME, actor);
    assert.equal(before.sessions[0].marks.length, 1);
    await f.chat(HOME, HOME, '!relic veto', { messageId: 'veto-approved' });
    assert.equal(replies(f).at(-1).message, 'Vetoed latest mark.');
    const n = replies(f).length;
    await f.chat(HOME, HOME, '!relic veto', { messageId: 'veto-approved' });
    assert.equal(replies(f).length, n);
    let after = await f.runtime.state.getPrivateMarks(HOME, actor);
    assert.equal(after.sessions[0].spent, before.sessions[0].spent);
    assert.deepEqual(after.cooldowns, before.cooldowns);
    await f.chat(HOME, '813', '!mark spoiler');
    f.advance(30001);
    await f.chat(HOME, HOME, '!relic veto');
    assert.equal(replies(f).at(-1).message, 'Vetoed latest mark.');
    assert.doesNotMatch(replies(f).at(-1).message, /spoiler|moon|813/);
    f.advance(30001);
    await f.chat(HOME, HOME, '!relic veto');
    assert.equal(
      replies(f).at(-1).message,
      'Nothing is retained to veto in this channel. Moderators can remove the latest approved or pending mark; veto never refunds the five-mark allowance or waiting time.',
    );
    assert.equal((await f.runtime.state.getPrivateMarks(HOME, actor)).sessions[0].spent, 2);
    assert.equal(
      await f.runtime.state.controlMarks(HOME, actor, { type: 'veto-last' }, f.now()),
      'empty',
    );
  });
}
