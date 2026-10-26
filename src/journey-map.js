import { stopStreak } from './streaks.js';
// Completed archive only. Never pass private lineage through to the browser.
export function journeyMap(lineage, config, now) {
  const stops = lineage?.stops ?? [];
  const ids = config?.channels ?? [];
  if (
    !Array.isArray(stops) ||
    stops.length > 16 ||
    ids.length > 4 ||
    !Number.isSafeInteger(now) ||
    now < 0
  )
    throw Error('Invalid journey');
  const seen = new Set(),
    events = new Set();
  let last = -1;
  const hops = stops.map((s, i) => {
    if (
      !ids.includes(s.from) ||
      !ids.includes(s.to) ||
      s.from === s.to ||
      !/^[a-f0-9]{64}$/.test(s.stopId) ||
      seen.has(s.stopId) ||
      typeof s.eventId !== 'string' ||
      !s.eventId.length ||
      events.has(s.eventId) ||
      s.ringIndex !== i + 1 ||
      !Number.isSafeInteger(s.claimedAt) ||
      s.claimedAt < 0 ||
      s.claimedAt < last ||
      s.claimedAt > now ||
      (s.kind === 'wander'
        ? s.raidSize !== null
        : !Number.isInteger(s.raidSize) || s.raidSize < 0 || s.raidSize > 1000000) ||
      (s.kind !== undefined && s.kind !== 'wander') ||
      (i && stops[i - 1].to !== s.from)
    )
      throw Error('Invalid journey');
    seen.add(s.stopId);
    events.add(s.eventId);
    last = s.claimedAt;
    return {
      stopId: s.stopId,
      from: s.from,
      to: s.to,
      claimedAt: s.claimedAt,
      ringIndex: s.ringIndex,
      raidSize: s.raidSize,
      ...(s.kind === 'wander' ? { kind: 'wander' } : {}),
      ...stopStreak(s),
    };
  });
  return {
    version: 1,
    coverage: 'Retained completed journeys only; not a lifetime route.',
    nodes: ids.map((id) => ({
      id,
      label: Object.entries(config.logins ?? {}).some(([, v]) => v === id)
        ? '@' + Object.entries(config.logins).find(([, v]) => v === id)[0]
        : `Channel ${id}`,
    })),
    hops,
  };
}
