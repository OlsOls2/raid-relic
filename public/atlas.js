import { keeperNames } from './keeper-network.js';
const keeperName = (id) => (keeperNames[id] ? '@' + keeperNames[id] : 'Unknown Keeper');
import { publicDate as utcDate } from './streak-view.js';
import { createAtlasHero, atlasRings } from './atlas-hero.js';
const $ = (id) => document.getElementById(id);
const ledgerDetails = $('ledger-details'),
  ledgerWidth = matchMedia('(max-width: 599px)');
const fitLedger = () => {
  if (ledgerDetails) ledgerDetails.open = !ledgerWidth.matches;
};
fitLedger();
ledgerWidth.addEventListener('change', fitLedger);
const hero = createAtlasHero({ archive: $('atlas-relic') });
const liveSection = document.createElement('section');
liveSection.id = 'atlas-current-live';
liveSection.hidden = true;
(ledgerDetails ?? $('journey')).before(liveSection);
const stopId = /^\/stops\/([a-f0-9]{64})$/.exec(location.pathname)?.[1];
let offset = 0;
let next = null;
let generation = 0;
let controller;
const node = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
};
// Optional captions must never prevent the independently valid mark gallery.
function chronicleCaption(value) {
  const fallback =
    'Fiction · template: Beneath quiet stars, the relic gathered another ring of shared light.';
  if (
    !value ||
    typeof value !== 'object' ||
    !['template', 'model'].includes(value.source) ||
    value.fiction !== true ||
    typeof value.line !== 'string' ||
    value.line.length > 320 ||
    !value.line.trim() ||
    [...value.line].length > 160 ||
    /[\p{Cc}\p{Cf}]/u.test(value.line)
  )
    return fallback;
  return `Fiction · ${value.source}: ${value.line}`;
}
function clear() {
  liveSection.replaceChildren();
  liveSection.hidden = true;
  hero.clear();
  $('status').classList.remove('empty-state');
  $('journey').replaceChildren();
  $('marks').replaceChildren();
  $('rings').textContent = 'No current state';
  $('next').hidden = true;
}
async function load() {
  const current = ++generation;
  controller?.abort();
  controller = new AbortController();
  const activeController = controller;
  // Clear immediately: no cache or old page may retain purged public content.
  clear();
  $('status').textContent = 'Reading the archive…';
  $('refresh').disabled = true;
  const timer = setTimeout(() => activeController.abort(), 8000);
  try {
    const response = await fetch(
      `/api/atlas${stopId ? `/stops/${stopId}` : ''}?offset=${offset}&limit=${stopId ? 20 : 8}`,
      { cache: 'no-store', signal: activeController.signal },
    );
    if (!response.ok) throw new Error('Unavailable');
    const data = await response.json();
    if (current !== generation) return;
    if (atlasRings(data.rings) === null) throw Error('Invalid rings');
    hero.update(data.rings);
    if (!stopId && data.current) {
      const live = data.current;
      if (
        !Object.values(keeperNames).includes(live.login) ||
        live.ringCount !== data.rings ||
        !Array.isArray(live.marks) ||
        live.marks.length > 160 ||
        live.approvedCount !== live.marks.length
      )
        throw Error('Invalid live marks');
      liveSection.append(
        node('h2', `Retained hold · Ring ${live.ringCount} · @${live.login}`),
        node(
          'p',
          `${live.approvedCount} retained approved marks. Includes approved marks made during this hold; arrival snapshots are not rewritten.`,
        ),
      );
      const list = node('ul');
      for (const mark of live.marks) {
        if (
          typeof mark.text !== 'string' ||
          mark.text.length > 128 ||
          typeof mark.runeSvg !== 'string' ||
          mark.runeSvg.length > 4096 ||
          !mark.runeSvg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')
        )
          throw Error('Invalid live glyph');
        const image = node('img');
        image.src = `data:image/svg+xml,${encodeURIComponent(mark.runeSvg)}`;
        image.width = image.height = 48;
        image.alt = 'Retained approved rune: ' + mark.text;
        const item = node('li');
        item.append(image, node('span', mark.text));
        list.append(item);
      }
      liveSection.append(list);
      liveSection.hidden = false;
    }
    $('simulator').textContent = data.mode === 'simulator' ? 'SIMULATOR · local test journey' : '';
    $('simulator').hidden = data.mode !== 'simulator';
    if (data.pilotEnabled)
      document.querySelector('.note').textContent =
        'Raid stops require verified arrivals and two-chat binding. Dotted Wander stops are idle transfers, not raids.';
    $('rings').textContent =
      `${data.rings ? data.rings + ' completed growth rings' : 'First journey begins'}${data.wanderStops ? ' · ' + data.wanderStops + ' Wandered (no raid) · ' + (data.rings - data.wanderStops) + ' raid/legacy stops' : ''}`;
    $('status').textContent = data.total
      ? `Showing ${offset + 1}–${Math.min(offset + (stopId ? data.marks.length : data.stops.length), data.total)} of ${data.total}`
      : stopId
        ? 'No approved marks retained at this stop.'
        : 'First journey begins with a completed two-chat claim. No completed hops yet.';
    if (stopId) {
      $('title').textContent = `Stop ${data.stop.ringIndex}`;
      $('description').textContent =
        `${keeperName(data.stop.from)} to ${keeperName(data.stop.to)}. ${data.stop.kind === 'wander' ? 'Wandered at' : 'Claimed'} ${utcDate(data.stop.claimedAt)}. ${data.stop.kind === 'wander' ? 'Wandered — no raid or audience transfer.' : data.stop.raidSize + ' reported raid viewers.'}`;
      $('detail').hidden = false;
      $('journey').append(node('p', chronicleCaption(data.stop.chronicle)));
      for (const mark of data.marks) {
        const item = node('li');
        const img = node('img');
        img.alt = 'Original approved rune';
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mark.runeSvg)}`;
        item.append(img, node('span', mark.text));
        $('marks').append(item);
      }
    } else
      for (const stop of data.stops) {
        const item = node('li', undefined, 'stop');
        const link = node('a', 'Open this stop');
        link.href = `/stops/${stop.stopId}`;
        item.append(
          node('h2', `${stop.kind === 'wander' ? 'Wandered · ' : ''}Ring ${stop.ringIndex}`),
          node('p', chronicleCaption(stop.chronicle)),
          node('p', `${keeperName(stop.from)} to ${keeperName(stop.to)}`),
          node('p', utcDate(stop.claimedAt)),
          node(
            'p',
            stop.kind === 'wander'
              ? 'Wandered — no raid or audience transfer'
              : Number.isInteger(stop.raidSize) && stop.raidSize >= 0
                ? `${stop.raidSize} Twitch-reported raiders`
                : 'Raid audience not recorded',
          ),
          ...(stop.approvedCount
            ? [node('p', `${stop.approvedCount} approved marks retained`)]
            : []),
          link,
        );
        $('journey').append(item);
      }
    $('status').classList.toggle('empty-state', data.total === 0);
    next = data.nextOffset;
    $('next').hidden = next === null;
  } catch {
    if (current !== generation) return;
    clear();
    $('status').textContent = 'Archive unavailable. Previous content hidden. Refresh to try again.';
  } finally {
    clearTimeout(timer);
    if (current === generation) $('refresh').disabled = false;
  }
}
$('refresh').onclick = () => {
  clearSearch();
  $('search-status').textContent = 'Previous matches cleared. Submit a fresh shared-text search.';
  offset = 0;
  load();
};
$('next').onclick = () => {
  if (next !== null) {
    offset = next;
    load();
  }
};
// No polling. Hide old content when leaving; a restored page must read anew.
addEventListener('pagehide', () => {
  ledgerWidth.removeEventListener('change', fitLedger);
  generation++;
  controller?.abort();
  clear();
});
addEventListener('pageshow', (event) => {
  if (event.persisted) {
    ledgerWidth.addEventListener('change', fitLedger);
    fitLedger();
    load();
  }
});
load();

// Transient query only, sent in a POST body; no URL/history/storage/polling.
let searchGeneration = 0,
  searchController,
  searchNext = null;
function clearSearch(eraseInput = false) {
  searchGeneration++;
  searchController?.abort();
  $('search-matches').replaceChildren();
  searchNext = null;
  $('search-next').hidden = true;
  if (eraseInput) $('search-query').value = '';
}
async function search(searchOffset = 0) {
  const query = $('search-query').value;
  clearSearch();
  const current = searchGeneration;
  if (!query) {
    $('search-status').textContent = 'Enter one word or emoji to search shared approved text.';
    return;
  }
  const active = new AbortController();
  searchController = active;
  const timer = setTimeout(() => active.abort(), 8000);
  $('search-status').textContent = 'Searching completed stops…';
  try {
    const response = await fetch('/api/atlas/search', {
      method: 'POST',
      cache: 'no-store',
      signal: active.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, offset: searchOffset, limit: 20 }),
    });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (current !== searchGeneration) return;
    $('simulator').textContent = data.mode === 'simulator' ? 'SIMULATOR · local test journey' : '';
    $('simulator').hidden = data.mode !== 'simulator';
    $('search-status').textContent = data.matches.length
      ? `Shared text matches ${searchOffset + 1}–${searchOffset + data.matches.length} of ${data.total}. Not proof of personal ownership.`
      : data.total
        ? 'No further shared-text matches on this page.'
        : 'No approved shared-text matches at completed stops.';
    for (const match of data.matches) {
      const item = node('li');
      const image = node('img');
      image.alt = 'Approved shared mark rune';
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(match.runeSvg)}`;
      const link = node('a', `Ring ${match.ringIndex}: channel ${match.from} to ${match.to}`);
      link.href = `/stops/${match.stopId}`;
      item.append(image, node('span', match.text), node('span', utcDate(match.claimedAt)), link);
      $('search-matches').append(item);
    }
    searchNext = data.nextOffset;
    $('search-next').hidden = searchNext === null;
  } catch {
    if (current !== searchGeneration) return;
    $('search-matches').replaceChildren();
    $('search-status').textContent =
      'Search unavailable or invalid. Previous matches hidden; use one word or emoji and try again.';
  } finally {
    clearTimeout(timer);
  }
}
$('mark-search').onsubmit = (event) => {
  event.preventDefault();
  search();
};
$('search-clear').onclick = () => {
  clearSearch(true);
  $('search-status').textContent = 'Search cleared. Enter shared mark text to search.';
  $('search-query').focus();
};
$('search-query').oninput = () => {
  clearSearch();
  $('search-status').textContent = 'Submit to search shared approved text.';
};
$('search-next').onclick = () => {
  if (searchNext !== null) search(searchNext);
};
addEventListener('pagehide', () => clearSearch(true));
addEventListener('pageshow', (event) => {
  if (event.persisted) {
    clearSearch(true);
    $('search-status').textContent = 'Enter shared mark text to search.';
  }
});

// Enable only after preventDefault is installed; no GET form fallback.
$('search-query').disabled = false;
$('search-submit').disabled = false;
