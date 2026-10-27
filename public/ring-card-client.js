import { keeperNames } from './keeper-network.js';
import {
  ringCardModel,
  ringCardPNG,
  saveRingCard,
  ringCardFilename,
  approvedCardWord,
} from './ring-card.js';
// Atlas only. Fresh exact-stop read before each manual export; no cache or writes.
export async function downloadStopCard(h, keeper, { signal, current = () => true } = {}) {
  const own = new AbortController(),
    abort = () => own.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) own.abort();
  const timer = setTimeout(abort, 8000);
  try {
    if (!current()) throw Error('Stale stop');
    const read = boundedCardRead(own.signal);
    const snapshot = await freshShareSnapshot(h.stopId, read);
    const v = snapshot.exact,
      s = v.stop;
    if (
      ['stopId', 'from', 'to', 'claimedAt', 'ringIndex', 'raidSize', 'kind'].some(
        (k) => s[k] !== h[k],
      ) ||
      keeper !== '@' + keeperNames[s.to] ||
      !current()
    )
      throw Error('Changed stop');
    const model = ringCardModel(
      { stopId: s.stopId, keeper, ringIndex: s.ringIndex, claimedAt: s.claimedAt },
      { mode: v.mode, share: snapshot.share, ...(s.kind === 'wander' ? { kind: 'wander' } : {}) },
    );
    const blob = await ringCardPNG(model);
    await assertFreshShare(snapshot, h.stopId, read);
    if (own.signal.aborted || !current()) throw Error('Stale stop');
    saveRingCard(
      blob,
      model.simulated,
      s.kind === 'wander'
        ? 'raid-relic-wander-stop-' + s.ringIndex + '-' + model.keeper.slice(1) + '.png'
        : ringCardFilename(s.ringIndex, model.keeper),
    );
    return true;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function boundedCardRead(signal) {
  return async (path) => {
    const r = await fetch(path, { signal, cache: 'no-store', credentials: 'omit' });
    if (!r.ok) throw Error('Card data unavailable');
    const raw = await r.text();
    if (raw.length > 131072 || signal.aborted) throw Error('Bounded card response');
    return JSON.parse(raw);
  };
}
export async function freshShareSnapshot(stopId, read) {
  if (!/^[a-f0-9]{64}$/.test(stopId)) throw Error('Card stop');
  const exact = await read('/api/atlas/stops/' + stopId);
  const marks = [];
  // The exact-stop API exposes approved marks at the top level, in pages of
  // at most 20. Read the complete bounded projection, never a private stop DTO.
  if (!Number.isInteger(exact.total) || exact.total < 0 || exact.total > 160)
    throw Error('Share mark count');
  let page = exact;
  for (let pages = 0; ; pages++) {
    if (
      pages >= 8 ||
      page.mode !== exact.mode ||
      JSON.stringify(page.stop) !== JSON.stringify(exact.stop) ||
      page.total !== exact.total ||
      page.offset !== marks.length ||
      !Array.isArray(page.marks) ||
      page.marks.length > 20 ||
      marks.length + page.marks.length > exact.total
    )
      throw Error('Share mark page');
    marks.push(...page.marks);
    if (page.nextOffset === null) {
      if (marks.length !== exact.total) throw Error('Incomplete share marks');
      break;
    }
    if (page.marks.length === 0 || page.nextOffset !== marks.length)
      throw Error('Share mark cursor');
    page = await read('/api/atlas/stops/' + stopId + '?offset=' + marks.length + '&limit=20');
  }
  const recap = await read('/api/recap');
  const receiving = await read('/api/receiving');
  if (
    !['live', 'simulator'].includes(exact.mode) ||
    recap.mode !== exact.mode ||
    receiving.mode !== exact.mode ||
    !exact.stop ||
    exact.stop.approvedCount !== exact.total ||
    !Array.isArray(recap.route) ||
    recap.route.length < 1 ||
    recap.route.length > 16 ||
    recap.rings !== recap.route.length ||
    recap.completedStops !== recap.rings
  )
    throw Error('Share snapshot');
  if (
    recap.route.some((stop) => stop.kind !== undefined && stop.kind !== 'wander') ||
    (exact.stop.kind !== undefined && exact.stop.kind !== 'wander')
  )
    throw Error('Unknown journey kind');
  const route = recap.route.map((stop) => ({
    stopId: stop.stopId,
    from: '@' + keeperNames[stop.from],
    to: '@' + keeperNames[stop.to],
    ringIndex: stop.ringIndex,
    claimedAt: stop.claimedAt,
    kind: stop.kind === 'wander' ? 'wander' : 'raid',
  }));
  const own = recap.route.find((s) => s.stopId === stopId);
  if (
    !own ||
    ['from', 'to', 'ringIndex', 'claimedAt', 'kind'].some((key) => own[key] !== exact.stop[key]) ||
    own.retainedEntries !== exact.total
  )
    throw Error('Inconsistent stop');
  const holder = receiving.holder;
  if (
    holder !== null &&
    (!holder ||
      holder.ringCount !== recap.rings ||
      holder.login !== keeperNames[recap.route.at(-1).to] ||
      (holder.heldSince !== null && holder.heldSince !== recap.route.at(-1).claimedAt))
  )
    throw Error('Inconsistent holder');
  if (marks.some((mark) => mark.status !== undefined && mark.status !== 'approved'))
    throw Error('Non-public engraving');
  const all = marks.map((mark) => mark.text);
  const share = {
    holder: holder === null ? null : '@' + holder.login,
    hops: route.length,
    route,
    engravings: all.slice(0, 8),
    totalEngravings: all.length,
  };
  // Validate every public entry, not just the pictured selection; raw SVG/IDs
  // never enter the canvas model or its privacy comparison.
  if (!all.every(approvedCardWord)) throw Error('Invalid approved engraving');
  ringCardModel(
    {
      stopId,
      keeper: '@' + keeperNames[exact.stop.to],
      ringIndex: exact.stop.ringIndex,
      claimedAt: exact.stop.claimedAt,
    },
    { mode: exact.mode, share, ...(exact.stop.kind === 'wander' ? { kind: 'wander' } : {}) },
  );
  return {
    exact,
    share,
    fingerprint: JSON.stringify({
      mode: exact.mode,
      stop: {
        stopId,
        from: exact.stop.from,
        to: exact.stop.to,
        ringIndex: exact.stop.ringIndex,
        claimedAt: exact.stop.claimedAt,
        raidSize: exact.stop.raidSize,
        kind: exact.stop.kind,
        words: all,
      },
      route: recap.route,
      holder,
    }),
  };
}
export async function assertFreshShare(snapshot, stopId, read) {
  const latest = await freshShareSnapshot(stopId, read);
  if (latest.fingerprint !== snapshot.fingerprint) throw Error('Share snapshot changed; retry');
}
