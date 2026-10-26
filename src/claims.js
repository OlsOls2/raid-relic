import { dequeueSeeker } from './seeker-state.js';
import { RECEIVING_KEEPERS } from './receiving.js';
import { observeStreak, completeStreak, stopStreak } from './streaks.js';
import { scoreCompletion } from './scoreboard.js';
import { hash } from './crypto.js';
import { runeSvg } from './marks.js';
import { eligible } from './send-state.js';

export const LINEAGE_LIMITS = Object.freeze({ stops: 16, marksPerStop: 160, bytes: 524288 });
export const emptyLineage = () => ({ stops: [] });
export function publicJourney(lineage) {
  return {
    rings: lineage?.stops?.length ?? 0,
    stops: (lineage?.stops ?? []).map((stop) => ({
      stopId: stop.stopId,
      from: stop.from,
      to: stop.to,
      claimedAt: stop.claimedAt,
      raidSize: stop.raidSize,
      ...(stop.kind === 'wander' ? { kind: 'wander' } : {}),
      ringIndex: stop.ringIndex,
      ...stopStreak(stop),
      marks: stop.marks.map((mark) => ({
        id: mark.id,
        text: mark.text,
        runeSvg: runeSvg(mark.text),
      })),
    })),
  };
}
// All inputs are store-owned snapshots. No effects; caller commits every result together.
export function reduceClaims(
  registry,
  channels,
  marks,
  previous,
  chat,
  now,
  sentAt = now,
  presence = {},
  streakEnabled = false,
  names = RECEIVING_KEEPERS,
) {
  registry = structuredClone(registry);
  channels = structuredClone(channels);
  marks = structuredClone(marks);
  const lineage = structuredClone(previous ?? emptyLineage());
  let awaitingRaid = false;
  let acknowledgement = null,
    acknowledgementKind,
    ackDeadline,
    scoreVote,
    completedScore;
  observeStreak(registry, now, streakEnabled);
  // References are private and scoped to source channel/stream/mark/user. Purge
  // permanently when approval/content is removed; never regenerate archived entries.
  for (const stop of lineage.stops)
    stop.marks = stop.marks.filter((item) => {
      const originHost = stop.kind === 'wander' ? (item.originHost ?? stop.from) : stop.from;
      const originStream =
        stop.kind === 'wander' ? (item.originStream ?? stop.streamId) : stop.streamId;
      const doc = marks[originHost];
      const session = doc?.sessions.find((s) => s.streamId === originStream);
      return (
        doc?.context?.optedIn &&
        !channels[originHost]?.banned &&
        !doc.blocked.includes(item.userId) &&
        !channels[originHost]?.blockedUserIds.includes(item.userId) &&
        session?.marks.some(
          (mark) =>
            mark.id === item.id &&
            mark.userId === item.userId &&
            mark.status === 'approved' &&
            mark.text === item.text,
        )
      );
    });
  const hop = registry.pendingHop;
  if (hop && !hop.finalized && !hop.cancelled) {
    const source = channels[hop.from];
    const target = channels[hop.to];
    // The raid was already verified before opening this hop. Its source may
    // subsequently close, but only this exact authoritative stream can qualify.
    // Raid-confirmation ordering remains independently stricter in send-state.
    const retired =
      !source?.online &&
      source?.streamId === null &&
      source?.retiredStream?.streamId === hop.sourceStreamId &&
      Number.isFinite(hop.raidSentAt) &&
      hop.raidSentAt >= source.retiredStream.startedAt &&
      hop.raidSentAt <= source.retiredStream.offlineAt;
    const reservedRetired =
      hop.policy === 'preclaim-v1' &&
      !hop.verified &&
      hop.intentId === registry.send?.id &&
      ['accepted', 'unknown', 'dispatching'].includes(registry.send?.status) &&
      !source?.online &&
      source?.streamId === null &&
      source?.retiredStream?.streamId === hop.sourceStreamId &&
      Number.isFinite(hop.acceptedAt) &&
      hop.acceptedAt >= source.retiredStream.startedAt &&
      hop.acceptedAt <= source.retiredStream.offlineAt;
    const sourceRetired = retired || reservedRetired;
    const valid =
      Number.isInteger(hop.threshold) &&
      hop.threshold >= 1 &&
      hop.threshold <= 10 &&
      Array.isArray(hop.offers) &&
      Array.isArray(hop.accepts) &&
      now < hop.endsAt &&
      eligible(registry, channels, marks, hop.from, hop.to, sourceRetired) &&
      (sourceRetired ? source.retiredStream.streamId : source?.streamId) === hop.sourceStreamId &&
      target?.streamId === hop.targetStreamId;
    const expiryRetired =
      retired ||
      (hop.policy === 'preclaim-v1' &&
        !hop.verified &&
        !source?.online &&
        source?.retiredStream?.streamId === hop.sourceStreamId);
    if (!valid) {
      hop.cancelled = true;
      hop.cancelReason =
        now >= hop.endsAt &&
        eligible(registry, channels, marks, hop.from, hop.to, expiryRetired) &&
        (expiryRetired ? source.retiredStream.streamId : source?.streamId) === hop.sourceStreamId &&
        target?.streamId === hop.targetStreamId
          ? 'window-ended'
          : 'policy';
      delete hop.offers;
      delete hop.accepts;
      delete hop.movedOffers;
    } else {
      const allowed = (host, id) =>
        !channels[host].blockedUserIds.includes(id) && !marks[host].blocked.includes(id);
      hop.offers = hop.offers.filter(
        (id) =>
          allowed(hop.from, id) &&
          allowed(hop.to, id) &&
          (!hop.movedOffers?.includes(id) ||
            (presence[hop.from]?.streamId === hop.sourceStreamId &&
              presence[hop.from].actors.some((a) => a.id === id))),
      );
      hop.accepts = hop.accepts.filter((id) => allowed(hop.to, id));
      if (chat?.markAction?.type === 'forgetme') {
        const side =
          chat.broadcasterId === hop.from
            ? 'offers'
            : chat.broadcasterId === hop.to
              ? 'accepts'
              : null;
        if (side) {
          hop[side] = hop[side].filter((id) => id !== chat.chatterId);
          if (hop.policy === 'preclaim-v1') {
            hop.offers = hop.offers.filter((id) => id !== chat.chatterId);
            hop.accepts = hop.accepts.filter((id) => id !== chat.chatterId);
          }
        }
      }
    }
    if (
      valid &&
      !reservedRetired &&
      chat &&
      ['offer', 'accept'].includes(chat.markAction?.type) &&
      !chat.isBot &&
      /^\d{1,32}$/.test(chat.chatterId) &&
      !channels[chat.broadcasterId]?.blockedUserIds.includes(chat.chatterId) &&
      !marks[chat.broadcasterId]?.blocked.includes(chat.chatterId) &&
      sentAt >=
        (hop.policy === 'preclaim-v1'
          ? (hop.voteStartedAt ?? hop.claimStartedAt)
          : hop.startedAt) &&
      sentAt < hop.endsAt &&
      (hop.claimClock !== 'landing-v2' ||
        sentAt >= hop.claimStartedAt ||
        (Number.isFinite(hop.acceptedAt) && sentAt < hop.acceptedAt + 180000))
    ) {
      const side = chat.markAction.type === 'offer' ? 'offers' : 'accepts';
      const other = side === 'offers' ? 'accepts' : 'offers';
      if (
        (chat.broadcasterId === (side === 'offers' ? hop.from : hop.to) ||
          (side === 'offers' &&
            chat.broadcasterId === hop.to &&
            hop.policy === 'preclaim-v1' &&
            presence[hop.from]?.streamId === hop.sourceStreamId &&
            presence[hop.from].actors.some(
              (a) => a.id === chat.chatterId && a.seenAt <= sentAt,
            ))) &&
        !hop[other].includes(chat.chatterId) &&
        !hop[side].includes(chat.chatterId) &&
        hop[side].length < (hop.policy === 'preclaim-v1' ? 10 : hop.threshold)
      ) {
        hop[side].push(chat.chatterId);
        scoreVote = chat.chatterId;
        if (side === 'offers' && chat.broadcasterId === hop.to) {
          hop.movedOffers ??= [];
          hop.movedOffers.push(chat.chatterId);
        }
        const needOffers = Math.max(0, hop.threshold - hop.offers.length),
          needAccepts = Math.max(0, hop.threshold - hop.accepts.length);
        const missing = [
          needOffers
            ? `${needOffers} ${needOffers === 1 ? 'offer' : 'offers'} in @${names[hop.from] ?? hop.from}`
            : null,
          needAccepts
            ? `${needAccepts} ${needAccepts === 1 ? 'accept' : 'accepts'} in @${names[hop.to] ?? hop.to}`
            : null,
        ].filter(Boolean);
        acknowledgement = `${side === 'offers' ? 'Offers' : 'Accepts'} ${hop[side].length}/${hop.threshold}. ${hop.verified ? '' : 'Waiting for Twitch to confirm the raid. '}${missing.length ? 'Waiting for ' + missing.join(' and ') + '.' : hop.verified ? 'Both chats reached the threshold.' : 'Both chats reached the threshold; waiting for Twitch to confirm the raid.'}`;
      }
    }
    if (
      valid &&
      (hop.policy !== 'preclaim-v1' || hop.verified === true) &&
      hop.offers.length >= hop.threshold &&
      hop.accepts.length >= hop.threshold
    ) {
      const doc = marks[hop.from];
      const session = doc.sessions.find((s) => s.streamId === hop.sourceStreamId);
      const approved = (session?.marks ?? []).filter(
        (m) =>
          m.status === 'approved' &&
          !doc.blocked.includes(m.userId) &&
          !source.blockedUserIds.includes(m.userId),
      );
      if (
        lineage.stops.length >= LINEAGE_LIMITS.stops ||
        approved.length > LINEAGE_LIMITS.marksPerStop
      ) {
        hop.cancelled = true;
        hop.capacityBlocked = true;
      } else {
        lineage.stops.push({
          stopId: hash(hop.eventId),
          eventId: hop.eventId,
          from: hop.from,
          to: hop.to,
          streamId: hop.sourceStreamId,
          claimedAt: now,
          raidSize: hop.raidSize,
          ringIndex: lineage.stops.length + 1,
          marks: approved.map(({ id, userId, text }) => ({ id, userId, text })),
        });
        completeStreak(registry, lineage.stops.at(-1), now, streakEnabled);
        if (Buffer.byteLength(JSON.stringify(lineage)) > LINEAGE_LIMITS.bytes)
          throw new Error('Lineage capacity reached');
        completedScore = scoreCompletion(hop, [...hop.offers, ...hop.accepts]);
        acknowledgement = null;
        delete registry.echo;
        registry.holderId = hop.to;
        dequeueSeeker(channels[hop.to], now);
        registry.carriedClosures = 0;
        delete registry.send;
        hop.finalized = true;
        marks[hop.from].context.holdsRelic = false;
        marks[hop.to].context.holdsRelic = true;
      }
      delete hop.offers;
      delete hop.accepts;
      delete hop.movedOffers;
    }
  }
  // Closed replies never restore votes, ownership or the old window.
  if (
    hop &&
    !hop.finalized &&
    hop.verified === true &&
    now >= hop.endsAt &&
    now < hop.endsAt + 600000 &&
    hop.cancelReason !== 'policy' &&
    chat &&
    ['offer', 'accept'].includes(chat.markAction?.type) &&
    !chat.isBot &&
    !chat.copied &&
    /^\d{1,32}$/.test(chat.chatterId) &&
    sentAt <= now &&
    sentAt >= (hop.voteStartedAt ?? hop.claimStartedAt ?? hop.startedAt)
  ) {
    const source = channels[hop.from],
      target = channels[hop.to];
    const retired =
      !source?.online &&
      source?.retiredStream?.streamId === hop.sourceStreamId &&
      hop.raidSentAt >= source.retiredStream.startedAt &&
      hop.raidSentAt <= source.retiredStream.offlineAt;
    const host = chat.broadcasterId,
      actor = chat.chatterId;
    const correctSide =
      chat.markAction.type === 'accept'
        ? host === hop.to
        : host === hop.from ||
          (host === hop.to &&
            presence[hop.from]?.streamId === hop.sourceStreamId &&
            presence[hop.from].actors.some((a) => a.id === actor && a.seenAt <= sentAt));
    const forgotten = [hop.from, hop.to].some((id) =>
      presence[id]?.revocations?.some(
        (r) => r.key === hash(JSON.stringify([id, actor])) && r.expiresAt > now,
      ),
    );
    if (
      correctSide &&
      !forgotten &&
      eligible(registry, channels, marks, hop.from, hop.to, retired) &&
      (retired ? source.retiredStream.streamId : source?.streamId) === hop.sourceStreamId &&
      target?.streamId === hop.targetStreamId &&
      [hop.from, hop.to].every(
        (id) => !channels[id].blockedUserIds.includes(actor) && !marks[id].blocked.includes(actor),
      )
    ) {
      acknowledgement =
        'The binding window has closed… The relic stays with its Keeper. Begin a new Send Off to try again.';
      acknowledgementKind = 'closed';
      ackDeadline = now;
    }
  }
  // Status only, derived from this transaction. Never invent votes or eligibility.
  const intent = registry.send;
  const source = intent?.sourceId,
    target = intent?.targetId;
  const beganAt = intent?.acceptedAt ?? intent?.dispatchAt;
  awaitingRaid = Boolean(
    !acknowledgement &&
    !hop?.offers?.includes(chat?.chatterId) &&
    chat?.markAction?.type === 'offer' &&
    !chat.isBot &&
    !chat.copied &&
    /^\d{1,32}$/.test(chat.chatterId) &&
    chat.broadcasterId === source &&
    ['accepted', 'dispatching', 'unknown'].includes(intent?.status) &&
    Number.isFinite(beganAt) &&
    now >= beganAt &&
    now < beganAt + 180000 &&
    sentAt >= beganAt &&
    sentAt <= now &&
    eligible(registry, channels, marks, source, target) &&
    channels[source]?.streamId === intent.sourceStreamId &&
    channels[target]?.streamId === intent.targetStreamId &&
    [source, target].every(
      (id) =>
        !channels[id].blockedUserIds.includes(chat.chatterId) &&
        !marks[id].blocked.includes(chat.chatterId) &&
        !marks[id].context?.blockedUserIds?.includes(chat.chatterId) &&
        !presence[id]?.revocations?.some(
          (row) => row.key === hash(JSON.stringify([id, chat.chatterId])) && row.expiresAt > now,
        ),
    ),
  );
  if (Buffer.byteLength(JSON.stringify(registry)) > 4096)
    throw new Error('Relic registry capacity reached');
  observeStreak(registry, now, streakEnabled);
  if (streakEnabled && Buffer.byteLength(JSON.stringify(registry)) > 4096)
    throw Error('Relic registry capacity reached');
  return {
    registry,
    marks,
    lineage,
    awaitingRaid,
    scoreVote,
    completedScore,
    dequeued: completedScore
      ? { id: registry.holderId, channel: channels[registry.holderId] }
      : null,
    acknowledgement,
    acknowledgementKind,
    ackDeadline: ackDeadline ?? registry.pendingHop?.endsAt,
  };
}
