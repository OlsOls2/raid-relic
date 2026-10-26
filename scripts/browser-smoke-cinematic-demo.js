// P3.1 LOCAL synthetic-HMAC kernel + actual DOM/GL/SVG. No provider transport.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
const origin = 'https://localhost:5191';
let browser,
  server,
  sockets,
  tls,
  stage = 'startup',
  failure = false;
const checks = [],
  captures = new Map(),
  pageErrors = [];
async function capture(page, name) {
  if (process.env.P31_CAPTURE !== '1' || captures.has(name)) return;
  const image = await page.screenshot({ fullPage: false });
  if (image.length <= 524288) captures.set(name, image);
}
try {
  tls = await createLocalTLS();
  const { chromium } = await import('playwright');
  browser = await chromium.launch({
    executablePath: '/snap/bin/chromium',
    chromiumSandbox: true,
    headless: true,
  });
  for (const mode of ['webgl', 'svg']) {
    stage = `${mode}-setup`;
    const f = await pilotFixture('memory', { origin });
    server = createServer(tls.options, f.runtime.handler);
    sockets = attachOverlaySockets(server, f.runtime.overlayFeeds, {
      origins: [origin],
      allowRead: f.runtime.allowPublicRead,
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(5191, '127.0.0.1', resolve);
    });
    for (const id of [BOT, HOME, OTHER]) await f.login(id);
    for (const id of [HOME, OTHER]) {
      await f.control(id, 'bootstrap');
      f.advance();
      await f.control(id, 'keep');
      f.advance();
    }
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      ignoreHTTPSErrors: true,
      serviceWorkers: 'block',
    });
    if (mode === 'svg')
      await context.addInitScript(() => {
        const old = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return /^webgl/.test(type) ? null : old.call(this, type, ...args);
        };
      });
    await context.route('**/*', (r) =>
      new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
    );
    await context.routeWebSocket('**/*', (r) =>
      new URL(r.url()).origin === origin.replace('https:', 'wss:')
        ? r.connectToServer()
        : r.close(),
    );
    const page = await context.newPage();
    page.on('pageerror', (e) => {
      if (pageErrors.length < 4)
        pageErrors.push(
          ['TypeError', 'ReferenceError', 'SyntaxError'].includes(e.name) ? e.name : 'Error',
        );
    });
    await page.goto(`${origin}/overlay/${OTHER}`);
    await page.bringToFront();
    if (mode === 'webgl') {
      await page.locator('.webgl-relic canvas').waitFor({ state: 'visible' });
      const colored = await page.locator('canvas.relic3d').evaluate(
        (canvas) =>
          new Promise((resolve) => {
            const timer = setTimeout(() => resolve(false), 5000);
            canvas.setAttribute('data-pixel-probe', '');
            canvas.addEventListener(
              'relic3d-frame',
              () => {
                clearTimeout(timer);
                canvas.removeAttribute('data-pixel-probe');
                const gl = canvas.getContext('webgl2');
                const b = new Uint8Array(canvas.width * canvas.height * 4);
                gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, b);
                let n = 0;
                for (let i = 0; i < b.length; i += 4)
                  if (b[i + 3] && Math.max(b[i], b[i + 1], b[i + 2]) > 20) n++;
                resolve(n > 10 && b[3] === 0);
              },
              { once: true },
            );
          }),
      );
      assert(colored);
    } else await page.locator('.crystal').waitFor({ state: 'visible' });
    await f.control(HOME, `send:${OTHER}`);
    await page.waitForFunction(() => !document.querySelector('#claim-meter').hidden);
    assert.equal(await page.locator('.p3-comet').isVisible(), false);
    assert.equal(await page.locator('.p3-flash').isVisible(), false);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
    f.advance();
    await f.raid(HOME, OTHER, 2);
    const start = (await f.runtime.state.getKeeperRegistry()).pendingHop.startedAt;
    async function seek(ms) {
      f.advance(start + ms - f.now());
      await f.chat(HOME, HOME, '!relic resume');
      await page.bringToFront();
      await page.waitForFunction(
        (expected) =>
          Number(document.querySelector('.archive').dataset.cinematicElapsed) >= expected,
        ms,
      );
    }
    for (const ms of [200, 1500, 2800]) {
      stage = `${mode}-comet-${ms}`;
      await seek(ms);
      await page.waitForFunction(
        () =>
          document.querySelector('.archive').dataset.phase === 'streak' &&
          !document.querySelector('.p3-comet').hidden,
      );
      const p = await page.locator('.p3-comet').evaluate((n) => {
        const r = n.getBoundingClientRect(),
          s = getComputedStyle(n);
        return {
          w: r.width,
          h: r.height,
          opacity: Number(s.opacity),
          visible: r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight,
        };
      });
      assert(p.w > 180 && p.h > 15 && p.opacity > 0.8 && p.visible);
      const core = page.locator(mode === 'webgl' ? 'canvas.relic3d' : '.crystal');
      assert(await core.evaluate((n) => Number(getComputedStyle(n).opacity) > 0.9));
      if (ms === 1500 && mode === 'webgl') await capture(page, 'p31-simulator-comet.png');
    }
    // Positive browser frames use margin for native transport/GPU/locator latency; pure tests pin the exact late edge.
    for (const ms of [3200, 3350]) {
      stage = `${mode}-impact-${ms}`;
      await seek(ms);
      await page.waitForFunction(
        () =>
          !document.querySelector('.p3-flash').hidden &&
          Number(getComputedStyle(document.querySelector('.p3-flash')).opacity) > 0,
      );
      const alpha = await page
        .locator('.p3-flash')
        .evaluate((n) => Number(getComputedStyle(n).opacity));
      assert(alpha > 0 && alpha <= 0.45);
      assert(await page.locator('.p3-shock').isVisible());
      if (ms === 3200 && mode === 'webgl') await capture(page, 'p31-simulator-impact.png');
    }
    for (const ms of [5500, 12000, 19000]) {
      stage = `${mode}-ambient-${ms}`;
      await seek(ms);
      await page.waitForFunction(
        () => document.querySelector('.archive').dataset.ambientCount === '6',
      );
      assert.equal(await page.locator('.p31-decorative:not([hidden])').count(), 6);
      assert.equal(await page.locator('.rune').count(), 0);
      assert.equal(await page.locator('.p3-word:not([hidden])').count(), 0);
      assert.equal(await page.locator('.p31-source').textContent(), 'From @raidrelichq');
      const bounds = await page.locator('.p31-decorative:not([hidden])').evaluateAll((nodes) =>
        nodes.every((n) => {
          const r = n.getBoundingClientRect();
          return (
            r.width > 10 &&
            r.height > 10 &&
            r.left >= 0 &&
            r.right <= innerWidth &&
            r.top >= 0 &&
            r.bottom <= innerHeight &&
            Number(getComputedStyle(n).opacity) > 0.3
          );
        }),
      );
      assert(bounds);
      assert((await page.locator('#count').textContent()).includes('0 approved'));
      if (mode === 'webgl') {
        assert.equal(await page.locator('canvas.relic3d').getAttribute('data-sprites'), '0');
        assert(Number(await page.locator('canvas.relic3d').getAttribute('data-triangles')) < 20000);
      }
      if (ms === 12000 && mode === 'webgl') await capture(page, 'p31-simulator-empty-unfurl.png');
    }
    stage = `${mode}-fusion`;
    await f.chat(HOME, HOME, '!offer');
    await f.chat(OTHER, OTHER, '!accept');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    await seek(20800);
    await page.waitForFunction(
      () =>
        !document.querySelector('.p3-fusion').hidden &&
        Number(document.querySelector('.archive').style.getPropertyValue('--fusion-glow')) > 0.7,
    );
    assert(await page.locator('.p3-fuse-ring').isVisible());
    assert(
      await page
        .locator('.p3-fuse-ring')
        .evaluate((n) => Number(getComputedStyle(n).opacity) > 0.3),
    );
    assert(
      await page
        .locator('.p3-fusion')
        .evaluate((n) => Number(getComputedStyle(n, ':after').opacity) > 0.7),
    );
    if (mode === 'webgl') await capture(page, 'p31-simulator-fusion.png');
    await page.reload();
    await page.bringToFront();
    await page.locator('#lineage').filter({ hasText: '1 completed' }).waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('.p3-fusion').hidden && document.querySelector('.p3-flash').hidden,
    );
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(
      () =>
        document.querySelector('.p3-comet').hidden &&
        document.querySelector('.archive').dataset.ambientCount === '0',
    );
    assert.equal(pageErrors.length, 0);
    checks.push({
      name: `SIMULATOR ${mode} 1280x720 zero-mark cinematic, actual receipt/fusion and cold/reduced silence`,
      passed: true,
    });
    await context.close();
    sockets.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    server = null;
  }
} catch {
  failure = true;
} finally {
  await browser?.close().catch(() => {});
  sockets?.close();
  server?.closeAllConnections();
  if (server?.listening) await new Promise((r) => server.close(r));
  await tls?.cleanup();
  await mkdir('artifacts', { recursive: true });
  for (const [name, image] of captures) await writeFile(`artifacts/${name}`, image);
  await writeFile(
    'artifacts/cinematic-demo-browser-results.json',
    JSON.stringify(
      {
        simulator: true,
        passed: !failure,
        stage,
        pageErrors,
        checks,
        captures: [...captures.keys()],
      },
      null,
      2,
    ),
  );
}
if (failure) process.exitCode = 1;
