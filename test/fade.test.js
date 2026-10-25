import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { reduceLifecycle, emptyRegistry } from '../src/lifecycle.js';
import { withCarriedMarks } from '../src/public-view.js';
import { createOverlayHub } from '../src/overlay-feed.js';
import { createCueTracker } from '../public/overlay-audio.js';
import { validSnapshot } from '../public/overlay-client.js';

async function setup(kind) {
  const f = await pilotFixture(kind);
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) { await f.control(id, 'bootstrap'); f.advance(); await f.control(id, 'keep'); }
  await f.chat(HOME, '111', '!mark moon'); await f.chat(HOME, HOME, '!relic approve m1');
  f.advance(); await f.raid(); await f.chat(HOME, HOME, '!offer'); await f.chat(OTHER, OTHER, '!accept');
  return f;
}
async function online(f, id, host = OTHER) {
  f.advance(1000);
  return f.signed('stream.online', { broadcaster_user_id: host, id, type: 'live', started_at: new Date(f.now()).toISOString() }, host);
}
async function offline(f, host = OTHER) { f.advance(); return f.signed('stream.offline', { broadcaster_user_id: host }, host); }
for (const kind of ['memory', 'firestore']) {
  test(`${kind}: three accepted holder closures dim carried only; duplicates/nonholder/forget do not reset`, async () => {
    const f = await setup(kind), state = f.runtime.state;
    const view = () => state.getOverlayState(OTHER, f.now());
    assert.equal((await state.getKeeperRegistry()).carriedClosures, 0);
    assert.equal((await view()).marks.length, 1);
    for (let n = 1; n <= 3; n++) {
      await offline(f); await offline(f); await offline(f, HOME);
      assert.equal((await state.getKeeperRegistry()).carriedClosures, n);
      await online(f, String(9100 + n));
      assert.equal((await view()).marks[0].faded, n === 3 ? true : undefined);
    }
    await f.chat(OTHER, '222', '!mark star'); await f.chat(OTHER, OTHER, '!relic approve m1');
    const marks = (await view()).marks; assert.equal(marks.length, 2); assert.equal(marks[1].faded, undefined);
    const journey = await state.getPublicJourney(); assert.equal(journey.stops[0].marks.length, 1);
    const feed = f.runtime.overlayFeeds[OTHER]; const snap = await feed.snapshot(); assert.equal(snap.marks[0].faded, true); assert.ok(validSnapshot(snap));
    const http = await f.request(`/api/overlay/${OTHER}`); assert.equal(http.status, 200); assert.equal(JSON.parse(http.body).marks[0].faded, true);
    const cue = createCueTracker(); assert.equal(cue(snap), null); assert.equal(cue({ ...snap, revision: snap.revision + 1, serverNow: snap.serverNow + 1 }), null);
    const privateBefore = await state.getPrivateMarks(OTHER, { broadcasterId: OTHER, chatterId: OTHER });
    await feed.snapshot(); const privateAfter = await state.getPrivateMarks(OTHER, { broadcasterId: OTHER, chatterId: OTHER }); assert.deepEqual(privateAfter, privateBefore);
    assert.ok(!JSON.stringify(snap).includes('carriedClosures')); assert.ok(!JSON.stringify(snap).includes('streamId'));
    await f.chat(HOME, '111', '!relic forgetme'); assert.equal((await view()).marks.length, 1);
    assert.equal((await state.getKeeperRegistry()).carriedClosures, 3);
    await online(f, '9301', HOME); f.advance(); await f.raid(OTHER, HOME); await f.chat(OTHER, OTHER, '!offer');
    assert.equal((await state.getKeeperRegistry()).carriedClosures, 3);
    await f.chat(HOME, HOME, '!accept'); assert.equal((await state.getKeeperRegistry()).carriedClosures, 0);
  });
  test(`${kind}: validated bootstrap observation closes known predecessor once without historical seeding`, async () => {
    const f = await setup(kind); f.advance(1000);
    f.streams.set(OTHER, { user_id: OTHER, id: '9401', type: 'live', started_at: new Date(f.now()).toISOString() });
    await f.control(OTHER, 'bootstrap'); assert.equal((await f.runtime.state.getKeeperRegistry()).carriedClosures, 1);
    await f.control(OTHER, 'bootstrap'); assert.equal((await f.runtime.state.getKeeperRegistry()).carriedClosures, 1);
    await f.control(OTHER, 'pause'); await f.control(OTHER, 'resume');
    assert.equal((await f.runtime.state.getKeeperRegistry()).carriedClosures, 1);
  });
  test(`${kind}: newer online implicitly closes exactly once; retired stale events cannot count`, async () => {
    const f = await setup(kind), state = f.runtime.state;
    await online(f, '9201'); assert.equal((await state.getKeeperRegistry()).carriedClosures, 1);
    await online(f, '9201'); assert.equal((await state.getKeeperRegistry()).carriedClosures, 1);
    await online(f, '9202'); await online(f, '9203'); await online(f, '9204');
    assert.equal((await state.getKeeperRegistry()).carriedClosures, 3);
    assert.ok(Buffer.byteLength(JSON.stringify(await state.getKeeperRegistry())) <= 4096);
  });
}
test('legacy/unplaced and stale/unknown closures, projection flag whitelist fail closed', async () => {
  let x = reduceLifecycle({ registry: emptyRegistry(), host: HOME, event: { type: 'offline', sentAt: 20 } });
  assert.equal(x.registry.carriedClosures, undefined);
  x = reduceLifecycle({ ...x, host: HOME, event: { type: 'online', streamId: '1', startedAt: 30, sentAt: 30 } });
  x.registry.holderId = HOME;
  const stale = reduceLifecycle({ ...x, host: HOME, event: { type: 'offline', sentAt: 29 } });
  assert.equal(stale.registry.carriedClosures, undefined);
  const last = { stops: [{ to: HOME, marks: [{ id: 'm1', text: 'moon' }] }] };
  assert.equal(withCarriedMarks({ status: 'ready', marks: [] }, last, { holderId: HOME }, HOME).marks[0].faded, undefined);
  const hub = createOverlayHub({ getOverlayState: () => ({ status: 'ready', marks: [{ id: 'm1', runeSvg: 'safe', faded: 'true' }] }) }, [HOME]);
  assert.equal((await hub.feeds[HOME].snapshot()).status, 'unavailable');
  assert.equal(validSnapshot({ type: 'snapshot', revision: 1, mode: 'live', status: 'ready', lineageRings: 0, approvedCount: 1, marks: [{ id: 'm1', runeSvg: 'safe', faded: 1 }] }), false);
});

test('Firestore failed closure commit rolls back counter and mark context together', async () => {
  const f = await setup('firestore'); const before = await f.runtime.state.getKeeperRegistry();
  f.db.failCommit = true; await assert.rejects(offline(f), /Synthetic commit failure/); f.db.failCommit = false;
  assert.deepEqual(await f.runtime.state.getKeeperRegistry(), before);
  assert.equal((await f.runtime.state.getStreamStatus(OTHER)).online, true);
  await offline(f); assert.equal((await f.runtime.state.getKeeperRegistry()).carriedClosures, 1);
});
