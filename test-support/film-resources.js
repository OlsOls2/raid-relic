// Native test-only classification. No request URL or object identifier is reported.
const staticPaths = new Set([
  '/demo/film',
  '/demo/judge',
  '/film.js',
  '/film-state.js',
  '/film.css',
  '/fonts.css',
  '/fonts/Cinzel.ttf',
  '/favicon.svg',
  '/crystal.svg',
  '/relic3d.js',
  '/growth.js',
  '/cinematic.js',
  '/claim-meter.js',
  '/editions.js',
  '/edition-view.js',
  '/edition-crystal/season-one-autumn-2026.svg',
  '/ring-card.js',
  '/keeper-network.js',
  '/vendor/three.module.js',
  '/vendor/three.core.js',
]);
export const FILM_RESOURCE_REASONS = Object.freeze([
  'static',
  'owned-preview',
  'method',
  'malformed',
  'external',
  'unknown-static',
  'unowned-blob',
  'protocol',
]);
export function filmResourceReason(request, { origin, preview, ownedPNGs = [] }) {
  if (request.method !== 'GET') return 'method';
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return 'malformed';
  }
  if (url.origin !== origin) return 'external';
  if (url.protocol === 'blob:') {
    return request.resourceType === 'image' &&
      request.url === preview &&
      ownedPNGs.some(
        (p) =>
          p.url === preview &&
          p.type === 'image/png' &&
          Number.isSafeInteger(p.size) &&
          p.size > 0 &&
          p.size <= 524288,
      )
      ? 'owned-preview'
      : 'unowned-blob';
  }
  if (url.protocol !== 'https:') return 'protocol';
  return !url.search && !url.hash && staticPaths.has(url.pathname) ? 'static' : 'unknown-static';
}
