// Labelled local HTTPS fixture. HMAC ticks/signed lifecycle, no actual providers.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { wanderFixture } from '../test-support/wander-fixture.js';
import { HOME, OTHER } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
import { attachOverlaySockets } from '../src/overlay-sockets.js';
const origin = 'https://localhost:5191';
let browser,
  server,
  tls,
  sockets,
  stage = 'setup',
  failureCategory = null,
  passed = false,
  errors = 0,
  external = 0;
const checks = [];
try {
  const f = await wanderFixture('memory', { origin });
  await f.chat(HOME, '8501', '!mark moon');
  await f.tick();
  f.advanceHours(60);
  assert.equal(JSON.parse((await f.tick()).body).status, 'warning-queued');
  f.advanceHours(12);
  assert.equal(JSON.parse((await f.tick()).body).status, 'wandered');
  tls = await createLocalTLS();
  server = createServer(tls.options, f.runtime.handler);
  sockets = attachOverlaySockets(server, f.runtime.overlayFeeds, {
    origins: [origin],
    allowRead: f.runtime.allowPublicRead,
  });
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
  await c.routeWebSocket('**/*', (r) =>
    new URL(r.url()).origin === origin.replace('https:', 'wss:') ? r.connectToServer() : r.close(),
  );
  const p = await c.newPage();
  p.on('pageerror', () => errors++);
  stage = 'typed-overlay';
  await p.goto(origin + '/overlay/' + OTHER);
  await p.locator('#status').filter({ hasText: 'wandered here' }).waitFor();
  assert.match(await p.locator('#status').innerText(), /no raid or audience transfer/);
  assert.equal((await f.runtime.overlayFeeds[OTHER].snapshot()).handoff, null);
  assert.ok(await p.locator('#simulator').isVisible());
  await p.waitForFunction(
    () => Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 0,
  );
  assert.ok(
    await p.locator('canvas.relic3d').evaluate(
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
                pixels = new Uint8Array(canvas.width * canvas.height * 4);
              gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
              resolve(pixels.some((v, i) => i % 4 === 3 && v > 0));
            },
            { once: true },
          );
        }),
    ),
  );

  for (const width of [160, 390]) {
    await p.setViewportSize({ width, height: width === 160 ? 160 : 844 });
    if (width === 160) {
      await p.goto(origin + '/overlay/' + OTHER + '?corner=1');
      await p.locator('#compact-status').filter({ hasText: 'Wandered · no raid' }).waitFor();
    }
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  checks.push({
    name: 'SIMULATOR typed idle notice, no receipt/quorum, real renderer frames and bounded corner',
    passed: true,
  });
  stage = 'dotted-atlas';
  await p.setViewportSize({ width: 1280, height: 800 });
  await p.goto(origin + '/atlas/');
  await p.locator('.map-hop[data-kind=wander]').waitFor();
  assert.equal(
    await p.locator('.map-hop[data-kind=wander]').getAttribute('stroke-dasharray'),
    '4 8',
  );
  assert.match(await p.locator('#map-stops').innerText(), /Wandered.*no raid or audience transfer/);
  assert.match(await p.locator('#rings').innerText(), /1 Wandered \(no raid\)/);
  const d = p.waitForEvent('download');
  await p.getByRole('button', { name: 'Download ring card Stop 1', exact: true }).click();
  const download = await d;
  assert.equal(download.suggestedFilename(), 'raid-relic-wander-stop-1-olsols2.png');
  const chunks = [];
  let size = 0;
  for await (const chunk of await download.createReadStream()) {
    size += chunk.length;
    assert.ok(size <= 524288);
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  const painted = await p.evaluate(
    async (values) => {
      const image = await createImageBitmap(
        new Blob([Uint8Array.from(values)], { type: 'image/png' }),
      );
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i + 3] && Math.max(data[i], data[i + 1], data[i + 2]) > 80) n++;
      image.close();
      canvas.width = canvas.height = 0;
      return n;
    },
    [...bytes],
  );
  assert.ok(painted > 1000);
  await download.delete();
  checks.push({
    name: 'Dotted typed Atlas path, no raid audience, genuine bounded PNG decode/pixels and separate filename',
    passed: true,
  });
  stage = 'unsigned-and-erase';
  const before = await f.runtime.state.getPublicJourney();
  const denied = await p.evaluate(
    async () =>
      (
        await fetch('/internal/wander/tick', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
        })
      ).status,
  );
  assert.equal(denied, 403);
  assert.deepEqual(await f.runtime.state.getPublicJourney(), before);
  await f.chat(HOME, '8501', '!relic forgetme');
  await p.goto(origin + '/stops/' + before.stops[0].stopId);
  await p.locator('#status').filter({ hasText: 'No approved marks retained' }).waitFor();
  assert.equal(await p.locator('#marks img').count(), 0);
  assert.equal(f.calls.filter((call) => new URL(call.url).pathname === '/helix/raids').length, 0);
  assert.equal(errors, 0);
  assert.equal(external, 0);
  checks.push({
    name: 'Public tick rejected without effects, permanent origin-reference erasure and zero raid POSTs',
    passed: true,
  });
  passed = true;
  stage = 'complete';
} catch (e) {
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(e?.name)
    ? e.name
    : 'browser-or-fixture';
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
  });
  assert.ok(Buffer.byteLength(report) <= 65536);
  await writeFile('artifacts/wander-browser-results.json', report + '\n');
}
if (!passed) process.exitCode = 1;
