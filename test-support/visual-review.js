// Native local QA only: explicit synthetic grants, self-only TLS, Chromium sandbox.
import { createServer } from 'node:https';
import { createLocalTLS } from './local-tls.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
import { pilotFixture } from './pilot-fixture.js';
export async function visualReview({ seekers = false, durable = false } = {}) {
  const origin = 'https://localhost:5191',
    fixture = await pilotFixture(durable === true ? 'firestore' : 'memory', {
      origin,
      ...(seekers === true
        ? {
            extraBotScopes: ['user:read:moderated_channels'],
            chronicleEnv: { SEEKERS_ENABLED: 'true' },
          }
        : {}),
    });
  const tls = await createLocalTLS(),
    server = createServer(tls.options, (req, res) => fixture.runtime.handler(req, res));
  let sockets = attachOverlaySockets(server, fixture.runtime.overlayFeeds, {
    origins: [origin],
    allowRead: fixture.runtime.allowPublicRead,
  });
  let browser,
    context,
    errors = 0,
    external = 0;
  try {
    await new Promise((r, j) => {
      server.once('error', j);
      server.listen(5191, '127.0.0.1', r);
    });
    const { chromium } = await import('playwright');
    browser = await chromium.launch({
      executablePath: '/snap/bin/chromium',
      headless: true,
      chromiumSandbox: true,
    });
    context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 390, height: 844 },
      serviceWorkers: 'block',
    });
    await context.route('**/*', (r) => {
      if (new URL(r.request().url()).origin !== origin) {
        external++;
        return r.abort();
      }
      return r.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', () => errors++);
    return {
      origin,
      fixture,
      dropConnections() {
        for (const socket of sockets.clients) socket.terminate();
      },
      async restartRuntime() {
        if (durable !== true) throw Error('Durable fixture required');
        sockets.close();
        await fixture.restart();
        sockets = attachOverlaySockets(server, fixture.runtime.overlayFeeds, {
          origins: [origin],
          allowRead: fixture.runtime.allowPublicRead,
        });
      },
      page,
      context,
      observe: (p) => p.on('pageerror', () => errors++),
      stats: () => ({ errors, external }),
      close: async () => {
        sockets.close();
        await browser?.close();
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
        await tls.cleanup();
      },
    };
  } catch (e) {
    sockets.close();
    await browser?.close().catch(() => {});
    server.closeAllConnections();
    if (server.listening) await new Promise((r) => server.close(r));
    await tls.cleanup();
    throw e;
  }
}
export async function noDemoIO(context) {
  await context.addInitScript(() => {
    const counts = { fetch: 0, xhr: 0, ws: 0, beacon: 0, storage: 0, eventsource: 0 };
    Object.defineProperty(window, '__demoIO', { value: counts });
    for (const [key, name] of [
      ['fetch', 'fetch'],
      ['xhr', 'XMLHttpRequest'],
      ['ws', 'WebSocket'],
      ['eventsource', 'EventSource'],
    ])
      window[name] = function () {
        counts[key]++;
        throw Error('Blocked demo IO');
      };
    navigator.sendBeacon = () => {
      counts.beacon++;
      throw Error('Blocked demo IO');
    };
    for (const name of ['setItem', 'removeItem', 'clear'])
      Storage.prototype[name] = function () {
        counts.storage++;
        throw Error('Blocked demo IO');
      };
  });
}
export async function growthPixels(page, action) {
  await page.evaluate(() => {
    const c = document.querySelector('canvas.relic3d');
    if (!c) throw Error('Missing actual WebGL canvas');
    window.__growthPixels = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      c.setAttribute('data-pixel-probe', '');
      c.addEventListener(
        'relic3d-frame',
        () => {
          clearTimeout(timer);
          c.removeAttribute('data-pixel-probe');
          const gl = c.getContext('webgl2'),
            p = new Uint8Array(c.width * c.height * 4);
          gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, p);
          resolve(p.some((v, i) => i % 4 === 3 && v > 0));
        },
        { once: true },
      );
    });
  });
  await action();
  return page.evaluate(() => window.__growthPixels);
}
