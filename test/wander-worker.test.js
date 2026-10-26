import test from 'node:test';
import assert from 'node:assert/strict';
import { wanderWorker } from '../ops/wander-tick.mjs';
import { verifyWanderRequest } from '../src/wander-auth.js';
const key = Buffer.alloc(32, 7).toString('base64'),
  sha = 'a'.repeat(40),
  now = 100000;
const origin = 'https://raid-relic-760724762396.us-central1.run.app';
const health = {
  status: 200,
  data: {
    status: 'ok',
    releaseCommit: sha,
    wander: { enabled: true, kind: 'non-raid', idleHours: 72, warningHours: 12 },
  },
};
function fixture(ref = { name: 'token-encryption-key', key: 'latest' }) {
  const calls = [];
  return {
    calls,
    command: async (args) => {
      calls.push(args[0] + ':' + args[1]);
      if (args[0] === 'secrets') return key + '\n';
      if (args[1] === 'services')
        return JSON.stringify({
          status: {
            traffic: [
              { revisionName: 'raid-relic-current', percent: 100 },
              { revisionName: 'raid-relic-preview', percent: 0 },
            ],
          },
        });
      return JSON.stringify({
        spec: {
          containers: [
            {
              env: [
                { name: 'RELEASE_COMMIT', value: sha },
                { name: 'WANDER_ENABLED', value: 'true' },
                { name: 'OVERLAY_ORIGIN', value: origin },
                { name: 'EVENTSUB_CALLBACK_URL', value: origin + '/eventsub' },
                { name: 'TOKEN_ENCRYPTION_KEY', valueFrom: { secretKeyRef: ref } },
              ],
            },
          ],
        },
      });
    },
  };
}
test('old, disabled, failed health and dry-run stop before any metadata/secret/SDK command', async () => {
  for (const response of [
    { status: 200, data: { status: 'ok' } },
    { status: 503, data: {} },
    { status: 200, data: { ...health.data, wander: { enabled: false } } },
  ]) {
    const f = fixture();
    let requests = 0;
    const r = await wanderWorker({
      once: true,
      request: async (url) => {
        requests++;
        assert.equal(url, origin + '/health');
        return response;
      },
      command: f.command,
    });
    assert.equal(r.status, 'not-run');
    assert.equal(requests, 1);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture();
  assert.equal(
    (
      await wanderWorker({
        once: true,
        dryRun: true,
        request: async () => health,
        command: f.command,
      })
    ).status,
    'dry-run',
  );
  assert.equal(f.calls.length, 0);
});
test('only current100 and expected key reference may sign one canonical POST; no secret in result', async () => {
  const f = fixture();
  let posts = 0;
  const result = await wanderWorker({
    once: true,
    command: f.command,
    now: () => now,
    nonce: () => 'b'.repeat(32),
    request: async (url, options) => {
      if (url.endsWith('/health')) return health;
      posts++;
      assert.equal(url, origin + '/internal/wander/tick');
      assert.ok(
        verifyWanderRequest(key, options.body, options.headers['x-rr-wander-signature'], now),
      );
      return { status: 200, data: { status: 'waiting' } };
    },
  });
  assert.equal(posts, 1);
  assert.equal(result.status, 'waiting');
  assert.ok(!JSON.stringify(result).includes(key));
  assert.deepEqual(f.calls, ['run:services', 'run:revisions', 'secrets:versions']);
  for (const ref of [
    { name: 'other-secret', key: 'latest' },
    { name: 'projects/other/secrets/token-encryption-key', key: 'latest' },
    { name: 'token-encryption-key', key: '0' },
  ]) {
    const bad = fixture(ref);
    assert.equal(
      (await wanderWorker({ once: true, request: async () => health, command: bad.command }))
        .status,
      'attention',
    );
    assert.equal(
      bad.calls.some((c) => c.startsWith('secrets:')),
      false,
    );
  }
});
test('ambiguous POST is never retried; explicit once is required before health', async () => {
  const f = fixture();
  let posts = 0;
  const r = await wanderWorker({
    once: true,
    command: f.command,
    now: () => now,
    request: async (url) => {
      if (url.endsWith('/health')) return health;
      posts++;
      throw Error('synthetic upstream detail never returned');
    },
  });
  assert.equal(posts, 1);
  assert.equal(r.status, 'attention');
  assert.deepEqual(Object.keys(r).sort(), ['reason', 'status']);
  let operations = 0;
  assert.equal(
    (
      await wanderWorker({
        request: async () => {
          operations++;
        },
        command: async () => {
          operations++;
        },
      })
    ).status,
    'not-run',
  );
  assert.equal(operations, 0);
});
