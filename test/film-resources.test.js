import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { filmResourceReason, FILM_INLINE_RUNE } from '../test-support/film-resources.js';
const origin = 'https://localhost:5191',
  preview = 'blob:' + origin + '/owned';
const policy = { origin, preview, ownedPNGs: [{ url: preview, type: 'image/png', size: 12000 }] };
const request = (url, patch = {}) => ({ url, method: 'GET', resourceType: 'image', ...patch });
test('native inline asset is exact original rune only, with image and GET binding', () => {
  assert.equal(filmResourceReason(request(FILM_INLINE_RUNE), policy), 'static');
  assert.notEqual(filmResourceReason(request(FILM_INLINE_RUNE + 'x'), policy), 'static');
  assert.notEqual(
    filmResourceReason(request(FILM_INLINE_RUNE, { resourceType: 'document' }), policy),
    'static',
  );
  assert.equal(filmResourceReason(request(FILM_INLINE_RUNE, { method: 'POST' }), policy), 'method');
  assert.notEqual(filmResourceReason(request('data:image/svg+xml,<svg/>'), policy), 'static');
});
test('film accepts exact same-origin static files and only its own bounded PNG image preview', () => {
  assert.equal(filmResourceReason(request(origin + '/film.js'), policy), 'static');
  assert.equal(filmResourceReason(request(origin + '/edition-view.js'), policy), 'static');
  assert.equal(
    filmResourceReason(request(origin + '/edition-crystal/season-one-autumn-2026.svg'), policy),
    'static',
  );
  assert.equal(filmResourceReason(request(preview), policy), 'owned-preview');
  for (const patch of [
    { size: 524289 },
    { size: 0 },
    { size: 1.5 },
    { type: 'image/svg+xml' },
    { url: preview + 'other' },
  ])
    assert.equal(
      filmResourceReason(request(preview), {
        ...policy,
        ownedPNGs: [{ ...policy.ownedPNGs[0], ...patch }],
      }),
      'unowned-blob',
    );
  assert.equal(
    filmResourceReason(request(preview, { resourceType: 'document' }), policy),
    'unowned-blob',
  );
  assert.equal(filmResourceReason(request(preview + 'other'), policy), 'unowned-blob');
  assert.equal(filmResourceReason(request(preview), { ...policy, ownedPNGs: [] }), 'unowned-blob');
});
test('film rejects APIs, unknown HTML, queries, writes, external and unowned object resources', () => {
  for (const path of [
    '/api/receiving',
    '/internal/wander/tick',
    '/control/1',
    '/unknown.html',
    '/favicon.ico',
    '/edition-crystal/unknown.svg',
    '/edition-crystal/season-one-autumn-2026.svg?extra=1',
    '/film.js?extra=1',
  ])
    assert.equal(filmResourceReason(request(origin + path), policy), 'unknown-static');
  assert.equal(
    filmResourceReason(request(origin + '/film.js', { method: 'POST' }), policy),
    'method',
  );
  assert.equal(filmResourceReason(request(preview, { method: 'POST' }), policy), 'method');
  assert.equal(filmResourceReason(request('https://other.invalid/film.js'), policy), 'external');
  assert.equal(filmResourceReason(request('blob:https://other.invalid/owned'), policy), 'external');
  assert.equal(filmResourceReason(request('data:image/png;base64,AA'), policy), 'external');
  assert.equal(filmResourceReason(request('not a URL'), policy), 'malformed');
});

