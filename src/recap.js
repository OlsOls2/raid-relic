import { normalizeMark, runeGeometry } from './marks.js';
const escapeXML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
export function recapProjection(lineage) {
  const stops = lineage?.stops ?? [];
  if (!Array.isArray(stops) || stops.length > 16 || Buffer.byteLength(JSON.stringify(lineage ?? {})) > 524288) throw Error('Archive capacity exceeded');
  let entries = 0; const runes = [];
  const route = stops.map((stop, i) => {
    if (!/^[a-f0-9]{64}$/.test(stop.stopId) || ![stop.from, stop.to].every(id => typeof id === 'string' && /^\d{1,32}$/.test(id))
      || stop.ringIndex !== i + 1 || !Number.isSafeInteger(stop.claimedAt) || stop.claimedAt < 0 || !Array.isArray(stop.marks) || stop.marks.length > 160) throw Error('Invalid archive');
    for (const mark of stop.marks) {
      if (typeof mark.text !== 'string' || normalizeMark(mark.text) !== mark.text || (mark.status && mark.status !== 'approved')) throw Error('Invalid approved archive');
      if (runes.length < 24) runes.push(runeGeometry(mark.text));
    }
    entries += stop.marks.length;
    return { stopId: stop.stopId, from: stop.from, to: stop.to, claimedAt: stop.claimedAt, ringIndex: stop.ringIndex, retainedEntries: stop.marks.length };
  });
  return { rings: route.length, completedStops: route.length, retainedMarkEntries: entries, route, runes, shownRunes: runes.length };
}
// All coordinates/attributes are constants or validated numbers. No supplied SVG,
// mark text, URL, scripts, foreignObject, external assets or identity associations.
export function recapSVG(view, { simulator = false } = {}) {
  if (!Array.isArray(view.route) || view.route.length > 16 || !Array.isArray(view.runes) || view.runes.length > 24) throw Error('Invalid recap');
  if (view.rings !== view.route.length || view.completedStops !== view.route.length || view.shownRunes !== view.runes.length
    || view.retainedMarkEntries !== view.route.reduce((n, stop) => n + stop.retainedEntries, 0)
    || view.shownRunes !== Math.min(24, view.retainedMarkEntries)
    || view.route.some((stop, i) => stop.ringIndex !== i + 1 || ![stop.from, stop.to].every(id => typeof id === 'string' && /^\d{1,32}$/.test(id))
      || !Number.isInteger(stop.retainedEntries) || stop.retainedEntries < 0 || stop.retainedEntries > 160)) throw Error('Invalid recap');
  const xAt = i => 85 + (i < 8 ? i : 15 - i) * 144;
  const text = (x, y, size, value, color = '#dce4ed') => `<text x="${x}" y="${y}" font-family="Georgia,serif" font-size="${size}" fill="${color}">${escapeXML(value)}</text>`;
  let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title desc"><title id="title">Raid Relic journey recap</title><desc id="desc">Completed stops and retained approved mark entries. Not unique people or personal ownership.</desc><rect width="1200" height="630" fill="#101d30"/><rect x="22" y="22" width="1156" height="586" rx="8" fill="none" stroke="#9486b7"/>';
  if (simulator) svg = svg.replace('>Raid Relic journey recap</title>', '>SIMULATOR · Raid Relic journey recap</title>');
  svg += text(52, 66, 17, simulator ? 'SIMULATOR · LOCAL MEMORY · NOT REAL TWITCH' : 'RAID RELIC · JOURNEY SNAPSHOT', '#e6bb70');
  svg += text(52, 119, 42, 'A thread of shared light');
  svg += text(52, 157, 20, `${view.completedStops} completed stops · ${view.rings} growth rings · ${view.retainedMarkEntries} retained mark entries`);
  svg += '<g transform="translate(1050 75)"><path d="M0-25 36 2 46 46 0 100-46 46-36 2Z" fill="#829bb3"/><path d="M0-25 0 100 46 46 36 2Z" fill="#9486b7"/><path d="M0 15-24 48 0 84Z" fill="#dce4ed"/><path d="M0 15 24 48 0 84Z" fill="#b5a9d4"/><path d="M0 84 24 48 0 100Z" fill="#e6bb70"/></g>';
  if (!view.route.length) svg += text(52, 265, 25, 'No completed hops yet. No journey has been invented.');
  const points = view.route.flatMap((_, i) => [...(i === 8 ? ['1162,232', '1162,344'] : []), `${xAt(i)},${232 + Math.floor(i / 8) * 112}`]);
  if (points.length) svg += `<polyline points="${points.join(' ')}" fill="none" stroke="#e6bb70" stroke-width="2"/>`;
  for (const [i, stop] of view.route.entries()) {
    const x = xAt(i), y = 232 + Math.floor(i / 8) * 112;
    svg += `<circle cx="${x}" cy="${y}" r="12" fill="#101d30" stroke="#dce4ed" stroke-width="2"/>`;
    svg += text(x - 5, y + 5, 13, stop.ringIndex, '#e6bb70');
    // Compact IDs are explicit subsets of public channel identity; full route is on page.
    svg += text(x - 32, y + 32, 13, `${simulator ? 'Sim ' : ''}${stop.from.slice(-8)}`);
    svg += text(x - 32, y + 50, 13, `→ ${stop.to.slice(-8)}`);
    svg += text(x - 32, y + 68, 12, `${stop.retainedEntries} entries`, '#b5a9d4');
  }
  svg += text(52, 451, 15, `All ${view.completedStops} retained stops shown · route labels use last 8 channel-ID digits`, '#b5a9d4');
  for (const [i, mark] of view.runes.entries()) {
    if (!['#e6bb70', '#9e87ed', '#70c9bd', '#dd93b3'].includes(mark.color) || !Array.isArray(mark.points) || mark.points.length !== 8
      || !mark.points.every(p => Array.isArray(p) && p.length === 2 && p.every(n => Number.isInteger(n) && n >= 16 && n <= 80))) throw Error('Invalid rune geometry');
    svg += `<svg x="${52 + i * 46}" y="473" width="38" height="38" viewBox="0 0 96 96"><path d="M48 6 90 48 48 90 6 48Z" fill="none" stroke="${mark.color}" stroke-width="3"/><polyline points="${mark.points.map(p => p.join(',')).join(' ')}" fill="none" stroke="${mark.color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  svg += text(52, 552, 17, `${view.shownRunes} of ${view.retainedMarkEntries} retained approved rune entries shown · not unique people`);
  svg += text(52, 582, 14, simulator ? 'SIMULATOR SNAPSHOT · template fiction only · no real raid or AI' : 'Local snapshot · removed content disappears on fresh fetch; old downloads cannot be recalled.', '#e6bb70');
  svg += '</svg>'; if (Buffer.byteLength(svg) > 65536) throw Error('Recap capacity exceeded'); return svg;
}
