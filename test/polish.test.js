import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER } from '../test-support/pilot-fixture.js';
import { releaseFiles } from '../scripts/release-files.js';

test('brand-new configured channels expose truthful waiting/zero state with no provider work or unknown-channel access', async () => {
  const f = await pilotFixture();
  for (const id of [HOME, OTHER]) {
    const response = await f.request(`/api/overlay/${id}`);
    assert.equal(response.status, 200);
    const snapshot = JSON.parse(response.body);
    assert.equal(snapshot.status, 'waiting');
    assert.equal(snapshot.approvedCount, 0);
    assert.equal(snapshot.lineageRings, 0);
    assert.equal(snapshot.handoff, null);
    assert.deepEqual(snapshot.marks, []);
    assert.ok(!JSON.stringify(snapshot).includes('streamId'));
    assert.ok(!JSON.stringify(snapshot).includes('userId'));
  }
  const atlas = JSON.parse((await f.request('/api/atlas')).body);
  assert.equal(atlas.total, 0);
  assert.deepEqual(atlas.stops, []);
  assert.equal((await f.request('/overlay/999')).status, 404);
  assert.equal(f.calls.length, 0);
});
test('polish keeps source and corner assets accessible and excludes local browser harness/demo from release', async () => {
  const html = await readFile('public/overlay-live.html', 'utf8');
  assert.match(html, /id="waiting-note"\s+hidden>\s*No active relic state for this channel/);
  assert.match(html, /id="status" role="status" aria-live="polite"/);
  assert.match(html, /aria-label="Enable optional overlay sounds"/);
  const files = await releaseFiles(process.cwd());
  assert.ok(
    files.every(
      ({ file }) =>
        !file.startsWith('scripts/') &&
        !file.startsWith('docs/') &&
        !file.startsWith('test-support/'),
    ),
  );
  const demo = await readFile('docs/DEMO_SCRIPT.md', 'utf8');
  assert.match(demo, /2:45/);
  assert.match(demo, /01a1705c-a87d-7143-80f6-021e47b78ced/);
  assert.match(demo, /not evidence of completed live validation/);
});
test('archive palette provides AA normal-text contrast without external typography/assets', async () => {
  const fonts = await readFile('public/fonts.css', 'utf8');
  const css = await readFile('public/atlas.css', 'utf8');
  // Narrow local palette model: shared canonical declarations followed by Atlas
  // aliases, with later root declarations winning. No CSS imports/evaluation,
  // computed layout, fallbacks or arbitrary color expressions are interpreted.
  const tokens = new Map();
  const hex = /^#[a-f0-9]{6}$/i;
  const variable = /^var\(\s*(--[a-z][a-z0-9-]{0,63})\s*\)$/i;
  for (const source of [fonts, css]) {
    assert.ok(source.length <= 131072, 'Bounded local stylesheet');
    const roots = [...source.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/:root\s*\{([^{}]*)\}/g)];
    assert.ok(roots.length > 0 && roots.length <= 8, 'Bounded explicit root declarations');
    for (const root of roots)
      for (const declaration of root[1].matchAll(/(--[a-z][a-z0-9-]{0,63})\s*:\s*([^;{}]+);/gi)) {
        const value = declaration[2].trim();
        assert.ok(hex.test(value) || variable.test(value), 'Unsupported palette declaration');
        tokens.set(declaration[1], value);
        assert.ok(tokens.size <= 32, 'Bounded local custom properties');
      }
  }
  const resolve = (name, declarations = tokens, seen = new Set(), depth = 0) => {
    assert.ok(depth < 8, 'Palette variable depth exceeded');
    assert.ok(!seen.has(name), 'Palette variable cycle');
    assert.ok(declarations.has(name), `Unresolved palette variable ${name}`);
    const value = declarations.get(name);
    if (hex.test(value)) return value.toLowerCase();
    const match = variable.exec(value);
    assert.ok(match, 'Unsupported palette expression');
    return resolve(match[1], declarations, new Set([...seen, name]), depth + 1);
  };
  const color = (token) => resolve('--' + token);
  const required = {
    deep: '#101d30',
    slate: '#26354b',
    moon: '#e3e8ef',
    muted: '#bbc6d7',
    amber: '#dba95c',
    violet: '#b7a2df',
  };
  assert.deepEqual(
    Object.fromEntries(Object.keys(required).map((token) => [token, color(token)])),
    required,
  );
  // Rejection behavior belongs to this same named test, so a targeted parent
  // rerun also checks the resolver rather than assuming its failure bounds.
  assert.throws(() => resolve('--missing'), /Unresolved palette variable/);
  assert.throws(
    () =>
      resolve(
        '--a',
        new Map([
          ['--a', 'var(--b)'],
          ['--b', 'var(--a)'],
        ]),
      ),
    /Palette variable cycle/,
  );
  assert.throws(
    () => resolve('--a', new Map([['--a', 'var(--missing)']])),
    /Unresolved palette variable/,
  );
  const deepChain = new Map(
    Array.from({ length: 9 }, (_, index) => [
      '--step-' + index,
      index === 8 ? '#101d30' : `var(--step-${index + 1})`,
    ]),
  );
  assert.throws(() => resolve('--step-0', deepChain), /Palette variable depth exceeded/);
  assert.throws(
    () => resolve('--a', new Map([['--a', 'rgb(0,0,0)']])),
    /Unsupported palette expression/,
  );
  const luminance = (hex) =>
    hex
      .slice(1)
      .match(/../g)
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  for (const foreground of ['moon', 'muted', 'amber', 'violet']) {
    const values = [luminance(color(foreground)), luminance(color('deep'))].sort((a, b) => b - a);
    assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5, foreground);
  }
  assert.ok(!/@import|https?:\/\/|@font-face/i.test(css));
  // The existing pinned local Cinzel face is legitimate; external font/assets
  // and imports remain forbidden in both files, not silently exempted.
  assert.doesNotMatch(fonts, /@import|https?:\/\//i);
  const faces = [...fonts.matchAll(/@font-face\s*\{([^{}]*)\}/gi)];
  assert.equal(faces.length, 1);
  assert.match(faces[0][1], /font-family\s*:\s*Cinzel\s*;/);
  assert.match(
    faces[0][1],
    /src\s*:\s*url\(\s*(['"])\/fonts\/Cinzel\.ttf\1\s*\)\s*format\(\s*(['"])truetype\2\s*\)\s*;/,
  );
  assert.deepEqual(
    [...fonts.matchAll(/url\(\s*(['"]?)([^'"\s)]+)\1\s*\)/gi)].map((match) => match[2]),
    ['/fonts/Cinzel.ttf'],
  );
  assert.match(
    fonts,
    /Cinzel, Google Fonts pinned 3dd78844021e948ceb633d1dcee3f7885561b5d9; SIL OFL 1\.1\./,
  );
});
