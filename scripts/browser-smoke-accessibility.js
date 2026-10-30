// Local signed fixture only: never visits a deployed control page.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReview, growthPixels } from '../test-support/visual-review.js';
import { HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
let review,
  stage = 'setup',
  passed = false,
  failureCategory = null;
const checks = [],
  diagnostic = {};
async function minimumContrast(page, selectors, backing = 255) {
  return page.evaluate(
    ({ selectors, backing }) => {
      const parse = (s) => {
        const v = s.match(/[\d.]+/g)?.map(Number);
        return v && v.length >= 3 ? [v[0], v[1], v[2], v[3] ?? 1] : [0, 0, 0, 0];
      };
      const over = (fg, bg) => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
      const lum = (c) =>
        c
          .map((v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          })
          .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
      return Math.min(
        ...selectors.map((selector) => {
          const n = document.querySelector(selector);
          if (!n) return 0;
          const ancestors = [];
          for (let p = n; p; p = p.parentElement) ancestors.unshift(p);
          let bg = [backing, backing, backing];
          for (const p of ancestors) bg = over(parse(getComputedStyle(p).backgroundColor), bg);
          const fg = over(parse(getComputedStyle(n).color), bg),
            a = lum(fg),
            b = lum(bg);
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        }),
      );
    },
    { selectors, backing },
  );
}
try {
  review = await visualReview();
  const { page, context, origin, fixture: f } = review;
  await context.routeWebSocket('**/*', (r) =>
    new URL(r.url()).origin === origin.replace('https:', 'wss:') ? r.connectToServer() : r.close(),
  );
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  const [name, value] = f.cookies[HOME].split('=');
  await context.addCookies([
    { name, value, url: origin, secure: true, httpOnly: true, sameSite: 'Lax' },
  ]);
  stage = 'keyboard-layout';
  const layoutPaths = ['/atlas/', '/keeper/raidrelichq', '/control/' + HOME];
  for (const [pathIndex, path] of layoutPaths.entries()) {
    await page.goto(origin + path);
    await page.evaluate(() => document.fonts.ready);
    await page.keyboard.press('Tab');
    assert.equal(
      await page.evaluate(() => document.activeElement.classList.contains('skip-link')),
      true,
    );
    assert.equal(
      await page
        .locator('.skip-link')
        .first()
        .evaluate((n) => {
          const b = n.getBoundingClientRect();
          return b.width > 0 && b.bottom > 0 && b.top >= 0;
        }),
      true,
    );
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main-content');
    for (const width of [320, 390, 1280, 1920]) {
      await page.setViewportSize({ width, height: 1080 });
      // Closed numeric evidence: no text, DOM markup, account IDs or URLs.
      diagnostic.layout = await page.evaluate(
        ({ pathIndex, width }) => {
          const tags = [
            'HEADER',
            'MAIN',
            'NAV',
            'A',
            'H1',
            'H2',
            'BUTTON',
            'SELECT',
            'IMG',
            'SECTION',
            'DETAILS',
            'INPUT',
            'IFRAME',
          ];
          const offenders = [];
          let index = 0;
          for (const node of document.body.querySelectorAll('*')) {
            const b = node.getBoundingClientRect(),
              style = getComputedStyle(node);
            if (
              b.width > 0 &&
              b.height > 0 &&
              style.position !== 'absolute' &&
              style.position !== 'fixed' &&
              (b.right > innerWidth || b.left < 0) &&
              offenders.length < 8
            )
              offenders.push({
                index,
                tagCode: tags.indexOf(node.tagName) + 1,
                x: Math.round(b.x),
                y: Math.round(b.y),
                width: Math.round(b.width),
                height: Math.round(b.height),
              });
            index++;
          }
          return {
            pathIndex,
            requestedWidth: width,
            viewportWidth: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            offenders,
          };
        },
        { pathIndex, width },
      );
      assert.equal(diagnostic.layout.viewportWidth, width);
      assert.ok(diagnostic.layout.documentWidth <= width);
    }
    assert.ok(
      (await minimumContrast(
        page,
        path.startsWith('/control/')
          ? ['h1', '#result', 'summary']
          : ['h1', '#receiving-status', '#receiving-refresh'],
      )) >= 4.5,
    );
    const missingNames = await page
      .locator('button:visible')
      .evaluateAll(
        (nodes) =>
          nodes.filter(
            (n) =>
              !(
                n.getAttribute('aria-label') ||
                n.textContent.trim() ||
                n.getAttribute('aria-labelledby')
              ),
          ).length,
      );
    assert.equal(missingNames, 0);
    await page.keyboard.press('Tab');
    assert.ok(
      await page.evaluate(() => {
        const n = document.activeElement,
          s = getComputedStyle(n);
        return n !== document.body && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2;
      }),
    );
  }
  checks.push({
    name: 'Atlas, Keeper and own local control skip links, visible keyboard focus, named buttons and 320/390/1280/1920 layout',
    passed: true,
  });
  stage = 'overlay-frame-and-live-text';
  await f.control(HOME, `send:${OTHER}`);
  await f.raid(HOME, OTHER, 4);
  await f.chat(HOME, '6701', '!offer');
  await f.chat(OTHER, '6702', '!accept');
  await page.setViewportSize({ width: 480, height: 800 });
  await page.goto(origin + '/overlay/' + OTHER);
  await page.bringToFront();
  await page.waitForFunction(
    () => Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 2,
  );
  assert.equal(await growthPixels(page, async () => {}), true);
  const changes = await page.evaluate(async () => {
    const label = document.querySelector('#claim-label');
    let count = 0;
    const observer = new MutationObserver((records) => (count += records.length));
    observer.observe(label, { childList: true, characterData: true, subtree: true });
    const start = Number(document.querySelector('canvas.relic3d').dataset.frames);
    await new Promise((resolve) => setTimeout(resolve, 1600));
    observer.disconnect();
    return {
      changes: count,
      frames: Number(document.querySelector('canvas.relic3d').dataset.frames) - start,
    };
  });
  assert.ok(changes.frames > 0);
  assert.ok(changes.changes <= 4);
  diagnostic.liveRegionChanges = changes.changes;
  diagnostic.frames = changes.frames;
  checks.push({
    name: 'Genuine overlay pixels and advancing GL frames without per-frame live-region text replacement',
    passed: true,
  });
  for (const backing of [0, 255])
    assert.ok((await minimumContrast(page, ['#status', '#count'], backing)) >= 4.5);
  stage = 'reduced-motion';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelectorAll('canvas.relic3d').length === 0);
  assert.equal(
    await page.locator('.crystal').evaluate(async (img) => {
      await img.decode();
      return img.naturalWidth > 0 && !img.hidden && getComputedStyle(img).display !== 'none';
    }),
    true,
  );
  assert.match(await page.locator('#claim-label').innerText(), /Offer 1\/2.*Accept 1\/2/);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(
    () => Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 2,
  );
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  checks.push({
    name: 'Reduced motion permanently releases GL, keeps decoded SVG and truthful claim text, then fresh recovery renders',
    passed: true,
  });
  passed = true;
} catch (e) {
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(e?.name)
    ? e.name
    : 'browser-or-fixture';
  const line = /browser-smoke-accessibility[.]js:(\d+)/.exec(e?.stack ?? '');
  if (line) diagnostic.assertionLine = Number(line[1]);
} finally {
  await review?.close();
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/accessibility-browser-results.json',
    JSON.stringify({ passed, stage, failureCategory, checks, diagnostic }) + '\n',
  );
}
if (!passed) process.exitCode = 1;
