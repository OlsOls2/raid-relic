import { stopStreak } from './streaks.js';
import { chronicleView } from './chronicle.js';
import { eligible } from './send-state.js';
import { runeSvg } from './marks.js';

const stopSummary = (stop) => ({
  stopId: stop.stopId,
  from: stop.from,
  to: stop.to,
  claimedAt: stop.claimedAt,
  raidSize: stop.raidSize,
  ringIndex: stop.ringIndex,
  ...stopStreak(stop),
  chronicle: chronicleView(stop),
  approvedCount: stop.marks.length,
});
export function atlasPage(lineage, { stopId, offset = 0, limit = 8 } = {}) {
  const stops = lineage?.stops ?? [];
  if (stopId) {
    const stop = stops.find((item) => item.stopId === stopId);
    if (!stop) return null;
    return {
      rings: stops.length,
      stop: stopSummary(stop),
      offset,
      total: stop.marks.length,
      nextOffset: offset + limit < stop.marks.length ? offset + limit : null,
      marks: stop.marks
        .slice(offset, offset + limit)
        .map((mark) => ({ id: mark.id, text: mark.text, runeSvg: runeSvg(mark.text) })),
    };
  }
  return {
    rings: stops.length,
    offset,
    total: stops.length,
    nextOffset: offset + limit < stops.length ? offset + limit : null,
    stops: stops.slice(offset, offset + limit).map(stopSummary),
  };
}
export function handoffView(registry, channel, now, lineage) {
  const hop = registry?.pendingHop;
  if (
    !hop ||
    (hop.policy === 'preclaim-v1' && !hop.verified) ||
    hop.cancelled ||
    now >= hop.endsAt ||
    ![hop.from, hop.to].includes(channel)
  )
    return null;
  const stop =
    hop.finalized &&
    lineage?.stops?.find(
      (s) => s.eventId === hop.eventId && s.from === hop.from && s.to === hop.to,
    );
  const sourceLogin = { 1591805230: 'raidrelichq', 1591806023: 'olsols2' }[hop.from];
  return {
    ...(sourceLogin ? { sourceLogin } : {}),
    ...(stop && Number.isFinite(stop.claimedAt) ? { completedAt: stop.claimedAt } : {}),
    role: hop.to === channel ? 'host' : 'source',
    startedAt: hop.startedAt,
    endsAt: hop.endsAt,
    ...(hop.policy === 'preclaim-v1'
      ? {
          clockPolicy: hop.claimClock === 'landing-v2' ? hop.claimClock : hop.policy,
          claimStartedAt: hop.claimStartedAt,
        }
      : {}),
    threshold: hop.threshold,
    offers: Math.min(hop.threshold, hop.offers?.length ?? hop.threshold),
    accepts: Math.min(hop.threshold, hop.accepts?.length ?? hop.threshold),
    completed: hop.finalized === true,
  };
}

export function withCarriedMarks(view, lineage, registry, host) {
  if (registry?.holderId !== host || !['ready', 'paused'].includes(view.status)) return view;
  const last = lineage?.stops?.at(-1);
  const carried =
    last?.to === host
      ? last.marks.map(({ id, text }) => ({
          id,
          runeSvg: runeSvg(text),
          flightText: text,
          ...(registry.carriedClosures === 3 ? { faded: true } : {}),
        }))
      : [];
  return { ...view, marks: [...carried, ...view.marks].slice(-160) };
}

