import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { seekerState, seekerStatusMessage } from '../src/seeker-state.js';
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: only completed receipts dequeue; holders cannot join; former holders explicitly rejoin and status does not mutate membership`, async () => {
    const f = await pilotFixture(kind, {
      extraBotScopes: ['user:read:moderated_channels'],
      chronicleEnv: { SEEKERS_ENABLED: 'true' },
    });
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) f.streams.get(id).viewer_count = 1;
    for (const id of [HOME, OTHER]) {
      assert.equal((await f.control(id, 'bootstrap')).status, 200);
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    await f.chat(HOME, HOME, '!seek');
    assert.notEqual((await f.runtime.state.getStreamStatus(HOME)).seeking, true);
    assert.equal((await f.control(OTHER, 'seek-on')).status, 200);
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
    assert.equal(JSON.parse((await f.control(HOME, 'send:' + OTHER)).body).status, 'accepted');
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
    await f.raid();
    await f.chat(HOME, '7001', '!offer');
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
    await f.chat(OTHER, '7002', '!accept', { messageId: 'final-accept' });
    const received = await f.runtime.state.getStreamStatus(OTHER);
    const at = f.now();
    assert.equal(received.seeking, false);
    assert.ok(received.seekAt >= at);
    assert.equal((await f.runtime.receiving.page()).seekers.length, 0);
    assert.equal((await f.runtime.receiving.status(OTHER)).reason, 'holding');
    f.advance();
    await f.chat(OTHER, OTHER, '!seek', { sentAt: at - 1 });
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, false);
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seekAt, received.seekAt);
    await f.chat(OTHER, '7002', '!accept', { messageId: 'final-accept' });
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seekAt, received.seekAt);
    f.advance(31000);
    await f.chat(OTHER, OTHER, '!seek status');
    let messages = f.calls
      .filter((c) => c.url.endsWith('/chat/messages'))
      .map((c) => JSON.parse(c.body));
    assert.match(messages.at(-1).message, /hold the relic.*queue off/i);
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, false);
    assert.equal(JSON.parse((await f.control(OTHER, 'send:' + HOME)).body).status, 'accepted');
    await f.raid(OTHER, HOME);
    await f.chat(OTHER, '7003', '!offer');
    await f.chat(HOME, '7004', '!accept');
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, false);
    f.advance(31000);
    await f.chat(OTHER, OTHER, '!seek');
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
    await f.chat(OTHER, '7002', '!accept', { messageId: 'final-accept' });
    assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 2);
    f.advance(31000);
    const before = await f.runtime.state.getStreamStatus(OTHER);
    await f.chat(OTHER, OTHER, '!seek status', { messageId: 'status-read' });
    messages = f.calls
      .filter((c) => c.url.endsWith('/chat/messages'))
      .map((c) => JSON.parse(c.body));
    assert.equal(messages.at(-1).broadcaster_id, OTHER);
    assert.equal(messages.at(-1).sender_id, BOT);
    assert.match(messages.at(-1).message, /Seeker status: on\. Eligible live suggestion 1 of 1/);
    assert.ok(messages.at(-1).message.length <= 500);
    const after = await f.runtime.state.getStreamStatus(OTHER);
    assert.deepEqual(
      [after.seeking, after.seekAt, after.consentAt],
      [before.seeking, before.seekAt, before.consentAt],
    );
    const count = messages.length;
    await f.chat(OTHER, OTHER, '!seek status', { messageId: 'status-read' });
    assert.equal(f.calls.filter((c) => c.url.endsWith('/chat/messages')).length, count);
    assert.equal((await f.runtime.receiving.status(OTHER)).position, 1);
  });
}
test('legacy holder and joins made before departure are suppressed read-only; explicit later joins retain consent', () => {
  const registry = { holderId: HOME },
    lineage = { stops: [{ from: OTHER, to: HOME, claimedAt: 50 }] };
  const channels = {
    [HOME]: { optedIn: true, seeking: true, seekAt: 20 },
    [OTHER]: { optedIn: true, seeking: true, seekAt: 30, online: true, streamId: 's' },
  };
  const marks = {
    [HOME]: { context: { optedIn: true } },
    [OTHER]: { context: { optedIn: true, streamId: 's' } },
  };
  const before = JSON.stringify({ registry, lineage, channels, marks });
  assert.equal(seekerState(registry, lineage, channels, marks, HOME).reason, 'holding');
  assert.equal(seekerState(registry, lineage, channels, marks, OTHER).reason, 'needs-rejoin');
  assert.equal(JSON.stringify({ registry, lineage, channels, marks }), before);
  channels[OTHER].seekAt = 51;
  assert.equal(seekerState(registry, lineage, channels, marks, OTHER).member, true);
  channels[OTHER].online = false;
  const offline = seekerState(registry, lineage, channels, marks, OTHER);
  assert.equal(offline.member, true);
  assert.match(seekerStatusMessage(offline), /Position not confirmed.*offline/);
});
