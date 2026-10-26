import test from 'node:test';
import assert from 'node:assert/strict';
import { ringCardModel, CARD_WIDTH, CARD_HEIGHT, CARD_MAX_BYTES } from '../public/ring-card.js';
const now = Date.parse('2026-10-26T12:00Z'),
  base = { stopId: 'a'.repeat(64), keeper: '@raidrelichq', ringIndex: 3, claimedAt: now };
test('ring cards use exact completed-stop index and completion-time cosmetic edition', () => {
  const m = ringCardModel(base, { now });
  assert.equal(m.ringIndex, 3);
  assert.equal(m.edition.id, 'twitchcon-2026');
  assert.match(m.disclaimer, /Unofficial/);
  assert.equal(ringCardModel({ ...base, claimedAt: null }, { now }).edition, null);
  assert.equal(
    ringCardModel({ ...base, claimedAt: Date.parse('2026-10-22T00:00Z') }, { now }).edition,
    null,
  );
  assert.equal(
    ringCardModel(
      { ...base, claimedAt: Date.parse('2026-12-01T00:00Z') },
      { now: Date.parse('2026-12-02T00:00Z') },
    ).edition,
    null,
  );
  assert.deepEqual([CARD_WIDTH, CARD_HEIGHT, CARD_MAX_BYTES], [1200, 630, 524288]);
});
test('ring card metadata rejects extra content, forged names, missing stops, future dates and invalid indices', () => {
  for (const patch of [
    { text: 'private' },
    { keeper: '<svg>' },
    { keeper: '@x https://evil' },
    { stopId: null },
    { stopId: 'x' },
    { ringIndex: 0 },
    { ringIndex: 17 },
    { claimedAt: now + 1 },
    { claimedAt: NaN },
  ])
    assert.throws(() => ringCardModel({ ...base, ...patch }, { now }));
});
test('demo card is permanently fictional and supports zero rings without a stop or network', () => {
  const m = ringCardModel(
    { stopId: null, keeper: '@demo_keeper_b', ringIndex: 0, claimedAt: null },
    { mode: 'demo' },
  );
  assert.equal(m.caption, 'SIMULATED DEMO—no Twitch connection');
  assert.equal(m.editionCaption, 'Demo cosmetic edition: Base');
  assert.throws(() => ringCardModel({ ...base, stopId: null }, { mode: 'demo' }));
});

test('fresh Atlas API mode is distinct from fictional demo identity and always watermarks simulator exports', () => {
  const local = ringCardModel(base, { mode: 'simulator', now });
  assert.equal(local.caption, 'SIMULATOR—mock recorded stop; no real Twitch');
  assert.equal(local.simulated, true);
  assert.equal(local.editionCaption, 'Edition at mock completion: TwitchCon 2026');
  assert.equal(local.keeper, '@raidrelichq');
  assert.equal(local.ringIndex, 3);
  const live = ringCardModel(base, { mode: 'live', now });
  assert.equal(live.caption, 'Recorded completion · Ring 3');
  assert.equal(live.simulated, false);
  assert.equal(live.editionCaption, 'Edition at recorded completion: TwitchCon 2026');
  for (const mode of ['unknown', 'SIMULATOR', null])
    assert.throws(() => ringCardModel(base, { mode, now }));
  assert.throws(() => ringCardModel({ ...base, ringIndex: 0 }, { mode: 'simulator', now }));
  assert.throws(() => ringCardModel({ ...base, stopId: null }, { mode: 'simulator', now }));
  assert.throws(() => ringCardModel(base, { mode: 'demo', now }));
  assert.throws(() =>
    ringCardModel(
      { stopId: null, keeper: '@raidrelichq', ringIndex: 0, claimedAt: null },
      { mode: 'demo', now },
    ),
  );
});

test('per-stop filename is deterministic, normalized and path-safe', async () => {
  const { ringCardFilename } = await import('../public/ring-card.js');
  assert.equal(ringCardFilename(1, '@OlsOls2'), 'raid-relic-stop-1-olsols2.png');
  assert.equal(ringCardFilename(2, '@raidrelichq'), 'raid-relic-stop-2-raidrelichq.png');
  for (const [n, name] of [
    [0, '@x'],
    [17, '@x'],
    [1, '../x'],
    [1, '@x/y'],
    [1, '@x.png'],
    [1, '@'],
    [1, '@x\n'],
  ])
    assert.throws(() => ringCardFilename(n, name));
});

test('fictional demo filenames require a completed positive bounded ring count', async () => {
  const { demoCardFilename } = await import('../public/ring-card.js');
  for (const n of [1, 2, 16]) assert.equal(demoCardFilename(n), `raid-relic-demo-ring-${n}.png`);
  for (const n of [0, 17, -1, 1.5, NaN, Infinity, '1', '../1'])
    assert.throws(() => demoCardFilename(n));
});

test('card recorded time is human UTC, unknown date never invents a completion', () => {
  const m = ringCardModel(base, { now });
  assert.match(m.dateCaption, /UTC$/);
  assert.ok(!m.dateCaption.includes('T00:'));
  assert.equal(
    ringCardModel({ ...base, claimedAt: null }, { now }).dateCaption,
    'Completion time unavailable',
  );
});
