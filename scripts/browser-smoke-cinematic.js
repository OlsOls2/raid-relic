// Parent-run P3 local HTTPS/synthetic signed kernel flow, default GL and explicit SVG.
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
const origin = 'https://localhost:5191';
let tls,
  server,
  sockets,
  browser,
  stage = 'startup',
  failure;
const checks = [],
  errors = [],
  captures = new Map();
async function capture(page, name) {
  if (process.env.P3_CAPTURE !== '1') return;
  const bytes = await page.screenshot({ fullPage: false });
  if (bytes.length <= 512 * 1024) captures.set(name, bytes);
}
try {
  const f = await pilotFixture('memory', { origin });
  tls = await createLocalTLS();
  server = createServer(tls.options, f.runtime.handler);
  sockets = attachOverlaySockets(server, f.runtime.overlayFeeds, {
    origins: [origin],
    allowRead: f.runtime.allowPublicRead,
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(5191, '127.0.0.1', resolve);
  });
  const { chromium } = await import('playwright');
  browser = await chromium.launch({
    executablePath: '/snap/bin/chromium',
    chromiumSandbox: true,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
  });
  await context.addInitScript(() => {
    const counts = { contexts: 0, started: [] };
    window.__p3Audio = counts;
    window.AudioContext = class {
      constructor() {
        counts.contexts++;
        this.state = 'suspended';
        this.currentTime = 0;
        this.destination = {};
      }
      async resume() {
        this.state = 'running';
      }
      async close() {
        this.state = 'closed';
      }
      createGain() {
        return {
          gain: {
            setValueAtTime() {},
            linearRampToValueAtTime() {},
            exponentialRampToValueAtTime() {},
          },
          connect() {},
          disconnect() {},
        };
      }
      createOscillator() {
        let hz;
        const oscillator = {
          frequency: {
            setValueAtTime(value) {
              hz = value;
            },
          },
          connect() {},
          disconnect() {},
          start() {
            counts.started.push(hz);
          },
          stop() {
            oscillator.onended?.();
          },
        };
        return oscillator;
      }
    };
  });
  await context.route('**/*', (r) =>
    new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
  );
  await context.routeWebSocket('**/*', (r) =>
    new URL(r.url()).origin === origin.replace('https:', 'wss:') ? r.connectToServer() : r.close(),
  );
  context.on('page', (p) =>
    p.on('pageerror', (e) => {
      if (errors.length < 8)
        errors.push(
          ['TypeError', 'ReferenceError', 'SyntaxError', 'Error'].includes(e.name)
            ? e.name
            : 'OtherError',
        );
    }),
  );
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  await f.chat(HOME, '811', '!mark moon');
  await f.chat(HOME, HOME, '!relic approve m1');
  const gl = await context.newPage();
  await gl.goto(`${origin}/overlay/${OTHER}?sound=1`);
  await gl.bringToFront();
  await gl.locator('.webgl-relic canvas').waitFor({ state: 'visible' });
  if ((await gl.evaluate(() => window.__p3Audio.contexts)) !== 0)
    throw Error('audio before gesture');
  await gl.getByRole('button', { name: 'Enable optional overlay sounds', exact: true }).click();
  if ((await gl.evaluate(() => window.__p3Audio.contexts)) !== 1) throw Error('trusted audio arm');
  const fallbackContext = await browser.newContext({
    viewport: { width: 160, height: 160 },
    ignoreHTTPSErrors: true,
  });
  await fallbackContext.route('**/*', (r) =>
    new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
  );
  await fallbackContext.routeWebSocket('**/*', (r) =>
    new URL(r.url()).origin === origin.replace('https:', 'wss:') ? r.connectToServer() : r.close(),
  );
  await fallbackContext.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /^webgl/.test(type) ? null : original.call(this, type, ...args);
    };
  });
  const svg = await fallbackContext.newPage();
  await svg.goto(`${origin}/overlay/${OTHER}?corner=1`);
  const source = await context.newPage();
  await source.goto(`${origin}/overlay/${HOME}`);
  stage = 'accepted-only';
  await f.control(HOME, `send:${OTHER}`);
  await source.bringToFront();
  await source.waitForFunction(() => document.querySelector('.archive').dataset.charge === 'true');
  const earlyCharge = await source
    .locator('.archive')
    .evaluate((n) => Number(n.style.getPropertyValue('--charge-level')));
  f.advance(90000);
  await source.reload();
  await source.bringToFront();
  await source.waitForFunction(
    () =>
      document.querySelector('.archive').dataset.charge === 'true' &&
      Number(document.querySelector('.archive').style.getPropertyValue('--charge-level')) >= 0.5,
  );
  const midCharge = await source
    .locator('.archive')
    .evaluate((n) => Number(n.style.getPropertyValue('--charge-level')));
  if (
    !(midCharge > earlyCharge && midCharge < 0.6) ||
    (await f.runtime.state.getPublicJourney()).rings !== 0
  )
    throw Error('accepted local charge progress');
  const acceptedState = await f.runtime.overlayFeeds[OTHER].snapshot();
  if (
    acceptedState.handoff !== null ||
    acceptedState.lineageRings !== 0 ||
    acceptedState.status !== 'waiting'
  )
    throw Error('charge fabricated target arrival');
  await gl.bringToFront();
  await gl.waitForFunction(() => !document.querySelector('#claim-meter').hidden);
  if (
    (await gl.locator('.archive').getAttribute('data-phase')) !== 'idle' ||
    (await gl.locator('.p3-word:not([hidden])').count())
  )
    throw Error('accepted travel');
  stage = 'verified-streak';
  f.advance();
  await f.raid(HOME, OTHER, 2);
  await gl.waitForFunction(
    () =>
      document.querySelector('.archive').dataset.phase === 'streak' &&
      !document.querySelector('.p3-comet').hidden,
  );
  if ((await f.runtime.state.getPublicJourney()).rings !== 0) throw Error('premature ring');
  await capture(gl, 'p3-simulator-streak');
  stage = 'impact';
  f.advance(3200);
  await f.chat(HOME, HOME, '!offer');
  await gl.waitForFunction(() => document.querySelector('.archive').dataset.phase === 'impact');
  const safeFlash = await gl
    .locator('.p3-flash')
    .evaluate((n) => Number(getComputedStyle(n).opacity) <= 0.45);
  if (!safeFlash) throw Error('flash bound');
  await capture(gl, 'p3-simulator-impact');
  stage = 'words';
  f.advance(2200);
  await f.chat(HOME, '812', '!mark sun');
  await gl.waitForFunction(
    () =>
      document.querySelector('.archive').dataset.phase === 'unfurl' &&
      [...document.querySelectorAll('.p3-word:not([hidden])')].some(
        (n) => n.textContent === 'moon',
      ),
  );
  const pixels = await gl.locator('canvas.relic3d').evaluate(
    (canvas) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => resolve(false), 5000);
        canvas.setAttribute('data-pixel-probe', '');
        canvas.addEventListener(
          'relic3d-frame',
          () => {
            clearTimeout(timer);
            canvas.removeAttribute('data-pixel-probe');
            const ctx = canvas.getContext('webgl2') || canvas.getContext('webgl');
            const data = new Uint8Array(canvas.width * canvas.height * 4);
            ctx.readPixels(0, 0, canvas.width, canvas.height, ctx.RGBA, ctx.UNSIGNED_BYTE, data);
            let colored = 0;
            for (let i = 0; i < data.length; i += 4)
              if (data[i + 3] > 0 && Math.max(data[i], data[i + 1], data[i + 2]) > 20) colored++;
            resolve(colored > 10 && data[3] === 0 && Number(canvas.dataset.triangles) < 20000);
          },
          { once: true },
        );
      }),
  );
  if (!pixels) throw Error('actual colored transparent GL');
  if (
    (await gl.locator('.p3-word').count()) !== 8 ||
    (await gl.locator('.p3-word:not([hidden])').count()) > 8
  )
    throw Error('pool bounds');
  await gl.waitForFunction(() => {
    const word = [...document.querySelectorAll('.p3-word')].find((n) => n.textContent === 'moon');
    if (!word || word.hidden || Number(getComputedStyle(word).opacity) <= 0.6) return false;
    const r = word.getBoundingClientRect(),
      a = document.querySelector('.archive').getBoundingClientRect();
    return (
      r.width > 0 &&
      r.left >= a.left &&
      r.right <= a.right &&
      r.top >= a.top &&
      r.bottom <= a.bottom
    );
  });
  const aligned = await gl.evaluate(async () => {
    const { runePose } = await import('/cinematic.js');
    const archive = document.querySelector('.archive'),
      a = archive.getBoundingClientRect();
    const word = [...document.querySelectorAll('.p3-word')].find((n) => n.textContent === 'moon'),
      r = word.getBoundingClientRect();
    const pose = runePose(
      Number(word.dataset.orbitIndex),
      document.querySelectorAll('.rune').length,
      performance.now(),
      Number(archive.style.getPropertyValue('--arrival')),
    );
    return (
      Math.abs((r.left + r.right) / 2 - (a.left + (a.width * pose.x) / 100)) < 25 &&
      Math.abs(r.top - (a.top + (a.height * pose.y) / 100)) < 35
    );
  });
  if (!aligned) throw Error('word/rune pose mismatch');
  await capture(gl, 'p3-simulator-words');
  await svg.bringToFront();
  await svg.locator('.p3-word').filter({ hasText: 'moon' }).waitFor({ state: 'visible' });
  if (
    await svg.evaluate(
      () =>
        document.documentElement.scrollWidth > 160 || document.documentElement.scrollHeight > 160,
    )
  )
    throw Error('corner overflow');
  stage = 'fusion';
  await f.chat(OTHER, OTHER, '!accept');
  if ((await f.runtime.state.getPublicJourney()).rings !== 1) throw Error('claim ring');
  stage = 'privacy';
  await f.chat(HOME, '811', '!relic forgetme');
  await gl.bringToFront();
  await gl.waitForFunction(
    () =>
      document.querySelectorAll('.rune').length === 0 &&
      [...document.querySelectorAll('.p3-word')].every((n) => !n.textContent),
  );
  await svg.bringToFront();
  await svg.waitForFunction(() =>
    [...document.querySelectorAll('.p3-word')].every((n) => !n.textContent),
  );
  stage = 'fusion';
  if (
    (await gl.evaluate(
      () => window.__p3Audio.started.filter((h) => h === 440 || h === 659.25).length,
    )) !== 0
  )
    throw Error('early claim chord');
  f.advance(14650);
  await f.chat(HOME, HOME, '!relic resume');
  await gl.bringToFront();
  await gl.waitForFunction(
    () =>
      !document.querySelector('.p3-fusion').hidden &&
      document.querySelector('#lineage').textContent.includes('1 completed'),
  );
  await gl.waitForFunction(
    () => window.__p3Audio.started.filter((h) => h === 440 || h === 659.25).length === 2,
  );
  await gl.locator('.p3-fuse-offer').waitFor({ state: 'visible' });
  await gl.locator('.p3-fuse-accept').waitFor({ state: 'visible' });
  await capture(gl, 'p3-simulator-fusion');
  await f.chat(HOME, HOME, '!relic resume');
  await gl.waitForTimeout(250);
  if (
    (await gl.evaluate(
      () => window.__p3Audio.started.filter((h) => h === 440 || h === 659.25).length,
    )) !== 2
  )
    throw Error('duplicate chord');
  await gl.reload();
  await gl.bringToFront();
  await gl.locator('#lineage').filter({ hasText: '1 completed' }).waitFor();
  if ((await gl.evaluate(() => window.__p3Audio.contexts)) !== 0) throw Error('reconnect autoplay');
  await gl.getByRole('button', { name: 'Enable optional overlay sounds', exact: true }).click();
  await gl.waitForTimeout(250);
  if (
    (await gl.evaluate(
      () => window.__p3Audio.started.filter((h) => h === 440 || h === 659.25).length,
    )) !== 0
  )
    throw Error('reconnect chord');
  await gl.bringToFront();
  await gl.emulateMedia({ reducedMotion: 'reduce' });
  await gl.waitForFunction(
    () => document.querySelector('.p3-flash').hidden && document.querySelector('.p3-comet').hidden,
  );
  if (errors.length) throw Error('page error');
  checks.push({
    name: 'SIMULATOR actual GL and SVG receipt/word pool/fusion/privacy/reduced-motion; no live proof',
    passed: true,
  });
  stage = 'complete';
} catch (e) {
  failure = ['EPERM', 'ENOENT', 'EADDRINUSE'].includes(e?.code)
    ? e.code
    : e?.name === 'TimeoutError'
      ? 'timeout'
      : 'assertion-or-browser';
} finally {
  await browser?.close().catch(() => {});
  sockets?.close();
  if (server?.listening) await new Promise((r) => server.close(r));
  await tls?.cleanup();
  await mkdir('artifacts', { recursive: true });
  for (const [name, bytes] of captures) await writeFile(`artifacts/${name}.png`, bytes);
  await writeFile(
    'artifacts/cinematic-browser-results.json',
    JSON.stringify(
      {
        simulator: true,
        stage,
        passed: !failure,
        failure: failure ?? null,
        errors,
        checks,
        captures: [...captures.keys()],
      },
      null,
      2,
    ),
  );
}
if (failure) process.exitCode = 1;
