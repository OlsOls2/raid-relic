import { localOverlayArrival, validSnapshot } from '../public/overlay-client.js';
// Native local QA only: explicit synthetic grants, self-only TLS, Chromium sandbox.
import { createServer } from 'node:https';
import { createLocalTLS } from './local-tls.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
import { pilotFixture } from './pilot-fixture.js';
import { access, constants, realpath } from 'node:fs/promises';
import { isAbsolute, sep } from 'node:path';
export async function localChromiumOptions(chromium) {
  try {
    await access('/snap/bin/chromium', constants.X_OK);
    return { executablePath: '/snap/bin/chromium', headless: true, chromiumSandbox: true };
  } catch {
    const cache = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!cache || !isAbsolute(cache) || cache === '/')
      throw Error('Explicit local browser cache required');
    const root = await realpath(cache),
      executablePath = await realpath(chromium.executablePath());
    if (!executablePath.startsWith(root + sep)) throw Error('Browser outside toolchain cache');
    await access(executablePath, constants.X_OK);
    return { executablePath, headless: true, chromiumSandbox: true };
  }
}
export async function visualReview({
  seekers = false,
  durable = false,
  backgroundThrottling = false,
  headed = false,
  fixtureOnly = false,
  readProjection = false,
} = {}) {
  if (readProjection && (durable || fixtureOnly))
    throw Error('Isolated projection fixture required');
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
  // Local transport seam only: no change to the runtime, stores or routes.
  // The same socket upgrade/read-policy/Origin checks still own admission.
  const projectionValues = new Map();
  const projectionListeners = new Map();
  const wireFeeds = readProjection
    ? Object.fromEntries(
        Object.entries(fixture.runtime.overlayFeeds).map(([id, feed]) => {
          const listeners = new Set();
          projectionListeners.set(id, listeners);
          return [
            id,
            {
              ...feed,
              snapshot: () =>
                projectionValues.has(id)
                  ? Promise.resolve({ ...projectionValues.get(id), serverNow: Date.now() })
                  : feed.snapshot(),
              subscribe(listener) {
                listeners.add(listener);
                const unsubscribe = feed.subscribe(listener);
                return () => {
                  listeners.delete(listener);
                  unsubscribe();
                };
              },
            },
          ];
        }),
      )
    : fixture.runtime.overlayFeeds;
  let sockets = attachOverlaySockets(server, wireFeeds, {
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
    if (fixtureOnly === true)
      return {
        origin,
        fixture,
        close: async () => {
          sockets.close();
          server.closeAllConnections();
          await new Promise((resolve) => server.close(resolve));
          await tls.cleanup();
        },
      };
    const { chromium } = await import('playwright-core');
    browser = await chromium.launch({
      ...(await localChromiumOptions(chromium)),
      ...(headed === true ? { headless: false } : {}),
      ...(backgroundThrottling === true
        ? {
            ignoreDefaultArgs: [
              '--disable-background-timer-throttling',
              '--disable-backgrounding-occluded-windows',
              '--disable-renderer-backgrounding',
            ],
          }
        : {}),
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
      async projectArrival(channel) {
        if (!readProjection || !projectionListeners.has(channel) || projectionValues.has(channel))
          throw Error('Closed projection fixture');
        const base = await fixture.runtime.overlayFeeds[channel].snapshot();
        const now = Date.now();
        const value = { ...localOverlayArrival('host', now), revision: base.revision + 1 };
        if (!validSnapshot(value) || Buffer.byteLength(JSON.stringify(value)) > 131072)
          throw Error('Invalid projection fixture');
        projectionValues.set(channel, value);
        for (const listener of projectionListeners.get(channel)) listener(structuredClone(value));
        return { startedAt: now, endsAt: now + 180000, revision: value.revision };
      },
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
        projectionValues.clear();
        projectionListeners.clear();
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
