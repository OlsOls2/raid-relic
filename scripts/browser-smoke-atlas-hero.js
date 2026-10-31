// LOCAL mock runtime only. No live pages, provider access or screenshot-cap changes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { visualReview, growthPixels } from '../test-support/visual-review.js';
import { HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';

// One public-presentation harness, two mutually exclusive local workloads.
// No argument retains the established cold hero workflow and report schema.
export function presentationMode(args) {
  if (args.length === 0) return 'hero';
  if (args.length === 1 && args[0] === '--panel-presentation') return 'panel-presentation';
  throw Error('Expected no arguments or --panel-presentation');
}

async function runColdHero() {
  // Real monotonic deadline: timer completion alone cannot establish three seconds.
  async function waitForColdSettle(page) {
    const start = performance.now();
    for (let attempt = 0; attempt < 8; attempt++) {
      const elapsed = performance.now() - start;
      assert.ok(Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 5000);
      const remaining = 3000 - elapsed;
      if (remaining <= 0) return elapsed;
      await page.waitForTimeout(Math.ceil(remaining) + 5);
    }
    throw Error('Cold settle monotonic deadline not reached');
  }
  let review,
    activePage,
    stage = 'setup',
    passed = false,
    failureCategory = null;
  const checks = [],
    diagnostic = {},
    handoffSamples = [],
    captures = new Map();
  // First load: three genuine clipped captures only, unchanged raster/PNG bounds.
  // Numeric before/during/after samples are retained for all three cold loads.
  async function handoffSample(page, load, phase) {
    const read = () =>
      page.evaluate(() => {
        const root = document.querySelector('#atlas-relic');
        const canvas = root.querySelector('canvas.relic3d');
        const rect = root.getBoundingClientRect();
        return {
          svgOpacity: Number(getComputedStyle(root.querySelector('img')).opacity),
          canvasOpacity: canvas ? Number(getComputedStyle(canvas).opacity) : 0,
          frames: Number(canvas?.dataset.frames ?? 0),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      });
    const before = await read();
    if (phase === 'before') {
      assert.equal(before.svgOpacity, 1);
      assert.equal(before.frames, 0);
    } else if (phase === 'during') {
      assert.ok(before.frames > 0 && before.canvasOpacity > 0 && before.canvasOpacity < 1);
    } else assert.equal(before.canvasOpacity, 1);
    let bytes = 0;
    if (load === 0 && process.env.ATLAS_HERO_CAPTURE === '1') {
      const clip = { x: before.x, y: before.y, width: before.width, height: before.height + 60 };
      const viewport = page.viewportSize();
      assert.ok(clip.x >= 0 && clip.y >= 0);
      assert.ok(clip.x + clip.width <= viewport.width && clip.y + clip.height <= viewport.height);
      assert.ok(Math.ceil(clip.width) * Math.ceil(clip.height) * 4 <= 4 * 1024 * 1024);
      assert.ok(captures.size < 3);
      const png = await page.screenshot({ fullPage: false, clip });
      assert.ok(png.length <= 524288);
      assert.ok(
        [...captures.values()].reduce((sum, p) => sum + p.length, png.length) <= 4 * 1024 * 1024,
      );
      bytes = png.length;
      captures.set('atlas-hero-' + phase + '.png', png);
    }
    const after = await read();
    handoffSamples.push({
      load,
      phase,
      before,
      after,
      bytes,
      captureStayedIntermediate:
        bytes > 0 && phase === 'during' && after.canvasOpacity > 0 && after.canvasOpacity < 1,
    });
  }
  const geometry = (page) =>
    page.evaluate(() => {
      const root = document.querySelector('#atlas-relic');
      const box = (node) => {
        const b = node.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width, height: b.height };
      };
      const art = root.querySelector('canvas.relic3d') ?? root.querySelector('img');
      const pill = root.querySelector('.atlas-ring-pill');
      const a = art.getBoundingClientRect(),
        b = pill?.getBoundingClientRect();
      return {
        root: box(root),
        art: box(art),
        image: box(root.querySelector('img')),
        keeperY: document.querySelector('#receiving').getBoundingClientRect().y,
        pillHeight: b?.height ?? 0,
        overlap: b
          ? Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
            Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))
          : 0,
        total: Number(root.dataset.rings),
        label: pill?.textContent.trim(),
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
  try {
    review = await visualReview();
    const { fixture: f, context, origin } = review;
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    stage = 'zero-count';
    await review.page.goto(origin + '/atlas/');
    await review.page.waitForFunction(
      () => document.querySelector('#atlas-relic')?.dataset.rings === '0',
    );
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
    await review.page.locator('#atlas-relic .atlas-ring-pill').waitFor({ state: 'attached' });
    assert.equal(await review.page.locator('#atlas-relic .atlas-ring-pill').isVisible(), false);
    await f.control(HOME, `send:${OTHER}`);
    await f.raid(HOME, OTHER, 1);
    await f.chat(HOME, '8201', '!offer');
    await f.chat(OTHER, '8202', '!accept');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    await review.page.close();
    const loads = [];
    for (let i = 0; i < 3; i++) {
      stage = 'cold-fallback';
      const page = await context.newPage();
      activePage = page;
      review.observe(page);
      await page.setViewportSize({ width: 1920, height: 1080 });
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      let release;
      const blocked = new Promise((resolve) => {
        release = resolve;
      });
      await page.route('**/vendor/three*.js', async (route) => {
        await blocked;
        await route.continue();
      });
      // Compare like-for-like cold loads: the front door and Atlas intentionally
      // have different text/intro geometry. Atlas is exercised separately
      // by the Atlas3D workflow; all three uncached hero loads remain real.
      await page.goto(origin + '/', { waitUntil: 'domcontentloaded' });
      await page.bringToFront();
      await page.waitForFunction(
        () => document.querySelector('#atlas-relic')?.dataset.rings === '1',
      );
      await page.evaluate(async () => {
        await document.fonts.ready;
        await document.querySelector('#atlas-relic > img').decode();
      });
      // Decoding and font readiness do not finish CSS transitions. The edition
      // selector changes fallback opacity from zero to one over 300ms; keep the
      // optional vendor held until the actual visible fallback has settled.
      await page.waitForFunction(
        () => {
          const root = document.querySelector('#atlas-relic');
          const img = root?.querySelector(':scope > img');
          if (!img) return false;
          const style = getComputedStyle(img),
            box = img.getBoundingClientRect();
          return (
            img.complete &&
            img.naturalWidth > 0 &&
            box.width > 0 &&
            box.height > 0 &&
            style.opacity === '1' &&
            style.visibility === 'visible' &&
            style.display !== 'none' &&
            !root.classList.contains('webgl-relic') &&
            Number(root.querySelector('canvas.relic3d')?.dataset.frames ?? 0) === 0
          );
        },
        undefined,
        { timeout: 5000 },
      );
      const before = await geometry(page);
      assert.ok(before.root.width >= 440);
      assert.equal(before.root.width, before.root.height);
      assert.equal(
        await page.locator('#atlas-relic > img').evaluate((img) => getComputedStyle(img).opacity),
        '1',
      );
      await handoffSample(page, i, 'before');
      release();
      stage = 'first-frame-crossfade';
      await page.waitForFunction(() => {
        const c = document.querySelector('#atlas-relic canvas.relic3d');
        const opacity = c && Number(getComputedStyle(c).opacity);
        return Number(c?.dataset.frames) > 0 && opacity > 0 && opacity < 1;
      });
      await handoffSample(page, i, 'during');
      await page.waitForFunction(
        () => Number(getComputedStyle(document.querySelector('#atlas-relic canvas')).opacity) === 1,
      );
      stage = 'cold-settle-wall-time';
      const settledElapsedMs = await waitForColdSettle(page);
      assert.ok(settledElapsedMs >= 3000);
      stage = 'cold-settled-geometry';
      const after = await geometry(page);
      await handoffSample(page, i, 'after');
      for (const key of ['x', 'y', 'width', 'height']) {
        assert.ok(Math.abs(after.root[key] - before.root[key]) <= 2);
        assert.ok(Math.abs(after.art[key] - after.image[key]) <= 2);
      }
      assert.ok(Math.abs(after.keeperY - before.keeperY) <= 2);
      assert.equal(after.label, 'Ring 1');
      assert.equal(after.total, 1);
      assert.equal(after.overlap, 0);
      assert.equal(after.pillHeight, 44);
      assert.equal(after.overflow, false);
      assert.ok(await growthPixels(page, async () => {}));
      const limits = await page.locator('#atlas-relic canvas').evaluate((c) => ({
        width: c.width,
        height: c.height,
        triangles: Number(c.dataset.triangles),
      }));
      assert.ok(limits.width <= 480 && limits.height <= 480 && limits.triangles < 20000);
      loads.push({ ...after, settledElapsedMs });
      if (i === 2) {
        stage = 'mobile-reduced-fallback';
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.waitForFunction(() => !document.querySelector('#atlas-relic canvas'));
        for (const width of [320, 390, 650]) {
          await page.setViewportSize({ width, height: 844 });
          await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
          const mobile = await geometry(page);
          assert.ok(mobile.root.width >= width * 0.6);
          assert.equal(mobile.overlap, 0);
          assert.equal(mobile.pillHeight, 44);
          assert.equal(mobile.overflow, false);
          assert.equal(await page.locator('#atlas-relic > img').isVisible(), true);
        }
        await page.evaluate(async () => {
          await document.querySelector('#atlas-relic > img').decode();
        });
      }
      await page.close();
    }
    stage = 'three-cold-loads-same-route';
    diagnostic.coldLoadRects = loads.map((load) =>
      Object.fromEntries([
        ...['x', 'y', 'width', 'height'].map((key) => [
          key,
          Math.round(load.root[key] * 100) / 100,
        ]),
        ['settledElapsedMs', Math.round(load.settledElapsedMs)],
      ]),
    );
    for (const load of loads.slice(1))
      for (const key of ['x', 'y', 'width', 'height'])
        assert.ok(Math.abs(load.root[key] - loads[0].root[key]) <= 2);
    checks.push({
      name: 'Three uncached loads: reserved 480px square, first-frame 300ms crossfade, real GL pixels, stable geometry and unobstructed 44px Ring pill',
      passed: true,
    });
    checks.push({
      name: 'Reduced-motion SVG preserves true count, mobile >=60vw and no horizontal overflow; original raster/triangle caps',
      passed: true,
    });
    assert.deepEqual(review.stats(), { errors: 0, external: 0 });
    passed = true;
  } catch (error) {
    failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(error?.name)
      ? error.name
      : 'fixture-or-browser';
    diagnostic.assertionLine = Number(
      /browser-smoke-atlas-hero[.]js:(\d+)/.exec(error?.stack ?? '')?.[1] ?? 0,
    );
    try {
      if (activePage && !activePage.isClosed())
        Object.assign(
          diagnostic,
          await activePage.evaluate(() => {
            const root = document.querySelector('#atlas-relic');
            const img = root?.querySelector(':scope > img');
            const box = img?.getBoundingClientRect();
            return {
              fallbackOpacityMilli: img
                ? Math.round(Number(getComputedStyle(img).opacity) * 1000)
                : -1,
              fallbackWidthPx: Math.round(box?.width ?? 0),
              fallbackHeightPx: Math.round(box?.height ?? 0),
              fallbackDecoded: Number(Boolean(img?.complete && img.naturalWidth > 0)),
              heroWebgl: Number(root?.classList.contains('webgl-relic') === true),
              heroFrames: Number(root?.querySelector('canvas.relic3d')?.dataset.frames ?? 0),
            };
          }),
        );
    } catch {
      diagnostic.domDiagnosticUnavailable = 1;
    }
  } finally {
    await review?.close();
    await mkdir('artifacts', { recursive: true });
    for (const [name, png] of captures) await writeFile('artifacts/' + name, png);
    const report = JSON.stringify({
      passed,
      stage,
      failureCategory,
      checks,
      diagnostic,
      handoffSamples,
      captureFiles: [...captures.keys()],
      silhouetteAlignmentProven: false,
    });
    assert.ok(Buffer.byteLength(report) <= 65536);
    await writeFile('artifacts/atlas-hero-browser-results.json', report + '\n');
  }
  if (!passed) process.exitCode = 1;
}

// Comprehensive public route/type/density acceptance is opt-in rather than
// appended to the default cold-load workflow. It shares this harness's existing
// first-party fixture/browser imports, with its own bounded result/capture set.
async function runPanelPresentation() {
  let review,
    stage = 'setup',
    passed = false,
    failureCategory = null;
  const fontRows = [],
    layoutRows = [],
    violations = [],
    captures = new Map();
  const deferred = [
    {
      route: '/overlay',
      reason: 'Legacy static prototype does not load fonts.css; template outside worker scope.',
    },
    {
      route: '/control/*',
      reason: 'Private controls and backend ownership excluded from this phase.',
    },
    {
      route: '/my-marks#capability',
      reason: 'Only capability-free empty page inspected; no private retained entries read.',
    },
  ];
  const check = (ok, code) => {
    if (!ok) violations.push(code);
  };
  const viewportList = [
    { width: 1920, height: 1080 },
    { width: 390, height: 844 },
  ];
  let seed = null;

  async function fonts(page, route) {
    const response = await page.goto(review.origin + route);
    assert.equal(response.status(), 200);
    const row = await page.evaluate(async () => {
      const loaded = await document.fonts.load('400 28px Cinzel', 'Raid Relic');
      await document.fonts.ready;
      const visible = (node) => {
        const r = node.getBoundingClientRect(),
          s = getComputedStyle(node);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
      };
      const headings = [...document.querySelectorAll('h1,h2,h3,.brand')].filter(visible);
      return {
        loadedFaceCount: loaded.filter(
          (f) => f.family.replace(/["']/g, '') === 'Cinzel' && f.status === 'loaded',
        ).length,
        faceChecked: document.fonts.check('400 28px Cinzel', 'Raid Relic'),
        headingCount: headings.length,
        cinzelHeadingCount: headings.filter((n) =>
          /^['"]?Cinzel['"]?(?:,|$)/.test(getComputedStyle(n).fontFamily),
        ).length,
        bodySize: parseFloat(getComputedStyle(document.body).fontSize),
        palette: ['deep', 'slate', 'moon', 'muted', 'amber', 'violet'].map((name) =>
          getComputedStyle(document.documentElement)
            .getPropertyValue('--rr-' + name)
            .trim(),
        ),
        rootBackground: getComputedStyle(document.documentElement).backgroundColor,
        bodyColor: getComputedStyle(document.body).color,
        visibleISO: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(document.body.innerText),
        // No heading text, capability, participant or request body is reported.
      };
    });
    fontRows.push({ route, ...row });
    check(row.loadedFaceCount > 0 && row.faceChecked, 'font-face:' + route);
    check(
      row.headingCount > 0 && row.cinzelHeadingCount === row.headingCount,
      'computed-headings:' + route,
    );
    check(row.bodySize >= 15, 'body-minimum:' + route);
    check(!row.visibleISO, 'visible-iso:' + route);
    check(
      JSON.stringify(row.palette) ===
        JSON.stringify(['#101d30', '#26354b', '#e3e8ef', '#bbc6d7', '#dba95c', '#b7a2df']),
      'canonical-palette:' + route,
    );
    if (route === '/forge' || route === '/recap') {
      check(row.rootBackground === 'rgb(16, 29, 48)', 'canonical-background:' + route);
      check(row.bodyColor === 'rgb(227, 232, 239)', 'canonical-body-color:' + route);
    }
  }

  // Render eligibility and viewport intersection are distinct: all three expanded
  // entries need not fit a mobile fold. Closed-details descendants may have nonzero
  // rectangles, so inspect actual ancestor states and the first-summary exception.
  async function keeperPresentationState(page) {
    return page.evaluate(() => {
      const coordinate = (value) =>
        Number.isFinite(value) && Math.abs(value) <= 100000 ? Math.round(value * 100) / 100 : null;
      const visibility = (node) => {
        if (!node) return null;
        const box = node.getBoundingClientRect();
        const rect = Object.fromEntries(
          ['x', 'y', 'width', 'height'].map((key) => [key, coordinate(box[key])]),
        );
        const detailsAncestors = [];
        let styleBlocked = false,
          ancestorLimitExceeded = false,
          depth = 0;
        for (let ancestor = node; ancestor; ancestor = ancestor.parentElement, depth++) {
          if (depth >= 32) {
            ancestorLimitExceeded = true;
            break;
          }
          const style = getComputedStyle(ancestor);
          if (
            ancestor.hidden ||
            style.display === 'none' ||
            style.visibility === 'hidden' ||
            style.visibility === 'collapse' ||
            style.contentVisibility === 'hidden' ||
            Number(style.opacity) === 0
          )
            styleBlocked = true;
          if (ancestor.tagName === 'DETAILS') {
            if (detailsAncestors.length >= 8) {
              ancestorLimitExceeded = true;
              break;
            }
            const summary = [...ancestor.children].find((child) => child.tagName === 'SUMMARY');
            const inSummary = Boolean(summary && (summary === node || summary.contains(node)));
            detailsAncestors.push({
              depth,
              open: ancestor.open,
              inSummary,
              kind: ancestor.classList.contains('keeper-more')
                ? 'more'
                : ancestor.id === 'how-we-verify'
                  ? 'verification'
                  : 'other',
              blocks: !ancestor.open && ancestor !== node && !inSummary,
            });
          }
        }
        const closedAncestorCount = detailsAncestors.filter((ancestor) => ancestor.blocks).length;
        const visible =
          Object.values(rect).every((value) => value !== null) &&
          box.width > 0 &&
          box.height > 0 &&
          !styleBlocked &&
          !ancestorLimitExceeded &&
          closedAncestorCount === 0;
        return {
          rect,
          visible,
          inViewport:
            visible &&
            box.top < innerHeight &&
            box.bottom > 0 &&
            box.left < innerWidth &&
            box.right > 0,
          closedAncestorCount,
          detailsAncestors,
          styleBlocked,
          ancestorLimitExceeded,
        };
      };
      const articles = [...document.querySelectorAll('.keeper-arrival')];
      if (articles.length > 16) throw Error('Bounded Keeper entries');
      const entries = articles.map((article, index) => ({
        index,
        inMore: Boolean(article.closest('.keeper-more')),
        ...visibility(article),
      }));
      const more = document.querySelector('.keeper-more');
      const summary = more?.querySelector(':scope > summary');
      const advertised = /^\+([1-9]\d?) more received rings$/.exec(summary?.textContent ?? '');
      const caveatNodes = [
        ...document.querySelectorAll(
          location.pathname.startsWith('/keeper/')
            ? '#how-we-verify, main > p:not([id]), #keeper-verification-copy > p'
            : '#how-we-verify,.note,.ledger-coverage',
        ),
      ];
      if (caveatNodes.length > 16) throw Error('Bounded caveat blocks');
      const caveatMetadata = caveatNodes.map((node, index) => ({
        index,
        drawer: node.tagName === 'DETAILS',
        ...visibility(node),
      }));
      const verification = document.querySelector('#how-we-verify');
      return {
        entries,
        received: entries.length,
        visibleReceived: entries.filter((entry) => entry.visible).length,
        moreCount: document.querySelectorAll('.keeper-more').length,
        moreOpen: more?.open ?? null,
        moreAdvertised: advertised ? Number(advertised[1]) : null,
        moreIsPlusOne: summary?.textContent === '+1 more received rings',
        moreMetadata: visibility(more),
        moreSummaryMetadata: visibility(summary),
        caveats: caveatMetadata.filter((block) => block.inViewport).length,
        caveatMetadata,
        caveatPolicy: 'explicit-disclosure-blocks-with-closed-ancestry-v2',
        verificationCount: document.querySelectorAll('#how-we-verify').length,
        verificationOpen: verification?.open ?? null,
        verificationSummary: visibility(verification?.querySelector(':scope > summary')),
        verificationCopy: visibility(document.querySelector('#keeper-verification-copy')),
      };
    });
  }

  async function layout(page, state, route, viewport) {
    await page.setViewportSize(viewport);
    await page.goto(review.origin + route);
    await page.evaluate(() => document.fonts.ready);
    const keeper = route.startsWith('/keeper/');
    await page.waitForFunction(
      () => !document.querySelector('#receiving-status').textContent.startsWith('Reading'),
    );
    if (state === 'populated' && keeper) {
      await page.waitForFunction(() => document.querySelectorAll('.keeper-arrival').length === 4);
      await page.waitForFunction(
        () => document.querySelectorAll('.keeper-card-preview:not([hidden])').length === 3,
      );
    }
    const row = await page.evaluate(
      async ({ keeper, state }) => {
        const rect = (selector) => {
          const node = document.querySelector(selector);
          if (!node) return null;
          const r = node.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        };
        const cards = [];
        for (const image of document.querySelectorAll('.keeper-card-preview:not([hidden])')) {
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 180;
          try {
            const context = canvas.getContext('2d');
            context.drawImage(image, 0, 0, 320, 180);
            const pixels = context.getImageData(0, 0, 320, 180).data;
            let lit = 0;
            for (let i = 0; i < pixels.length; i += 4)
              if (pixels[i + 3] && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 80) lit++;
            cards.push({ width: image.naturalWidth, height: image.naturalHeight, lit });
          } finally {
            canvas.width = canvas.height = 0;
          }
        }
        return {
          keeper,
          state,
          width: innerWidth,
          height: innerHeight,
          pageHeight: document.documentElement.scrollHeight,
          overflow: document.documentElement.scrollWidth > innerWidth,
          hero: rect('#atlas-relic'),
          primary: rect('.hero-actions .primary-cta'),
          secondary: rect('.hero-actions .secondary-cta'),
          sticky: rect('.mobile-cta'),
          ledgerOpen: document.querySelector('#ledger-details')?.open ?? null,
          cards,
          maxButtonsPerRing: Math.max(
            0,
            ...[...document.querySelectorAll('.keeper-arrival')].map(
              (n) => n.querySelectorAll('button').length,
            ),
          ),
          shareButtons: [...document.querySelectorAll('.keeper-arrival button')].filter((n) =>
            /^Share · Ring/.test(n.textContent),
          ).length,
          recordAvailable:
            document.querySelector('#receiving-content').childElementCount > 0 &&
            !document
              .querySelector('#receiving-status')
              .textContent.startsWith('Keeper record unavailable'),
          visibleISO: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(document.body.innerText),
        };
      },
      { keeper, state },
    );
    Object.assign(row, await keeperPresentationState(page));
    layoutRows.push(row);
    const key = state + ':' + (keeper ? 'keeper' : 'landing') + ':' + viewport.width;
    check(!row.overflow, 'overflow:' + key);
    check(!row.visibleISO, 'visible-iso:' + key);
    check(row.recordAvailable, 'retained-record:' + key);
    check(row.caveats <= 1, 'visible-caveats:' + key);
    if (keeper) {
      check(
        row.verificationCount === 1 &&
          row.verificationOpen === false &&
          row.verificationSummary?.visible &&
          row.verificationCopy?.visible === false &&
          row.verificationCopy.closedAncestorCount === 1,
        'keeper-verification:' + key,
      );
    }
    if (viewport.width === 390) check(row.pageHeight <= 4500, 'page-height:' + key);
    if (!keeper) {
      check(row.primary.top >= 0 && row.primary.bottom <= viewport.height, 'primary-fold:' + key);
      check(row.ledgerOpen === viewport.width >= 600, 'ledger-disclosure:' + key);
      if (viewport.width === 1920) {
        check(row.secondary.bottom <= viewport.height, 'secondary-fold:' + key);
        check(row.hero.top >= 0 && row.hero.bottom <= viewport.height, 'hero-fold:' + key);
      } else
        check(row.sticky.height === 56 && row.sticky.bottom === viewport.height, 'sticky:' + key);
    } else if (state === 'populated') {
      check(
        row.cards.length === 3 &&
          row.cards.every((c) => c.width === 320 && c.height === 180 && c.lit > 100),
        'decoded-cards:' + key,
      );
      check(row.maxButtonsPerRing <= 2 && row.shareButtons === 4, 'share-buttons:' + key);
      check(
        row.received === 4 &&
          row.visibleReceived === 3 &&
          row.moreCount === 1 &&
          row.moreOpen === false &&
          row.moreIsPlusOne &&
          row.moreAdvertised === row.received - 3 &&
          row.moreSummaryMetadata?.visible &&
          row.entries
            .slice(0, 3)
            .every((entry) => entry.visible && !entry.inMore && entry.closedAncestorCount === 0) &&
          row.entries
            .slice(3)
            .every((entry) => !entry.visible && entry.inMore && entry.closedAncestorCount === 1),
        'plus-n:' + key,
      );
      await page.locator('.keeper-more > summary').click();
      await page.waitForFunction(
        () => document.querySelectorAll('.keeper-card-preview:not([hidden])').length === 4,
      );
      row.expanded = await keeperPresentationState(page);
      check(
        row.expanded.moreOpen === true &&
          row.expanded.visibleReceived === 4 &&
          row.expanded.entries.every((entry) => entry.visible && entry.closedAncestorCount === 0),
        'expanded-visibility:' + key,
      );
      check(
        await page.locator('.keeper-card-preview').evaluateAll(async (images) => {
          await Promise.all(images.map((image) => image.decode()));
          return images.every((image) => image.naturalWidth === 320 && image.naturalHeight === 180);
        }),
        'expanded-card-decode:' + key,
      );
      await page.locator('.keeper-more > summary').click();
      row.reclosed = await keeperPresentationState(page);
      check(
        row.reclosed.moreOpen === false &&
          row.reclosed.visibleReceived === 3 &&
          row.reclosed.entries
            .slice(3)
            .every((entry) => !entry.visible && entry.closedAncestorCount === 1),
        'reclosed-visibility:' + key,
      );
    } else check(row.received === 0, 'empty-keeper:' + key);

    if (state === 'populated' && process.env.PANEL_PRESENTATION_CAPTURE === '1') {
      // Same existing capture limits. Desktop is an explicitly cropped top540px,
      // not a fabricated full-FHD screenshot; numeric fold measures use full1080.
      const clip = {
        x: 0,
        y: 0,
        width: viewport.width,
        height: viewport.width === 1920 ? 540 : viewport.height,
      };
      assert.ok(clip.width * clip.height * 4 <= 4 * 1024 * 1024);
      assert.ok(captures.size < 4);
      const png = await page.screenshot({ fullPage: false, clip });
      assert.ok(png.length <= 524288);
      assert.ok(
        [...captures.values()].reduce((sum, p) => sum + p.length, png.length) <= 4 * 1024 * 1024,
      );
      const name = 'panel-' + (keeper ? 'keeper' : 'landing') + '-' + viewport.width + '.png';
      captures.set(name, png);
      row.capture = { name, clip };
    }
  }

  try {
    review = await visualReview();
    const { fixture: f, page } = review;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    let browserWrites = 0;
    page.on('request', (request) => {
      if (request.method() !== 'GET') browserWrites++;
    });
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      f.streams.get(id).viewer_count = 1;
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    // Initial home is placed by the existing signed Keep path; the second Keep
    // only opts in OTHER. An eligible empty profile is not an unavailable404 page.
    assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
    const emptyProfiles = await f.runtime.state.getReceivingView(f.now());
    assert.equal(
      emptyProfiles.profiles.find((profile) => profile.login === 'olsols2')?.received.length,
      0,
    );
    for (const viewport of viewportList)
      for (const route of ['/', '/keeper/olsols2']) {
        f.advance(10000);
        await layout(page, 'empty', route, viewport);
      }
    stage = 'signed-synthetic-seven-hops';
    for (let i = 0; i < 7; i++) {
      const from = (await f.runtime.state.getKeeperRegistry()).holderId;
      const to = from === HOME ? OTHER : HOME;
      f.advance(31000);
      const response = await f.control(from, 'send:' + to);
      assert.equal(response.status, 200);
      assert.equal(JSON.parse(response.body).status, 'accepted');
      f.advance();
      await f.raid(from, to, 1);
      await f.chat(from, '8201', '!offer', { messageId: 'panel-offer-' + i });
      await f.chat(to, '8202', '!accept', { messageId: 'panel-accept-' + i });
      assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, to);
    }
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 7);
    const populatedProfiles = await f.runtime.state.getReceivingView(f.now());
    const homeVisits = populatedProfiles.profiles.find(
      (profile) => profile.login === 'raidrelichq',
    )?.received;
    const otherVisits = populatedProfiles.profiles.find(
      (profile) => profile.login === 'olsols2',
    )?.received;
    assert.equal(homeVisits?.length, 3);
    assert.equal(otherVisits?.length, 4);
    assert.ok(otherVisits.every((visit) => visit.to === 'olsols2'));
    assert.deepEqual(
      otherVisits.map((visit) => visit.ringIndex),
      [1, 3, 5, 7],
    );
    seed = {
      initialHolderIsHome: true,
      totalHops: 7,
      homeReceived: homeVisits.length,
      otherReceived: otherVisits.length,
      otherRingIndices: otherVisits.map((visit) => visit.ringIndex),
    };
    stage = 'populated-layouts';
    for (const viewport of viewportList)
      for (const route of ['/', '/keeper/olsols2']) {
        f.advance(10000);
        await layout(page, 'populated', route, viewport);
      }
    stage = 'public-font-date-matrix';
    await page.setViewportSize({ width: 390, height: 844 });
    for (const route of [
      '/',
      '/atlas/',
      '/atlas/embed',
      '/start',
      '/keeper/raidrelichq',
      '/keeper/olsols2',
      '/forge',
      '/recap',
      '/my-marks',
      '/demo/',
      '/demo/film',
      '/demo/judge',
      '/demo/wander',
      '/overlay/' + HOME,
    ]) {
      f.advance(10000);
      await fonts(page, route);
    }
    // A real public retained-stop URL, obtained from its own rendered link, never
    // a private transcript/capability or invented stop identifier.
    await page.goto(review.origin + '/atlas/');
    await page.locator('#journey a').first().waitFor();
    const stopRoute = await page.locator('#journey a').first().getAttribute('href');
    assert.match(stopRoute, /^\/stops\/[a-f0-9]{64}$/);
    f.advance(10000);
    await fonts(page, stopRoute);
    check(browserWrites === 0, 'unexpected-browser-write');
    assert.deepEqual(review.stats(), { errors: 0, external: 0 });
    // Report every measured row before failing unmet criteria. Deferred routes
    // remain explicit and prevent any claim of universal public-page coverage.
    passed = violations.length === 0;
    stage = 'complete';
  } catch (error) {
    failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(error?.name)
      ? error.name
      : 'fixture-or-browser';
  } finally {
    await review?.close();
    await mkdir('artifacts', { recursive: true });
    for (const [name, png] of captures) await writeFile('artifacts/' + name, png);
    const report = JSON.stringify({
      passed,
      stage,
      failureCategory,
      fontRows,
      layoutRows,
      violations,
      deferred,
      seed,
      captures: [...captures.keys()],
      physicalOBS: false,
      allPublicRoutesProven: false,
    });
    assert.ok(Buffer.byteLength(report) <= 65536);
    await writeFile('artifacts/panel-presentation-browser-results.json', report + '\n');
  }
  if (!passed) process.exitCode = 1;
}

const mode = presentationMode(process.argv.slice(2));
if (mode === 'panel-presentation') await runPanelPresentation();
else await runColdHero();
