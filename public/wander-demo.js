import { freshWanderDemo, wanderDemoStep } from './wander-demo-state.js';
import { createRelic3D } from './relic3d.js';
import { presentGrowth } from './growth.js';
const $ = (id) => document.getElementById(id),
  motion = matchMedia('(prefers-reduced-motion: reduce)');
let state = freshWanderDemo(),
  view = null,
  pending = null,
  epoch = 0;
const archive = $('wander-art');
function release() {
  epoch++;
  pending?.abort();
  pending = null;
  view?.dispose();
  view = null;
}
async function paint() {
  const own = epoch;
  presentGrowth(archive, state.rings);
  if (document.hidden || motion.matches) {
    release();
    presentGrowth(archive, state.rings);
    return;
  }
  if (!view && !pending) {
    const controller = new AbortController();
    pending = controller;
    const instance = await createRelic3D({
      archive,
      reducedMotion: motion,
      signal: controller.signal,
    });
    if (own !== epoch || document.hidden || motion.matches) {
      instance.dispose();
      return;
    }
    view = instance;
    pending = null;
  }
  view?.update({ status: 'archive', lineageRings: state.rings, marks: [] }, { animate: false });
}
function render() {
  $('wander-clock').textContent =
    `Virtual clock: ${state.hours} hours · production timing is not accelerated.`;
  $('wander-holder').textContent =
    `@${state.holder} · recorded growth ring ${state.rings} · tracked streak ${state.streak}`;
  $('wander-status').textContent =
    state.stage === 'wandered'
      ? 'Wandered — no Twitch raid, audience transfer or two-chat claim.'
      : state.warning
        ? 'Warning shown at 60h: this fixture Keeper has 12 virtual hours to play.'
        : 'The fictional relic is parked. Advance to the warning.';
  $('wander-path').toggleAttribute('hidden', !state.moved);
  $('wander-warn').disabled = state.warning;
  $('wander-move').disabled = !state.warning || state.moved;
  $('wander-arrival').hidden = !state.moved;
  archive.dataset.phase = 'settled';
  void paint();
}
$('wander-warn').onclick = () => {
  state = wanderDemoStep(state, 'warn');
  render();
};
$('wander-move').onclick = () => {
  state = wanderDemoStep(state, 'move');
  render();
};
$('wander-reset').onclick = () => {
  state = wanderDemoStep(state, 'reset');
  render();
};
// A deterministic two-click film sequence; no timer, background task or network.
$('wander-play').onclick = () => {
  state = wanderDemoStep(state, state.warning ? 'move' : 'warn');
  render();
};
motion.addEventListener('change', () => {
  release();
  render();
});
document.addEventListener('visibilitychange', () => {
  release();
  if (!document.hidden) render();
});
addEventListener('pagehide', release);
render();
