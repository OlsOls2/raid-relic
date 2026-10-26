import { ringCardModel, ringCardPNG, saveRingCard, demoCardFilename } from './ring-card.js';
import { presentEdition } from './edition-view.js';
import {
  freshDemo,
  demoStep,
  DEMO_TOUR_MS,
  demoProgress,
  demoControls,
  demoSceneKey,
  demoHolder,
  demoSendReason,
} from './demo-state.js';
import { cinematicPhase } from './cinematic.js';
import { createRelic3D } from './relic3d.js';
// Closed static module graph. No fetch/XHR/WebSocket/Beacon, server state or storage.
const $ = (id) => document.getElementById(id),
  motion = matchMedia('(prefers-reduced-motion: reduce)');
const time = (ms) => '00:' + String(Math.max(0, Math.floor(ms / 1000))).padStart(2, '0');
let state = freshDemo(),
  playing = false,
  tour = false,
  raf = null,
  last = null,
  epoch = 0,
  view = null,
  pending = null,
  lastRings = -1,
  cardPending = false,
  sceneKey = null,
  sceneSnapshot = null,
  viewKey = null;
function syncBannerHeight() {
  const value = $('demo-banner').offsetHeight + 'px';
  const style = document.documentElement.style;
  if (style.getPropertyValue('--demo-banner-height') !== value) {
    style.setProperty('--demo-banner-height', value);
  }
}
const bannerResize = new ResizeObserver(syncBannerHeight);
bannerResize.observe($('demo-banner'));
addEventListener('pagehide', () => bannerResize.disconnect());
addEventListener('pageshow', () => bannerResize.observe($('demo-banner')));

