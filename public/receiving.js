import { downloadKeeperCard } from './keeper-card.js';
const root = document.getElementById('receiving');
const configured = new Set(['raidrelichq', 'olsols2']);
const utc = (v) =>
  Number.isSafeInteger(v) && v >= 0
    ? new Date(v).toLocaleString('en-GB', {
        timeZone: 'UTC',
        dateStyle: 'medium',
        timeStyle: 'short',
      }) + ' UTC'
    : 'Time not recorded';
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
  async function refresh() {
    const own = ++generation;
    controller?.abort();
    controller = new AbortController();
    const active = controller;
    const timer = setTimeout(() => active.abort(), 8000);
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
          node('p', 'Ring ' + v.holder.ringCount + ' · Held since: ' + utc(v.holder.heldSince)),
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
        content.append(node('h3', p.received.length + ' retained received rings'));
        content.append(node('p', 'Approved community glyphs on the latest received ring:'));
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
        for (const s of p.received) {
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
            node('p', 'Recorded arrival: ' + utc(s.claimedAt)),
          );
          article.append(
            node(
              'p',
              Number.isInteger(s.raidAudience)
                ? 'Twitch-reported raid audience: ' + s.raidAudience
                : 'Raid audience not recorded',
            ),
          );
          for (const orientation of ['landscape', 'vertical']) {
            const b = node('button', 'Download ' + orientation + ' card · Ring ' + s.ringIndex);
            b.type = 'button';
            b.onclick = async () => {
              if (busy || own !== generation) return;
              busy = true;
              for (const button of content.querySelectorAll('.keeper-arrival button'))
                button.disabled = true;
              status.textContent = 'Checking the current record and preparing PNG…';
              try {
                await downloadKeeperCard(p, s, orientation, {
                  signal: active.signal,
                  current: () => own === generation,
                });
                status.textContent = 'Card downloaded. Saved files cannot be recalled.';
              } catch {
                status.textContent =
                  'Card unavailable. Refresh; removed or changed records cannot be exported.';
              } finally {
                busy = false;
                for (const button of content.querySelectorAll('.keeper-arrival button'))
                  button.disabled = false;
              }
            };
            article.append(b);
          }
          content.append(article);
        }
      }
      status.textContent =
        'Current retained record. Presence and audience are not proof of new or retained viewers.';
    } catch {
      if (own === generation) {
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
    content.replaceChildren();
  });
  refresh();
}
