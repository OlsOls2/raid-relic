import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
for (const kind of ['memory', 'firestore'])
  test(`${kind}: friendly transactional replies distinguish empty/held/public and actual Seeker opt-in`, async () => {
    const f = await pilotFixture(kind, {
      extraBotScopes: ['user:read:moderated_channels'],
      chronicleEnv: {
        SEEKERS_ENABLED: 'true',
        MARK_AUTO_APPROVE_ENABLED: 'true',
        MARK_REVIEW_BLOCKLIST: '["spoiler"]',
      },
    });
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) f.streams.get(id).viewer_count = 1;
    await f.control(HOME, 'bootstrap');
    f.advance();
    const replies = () =>
      f.calls
        .filter((c) => new URL(c.url).pathname === '/helix/chat/messages')
        .map((c) => JSON.parse(c.body).message);
    await f.chat(HOME, HOME, '!seek status');
    assert.match(replies().at(-1), /Opt in as a Keeper first/);
    assert.notEqual((await f.runtime.state.getStreamStatus(HOME)).seeking, true);
    assert.equal((await f.runtime.state.getStreamStatus(HOME)).optedIn, false);
    f.advance(31000);
    await f.control(HOME, 'keep');
    f.advance();
    await f.chat(HOME, HOME, '!seek off');
    assert.equal(
      replies().at(-1),
      'You hold the relic. Seeker queue off; pass it on before joining again.',
    );
    assert.equal((await f.runtime.state.getStreamStatus(HOME)).seeking, false);
    await f.chat(HOME, '9601', '!offer');
    assert.equal(
      replies().at(-1),
      'No Send Off is active yet. The keeper starts one on the control page, then raid and !offer.',
    );
    await f.chat(HOME, '9602', '!mark moon');
    assert.equal(replies().at(-1), 'Your mark is public on the relic.');
    await f.chat(HOME, '9603', '!mark spoiler');
    assert.match(replies().at(-1), /Waiting for moderator approval/);
    assert.doesNotMatch(replies().at(-1), /spoiler/);
    f.advance(31000);
    await f.chat(HOME, HOME, '!relic veto');
    assert.equal(replies().at(-1), 'Vetoed latest mark.');
    f.advance(31000);
    await f.chat(HOME, HOME, '!relic veto');
    assert.equal(replies().at(-1), 'Vetoed latest mark.');
    f.advance(31000);
    await f.chat(HOME, HOME, '!relic veto');
    assert.match(replies().at(-1), /Nothing is retained.*approved or pending/);
    const doc = await f.runtime.state.getPrivateMarks(HOME, {
      broadcasterId: HOME,
      chatterId: HOME,
    });
    assert.equal(doc.sessions[0].marks.length, 0);
    assert.equal(doc.sessions[0].viewers.find((v) => v.userId === '9602').spent, 1);
    assert.ok(replies().every((m) => m.length <= 500));
  });
