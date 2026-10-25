import test from 'node:test';
import assert from 'node:assert/strict';
import { cinematicPhase, createCinemaTracker, wordBatch, validFlightText, sourceCharge } from '../public/cinematic.js';
import { handoffView, withCarriedMarks, withIncomingPreview } from '../src/public-view.js';
import { validSnapshot } from '../public/overlay-client.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
const hop = { role: 'host', startedAt: 1000, endsAt: 181000, clockPolicy: 'preclaim-v1', claimStartedAt: 1000, threshold: 1, offers: 1, accepts: 1, completed: false };
const view = (handoff = hop, serverNow = 1000) => ({ handoff, serverNow, status: handoff?.completed ? 'ready' : 'incoming' });
test('receipt phases: accepted-only never arrives; target bounded flash/shake; source never incoming', () => {
  assert.equal(cinematicPhase({ status: 'waiting', claimMeter: { awaitingRaid: true } }, 2000).comet, null);
  assert.equal(cinematicPhase({ status: 'ready', claimMeter: { startedAt: 1000, endsAt: 181000, awaitingRaid: true, provisional: true, offers: 0, accepts: 0, threshold: 1 } }, 2000).charge, true);
  for (const time of [999, 1000, 3999, 4000, 4075, 4150, 4600, 6000, 20999, 21000, 181000]) {
    const p = cinematicPhase(view(), time, { fresh: true }); assert.ok(p.flash >= 0 && p.flash <= .3); assert.ok(Math.abs(p.shake) <= 2.5);
    if (time < 4000 || time >= 4150) assert.equal(p.flash, 0);
    const source = cinematicPhase(view({ ...hop, role: 'source' }), time, { fresh: true }); assert.equal(source.comet, null); assert.equal(source.unfurl, null); assert.equal(source.fusion, null);
    const reduced = cinematicPhase(view(), time, { reduced: true, fresh: true }); assert.equal(reduced.flash, 0); assert.equal(reduced.shake, 0); assert.equal(reduced.comet, null);
  }
  assert.equal(cinematicPhase(view(), 4000, { fresh: false }).flash, 0);
});
test('160 approved captions use a maximum8 label pool; text stays plain and expired/pending has no words', () => {
  const marks = Array.from({ length: 160 }, (_, i) => ({ flightText: `moon`, id: `m${i+1}` }));
  for (let time = 6000; time < 21000; time += 111) assert.ok(wordBatch(marks, cinematicPhase(view(), time)).length <= 8);
  assert.equal(wordBatch(marks, cinematicPhase(view(), 181000)).length, 0);
  assert.equal(wordBatch([{ flightText: '<script>' }], cinematicPhase(view(), 7000)).length, 0);
  assert.equal(validFlightText('moon'), true); assert.equal(validFlightText('a'.repeat(41)), false);
  assert.equal(wordBatch(marks, cinematicPhase(view(), 2000, { reduced: true }), true).length, 8);
});
test('fusion waits for actual completion and unfurl; cold/reconnect silent, late claim once, hidden no catchup', () => {
  const tracker = createCinemaTracker(); tracker.observe({ status: 'ready', serverNow: 500, handoff: null }); tracker.observe(view());
  assert.equal(tracker.frame(view(), 21000).chord, false);
  const complete = view({ ...hop, completed: true, completedAt: 2000 }, 2000); tracker.observe(complete);
  assert.equal(tracker.frame(complete, 20999).chord, false); assert.equal(tracker.frame(complete, 21000).chord, true); assert.equal(tracker.frame(complete, 21001).chord, false);
  tracker.observe(null); tracker.observe(complete); assert.equal(tracker.frame(complete, 21002).chord, false);
  const late = createCinemaTracker(); late.observe(view()); const c = view({ ...hop, completed: true, completedAt: 40000 }, 40000); late.observe(c);
  assert.equal(late.frame(c, 40000).chord, true); assert.equal(late.frame(c, 40001).chord, false);
  const hidden = createCinemaTracker(); hidden.observe(view()); hidden.observe(c); assert.equal(hidden.frame(c, 40000, { hidden: true }).chord, false); assert.equal(hidden.frame(c, 40001).chord, false);
  const cold = createCinemaTracker(); cold.observe(c); assert.equal(cold.frame(c, 40000).chord, false);
});
test('completion clock comes only from matching persisted stop, never read time', () => {
  const registry = { pendingHop: { ...hop, to: OTHER, from: HOME, eventId: 'event', finalized: true } };
  const lineage = { stops: [{ eventId: 'event', from: HOME, to: OTHER, claimedAt: 2000 }] };
  assert.equal(handoffView(registry, OTHER, 3000, lineage).completedAt, 2000);
  assert.equal(handoffView(registry, OTHER, 4000, lineage).completedAt, 2000);
  assert.equal(handoffView(registry, OTHER, 4000, { stops: [] }).completedAt, undefined);
});
for (const kind of ['memory', 'firestore']) test(`${kind}: captions approved only, absent pre-raid; carry/completion and forget purge public HTTP/feed`, async () => {
  const f = await pilotFixture(kind); for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) { await f.control(id, 'bootstrap'); f.advance(); await f.control(id, 'keep'); f.advance(); }
  await f.chat(HOME, '811', '!mark moon'); await f.chat(HOME, HOME, '!relic approve m1'); await f.chat(HOME, '812', '!mark hidden');
  await f.control(HOME, `send:${OTHER}`);
  assert.equal((await f.runtime.overlayFeeds[OTHER].snapshot()).marks.length, 0);
  f.advance(); await f.raid(HOME, OTHER, 2);
  let snapshot = await f.runtime.overlayFeeds[OTHER].snapshot(); assert.equal(snapshot.marks.length, 1); assert.equal(snapshot.marks[0].flightText, 'moon'); assert.equal(validSnapshot(snapshot), true);
  assert.ok(!JSON.stringify(snapshot).includes('hidden')); assert.ok(!JSON.stringify(snapshot).includes('811'));
  await f.chat(HOME, HOME, '!offer'); await f.chat(OTHER, OTHER, '!accept'); snapshot = await f.runtime.overlayFeeds[OTHER].snapshot();
  assert.equal(snapshot.handoff.completed, true); assert.ok(Number.isFinite(snapshot.handoff.completedAt)); assert.equal(snapshot.marks[0].flightText, 'moon');
  const at = snapshot.handoff.completedAt; f.advance(); assert.equal((await f.runtime.overlayFeeds[OTHER].snapshot()).handoff.completedAt, at);
  await f.chat(HOME, '811', '!relic forgetme'); snapshot = await f.runtime.overlayFeeds[OTHER].snapshot(); assert.equal(snapshot.marks.length, 0); assert.ok(!JSON.stringify(snapshot).includes('moon'));
});
for (const kind of ['memory', 'firestore']) for (const action of ['block', 'opt-out']) test(`${kind}: ${action} clears approved incoming captions immediately`, async () => {
  const f = await pilotFixture(kind); for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) { await f.control(id, 'bootstrap'); f.advance(); await f.control(id, 'keep'); f.advance(); }
  await f.chat(HOME, '811', '!mark moon'); await f.chat(HOME, HOME, '!relic approve m1');
  await f.control(HOME, `send:${OTHER}`); f.advance(); await f.raid(HOME, OTHER, 2);
  assert.equal((await f.runtime.overlayFeeds[OTHER].snapshot()).marks[0].flightText, 'moon');
  await f.chat(HOME, HOME, action === 'block' ? '!relic block 811' : '!relic opt-out');
  const cleared = await f.runtime.overlayFeeds[OTHER].snapshot(); assert.equal(cleared.marks.length, 0); assert.ok(!JSON.stringify(cleared).includes('moon'));
});
test('caption and completion schema rejects extra private fields, malformed captions and fabricated completion clocks', () => {
  const base = { type: 'snapshot', revision: 1, mode: 'live', status: 'ready', serverNow: 5000, lineageRings: 1, approvedCount: 1,
    marks: [{ id: 'm1', runeSvg: '<svg/>', flightText: 'moon' }], handoff: { ...hop, completed: true, completedAt: 4000 } };
  assert.equal(validSnapshot(base), true);
  for (const flightText of ['<img>', 'hello world', 'https://a', 'a'.repeat(41), '\u0000']) assert.equal(validSnapshot({ ...base, marks: [{ ...base.marks[0], flightText }] }), false);
  assert.equal(validSnapshot({ ...base, marks: [{ ...base.marks[0], userId: '811' }] }), false);
  assert.equal(validSnapshot({ ...base, handoff: { ...base.handoff, completedAt: 999 } }), false);
  assert.equal(validSnapshot({ ...base, handoff: { ...base.handoff, completed: false } }), false);
});
test('disconnect before scheduled fusion suppresses pending chord; early full quorum and late completion cue once', () => {
  const t = createCinemaTracker(); t.observe({ status: 'ready', serverNow: 500, handoff: null });
  const done = view({ ...hop, completed: true, completedAt: 1000 }, 1000); t.observe(done);
  assert.equal(t.frame(done, 5000).chord, false); t.observe(null); t.observe({ ...done, serverNow: 21100 });
  assert.equal(t.frame(done, 21100).chord, false); assert.equal(t.frame(done, 21101).flash, 0);
  const fresh = createCinemaTracker(); fresh.observe({ status: 'ready', claimMeter: { awaitingRaid: true }, handoff: null, serverNow: 500 }); fresh.observe(done);
  assert.equal(fresh.frame(done, 20999).chord, false); assert.equal(fresh.frame(done, 21000).chord, true); assert.equal(fresh.frame(done, 21001).chord, false);
});
test('caption validation works without Intl.Segmenter, and shared poses retain original mark index', async () => {
  const original = Intl.Segmenter;
  try {
    Intl.Segmenter = undefined;
    const { validFlightText: valid, runePose, wordBatch: batch } = await import('../public/cinematic.js?segmenter-unavailable');
    assert.equal(valid('moon'), true); assert.equal(valid('é'), true); assert.equal(valid('👩‍🚀'), true); assert.equal(valid('<img>'), false); assert.equal(valid('two words'), false);
    assert.equal(valid('👩‍🚀👩‍🚀'), false);
    const list = batch([{ id: 'm1' }, { id: 'm2', flightText: 'moon' }], { host: true, unfurl: .5 });
    assert.equal(list[0].index, 1);
    assert.deepEqual(runePose(1, 2, 8000, .5), runePose(list[0].index, 2, 8000, .5));
  } finally { Intl.Segmenter = original; }
});
test('verified source release sends once for early completed quorum, never on accepted-only or subsequent completion', () => {
  const t = createCinemaTracker(); const neutral = { status: 'ready', handoff: null, claimMeter: { awaitingRaid: true }, serverNow: 500 };
  t.observe(neutral); assert.equal(t.frame(neutral, 500).send, false);
  const done = { status: 'waiting', serverNow: 1000, handoff: { ...hop, role: 'source', completed: true, completedAt: 1000 } };
  t.observe(done); assert.equal(t.frame(done, 1000).send, true); assert.equal(t.frame(done, 1001).send, false); assert.equal(t.frame(done, 21000).chord, false);
});

