import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { validSnapshot } from '../public/overlay-client.js';
import { validClaimMeter } from '../public/claim-meter.js';
async function setup(kind) {
  const f = await pilotFixture(kind);
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  return f;
}
async function hop(f, from, to) {
  await f.control(from, `send:${to}`);
  f.advance();
  await f.raid(from, to, 2);
  await f.chat(from, from, '!offer');
  await f.chat(to, to, '!accept');
}
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: delayed verified landing gives full180s and preserves legal early vote without acceptance travel`, async () => {
    const f = await setup(kind);
    await f.control(HOME, `send:${OTHER}`);
    const accepted = f.now();
    await f.chat(HOME, HOME, '!offer');
    f.advance(95000);
    const before = await f.runtime.overlayFeeds[OTHER].snapshot();
    assert.equal(before.handoff, null);
    assert.equal(before.lineageRings, 0);
    assert.equal(before.claimMeter.clockPolicy, 'accepted-v1');
    const receipt = f.now();
    await f.raid(HOME, OTHER, 2);
    const root = await f.runtime.state.getKeeperRegistry();
    assert.equal(root.pendingHop.claimStartedAt, receipt);
    assert.equal(root.pendingHop.claimEndsAt, receipt + 180000);
    assert.equal(root.pendingHop.voteStartedAt, accepted);
    assert.equal(root.pendingHop.arrivalStartedAt, receipt);
    assert.deepEqual(root.pendingHop.offers, [HOME]);
    const snapshot = await f.runtime.overlayFeeds[OTHER].snapshot();
    assert.equal(validSnapshot(snapshot), true);
    assert.equal(snapshot.claimMeter.clockPolicy, 'landing-v2');
    assert.equal(snapshot.claimMeter.endsAt - snapshot.serverNow, 180000);
    f.advance(100000);
    await f.chat(OTHER, OTHER, '!accept');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
  });
  test(`${kind}: provisional expiry permits only new matching receipt; confirmed duplicates never extend or revive`, async () => {
    const f = await setup(kind);
    await f.control(HOME, `send:${OTHER}`);
    f.advance(180001);
    await f.chat(HOME, HOME, '!offer');
    let root = await f.runtime.state.getKeeperRegistry();
    assert.equal(root.pendingHop.cancelReason, 'window-ended');
    assert.equal(root.send.status, 'accepted');
    await f.raid(HOME, OTHER, 2);
    root = await f.runtime.state.getKeeperRegistry();
    assert.equal(root.pendingHop.cancelled, false);
    assert.equal(root.pendingHop.endsAt, f.now() + 180000);
    assert.deepEqual(root.pendingHop.offers, []);
    const end = root.pendingHop.endsAt,
      start = root.pendingHop.startedAt;
    f.advance(500);
    await f.raid(HOME, OTHER, 2);
    assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.startedAt, start);
    f.advance(end - f.now() + 1);
    await f.raid(HOME, OTHER, 2);
    root = await f.runtime.state.getKeeperRegistry();
    assert.equal(root.pendingHop.endsAt, end);
    assert.equal(root.pendingHop.startedAt, start);
    assert.equal(root.holderId, HOME);
    assert.equal(root.send.status, 'confirmed');
    assert.equal(root.pendingHop.cancelled, true);
  });
  test(`${kind}: revoked policy and stale confirmation do not acquire a usable landing window`, async () => {
    const f = await setup(kind);
    await f.control(HOME, `send:${OTHER}`);
    await f.control(HOME, 'pause');
    await f.control(HOME, 'resume');
    f.advance();
    await f.raid(HOME, OTHER, 2);
    assert.equal((await f.runtime.state.getKeeperRegistry()).pendingHop.cancelled, true);
    assert.equal((await f.runtime.overlayFeeds[OTHER].snapshot()).handoff, null);
    assert.equal((await f.runtime.state.getKeeperRegistry()).send.status, 'accepted');
    const g = await setup(kind);
    await g.control(HOME, `send:${OTHER}`);
    g.advance(600001);
    await g.raid(HOME, OTHER, 2);
    assert.equal((await g.runtime.state.getKeeperRegistry()).send.status, 'accepted');
    assert.equal((await g.runtime.state.getPublicJourney()).rings, 0);
  });
  test(`${kind}: roundtrip former holder has valid incoming API and hub projection with no moved-on field`, async () => {
    const f = await setup(kind);
    await hop(f, HOME, OTHER);
    f.advance();
    await hop(f, OTHER, HOME);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 2);
    const previous = await f.runtime.overlayFeeds[OTHER].snapshot();
    assert.equal(previous.status, 'waiting');
    assert.equal(previous.movedToLogin, 'raidrelichq');
    const seen = [];
    const off = f.runtime.overlayFeeds[OTHER].subscribe((s) => seen.push(s));
    await f.control(HOME, `send:${OTHER}`);
    f.advance(95000);
    await f.raid(HOME, OTHER, 2);
    const original = await f.runtime.state.getKeeperRegistry();
    for (let i = 0; i < 3; i++) {
      f.advance();
      await f.chat(HOME, HOME, '!relic resume');
      const s = await f.runtime.overlayFeeds[OTHER].snapshot();
      assert.equal(s.status, 'incoming');
      assert.equal(s.movedToLogin, undefined);
      assert.equal(validSnapshot(s), true);
      assert.equal(s.handoff.startedAt, original.pendingHop.startedAt);
    }
    const http = JSON.parse((await f.request(`/api/overlay/${OTHER}`)).body);
    assert.equal(http.status, 'incoming');
    assert.equal(http.movedToLogin, undefined);
    assert.equal(validSnapshot(http), true);
    assert.equal(http.lineageRings, 2);
    assert.equal(validSnapshot({ ...http, movedToLogin: 'raidrelichq' }), false);
    assert.ok(seen.every(validSnapshot));
    off();
  });
  test(`${kind}: actual latecommands27s/71s get two SENT closed replies, replay/rateblocked never resend or transfer`, async () => {
    const f = await setup(kind);
    await f.control(HOME, `send:${OTHER}`);
    f.advance();
    await f.raid(HOME, OTHER, 2);
    const end = (await f.runtime.state.getKeeperRegistry()).pendingHop.endsAt;
    f.advance(end - f.now() + 27000);
    await f.chat(OTHER, OTHER, '!accept', { messageId: 'closed-first' });
    const posts = () => f.calls.filter((c) => c.url.endsWith('/chat/messages'));
    assert.equal(posts().length, 1);
    assert.match(JSON.parse(posts()[0].body).message, /binding window has closed/);
    f.advance(1000);
    await f.chat(OTHER, OTHER, '!accept', { messageId: 'closed-rate' });
    assert.equal(posts().length, 1);
    f.advance(43000);
    await f.chat(OTHER, OTHER, '!accept', { messageId: 'closed-second' });
    assert.equal(posts().length, 2);
    await f.chat(OTHER, OTHER, '!accept', { messageId: 'closed-first' });
    await f.chat(OTHER, OTHER, '!accept', { messageId: 'closed-rate' });
    assert.equal(posts().length, 2);
    assert.equal(
      (await f.runtime.state.getPrivateClaimAcks(OTHER)).rows.filter((r) => r.status === 'sent')
        .length,
      2,
    );
    const root = await f.runtime.state.getKeeperRegistry();
    assert.equal(root.holderId, HOME);
    assert.equal(root.pendingHop.offers, undefined);
    assert.equal(root.pendingHop.accepts, undefined);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
  });
  test(`${kind}: closed claim replies reject unsafe actors; forgotten/wrong-side commands get status without votes`, async () => {
    const f = await setup(kind);
    await f.control(HOME, `send:${OTHER}`);
    f.advance();
    await f.raid(HOME, OTHER, 2);
    await f.chat(HOME, '811', '!relic forgetme');
    await f.runtime.state.setChannelPolicy(
      OTHER,
      { banned: false, blockedUserIds: ['812'] },
      f.now(),
    );
    const end = (await f.runtime.state.getKeeperRegistry()).pendingHop.endsAt;
    f.advance(end - f.now() + 27000);
    const n = f.calls.filter((c) => c.url.endsWith('/chat/messages')).length;
    await f.chat(HOME, '811', '!offer');
    await f.chat(OTHER, '812', '!accept');
    await f.chat(OTHER, BOT, '!accept');
    await f.chat(HOME, '813', '!accept');
    await f.chat(OTHER, '814', '!offer');
    await f.signed(
      'channel.chat.message',
      {
        broadcaster_user_id: OTHER,
        chatter_user_id: OTHER,
        message_id: 'copied-late',
        source_broadcaster_user_id: HOME,
        source_message_id: '00000000-0000-4000-8000-000000000001',
        message: { text: '!accept', fragments: [] },
      },
      OTHER,
      { broadcaster_user_id: OTHER, user_id: BOT },
    );
    const extra = f.calls
      .filter((c) => c.url.endsWith('/chat/messages'))
      .slice(n)
      .map((c) => JSON.parse(c.body));
    assert.deepEqual(
      extra.map((c) => c.broadcaster_id),
      [HOME, HOME, OTHER],
    );
    assert.ok(
      extra.every(
        (c) =>
          c.message ===
          'No active verified claim is available here. Begin a new Send Off with the Keeper.',
      ),
    );
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
    for (const host of [HOME, OTHER]) {
      const rows = await f.runtime.state.getPrivateClaimAcks(host);
      assert.ok(!rows.rows.some((r) => r.status === 'sent'));
    }
  });
}
test('new clock schemas are closed; legacy90 remains valid and landing cannot pretend to await raid', () => {
  const base = {
    startedAt: 1000,
    endsAt: 181000,
    offers: 0,
    accepts: 0,
    threshold: 1,
    provisional: false,
    awaitingRaid: false,
  };
  assert.equal(validClaimMeter({ ...base, clockPolicy: 'landing-v2' }), true);
  assert.equal(validClaimMeter({ ...base, clockPolicy: 'accepted-v1' }), false);
  assert.equal(validClaimMeter({ ...base, clockPolicy: 'unknown' }), false);
  assert.equal(validClaimMeter({ ...base, clockPolicy: 'landing-v2', endsAt: 91000 }), false);
  assert.equal(validClaimMeter({ ...base, endsAt: 91000 }), true);
});
