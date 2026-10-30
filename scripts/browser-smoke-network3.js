// Local signed fixture only. This does not prove real consent, moderation or broadcasting.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { createLocalTLS } from '../test-support/local-tls.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
import {
  network3Fixture,
  readyNetwork3,
  networkHop,
  NETWORK3,
  HOME,
  OTHER,
  THIRD,
} from '../test-support/network3-fixture.js';
const origin = 'https://localhost:5191';
let browser, server, tls, sockets, page;
let stage = 'setup',
  passed = false,
  failureCategory = null,
  errors = 0,
  external = 0;
const checks = [];
const diagnostic = {};
try {
  const f = await network3Fixture('memory', { origin });
  await readyNetwork3(f);
  assert.equal(f.subscriptions.length, 15);
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
    headless: true,
    chromiumSandbox: true,
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 844 },
    acceptDownloads: true,
    serviceWorkers: 'block',
  });
  await context.route('**/*', (r) => {
    if (new URL(r.request().url()).origin !== origin) {
      external++;
      return r.abort();
    }
    return r.continue();
  });
  page = await context.newPage();
  page.on('pageerror', () => errors++);
  stage = 'three-controls';
  for (const id of [HOME, OTHER, THIRD]) {
    const [name, value] = f.cookies[id].split('=');
    await context.addCookies([
      { name, value, url: origin, secure: true, httpOnly: true, sameSite: 'Lax' },
    ]);
    await page.goto(origin + '/control/' + id);
    await page.locator('#account').filter({ hasText: NETWORK3[id] }).waitFor();
    await page.locator('#control-advanced > summary').click();
    await page.getByRole('button', { name: 'Become a Seeker', exact: true }).waitFor();
    assert.equal(errors, 0);
  }
  const before = await f.runtime.state.getStreamStatus(OTHER);
  const status = await f.request('/control/' + THIRD + '/status', 'GET', {
    cookie: f.cookies[THIRD],
  });
  assert.equal(status.status, 200);
  assert.equal(
    (
      await f.request(
        '/control/' + OTHER,
        'POST',
        { cookie: f.cookies[THIRD], origin, 'content-type': 'application/json' },
        Buffer.from(JSON.stringify({ action: 'seek-on', csrf: JSON.parse(status.body).csrf })),
      )
    ).status,
    403,
  );
  assert.deepEqual(await f.runtime.state.getStreamStatus(OTHER), before);
  checks.push({
    name: 'Three configured controls and genuine own-session/CSRF isolation',
    passed: true,
  });
  stage = 'signed-three-way';
  await f.chat(HOME, '99001', '!mark moon');
  stage = 'hop-home-other';
  await networkHop(f, HOME, OTHER);
  stage = 'hop-other-third';
  await networkHop(f, OTHER, THIRD);
  stage = 'third-overlay-gl';
  await page.goto(origin + '/overlay/' + THIRD);
  await page.waitForFunction(() => Number(document.querySelector('canvas')?.dataset.frames) > 0);
  const canvas = page.locator('canvas').first();
  assert.ok(
    await canvas.evaluate(
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
                p = new Uint8Array(c.width * c.height * 4);
              gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, p);
              resolve(p.some((v, i) => i % 4 === 3 && v > 0));
            },
            { once: true },
          );
        }),
    ),
  );
  assert.equal((await f.runtime.overlayFeeds[THIRD].snapshot()).holderLogin, 'olsols3');
  stage = 'hop-third-home';
  await networkHop(f, THIRD, HOME);
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 3);
  checks.push({
    name: 'Signed A to B to C to A, early source quorum, distinct users and actual third GL pixels',
    passed: true,
  });
  stage = 'keeper-profile-links';
  await page.goto(origin + '/atlas/');
  for (const login of Object.values(NETWORK3))
    await page.locator(`#keeper-rows a[href="/keeper/${login}"]`).waitFor();
  await page.locator('#keeper-rows a[href="/keeper/olsols3"]').click();
  await page.locator('#keeper-title').filter({ hasText: '@olsols3 · received rings' }).waitFor();
  stage = 'third-profile-card';
  await page
    .getByRole('button', { name: 'Download landscape card · Ring 2', exact: true })
    .waitFor();
  for (const width of [320, 390, 1280]) {
    diagnostic.width = width;
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await page.locator('#keeper-title').innerText(), '@olsols3 · received rings');
  }
  stage = 'third-card-download';
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download landscape card · Ring 2', exact: true }).click();
  const file = await download;
  assert.equal(file.suggestedFilename(), 'raid-relic-keeper-olsols3-ring-2-landscape.png');
  let size = 0;
  const chunks = [];
  for await (const chunk of await file.createReadStream()) {
    size += chunk.length;
    assert.ok(size <= 524288);
    chunks.push(chunk);
  }
  stage = 'third-card-png';
  const bytes = Buffer.concat(chunks);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 675);
  assert.ok(
    await page.evaluate(
      async (input) => {
        const bitmap = await createImageBitmap(
          new Blob([Uint8Array.from(input)], { type: 'image/png' }),
        );
        const c = document.createElement('canvas');
        c.width = bitmap.width;
        c.height = bitmap.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);
        const data = ctx.getImageData(0, 0, c.width, c.height).data;
        let colored = 0;
        for (let i = 0; i < data.length; i += 4)
          if (data[i + 3] && Math.max(data[i], data[i + 1], data[i + 2]) > 80) colored++;
        bitmap.close();
        c.width = c.height = 0;
        return colored > 1000;
      },
      [...bytes],
    ),
  );
  stage = 'third-profile-erasure';
  await file.delete();
  await f.chat(HOME, '99001', '!relic forgetme');
  assert.doesNotMatch(JSON.stringify(await f.runtime.state.getPublicJourney()), /moon/);
  assert.equal((await f.request('/keeper/unknown')).status, 404);
  stage = 'reduced-release';
  await page.goto(origin + '/overlay/' + THIRD);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Overlay fallback remains decoded; its own lifecycle gate handles reduced motion.
  const image = page.locator('.archive .crystal');
  stage = 'reduced-svg-visible';
  await image.waitFor({ state: 'visible' });
  stage = 'reduced-svg-decode';
  assert.ok(
    await image.evaluate(async (img) => {
      await img.decode();
      return img.complete && img.naturalWidth > 0;
    }),
  );
  assert.equal(errors, 0);
  assert.equal(external, 0);
  checks.push({
    name: 'Third profile names, responsive bounds, real PNG, erasure, unknown rejection and decoded reduced fallback',
    passed: true,
  });
  passed = true;
  stage = 'complete';
} catch (e) {
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(e?.name)
    ? e.name
    : 'browser-or-fixture';
  for (const key of [
    'httpStatus',
    'responseStatusCode',
    'reasonCode',
    'providerCode',
    'hopIndex',
  ]) {
    const value = e?.networkDiagnostic?.[key];
    if (Number.isSafeInteger(value) && value >= 0 && value <= 599) diagnostic[key] = value;
  }
  const line = /browser-smoke-network3[.]js:(\d+)/.exec(e?.stack ?? '');
  if (line) diagnostic.assertionLine = Number(line[1]);
} finally {
  await browser?.close().catch(() => {});
  sockets?.close();
  if (server)
    await new Promise((r) => {
      server.closeAllConnections();
      server.close(r);
    });
  await tls?.cleanup();
  await mkdir('artifacts', { recursive: true });
  const report = JSON.stringify({
    passed,
    stage,
    failureCategory,
    checks,
    browserErrors: errors,
    external,
    diagnostic,
  });
  assert.ok(Buffer.byteLength(report) <= 65536);
  await writeFile('artifacts/network3-browser-results.json', report + '\n');
}
if (!passed) process.exitCode = 1;
