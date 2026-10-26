// Aggregate-only presentation. No provider calls, history expansion or polling.
export function atlasRings(value) {
  return Number.isInteger(value) && value >= 0 && value <= 16 ? value : null;
}
export function createAtlasHero({ archive, motion = matchMedia('(prefers-reduced-motion: reduce)'), load = () => import('./relic3d.js') }) {
  let epoch = 0, renderer, pending, stopped = false,lastValue=null,idle=null,idlePaused=false;
  const doc=globalThis.document,win=globalThis.window;
  const suspend=()=>{idlePaused=true;clearTimeout(idle);idle=null;renderer?.update(null);};
  const wake=event=>{if(stopped||doc?.hidden||(['pointerdown','keydown'].includes(event?.type)&&!event.isTrusted))return;const wasPaused=idlePaused;idlePaused=false;clearTimeout(idle);if(doc)idle=setTimeout(suspend,600000);if(!wasPaused)return;if(lastValue!==null){if(renderer)renderer.update({status:'archive',lineageRings:lastValue,marks:[]});else void update(lastValue);}};
  const visibility=()=>doc?.hidden?suspend():wake({type:'visibilitychange'});
  doc?.addEventListener?.('visibilitychange',visibility);doc?.addEventListener?.('pointerdown',wake);doc?.addEventListener?.('keydown',wake);win?.addEventListener?.('focus',wake);if(doc)idle=setTimeout(suspend,600000);
  function clear() { lastValue=null;epoch++; pending?.abort(); renderer?.update(null); renderer?.dispose(); renderer = null; archive.classList.remove('webgl-relic'); archive.dataset.rings = '0'; }
  async function update(value) {
    clear(); const rings = atlasRings(value); if (rings === null || stopped) return;
    lastValue=rings;archive.dataset.rings = String(rings);if(idlePaused||doc?.hidden)return; const own = epoch; const controller = new AbortController(); pending = controller;
    try {
      const { createRelic3D } = await load(); if (own !== epoch || stopped) return;
      const instance = await createRelic3D({ archive, reducedMotion: motion, signal: controller.signal });
      if (own !== epoch || stopped) { instance.dispose(); return; }
      renderer = instance; if(idlePaused||doc?.hidden){renderer.update(null);return;}renderer.update({ status: 'archive', lineageRings: rings, marks: [] });
    } catch { /* The original SVG remains independent of optional WebGL. */ }
  }
  return { update, clear, dispose() { stopped = true;clearTimeout(idle);doc?.removeEventListener?.('visibilitychange',visibility);doc?.removeEventListener?.('pointerdown',wake);doc?.removeEventListener?.('keydown',wake);win?.removeEventListener?.('focus',wake); clear(); } };
}
