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
