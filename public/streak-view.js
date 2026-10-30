const utcFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  dateStyle: 'medium',
  timeStyle: 'short',
});
export function publicDate(value, now = Date.now(), relative = true) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 8640000000000000)
    return 'Time not recorded';
  const age = now - value;
  if (relative && Number.isFinite(age) && age >= 0 && age < 86400000) {
    if (age < 60000) return 'Just now';
    const minutes = Math.floor(age / 60000);
    if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }
  return utcFormat.format(value) + ' UTC';
}
// Closed anonymous coverage metadata; not raid-membership or viewer information.
export function validStreak(v) {
  return Boolean(
    v &&
    Object.keys(v).sort().join(',') === 'best,current,known,since,version' &&
    v.version === 1 &&
    typeof v.known === 'boolean' &&
    (v.known
      ? Number.isInteger(v.current) &&
        v.current >= 0 &&
        v.current <= 16 &&
        Number.isInteger(v.best) &&
        v.best >= v.current &&
        v.best <= 16 &&
        Number.isSafeInteger(v.since) &&
        v.since >= 0
      : v.current === null && v.best === null && v.since === null),
  );
}
export const streakText = (v) =>
  !validStreak(v) || !v.known
    ? 'Streak: not tracked for earlier hand-offs'
    : `Streak ${v.current} · best ${v.best} · tracked since ${publicDate(v.since)}`;
