import { observeStreak, beginStreak } from './streaks.js';
import { validRaidDiagnostic } from './raid-diagnostic.js';
import { hash } from './crypto.js';

export const SEND_LIMITS = Object.freeze({
  leaseMs: 30000,
  queueMs: 120000,
  confirmationMs: 600000,
  ritualMs: 90000,
});
export const claimThreshold = (viewers) =>
  viewers <= 2 ? 1 : Math.min(10, Math.ceil(Math.sqrt(Math.max(1, viewers))));
const busy = (intent) => intent && !['rejected', 'expired-handoff'].includes(intent.status);
export function eligible(registry, channels, marks, source, target, retired = false) {
  const ready = (id) =>
    (channels[id]?.online || (retired && id === source)) &&
    channels[id]?.optedIn &&
    marks[id]?.context?.optedIn === true &&
    marks[id].context.keeperId === id &&
    !marks[id].paused &&
    (id !== source || retired || marks[id].context.holdsRelic === true) &&
    marks[id].context.streamId ===
      (channels[id].online ? channels[id].streamId : channels[id].retiredStream?.streamId) &&
    !channels[id].paused &&
    !channels[id].banned &&
    !marks[id].context.blockedUserIds?.includes(id) &&
    !channels[id].blockedUserIds.includes(id) &&
    !marks[id]?.blocked?.includes(id);
  return (
    source !== target &&
    registry.holderId === source &&
    ready(source) &&
    ready(target) &&
    !channels[source].blockedUserIds.includes(target) &&
    !channels[target].blockedUserIds.includes(source) &&
    !marks[source]?.context?.blockedUserIds?.includes(target) &&
    !marks[target]?.context?.blockedUserIds?.includes(source) &&
    !marks[source]?.blocked?.includes(target) &&
    !marks[target]?.blocked?.includes(source)
  );
}
export function sendState(previous, channels, marks, config, op, now) {
  let registry = structuredClone(previous ?? { holderId: null, originated: false });
  let result = null;
  let ritual = null;
  observeStreak(registry, now, config?.streakEnabled);
  let automaticallyRetired = false;
  const priorSendWatermark = registry.sendWatermark ?? -1;
  const retiredDeadline = registry.pendingHop?.endsAt;
  if (
    ['reserve', 'reconcile-ended'].includes(op.type) &&
    config.channels.includes(op.source) &&
    op.actor === op.source &&
    registry.send?.status === 'confirmed' &&
    registry.pendingHop &&
    now >= registry.pendingHop.endsAt &&
    (op.type === 'reserve' ||
      (op.id === registry.send.id &&
        op.generation === registry.send.generation &&
        op.hopId === registry.pendingHop.eventId))
  ) {
    const retired = sendState(
      registry,
      channels,
      marks,
      config,
      {
        type: 'expire-handoff',
        source: op.source,
        actor: op.actor,
        id: registry.send.id,
        hopId: registry.pendingHop.eventId,
      },
      now,
    );
    if (retired.result?.status === 'expired-handoff') {
      registry = retired.registry;
      automaticallyRetired = true;
      result = retired.result;
    }
  }
  const intent = registry.send;
  if (op.type === 'reserve') {
    const targetId = config.logins[op.login];
    // Only a request genuinely after the proved old window may cross this
    // transaction's retirement watermark. Persisted watermarks never rewind.
    const postWindow =
      automaticallyRetired &&
      Number.isFinite(op.sentAt) &&
      op.sentAt <= now &&
      now - op.sentAt <= SEND_LIMITS.confirmationMs &&
      op.sentAt > priorSendWatermark &&
      (op.sentAt > retiredDeadline || (op.sentAt === retiredDeadline && op.sentAt === now));
    const reason = reservationReason(registry, channels, marks, config, op, now, {
      watermark: postWindow ? priorSendWatermark : (registry.sendWatermark ?? -1),
    });
    if (reason) result = { status: 'blocked', reason };
    else {
      registry.send = {
        id: hash(op.id),
        generation: hash(`send-generation:${op.id}:${op.sentAt}`),
        sourceId: op.source,
        targetId,
        targetLogin: op.login,
        requestedAt: op.sentAt,
        status: 'queued',
        createdAt: now,
        sourceStreamId: channels[op.source].streamId,
        targetStreamId: channels[targetId].streamId,
        expiresAt: now + SEND_LIMITS.queueMs,
      };
      registry.sendWatermark = Math.max(registry.sendWatermark ?? -1, op.sentAt);
      result = { status: 'reserved', intentId: registry.send.id };
    }
  }
  if (
    op.type === 'cancel-queued' &&
    config.channels.includes(op.source) &&
    op.actor === op.source &&
    registry.holderId === op.source &&
    intent?.sourceId === op.source &&
    intent.id === op.id &&
    typeof intent.generation === 'string' &&
    intent.generation === op.generation
  ) {
    // Generation CAS is the random event-derived intent hash. Retain the
    // terminal record/watermark; never delete or mutate a claimed dispatch.
    if (
      intent.status === 'queued' &&
      !Object.hasOwn(intent, 'dispatchAt') &&
      !Object.hasOwn(intent, 'owner') &&
      !Object.hasOwn(intent, 'leaseUntil')
    ) {
      intent.status = 'rejected';
      result = { status: 'cancelled-undispatched' };
    }
  }
  if (op.type === 'expire-handoff') {
    const hop = registry.pendingHop;
    const source = channels[op.source];
    const streamMatches = source?.online
      ? source.streamId === hop?.sourceStreamId
      : source?.retiredStream?.streamId === hop?.sourceStreamId;
    const provenClosed = source?.closedIds?.includes(hop?.sourceStreamId) === true;
    if (
      config.channels.includes(op.source) &&
      op.actor === op.source &&
      registry.holderId === op.source &&
      intent?.status === 'confirmed' &&
      intent.id === op.id &&
      intent.sourceId === op.source &&
      hop?.eventId === op.hopId &&
      hop.from === op.source &&
      hop.to === intent.targetId &&
      !hop.finalized &&
      hop.sourceStreamId === intent.sourceStreamId &&
      hop.targetStreamId === intent.targetStreamId &&
      Number.isFinite(hop.raidSentAt) &&
      hop.raidSentAt >= (intent.dispatchAt ?? intent.createdAt) &&
      Number.isFinite(hop.endsAt) &&
      now >= hop.endsAt &&
      (streamMatches || provenClosed)
    ) {
      hop.cancelled = true;
      hop.expired = true;
      delete hop.offers;
      delete hop.accepts;
      delete hop.movedOffers;
      intent.status = 'expired-handoff';
      intent.retiredAt = now;
      intent.confirmedEventId = hop.eventId;
      intent.confirmedRaidSentAt = hop.raidSentAt;
      registry.raidWatermark = Math.max(registry.raidWatermark ?? -1, now);
      registry.sendWatermark = Math.max(registry.sendWatermark ?? -1, now);
      result = { status: 'expired-handoff' };
    } else if (
      intent?.status === 'expired-handoff' &&
      intent.id === op.id &&
      registry.holderId === op.source &&
      intent.sourceId === op.source &&
      op.actor === op.source &&
      hop?.eventId === op.hopId &&
      hop.expired &&
      !hop.finalized
    )
      result = { status: 'expired-handoff' };
    else result = { status: 'blocked', reason: 'handoff-expiry-proof' };
  }
  if (
    op.type === 'claim' &&
    intent?.sourceId === op.source &&
    (!op.expectedId || intent.id === op.expectedId)
  ) {
    if (intent.status === 'dispatching' && intent.leaseUntil <= now) intent.status = 'unknown';
    if (
      ['queued', 'preflight'].includes(intent.status) &&
      (intent.status === 'queued' || intent.leaseUntil <= now)
    ) {
      if (intent.expiresAt <= now) intent.status = 'rejected';
      else {
        intent.status = 'preflight';
        intent.owner = op.owner;
        intent.leaseUntil = now + SEND_LIMITS.leaseMs;
        result = structuredClone(intent);
      }
    }
  }
  const owns = intent && intent.id === op.id && intent.owner === op.owner;
  if (op.type === 'dispatch' && owns && intent.status === 'preflight' && intent.leaseUntil > now) {
    if (
      intent.expiresAt <= now ||
      !eligible(registry, channels, marks, intent.sourceId, intent.targetId) ||
      channels[intent.sourceId].streamId !== intent.sourceStreamId ||
      channels[intent.targetId].streamId !== intent.targetStreamId
    )
      intent.status = 'rejected';
    else {
      intent.status = 'dispatching';
      intent.dispatchAt = now;
      if (Number.isInteger(op.viewerEstimate)) intent.viewerEstimate = op.viewerEstimate;
      result = structuredClone(intent);
    }
  }
  if (op.type === 'finish' && owns && !['confirmed', 'rejected'].includes(intent.status)) {
    if (intent.status === 'dispatching') {
      intent.status = ['accepted', 'rejected', 'unknown'].includes(op.status)
        ? op.status
        : 'unknown';
      if (
        intent.status === 'accepted' &&
        eligible(registry, channels, marks, intent.sourceId, intent.targetId) &&
        channels[intent.sourceId].streamId === intent.sourceStreamId &&
        channels[intent.targetId].streamId === intent.targetStreamId
      ) {
        intent.acceptedAt = now;
        registry.pendingHop = {
          intentId: intent.id,
          eventId: intent.id,
          from: intent.sourceId,
          to: intent.targetId,
          sourceStreamId: intent.sourceStreamId,
          targetStreamId: intent.targetStreamId,
          policy: 'preclaim-v1',
          claimClock: 'accepted-v1',
          provisional: true,
          verified: false,
          acceptedAt: now,
          claimStartedAt: now,
          claimEndsAt: now + 180000,
          startedAt: now,
          endsAt: now + 180000,
          threshold: claimThreshold(intent.viewerEstimate ?? 1),
          offers: [],
          accepts: [],
        };
      }
      if (validRaidDiagnostic(op.diagnostic, intent)) intent.diagnostic = op.diagnostic;
    } else if (intent.status === 'preflight' && intent.leaseUntil > now && op.status === 'rejected')
      intent.status = 'rejected';
  }
  if (
    op.type === 'raid' &&
    Number.isInteger(op.raid?.viewers) &&
    op.raid.viewers >= 0 &&
    op.raid.viewers <= 1000000
  ) {
    const { raid, sentAt, id } = op;
    const source = raid.from_broadcaster_user_id;
    const target = raid.to_broadcaster_user_id;
    const correlated = busy(intent);
    const closed = channels[source]?.retiredStream;
    const retired =
      correlated &&
      ['dispatching', 'accepted', 'unknown'].includes(intent.status) &&
      !channels[source]?.online &&
      channels[source]?.streamId === null &&
      closed?.streamId === intent.sourceStreamId &&
      sentAt >= closed.startedAt &&
      sentAt < closed.offlineAt;
    const sourceStreamId = retired ? closed.streamId : channels[source]?.streamId;
    const sourceStartedAt = retired ? closed.startedAt : channels[source]?.startedAt;
    const after = correlated
      ? (intent.dispatchAt ?? intent.createdAt)
      : Math.max(channels[source]?.startedAt ?? Infinity, channels[target]?.startedAt ?? Infinity);
    if (
      ((intent && registry.pendingHop?.intentId === intent.id && !registry.pendingHop.verified) ||
        !(
          registry.pendingHop?.endsAt > now &&
          !registry.pendingHop.finalized &&
          !registry.pendingHop.cancelled
        )) &&
      sentAt > (registry.raidWatermark ?? -1) &&
      sentAt >= after &&
      (!correlated ||
        (intent.sourceId === source &&
          intent.targetId === target &&
          sentAt <= after + SEND_LIMITS.confirmationMs &&
          sourceStreamId === intent.sourceStreamId &&
          channels[target]?.streamId === intent.targetStreamId)) &&
      (!correlated || intent.status !== 'confirmed') &&
      !(
        intent &&
        registry.pendingHop?.intentId === intent.id &&
        registry.pendingHop.cancelled &&
        registry.pendingHop.cancelReason !== 'window-ended'
      ) &&
      eligible(registry, channels, marks, source, target, retired) &&
      sentAt >=
        Math.max(
          sourceStartedAt,
          channels[target].startedAt,
          channels[source].consentAt,
          channels[target].consentAt,
        )
    ) {
      registry.raidWatermark = sentAt;
      const candidate = registry.pendingHop;
      const preclaim =
        candidate?.policy === 'preclaim-v1' &&
        candidate.intentId === intent?.id &&
        candidate.from === source &&
        candidate.to === target &&
        candidate.sourceStreamId === sourceStreamId &&
        candidate.targetStreamId === channels[target].streamId
          ? candidate
          : null;
      registry.pendingHop = {
        eventId: hash(id),
        from: source,
        to: target,
        phase: 'pending-handoff',
        origin: correlated ? 'planned' : 'manual',
        sourceStreamId: sourceStreamId,
        targetStreamId: channels[target].streamId,
        retiredSource: Boolean(retired),
        raidSentAt: sentAt,
        raidSize: raid.viewers,
        threshold: claimThreshold(raid.viewers),
        thresholdPolicy: 'small-raid-v2',
        offers: [],
        accepts: [],
        startedAt: now,
        snatchedUntil: now + 1500,
        endsAt: now + 180000,
        policy: 'preclaim-v1',
        verified: true,
        provisional: false,
        verifiedRaidReceivedAt: now,
        arrivalStartedAt: now,
        claimStartedAt: now,
        claimEndsAt: now + 180000,
        claimClock: 'landing-v2',
        voteStartedAt: preclaim?.acceptedAt ?? now,
        ...(preclaim
          ? {
              intentId: preclaim.intentId,
              acceptedAt: preclaim.acceptedAt,
              offers: preclaim.offers ?? [],
              accepts: preclaim.accepts ?? [],
              ...(preclaim.movedOffers ? { movedOffers: preclaim.movedOffers } : {}),
              cancelled: preclaim.cancelled === true && preclaim.cancelReason !== 'window-ended',
            }
          : {}),
      };
      if (correlated) intent.status = 'confirmed';
      ritual = {
        eventId: id,
        incomingBroadcasterId: source,
        hostBroadcasterId: target,
        startedAt: now,
        endsAt: registry.pendingHop.endsAt,
      };
    }
  }
  if (
    config?.streakEnabled &&
    registry.pendingHop?.verified === true &&
    registry.pendingHop.eventId !== previous?.pendingHop?.eventId
  )
    beginStreak(registry, now, true);
  if (Buffer.byteLength(JSON.stringify(registry)) > 4096)
    throw new Error('Relic registry capacity reached');
  return { registry, result, ritual };
}

