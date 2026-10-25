import { hash } from './crypto.js';
import { runeSvg } from './marks.js';
import { eligible } from './send-state.js';

export const LINEAGE_LIMITS = Object.freeze({ stops: 16, marksPerStop: 160, bytes: 524288 });
export const emptyLineage = () => ({ stops: [] });
export function publicJourney(lineage) {
  return { rings: lineage?.stops?.length ?? 0, stops: (lineage?.stops ?? []).map(stop => ({
    stopId: stop.stopId, from: stop.from, to: stop.to, claimedAt: stop.claimedAt, raidSize: stop.raidSize,
    ringIndex: stop.ringIndex, marks: stop.marks.map(mark => ({ id: mark.id, text: mark.text, runeSvg: runeSvg(mark.text) })),
  })) };
}
// All inputs are store-owned snapshots. No effects; caller commits every result together.
export function reduceClaims(registry, channels, marks, previous, chat, now, sentAt = now, presence = {}) {
  registry = structuredClone(registry); marks = structuredClone(marks); const lineage = structuredClone(previous ?? emptyLineage()); let acknowledgement = null;
  // References are private and scoped to source channel/stream/mark/user. Purge
  // permanently when approval/content is removed; never regenerate archived entries.
  for (const stop of lineage.stops) stop.marks = stop.marks.filter(item => {
    const doc = marks[stop.from]; const session = doc?.sessions.find(s => s.streamId === stop.streamId);
    return doc?.context?.optedIn && !channels[stop.from]?.banned
      && !doc.blocked.includes(item.userId) && !channels[stop.from]?.blockedUserIds.includes(item.userId)
      && session?.marks.some(mark => mark.id === item.id && mark.userId === item.userId && mark.status === 'approved' && mark.text === item.text);
  });
  const hop = registry.pendingHop;
  if (hop && !hop.finalized && !hop.cancelled) {
    const source = channels[hop.from]; const target = channels[hop.to];
    // The raid was already verified before opening this hop. Its source may
    // subsequently close, but only this exact authoritative stream can qualify.
    // Raid-confirmation ordering remains independently stricter in send-state.
    const retired = !source?.online && source?.streamId === null
      && source?.retiredStream?.streamId === hop.sourceStreamId
      && Number.isFinite(hop.raidSentAt) && hop.raidSentAt >= source.retiredStream.startedAt
      && hop.raidSentAt <= source.retiredStream.offlineAt;
    const valid = Number.isInteger(hop.threshold) && hop.threshold >= 1 && hop.threshold <= 10
      && Array.isArray(hop.offers) && Array.isArray(hop.accepts) && now < hop.endsAt && eligible(registry, channels, marks, hop.from, hop.to, retired)
      && (retired ? source.retiredStream.streamId : source?.streamId) === hop.sourceStreamId
      && target?.streamId === hop.targetStreamId;
    if (!valid && !(hop.policy === 'preclaim-v1' && !hop.verified && now < hop.endsAt && !source?.online && source?.retiredStream?.streamId === hop.sourceStreamId && target?.streamId === hop.targetStreamId && eligible(registry, channels, marks, hop.from, hop.to, true))) { hop.cancelled = true; delete hop.offers; delete hop.accepts; delete hop.movedOffers; }
    else {
      const allowed = (host, id) => !channels[host].blockedUserIds.includes(id) && !marks[host].blocked.includes(id);
      hop.offers = hop.offers.filter(id => allowed(hop.from, id) && allowed(hop.to, id) && (!hop.movedOffers?.includes(id) || (presence[hop.from]?.streamId === hop.sourceStreamId && presence[hop.from].actors.some(a => a.id === id))));
      hop.accepts = hop.accepts.filter(id => allowed(hop.to, id));
      if (chat?.markAction?.type === 'forgetme') {
        const side = chat.broadcasterId === hop.from ? 'offers' : chat.broadcasterId === hop.to ? 'accepts' : null;
        if (side) { hop[side] = hop[side].filter(id => id !== chat.chatterId); if (hop.policy === 'preclaim-v1') { hop.offers = hop.offers.filter(id => id !== chat.chatterId); hop.accepts = hop.accepts.filter(id => id !== chat.chatterId); } }
      }
    }
    if (valid && chat && ['offer', 'accept'].includes(chat.markAction?.type) && !chat.isBot
      && /^\d{1,32}$/.test(chat.chatterId)
      && !channels[chat.broadcasterId]?.blockedUserIds.includes(chat.chatterId)
      && !marks[chat.broadcasterId]?.blocked.includes(chat.chatterId) && sentAt >= (hop.policy === 'preclaim-v1' ? hop.claimStartedAt : hop.startedAt) && sentAt < hop.endsAt) {
      const side = chat.markAction.type === 'offer' ? 'offers' : 'accepts';
      const other = side === 'offers' ? 'accepts' : 'offers';
      if ((chat.broadcasterId === (side === 'offers' ? hop.from : hop.to) || (side === 'offers' && chat.broadcasterId === hop.to && hop.policy === 'preclaim-v1' && presence[hop.from]?.streamId === hop.sourceStreamId && presence[hop.from].actors.some(a => a.id === chat.chatterId && a.seenAt <= sentAt)))
        && !hop[other].includes(chat.chatterId) && !hop[side].includes(chat.chatterId)
        && hop[side].length < (hop.policy === 'preclaim-v1' ? 10 : hop.threshold)) {
        hop[side].push(chat.chatterId);
        if (side === 'offers' && chat.broadcasterId === hop.to) { hop.movedOffers ??= []; hop.movedOffers.push(chat.chatterId); }
        acknowledgement = `${hop.policy === 'preclaim-v1' && !hop.verified ? 'Provisional ' : ''}${side === 'offers' ? 'Offers' : 'Accepts'} ${hop[side].length}/${hop.threshold}. Both chats required within the app-local claim window; verified raid required.`;
      }
    }
      if (valid && (hop.policy !== 'preclaim-v1' || hop.verified === true) && hop.offers.length >= hop.threshold && hop.accepts.length >= hop.threshold) {
        const doc = marks[hop.from]; const session = doc.sessions.find(s => s.streamId === hop.sourceStreamId);
        const approved = (session?.marks ?? []).filter(m => m.status === 'approved' && !doc.blocked.includes(m.userId)
          && !source.blockedUserIds.includes(m.userId));
        if (lineage.stops.length >= LINEAGE_LIMITS.stops || approved.length > LINEAGE_LIMITS.marksPerStop) {
          hop.cancelled = true; hop.capacityBlocked = true;
        } else {
          lineage.stops.push({ stopId: hash(hop.eventId), eventId: hop.eventId, from: hop.from, to: hop.to,
            streamId: hop.sourceStreamId, claimedAt: now, raidSize: hop.raidSize, ringIndex: lineage.stops.length + 1,
            marks: approved.map(({ id, userId, text }) => ({ id, userId, text })) });
          if (Buffer.byteLength(JSON.stringify(lineage)) > LINEAGE_LIMITS.bytes) throw new Error('Lineage capacity reached');
          acknowledgement = 'Claim complete: both chats reached the threshold. Relic transferred; one growth ring recorded.';
          delete registry.echo; registry.holderId = hop.to; registry.carriedClosures = 0; delete registry.send; hop.finalized = true;
          marks[hop.from].context.holdsRelic = false; marks[hop.to].context.holdsRelic = true;
        }
        delete hop.offers; delete hop.accepts; delete hop.movedOffers;
      }
  }
  if (Buffer.byteLength(JSON.stringify(registry)) > 4096) throw new Error('Relic registry capacity reached');
  return { registry, marks, lineage, acknowledgement, ackDeadline: registry.pendingHop?.endsAt };
}
