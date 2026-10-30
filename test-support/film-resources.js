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
  '/streak-view.js',
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
// Native Network reports inline image requests that framework routing omits.
// This is exactly the original immutable fictional moon rune, never arbitrary SVG.
export const FILM_INLINE_RUNE =
  'data:image/svg+xml;charset=utf-8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path d="M50 8 92 50 50 92 8 50Z M23 70 38 24 66 59 79 31" fill="none" stroke="#d8b46a" stroke-width="4"/></svg>',
  );
export function filmResourceReason(request, { origin, preview, ownedPNGs = [] }) {
  if (request.method !== 'GET') return 'method';
  if (request.url === FILM_INLINE_RUNE && request.resourceType === 'image') return 'static';
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
  if (
    ['/demo/film', '/demo/judge'].includes(url.pathname) &&
    !url.hash &&
    url.searchParams.size === 2 &&
    url.searchParams.get('autoplay') === '1' &&
    url.searchParams.get('kiosk') === '1'
  )
    return 'static';
  return !url.search && !url.hash && staticPaths.has(url.pathname) ? 'static' : 'unknown-static';
}
