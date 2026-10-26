import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
test('soak event diagnostics remain capped numeric records and preserve the active-loss predicate', async () => {
  const source = await readFile(
    new URL('../scripts/browser-soak-demo.js', import.meta.url),
    'utf8',
  );
  const start = source.indexOf(
    'const v = window.__demoSoakLifecycle;',
    source.indexOf("'webglcontextlost'"),
  );
  const end = source.indexOf('\n          },', start);
  assert.ok(start > 0 && end > start);
  const handler = new Function(
    'event',
    'window',
    'document',
    'performance',
    'lifecycleStartedAt',
    source.slice(start, end),
  );
  const window = {
    __demoSoakLifecycle: { contextLostEvents: 0, activeContextLostEvents: 0 },
    __demoSoakContextLossEvents: [],
  };
  const document = {
    body: { dataset: { demoPlaying: 'true', demoClock: '34999' } },
    querySelector: () => ({ dataset: { phase: 'unfurl' } }),
  };
  const fire = (connected, disposed) =>
    handler(
      { target: { isConnected: connected, dataset: { disposed: String(disposed) } } },
      window,
      document,
      { now: () => 1000 },
      100,
    );
  fire(true, false);
  fire(true, true);
  fire(false, false);
  document.body.dataset.demoPlaying = 'false';
  fire(true, false);
  fire(true, false);
  assert.equal(window.__demoSoakLifecycle.contextLostEvents, 5);
  assert.equal(window.__demoSoakLifecycle.activeContextLostEvents, 1);
  const records = window.__demoSoakContextLossEvents;
  assert.equal(records.length, 4);
  assert.deepEqual(
    records.map((r) => r.active),
    [1, 0, 0, 0],
  );
  assert.equal(records[0].relativePerformanceMs, 900);
  assert.equal(records[0].demoClockMs, 34999);
  assert.ok(
    records.every((r) => Object.values(r).every((v) => Number.isFinite(v) && v >= 0 && v < 1e9)),
  );
  assert.match(
    source,
    /requireGate\(lastLifecycle\.activeContextLostEvents === 0, 'active-context-loss'\)/,
  );
});
