import {
  FILM_MS,
  FILM_SCENES,
  freshFilm,
  advanceFilmAtPace,
  filmDuration,
  seekFilm,
  filmStep,
  filmFrame,
  filmShortcut,
} from './film-state.js';
import { createRelic3D } from './relic3d.js';
import { cinematicPhase } from './cinematic.js';
import { presentGrowth } from './growth.js';
import { ringCardModel, ringCardPNG, saveRingCard, demoCardFilename } from './ring-card.js';
// Static graph only: no application API, transport, storage, audio or credentials.
const $ = (id) => document.getElementById(id),
  archive = $('film-art');
const motion = matchMedia('(prefers-reduced-motion: reduce)');
const duration = filmDuration(location.pathname);
if (location.pathname === '/demo/judge') {
  document.body.classList.add('judge-mode');
  document.title = '45-second SIMULATED judge sandbox · Raid Relic';
  $('film-banner').textContent = 'JUDGE / SIMULATOR — no Twitch connection or real transfers';
  $('film-intro').textContent =
    '45-second fictional whole-loop preview · no account, audio or real actions. Pause, skip or replay; card export is optional.';
}
document.body.dataset.presentationDuration = String(duration);
const rune =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 8 92 50 50 92 8 50Z M23 70 38 24 66 59 79 31" fill="none" stroke="#d8b46a" stroke-width="4"/></svg>';
let state = freshFilm(),
  view = null,
  pending = null,
  epoch = 0,
  raf = null,
  last = null,
  scene = -1,
  viewKey = null,
  card = null,
  cardURL = null,
  cardJob = null,
  alive = true;
