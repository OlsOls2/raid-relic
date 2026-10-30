import { presentGrowth } from './growth.js';
import { presentEdition } from './edition-view.js';
// Atlas-only composition of the existing numeric projection. Overlay emblems
// retain their own presentation; no new count, timer or renderer resource.
export function presentAtlasGrowth(archive, rings) {
  const model = presentGrowth(archive, rings);
  archive.setAttribute?.(
    'aria-label',
    model
      ? model.total > 0
        ? `Original relic · Ring ${model.total}`
        : 'Original relic · first journey begins'
      : 'Original relic · journey count unavailable',
  );
  const svg = archive.querySelector?.('.growth-fallback');
  if (!svg) return model;
  svg.classList.add('atlas-ring-pill');
  svg.toggleAttribute('hidden', !model || model.total === 0);
  if (!model) return model;
  svg.setAttribute('viewBox', '0 0 140 44');
  svg.setAttribute('aria-label', `Ring ${model.total}`);
  let plate = svg.querySelector('rect');
  if (!plate) {
    plate = archive.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'rect');
    for (const [key, value] of Object.entries({
      x: 1,
      y: 1,
      width: 138,
      height: 42,
      rx: 21,
      fill: '#101d30',
      stroke: '#dba95c',
    }))
      plate.setAttribute(key, String(value));
    svg.prepend(plate);
  }
  const text = svg.querySelector('text');
  text.textContent = `Ring ${model.total}`;
  text.setAttribute('x', '70');
  text.setAttribute('y', '29');
  text.setAttribute('font-size', '18');
  return model;
}
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
  presentEdition(archive);
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
    presentAtlasGrowth(archive, undefined);
  }
  async function update(value) {
    presentEdition(archive);
    const rings = atlasRings(value);
    presentAtlasGrowth(archive, rings ?? undefined);
    if (rings === null) {
      clear();
      return;
    }
    if (renderer && !stopped && !doc?.hidden && !motion.matches) {
      lastValue = rings;
      archive.dataset.rings = String(rings);
      if (!idlePaused) {
        renderer.update({ status: 'archive', lineageRings: rings, marks: [] });
        presentAtlasGrowth(archive, rings);
        lastPainted = rings;
      }
      return;
    }
    clear();
    presentAtlasGrowth(archive, rings);
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
      presentAtlasGrowth(archive, rings);
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
