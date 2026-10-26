import { validStreak, streakText } from './streak-view.js';
import { EDITION_CONFIG, editionWindowLabel } from './editions.js';
const $ = (id) => document.getElementById(id);
let generation = 0,
  controller;
const badgeNames = new Set([
  ...EDITION_CONFIG.map((e) => e.badgeLabel),
  'First Keeper',
  '24h Keeper',
  'Ring 1',
  'Ring 5',
  'Ring 10',
  'Chain of 3',
  'Carried during TwitchCon San Diego 2026',
  'Unbroken streak · 3 hand-offs',
]);
export function validScores(v) {
  try {
    return (
      v &&
      Number.isSafeInteger(v.asOf) &&
      v.asOf >= 0 &&
      Number.isInteger(v.rings) &&
      v.rings >= 0 &&
      v.rings <= 16 &&
      Object.keys(v)
        .filter((k) => !['streak', 'wanderStops'].includes(k))
        .sort()
        .join(',') === 'asOf,channels,coverage,event,mode,previewReadOnly,raiders,rings' &&
      (v.wanderStops === undefined ||
        (Number.isInteger(v.wanderStops) && v.wanderStops >= 1 && v.wanderStops <= v.rings)) &&
      (v.streak === undefined ||
        (validStreak(v.streak) && (!v.streak.known || v.streak.since <= v.asOf))) &&
      ['live', 'simulator'].includes(v.mode) &&
      typeof v.previewReadOnly === 'boolean' &&
      typeof v.coverage === 'string' &&
      v.coverage.length <= 500 &&
      v.event &&
      Object.keys(v.event).sort().join(',') === 'checked,endsAt,label,source,startsAt' &&
      v.event.label === 'TwitchCon San Diego 2026' &&
      v.event.source === 'https://www.twitchcon.com/san-diego-2026/' &&
      v.event.checked === '2026-10-25' &&
      v.event.startsAt === Date.parse('2026-11-13T08:00:00Z') &&
      v.event.endsAt === Date.parse('2026-11-16T08:00:00Z') &&
      Array.isArray(v.channels) &&
      v.channels.length <= 4 &&
      v.channels.every(
        (r) =>
          Object.keys(r).sort().join(',') ===
            'badges,channelId,hopsCarried,knownHoldSeconds,login' &&
          /^\d{1,32}$/.test(r.channelId) &&
          (r.login === null ||
            (typeof r.login === 'string' && /^[a-z0-9_]{1,25}$/.test(r.login))) &&
          Number.isInteger(r.knownHoldSeconds) &&
          r.knownHoldSeconds >= 0 &&
          Number.isInteger(r.hopsCarried) &&
          r.hopsCarried >= 0 &&
          r.hopsCarried <= 16 &&
          Array.isArray(r.badges) &&
          r.badges.length <= 8 + EDITION_CONFIG.length &&
          r.badges.every((b) => badgeNames.has(b)),
      ) &&
      Array.isArray(v.raiders) &&
      v.raiders.length <= 20 &&
      v.raiders.every(
        (r) =>
          Object.keys(r).sort().join(',') === 'claimsJoined,login,since' &&
          typeof r.login === 'string' &&
          /^[a-z0-9_]{1,25}$/.test(r.login) &&
          Number.isInteger(r.claimsJoined) &&
          r.claimsJoined >= 0 &&
          r.claimsJoined <= 16 &&
          Number.isSafeInteger(r.since) &&
          r.since <= v.asOf,
      )
    );
  } catch {
    return false;
  }
}
export function holdDuration(seconds) {
  let remaining = seconds;
  const parts = [];
  for (const [unit, size] of [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ]) {
    const count = Math.floor(remaining / size);
    remaining %= size;
    if (count) parts.push(`${count}${unit}`);
  }
  return parts.join(' ') || '0s';
}
export const EVENT_BADGE = 'Carried during TwitchCon San Diego 2026';
export function badgeDescription(name) {
  if (name === 'Unbroken streak · 3 hand-offs')
    return 'Received the relic after three consecutive tracked successful bindings, without a known verified-window lapse or Wander transfer. Earlier hand-offs are not tracked.';
  const edition = EDITION_CONFIG.find((e) => e.badgeLabel === name);
  if (edition)
    return (
      'Recorded carrying during the cosmetic ' +
      edition.name +
      ' edition, ' +
      editionWindowLabel(edition) +
      '. This does not prove conference attendance.'
    );
  const meanings = {
    'First Keeper': 'The first Keeper of this recorded journey.',
    '24h Keeper': 'Held the relic for at least 24 hours of recorded time.',
    'Chain of 3':
      'Legacy journey badge: carried the relic on the third or later recorded hand-off. Failed-window history was not recorded; this is not proof of an unbroken streak.',
    [EVENT_BADGE]:
      'Event-days badge: recorded holding during San Diego, 13–15 Nov 2026; not proof of conference attendance.',
  };
  if (/^Ring (1|5|10)$/.test(name))
    return `Carried the relic on recorded raid/legacy hand-off ${name.slice(5)}. Wander growth is excluded from this milestone.`;
  return Object.hasOwn(meanings, name) ? meanings[name] : '';
}
let expanded = false;
const clear = () => {
  $('keeper-rows').replaceChildren();
  $('raider-rows').replaceChildren();
  $('scores-coverage').textContent = '';
  $('scores-status').textContent = '';
  $('scores-all').hidden = true;
  $('scores-all').textContent = 'All Keepers';
  expanded = false;
  $('scores-all').setAttribute('aria-expanded', 'false');
};
const node = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
};
function badge(name, earned) {
  const item = node('li'),
    details = node('details', undefined, 'score-badge');
  details.dataset.earned = String(earned);
  details.dataset.badge = name;
  const label = name === EVENT_BADGE ? 'Event-days badge · San Diego · 13–15 Nov' : name;
  const summary = node('summary', `${earned ? '◇' : 'Locked ·'} ${label}`);
  summary.setAttribute('aria-label', `${earned ? 'Earned' : 'Locked'}: ${label}`);
  summary.title = badgeDescription(name);
  details.append(summary, node('p', badgeDescription(name)));
  item.append(details);
  return item;
}
async function loadScores() {
  const current = ++generation;
  controller?.abort();
  controller = new AbortController();
  const active = controller;
  clear();
  $('scores-refresh').disabled = true;
  $('keeper-scores').setAttribute('aria-busy', 'true');
  const timer = setTimeout(() => active.abort(), 8000);
  try {
    const r = await fetch('/api/scores', { cache: 'no-store', signal: active.signal });
    if (!r.ok) throw Error();
    const v = await r.json();
    if (current !== generation) return;
    if (!validScores(v)) throw Error();
    $('score-preview').textContent = v.previewReadOnly ? 'Read-only preview' : '';
    $('score-preview').hidden = !v.previewReadOnly;
    if (v.mode === 'simulator') {
      $('simulator').textContent = 'SIMULATOR · local test journey';
      $('simulator').hidden = false;
    }
    for (const [index, row] of v.channels.entries()) {
      const li = node('li');
      li.hidden = index >= 3;
      li.dataset.rank = String(index + 1);
      const time = node(
        'p',
        `${holdDuration(row.knownHoldSeconds)} time held · ${row.hopsCarried} ${row.hopsCarried === 1 ? 'raid' : 'raids'} carried`,
        'score-numbers',
      );
      time.title = `${row.knownHoldSeconds.toLocaleString()} seconds time held`;
      time.setAttribute(
        'aria-label',
        `${row.knownHoldSeconds} seconds time held; ${row.hopsCarried} ${row.hopsCarried === 1 ? 'raid' : 'raids'} carried`,
      );
      li.append(
        node('h3', `${index + 1}. ${row.login ? '@' + row.login : 'Channel ' + row.channelId}`),
        time,
      );
      const badges = node('ul', undefined, 'score-badges');
      for (const b of row.badges) badges.append(badge(b, true));
      if (!row.badges.includes(EVENT_BADGE)) badges.append(badge(EVENT_BADGE, false));
      li.append(badges);
      $('keeper-rows').append(li);
    }
    $('scores-all').hidden = v.channels.length <= 3;
    for (const row of v.raiders)
      $('raider-rows').append(
        node(
          'li',
          `@${row.login} · ${row.claimsJoined} completed ${row.claimsJoined === 1 ? 'claim' : 'claims'} joined · since opt-in ${new Date(row.since).toLocaleString()}`,
        ),
      );
    if (!v.raiders.length)
      $('raider-rows').append(node('li', 'Raiders: type !relic scores on to join the ledger.'));
    $('scores-coverage').textContent = v.coverage;
    $('scores-status').textContent =
      `${v.rings} recorded ${v.rings === 1 ? 'ring' : 'rings'}${v.wanderStops ? ' · ' + v.wanderStops + ' Wandered (not raids)' : ''} · as of ${new Date(v.asOf).toLocaleString()}. Refresh manually.${v.streak ? ' ' + streakText(v.streak) : ''}`;
  } catch {
    if (current === generation) {
      clear();
      $('scores-status').textContent =
        'Scores unavailable. Previous names and counts hidden. Refresh to try again.';
    }
  } finally {
    clearTimeout(timer);
    if (current === generation) {
      $('scores-refresh').disabled = false;
      $('keeper-scores').setAttribute('aria-busy', 'false');
    }
  }
}
if (typeof document !== 'undefined' && $('keeper-scores')) {
  $('scores-refresh').onclick = loadScores;
  $('scores-all').onclick = () => {
    expanded = !expanded;
    $('scores-all').setAttribute('aria-expanded', String(expanded));
    $('scores-all').textContent = expanded ? 'Top 3 Keepers' : 'All Keepers';
    for (const row of $('keeper-rows').children)
      row.hidden = Number(row.dataset.rank) > 3 && !expanded;
  };
  addEventListener('pagehide', () => {
    generation++;
    controller?.abort();
    clear();
  });
  addEventListener('pageshow', (e) => {
    if (e.persisted) loadScores();
  });
  loadScores();
}