const setText = (id, value) => {
  if ($(id).textContent !== value) $(id).textContent = value;
};
const stamp = (ms) =>
  `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
function release() {
  epoch++;
  pending?.abort();
  pending = null;
  view?.dispose();
  view = null;
  viewKey = null;
}
async function draw(frame) {
  presentGrowth(archive, frame.rings);
  if (!alive || document.hidden || motion.matches || frame.index === 7) {
    release();
    return;
  }
  if (!view && !pending) {
    const controller = new AbortController(),
      own = epoch;
    pending = controller;
    try {
      const instance = await createRelic3D({
        archive,
        reducedMotion: motion,
        signal: controller.signal,
      });
      if (own !== epoch || document.hidden || motion.matches || !alive) {
        instance.dispose();
        return;
      }
      view = instance;
      pending = null;
    } catch {
      if (own === epoch) pending = null;
      return;
    }
  }
  if (!view) return;
  // Only semantic changes rebuild scene geometry; per-frame clock drives existing
  // original cinematic styles without mutating game state.
  const key = `${frame.index}:${frame.rings}:${frame.engraved}:${state.playing}`;
  if (key !== viewKey) {
    viewKey = key;
    view.update(
      {
        status: 'archive',
        lineageRings: frame.rings,
        marks: frame.engraved ? [{ id: 'film-moon', runeSvg: rune }] : [],
      },
      { animate: state.playing, growthFeedback: false },
    );
  }
}
async function prepareCard() {
  if (card || cardJob) return cardJob;
  $('film-export').disabled = true;
  cardJob = (async () => {
    const model = ringCardModel(
      {
        keeper: '@demo_keeper_b',
        ringIndex: 1,
        stopId: null,
        claimedAt: Date.UTC(2026, 9, 31, 12),
      },
      { mode: 'demo', now: Date.UTC(2026, 9, 31, 12) },
    );
    const base = await ringCardPNG(model),
      image = await createImageBitmap(base);
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 630;
    try {
      const c = canvas.getContext('2d');
      if (!c) throw Error('Canvas unavailable');
      c.drawImage(image, 0, 0);
      image.close();
      c.fillStyle = '#101d30';
      c.fillRect(500, 310, 630, 195);
      c.fillStyle = '#d8b46a';
      c.font = '20px system-ui';
      c.fillText('FILM / SIMULATOR — no real transfers', 60, 65, 1080);
      c.fillText('Approved sample engraving: moon', 520, 340, 580);
      c.strokeStyle = '#d8b46a';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(560, 355);
      c.lineTo(595, 390);
      c.lineTo(560, 425);
      c.lineTo(525, 390);
      c.closePath();
      c.stroke();
      c.beginPath();
      c.moveTo(539, 407);
      c.lineTo(550, 368);
      c.lineTo(574, 397);
      c.lineTo(584, 374);
      c.stroke();
      c.fillStyle = '#d8e6ef';
      c.font = '19px system-ui';
      c.fillText('1 retained fictional hop · @demo_keeper_a', 620, 385, 490);
      c.fillText('→ @demo_keeper_b · current fixture holder', 620, 415, 490);
      c.font = '14px system-ui';
      c.fillText('Unofficial fan art · not affiliated with Twitch/TwitchCon.', 520, 475, 580);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!blob || blob.type !== 'image/png' || blob.size > 524288) throw Error('Card encoding');
      if (!alive) return;
      card = blob;
      cardURL = URL.createObjectURL(blob);
      $('film-card').src = cardURL;
      await $('film-card').decode();
      $('film-export').disabled = false;
      setText(
        'film-card-status',
        'SIMULATED · preview only. Nothing downloads until you choose Export.',
      );
    } finally {
      image.close();
      canvas.width = canvas.height = 0;
    }
  })()
    .catch(() => {
      setText('film-card-status', 'Card unavailable. Restart the film to try again.');
    })
    .finally(() => {
      cardJob = null;
    });
  return cardJob;
}
function render() {
  const f = filmFrame(state.ms),
    elapsed = f.arrivalElapsed;
  document.body.dataset.filmClock = String(state.ms);
  document.body.dataset.filmPlaying = String(state.playing);
  archive.dataset.phase =
    elapsed < 0
      ? 'idle'
      : elapsed < 3000
        ? 'streak'
        : elapsed < 5000
          ? 'impact'
          : elapsed < 20000
            ? 'unfurl'
            : 'settled';
  const p = cinematicPhase(
    {
      status: 'incoming',
      handoff: {
        role: 'host',
        startedAt: 0,
        endsAt: 180000,
        completed: f.completed && !f.replay,
        completedAt: 40000,
      },
    },
    elapsed,
    { fresh: true, reduced: motion.matches },
  );
  archive.style.setProperty('--arrival', String(p.unfurl ?? 1));
  archive.style.setProperty('--fusion-glow', String(p.fusionGlow));
  archive.style.setProperty('--p3-fusion', String(p.fusion ?? 1));
  archive.dataset.fusionPending = String(p.fusion !== null);
  $('film-comet').hidden = p.comet === null;
  $('film-comet').style.transform = `translateX(${(p.comet ?? 0) * 100 - 50}%)`;
  $('film-impact').hidden = p.flash === 0 && p.shock === null;
  $('film-impact').style.opacity = String(p.flash || (p.shock === null ? 0 : 1 - p.shock));
  if (scene !== f.index) {
    scene = f.index;
    setText('film-scene-number', `Scene ${scene + 1} / ${FILM_SCENES.length} · sample fixtures`);
    setText('film-heading', f.scene.name);
    setText('film-caption', f.scene.caption);
  }
  setText('film-count', `Recorded rings: ${f.rings} · SIMULATED`);
  setText(
    'film-holder',
    f.completed
      ? '@demo_keeper_b holds this fictional relic'
      : 'No holder yet · binding not completed',
  );
  setText('film-votes', `Offers ${f.offers}/1 · Accepts ${f.accepts}/1`);
  $('film-quorum').value = f.offers + f.accepts;
  setText(
    'film-claim',
    f.completed
      ? 'SIMULATED binding complete · one ring'
      : f.offers
        ? 'Provisional offer · no ring until distinct host accept'
        : 'No completed claim',
  );
  $('film-meter').hidden = f.index > 3;
  $('film-engraving').hidden = !f.engraved || f.index > 4;
  $('film-spotlight').hidden = f.index !== 4;
  $('film-journey').hidden = f.index < 5;
  $('film-stage').hidden = f.index === 7;
  $('film-card-section').hidden = f.index !== 7;
  $('film-play').textContent =
    state.ms === FILM_MS ? 'Replay film' : state.playing ? 'Pause film' : 'Play film';
  $('film-next').disabled = state.ms === FILM_MS;
  $('film-seek').value = String(state.ms);
  setText('film-time', `${stamp((state.ms * duration) / FILM_MS)} / ${stamp(duration)}`);
  if (f.index === 7) void prepareCard();
  void draw(f);
}
function schedule() {
  if (raf === null && state.playing && !document.hidden && alive) raf = requestAnimationFrame(tick);
}
function tick(now) {
  raf = null;
  state = advanceFilmAtPace(
    state,
    last === null ? 0 : now - last,
    location.pathname,
    document.hidden,
  );
  last = now;
  render();
  schedule();
}
function apply(action) {
  state = filmStep(state, action);
  last = null;
  if (raf !== null) cancelAnimationFrame(raf);
  raf = null;
  render();
  schedule();
}
$('film-play').onclick = () => apply('toggle');
$('film-next').onclick = () => apply('next');
$('film-restart').onclick = () => apply('restart');
$('film-seek').oninput = () => {
  state = seekFilm(state, Number($('film-seek').value));
  last = null;
  render();
  schedule();
};
$('film-export').onclick = () => {
  if (card && filmFrame(state.ms).index === 7) saveRingCard(card, true, demoCardFilename(1));
};
document.addEventListener('keydown', (e) => {
  const action = filmShortcut({
    code: e.code,
    repeat: e.repeat,
    modified: e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey,
    interactive: Boolean(e.target.closest?.('button,input,select,textarea,a,[contenteditable]')),
  });
  if (action) {
    e.preventDefault();
    apply(action);
  }
});
motion.addEventListener('change', () => {
  release();
  render();
});
document.addEventListener('visibilitychange', () => {
  if (raf !== null) cancelAnimationFrame(raf);
  raf = null;
  last = null;
  release();
  if (!document.hidden) {
    render();
    schedule();
  }
});
addEventListener('pagehide', () => {
  alive = false;
  if (raf !== null) cancelAnimationFrame(raf);
  raf = null;
  release();
  if (cardURL) URL.revokeObjectURL(cardURL);
  cardURL = null;
  card = null;
  presentGrowth(archive, undefined);
});
addEventListener('pageshow', () => {
  if (!alive) {
    alive = true;
    render();
    schedule();
  }
});
render();
schedule();
