// No scope request or subscription creation. Ingestion needs a recent explicit
// bootstrap proof of the existing broadcaster grant's channel:moderate scope.
export function parseBan(payload, host, sentAt) {
  const s = payload.subscription, e = payload.event, iso = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(Date.parse(x)).toISOString().slice(0, 19) === x.slice(0, 19);
  if (s?.type !== 'channel.ban' || s.version !== '1' || !s.condition || Object.keys(s.condition).length !== 1 || s.condition.broadcaster_user_id !== host
    || e?.broadcaster_user_id !== host || !/^\d{1,32}$/.test(e?.user_id ?? '') || typeof e.user_id !== 'string' || !/^\d{1,32}$/.test(e.moderator_user_id ?? '')
    || typeof e.moderator_user_id !== 'string' || typeof e.is_permanent !== 'boolean' || !iso(e.banned_at) || Date.parse(e.banned_at) > sentAt
    || (e.is_permanent ? e.ends_at !== null : !iso(e.ends_at) || Date.parse(e.ends_at) <= Date.parse(e.banned_at))
    || e.source_broadcaster_user_id != null || e.source_message_id != null) throw Error('Invalid ban event');
  return { host, type: 'ban', userId: e.user_id, sentAt };
}
