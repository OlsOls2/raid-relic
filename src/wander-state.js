import { dequeueSeeker, seekerState } from './seeker-state.js';
import { hash } from './crypto.js';

export const WANDER_BYTES = 128 * 1024;
const hour = 3600000;
const timestamp = (v) => Number.isSafeInteger(v) && v >= 0;
export function wanderPolicy(env = {}) {
  if (env.WANDER_ENABLED !== undefined && !['true', 'false'].includes(env.WANDER_ENABLED))
    throw Error('Explicit Wander gate required');
  const hours = (name, fallback) => {
    const value = env[name] ?? String(fallback);
    if (typeof value !== 'string' || !/^[1-9]\d{0,3}$/.test(value) || Number(value) > 8760)
      throw Error('Wander hours rejected');
    return Number(value);
  };
  const idleHours = hours('WANDER_IDLE_HOURS', 72),
    warningHours = hours('WANDER_WARNING_HOURS', 12);
  if (warningHours >= idleHours) throw Error('Warning must precede idle deadline');
  return Object.freeze({ enabled: env.WANDER_ENABLED === 'true', idleHours, warningHours });
}
export const wanderKey = (input) =>
  hash(
    JSON.stringify({
      registry: input.registry,
      channels: input.channels,
      marks: input.marks,
      lineage: input.lineage,
    }),
  );
