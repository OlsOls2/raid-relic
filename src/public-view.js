import { eligible } from './send-state.js';
import { runeSvg } from './marks.js';

const stopSummary = stop => ({ stopId: stop.stopId, from: stop.from, to: stop.to, claimedAt: stop.claimedAt,
  raidSize: stop.raidSize, ringIndex: stop.ringIndex, approvedCount: stop.marks.length });
export function atlasPage(lineage, { stopId, offset = 0, limit = 8 } = {}) {
  const stops = lineage?.stops ?? [];
  if (stopId) {
    const stop = stops.find(item => item.stopId === stopId);
    if (!stop) return null;
    return { rings: stops.length, stop: stopSummary(stop), offset, total: stop.marks.length,
      nextOffset: offset + limit < stop.marks.length ? offset + limit : null,
      marks: stop.marks.slice(offset, offset + limit).map(mark => ({ id: mark.id, text: mark.text, runeSvg: runeSvg(mark.text) })) };
  }
  return { rings: stops.length, offset, total: stops.length, nextOffset: offset + limit < stops.length ? offset + limit : null,
    stops: stops.slice(offset, offset + limit).map(stopSummary) };
}
export function handoffView(registry, channel, now) {
  const hop = registry?.pendingHop;
  if (!hop || hop.cancelled || now >= hop.endsAt || ![hop.from, hop.to].includes(channel)) return null;
  return { role: hop.to === channel ? 'host' : 'source', startedAt: hop.startedAt, endsAt: hop.endsAt,
    threshold: hop.threshold, offers: hop.offers?.length ?? hop.threshold, accepts: hop.accepts?.length ?? hop.threshold,
    completed: hop.finalized === true };
}

export function withCarriedMarks(view, lineage, registry, host) {
  if (registry?.holderId !== host || !['ready', 'paused'].includes(view.status)) return view;
  const last = lineage?.stops?.at(-1);
  const carried = last?.to === host ? last.marks.map(({ id, text }) => ({ id, runeSvg: runeSvg(text) })) : [];
  return { ...view, marks: [...carried, ...view.marks].slice(-160) };
}

export function withIncomingPreview(view, registry, host, channels, docs, now) {
  const hop = registry?.pendingHop;
  if (!hop || hop.to !== host || hop.cancelled || hop.finalized || now >= hop.endsAt) return view;
  const source = channels[hop.from], target = channels[host], doc = docs[hop.from];
  const retired = !source?.online && source?.streamId === null && source?.retiredStream?.streamId === hop.sourceStreamId
    && hop.raidSentAt >= source.retiredStream.startedAt && hop.raidSentAt <= source.retiredStream.offlineAt;
  if (!eligible(registry, channels, docs, hop.from, host, retired)
    || (retired ? source.retiredStream.streamId : source.streamId) !== hop.sourceStreamId || target.streamId !== hop.targetStreamId) return view;
  const session = doc.sessions.find(item => item.streamId === hop.sourceStreamId);
  const marks = (session?.marks ?? []).filter(mark => mark.status === 'approved' && !doc.blocked.includes(mark.userId)
    && !source.blockedUserIds.includes(mark.userId) && !doc.context.blockedUserIds.includes(mark.userId)).slice(-160)
    .map(({ id, text }) => ({ id, runeSvg: runeSvg(text) }));
  return { ...view, marks };
}

// Store-owned, consistent snapshot; never a provider lookup or live authority.
export function keeperCandidates(registry, channels, docs, config, host) {
  if (!config?.channels.includes(host)) return [];
  return config.channels.filter(id => eligible(registry ?? {}, channels, docs, host, id)).map(id => ({
    id, login: Object.entries(config.logins).find(([, value]) => value === id)?.[0] ?? id,
    observedOnline: true, optedIn: true, eligible: true,
  }));
}

// Only the bounded completed public archive is searched; no identity lookup.
export function atlasSearch(lineage, { query, offset = 0, limit = 20 }) {
  if (!query || !Number.isInteger(offset) || offset < 0 || offset > 2560 || !Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('Invalid search');
  const stops = lineage?.stops ?? [];
  if (stops.length > 16 || stops.some(stop => stop.marks.length > 160)) throw new Error('Archive capacity exceeded');
  const matches = [];
  for (const stop of stops) for (const mark of stop.marks) if (mark.text.includes(query)) matches.push({ stop, mark });
  return { total: matches.length, offset, nextOffset: offset + limit < matches.length ? offset + limit : null,
    matches: matches.slice(offset, offset + limit).map(({ stop, mark }) => ({ stopId: stop.stopId, from: stop.from, to: stop.to,
      claimedAt: stop.claimedAt, ringIndex: stop.ringIndex, text: mark.text, runeSvg: runeSvg(mark.text) })) };
}
