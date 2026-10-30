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
export { seekerStatusMessage } from '../public/ritual-copy.js';
