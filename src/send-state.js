import { validRaidDiagnostic } from './raid-diagnostic.js';
import { hash } from './crypto.js';

export const SEND_LIMITS = Object.freeze({ leaseMs: 30000, queueMs: 120000, confirmationMs: 600000, ritualMs: 90000 });
const busy = intent => intent && !['rejected'].includes(intent.status);
export function eligible(registry, channels, marks, source, target, retired = false) {
  const ready = id => (channels[id]?.online || (retired && id === source)) && channels[id]?.optedIn
    && marks[id]?.context?.optedIn === true && marks[id].context.keeperId === id && !marks[id].paused
    && (id !== source || retired || marks[id].context.holdsRelic === true)
    && marks[id].context.streamId === (channels[id].online ? channels[id].streamId : channels[id].retiredStream?.streamId) && !channels[id].paused && !channels[id].banned
    && !marks[id].context.blockedUserIds?.includes(id)
    && !channels[id].blockedUserIds.includes(id) && !marks[id]?.blocked?.includes(id);
  return source !== target && registry.holderId === source && ready(source) && ready(target)
    && !channels[source].blockedUserIds.includes(target) && !channels[target].blockedUserIds.includes(source)
    && !marks[source]?.context?.blockedUserIds?.includes(target) && !marks[target]?.context?.blockedUserIds?.includes(source)
    && !marks[source]?.blocked?.includes(target) && !marks[target]?.blocked?.includes(source);
}
export function sendState(previous, channels, marks, config, op, now) {
  const registry = structuredClone(previous ?? { holderId: null, originated: false }); let result = null; let ritual = null;
  const intent = registry.send;
  if (op.type === 'reserve') {
    const targetId = config.logins[op.login];
    const reason = reservationReason(registry, channels, marks, config, op, now);
    if (reason) result = { status: 'blocked', reason };
    else {
      registry.send = { id: hash(op.id), sourceId: op.source, targetId, targetLogin: op.login, status: 'queued', createdAt: now,
        sourceStreamId: channels[op.source].streamId, targetStreamId: channels[targetId].streamId, expiresAt: now + SEND_LIMITS.queueMs };
      registry.sendWatermark = op.sentAt;
      result = { status: 'reserved', intentId: registry.send.id };
    }
  }
  if (op.type === 'claim' && intent?.sourceId === op.source && (!op.expectedId || intent.id === op.expectedId)) {
    if (intent.status === 'dispatching' && intent.leaseUntil <= now) intent.status = 'unknown';
    if (['queued', 'preflight'].includes(intent.status) && (intent.status === 'queued' || intent.leaseUntil <= now)) {
      if (intent.expiresAt <= now) intent.status = 'rejected';
      else { intent.status = 'preflight'; intent.owner = op.owner; intent.leaseUntil = now + SEND_LIMITS.leaseMs; result = structuredClone(intent); }
    }
  }
  const owns = intent && intent.id === op.id && intent.owner === op.owner;
  if (op.type === 'dispatch' && owns && intent.status === 'preflight' && intent.leaseUntil > now) {
    if (intent.expiresAt <= now || !eligible(registry, channels, marks, intent.sourceId, intent.targetId)
      || channels[intent.sourceId].streamId !== intent.sourceStreamId || channels[intent.targetId].streamId !== intent.targetStreamId) intent.status = 'rejected';
    else { intent.status = 'dispatching'; intent.dispatchAt = now; result = structuredClone(intent); }
  }
  if (op.type === 'finish' && owns && !['confirmed', 'rejected'].includes(intent.status)) {
    if (intent.status === 'dispatching') {
      intent.status = ['accepted', 'rejected', 'unknown'].includes(op.status) ? op.status : 'unknown';
      if (validRaidDiagnostic(op.diagnostic, intent)) intent.diagnostic = op.diagnostic;
    }
    else if (intent.status === 'preflight' && intent.leaseUntil > now && op.status === 'rejected') intent.status = 'rejected';
  }
  if (op.type === 'raid' && Number.isInteger(op.raid?.viewers) && op.raid.viewers >= 0 && op.raid.viewers <= 1000000) {
    const { raid, sentAt, id } = op; const source = raid.from_broadcaster_user_id; const target = raid.to_broadcaster_user_id;
    const correlated = busy(intent);
    const closed = channels[source]?.retiredStream;
    const retired = correlated && ['dispatching', 'accepted', 'unknown'].includes(intent.status)
      && !channels[source]?.online && channels[source]?.streamId === null
      && closed?.streamId === intent.sourceStreamId && sentAt >= closed.startedAt && sentAt < closed.offlineAt;
    const sourceStreamId = retired ? closed.streamId : channels[source]?.streamId;
    const sourceStartedAt = retired ? closed.startedAt : channels[source]?.startedAt;
    const after = correlated ? (intent.dispatchAt ?? intent.createdAt) : Math.max(channels[source]?.startedAt ?? Infinity, channels[target]?.startedAt ?? Infinity);
    if (!((registry.pendingHop?.endsAt > now && !registry.pendingHop.finalized && !registry.pendingHop.cancelled)) && sentAt > (registry.raidWatermark ?? -1) && sentAt >= after
      && (!correlated || (intent.sourceId === source && intent.targetId === target && sentAt <= after + SEND_LIMITS.confirmationMs
        && sourceStreamId === intent.sourceStreamId && channels[target]?.streamId === intent.targetStreamId))
      && eligible(registry, channels, marks, source, target, retired)
      && sentAt >= Math.max(sourceStartedAt, channels[target].startedAt, channels[source].consentAt, channels[target].consentAt)) {
      registry.raidWatermark = sentAt;
      registry.pendingHop = { eventId: hash(id), from: source, to: target, phase: 'pending-handoff', origin: correlated ? 'planned' : 'manual',
        sourceStreamId: sourceStreamId, targetStreamId: channels[target].streamId, retiredSource: Boolean(retired),
        raidSentAt: sentAt, raidSize: raid.viewers, threshold: Math.min(10, Math.ceil(Math.sqrt(Math.max(1, raid.viewers)))), offers: [], accepts: [],
        startedAt: now, snatchedUntil: now + 1500, endsAt: now + SEND_LIMITS.ritualMs };
      if (correlated) intent.status = 'confirmed';
      ritual = { eventId: id, incomingBroadcasterId: source, hostBroadcasterId: target, startedAt: now, endsAt: now + SEND_LIMITS.ritualMs };
    }
  }
  if (Buffer.byteLength(JSON.stringify(registry)) > 4096) throw new Error('Relic registry capacity reached');
  return { registry, result, ritual };
}

