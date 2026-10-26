// Presentation only. This limit never changes the server's 16-stop archive cap.
export const MAX_GROWTH = 999999;
export function growthSummary(n) {
  if (!Number.isSafeInteger(n) || n < 0 || n > MAX_GROWTH) return null;
  const decades = Math.floor(n / 10),
    thin = n % 10;
  const tier =
    n >= 100
      ? 'prismatic'
      : n >= 50
        ? 'gold'
        : n >= 25
          ? 'silver'
          : n >= 10
            ? 'bronze'
            : 'original';
  const color = {
    original: '#d8b46a',
    bronze: '#b97a43',
    silver: '#cbd5e1',
    gold: '#dab65c',
    prismatic: '#c7edfa',
  }[tier];
  const groups = [];
  const slots = 16 - thin;
  for (let i = 0; i < Math.min(decades, slots); i++)
    groups.push(i === slots - 1 ? (decades - i) * 10 : 10);
  for (let i = 0; i < thin; i++) groups.push(1);
  return {
    total: n,
    visible: groups.length,
    thin,
    decades,
    groups,
    tier,
    color,
    text: `${n} completed growth rings · ${decades} gilded decades + ${thin} thin rings${decades > slots ? ' · bundled decades' : ''}`,
  };
}
const views = new WeakMap();
// Original inline SVG, numeric text only, independent of optional GPU support.
export function presentGrowth(archive, n) {
  if (!archive || !['object', 'function'].includes(typeof archive)) return;
  let v = views.get(archive);
  if (v && v.total === n) return v.model;
  const model = growthSummary(n);
  if (!model) {
    v?.animation?.cancel();
    v?.svg.remove?.();
    views.delete(archive);
    return;
  }
  if (
    typeof archive.ownerDocument?.createElementNS !== 'function' ||
    typeof archive.append !== 'function'
  )
    return;
  if (!v) {
    const doc = archive.ownerDocument,
      make = (tag) => doc.createElementNS('http://www.w3.org/2000/svg', tag);
    const svg = make('svg'),
      disc = make('circle'),
      text = make('text');
    svg.setAttribute('viewBox', '0 0 100 76');
    svg.classList.add('growth-fallback');
    svg.setAttribute('role', 'img');
    disc.setAttribute('cx', '50');
    disc.setAttribute('cy', '38');
    disc.setAttribute('r', '33');
    disc.setAttribute('fill', '#101d30');
    disc.setAttribute('stroke-width', '3');
    text.setAttribute('x', '50');
    text.setAttribute('y', '47');
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-family', 'system-ui');
    text.setAttribute('font-weight', '700');
    const accents = [];
    for (let i = 0; i < 4; i++) {
      const arc = make('path');
      const angle = (i * Math.PI) / 2;
      arc.setAttribute(
        'd',
        `M ${50 + 30 * Math.cos(angle)} ${38 + 30 * Math.sin(angle)} A 30 30 0 0 1 ${50 + 30 * Math.cos(angle + Math.PI / 2)} ${38 + 30 * Math.sin(angle + Math.PI / 2)}`,
      );
      arc.setAttribute('fill', 'none');
      arc.setAttribute('stroke', ['#d8e6ef', '#b5a3dd', '#d8b46a', '#a2d6d0'][i]);
      arc.setAttribute('stroke-width', '1');
      accents.push(arc);
    }
    svg.append(disc, ...accents, text);
    archive.append(svg);
    v = { svg, disc, text, accents };
    views.set(archive, v);
  }
  v.total = n;
  v.model = model;
  v.text.textContent = String(n);
  v.text.setAttribute('font-size', n > 999 ? '20' : '29');
  v.text.setAttribute('fill', '#d8e6ef');
  v.disc.setAttribute('stroke', model.color);
  for (const arc of v.accents)
    arc.setAttribute('visibility', model.tier === 'prismatic' ? 'visible' : 'hidden');
  v.svg.setAttribute('aria-label', `${n} growth rings · ${model.tier}`);
  v.svg.dataset.total = String(n);
  v.svg.dataset.tier = model.tier;
  return model;
}

// Compositor-only one-shot feedback; never a renderer RAF or game-state change.
export function clearGrowthFeedback(archive) {
  const view = archive && views.get(archive);
  view?.animation?.cancel();
  if (view) view.animation = null;
}
export function pulseGrowth(archive) {
  clearGrowthFeedback(archive);
  const view = archive && views.get(archive);
  if (view?.svg.animate) {
    view.animation = view.svg.animate([{ scale: '1.12' }, { scale: '1' }], {
      duration: 750,
      easing: 'ease-out',
    });
  }
}