test('source charge seeks only the valid180-second accepted window, expires and fails closed', () => {
  const meter = { startedAt: 1000, endsAt: 181000, awaitingRaid: true, provisional: true, offers: 0, accepts: 0, threshold: 1 };
  const s = { status: 'ready', handoff: null, claimMeter: meter };
  assert.deepEqual(sourceCharge(s, 999), { charge: false, chargeLevel: 0 });
  assert.deepEqual(sourceCharge(s, 1000), { charge: true, chargeLevel: 0 });
  assert.equal(sourceCharge(s, 91000).chargeLevel, .5); assert.ok(sourceCharge(s, 180999).chargeLevel < 1);
  for (const now of [181000, 181001, NaN, Infinity]) assert.deepEqual(sourceCharge(s, now), { charge: false, chargeLevel: 0 });
  for (const snapshot of [null, {}, { ...s, status: 'waiting' }, { ...s, status: 'paused' }, { ...s, handoff: hop }, { ...s, claimMeter: null },
    ...[{ endsAt: 1000 }, { startedAt: NaN }, { endsAt: Infinity }, { threshold: 0 }, { awaitingRaid: false }, { endsAt: 91000 }].map(change => ({ ...s, claimMeter: { ...meter, ...change } }))]) {
    assert.deepEqual(sourceCharge(snapshot, 91000), { charge: false, chargeLevel: 0 });
  }
  assert.deepEqual(sourceCharge(s, 91000, true), { charge: false, chargeLevel: 0 });
});
