import { presentGrowth } from './growth.js';
import { presentEdition } from './edition-view.js';
// Aggregate-only presentation. No provider calls, history expansion or polling.
export function atlasRings(value) {
  return Number.isInteger(value) && value >= 0 && value <= 16 ? value : null;
}
export function createAtlasHero({
  archive,
  motion = matchMedia('(prefers-reduced-motion: reduce)'),
  load = () => import('./relic3d.js'),
}) {
  let epoch = 0,
    renderer,
    pending,
    stopped = false,
    lastValue = null,
    lastPainted = null,
    idle = null,
    idlePaused = false;
  const doc = globalThis.document,
    win = globalThis.window;
  const suspend = () => {
    idlePaused = true;
    clearTimeout(idle);
    idle = null;
    renderer?.update(null);
  };
  const wake = (event) => {
    if (
      stopped ||
      doc?.hidden ||
      (['pointerdown', 'keydown'].includes(event?.type) && !event.isTrusted)
    )
      return;
    presentEdition(archive);
    const wasPaused = idlePaused;
    idlePaused = false;
    clearTimeout(idle);
    if (doc) idle = setTimeout(suspend, 600000);
    if (!wasPaused) return;
    if (lastValue !== null) {
      if (renderer) renderer.update({ status: 'archive', lineageRings: lastValue, marks: [] });
      else void update(lastValue);
    }
  };
  const visibility = () => (doc?.hidden ? suspend() : wake({ type: 'visibilitychange' }));
  doc?.addEventListener?.('visibilitychange', visibility);
  doc?.addEventListener?.('pointerdown', wake);
  doc?.addEventListener?.('keydown', wake);
  win?.addEventListener?.('focus', wake);
  if (doc) idle = setTimeout(suspend, 600000);
  let mediaChanges = 0,
    creates = 0,
    disposes = 0;
  const lifecycle = () => {
    Object.assign(archive.dataset, {
      motionChanges: String(mediaChanges),
      rendererCreates: String(creates),
      rendererDisposes: String(disposes),
      rendererEpoch: String(epoch),
      motionMatches: String(Boolean(motion.matches)),
    });
  };
  const changeMotion = () => {
    mediaChanges++;
    const value = lastValue;
    clear();
    if (value !== null) void update(value);
  };
  motion.addEventListener?.('change', changeMotion);
  function clear() {
    lastValue = null;
    epoch++;
    pending?.abort();
    renderer?.update(null);
    if (renderer) {
      renderer.dispose();
      disposes++;
    }
    renderer = null;
    lifecycle();
    archive.classList.remove('webgl-relic');
    archive.dataset.rings = '0';
    presentGrowth(archive, undefined);
  }
  async function update(value) {
    presentEdition(archive);
    const rings = atlasRings(value);
    presentGrowth(archive, rings ?? undefined);
    if (rings === null) {
      clear();
      return;
    }
    if (renderer && !stopped && !doc?.hidden && !motion.matches) {
      lastValue = rings;
      archive.dataset.rings = String(rings);
      if (!idlePaused) {
        renderer.update({ status: 'archive', lineageRings: rings, marks: [] });
        lastPainted = rings;
      }
      return;
    }
    clear();
    presentGrowth(archive, rings);
    if (rings === null || stopped) return;
    lastValue = rings;
    archive.dataset.rings = String(rings);
    if (idlePaused || doc?.hidden || motion.matches) return;
    const own = epoch;
    const controller = new AbortController();
    pending = controller;
    try {
      const { createRelic3D } = await load();
      if (own !== epoch || stopped || motion.matches) return;
      const instance = await createRelic3D({
        archive,
        previousGrowth: lastPainted,
        reducedMotion: motion,
        onReducedMotion: changeMotion,
        signal: controller.signal,
      });
      if (own !== epoch || stopped || motion.matches) {
        instance.dispose();
        return;
      }
      renderer = instance;
      creates++;
      lifecycle();
      if (idlePaused || doc?.hidden) {
        renderer.update(null);
        return;
      }
      renderer.update({ status: 'archive', lineageRings: rings, marks: [] });
      lastPainted = rings;
    } catch {
      /* The original SVG remains independent of optional WebGL. */
    }
  }
  return {
    update,
    clear,
    dispose() {
      stopped = true;
      motion.removeEventListener?.('change', changeMotion);
      clearTimeout(idle);
      doc?.removeEventListener?.('visibilitychange', visibility);
      doc?.removeEventListener?.('pointerdown', wake);
      doc?.removeEventListener?.('keydown', wake);
      win?.removeEventListener?.('focus', wake);
      clear();
    },
  };
}