function tracker(registry, now) {
  registry.wander = {
    version: 1,
    generation: (registry.wander?.generation ?? 0) + 1,
    activityAt: now,
    lastTickAt: now,
    nonces: [],
    rows: [],
  };
}
// Only actual accepted play calls this inside its existing transaction.
export function wanderActivity(registry, now, enabled) {
  if (!enabled || !timestamp(now)) return;
  const old = registry.wander;
  if (old && (now < old.activityAt || now < old.lastTickAt || old.generation >= 1000000000)) return;
  const nonces = old?.nonces ?? [];
  tracker(registry, now);
  registry.wander.nonces = nonces;
}
function busy(registry, now) {
  const s = registry.send,
    h = registry.pendingHop;
  if (h && !h.cancelled && !h.finalized && now < h.endsAt) return true;
  if (!s || ['rejected', 'expired-handoff'].includes(s.status)) return false;
  if (s.status === 'confirmed' && h?.verified === true && now >= h.endsAt) return false;
  if (
    ['queued', 'preflight'].includes(s.status) &&
    s.dispatchAt === undefined &&
    s.expiresAt <= now
  )
    return false;
  return true; // accepted/dispatching/unknown are never inferred to be failed.
}
function allowed(input, id) {
  const c = input.channels[id],
    m = input.marks[id];
  return Boolean(
    c?.optedIn &&
    !c.paused &&
    !c.banned &&
    !m?.paused &&
    !c.blockedUserIds?.includes(id) &&
    !m?.blocked?.includes(id),
  );
}
export function wanderMembers(input, config) {
  const from = input.registry?.holderId;
  if (!allowed(input, from)) return [];
  return config.channels.filter(
    (id) =>
      id !== from &&
      allowed(input, id) &&
      seekerState(input.registry, input.lineage, input.channels, input.marks, id).member &&
      !input.channels[from].blockedUserIds?.includes(id) &&
      !input.channels[id].blockedUserIds?.includes(from) &&
      !input.marks[from]?.blocked?.includes(id) &&
      !input.marks[id]?.blocked?.includes(from),
  );
}
function validProof(proof, now, source) {
  return (
    proof &&
    proof.source === source &&
    proof.sourceValid === true &&
    timestamp(proof.at) &&
    now >= proof.at &&
    now - proof.at <= 30000 &&
    Array.isArray(proof.candidates) &&
    proof.candidates.length <= 4 &&
    new Set(proof.candidates.map((c) => c.id)).size === proof.candidates.length &&
    proof.candidates.every(
      (c) =>
        typeof c.id === 'string' &&
        typeof c.live === 'boolean' &&
        Number.isInteger(c.viewers) &&
        c.viewers >= 0 &&
        c.viewers <= 1000000,
    )
  );
}
function reference(input, m, host, streamId) {
  const originHost = m.originHost ?? host,
    originStream = m.originStream ?? streamId;
  const c = input.channels[originHost],
    d = input.marks[originHost];
  const live = d?.sessions
    ?.find((s) => s.streamId === originStream)
    ?.marks?.find(
      (v) => v.id === m.id && v.userId === m.userId && v.text === m.text && v.status === 'approved',
    );
  return live &&
    d?.context?.optedIn &&
    c?.optedIn &&
    !c.banned &&
    !c.blockedUserIds?.includes(m.userId) &&
    !d.blocked?.includes(m.userId)
    ? { id: m.id, userId: m.userId, text: m.text, originHost, originStream }
    : null;
}
function bounded(next) {
  if (
    Buffer.byteLength(JSON.stringify(next.registry)) > 4096 ||
    Buffer.byteLength(JSON.stringify(next.lineage)) > WANDER_BYTES
  )
    throw Error('Wander capacity');
  return next;
}
export function wanderMutation(previous, config, policy, op, now) {
  const input = structuredClone(previous);
  input.registry ??= { holderId: null, originated: false };
  input.lineage ??= { stops: [] };
  const result = (status, extra = {}) => ({ ...input, result: { status, ...extra } });
  if (!policy?.enabled) return result('disabled');
  if (
    policy.enabled !== true ||
    Object.keys(policy).sort().join(',') !== 'enabled,idleHours,warningHours' ||
    !Number.isInteger(policy.idleHours) ||
    !Number.isInteger(policy.warningHours) ||
    policy.idleHours < 1 ||
    policy.idleHours > 8760 ||
    policy.warningHours < 1 ||
    policy.warningHours >= policy.idleHours
  )
    return result('invalid-policy');
  if (!timestamp(now) || !config?.channels.includes(input.registry.holderId))
    return result('parked');
  const r = input.registry;
  let w = r.wander;
  if (
    w &&
    (w.version !== 1 ||
      !timestamp(w.activityAt) ||
      !timestamp(w.lastTickAt) ||
      now < w.activityAt ||
      now < w.lastTickAt ||
      !Number.isSafeInteger(w.generation) ||
      w.generation < 1 ||
      w.generation >= 1000000000 ||
      !Array.isArray(w.nonces) ||
      w.nonces.length > 16 ||
      !Array.isArray(w.rows) ||
      w.rows.length > 2)
  )
    return result('clock-or-tracker-unavailable');
  if (op.type === 'prepare') {
    if (
      input.lineage.stops.length >= 16 ||
      Buffer.byteLength(JSON.stringify(input.lineage)) > WANDER_BYTES
    )
      return result('capacity');
    if (!/^[a-f0-9]{64}$/.test(op.nonce ?? '')) return result('invalid');
    if (!w) {
      tracker(r, now);
      w = r.wander;
    }
    w.nonces = w.nonces.filter((n) => now >= n.at && now - n.at <= 120000);
    if (w.nonces.some((n) => n.key === op.nonce)) return result('duplicate');
    if (w.nonces.length >= 16) return result('limited');
    w.nonces.push({ key: op.nonce, at: now });
    w.lastTickAt = now;
    w.prepared = op.nonce;
    const deadline = w.activityAt + policy.idleHours * hour;
    const status = busy(r, now)
      ? 'busy'
      : now < deadline - policy.warningHours * hour
        ? 'waiting'
        : 'needs-work';
    return bounded(result(status));
  }
  if (!w) return result('untracked');
  if (op.type === 'claim-message') {
    const row = w.rows.find((row) => row.key === op.key);
    if (
      !row ||
      !allowed(input, row.host) ||
      row.status !== 'queued' ||
      now > row.until ||
      row.generation !== w.generation ||
      (row.kind === 'warning' && (r.holderId !== row.host || busy(r, now))) ||
      (row.kind === 'arrival' &&
        (r.holderId !== row.host || input.lineage.stops.at(-1)?.stopId !== row.stopId))
    )
      return result('no-message');
    row.status = 'dispatching';
    row.attemptAt = now;
    return bounded(
      result('message', { message: { key: row.key, host: row.host, kind: row.kind } }),
    );
  }
  if (op.type === 'finish-message') {
    const row = w.rows.find((row) => row.key === op.key);
    if (!row || row.status !== 'dispatching') return result('no-message');
    row.status = op.accepted === true ? 'accepted' : 'unknown';
    return bounded(result('message-recorded'));
  }
  if (op.type !== 'commit' || op.expected !== wanderKey(previous) || op.nonce !== w.prepared)
    return result('superseded');
  const from = r.holderId;
  if (busy(r, now) || !allowed(input, from)) return result('busy');
  if (!validProof(op.proof, now, from)) return result('capability-unavailable');
  const deadline = w.activityAt + policy.idleHours * hour;
  if (now < deadline - policy.warningHours * hour) return result('waiting');
  if (!w.warningAt) {
    w.warningAt = now;
    w.rows = [
      {
        key: hash(`wander-warning:${from}:${w.generation}:${w.activityAt}`),
        host: from,
        kind: 'warning',
        generation: w.generation,
        status: 'queued',
        until: now + 30000,
      },
    ];
    return bounded(result('warning-queued'));
  }
  const warning = w.rows.find((row) => row.kind === 'warning');
  if (!warning || warning.status !== 'accepted') return result('warning-unconfirmed');
  if (now < Math.max(deadline, w.warningAt + policy.warningHours * hour)) return result('warned');
  const members = wanderMembers(input, config);
  const candidates = op.proof.candidates
    .filter(
      (v) =>
        members.includes(v.id) &&
        v.live === Boolean(input.channels[v.id].online) &&
        (!v.live ||
          (input.channels[v.id].streamId === v.streamId &&
            input.marks[v.id]?.context?.streamId === v.streamId)),
    )
    .sort(
      (a, b) =>
        Number(b.live) - Number(a.live) || a.viewers - b.viewers || a.id.localeCompare(b.id),
    );
  if (!candidates.length) return result('parked');
  if (
    input.lineage.stops.length >= 16 ||
    Buffer.byteLength(JSON.stringify(input.lineage)) > WANDER_BYTES
  )
    return result('capacity');
  const to = candidates[0].id,
    last = input.lineage.stops.at(-1);
  if (last && (last.to !== from || last.claimedAt > now)) return result('history-unavailable');
  const current = input.marks[from],
    session = current?.sessions?.find((s) => s.streamId === current.context?.streamId);
  const refs = [
    ...(last?.to === from
      ? last.marks.map((m) => reference(input, m, last.from, last.streamId))
      : []),
    ...(session?.marks ?? []).map((m) => reference(input, m, from, session.streamId)),
  ].filter(Boolean);
  const seen = new Set(),
    carried = [];
  for (const m of refs) {
    const key = JSON.stringify([m.originHost, m.originStream, m.id, m.userId]);
    if (!seen.has(key)) {
      seen.add(key);
      carried.push(m);
    }
  }
  if (carried.length > 160) return result('capacity');
  const eventId = `wander:${hash(`${from}:${to}:${w.generation}:${w.activityAt}`)}`;
  const stop = {
    kind: 'wander',
    stopId: hash(eventId),
    eventId,
    from,
    to,
    claimedAt: now,
    raidSize: null,
    ringIndex: input.lineage.stops.length + 1,
    marks: carried,
  };
  if (
    Buffer.byteLength(JSON.stringify({ ...input.lineage, stops: [...input.lineage.stops, stop] })) >
    WANDER_BYTES
  )
    return result('capacity');
  input.lineage.stops.push(stop);
  r.holderId = to;
  dequeueSeeker(input.channels[to], now);
  r.carriedClosures = 0;
  delete r.send;
  delete r.pendingHop;
  delete r.echo;
  if (input.marks[from]?.context) input.marks[from].context.holdsRelic = false;
  if (input.marks[to]?.context)
    input.marks[to].context.holdsRelic = Boolean(
      input.channels[to].online && input.marks[to].context.streamId === input.channels[to].streamId,
    );
  if (config.streakEnabled)
    r.streak = {
      version: 1,
      current: 0,
      best:
        Number.isInteger(r.streak?.best) && r.streak.best >= 0 && r.streak.best <= 16
          ? r.streak.best
          : 0,
      since: timestamp(r.streak?.since) && r.streak.since <= now ? r.streak.since : now,
      lastAt: now,
      lastRing: stop.ringIndex,
    };
  wanderActivity(r, now, true);
  w = r.wander;
  w.rows = [
    {
      key: hash(`wander-arrival:${stop.stopId}`),
      host: to,
      stopId: stop.stopId,
      kind: 'arrival',
      generation: w.generation,
      status: 'queued',
      until: now + 30000,
    },
  ];
  return bounded(result('wandered', { stopId: stop.stopId }));
}
