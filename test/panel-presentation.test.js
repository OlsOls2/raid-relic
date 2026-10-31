// Authored for parent execution only: public source contracts, no browser/provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { EDITION_CONFIG } from '../public/editions.js';
import { localOverlayArrival, validSnapshot } from '../public/overlay-client.js';

const read = (file) => readFile(new URL('../' + file, import.meta.url), 'utf8');
const compact = (value) => value.replace(/\s+/g, '');
const canonical = {
  deep: '#101d30',
  slate: '#26354b',
  moon: '#e3e8ef',
  muted: '#bbc6d7',
  amber: '#dba95c',
  violet: '#b7a2df',
};
test('six shared colors and existing Atlas/film aliases use the prescribed palette', async () => {
  const fonts = await read('public/fonts.css');
  for (const [name, color] of Object.entries(canonical))
    assert.match(fonts, new RegExp(`--rr-${name}:\\s*${color};`));
  assert.match(fonts, /font-family:\s*Cinzel, Georgia, serif !important/);
  const atlas = await read('public/atlas.css');
  for (const name of Object.keys(canonical))
    assert.ok(compact(atlas).includes(`--${name}:var(--rr-${name});`));
  const film = await read('public/film.css');
  for (const [alias, name] of Object.entries({
    navy: 'deep',
    silver: 'moon',
    gold: 'amber',
    quiet: 'muted',
    purple: 'violet',
  }))
    assert.ok(compact(film).includes(`--${alias}:var(--rr-${name});`));
  assert.doesNotMatch(film, /#[0-9a-f]{3,8}\b/i);
  // Preserved gradient positions and alpha weights, now derived from canonical colors.
  for (const declaration of [
    'filter: drop-shadow(0 0 12px color-mix(in srgb, var(--rr-violet) 33.333333%, transparent));',
    'border-top: 1px solid color-mix(in srgb, var(--rr-violet) 40%, transparent);',
    'background: var(--rr-slate);',
    'border: 1px solid color-mix(in srgb, var(--rr-violet) 50.196078%, transparent);',
    'background: radial-gradient(ellipse at 35% 40%, var(--rr-slate) 0%, var(--rr-deep) 65%);',
    'background: radial-gradient(ellipse at 45% 30%, var(--rr-violet) 0%, var(--rr-deep) 65%);',
    'border-left: 1px solid color-mix(in srgb, var(--rr-violet) 40%, transparent);',
  ])
    assert.ok(compact(film).includes(compact(declaration)), declaration);
  assert.equal(
    compact(film).split(
      compact('background: color-mix(in srgb, var(--rr-deep) 92.941176%, transparent);'),
    ).length - 1,
    2,
  );
});

test('Forge/recap/shared-history load the existing face and retain legible body typography', async () => {
  for (const page of ['forge', 'recap', 'my-marks']) {
    const html = await read('public/' + page + '.html');
    assert.equal((html.match(/href="\/fonts.css"/g) ?? []).length, 1);
  }
  for (const page of ['forge', 'recap']) {
    const css = await read('public/' + page + '.css');
    assert.match(css, /16px\/1\.6 system-ui/);
    assert.match(compact(css), /clamp\(36px,6vw,6[24]px\)\/1\.1[2]?Cinzel,Georgia,/);
    assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
    for (const declaration of [
      'background: var(--rr-deep);',
      'color: var(--rr-moon);',
      'color: var(--rr-amber);',
      'background: var(--rr-slate);',
      'border: 1px solid var(--rr-violet);',
      'outline: 2px solid var(--rr-amber);',
      'color: var(--rr-muted);',
      'color: var(--rr-deep);',
      'background: var(--rr-amber);',
    ])
      assert.ok(compact(css).includes(compact(declaration)), page + ':' + declaration);
    if (page === 'forge')
      assert.ok(compact(css).includes(compact('border-left: 2px solid var(--rr-violet);')));
    else
      assert.ok(
        compact(css).includes(
          compact(
            'border-bottom: 1px solid color-mix(in srgb, var(--rr-violet) 20%, transparent);',
          ),
        ),
      );
  }
  assert.match(await read('public/atlas.css'), /body\s*\{\s*font-size:\s*16px;/);
});

test('edition change is cosmetic: exact palette, original crystal geometry and particle bounds', () => {
  const edition = EDITION_CONFIG[0];
  assert.deepEqual(edition.design, {
    version: 1,
    shape: 'crystal',
    facets: 8,
    aspect: 1.05,
    palette: [canonical.deep, canonical.moon, canonical.violet, canonical.amber],
  });
  assert.deepEqual(edition.particles, { kind: 'orbit-dust', count: 64 });
});

// Import ONLY the actual dependency-free exported presentation function. Importing
// the full overlay module in Node would initialize DOM/audio/transport instead.
async function labelFunction() {
  const source = await read('public/overlay.js');
  const declaration = source.match(
    /^export function carriedRuneLabel\(handoff\) \{[\s\S]*?^\}/m,
  )?.[0];
  assert.ok(declaration, 'isolated public presentation function must remain explicit');
  return (await import('data:text/javascript,' + encodeURIComponent(declaration))).carriedRuneLabel;
}
test('carried label is optional, bounded and completed verified landing only', async () => {
  const label = await labelFunction();
  const base = {
    ...localOverlayArrival('host', 1000).handoff,
    completed: true,
    completedAt: 2000,
  };
  assert.equal(label(null), null);
  assert.equal(label(undefined), null);
  assert.equal(label(base), null);
  for (const value of [undefined, null, '0', '2', -1, 161, 0.5, NaN, Infinity, {}, []])
    assert.equal(label({ ...base, carriedApprovedCount: value }), null);
  for (const [value, text] of [
    [0, 'No approved runes carried'],
    [1, '1 approved runes carried'],
    [160, '160 approved runes carried'],
  ])
    assert.equal(label({ ...base, carriedApprovedCount: value }), text);
  for (const patch of [
    { completed: false },
    { completed: 'true' },
    { clockPolicy: undefined },
    { clockPolicy: 'preclaim-v1' },
    { completedAt: undefined },
    { completedAt: NaN },
    { completedAt: 999 },
    { completedAt: base.endsAt },
    { startedAt: Infinity },
  ])
    assert.equal(label({ ...base, carriedApprovedCount: 0, ...patch }), null);
});
test('optional count never substitutes current marks and is tolerated by existing public snapshot validation', async () => {
  const label = await labelFunction();
  const snapshot = localOverlayArrival('host', 1000);
  snapshot.serverNow = 3000;
  snapshot.handoff = {
    ...snapshot.handoff,
    completed: true,
    completedAt: 2000,
    carriedApprovedCount: 7,
  };
  assert.ok(validSnapshot(snapshot));
  assert.equal(snapshot.approvedCount, 0);
  assert.equal(label(snapshot.handoff), '7 approved runes carried');
  delete snapshot.handoff.carriedApprovedCount;
  assert.ok(validSnapshot(snapshot));
  assert.equal(label(snapshot.handoff), null);
});

test('one public presentation harness selects default hero or explicit matrix without a duplicate guarded script', async () => {
  const source = await read('scripts/browser-smoke-atlas-hero.js');
  const declaration = source.match(/^export function presentationMode\(args\) \{[\s\S]*?^\}/m)?.[0];
  assert.ok(declaration, 'closed selector remains independently inspectable');
  // Evaluate only the real pure selector, never import/start the browser harness.
  const { presentationMode } = await import(
    'data:text/javascript,' + encodeURIComponent(declaration)
  );
  assert.equal(presentationMode([]), 'hero');
  assert.equal(presentationMode(['--panel-presentation']), 'panel-presentation');
  for (const args of [
    ['--hero'],
    ['--unknown'],
    ['./another-script.js'],
    ['--panel-presentation=1'],
    ['--panel-presentation', '--panel-presentation'],
    ['--panel-presentation', './another-script.js'],
  ])
    assert.throws(() => presentationMode(args), /Expected no arguments or --panel-presentation/);
  assert.match(source, /const mode\s*=\s*presentationMode\(process\.argv\.slice\(2\)\);/);
  assert.match(
    source,
    /if\s*\(mode === ['"]panel-presentation['"]\)\s*await runPanelPresentation\(\);\s*else\s*await runColdHero\(\);/,
  );
  assert.equal((source.match(/await runPanelPresentation\(\)/g) ?? []).length, 1);
  assert.equal((source.match(/await runColdHero\(\)/g) ?? []).length, 1);
  assert.doesNotMatch(source, /\bimport\s*\(/, 'no dynamic path/module loading');
  const start = source.indexOf('async function runColdHero()');
  const end = source.indexOf('async function runPanelPresentation()');
  assert.ok(start > 0 && end > start);
  const hero = source.slice(start, end);
  assert.match(hero, /async function waitForColdSettle\(page\)/);
  assert.match(hero, /attempt < 8/);
  assert.match(hero, /const elapsed = performance\.now\(\) - start/);
  assert.match(hero, /Number\.isFinite\(elapsed\) && elapsed >= 0 && elapsed <= 5000/);
  assert.match(hero, /const remaining = 3000 - elapsed/);
  assert.match(hero, /if \(remaining <= 0\) return elapsed/);
  assert.match(hero, /waitForTimeout\(Math\.ceil\(remaining\) \+ 5\)/);
  assert.match(hero, /const settledElapsedMs = await waitForColdSettle\(page\)/);
  assert.match(hero, /assert\.ok\(settledElapsedMs >= 3000\)/);
  assert.match(hero, /artifacts\/atlas-hero-browser-results\.json/);
  assert.doesNotMatch(hero, /fontRows|layoutRows|await runPanelPresentation/);
  for (const field of [
    'passed',
    'stage',
    'failureCategory',
    'checks',
    'diagnostic',
    'handoffSamples',
    'captureFiles',
    'silhouetteAlignmentProven',
  ])
    assert.ok(hero.includes(field));
  const matrix = source.slice(end, source.indexOf('const mode = presentationMode'));
  assert.match(matrix, /artifacts\/panel-presentation-browser-results\.json/);
  assert.match(matrix, /captures\.size < 4/);
  assert.match(matrix, /Buffer\.byteLength\(report\) <= 65536/);
  assert.doesNotMatch(matrix, /await runColdHero/);
  await assert.rejects(read('scripts/browser-smoke-panel-presentation.js'), { code: 'ENOENT' });
});

test('Keeper has one default-closed accessible verification drawer retaining every warning', async () => {
  const html = await read('public/keeper.html');
  const drawers = [...html.matchAll(/<details\b[^>]*\bid="how-we-verify"[^>]*>/g)];
  assert.equal(drawers.length, 1);
  assert.doesNotMatch(drawers[0][0], /\bopen(?:\s|=|>)/);
  assert.match(drawers[0][0], /aria-labelledby="keeper-verification-title"/);
  const drawer = html.slice(
    drawers[0].index,
    html.indexOf('</details>', drawers[0].index) + '</details>'.length,
  );
  assert.match(
    drawer,
    /<summary\b[^>]*\bid="keeper-verification-title"[^>]*\baria-controls="keeper-verification-copy"[^>]*>\s*How we verify\s*<\/summary>/,
  );
  assert.match(drawer, /<div id="keeper-verification-copy">/);
  const copy = drawer.replace(/\s+/g, ' ');
  for (const warning of [
    'Received rings record verified two-chat claims or explicitly labelled Wander idle transfers.',
    'They do not measure retained viewers or conference attendance.',
    'Presence and audience are not proof of new or retained viewers.',
    'Records cover retained completed stops only; earlier holds and raider participation may be unknown.',
    'Chat location is not proof of raid membership.',
    'Only approved engravings are public; pending text and private participant IDs are not shown here.',
    'Saved downloads cannot be recalled after erasure. Each download checks the current public record again.',
    'The only creator test channels are raidrelichq, olsols2 and olsols3.',
    'Owner-operated test raids are not community adoption.',
    'Operator admission and broadcaster consent remain required.',
  ]) {
    assert.ok(copy.includes(warning), warning);
    assert.equal(
      html.replace(/\s+/g, ' ').split(warning).length - 1,
      1,
      'warning is not duplicated outside drawer',
    );
  }
  const receiving = await read('public/receiving.js');
  assert.match(
    receiving,
    /status\.textContent\s*=\s*login\s*\?\s*'Current retained Keeper record\.'/,
  );
  assert.match(receiving, /index\s*<\s*3\s*\?\s*content\s*:\s*moreBody/);
  assert.match(receiving, /if\s*\(p\.received\.length\s*>\s*3\)\s*content\.append\(more\)/);
});

test('Keeper measurement excludes nonzero closed-details rectangles and measures summary/expand/reclose states', async () => {
  const source = await read('scripts/browser-smoke-atlas-hero.js');
  const start = source.indexOf('async function keeperPresentationState(page)');
  const end = source.indexOf('async function layout(', start);
  assert.ok(start >= 0 && end > start);
  const { keeperPresentationState } = await import(
    'data:text/javascript,' + encodeURIComponent('export ' + source.slice(start, end).trim())
  );
  // Deterministic DOM-contract regression for the exact bug: the fourth article
  // reports a positive box while its details ancestor is closed. This isolated
  // fixture is not browser proof; the optional matrix measures the real DOM too.
  function element(tagName, parentElement = null, kind = '') {
    const node = {
      tagName,
      parentElement,
      children: [],
      hidden: false,
      open: false,
      id: kind === 'verification' ? 'how-we-verify' : '',
      classList: { contains: (name) => name === 'keeper-more' && kind === 'more' },
      getBoundingClientRect: () => ({
        x: 20,
        y: 100,
        width: 320,
        height: 180,
        top: 100,
        bottom: 280,
        left: 20,
        right: 340,
      }),
      contains(target) {
        for (let n = target; n; n = n.parentElement) if (n === this) return true;
        return false;
      },
      querySelector(selector) {
        assert.equal(selector, ':scope > summary');
        return this.children.find((child) => child.tagName === 'SUMMARY') ?? null;
      },
      closest(selector) {
        assert.equal(selector, '.keeper-more');
        for (let n = this; n; n = n.parentElement)
          if (n.classList.contains('keeper-more')) return n;
        return null;
      },
    };
    parentElement?.children.push(node);
    return node;
  }
  const main = element('MAIN');
  const verification = element('DETAILS', main, 'verification');
  element('SUMMARY', verification).textContent = 'How we verify';
  const copy = element('DIV', verification);
  const warnings = Array.from({ length: 4 }, () => element('P', copy));
  const articles = Array.from({ length: 3 }, () => element('ARTICLE', main));
  const more = element('DETAILS', main, 'more');
  element('SUMMARY', more).textContent = '+1 more received rings';
  const body = element('DIV', more);
  articles.push(element('ARTICLE', body));
  const document = {
    querySelector(selector) {
      if (selector === '.keeper-more') return more;
      if (selector === '#how-we-verify') return verification;
      if (selector === '#keeper-verification-copy') return copy;
      throw Error('Unexpected closed fixture selector');
    },
    querySelectorAll(selector) {
      if (selector === '.keeper-arrival') return articles;
      if (selector === '.keeper-more') return [more];
      if (selector === '#how-we-verify') return [verification];
      assert.ok(selector.includes('#keeper-verification-copy > p'));
      return [verification, ...warnings];
    },
  };
  const page = {
    evaluate(callback) {
      const result = runInNewContext(
        '(' + callback.toString() + ')()',
        {
          document,
          location: { pathname: '/keeper/olsols2' },
          innerWidth: 390,
          innerHeight: 844,
          getComputedStyle: () => ({
            display: 'block',
            visibility: 'visible',
            contentVisibility: 'visible',
            opacity: '1',
          }),
        },
        { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } },
      );
      return JSON.parse(JSON.stringify(result));
    },
  };
  const closed = await keeperPresentationState(page);
  assert.equal(closed.received, 4);
  assert.equal(closed.visibleReceived, 3);
  assert.ok(closed.entries[3].rect.height > 0);
  assert.equal(closed.entries[3].visible, false);
  assert.equal(closed.entries[3].closedAncestorCount, 1);
  assert.equal(closed.moreSummaryMetadata.visible, true);
  assert.equal(closed.moreSummaryMetadata.detailsAncestors[0].inSummary, true);
  assert.equal(closed.moreAdvertised, 1);
  assert.equal(closed.caveats, 1);
  assert.equal(closed.verificationCopy.visible, false);
  more.open = true;
  const expanded = await keeperPresentationState(page);
  assert.equal(expanded.visibleReceived, 4);
  assert.ok(expanded.entries.every((entry) => entry.closedAncestorCount === 0));
  more.open = false;
  assert.equal((await keeperPresentationState(page)).visibleReceived, 3);
  verification.open = true;
  assert.equal((await keeperPresentationState(page)).verificationCopy.visible, true);
});

test('carried supplement preserves core counters, titles and labels, and clears only its own description', async () => {
  const source = await read('public/overlay.js');
  const declaration = source.match(
    /^export function presentCarriedSummary\(summary, counters, label\) \{[\s\S]*?^\}/m,
  )?.[0];
  assert.ok(declaration);
  const { presentCarriedSummary: present } = await import(
    'data:text/javascript,' + encodeURIComponent(declaration)
  );
  const node = (text, attributes = {}) => ({
    textContent: text,
    getAttribute(key) {
      return attributes[key] ?? null;
    },
    setAttribute(key, value) {
      attributes[key] = value;
    },
    removeAttribute(key) {
      delete attributes[key];
    },
  });
  const summary = { id: 'carried-summary', textContent: '', hidden: true };
  for (const core of ['Charge 0/160 · Rings 1', 'Ring 1 · S2 · 3 runes', '3 approved runes']) {
    const counter = node(core, {
      title: 'Tracked streak',
      'aria-label': 'Existing ring and streak',
      'aria-describedby': 'existing-description',
    });
    for (const label of [
      null,
      'No approved runes carried',
      '1 approved runes carried',
      '7 approved runes carried',
      null,
    ]) {
      present(summary, [counter], label);
      assert.equal(counter.textContent, core);
      assert.equal(counter.getAttribute('title'), 'Tracked streak');
      assert.equal(counter.getAttribute('aria-label'), 'Existing ring and streak');
      assert.equal(
        counter.getAttribute('aria-describedby'),
        label === null ? 'existing-description' : 'existing-description carried-summary',
      );
      assert.equal(summary.textContent, label ?? '');
      assert.equal(summary.hidden, label === null);
    }
  }
  const plain = node('0 approved runes');
  present(summary, [plain], 'No approved runes carried');
  present(summary, [plain], '7 approved runes carried');
  assert.equal(plain.getAttribute('aria-describedby'), 'carried-summary');
  present(summary, [plain], null);
  assert.equal(plain.getAttribute('aria-describedby'), null);
  assert.equal((source.match(/createElement\('span'\);\s*carriedSummary\.id/g) ?? []).length, 1);
  assert.doesNotMatch(source, /(?:count|compact)\.textContent\s*=\s*carried\b/);
});
