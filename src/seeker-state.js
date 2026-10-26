// Bounded effective membership; legacy joins made while holding never revive on departure.
export function dequeueSeeker(channel, now) {
  if (!channel) return;
  channel.seeking = false;
  channel.seekAt = Math.max(Number.isFinite(channel.seekAt) ? channel.seekAt : 0, now);
}
export function seekerState(registry, lineage, channels, marks, id) {
  const c = channels[id],
    m = marks[id];
  if (registry?.holderId === id) return { member: false, reason: 'holding' };
  if (!c?.optedIn) return { member: false, reason: 'not-opted-in' };
  if (!c.seeking) return { member: false, reason: 'not-joined' };
  const barrier = Math.max(
    -1,
    ...(lineage?.stops ?? [])
      .filter((s) => s.from === id || s.to === id)
      .map((s) => s.claimedAt)
      .filter(Number.isFinite),
  );
  if (!Number.isFinite(c.seekAt) || c.seekAt <= barrier)
    return { member: false, reason: 'needs-rejoin' };
  if (c.banned || c.blockedUserIds?.includes(id) || m?.blocked?.includes(id))
    return { member: true, reason: 'policy-blocked' };
  if (c.paused || m?.paused) return { member: true, reason: 'paused' };
  if (!c.online || m?.context?.streamId !== c.streamId)
    return { member: true, reason: 'offline-or-stale' };
  return { member: true, reason: 'observations-required' };
}
export function seekerStatusMessage(status) {
  if (status.reason === 'holding')
    return 'You hold the relic. Seeker queue off; pass it on before joining again.';
  if (!status.member)
    return status.reason === 'needs-rejoin'
      ? 'Seeker status: off. Your earlier choice predates a hand-off; type !seek to rejoin.'
      : status.reason === 'not-opted-in'
        ? 'Seeker status: off. Opt in as a Keeper first, then !seek.'
        : 'Seeker status: off. Type !seek to rejoin.';
  if (
    Number.isInteger(status.position) &&
    status.position >= 1 &&
    status.position <= 4 &&
    Number.isInteger(status.total) &&
    status.total >= status.position &&
    status.total <= 4
  )
    return `Seeker status: on. Eligible live suggestion ${status.position} of ${status.total}, ordered by viewers then login. !seek off to leave.`;
  const reasons = {
    paused: 'channel paused',
    'offline-or-stale': 'offline or stream not confirmed',
    'policy-blocked': 'channel policy',
    'observations-required': 'live permissions/readiness not confirmed',
  };
  return `Seeker status: on. Position not confirmed: ${reasons[status.reason] ?? reasons['observations-required']}. !seek off to leave.`;
}
