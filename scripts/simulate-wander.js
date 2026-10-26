// Local synthetic-only clock demonstration; never imported by the server.
import assert from 'node:assert/strict';
import { wanderFixture } from '../test-support/wander-fixture.js';
if (process.env.NODE_ENV === 'production' || process.env.K_SERVICE !== undefined)
  throw Error('Local simulator only');
const f = await wanderFixture();
const steps = [];
const tick = async (label) => {
  const r = await f.tick();
  assert.equal(r.status, 200);
  steps.push({ step: label, status: JSON.parse(r.body).status });
};
await tick('start forward-only tracking');
f.advanceHours(60);
await tick('60 simulated hours: warning');
f.advanceHours(12);
await tick('72 simulated hours: typed idle transfer');
await tick('repeat: no extra ring');
const journey = await f.runtime.state.getPublicJourney();
assert.equal(journey.rings, 1);
assert.equal(journey.stops[0].kind, 'wander');
assert.equal(journey.stops[0].raidSize, null);
assert.equal(f.calls.filter((c) => new URL(c.url).pathname === '/helix/raids').length, 0);
console.log(
  JSON.stringify({
    mode: 'SIMULATOR — injected clock, mocked providers, no real Twitch',
    steps,
    rings: journey.rings,
    kind: 'wander',
    realRaids: 0,
  }),
);