test('kiosk entry accepts only the two exact local playback flags, never arbitrary query resources', () => {
  for (const path of ['/demo/film', '/demo/judge']) {
    assert.equal(
      filmResourceReason(request(origin + path + '?autoplay=1&kiosk=1'), policy),
      'static',
    );
    assert.equal(
      filmResourceReason(request(origin + path + '?kiosk=1&autoplay=1'), policy),
      'static',
    );
    for (const query of [
      'autoplay=1&kiosk=1&kiosk=1',
      'autoplay=1&kiosk=1&provider=x',
      'autoplay=0&kiosk=1',
    ])
      assert.equal(
        filmResourceReason(request(origin + path + '?' + query), policy),
        'unknown-static',
      );
  }
  assert.equal(
    filmResourceReason(request('https://external.example/demo/film?autoplay=1&kiosk=1'), policy),
    'external',
  );
  assert.equal(
    filmResourceReason(
      request(origin + '/demo/film?autoplay=1&kiosk=1', { method: 'POST' }),
      policy,
    ),
    'method',
  );
});

// ring-card -> publicDate is a real transitive film/judge module dependency.
test('film date-module admission stays exact, same-origin and GET-only', () => {
  assert.equal(
    filmResourceReason(request(origin + '/streak-view.js', { resourceType: 'script' }), policy),
    'static',
  );
  assert.equal(
    filmResourceReason(request(origin + '/streak-view.js', { method: 'POST' }), policy),
    'method',
  );
  assert.equal(
    filmResourceReason(request('https://other.invalid/streak-view.js'), policy),
    'external',
  );
  for (const path of [
    '/streak-view.js?extra=1',
    '/streak-view.js#extra',
    '/streak-view-extra.js',
    '/api/streak-view.js',
  ])
    assert.equal(filmResourceReason(request(origin + path), policy), 'unknown-static');
  assert.equal(
    filmResourceReason(request('blob:' + origin + '/streak-view.js'), policy),
    'unowned-blob',
  );
});

test('mobile film badge clears the maximum crystal push without shrinking subject or changing desktop anchor', async () => {
  const css = await readFile(new URL('../public/film.css', import.meta.url), 'utf8');
  const mobileStart = css.lastIndexOf('@media (max-width: 700px) {');
  assert.ok(mobileStart > 0);
  const mobile = css.slice(mobileStart, css.indexOf('@media', mobileStart + 1));
  assert.match(
    mobile,
    /#film-art \.growth-fallback\s*\{\s*top:\s*calc\(104% \+ 8px\);\s*margin-top:\s*0;\s*\}/,
  );
  const defaultBadge = css.match(/#film-art \.growth-fallback\s*\{([^}]+)\}/)?.[1];
  assert.ok(defaultBadge);
  assert.match(defaultBadge, /top:\s*100%;/);
  assert.match(defaultBadge, /margin-top:\s*8px;/);
  assert.match(defaultBadge, /height:\s*44px;/);
  assert.doesNotMatch(
    mobile,
    /#film-art \.growth-fallback\s*\{[^}]*\b(?:height|width|scale|transform):/,
  );
  assert.match(css, /transform:\s*scale\(var\(--film-push, 1\)\)/);
  assert.match(mobile, /#film-caption\s*\{[^}]*font-size:\s*28px;/);
  assert.match(
    css,
    /\[data-film-scene='3'\] #film-art \.growth-fallback\s*\{\s*animation:\s*film-ring 600ms ease-out;/,
  );
});

test('mobile reduced SVG has a larger static contain frame without changing the stage or raster measurement', async () => {
  const css = await readFile(new URL('../public/film.css', import.meta.url), 'utf8');
  const block = css.match(
    /@media \(max-width: 700px\) and \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?#film-art > img\.crystal\s*\{([^}]+)\}/,
  )?.[1];
  assert.ok(block);
  assert.match(block, /inset:\s*-4% auto auto -14%;/);
  assert.match(block, /width:\s*128%;/);
  assert.match(block, /height:\s*108%;/);
  assert.match(block, /object-fit:\s*contain;/);
  assert.match(block, /transform:\s*none;/);
  assert.match(block, /transition:\s*none;/);
  assert.doesNotMatch(block, /animation:|#film-stage|canvas/);
  assert.match(css, /top:\s*calc\(104% \+ 8px\)/);
  assert.match(css, /height:\s*max\(620px, calc\(100svh - 24px\)\)/);
});