// Closed enums only: safe to expose in private controls/logs; never upstream data.
export function reservationReason(
  registry,
  channels,
  marks,
  config,
  op,
  now,
  { watermark = registry.sendWatermark ?? -1 } = {},
) {
  const target = config.logins[op.login];
  if (!config.channels.includes(op.source) || op.actor !== op.source) return 'source-actor';
  if (!target || target === op.source) return 'target-config';
  if (busy(registry.send)) return 'existing-intent';
  if (
    registry.pendingHop?.endsAt > now &&
    !registry.pendingHop.finalized &&
    !registry.pendingHop.cancelled
  )
    return 'pending-handoff';
  if (!Number.isFinite(op.sentAt) || op.sentAt > now || op.sentAt <= watermark)
    return 'send-watermark';
  if (registry.holderId !== op.source) return 'source-not-holder';
  for (const [role, id] of [
    ['source', op.source],
    ['target', target],
  ]) {
    const c = channels[id],
      m = marks[id];
    if (!c?.online || !c.streamId) return role + '-offline';
    if (!c.optedIn || m?.context?.optedIn !== true) return role + '-consent';
    if (c.paused || m?.paused) return role + '-paused';
    if (
      c.banned ||
      c.blockedUserIds.includes(id) ||
      m?.blocked?.includes(id) ||
      m?.context?.blockedUserIds?.includes(id)
    )
      return role + '-blocked';
    if (
      !m?.context ||
      m.context.keeperId !== id ||
      m.context.streamId !== c.streamId ||
      (role === 'source' && m.context.holdsRelic !== true)
    )
      return role + '-mark-context';
    if (
      !Number.isFinite(c.startedAt) ||
      !Number.isFinite(c.consentAt) ||
      op.sentAt < Math.max(c.startedAt, c.consentAt)
    )
      return role + '-timestamp';
  }
  if (!eligible(registry, channels, marks, op.source, target)) return 'cross-channel-block';
  return null;
}