function snapshot() {
  const handoff =
    state.receiptAt === null
      ? null
      : {
          role: 'host',
          startedAt: state.receiptAt,
          endsAt: state.receiptAt + 180000,
          completed: state.completedAt !== null,
          ...(state.completedAt !== null ? { completedAt: state.completedAt } : {}),
        };
  return {
    status: handoff ? 'incoming' : 'archive',
    lineageRings: state.rings,
    marks: [],
    handoff,
  };
}
function assign(node, key, value) {
  if (node[key] !== value) node[key] = value;
}
function text(id, value) {
  assign($(id), 'textContent', value);
}
function scene() {
  const key = demoSceneKey(state);
  if (key !== sceneKey) {
    sceneKey = key;
    sceneSnapshot = snapshot();
  }
  return sceneSnapshot;
}
function updateView() {
  // Read the current preference as well as listening for change events. A missed
  // event must not leave a hidden WebGL context alive behind the SVG fallback.
  if (motion.matches) {
    if (view || pending) releaseRenderer();
    return;
  }
  if (!view) return;
  if (!playing) {
    if (state.phase === 'settled' && state.completedAt !== null) {
      const value = scene(),
        key = 'static:' + sceneKey;
      if (viewKey !== key) {
        view.update(value, { animate: false });
        viewKey = key;
      }
      return;
    }
    if (viewKey !== null) view.update(null);
    viewKey = null;
    return;
  }
  const value = scene();
  if (viewKey !== sceneKey) {
    view.update(value);
    viewKey = sceneKey;
  }
}
function render() {
  presentEdition($('demo-art'));
  $('demo-art').dataset.demoCharging = String(state.phase === 'countdown');
  $('demo-art').style.setProperty(
    '--demo-charge',
    String(state.phase === 'countdown' ? Math.min(1, (state.clock - state.acceptedAt) / 10000) : 0),
  );
  assign(document.body.dataset, 'demoPlaying', String(playing));
  document.body.dataset.demoClock = String(state.clock);
  const s = scene(),
    p = cinematicPhase(s, state.clock, { fresh: true, reduced: motion.matches });
  assign(
    $('demo-art').dataset,
    'phase',
    state.receiptAt === null
      ? 'idle'
      : p.elapsed < 3000
        ? 'streak'
        : p.elapsed < 5000
          ? 'impact'
          : p.elapsed < 20000
            ? 'unfurl'
            : 'settled',
  );
  $('demo-art').style.setProperty('--fusion-glow', String(p.fusionGlow));
  $('demo-art').dataset.fusionPending = String(p.fusion !== null);
  text('demo-rings', `Rings: ${state.rings}`);
  text('demo-notice', state.notice);
  text('demo-progress', demoProgress(state));
  syncBannerHeight();
  text('demo-votes', `Offers ${Number(state.offer)}/1 · Accepts ${Number(state.accept)}/1`);
  text(
    'demo-clock',
    `${playing ? 'Playing' : 'Paused'} · Total ${time(state.clock)}/${time(DEMO_TOUR_MS)} · receipt ${time(state.receiptAt === null ? 0 : state.clock - state.receiptAt)}${state.phase === 'countdown' ? ' · simulated countdown ' + Math.max(0, Math.ceil(10 - (state.clock - state.acceptedAt) / 1000)) + 's (not Twitch timing)' : ''}`,
  );
  assign($('demo-comet'), 'hidden', p.comet === null);
  $('demo-comet').style.transform = `translateX(${p.comet === null ? 0 : (p.comet - 0.5) * 300}px)`;
  assign($('demo-impact'), 'hidden', !p.flash && p.shock === null && p.fusion === null);
  $('demo-impact').style.opacity = String(
    p.fusionGlow || p.flash || (p.shock === null ? 0 : 1 - p.shock),
  );
  $('demo-impact').style.transform = `scale(${p.fusion !== null ? 1 : 0.5 + (p.shock ?? 0)})`;
  assign(
    $('demo-sigils'),
    'hidden',
    !(p.unfurl !== null || (motion.matches && state.receiptAt !== null)),
  );
  if (lastRings !== state.rings) {
    lastRings = state.rings;
    $('demo-bands').replaceChildren();
    for (let i = 0; i < state.rings; i++) {
      const n = document.createElement('span');
      n.style.inset = `${i * 2}%`;
      $('demo-bands').append(n);
    }
  }
  const controls = demoControls(state, { playing, tour });
  text('demo-tour', controls.tourLabel);
  assign($('demo-tour'), 'disabled', controls.tourDisabled);
  text(
    'demo-streak',
    `Streak: ${state.streak} consecutive ${state.streak === 1 ? 'binding' : 'bindings'}`,
  );
  text(
    'demo-holder',
    demoHolder(state)
      ? 'Holder: @' + demoHolder(state)
      : 'No holder yet. Complete a binding to download a card.',
  );
  assign($('demo-download'), 'disabled', cardPending || !demoHolder(state));
  assign($('demo-send'), 'title', demoSendReason(state, { playing, tour }));
  text(
    'demo-mark-approved',
    state.marks
      .filter((m) => m.approved)
      .map((m) => m.text)
      .join(' · '),
  );
  text(
    'demo-mark-held',
    state.marks
      .filter((m) => !m.approved)
      .map((m) => 'HELD (private review): ' + m.text)
      .join(' · '),
  );
  text(
    'demo-mark-budget',
    `Marks used: ${state.markUsed}/5; veto never refunds quota or cooldown.`,
  );
  assign($('demo-lapse'), 'disabled', state.receiptAt === null || state.completedAt !== null);
  text('demo-lock', controls.notice);
  text('demo-send-reason', demoSendReason(state, { playing, tour }));
  text('demo-pause', controls.pauseLabel);
  assign($('demo-pause'), 'disabled', controls.pauseDisabled);
  for (const id of ['demo-offer', 'demo-accept', 'demo-fill', 'demo-source', 'demo-target'])
    assign($(id), 'disabled', controls.locked);
  for (const button of document.querySelectorAll('#demo-source-chat button,#demo-host-chat button'))
    assign(button, 'disabled', controls.locked);
  assign($('demo-raid'), 'disabled', controls.locked || state.phase !== 'countdown');
  assign(
    $('demo-send'),
    'disabled',
    controls.locked || !['idle', 'settled'].includes(state.phase) || state.rings >= 16,
  );
  updateView();
}
async function renderer() {
  if (motion.matches || document.hidden) {
    if (view || pending) releaseRenderer();
    return;
  }
  if (view) {
    updateView();
    return;
  }
  if (pending || motion.matches || document.hidden) return;
  const own = epoch,
    abort = new AbortController();
  pending = abort;
  try {
    const next = await createRelic3D({
      archive: $('demo-art'),
      reducedMotion: motion,
      signal: abort.signal,
    });
    if (own !== epoch || motion.matches || document.hidden) {
      next.dispose();
      return;
    }
    view = next;
    viewKey = null;
    updateView();
  } catch {
  } finally {
    if (pending === abort) pending = null;
  }
}
function releaseRenderer() {
  epoch++;
  pending?.abort();
  pending = null;
  view?.dispose();
  view = null;
  sceneKey = null;
  sceneSnapshot = null;
  viewKey = null;
}
function stop(preserveTour = false) {
  playing = false;
  if (!preserveTour) tour = false;
  epoch++;
  pending?.abort();
  pending = null;
  view?.update(null);
  sceneKey = null;
  sceneSnapshot = null;
  viewKey = null;
  $('demo-art').classList.remove('webgl-relic');
  cancelAnimationFrame(raf);
  raf = null;
  last = null;
  render();
}
function tick(t) {
  raf = null;
  if (!playing || document.hidden) return;
  const delta = last === null ? 0 : Math.max(0, Math.min(100, t - last));
  last = t;
  state = demoStep(state, {
    type: 'advance',
    ms: tour ? Math.min(delta, Math.max(0, DEMO_TOUR_MS - state.clock)) : delta,
  });
  if (state.phase === 'countdown' && state.clock - state.acceptedAt >= 10000)
    state = demoStep(state, { type: 'raid' });
  if (tour) {
    if (state.clock >= 2000 && !state.offer) state = demoStep(state, { type: 'offer' });
    if (state.receiptAt !== null && state.clock - state.receiptAt >= 2000 && !state.accept)
      state = demoStep(state, { type: 'accept' });
  }
  if (
    state.phase === 'bound' &&
    state.clock >=
      Math.max(tour ? DEMO_TOUR_MS : 0, state.receiptAt + 24000, state.completedAt + 4000)
  ) {
    const focusPause = document.activeElement === $('demo-pause');
    state = demoStep(state, { type: 'settle' });
    stop();
    if (focusPause) $('demo-tour').focus();
    return;
  }
  if (state.clock - (state.acceptedAt ?? state.clock) >= 60000) {
    stop();
    state.notice = 'Demo paused after one minute. Reset or use the manual fictional controls.';
    render();
    return;
  }
  render();
  raf = requestAnimationFrame(tick);
}
function play() {
  if (document.hidden || playing || ['idle', 'settled'].includes(state.phase)) return;
  playing = true;
  last = performance.now();
  renderer();
  if (state.clock - (state.acceptedAt ?? state.clock) >= 60000) {
    stop();
    state.notice = 'Demo paused after one minute. Reset or use the manual fictional controls.';
    render();
    return;
  }
  render();
  raf = requestAnimationFrame(tick);
}
function step(action) {
  state = demoStep(state, action);
  render();
}
function takeOver() {
  if (playing && tour) return false;
  tour = false;
  return true;
}
$('demo-send').onclick = () => {
  step({ type: 'send', source: $('demo-source').value, target: $('demo-target').value });
  play();
};
$('demo-raid').onclick = () => {
  if (takeOver()) step({ type: 'raid' });
};
$('demo-fill').onclick = () => {
  if (!takeOver()) return;
  step({ type: 'offer' });
  step({ type: 'accept' });
};
$('demo-source-chat').onsubmit = (e) => {
  e.preventDefault();
  if (!takeOver()) return;
  if ($('demo-offer').value === '!offer') step({ type: 'offer' });
  else {
    state.notice = 'Source chat accepts only !offer.';
    render();
  }
};
$('demo-host-chat').onsubmit = (e) => {
  e.preventDefault();
  if (!takeOver()) return;
  if ($('demo-accept').value === '!accept') step({ type: 'accept' });
  else {
    state.notice = 'Host chat accepts only !accept after arrival.';
    render();
  }
};
function reset() {
  stop();
  state = freshDemo();
  $('demo-proof').open = false;
  render();
}
$('demo-reset').onclick = reset;
function startTour() {
  reset();
  step({ type: 'send', source: 'demo_keeper_a', target: 'demo_keeper_b' });
  tour = true;
  play();
}
$('demo-pause').onclick = () => (playing ? stop(true) : play());
$('demo-tour').onclick = () => {
  const hadFocus = document.activeElement === $('demo-tour');
  startTour();
  if (hadFocus) $('demo-pause').focus();
};
for (const [id, type] of [
  ['demo-clean', 'mark-clean'],
  ['demo-held', 'mark-held'],
  ['demo-veto', 'veto'],
  ['demo-review-wait', 'review-wait'],
  ['demo-lapse', 'lapse'],
])
  $(id).onclick = () => {
    if (type === 'lapse') stop();
    step({ type });
  };
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stop();
    releaseRenderer();
  }
});
addEventListener('pagehide', () => {
  reset();
  releaseRenderer();
});
motion.addEventListener('change', () => {
  if (motion.matches) {
    releaseRenderer();
  } else if (playing) {
    renderer();
  }
  render();
});
render();

$('demo-download').onclick = async () => {
  const button = $('demo-download');
  if (button.disabled) return;
  cardPending = true;
  button.disabled = true;
  const own = epoch,
    rings = state.rings,
    target = demoHolder(state);
  if (!target) {
    cardPending = false;
    button.disabled = true;
    return;
  }
  try {
    const model = ringCardModel(
      { stopId: null, keeper: '@' + target, ringIndex: rings, claimedAt: Date.now() },
      { mode: 'demo' },
    );
    const blob = await ringCardPNG(model);
    if (own !== epoch || state.rings !== rings || demoHolder(state) !== target) return;
    saveRingCard(blob, true, demoCardFilename(model.ringIndex));
    text('demo-card-status', 'Simulated card downloaded; saved files cannot be recalled.');
  } catch {
    text('demo-card-status', 'Simulated card export unavailable.');
  } finally {
    cardPending = false;
    button.disabled = !demoHolder(state);
  }
};
