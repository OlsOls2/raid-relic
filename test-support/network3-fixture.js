// Synthetic grants and signed local EventSub only. Never real account consent.
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from './pilot-fixture.js';
export { HOME, OTHER, BOT };
export const THIRD = '1593561134';
export const NETWORK3 = Object.freeze({
  [HOME]: 'raidrelichq',
  [OTHER]: 'olsols2',
  [THIRD]: 'olsols3',
});
export async function network3Fixture(kind = 'memory', options = {}) {
  return pilotFixture(kind, {
    keepers: NETWORK3,
    extraBotScopes: ['user:read:moderated_channels'],
    chronicleEnv: {
      SEEKERS_ENABLED: 'true',
      MARK_AUTO_APPROVE_ENABLED: 'true',
      MARK_REVIEW_BLOCKLIST: '["spoiler"]',
      P9_STREAK_ENABLED: 'true',
    },
    ...options,
  });
}
export async function readyNetwork3(f) {
  for (const id of [BOT, HOME, OTHER, THIRD]) await f.login(id);
  // Control status can trigger the shared batched observation. Seed every room
  // before the first such request; missing counts correctly poison that batch.
  for (const id of [HOME, OTHER, THIRD]) f.streams.get(id).viewer_count = 1;
  for (const id of [HOME, OTHER, THIRD]) {
    assert.equal((await f.control(id, 'bootstrap')).status, 200);
    f.advance();
    assert.equal((await f.control(id, 'keep')).status, 200);
    f.advance();
  }
}
let sequence = 0;
export async function networkHop(f, from, to) {
  f.advance(31000);
  if (f.runtime.receiving.enabled) {
    assert.equal((await f.control(to, 'seek-on')).status, 200);
    f.advance();
  }
  const response = await f.control(from, 'send:' + to);
  const result = JSON.parse(response.body);
  // Closed diagnostics only; never publish response messages, tokens or bodies.
  const statuses = ['accepted', 'blocked', 'unknown'];
  const reasons = [
    'subscriptions-not-ready',
    'grants-unavailable',
    'preflight-rejected',
    'dispatch-rejected',
    'worker-reconcile-only',
    'reservation-unavailable',
    'not-holder',
    'not-eligible',
    'dispatch-unknown',
  ];
  const categories = [
    'source-grant',
    'target-not-found',
    'incoming-raid-policy',
    'provider-forbidden',
    'rate-limited',
    'unknown-reconcile-only',
  ];
  const diagnostic = {
    httpStatus: response.status,
    responseStatusCode: statuses.indexOf(result.status) + 1,
    reasonCode: reasons.indexOf(result.reason) + 1,
    providerCode: categories.indexOf(result.diagnostic?.category) + 1,
    hopIndex:
      [
        [HOME, OTHER],
        [OTHER, THIRD],
        [THIRD, HOME],
      ].findIndex(([a, b]) => from === a && to === b) + 1,
  };
  try {
    assert.equal(response.status, 200, JSON.stringify(diagnostic));
    assert.equal(result.status, 'accepted', JSON.stringify(diagnostic));
  } catch (error) {
    error.networkDiagnostic = diagnostic;
    throw error;
  }
  const rings = (await f.runtime.state.getPublicJourney()).rings;
  const sourceActor = String(800000 + ++sequence * 2),
    targetActor = String(800001 + sequence * 2);
  await f.chat(from, sourceActor, '!offer');
  assert.equal((await f.runtime.state.getPublicJourney()).rings, rings);
  f.advance();
  await f.raid(from, to, 1);
  await f.chat(to, sourceActor, '!accept'); // same actor cannot satisfy both sides
  assert.equal((await f.runtime.state.getPublicJourney()).rings, rings);
  await f.chat(to, targetActor, '!accept');
  assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, to);
  assert.equal((await f.runtime.state.getPublicJourney()).rings, rings + 1);
  return { sourceActor, targetActor };
}
