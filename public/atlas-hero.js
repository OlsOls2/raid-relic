// Aggregate-only presentation. No provider calls, history expansion or polling.
export function atlasRings(value) {
  return Number.isInteger(value) && value >= 0 && value <= 16 ? value : null;
}
export function createAtlasHero({ archive, motion = matchMedia('(prefers-reduced-motion: reduce)'), load = () => import('./relic3d.js') }) {
  let epoch = 0, renderer, pending, stopped = false;
  function clear() { epoch++; pending?.abort(); renderer?.update(null); renderer?.dispose(); renderer = null; archive.classList.remove('webgl-relic'); archive.dataset.rings = '0'; }
  async function update(value) {
    clear(); const rings = atlasRings(value); if (rings === null || stopped) return;
    archive.dataset.rings = String(rings); const own = epoch; const controller = new AbortController(); pending = controller;
    try {
      const { createRelic3D } = await load(); if (own !== epoch || stopped) return;
      const instance = await createRelic3D({ archive, reducedMotion: motion, signal: controller.signal });
      if (own !== epoch || stopped) { instance.dispose(); return; }
      renderer = instance; renderer.update({ status: 'archive', lineageRings: rings, marks: [] });
    } catch { /* The original SVG remains independent of optional WebGL. */ }
  }
  return { update, clear, dispose() { stopped = true; clear(); } };
}
