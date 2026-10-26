// Parent-run local-only P2 gate. No screenshots, providers or synthetic live claims.
import { mkdir, writeFile } from 'node:fs/promises';
import { createJudges, JUDGES_ORIGIN } from '../test-support/judges.js';
const judges = await createJudges({ intent: true, env: {} });
let browser,
  failure = null,
  stage = 'startup';
const checks = [],
  captures = new Map(),
  pageErrors = [];
let activePage,
  diagnostic = null;
async function pixels(page) {
  return page.locator('canvas.relic3d').evaluate(
    (canvas) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          canvas.removeAttribute('data-pixel-probe');
          resolve(null);
        }, 5000);
        canvas.setAttribute('data-pixel-probe', '');
        canvas.addEventListener(
          'relic3d-frame',
          () => {
            clearTimeout(timer);
            canvas.removeAttribute('data-pixel-probe');
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            const bytes = new Uint8Array(canvas.width * canvas.height * 4);
            gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
            let colored = 0,
              transparent = 0;
            for (let i = 0; i < bytes.length; i += 4) {
              if (bytes[i + 3] === 0) transparent++;
              if (bytes[i + 3] > 0 && Math.max(bytes[i], bytes[i + 1], bytes[i + 2]) > 20)
                colored++;
            }
            resolve({
              colored,
              transparent,
              corners: [
                3,
                (canvas.width - 1) * 4 + 3,
                (canvas.height - 1) * canvas.width * 4 + 3,
                bytes.length - 1,
              ].every((i) => bytes[i] === 0),
            });
          },
          { once: true },
        );
      }),
  );
}
const capture = async (page, name) => {
  if (process.env.P2_CAPTURE === '1')
    captures.set(name, await page.screenshot({ fullPage: false }));
};
try {
  await judges.listen();
  const { chromium } = await import('playwright');
  browser = await chromium.launch({
    executablePath: '/snap/bin/chromium',
    chromiumSandbox: true,
    headless: true,
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
  });
  await context.route('**/*', (r) =>
    new URL(r.request().url()).origin === JUDGES_ORIGIN ? r.continue() : r.abort(),
  );
  await context.routeWebSocket('**/*', (r) =>
    new URL(r.url()).origin === JUDGES_ORIGIN.replace('http', 'ws')
      ? r.connectToServer()
      : r.close(),
  );
  context.on('page', (p) =>
    p.on('pageerror', (e) => {
      if (pageErrors.length < 8)
        pageErrors.push(
          ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'Error'].includes(e.name)
            ? e.name
            : 'OtherError',
        );
    }),
  );
  const page = await context.newPage();
  activePage = page;
  stage = 'webgl';
  await page.goto(`${JUDGES_ORIGIN}/overlay/1591805230`);
  await page.bringToFront();
  await page.locator('.webgl-relic canvas.relic3d').waitFor({ state: 'visible' });
  if ((await page.locator('canvas.relic3d').getAttribute('data-antialias-requested')) !== 'true')
    throw Error('full-size antialias request');
  const alpha = await page.locator('canvas.relic3d').evaluate((canvas) => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const r = canvas.getBoundingClientRect();
    return (
      gl?.getContextAttributes().alpha &&
      canvas.width === Math.round(r.width) &&
      r.left >= 0 &&
      r.top >= 0 &&
      r.right <= innerWidth &&
      r.bottom <= innerHeight
    );
  });
  if (!alpha) throw Error('alpha or bounds');
  const fullPixels = await pixels(page);
  if (!fullPixels || fullPixels.colored < 10 || !fullPixels.corners || fullPixels.transparent < 10)
    throw Error('colored transparent pixels');
  await page.locator('#simulator').waitFor({ state: 'visible' });
  if ((await page.locator('canvas.relic3d').getAttribute('data-fps')) !== '30')
    throw Error('idle fps');
  stage = 'target-open';
  for (const action of ['setup', 'mark', 'send', 'raid', 'offer', 'accept']) {
    const response = await page.evaluate(async (action) => {
      const r = await fetch('/api/judges/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      return { status: r.status };
    }, action);
    if (response.status !== 200) throw Error('mock kernel action');
    if (action === 'send') {
      stage = 'target-open';
      await page.goto(`${JUDGES_ORIGIN}/overlay/1591806023`);
      await page.bringToFront();
      await page.locator('.webgl-relic canvas').waitFor({ state: 'visible' });
      await page.locator('#claim-label').filter({ hasText: 'Awaiting verified raid' }).waitFor();
      if (
        !(await page.evaluate(async () => {
          const view = await (await fetch('/api/overlay/1591806023')).json();
          return (
            view.handoff === null &&
            view.lineageRings === 0 &&
            view.marks.length === 0 &&
            document.querySelector('.archive').dataset.phase === 'idle' &&
            document.querySelector('canvas.relic3d').dataset.fps === '30'
          );
        }))
      )
        throw Error('acceptance must stay idle30fps');
    }
  }
  await page.bringToFront();
  stage = 'sprites';
  await page.waitForFunction(
    () => document.querySelector('canvas.relic3d')?.dataset.sprites === '1',
  );
  stage = 'arrivalfps';
  await page.waitForFunction(
    () =>
      ['streak', 'impact', 'unfurl'].includes(document.querySelector('.archive').dataset.phase) &&
      document.querySelector('canvas.relic3d')?.dataset.fps === '60',
  );
  const budget = await page.locator('canvas.relic3d').evaluate((c) => Number(c.dataset.triangles));
  if (!(budget > 0 && budget < 20000)) throw Error('triangle budget');
  if (process.env.P2_CAPTURE === '1') {
    await page.waitForFunction(
      () => document.querySelector('.archive').dataset.phase === 'settled',
    );
    await page.waitForFunction(
      () => document.querySelector('canvas.relic3d')?.dataset.sprites === '1',
    );
    await capture(page, 'relic3d-simulator-approved-full');
  }
  stage = 'reduced-svg';
  await page.bringToFront();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(
    () =>
      matchMedia('(prefers-reduced-motion: reduce)').matches &&
      !document.querySelector('.archive').classList.contains('webgl-relic') &&
      document.querySelector('canvas.relic3d').hidden,
  );
  await page.locator('.rune').waitFor({ state: 'visible' });
  stage = 'resume-webgl';
  await page.bringToFront();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.locator('.webgl-relic canvas.relic3d').waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => document.querySelector('canvas.relic3d')?.dataset.sprites === '1',
  );
  stage = 'private-capacity-fixture';
  const capacity = await page.evaluate(async () => {
    const { createRelic3D } = await import('/relic3d.js');
    const publicView = await (await fetch('/api/overlay/1591806023')).json();
    if (publicView.marks.length !== 1) return null;
    const container = document.createElement('section');
    container.style.cssText =
      'position:fixed;left:0;top:0;width:360px;z-index:20;background:#101d30';
    const label = document.createElement('p');
    label.textContent = 'SIMULATOR · PRIVATE GPU CAPACITY FIXTURE · NOT LIVE';
    container.append(label);
    const archive = document.createElement('div');
    archive.className = 'archive';
    archive.style.cssText = 'width:360px;height:360px';
    archive.dataset.phase = 'idle';
    container.append(archive);
    document.body.append(container);
    const abort = new AbortController();
    let view;
    try {
      view = await createRelic3D({
        archive,
        signal: abort.signal,
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)'),
      });
      if (!view.available) return null;
      view.update({
        lineageRings: 19,
        marks: Array.from({ length: 160 }, () => ({ runeSvg: publicView.marks[0].runeSvg })),
      });
      const result = await new Promise((resolve) => {
        let done = false;
        const timer = setTimeout(() => {
          done = true;
          resolve(null);
        }, 10000);
        const check = () => {
          if (done) return;
          const c = archive.querySelector('canvas');
          if (c?.dataset.sprites === '160' && Number(c.dataset.triangles) > 0) {
            done = true;
            clearTimeout(timer);
            resolve({ triangles: Number(c.dataset.triangles), sprites: Number(c.dataset.sprites) });
          } else setTimeout(check, 50);
        };
        check();
      });
      return result;
    } finally {
      abort.abort();
      view?.dispose();
      container.remove();
    }
  });
  if (
    !capacity ||
    capacity.sprites !== 160 ||
    capacity.triangles >= 20000 ||
    capacity.triangles < 12000
  )
    throw Error('actual max geometry budget');
  stage = 'fade-removal';
  for (let i = 0; i < 3; i++)
    await page.evaluate(() =>
      fetch('/api/judges/action', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'closure' }),
      }),
    );
  await page.waitForFunction(
    () => document.querySelector('canvas.relic3d')?.dataset.fadedSprites === '1',
  );
  await page.evaluate(() =>
    fetch('/api/judges/action', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'forget' }),
    }),
  );
  await page.waitForFunction(
    () => document.querySelector('canvas.relic3d')?.dataset.sprites === '0',
  );
  stage = 'corner-webgl';
  await page.setViewportSize({ width: 160, height: 160 });
  await page.goto(`${JUDGES_ORIGIN}/overlay/1591806023?corner=1`);
  await page.bringToFront();
  await page.locator('.webgl-relic canvas').waitFor({ state: 'visible' });
  if (
    !(await page.locator('canvas.relic3d').evaluate((c) => {
      const r = c.getBoundingClientRect();
      return (
        r.right <= 160 &&
        r.bottom <= 160 &&
        r.width <= 92 &&
        c.width === Math.round(r.width) &&
        c.dataset.fps === '30'
      );
    }))
  )
    throw Error('corner WebGL bounds');
  const cornerPixels = await pixels(page);
  if (!cornerPixels || cornerPixels.colored < 5 || !cornerPixels.corners)
    throw Error('corner pixel proof');
  await capture(page, 'relic3d-simulator-corner');
  stage = 'injected-hidden-pause';
  const previousHidden = await page.evaluateHandle(
    () => Object.getOwnPropertyDescriptor(document, 'hidden') ?? null,
  );
  try {
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    const frames = await page.locator('canvas.relic3d').getAttribute('data-frames');
    await page.waitForTimeout(250);
    if ((await page.locator('canvas.relic3d').getAttribute('data-frames')) !== frames)
      throw Error('injected hidden render');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction(
      (n) => Number(document.querySelector('canvas.relic3d').dataset.frames) > Number(n),
      frames,
    );
  } finally {
    await page.evaluate((previous) => {
      if (previous) Object.defineProperty(document, 'hidden', previous);
      else delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    }, previousHidden);
    await previousHidden.dispose();
  }
  stage = 'context-loss';
  const lost = await page.locator('canvas.relic3d').evaluate((canvas) => {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    const extension = gl.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    return true;
  });
  if (!lost) throw Error('context-loss unavailable');
  await page.waitForFunction(
    () => !document.querySelector('.archive').classList.contains('webgl-relic'),
  );
  await page.locator('.crystal').waitFor({ state: 'visible' });
  checks.push({
    name: 'SIMULATOR transparent bounded WebGL and actual context-loss SVG fallback',
    passed: true,
  });
  stage = 'demo-physical-buffer';
  const demo = await context.newPage();
  await demo.goto(`${JUDGES_ORIGIN}/demo/`);
  await demo.bringToFront();
  await demo.locator('#demo-tour').click();
  await demo.locator('canvas.relic3d').waitFor({ state: 'visible' });
  await demo.evaluate(() => {
    window.__bufferCanvas = document.querySelector('canvas.relic3d');
  });
  for (const width of [1280, 390, 375, 160]) {
    await demo.setViewportSize({ width, height: 844 });
    await demo.waitForFunction(() => {
      const c = document.querySelector('canvas.relic3d'),
        r = document.querySelector('#demo-art').getBoundingClientRect(),
        scale = Math.min(1, 480 / Math.max(r.width, r.height)),
        w = Math.max(1, Math.round(r.width * scale)),
        h = Math.max(1, Math.round(r.height * scale));
      return (
        c === window.__bufferCanvas &&
        !c.hidden &&
        c.width === w &&
        c.height === h &&
        Number(c.dataset.projectionAspect) === w / h &&
        c.width <= 480 &&
        c.height <= 480
      );
    });
    const proof = await pixels(demo);
    if (!proof || proof.colored < 5 || proof.transparent < 10)
      throw Error('physical rectangular buffer pixels');
    if (
      width === 390 &&
      !(await demo
        .locator('canvas.relic3d')
        .evaluate(
          (c) =>
            c.width > c.height &&
            Math.abs(
              c.width / c.height -
                c.getBoundingClientRect().width / c.getBoundingClientRect().height,
            ) < 0.02,
        ))
    )
      throw Error('mobile rectangular projection');
  }
  await demo.close();
  stage = 'small-widget-context-profile';
  const small = await context.newPage();
  await small.setViewportSize({ width: 390, height: 844 });
  await small.goto(`${JUDGES_ORIGIN}/demo/`);
  await small.bringToFront();
  await small.locator('#demo-send').click();
  await small.locator('canvas.relic3d').waitFor({ state: 'visible' });
  if (
    !(await small.locator('canvas.relic3d').evaluate((c) => {
      const g = c.getContext('webgl2') || c.getContext('webgl');
      return (
        c.dataset.antialiasRequested === 'false' &&
        g.getContextAttributes().antialias === false &&
        Number(c.dataset.frames) > 0 &&
        c.width > c.height
      );
    }))
  )
    throw Error('small widget actual MSAA profile');
  const smallPixels = await pixels(small);
  if (!smallPixels || smallPixels.colored < 5 || smallPixels.transparent < 10)
    throw Error('small widget pixels');
  const idleBudget = await small.evaluate(
    () =>
      new Promise((resolve) => {
        const c = document.querySelector('canvas.relic3d'),
          start = Number(c.dataset.frames),
          resume = Number(c.dataset.resumeCalls);
        let mutations = 0;
        const observer = new MutationObserver((rows) => {
          mutations += rows.length;
        });
        for (const id of ['demo-progress', 'demo-lock', 'demo-rings'])
          observer.observe(document.getElementById(id), {
            childList: true,
            subtree: true,
            characterData: true,
          });
        setTimeout(() => {
          observer.disconnect();
          resolve({
            frames: Number(c.dataset.frames) - start,
            mutations,
            resume: Number(c.dataset.resumeCalls) - resume,
          });
        }, 1000);
      }),
  );
  if (
    idleBudget.frames < 1 ||
    idleBudget.frames > 12 ||
    idleBudget.mutations !== 0 ||
    idleBudget.resume !== 0
  )
    throw Error('small idle cadence or unchanged DOM churn');
  await small.locator('#demo-raid').click();
  await small.waitForFunction(() => document.querySelector('canvas.relic3d')?.dataset.fps === '24');
  const arrivalFrames = await small.evaluate(
    () =>
      new Promise((resolve) => {
        const c = document.querySelector('canvas.relic3d'),
          start = Number(c.dataset.frames);
        setTimeout(() => resolve(Number(c.dataset.frames) - start), 1000);
      }),
  );
  if (arrivalFrames < 1 || arrivalFrames > 26) throw Error('small arrival cadence');
  await small.close();
  stage = 'forge-preview';
  const forge = await context.newPage();
  await forge.goto(`${JUDGES_ORIGIN}/forge`);
  await forge.bringToFront();
  await forge.locator('#description').fill('Tall violet crystal with 8 facets');
  await forge.locator('#preview').click();
  await forge.locator('#preview-3d').waitFor({ state: 'visible' });
  await forge.locator('#preview-3d').click();
  await forge.locator('#forge-3d.webgl-relic canvas').waitFor({ state: 'visible' });
  if (!(await forge.locator('#preview-3d-status').textContent()).includes('Not saved or applied'))
    throw Error('preview label');
  await forge.locator('#clear').click();
  if (await forge.locator('#forge-3d canvas').count()) throw Error('preview cleanup');
  checks.push({
    name: 'SIMULATOR explicit local Forge3D/fade/removal/corner/injected visibility pause-resume (not OS tab proof)',
    passed: true,
  });
  await forge.close();
  await page.bringToFront();
  stage = 'reduced-corner';
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 160, height: 160 });
  await page.goto(`${JUDGES_ORIGIN}/overlay/1591805230?corner=1`);
  await page.locator('#compact-status').filter({ hasText: 'Moved to @olsols2' }).waitFor();
  if (
    !(await page.evaluate(async () => {
      const view = await (await fetch('/api/overlay/1591805230')).json();
      const state = await (await fetch('/api/judges/status')).json();
      return (
        view.status === 'waiting' &&
        view.movedToLogin === 'olsols2' &&
        view.lineageRings === 1 &&
        state.holder === 'Simulated 1591806023' &&
        state.rings === 1
      );
    }))
  )
    throw Error('Completed source destination/holder/ring proof');
  await page.locator('.crystal').waitFor({ state: 'visible' });
  if (
    (await page.locator('canvas.relic3d').count()) ||
    (await page.evaluate(() => document.documentElement.scrollHeight > 160))
  )
    throw Error('reduced corner fallback');
  checks.push({
    name: 'SIMULATOR reduced-motion160px corner uses original SVG without WebGL canvas',
    passed: true,
  });
  stage = 'no-webgl';
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /^webgl/.test(type) ? null : original.call(this, type, ...args);
    };
  });
  await page.reload();
  await page.locator('#compact-status').filter({ hasText: 'Moved to @olsols2' }).waitFor();
  if (
    !(await page.evaluate(async () => {
      const view = await (await fetch('/api/overlay/1591805230')).json();
      const state = await (await fetch('/api/judges/status')).json();
      return (
        view.status === 'waiting' &&
        view.movedToLogin === 'olsols2' &&
        view.lineageRings === 1 &&
        state.holder === 'Simulated 1591806023' &&
        state.rings === 1
      );
    }))
  )
    throw Error('Completed source destination/holder/ring proof');
  await page.locator('.crystal').waitFor({ state: 'visible' });
  if (await page.locator('.webgl-relic').count()) throw Error('no-webgl fallback');
  checks.push({
    name: 'SIMULATOR unavailable WebGL retains SVG/status without blocking state',
    passed: true,
  });
  stage = 'complete';
} catch (e) {
  diagnostic = await activePage
    ?.evaluate(() => ({
      phase: document.querySelector('.archive')?.dataset.phase ?? null,
      fps: document.querySelector('canvas.relic3d')?.dataset.fps ?? null,
      sprites: Number(document.querySelector('canvas.relic3d')?.dataset.sprites ?? 0),
      lifecycle: Object.fromEntries(
        [
          'snapshotPresent',
          'disposed',
          'lost',
          'documentHidden',
          'internalMotion',
          'resumeCalls',
          'frameScheduled',
          'resumeReason',
        ].map((k) => [k, document.querySelector('canvas.relic3d')?.dataset[k] ?? null]),
      ),
      motion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      runeCount: document.querySelectorAll('.rune').length,
      runeVisible: [...document.querySelectorAll('.rune')].some((r) => {
        const b = r.getBoundingClientRect();
        return b.width > 0 && b.height > 0 && getComputedStyle(r).visibility === 'visible';
      }),
      webglClass: document.querySelector('.archive')?.classList.contains('webgl-relic') ?? false,
      canvasHidden: document.querySelector('canvas.relic3d')?.hidden ?? null,
      contextStatus: document.querySelector('canvas.relic3d')?.dataset.contextStatus ?? null,
      shaderErrors: Number(document.querySelector('canvas.relic3d')?.dataset.shaderErrors ?? 0),
      renderError: document.querySelector('canvas.relic3d')?.dataset.renderError ?? null,
      connectionState: document.body.classList.contains('disconnected')
        ? 'disconnected'
        : 'connected',
      spriteFailures: Number(document.querySelector('canvas.relic3d')?.dataset.spriteFailures ?? 0),
      canvasCount: document.querySelectorAll('canvas.relic3d').length,
      visible: document.visibilityState === 'visible',
    }))
    .catch(() => null);
  failure = ['EPERM', 'ENOENT', 'EADDRINUSE'].includes(e?.code)
    ? e.code
    : e?.name === 'TimeoutError'
      ? 'timeout'
      : 'assertion-or-browser';
} finally {
  await browser?.close().catch(() => {});
  await judges.close();
  await mkdir('artifacts', { recursive: true });
  for (const [name, bytes] of captures) await writeFile(`artifacts/${name}.png`, bytes);
  await writeFile(
    'artifacts/relic3d-browser-results.json',
    JSON.stringify(
      {
        simulator: true,
        stage,
        passed: !failure,
        failure,
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
