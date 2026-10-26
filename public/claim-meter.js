export function validClaimMeter(m) {
  return (
    m &&
    Object.keys(m)
      .filter((k) => k !== 'clockPolicy')
      .sort()
      .join(',') === 'accepts,awaitingRaid,endsAt,offers,provisional,startedAt,threshold' &&
    (m.clockPolicy === undefined ||
      (['accepted-v1', 'landing-v2'].includes(m.clockPolicy) &&
        m.endsAt - m.startedAt === 180000 &&
        m.provisional === (m.clockPolicy === 'accepted-v1'))) &&
    Number.isFinite(m.startedAt) &&
    Number.isFinite(m.endsAt) &&
    [90000, 180000].includes(m.endsAt - m.startedAt) &&
    Number.isInteger(m.threshold) &&
    m.threshold >= 1 &&
    m.threshold <= 10 &&
    [m.offers, m.accepts].every((n) => Number.isInteger(n) && n >= 0 && n <= 10) &&
    typeof m.provisional === 'boolean' &&
    m.awaitingRaid === m.provisional
  );
}
export function meterProgress(m, time) {
  if (!validClaimMeter(m) || !Number.isFinite(time) || time < m.startedAt || time >= m.endsAt)
    return null;
  return {
    offers: Math.min(1, m.offers / m.threshold),
    accepts: Math.min(1, m.accepts / m.threshold),
    seconds: Math.max(0, Math.ceil((m.endsAt - time) / 1000)),
  };
}
