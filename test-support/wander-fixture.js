// Explicit synthetic account setup and injected clock; never production shortcuts.
import { pilotFixture, HOME, OTHER, BOT } from './pilot-fixture.js';
import { P7_SCOPES } from '../src/p7-scopes.js';
import { wanderSignature, WANDER_PURPOSE } from '../src/wander-auth.js';
export const WANDER_TEST_KEY = Buffer.alloc(32, 5).toString('base64');
export async function wanderFixture(kind = 'memory', { origin = 'https://pilot.example' } = {}) {
  const f = await pilotFixture(kind, {
    origin,
    initialNow: Date.parse('2026-10-20T12:00:00Z'),
    extraBotScopes: [...P7_SCOPES],
    chronicleEnv: {
      SEEKERS_ENABLED: 'true',
      WANDER_ENABLED: 'true',
      WANDER_IDLE_HOURS: '72',
      WANDER_WARNING_HOURS: '12',
      P9_STREAK_ENABLED: 'true',
      MARK_AUTO_APPROVE_ENABLED: 'true',
      MARK_REVIEW_BLOCKLIST: '["spoiler"]',
    },
  });
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) f.streams.get(id).viewer_count = 1;
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  await f.control(OTHER, 'seek-on');
  f.advance();
  let serial = 0;
  const tick = async ({
    nonce = (++serial).toString(16).padStart(32, '0'),
    timestamp = f.now(),
    purpose = WANDER_PURPOSE,
    signature,
  } = {}) => {
    const raw = Buffer.from(JSON.stringify({ purpose, timestamp, nonce }));
    return f.request(
      '/internal/wander/tick',
      'POST',
      {
        'content-type': 'application/json',
        'x-rr-wander-signature': signature ?? wanderSignature(WANDER_TEST_KEY, raw),
      },
      raw,
    );
  };
  return Object.assign(f, { tick, advanceHours: (n) => f.advance(n * 3600000) });
}