// Closed enums only: safe to expose in private controls/logs; never upstream data.
export function reservationReason(registry, channels, marks, config, op, now) {
  const target = config.logins[op.login];
  if (!config.channels.includes(op.source) || op.actor !== op.source) return 'source-actor';
  if (!target || target === op.source) return 'target-config';
  if (busy(registry.send)) return 'existing-intent';
  if (registry.pendingHop?.endsAt > now && !registry.pendingHop.finalized && !registry.pendingHop.cancelled) return 'pending-handoff';
  if (!Number.isFinite(op.sentAt) || op.sentAt <= (registry.sendWatermark ?? -1)) return 'send-watermark';
  if (registry.holderId !== op.source) return 'source-not-holder';
  for (const [role, id] of [['source', op.source], ['target', target]]) {
    const c = channels[id], m = marks[id];
    if (!c?.online || !c.streamId) return role + '-offline';
    if (!c.optedIn || m?.context?.optedIn !== true) return role + '-consent';
    if (c.paused || m?.paused) return role + '-paused';
    if (c.banned || c.blockedUserIds.includes(id) || m?.blocked?.includes(id) || m?.context?.blockedUserIds?.includes(id)) return role + '-blocked';
    if (!m?.context || m.context.keeperId !== id || m.context.streamId !== c.streamId || (role === 'source' && m.context.holdsRelic !== true)) return role + '-mark-context';
    if (!Number.isFinite(c.startedAt) || !Number.isFinite(c.consentAt) || op.sentAt < Math.max(c.startedAt, c.consentAt)) return role + '-timestamp';
  }
  if (!eligible(registry, channels, marks, op.source, target)) return 'cross-channel-block';
  return null;
}