export function withIncomingPreview(view, registry, host, channels, docs, now) {
  const hop = registry?.pendingHop;
  if (
    !hop ||
    (hop.policy === 'preclaim-v1' && !hop.verified) ||
    hop.to !== host ||
    hop.cancelled ||
    hop.finalized ||
    now >= hop.endsAt
  )
    return view;
  const source = channels[hop.from],
    target = channels[host],
    doc = docs[hop.from];
  const retired =
    !source?.online &&
    source?.streamId === null &&
    source?.retiredStream?.streamId === hop.sourceStreamId &&
    hop.raidSentAt >= source.retiredStream.startedAt &&
    hop.raidSentAt <= source.retiredStream.offlineAt;
  if (
    !eligible(registry, channels, docs, hop.from, host, retired) ||
    (retired ? source.retiredStream.streamId : source.streamId) !== hop.sourceStreamId ||
    target.streamId !== hop.targetStreamId
  )
    return view;
  const session = doc.sessions.find((item) => item.streamId === hop.sourceStreamId);
  const marks = (session?.marks ?? [])
    .filter(
      (mark) =>
        mark.status === 'approved' &&
        !doc.blocked.includes(mark.userId) &&
        !source.blockedUserIds.includes(mark.userId) &&
        !doc.context.blockedUserIds.includes(mark.userId),
    )
    .slice(-160)
    .map(({ id, text }) => ({ id, runeSvg: runeSvg(text), flightText: text }));
  return { ...view, marks };
}

// Store-owned, consistent snapshot; never a provider lookup or live authority.
export function keeperCandidates(registry, channels, docs, config, host) {
  if (!config?.channels.includes(host)) return [];
  return config.channels
    .filter((id) => eligible(registry ?? {}, channels, docs, host, id))
    .map((id) => ({
      id,
      login: Object.entries(config.logins).find(([, value]) => value === id)?.[0] ?? id,
      observedOnline: true,
      optedIn: true,
      eligible: true,
    }));
}

// Only the bounded completed public archive is searched; no identity lookup.
export function atlasSearch(lineage, { query, offset = 0, limit = 20 }) {
  if (
    !query ||
    !Number.isInteger(offset) ||
    offset < 0 ||
    offset > 2560 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 20
  )
    throw new Error('Invalid search');
  const stops = lineage?.stops ?? [];
  if (stops.length > 16 || stops.some((stop) => stop.marks.length > 160))
    throw new Error('Archive capacity exceeded');
  const matches = [];
  for (const stop of stops)
    for (const mark of stop.marks) if (mark.text.includes(query)) matches.push({ stop, mark });
  return {
    total: matches.length,
    offset,
    nextOffset: offset + limit < matches.length ? offset + limit : null,
    matches: matches.slice(offset, offset + limit).map(({ stop, mark }) => ({
      stopId: stop.stopId,
      from: stop.from,
      to: stop.to,
      claimedAt: stop.claimedAt,
      ringIndex: stop.ringIndex,
      text: mark.text,
      runeSvg: runeSvg(mark.text),
    })),
  };
}

export function claimMeterView(registry, host, now) {
  const hop = registry?.pendingHop;
  if (
    !hop ||
    ![hop.from, hop.to].includes(host) ||
    hop.cancelled ||
    hop.finalized ||
    now >= hop.endsAt
  )
    return null;
  return {
    ...(['accepted-v1', 'landing-v2'].includes(hop.claimClock)
      ? { clockPolicy: hop.claimClock }
      : {}),
    startedAt: hop.claimStartedAt ?? hop.startedAt,
    endsAt: hop.endsAt,
    offers: Math.min(10, hop.offers?.length ?? 0),
    accepts: Math.min(10, hop.accepts?.length ?? 0),
    threshold: hop.threshold,
    provisional: hop.policy === 'preclaim-v1' && !hop.verified,
    awaitingRaid: hop.policy === 'preclaim-v1' && !hop.verified,
  };
}

// Current holder identity is public channel identity, never a viewer lookup.
export function movedToView(registry, lineage, host, channel) {
  const stop = lineage?.stops?.at(-1);
  return channel?.optedIn === true &&
    !channel.paused &&
    !channel.banned &&
    stop?.from === host &&
    stop.to === registry?.holderId &&
    stop.to !== host
    ? { 1591805230: 'raidrelichq', 1591806023: 'olsols2' }[stop.to]
    : undefined;
}

// Configured Keeper display only, taken from the registry rather than readiness.
export function holderLoginView(registry) {
  const names = { 1591805230: 'raidrelichq', 1591806023: 'olsols2' };
  return Object.hasOwn(names, registry?.holderId) ? names[registry.holderId] : undefined;
}
