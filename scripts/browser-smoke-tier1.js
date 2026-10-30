// Native labelled fixture proof only; no live/provider access or production hooks.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createJudges, JUDGES_ORIGIN as origin } from '../test-support/judges.js';
const judges = await createJudges({ intent: true, env: {} }),
  images = new Map(),
  checks = [];
let browser,
  page,
  failed = false,
  stage = 'setup',
  failureCategory = null,
  diagnostic = {};
async function paint() {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(
    () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
  );
}
async function capture(name) {
  if (process.env.TIER1_CAPTURE !== '1') return;
  await paint();
  assert.match(await page.locator('body').innerText(), /SIMULATOR|SIMULATED DEMO/);
  const bytes = await page.screenshot({ fullPage: false });
  assert.ok(bytes.length <= 524288);
  images.set(name, bytes);
}
try {
  await judges.seedReviewJourney({ settled: true });
  await judges.listen();
  const { chromium } = await import('playwright');
  browser = await chromium.launch({
    executablePath: '/snap/bin/chromium',
    chromiumSandbox: true,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    serviceWorkers: 'block',
  });
  let outside = 0,
    errors = 0;
  await context.route('**/*', (r) => {
    if (new URL(r.request().url()).origin !== origin) {
      outside++;
      return r.abort();
    }
    return r.continue();
  });
  page = await context.newPage();
  page.on('pageerror', () => errors++);
  stage = 'hero';
  await page.goto(origin + '/');
  await paint();
  assert.equal(await page.locator('footer .edition-disclaimer').count(), 1);
  await capture('tier1-hero.png');
  stage = 'idle-holder';
  await page.goto(origin + '/overlay/1591806023');
  await page.locator('body[data-connection="connected"]').waitFor();
  await page
    .locator('#status')
    .filter({ hasText: '@olsols2 holds the relic · Ring 3 · raid to pass it on' })
    .waitFor();
  assert.equal(await page.locator('.edition-disclaimer').count(), 0);
  assert.doesNotMatch(await page.locator('body').innerText(), /Unofficial fan project/);
  await page.locator('canvas.relic3d').waitFor({ state: 'visible' });
  assert.ok(Number(await page.locator('canvas.relic3d').getAttribute('data-frames')) > 0);
  const pixel = await page.locator('canvas.relic3d').evaluate(
    (c) =>
      new Promise((resolve) => {
        const t = setTimeout(() => resolve(false), 5000);
        c.setAttribute('data-pixel-probe', '');
        c.addEventListener(
          'relic3d-frame',
          () => {
            clearTimeout(t);
            c.removeAttribute('data-pixel-probe');
            const gl = c.getContext('webgl2'),
              p = new Uint8Array(c.width * c.height * 4);
            gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, p);
            resolve(p.some((v, i) => i % 4 === 3 && v > 0));
          },
          { once: true },
        );
      }),
  );
  assert.ok(pixel);
  await capture('tier1-holder.png');
  await page.goto(origin + '/overlay/1591805230');
  await page.locator('#status').filter({ hasText: 'The relic has moved on to @olsols2' }).waitFor();
  assert.equal(await page.locator('#holder-link').getAttribute('href'), '/atlas/');
  for (const host of ['1591805230', '1591806023']) {
    await page.setViewportSize({ width: 160, height: 160 });
    await page.goto(`${origin}/overlay/${host}?corner=1`);
    await page.locator('body[data-connection="connected"]').waitFor();
    await paint();
    assert.ok(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= 160 &&
          document.documentElement.scrollHeight <= 160,
      ),
    );
  }
  checks.push({
    name: 'Registry-backed idle holder / previous room, actual GL pixels and bounded corner',
    passed: true,
  });
  stage = 'atlas-responsive';
  await page.goto(origin + '/atlas/');
  await page.locator('#map-stops li').nth(2).waitFor();
  for (const width of [320, 360, 375, 390, 393, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await paint();
    assert.equal(await page.locator('footer .edition-disclaimer').count(), 1);
    assert.equal(await page.locator('.edition-label').count(), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.doesNotMatch(await page.locator('#journey').innerText(), /Channel 159180/);
  assert.match(await page.locator('#journey').innerText(), /UTC/);
  checks.push({
    name: 'Atlas human names/UTC dates, one footer notice and seven responsive widths',
    passed: true,
  });
  await context.close();
  stage = 'demo-isolation';
  const demo = await browser.newContext({
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  });
  let denied = 0;
  await demo.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (
      u.origin !== origin ||
      u.pathname.startsWith('/api/') ||
      !['GET', 'HEAD'].includes(r.request().method())
    ) {
      denied++;
      return r.abort();
    }
    return r.continue();
  });
  await demo.addInitScript(() => {
    window.__tierIO = 0;
    const no = () => {
      window.__tierIO++;
      throw Error('Demo I/O blocked');
    };
    window.fetch = no;
    window.XMLHttpRequest = no;
    window.WebSocket = no;
    window.EventSource = no;
    navigator.sendBeacon = no;
    Storage.prototype.setItem = no;
    Storage.prototype.removeItem = no;
    Storage.prototype.clear = no;
  });
  page = await demo.newPage();
  page.on('pageerror', () => errors++);
  const before = judges.auditCounts().providerCalls;
  stage = 'demo-load';
  await page.goto(origin + '/demo/');
  await page.locator('#demo-banner').waitFor();
  assert.equal(errors, 0);
  assert.equal(await page.locator('#demo-banner').count(), 1);
  assert.equal(await page.locator('footer .edition-disclaimer').count(), 1);
  await page.locator('#demo-send').click();
  await page.locator('#demo-source-chat button').click();
  await page.locator('#demo-raid').click();
  await page.locator('#demo-host-chat button').click();
  await page.locator('#demo-rings').filter({ hasText: 'Rings: 1' }).waitFor();
  await page.locator('#demo-pause').click();
  assert.equal(
    await page.locator('#demo-send').getAttribute('aria-describedby'),
    'demo-send-reason',
  );
  assert.equal(
    await page.locator('#demo-send-reason').textContent(),
    await page.locator('#demo-send').getAttribute('title'),
  );
  for (const width of [320, 360, 375, 390, 393, 430, 1280]) {
    stage = 'demo-width';
    diagnostic = { width };
    await page.setViewportSize({ width, height: 844 });
    await paint();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (width <= 650)
      for (const input of ['#demo-offer', '#demo-accept']) {
        await page.locator(input).scrollIntoViewIfNeeded();
        const geometry = await page.locator('.demo-visual').evaluate((n) => {
          const b = n.getBoundingClientRect(),
            banner = document.querySelector('#demo-banner').getBoundingClientRect(),
            rings = document.querySelector('#demo-rings').getBoundingClientRect(),
            streak = document.querySelector('#demo-streak').getBoundingClientRect();
          return {
            clear:
              b.top >= banner.bottom - 1 &&
              b.bottom <= innerHeight &&
              rings.top >= b.top &&
              rings.bottom <= b.bottom &&
              streak.bottom <= rings.top + 1,
            artHeight: document.querySelector('#demo-art').getBoundingClientRect().height,
            visualTop: b.top,
            visualBottom: b.bottom,
            bannerBottom: banner.bottom,
            ringsTop: rings.top,
            ringsBottom: rings.bottom,
            streakBottom: streak.bottom,
          };
        });
        diagnostic = {
          width,
          ...Object.fromEntries(
            Object.entries(geometry).filter(
              ([, value]) => typeof value === 'number' && Number.isFinite(value),
            ),
          ),
        };
        if (!geometry.clear && process.env.TIER1_CAPTURE === '1') await capture('tier1-mobile.png');
        assert.equal(geometry.clear, true);
        assert.ok(geometry.artHeight <= 135);
      }
  }
  stage = 'resume-after-widths';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => scrollTo(0, 0));
  await page.locator('#demo-pause').click();
  stage = 'normal-visible';
  await page.locator('canvas.relic3d').waitFor({ state: 'visible' });
  stage = 'normal-frame';
  const frameStart = Number(await page.locator('canvas.relic3d').getAttribute('data-frames'));
  await page.waitForFunction(
    (n) => Number(document.querySelector('canvas.relic3d')?.dataset.frames) > n,
    frameStart,
  );
  await page
    .locator('canvas.relic3d')
    .evaluate(
      (c) =>
        new Promise((resolve) => {
          const timeout = setTimeout(() => resolve(false), 5000);
          c.setAttribute('data-pixel-probe', '');
          c.addEventListener(
            'relic3d-frame',
            () => {
              clearTimeout(timeout);
              c.removeAttribute('data-pixel-probe');
              const gl = c.getContext('webgl2'),
                pixels = new Uint8Array(c.width * c.height * 4);
              gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
              resolve(pixels.some((value, index) => index % 4 === 3 && value > 0));
            },
            { once: true },
          );
        }),
    )
    .then((value) => assert.equal(value, true));
  stage = 'mobile-capture';
  await capture('tier1-mobile.png');
  stage = 'reduced-release';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelectorAll('#demo-art canvas').length === 0);
  stage = 'reduced-svg';
  await page.locator('.crystal').waitFor({ state: 'visible' });
  await page.locator('.crystal').evaluate(async (n) => {
    await n.decode();
    if (!n.naturalWidth) throw Error('SVG missing');
  });
  assert.ok(await page.locator('.crystal').isVisible());
  stage = 'no-io';
  assert.equal(await page.evaluate(() => window.__tierIO), 0);
  assert.equal(denied, 0);
  assert.equal(judges.auditCounts().providerCalls, before);
  assert.equal(outside, 0);
  assert.equal(errors, 0);
  checks.push({
    name: 'Permanent simulation boundary, accessible lock reason, seven-width overlap and reduced SVG / zero I/O',
    passed: true,
  });
  await demo.close();
  stage = 'complete';
} catch (error) {
  if (page && !page.isClosed()) {
    try {
      const scalars = await page.evaluate(() => {
        const canvas = document.querySelector('canvas.relic3d');
        return {
          demoClock: Number(document.body.dataset.demoClock || 0),
          playing: document.body.dataset.demoPlaying === 'true',
          pauseDisabled: Boolean(document.querySelector('#demo-pause')?.disabled),
          canvasCount: document.querySelectorAll('canvas.relic3d').length,
          canvasDisplayed: Boolean(
            canvas && !canvas.hidden && getComputedStyle(canvas).display !== 'none',
          ),
          frames: Number(canvas?.dataset.frames || 0),
          mediaMatches: matchMedia('(prefers-reduced-motion: reduce)').matches,
          docHidden: document.hidden,
          contextStatus:
            canvas?.dataset.contextStatus === 'active'
              ? 1
              : canvas?.dataset.contextStatus === 'lost'
                ? 2
                : 0,
        };
      });
      diagnostic = {
        ...diagnostic,
        errors,
        ...Object.fromEntries(
          Object.entries(scalars).filter(
            ([, v]) => typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)),
          ),
        ),
      };
    } catch {
      /* Preserve the original stage, never publish browser messages. */
    }
  }
  failed = true;
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(error?.name)
    ? error.name
    : 'browser-or-fixture';
} finally {
  await browser?.close();
  await judges.close();
  await mkdir('artifacts', { recursive: true });
  for (const [name, bytes] of images) await writeFile('artifacts/' + name, bytes);
  const report = { passed: !failed, stage, failureCategory, checks, diagnostic };
  const data = JSON.stringify(report, null, 2);
  assert.ok(Buffer.byteLength(data) <= 65536);
  await writeFile('artifacts/tier1-browser-results.json', data + '\n');
}
if (failed) process.exitCode = 1;
