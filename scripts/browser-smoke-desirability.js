// Signed local kernel and synthetic Helix only; no production activity.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
const origin = 'https://localhost:5191';
let page,
  browser,
  server,
  tls,
  stage = 'setup',
  failureCategory = null,
  passed = false;
let errors = 0,
  external = 0,
  lastAPIStatus = 0,
  downloadCount = 0;
let diagnostic = {};
const checks = [];
async function png(download, name, width, height, page) {
  assert.equal(download.suggestedFilename(), name);
  let size = 0;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) {
    size += chunk.length;
    assert.ok(size <= 524288);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), width);
  assert.equal(bytes.readUInt32BE(20), height);
  const proof = await page.evaluate(
    async (input) => {
      const image = await createImageBitmap(
        new Blob([Uint8Array.from(input)], { type: 'image/png' }),
      );
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const c = canvas.getContext('2d');
      c.drawImage(image, 0, 0);
      const data = c.getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i + 3] && Math.max(data[i], data[i + 1], data[i + 2]) > 80) colored++;
      image.close();
      canvas.width = canvas.height = 0;
      return colored;
    },
    [...bytes],
  );
  assert.ok(proof > 1000);
  await download.delete();
}
try {
  const f = await pilotFixture('memory', {
    origin,
    extraBotScopes: ['user:read:moderated_channels'],
    chronicleEnv: {
      SEEKERS_ENABLED: 'true',
      MARK_AUTO_APPROVE_ENABLED: 'true',
      MARK_REVIEW_BLOCKLIST: '["spoiler"]',
    },
  });
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) f.streams.get(id).viewer_count = 1;
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  tls = await createLocalTLS();
  server = createServer(tls.options, f.runtime.handler);
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
  const c = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    serviceWorkers: 'block',
  });
  await c.route('**/*', (r) => {
    if (new URL(r.request().url()).origin !== origin) {
      external++;
      return r.abort();
    }
    return r.continue();
  });
  // The synthetic OAuth callback has issued these same signed control sessions.
  await c.addCookies(
    [HOME, OTHER].map((id) => ({
      name: f.cookies[id].split('=')[0],
      value: f.cookies[id].split('=')[1],
      url: origin,
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    })),
  );
  page = await c.newPage();
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin === origin && url.pathname.startsWith('/api/'))
      lastAPIStatus = response.status();
  });
  page.on('pageerror', () => errors++);
  page.on('download', () => downloadCount++);
  stage = 'own-seeker-control';
  await page.goto(origin + '/control/' + OTHER);
  assert.equal(errors, 0);
  await page.getByRole('button', { name: 'Join public Seeker queue', exact: true }).waitFor();
  const result = page.waitForResponse(
    (r) => new URL(r.url()).pathname === '/control/' + OTHER && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Join public Seeker queue', exact: true }).click();
  assert.equal((await result).status(), 200);
  stage = 'own-seeker-refresh';
  await page
    .locator('#keeper-summary')
    .filter({ hasText: 'Public Seeker queue: joined.' })
    .waitFor();
  const own = await f.runtime.state.getStreamStatus(OTHER);
  assert.equal(
    (
      await f.request(
        '/control/' + OTHER,
        'POST',
        { cookie: f.cookies[HOME], origin, 'content-type': 'application/json' },
        Buffer.from(JSON.stringify({ action: 'seek-off', csrf: 'wrong' })),
      )
    ).status,
    403,
  );
  assert.deepEqual(await f.runtime.state.getStreamStatus(OTHER), own);
  checks.push({
    name: 'Real private control/CSRF: own queue join, cross-room denial',
    passed: true,
  });
  stage = 'verified-binding-and-profile';
  await f.chat(HOME, '8101', '!mark moon');
  await f.chat(HOME, '8102', '!mark spoiler');
  assert.equal((await f.control(HOME, 'send:' + OTHER)).status, 200);
  f.advance();
  await f.raid(HOME, OTHER, 1);
  await f.chat(HOME, '8201', '!offer');
  await f.chat(OTHER, '8202', '!accept');
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
  stage = 'atlas-holder';
  await page.goto(origin + '/atlas/');
  assert.equal(errors, 0);
  await page
    .locator('.holder-spotlight h3')
    .filter({ hasText: '@olsols2 holds the relic' })
    .waitFor();
  stage = 'atlas-gl-frames';
  await page.locator('#atlas-relic').scrollIntoViewIfNeeded();
  await page.waitForFunction(
    () => Number(document.querySelector('#atlas-relic canvas')?.dataset.frames) > 0,
  );
  stage = 'atlas-gl-pixels';
  assert.ok(
    await page.locator('#atlas-relic canvas').evaluate(
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
              const pixels = new Uint8Array(canvas.width * canvas.height * 4);
              gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
              resolve(pixels.some((v, i) => i % 4 === 3 && v > 0));
            },
            { once: true },
          );
        }),
    ),
  );
  stage = 'atlas-widths';
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    await page.evaluate(() => document.fonts.ready);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.ok(await page.locator('#receiving').isVisible());
  }
  stage = 'keeper-profile';
  await page.goto(origin + '/keeper/olsols2');
  assert.equal(errors, 0);
  await page
    .getByRole('button', { name: 'Download landscape card · Ring 1', exact: true })
    .waitFor();
  assert.match(
    await page.locator('#receiving-content').innerText(),
    /Twitch-reported raid audience: 1/,
  );
  assert.doesNotMatch(await page.locator('#receiving-content').innerText(), /spoiler|8101/);
  assert.equal(await page.locator('.keeper-glyphs img').count(), 1);
  for (const [orientation, w, h] of [
    ['landscape', 1200, 675],
    ['vertical', 720, 1280],
  ]) {
    stage = orientation === 'landscape' ? 'card-landscape' : 'card-vertical';
    const downloaded = page.waitForEvent('download');
    await page
      .getByRole('button', { name: `Download ${orientation} card · Ring 1`, exact: true })
      .click();
    await png(await downloaded, `raid-relic-keeper-olsols2-ring-1-${orientation}.png`, w, h, page);
  }
  checks.push({
    name: 'Registry spotlight, seven-safe public fields and actual decoded 16:9/9:16 PNG exports',
    passed: true,
  });
  stage = 'stale-live-unknown';
  f.streams.get(OTHER).viewer_count = 'invalid';
  f.advance(60001);
  await page.locator('#receiving-refresh').click();
  await page.locator('.holder-spotlight').filter({ hasText: 'Live status unknown' }).waitFor();
  stage = 'erase-and-unavailable';
  await f.chat(HOME, '8101', '!relic forgetme');
  await page.locator('#receiving-refresh').click();
  stage = 'erasure-glyphs';
  await page.waitForFunction(
    () => document.querySelector('.keeper-glyphs')?.childElementCount === 0,
  );
  await page.route('**/api/atlas/stops/*', (r) => r.fulfill({ status: 404, body: 'Unavailable' }));
  let downloads = 0;
  page.on('download', () => downloads++);
  await page.getByRole('button', { name: 'Download vertical card · Ring 1', exact: true }).click();
  stage = 'removed-stop-card';
  await page.locator('#receiving-status').filter({ hasText: 'Card unavailable' }).waitFor();
  assert.equal(downloads, 0);
  assert.equal((await page.goto(origin + '/keeper/unknown')).status(), 404);
  assert.equal(errors, 0);
  assert.equal(external, 0);
  checks.push({
    name: 'Erasure refresh, fresh exact-stop refusal and unknown Keeper rejection',
    passed: true,
  });
  passed = true;
  stage = 'complete';
} catch (e) {
  diagnostic = { errors, lastAPIStatus, downloadCount };
  const line =
    typeof e?.stack === 'string'
      ? e.stack.slice(0, 8192).match(/browser-smoke-desirability[.]js:(\d{1,6})(?::\d+)?/)
      : null;
  if (line && Number(line[1]) > 0 && Number(line[1]) <= 100000)
    diagnostic.sourceAssertionLine = Number(line[1]);
  if (page && !page.isClosed()) {
    try {
      const values = await page.evaluate(() => ({
        holderCount: document.querySelectorAll('.holder-spotlight').length,
        receivingCount: document.querySelectorAll('#receiving').length,
        canvasCount: document.querySelectorAll('#atlas-relic canvas').length,
        frames: Number(document.querySelector('#atlas-relic canvas')?.dataset.frames || 0),
        cardUnavailable: Boolean(
          document.querySelector('#receiving-status')?.textContent.startsWith('Card unavailable'),
        ),
      }));
      for (const [key, value] of Object.entries(values))
        if (
          typeof value === 'boolean' ||
          (Number.isFinite(value) && value >= 0 && value <= 1000000000)
        )
          diagnostic[key] = value;
    } catch {
      /* Preserve the original failure without publishing messages. */
    }
  }
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(e?.name)
    ? e.name
    : 'browser-or-fixture';
} finally {
  await browser?.close().catch(() => {});
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
    diagnostic,
    external,
  });
  assert.ok(Buffer.byteLength(report) <= 65536);
  await writeFile('artifacts/desirability-browser-results.json', report + '\n');
}
if (!passed) process.exitCode = 1;
