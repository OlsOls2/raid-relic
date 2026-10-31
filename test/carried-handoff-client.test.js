import test from 'node:test';
import assert from 'node:assert/strict';
import { validSnapshot } from '../public/overlay-client.js';

function snapshot(policy, role = 'host') {
  const handoff = {
    role,
    startedAt: 1000,
    endsAt: policy === undefined ? 91000 : 181000,
    threshold: 2,
    offers: 2,
    accepts: 2,
    completed: true,
  };
  if (policy !== undefined) {
    handoff.clockPolicy = policy;
    handoff.claimStartedAt = 1000;
  }
  return {
    type: 'snapshot', revision: 1, serverNow: 5000,
    mode: 'live', status: 'ready', lineageRings: 1,
    marks: [], approvedCount: 0, handoff,
  };
}

for (const policy of [undefined, 'preclaim-v1', 'landing-v2']) {
  for (const role of ['source', 'host']) {
    test(`${policy ?? 'legacy90'} ${role}: absent carried count preserves full handoff compatibility`, () => {
      const value = snapshot(policy, role);
      assert.equal(validSnapshot(value), true);
      assert.equal(Object.hasOwn(value.handoff, 'carriedApprovedCount'), false);
      value.handoff.completed = false;
      value.handoff.offers = 1;
      assert.equal(validSnapshot(value), true);
    });
    test(`${policy ?? 'legacy90'} ${role}: bounded carried count requires a completed timestamp in the original window`, () => {
      const value = snapshot(policy, role);
      value.handoff.completedAt = 2000;
      for (const count of [0, 1, 160]) {
        value.handoff.carriedApprovedCount = count;
        assert.equal(validSnapshot(value), true);
        assert.equal(value.handoff.carriedApprovedCount, count);
      }
      for (const count of [undefined, null, '0', '1', -1, 161, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        value.handoff.carriedApprovedCount = count;
        assert.equal(validSnapshot(value), false);
      }
      value.handoff.carriedApprovedCount = 0;
      for (const at of [undefined, null, NaN, Infinity, '2000', 999, value.handoff.endsAt, value.handoff.endsAt + 1]) {
        value.handoff.completedAt = at;
        assert.equal(validSnapshot(value), false);
      }
      for (const at of [value.handoff.startedAt, value.handoff.endsAt - 1]) {
        value.handoff.completedAt = at;
        assert.equal(validSnapshot(value), true);
      }
      value.handoff.completed = false;
      assert.equal(validSnapshot(value), false);
    });
  }
}

test('carried count cannot bypass existing role, clock, threshold, login, mode or mark bounds', () => {
  const base = snapshot('landing-v2');
  Object.assign(base.handoff, { completedAt: 2000, carriedApprovedCount: 1 });
  for (const patch of [
    { role: 'other' }, { clockPolicy: 'unknown' }, { endsAt: 181001 },
    { claimStartedAt: 999 }, { threshold: 11 }, { offers: 3 },
    { accepts: -1 }, { sourceLogin: 'invalid login' },
  ]) assert.equal(validSnapshot({ ...base, handoff: { ...base.handoff, ...patch } }), false);
  assert.equal(validSnapshot({ ...base, mode: 'unknown' }), false);
  assert.equal(validSnapshot({ ...base, marks: Array(161).fill({ id: 'm1', runeSvg: '<svg/>' }), approvedCount: 161 }), false);
  const preclaim = snapshot('preclaim-v1');
  preclaim.handoff.startedAt = 1500;
  preclaim.handoff.completedAt = 2000;
  preclaim.handoff.carriedApprovedCount = 1;
  assert.equal(validSnapshot(preclaim), true);
  delete preclaim.handoff.completedAt;
  assert.equal(validSnapshot(preclaim), false);
});
