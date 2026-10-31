import { keeperNames } from './keeper-network.js';
import { downloadKeeperCard, keeperCardThumbnail } from './keeper-card.js';
const root = document.getElementById('receiving');
const configured = new Set(Object.values(keeperNames));
import { publicDate as utc } from './streak-view.js';
const node = (tag, text) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  return n;
};
function link(text, href) {
  const n = node('a', text);
  n.href = href;
  return n;
}
function valid(v) {
  return (
    v &&
    ['live', 'simulator'].includes(v.mode) &&
    (!v.holder ||
      (configured.has(v.holder.login) &&
        Number.isInteger(v.holder.ringCount) &&
        v.holder.ringCount >= 0 &&
        v.holder.ringCount <= 16)) &&
    (!v.seekers ||
      (Array.isArray(v.seekers) &&
        v.seekers.length <= 4 &&
        v.seekers.every(
          (s) =>
            configured.has(s.login) &&
            Number.isInteger(s.viewers) &&
            s.viewers >= 0 &&
            s.viewers <= 1000000,
        )))
  );
}
if (root) {
  const content = document.getElementById('receiving-content'),
    status = document.getElementById('receiving-status');
  const login = /^\/keeper\/([a-z0-9_]{1,25})$/.exec(location.pathname)?.[1];
  let generation = 0,
    controller,
    busy = false;
  const previewURLs = new Set();
  let previewBytes = 0;
  const clearPreviews = () => {
    for (const url of previewURLs) URL.revokeObjectURL(url);
    previewURLs.clear();
    previewBytes = 0;
  };
  async function refresh() {
    const own = ++generation;
    controller?.abort();
    controller = new AbortController();
    const active = controller;
    const timer = setTimeout(() => active.abort(), 8000);
    clearPreviews();
    content.replaceChildren();
    status.textContent = 'Reading the current public record…';
    try {
      const r = await fetch(login ? '/api/keeper/' + login : '/api/receiving', {
        signal: active.signal,
        credentials: 'omit',
        cache: 'no-store',
      });
      if (!r.ok) throw Error('Unavailable');
      const raw = await r.text();
      if (raw.length > 131072) throw Error('Bounded record');
      const v = JSON.parse(raw);
      if (!valid(v) || active.signal.aborted || own !== generation) throw Error('Invalid record');
      if (v.mode === 'simulator') {
        const label = document.getElementById('simulator');
        if (label) {
          label.hidden = false;
          label.textContent = 'SIMULATOR · local test data';
        }
      }
      if (v.holder) {
        const card = node('article');
        card.className = 'holder-spotlight';
        card.append(
          node('h3', '@' + v.holder.login + ' holds the relic'),
          node(
            'p',
            (v.holder.ringCount ? 'Ring ' + v.holder.ringCount + ' · ' : '') +
              'Held since: ' +
              utc(v.holder.heldSince),
          ),
        );
        card.append(
          node(
            'p',
            v.live === true
              ? 'Live · observed within the last minute'
              : v.live === false
                ? 'Offline at the last observation'
                : 'Live status unknown',
          ),
        );
        card.append(
          link('Watch @' + v.holder.login + ' on Twitch', 'https://twitch.tv/' + v.holder.login),
          document.createTextNode(' · '),
          link('Keeper record', '/keeper/' + v.holder.login),
        );
        content.append(card);
      } else content.append(node('p', 'The current holder is not recorded.'));
      if (!login) {
        content.append(node('h3', 'Live Seekers · authorised Keeper pilot'));
        content.append(
          node(
            'p',
            v.enabled
              ? 'Opted-in eligible recipients, lowest Twitch-reported viewer count first. Eligibility is checked again before Send Off.'
              : 'Seeker suggestions are off. Operator admission and broadcaster consent are required.',
          ),
        );
        const list = node('ul');
        for (const s of v.seekers ?? []) {
          const li = node('li');
          li.append(
            link('@' + s.login, '/keeper/' + s.login),
            document.createTextNode(' · ' + s.viewers + ' Twitch-reported viewers'),
          );
          list.append(li);
        }
        content.append(list);
        if (v.enabled && !list.childElementCount)
          content.append(node('p', 'No live eligible Seekers are currently confirmed.'));
        const recent = node('p', 'Recent recorded Keepers: ');
        for (const name of v.recent ?? [])
          if (configured.has(name))
            recent.append(link('@' + name, '/keeper/' + name), document.createTextNode(' '));
        content.append(recent);
      } else {
        const p = v.profile;
        if (
          !p ||
          p.login !== login ||
          !configured.has(login) ||
          !Array.isArray(p.received) ||
          p.received.length > 16 ||
          !Array.isArray(p.glyphs) ||
          p.glyphs.length > 20
        )
          throw Error('Invalid Keeper');
        document.getElementById('keeper-title').textContent = '@' + login + ' · received rings';
        content.append(
          node(
            'h3',
            p.received.length
              ? p.received.length + ' retained received rings'
              : 'First journey begins',
          ),
        );
        if (p.glyphs.length)
          content.append(
            node(
              'p',
              'Retained approved glyphs on the latest received ring (arrival plus marks made during that hold):',
            ),
          );
        const glyphs = node('div');
        glyphs.className = 'keeper-glyphs';
        for (const g of p.glyphs) {
          if (
            typeof g.text !== 'string' ||
            g.text.length > 128 ||
            typeof g.runeSvg !== 'string' ||
            g.runeSvg.length > 4096 ||
            !g.runeSvg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')
          )
            throw Error('Invalid glyph');
          const figure = node('figure'),
            image = document.createElement('img');
          image.src = 'data:image/svg+xml,' + encodeURIComponent(g.runeSvg);
          image.width = image.height = 48;
          image.alt = 'Approved rune: ' + g.text;
          figure.append(image, node('figcaption', g.text));
          glyphs.append(figure);
        }
        content.append(glyphs);
        if (p.current) {
          const live = p.current;
          if (
            v.holder?.login !== login ||
            live.login !== login ||
            live.ringCount !== v.holder.ringCount ||
            !Array.isArray(live.marks) ||
            live.marks.length > 160 ||
            live.approvedCount !== live.marks.length
          )
            throw Error('Invalid current hold');
          const section = node('section');
          section.id = 'keeper-current-live';
          section.append(
            node('h3', `Retained hold · Ring ${live.ringCount}`),
            node(
              'p',
              `${live.approvedCount} retained approved marks, shown above. Collection still requires a live authorized Keeper.`,
            ),
          );
          content.append(section);
        }
        const more = node('details'),
          moreBody = node('div');
        more.className = 'keeper-more';
        more.append(
          node('summary', '+' + Math.max(0, p.received.length - 3) + ' more received rings'),
          moreBody,
        );
        const previews = [];
        for (const [index, s] of p.received.entries()) {
          if (
            !/^[a-f0-9]{64}$/.test(s.stopId) ||
            s.to !== login ||
            !Number.isInteger(s.ringIndex) ||
            s.ringIndex < 1 ||
            s.ringIndex > 16
          )
            throw Error('Invalid stop');
          const article = node('article');
          article.className = 'keeper-arrival';
          article.append(
            link(
              'Ring ' + s.ringIndex + ' · from @' + (configured.has(s.from) ? s.from : 'unknown'),
              '/stops/' + s.stopId,
            ),
            node(
              'p',
              (s.kind === 'wander' ? 'Wandered (no raid): ' : 'Recorded arrival: ') +
                utc(s.claimedAt),
            ),
          );
          article.append(
            node(
              'p',
              s.kind === 'wander'
                ? 'Wandered — no raid or audience transfer'
                : Number.isInteger(s.raidAudience)
                  ? 'Twitch-reported raid audience: ' + s.raidAudience
                  : 'Raid audience not recorded',
            ),
          );
          const thumbnail = node('img');
          thumbnail.className = 'keeper-card-preview';
          thumbnail.width = 320;
          thumbnail.height = 180;
          thumbnail.alt = 'Card preview · Ring ' + s.ringIndex + ' received by @' + login;
          thumbnail.hidden = true;
          article.append(thumbnail);
          previews.push({ thumbnail, stop: s, deferred: index >= 3 });
          const actions = node('div'),
            menu = node('select'),
            share = node('button', 'Share · Ring ' + s.ringIndex);
          actions.className = 'keeper-share-options';
          menu.setAttribute('aria-label', 'Share format · Ring ' + s.ringIndex);
          menu.hidden = true;
          for (const [value, label] of [
            ['landscape', 'Landscape PNG'],
            ['vertical', 'Vertical PNG'],
            ['copy', 'Copy stop link'],
          ]) {
            const option = node('option', label);
            option.value = value;
            menu.append(option);
          }
          const download = node('button', 'Download landscape card · Ring ' + s.ringIndex);
          share.type = download.type = 'button';
          share.onclick = async () => {
            if (own !== generation || busy) return;
            const url = new URL('/stops/' + s.stopId, location.origin).href;
            if (navigator.share) {
              try {
                await navigator.share({ title: 'Raid Relic · Ring ' + s.ringIndex, url });
              } catch {
                if (own === generation) {
                  menu.hidden = false;
                  menu.focus();
                }
              }
            } else {
              menu.hidden = false;
              menu.focus();
            }
          };
          menu.onchange = () => {
            download.textContent =
              menu.value === 'copy'
                ? 'Copy stop link · Ring ' + s.ringIndex
                : 'Download ' + menu.value + ' card · Ring ' + s.ringIndex;
          };
          download.onclick = async () => {
            if (busy || own !== generation) return;
            busy = true;
            for (const button of content.querySelectorAll('.keeper-arrival button'))
              button.disabled = true;
            status.textContent = 'Checking the current record and preparing PNG…';
            try {
              if (menu.value === 'copy') {
                await navigator.clipboard.writeText(
                  new URL('/stops/' + s.stopId, location.origin).href,
                );
                if (own === generation)
                  status.textContent = 'Stop link copied. It reads the current public record.';
              } else {
                await downloadKeeperCard(p, s, menu.value, {
                  signal: active.signal,
                  current: () => own === generation,
                });
                if (own === generation)
                  status.textContent = 'Card downloaded. Saved files cannot be recalled.';
              }
            } catch {
              if (own === generation)
                status.textContent =
                  'Card unavailable. Refresh; removed or changed records cannot be exported.';
            } finally {
              busy = false;
              if (own === generation)
                for (const button of content.querySelectorAll('.keeper-arrival button'))
                  button.disabled = false;
            }
          };
          actions.append(share, menu, download);
          article.append(actions);
          (index < 3 ? content : moreBody).append(article);
        }
        if (p.received.length > 3) content.append(more);
        // Sequential bounded raster work; retained URLs are revoked on refresh/leave.
        let previewBusy = false;
        const paintPreviews = async () => {
          if (previewBusy) return;
          previewBusy = true;
          try {
            for (const job of previews) {
              if (own !== generation || active.signal.aborted) break;
              if (job.done || (job.deferred && !more.open)) continue;
              job.done = true;
              try {
                const blob = await keeperCardThumbnail(p, job.stop, v.mode);
                if (own !== generation || active.signal.aborted) break;
                if (previewBytes + blob.size > 524288) break;
                const url = URL.createObjectURL(blob);
                previewURLs.add(url);
                previewBytes += blob.size;
                job.thumbnail.src = url;
                job.thumbnail.hidden = false;
              } catch {
                /* Retain the truthful textual stop; never substitute a mock image. */
              }
            }
          } finally {
            previewBusy = false;
          }
        };
        more.ontoggle = () => {
          if (more.open) void paintPreviews();
        };
        void paintPreviews();
      }
      // Keeper's complete verification/retention context lives in its one
      // disclosure. Keep the live status concise without repeating that warning.
      status.textContent = login
        ? 'Current retained Keeper record.'
        : 'Current retained record. Presence and audience are not proof of new or retained viewers.';
    } catch {
      if (own === generation) {
        active.abort();
        clearPreviews();
        content.replaceChildren();
        status.textContent =
          'Keeper record unavailable. Previous content was cleared; refresh to try again.';
      }
    } finally {
      clearTimeout(timer);
    }
  }
  document.getElementById('receiving-refresh').onclick = refresh;
  addEventListener('pagehide', () => {
    generation++;
    controller?.abort();
    clearPreviews();
    content.replaceChildren();
  });
  refresh();
}
