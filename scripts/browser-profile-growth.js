// Parent-run local diagnostic: two natural 35s tours, never a 900s soak proof.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { visualReview, noDemoIO } from '../test-support/visual-review.js';
let review, browserCDP, deadline;
let stage = 'setup',
  passed = false,
  failureCategory = null;
let external = 0,
  apiRequests = 0,
  failedRequests = 0;
const checks = [],
  samples = [];
const diagnostic = { actualWallClock: true, tours: 0, observedMs: 0 };
const started = performance.now();
async function cpu() {
  let timer;
  let processInfo;
  try {
    ({ processInfo } = await Promise.race([
      browserCDP.send('SystemInfo.getProcessInfo'),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error('Process metrics unavailable')), 8000);
      }),
    ]));
  } finally {
    clearTimeout(timer);
  }
  const result = { gpuCpu: 0, rendererCpu: 0, browserCpu: 0 };
  for (const row of processInfo) {
    const key = { GPU: 'gpuCpu', renderer: 'rendererCpu', browser: 'browserCpu' }[row.type];
    if (key) {
      assert.ok(Number.isFinite(row.cpuTime) && row.cpuTime >= 0 && row.cpuTime < 1e9);
      result[key] += row.cpuTime;
    }
  }
  return result;
}
try {
  review = await visualReview();
  const { page, context, origin, fixture } = review;
  deadline = setTimeout(() => {
    void context.close().catch(() => {});
  }, 100000);
  await noDemoIO(context);
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      external++;
      return route.abort();
    }
    if (/^\/(?:api|oauth|auth|internal|ws)(?:\/|$)/.test(url.pathname)) {
      apiRequests++;
      return route.abort();
    }
    return route.continue();
  });
  page.on('requestfailed', () => failedRequests++);
  browserCDP = await context.browser().newBrowserCDPSession();
  await page.goto(origin + '/demo/');
  await page.bringToFront();
  await page.evaluate(() => document.fonts.ready);
  const baseline = await cpu();
  for (let tour = 1; tour <= 2; tour++) {
    stage = 'tour-start';
    await page.locator('#demo-tour').click();
    for (const target of [1000, 11000, 20000, 35000]) {
      stage = target === 35000 ? 'tour-completion' : 'tour-sample';
      await page.waitForFunction((ms) => Number(document.body.dataset.demoClock) >= ms, target, {
        timeout: 45000,
      });
      await page.waitForFunction(
        () => Number(document.querySelector('#demo-art canvas')?.dataset.frames) > 0,
      );
      await page
        .locator('#demo-art canvas')
        .evaluate((c) => c.setAttribute('data-render-profile', ''));
      // A genuine subsequent scene render populates actual Three counters.
      // At completion the frozen frame already has counters from earlier samples.
      await page.waitForFunction(
        () => Number(document.querySelector('#demo-art canvas')?.dataset.drawCalls) > 0,
      );
      const sample = await page.evaluate(() => {
        const c = document.querySelector('#demo-art canvas'),
          gl = c.getContext('webgl2');
        const n = (key) => Number(c.dataset[key] ?? 0);
        return {
          clockMs: Number(document.body.dataset.demoClock),
          phase:
            ['idle', 'streak', 'impact', 'unfurl', 'settled'].indexOf(
              document.querySelector('#demo-art').dataset.phase,
            ) + 1,
          frames: n('frames'),
          calls: n('drawCalls'),
          triangles: n('triangles'),
          textures: n('textureCount'),
          geometries: n('geometryCount'),
          growth: n('growthTotal'),
          width: c.width,
          height: c.height,
          fps: n('fps'),
          msaa: Boolean(gl.getContextAttributes().antialias),
          canvases: document.querySelectorAll('canvas.relic3d').length,
        };
      });
      const currentCpu = await cpu();
      for (const key of Object.keys(baseline)) sample[key] = currentCpu[key] - baseline[key];
      sample.tour = tour;
      sample.atMs = Math.round(performance.now() - started);
      assert.ok(
        Object.values(sample).every(
          (v) => typeof v === 'boolean' || (Number.isFinite(v) && Math.abs(v) < 1e9),
        ),
      );
      assert.equal(sample.canvases, 1);
      assert.ok(sample.width > sample.height && sample.height <= 160 && !sample.msaa);
      assert.ok(sample.calls > 0 && sample.triangles > 0 && sample.triangles < 20000);
      samples.push(sample);
    }
    assert.equal(await page.locator('#demo-tour').textContent(), 'Replay tour');
    assert.equal(await page.locator('#demo-rings').textContent(), 'Rings: 1');
    diagnostic.tours = tour;
    checks.push({ name: 'Natural 35-second tour ' + tour, passed: true });
    await page.locator('#demo-reset').click();
    assert.equal(await page.locator('#demo-rings').textContent(), 'Rings: 0');
  }
  assert.ok(Object.values(await page.evaluate(() => window.__demoIO)).every((n) => n === 0));
  assert.equal(fixture.calls.length, 0);
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  assert.equal(external + apiRequests + failedRequests, 0);
  passed = true;
  stage = 'complete';
} catch (error) {
  failureCategory = [
    'AssertionError',
    'TimeoutError',
    'TypeError',
    'ProtocolError',
    'TargetClosedError',
  ].includes(error?.name)
    ? error.name
    : 'browser-or-fixture';
} finally {
  clearTimeout(deadline);
  diagnostic.observedMs = Math.round(performance.now() - started);
  Object.assign(diagnostic, {
    external,
    apiRequests,
    failedRequests,
    browserErrors: review?.stats().errors ?? 0,
  });
  await browserCDP?.detach().catch(() => {});
  await review?.close();
  const output = JSON.stringify({ passed, stage, failureCategory, checks, diagnostic, samples });
  if (Buffer.byteLength(output) > 16384) throw Error('Profile report exceeds bound');
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/growth-profile-browser-results.json', output);
}
if (!passed) process.exitCode = 1;
