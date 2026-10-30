// LOCAL native headless Chromium CDP PIPE only. No Playwright browser connection, debug
// network port, focus emulation, hidden override, clock emulation or vendor patch.
import { spawn } from 'node:child_process';
import { access, constants, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { visualReview, localChromiumOptions } from './visual-review.js';
import { filmResourceReason } from './film-resources.js';
const MAX_PROTOCOL = 4 * 1024 * 1024,
  MAX_INFLIGHT = 64;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const protocolError = (code = 1) =>
  Object.assign(new Error('Native local protocol failure'), {
    name: 'ProtocolError',
    nativeProtocolCode: Number.isInteger(code) && code >= 1 && code <= 7 ? code : 4,
  });
export async function nativeFilmReview() {
  let fixture,
    chrome,
    profile,
    closed = false,
    fatal = null,
    buffer = Buffer.alloc(0),
    sequence = 0;
  const pending = new Map(),
    sessions = new Map(),
    pages = [],
    initScripts = [];
  let errors = 0,
    external = 0;
  const stopOwned = (signal) => {
    if (chrome?.pid) {
      try {
        process.kill(-chrome.pid, signal);
      } catch {
        try {
          chrome.kill(signal);
        } catch {}
      }
    }
  };
  const fail = (code = 4) => {
    fatal ??= protocolError(code);
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(fatal);
    }
    pending.clear();
    stopOwned('SIGTERM');
  };
  const send = (method, params = {}, sessionId) => {
    if (closed || fatal || pending.size >= MAX_INFLIGHT) return Promise.reject(protocolError());
    const id = ++sequence;
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    if (Buffer.byteLength(payload) > MAX_PROTOCOL) return Promise.reject(protocolError(2));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(protocolError(3));
        fail(3);
      }, 15000);
      pending.set(id, { resolve, reject, timer });
      chrome.stdio[3].write(payload + '\0', (error) => {
        if (error) fail();
      });
    });
  };
  let closeJob;
  const close = () => {
    closeJob ??= cleanup();
    return closeJob;
  };
  const cleanup = async () => {
    if (closed) return;
    try {
      if (chrome && chrome.exitCode === null && chrome.signalCode === null && !fatal)
        await send('Browser.close').catch(() => {});
      if (chrome && chrome.exitCode === null && chrome.signalCode === null) {
        stopOwned('SIGTERM');
        for (let n = 0; n < 30 && chrome.exitCode === null && chrome.signalCode === null; n++)
          await delay(100);
        if (chrome.exitCode === null && chrome.signalCode === null) stopOwned('SIGKILL');
        for (let n = 0; n < 20 && chrome.exitCode === null && chrome.signalCode === null; n++)
          await delay(100);
      }
    } finally {
      stopOwned('SIGTERM');
      closed = true;
      for (const task of pending.values()) {
        clearTimeout(task.timer);
        task.reject(protocolError());
      }
      pending.clear();
      sessions.clear();
      if (profile) await rm(profile, { recursive: true, force: true });
      await fixture?.close();
    }
  };
  try {
    if (!process.getuid?.()) throw protocolError(7);
    fixture = await visualReview({ fixtureOnly: true });
    let executable = '/snap/chromium/current/usr/lib/chromium-browser/chrome';
    try {
      await access(executable, constants.X_OK);
    } catch {
      // Resolve the already installed SDK toolchain only; never launch/connect
      // a framework browser or download dependencies here.
      const { chromium } = await import('playwright-core');
      executable = (await localChromiumOptions(chromium)).executablePath;
    }
    profile = await mkdtemp(join(tmpdir(), 'raid-relic-native-film-'));
    await mkdir(join(profile, 'home'), { mode: 0o700 });
    const env = {
      PATH: '/usr/bin:/bin',
      HOME: join(profile, 'home'),
      TMPDIR: tmpdir(),
      XDG_CACHE_HOME: join(profile, 'cache'),
    };
    chrome = spawn(
      executable,
      [
        '--headless=new',
        '--js-flags=--max-old-space-size=128',
        '--remote-debugging-pipe',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-background-networking',
        '--disable-component-update',
        '--disable-extensions',
        '--disable-sync',
        '--disable-default-apps',
        '--disable-client-side-phishing-detection',
        '--metrics-recording-only',
        '--disable-dev-shm-usage',
        '--window-size=1320,840',
        '--user-data-dir=' + profile,
        'about:blank',
      ],
      { env, detached: true, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
    );
    chrome.on('error', fail);
    chrome.on('exit', () => {
      if (!closed) fail();
    });
    chrome.stdio[3].on('error', fail);
    chrome.stdio[4].on('error', fail);
    chrome.stdio[4].on('data', (chunk) => {
      if (buffer.length + chunk.length > MAX_PROTOCOL) {
        fail();
        return;
      }
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const end = buffer.indexOf(0);
        if (end < 0) break;
        const raw = buffer.subarray(0, end);
        buffer = buffer.subarray(end + 1);
        if (!raw.length) continue;
        let message;
        try {
          message = JSON.parse(raw);
        } catch {
          fail();
          return;
        }
        if (message.id !== undefined) {
          const task = pending.get(message.id);
          if (task) {
            pending.delete(message.id);
            clearTimeout(task.timer);
            message.error ? task.reject(protocolError(5)) : task.resolve(message.result);
          }
        } else {
          const page = sessions.get(message.sessionId);
          if (message.method === 'Browser.downloadWillBegin') {
            const owner =
              pages.find((entry) => entry.frameId === message.params.frameId) ?? pages[0];
            owner?.emit('download', {});
          }
          if (page) void page.event(message.method, message.params).catch(fail);
        }
      }
    });
    await send('Browser.getVersion');
    await send('Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true });
    const context = {
      async addInitScript(fn) {
        const source = '(' + fn.toString() + ')();';
        if (initScripts.length >= 8 || Buffer.byteLength(source) > 131072) throw protocolError();
        initScripts.push(source);
        for (const page of pages)
          await send('Page.addScriptToEvaluateOnNewDocument', { source }, page.session);
      },
      async newPage() {
        if (pages.length >= 4) throw protocolError();
        const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        const listeners = new Map();
        const page = {
          id: targetId,
          session: sessionId,
          frameId: null,
          currentURL: 'about:blank',
          size: { width: 1280, height: 720 },
          on(name, fn) {
            const list = listeners.get(name) ?? [];
            if (list.length >= 8) throw protocolError();
            list.push(fn);
            listeners.set(name, list);
          },
          emit(name, value) {
            for (const fn of listeners.get(name) ?? []) fn(value);
          },
          async event(method, params) {
            if (method === 'Runtime.exceptionThrown') errors++;
            if (method === 'Page.frameNavigated' && !params.frame.parentId)
              page.frameId = params.frame.id;
            if (method === 'Network.requestWillBeSent') {
              const request = params.request;
              if (request.url.length > 131072) throw protocolError();
              page.emit('request', {
                url: () => request.url,
                method: () => request.method,
                resourceType: () => (params.type ?? 'other').toLowerCase(),
              });
            }
            if (method === 'Network.webSocketCreated') {
              external++;
              throw protocolError();
            }
            if (method === 'Fetch.requestPaused') {
              const request = {
                url: params.request.url,
                method: params.request.method,
                resourceType: (params.resourceType ?? 'other').toLowerCase(),
              };
              const owned = request.url.startsWith('blob:')
                ? await page.evaluate(() => ({
                    preview: document.querySelector('#film-card')?.src,
                    ownedPNGs: window.__timingOwnedPNGs ?? window.__wallFilm?.ownedPNGs ?? [],
                  }))
                : {};
              if (
                ['static', 'owned-preview'].includes(
                  filmResourceReason(request, { origin: fixture.origin, ...owned }),
                )
              )
                await send('Fetch.continueRequest', { requestId: params.requestId }, sessionId);
              else {
                external++;
                await send(
                  'Fetch.failRequest',
                  { requestId: params.requestId, errorReason: 'BlockedByClient' },
                  sessionId,
                );
              }
            }
          },
          url() {
            return page.currentURL;
          },
          async goto(url) {
            if (
              !['static'].includes(
                filmResourceReason(
                  { url, method: 'GET', resourceType: 'document' },
                  { origin: fixture.origin },
                ),
              )
            )
              throw protocolError();
            await send('Page.navigate', { url }, sessionId);
            page.currentURL = url;
            await page.waitForFunction(() =>
              Boolean(
                document.querySelector('#film-play') && document.body.dataset.presentationDuration,
              ),
            );
          },
          async evaluate(fn, arg) {
            const expression =
              '(' + fn.toString() + ')(' + (JSON.stringify(arg) ?? 'undefined') + ')';
            const result = await send(
              'Runtime.evaluate',
              { expression, returnByValue: true, awaitPromise: true },
              sessionId,
            );
            if (result.exceptionDetails) throw protocolError(6);
            return result.result.value;
          },
          async waitForFunction(fn, arg, options = {}) {
            const timeout = options.timeout ?? 30000;
            if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 30000) throw protocolError();
            const start = performance.now();
            while (performance.now() - start < timeout) {
              if (await page.evaluate(fn, arg)) return;
              await delay(100);
            }
            throw Object.assign(new Error('Native local condition deadline'), {
              name: 'TimeoutError',
            });
          },
          waitForTimeout: (ms) => {
            if (!Number.isFinite(ms) || ms < 0 || ms > 60000) throw protocolError();
            return delay(ms);
          },
          async bringToFront() {
            await send('Target.activateTarget', { targetId });
          },
          async setViewportSize(size) {
            if (
              !Number.isInteger(size.width) ||
              !Number.isInteger(size.height) ||
              size.width <= 0 ||
              size.height <= 0 ||
              size.width * size.height * 4 > 4 * 1024 * 1024
            )
              throw protocolError();
            page.size = { ...size };
            await send(
              'Emulation.setDeviceMetricsOverride',
              { ...size, deviceScaleFactor: 1, mobile: false },
              sessionId,
            );
          },
          viewportSize() {
            return { ...page.size };
          },
          async emulateMedia({ reducedMotion }) {
            if (!['reduce', 'no-preference'].includes(reducedMotion)) throw protocolError();
            await send(
              'Emulation.setEmulatedMedia',
              { features: [{ name: 'prefers-reduced-motion', value: reducedMotion }] },
              sessionId,
            );
          },
          locator(selector) {
            if (typeof selector !== 'string' || selector.length > 256) throw protocolError();
            // Serialize the trusted test function without evaluating strings in
            // page code (CSP remains effective; no eval/Function escape).
            const run = async (fn, arg) => {
              const expression =
                '(' +
                fn.toString() +
                ')(document.querySelector(' +
                JSON.stringify(selector) +
                '),' +
                (JSON.stringify(arg) ?? 'undefined') +
                ')';
              const result = await send(
                'Runtime.evaluate',
                { expression, returnByValue: true, awaitPromise: true },
                sessionId,
              );
              if (result.exceptionDetails) throw protocolError(6);
              return result.result.value;
            };
            return {
              evaluate: run,
              getAttribute: (name) => run((node, key) => node.getAttribute(key), name),
              innerText: () => run((node) => node.innerText),
              isVisible: () =>
                run((node) => {
                  if (!node) return false;
                  const box = node.getBoundingClientRect();
                  const style = getComputedStyle(node);
                  return (
                    box.width > 0 &&
                    box.height > 0 &&
                    style.display !== 'none' &&
                    style.visibility !== 'hidden'
                  );
                }),
              count: () =>
                page.evaluate((query) => document.querySelectorAll(query).length, selector),
              focus: () => run((node) => node.focus()),
              async click() {
                const box = await run((node) => {
                  if (!node) throw Error('Local action unavailable');
                  node.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
                  const box = node.getBoundingClientRect();
                  const style = getComputedStyle(node);
                  const x = box.x + box.width / 2;
                  const y = box.y + box.height / 2;
                  const hit = document.elementFromPoint(x, y);
                  if (
                    node.matches(':disabled') ||
                    node.closest('[inert], [aria-disabled="true"]') ||
                    !box.width ||
                    !box.height ||
                    style.display === 'none' ||
                    style.visibility !== 'visible' ||
                    Number(style.opacity) === 0 ||
                    x < 0 ||
                    y < 0 ||
                    x >= innerWidth ||
                    y >= innerHeight ||
                    !hit ||
                    !node.contains(hit)
                  )
                    throw Error('Local action unavailable');
                  return { x, y };
                });
                await send(
                  'Input.dispatchMouseEvent',
                  { type: 'mousePressed', ...box, button: 'left', clickCount: 1 },
                  sessionId,
                );
                await send(
                  'Input.dispatchMouseEvent',
                  { type: 'mouseReleased', ...box, button: 'left', clickCount: 1 },
                  sessionId,
                );
              },
            };
          },
          keyboard: {
            async press(key) {
              if (key !== 'Space') throw protocolError();
              for (const type of ['keyDown', 'keyUp'])
                await send(
                  'Input.dispatchKeyEvent',
                  {
                    type,
                    code: 'Space',
                    key: ' ',
                    windowsVirtualKeyCode: 32,
                    nativeVirtualKeyCode: 32,
                  },
                  sessionId,
                );
            },
          },
          async screenshot({ fullPage = false } = {}) {
            if (fullPage) throw protocolError();
            const { data } = await send(
              'Page.captureScreenshot',
              {
                format: 'png',
                fromSurface: true,
                captureBeyondViewport: false,
                clip: { x: 0, y: 0, ...page.size, scale: 1 },
              },
              sessionId,
            );
            const bytes = Buffer.from(data, 'base64');
            if (bytes.length > 524288) throw protocolError();
            return bytes;
          },
        };
        pages.push(page);
        sessions.set(sessionId, page);
        await send('Page.enable', {}, sessionId);
        await send('Runtime.enable', {}, sessionId);
        await send(
          'Network.enable',
          { maxTotalBufferSize: 2097152, maxResourceBufferSize: 524288 },
          sessionId,
        );
        await send('Network.setBypassServiceWorker', { bypass: true }, sessionId);
        await send('Security.setIgnoreCertificateErrors', { ignore: true }, sessionId);
        await send(
          'Fetch.enable',
          { patterns: [{ urlPattern: '*', requestStage: 'Request' }] },
          sessionId,
        );
        for (const source of initScripts)
          await send('Page.addScriptToEvaluateOnNewDocument', { source }, sessionId);
        await page.setViewportSize(page.size);
        return page;
      },
      close,
    };
    const page = await context.newPage();
    return {
      origin: fixture.origin,
      fixture: fixture.fixture,
      context,
      page,
      observe() {},
      stats: () => ({ errors, external }),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}

// Fail early on blank pages before any presentation observation starts.
export async function nativeTabVisibilityPreflight(pages, diagnostic) {
  if (pages.length !== 2 || pages.some((page) => page.url() !== 'about:blank'))
    throw Error('Blank tab visibility preflight required');
  diagnostic.visibilityPreflightTurns = 0;
  for (let i = 0; i < pages.length; i++) {
    diagnostic.visibilityPreflightActivePage = i;
    try {
      await pages[i].bringToFront();
      await Promise.all(
        pages.map((page, index) =>
          page.waitForFunction((expected) => document.hidden === expected, index !== i, {
            timeout: 5000,
          }),
        ),
      );
      diagnostic.visibilityPreflightTurns++;
    } finally {
      diagnostic.visibilityPreflightHidden0 = Number(
        await pages[0].evaluate(() => document.hidden),
      );
      diagnostic.visibilityPreflightHidden1 = Number(
        await pages[1].evaluate(() => document.hidden),
      );
    }
  }
}
