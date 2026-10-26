// Binding108 LOCAL synthetic-HMAC kernel + actual DOM/GL/SVG. No provider transport.
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
  activePage,
  diagnostic = null,
  failureCategory = null,
  stage = 'startup',
  failure = false;
const checks = [],
  captures = new Map(),
  pageErrors = [];
async function capture(page, name) {
  if (process.env.P5_BIND_CAPTURE !== '1' || captures.has(name)) return;
  const image = await page.screenshot({ fullPage: false });
  assert(image.length <= 524288);
  captures.set(name, image);
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
    // Freeze only the overlay's monotonic receipt projection; native RAF/timers/HTTP/WSS remain real.
    await context.addInitScript(() => {
      window.__bindingPerf = 0;
      Object.defineProperty(performance, 'now', {
        configurable: true,
        value: () => window.__bindingPerf,
      });
      const Native = window.WebSocket;
      window.__bindingSockets = { created: 0, closed: 0 };
      window.WebSocket = class extends Native {
        constructor(...args) {
          super(...args);
          window.__bindingSockets.created++;
          this.addEventListener('close', () => window.__bindingSockets.closed++);
        }
      };
      addEventListener('DOMContentLoaded', () => {
        const label = document.createElement('aside');
        label.textContent = 'SIMULATOR · LOCAL MOCK BINDING';
        label.style.cssText =
          'position:fixed;top:0;left:0;z-index:50;background:#101d30;color:#ffe3a6;font:12px system-ui';
        document.body.prepend(label);
        document.title = 'SIMULATOR binding';
      });
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
    activePage = page;
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
    await f.chat(HOME, '811', '!offer');
    f.advance(66204);
    const sentAt = f.now();
    f.advance();
    await f.signed('stream.offline', { broadcaster_user_id: HOME }, HOME);
    f.advance();
    await f.signed(
      'channel.raid',
      { from_broadcaster_user_id: HOME, to_broadcaster_user_id: OTHER, viewers: 1 },
      OTHER,
      { to_broadcaster_user_id: OTHER },
      { sentAt },
    );
    assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop.offers, ['811']);
    const start = (await f.runtime.state.getKeeperRegistry()).pendingHop.startedAt;
    async function seek(ms) {
      await page.evaluate((ms) => {
        window.__bindingPerf = ms;
      }, ms);
      f.advance(start + ms - f.now());
      await f.chat(OTHER, OTHER, '!relic resume');
      await page.bringToFront();
      // Each received snapshot calibrates serverNow=start+ms against performance.now()=ms.
      await page.waitForFunction(
        (expected) =>
          Math.abs(
            Number(document.querySelector('.archive').dataset.cinematicElapsed) - expected,
          ) <= 1,
        ms,
      );
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert(
        Math.abs(
          Number(await page.locator('.archive').getAttribute('data-cinematic-elapsed')) - ms,
        ) <= 1,
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
      if (ms === 1500 && mode === 'webgl') await capture(page, 'binding-arrival.png');
    }
    for (const ms of [3200, 3600]) {
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
    }
    await seek(3700);
    assert.equal(await page.locator('.p3-flash').isVisible(), false);
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
            Math.abs(r.width - 68) < 1 &&
            Math.abs(r.height - 68) < 1 &&
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
      if (ms === 12000) {
        for (const width of [375, 480]) {
          await page.setViewportSize({ width, height: 720 });
          await page.bringToFront();
          await page.waitForFunction(() =>
            [...document.querySelectorAll('.p31-decorative:not([hidden])')].every((n) => {
              const r = n.getBoundingClientRect();
              return (
                Math.abs(r.width - 68) < 1 &&
                r.left >= 0 &&
                r.right <= innerWidth &&
                r.top >= 0 &&
                r.bottom <= innerHeight
              );
            }),
          );
          assert.equal(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            true,
          );
        }
        await page.setViewportSize({ width: 1280, height: 720 });
      }
    }
    stage = `${mode}-fusion`;
    await f.chat(OTHER, '812', '!accept');
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    const complete = f.calls
      .filter((c) => c.url.endsWith('/chat/messages'))
      .map((c) => JSON.parse(c.body))
      .filter((c) => c.message.startsWith('Claim complete'));
    assert.deepEqual(
      complete.map((c) => c.broadcaster_id),
      [HOME, OTHER],
    );
    for (const ms of [20250, 20800, 21800, 22800, 23200]) {
      await seek(ms);
      await page.waitForFunction(
        () =>
          !document.querySelector('.p3-fusion').hidden &&
          Number(document.querySelector('.archive').style.getPropertyValue('--fusion-glow')) >= 0.8,
      );
      const composite = await page.locator('.p3-fusion').evaluate((n) => {
        let product = 1;
        for (let p = n; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (s.display === 'none' || s.visibility === 'hidden' || p.hidden) return false;
          product *= Number(s.opacity);
        }
        const r = n.querySelector('.p3-fuse-ring'),
          b = r.getBoundingClientRect(),
          s = getComputedStyle(r);
        return (
          Number(getComputedStyle(n).opacity) >= 0.8 &&
          product >= 0.8 &&
          product * Number(s.opacity) >= 0.8 &&
          s.stroke !== 'none' &&
          Number.parseFloat(s.strokeWidth) > 0 &&
          b.width > 50 &&
          b.height > 50 &&
          b.right > 0 &&
          b.left < innerWidth &&
          b.bottom > 0 &&
          b.top < innerHeight
        );
      });
      assert(composite);
      if (mode === 'webgl' && ms === 20800) {
        const pixel = await page.locator('canvas.relic3d').evaluate(
          (canvas) =>
            new Promise((resolve) => {
              const timer = setTimeout(() => resolve(false), 5000);
              canvas.setAttribute('data-pixel-probe', '');
              canvas.addEventListener(
                'relic3d-frame',
                () => {
                  clearTimeout(timer);
                  canvas.removeAttribute('data-pixel-probe');
                  const gl = canvas.getContext('webgl2'),
                    w = canvas.width,
                    h = canvas.height,
                    b = new Uint8Array(w * h * 4);
                  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, b);
                  let gold = 0;
                  for (let y = 0; y < h; y++)
                    for (let x = 0; x < w; x++) {
                      const radius = Math.hypot(x - w / 2, y - h / 2) / Math.min(w, h),
                        i = (y * w + x) * 4;
                      if (
                        radius > 0.18 &&
                        radius < 0.36 &&
                        b[i + 3] > 20 &&
                        b[i] > b[i + 1] + 2 &&
                        b[i + 1] > b[i + 2] + 3
                      )
                        gold++;
                    }
                  resolve(gold > 5 && b[3] === 0 && Number(canvas.dataset.bands) === 2);
                },
                { once: true },
              );
            }),
        );
        assert(pixel);
        await capture(page, 'binding-fusion.png');
      }
    }
    await seek(23650);
    await page.waitForFunction(() => document.querySelector('.p3-fusion').hidden);
    await seek(24000);
    await page.waitForFunction(() => document.querySelector('.p3-fusion').hidden);
    assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
    if (mode === 'webgl') await capture(page, 'binding-settled.png');
    assert.deepEqual(await page.evaluate(() => window.__bindingSockets), { created: 1, closed: 0 });
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
        ['.p3-comet', '.p3-flash', '.p3-shock', '.p3-fusion'].every(
          (s) => document.querySelector(s).hidden,
        ) && document.querySelector('.archive').dataset.ambientCount === '0',
    );
    await page.setViewportSize({ width: 160, height: 160 });
    await page.goto(`${origin}/overlay/${OTHER}?corner=1`);
    await page.locator('#compact-count').filter({ hasText: 'Rings 1' }).waitFor();
    assert.equal(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth <= 160 &&
          document.documentElement.scrollHeight <= 160,
      ),
      true,
    );
    assert.equal(pageErrors.length, 0);
    checks.push({
      name: `SIMULATOR ${mode} 1280x720 early-offer retired-source binding, both completion chats,68px ornaments and3s fusion plateau/cold silence`,
      passed: true,
    });
    await context.close();
    sockets.close();
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
    server = null;
  }
} catch (error) {
  failure = true;
  failureCategory =
    error?.name === 'AssertionError'
      ? 'assertion'
      : error?.name === 'TimeoutError'
        ? 'timeout'
        : error?.name === 'TypeError'
          ? 'type-error'
          : 'browser-or-fixture';
  try {
    diagnostic = await activePage?.evaluate(() => {
      const numeric = (v) => (Number.isFinite(v) && Math.abs(v) <= 10000000 ? v : null),
        archive = document.querySelector('.archive'),
        flash = document.querySelector('.p3-flash'),
        fusion = document.querySelector('.p3-fusion'),
        canvas = document.querySelector('canvas.relic3d');
      return {
        actualElapsed: numeric(Number(archive?.dataset.cinematicElapsed)),
        flashAlpha: flash ? numeric(Number(getComputedStyle(flash).opacity)) : null,
        fusionGlow: archive
          ? numeric(Number(archive.style.getPropertyValue('--fusion-glow')))
          : null,
        parentOpacity: fusion ? numeric(Number(getComputedStyle(fusion).opacity)) : null,
        gpuBands: canvas ? numeric(Number(canvas.dataset.bands)) : null,
        socketsCreated: numeric(window.__bindingSockets?.created),
        socketsClosed: numeric(window.__bindingSockets?.closed),
      };
    });
  } catch {
    diagnostic = null;
  }
} finally {
  await browser?.close().catch(() => {});
  sockets?.close();
  server?.closeAllConnections();
  if (server?.listening) await new Promise((r) => server.close(r));
  await tls?.cleanup();
  await mkdir('artifacts', { recursive: true });
  for (const [name, image] of captures) await writeFile(`artifacts/${name}`, image);
  await writeFile(
    'artifacts/binding-browser-results.json',
    JSON.stringify(
      {
        simulator: true,
        passed: !failure,
        stage,
        failureCategory,
        diagnostic,
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
