// Native local fixture only; never an actual film of Twitch or OBS.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReview, noDemoIO, growthPixels } from '../test-support/visual-review.js';
import { capturePage } from '../test-support/capture-page.js';
import { filmResourceReason, FILM_RESOURCE_REASONS } from '../test-support/film-resources.js';
let review,
  stage = 'setup',
  passed = false,
  failureCategory = null,
  forbidden = 0,
  downloads = 0;
const checks = [],
  diagnostic = {},
  captures = new Map(),
  captureCoverage = [],
  requests = [];
try {
  review = await visualReview();
  const { page, context, origin, fixture } = review;
  await noDemoIO(context);
  await context.addInitScript(() => {
    window.__filmOwnedPNGs = [];
    const createURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (blob) {
      const url = createURL(blob);
      if (
        blob instanceof Blob &&
        blob.type === 'image/png' &&
        blob.size > 0 &&
        blob.size <= 524288 &&
        window.__filmOwnedPNGs.length < 4
      )
        window.__filmOwnedPNGs.push({ url, type: blob.type, size: blob.size });
      return url;
    };
    window.__filmCardText = { watermark: false, engraving: false, journey: false };
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (typeof text === 'string') {
        if (text.includes('FILM / SIMULATOR')) window.__filmCardText.watermark = true;
        if (text === 'Approved sample engraving: moon') window.__filmCardText.engraving = true;
        if (text.startsWith('1 retained fictional hop')) window.__filmCardText.journey = true;
      }
      return original.call(this, text, ...args);
    };
  });
  page.on('request', (r) => {
    if (requests.length >= 64) {
      forbidden++;
      return;
    }
    requests.push({ url: r.url(), method: r.method(), resourceType: r.resourceType() });
  });
  page.on('download', () => downloads++);
  await page.clock.install({ time: new Date('2026-10-31T12:00:00Z') });
  await page.setViewportSize({ width: 1920, height: 1080 });
  stage = 'film-start';
  await page.goto(origin + '/demo/film');
  assert.match(await page.locator('#film-banner').innerText(), /SIMULATOR.*no Twitch/);
  await page.clock.runFor(1200);
  await page.waitForFunction(
    () => Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 0,
  );
  assert.equal(await growthPixels(page, () => page.clock.runFor(300)), true);
  await page.getByRole('button', { name: 'Pause film', exact: true }).click();
  const paused = await page.locator('body').getAttribute('data-film-clock');
  await page.clock.runFor(2000);
  assert.equal(await page.locator('body').getAttribute('data-film-clock'), paused);
  const seek = async (ms) =>
    page.locator('#film-seek').evaluate((el, n) => {
      el.value = String(n);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, ms);
  stage = 'film-scenes';
  await seek(40000);
  assert.match(await page.locator('#film-claim').innerText(), /Provisional/);
  assert.match(await page.locator('#film-count').innerText(), /rings: 0/);
  await seek(55000);
  assert.match(await page.locator('#film-count').innerText(), /rings: 1/);
  await seek(80000);
  assert.equal(await page.locator('#film-spotlight').isVisible(), true);
  assert.match(await page.locator('#film-spotlight').innerText(), /SIMULATED LIVE/);
  await seek(120000);
  assert.equal(await page.locator('#film-journey').isVisible(), true);
  assert.match(await page.locator('#film-count').innerText(), /rings: 1/);
  await seek(0);
  await page.locator('#film-seek').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#film-heading').innerText(), 'Send Off');
  await page.locator('#main-content').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#film-heading').innerText(), 'Arrival');
  await page.keyboard.press('Space');
  assert.equal(await page.locator('body').getAttribute('data-film-playing'), 'true');
  await page.clock.runFor(3350);
  assert.equal(await growthPixels(page, () => page.clock.runFor(300)), true);
  await page.getByRole('button', { name: 'Pause film', exact: true }).click();
  checks.push({
    name: 'Eight local scenes, actual GL pixels, provisional claim then one ring, replay and native keyboard controls',
    passed: true,
  });
  stage = 'film-layout';
  await seek(80000);
  for (const [width, height] of [
    [1920, 1200],
    [1920, 1080],
    [390, 844],
    [320, 844],
  ]) {
    await page.setViewportSize({ width, height });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    const box = await page.locator('#film-art').boundingBox();
    assert.ok(box.width > 0 && box.height > 0);
  }
  await page.setViewportSize({ width: 1920, height: 1080 });
  if (process.env.FILM_CAPTURE === '1') {
    stage = 'film-capture';
    await capturePage(page, 'film-story', captures, captureCoverage);
  }
  stage = 'film-card';
  await seek(135000);
  await page.waitForFunction(() => !document.querySelector('#film-export').disabled);
  assert.equal(downloads, 0);
  assert.deepEqual(await page.evaluate(() => window.__filmCardText), {
    watermark: true,
    engraving: true,
    journey: true,
  });
  assert.ok(
    await page.locator('#film-card').evaluate(async (img) => {
      await img.decode();
      return img.naturalWidth === 1200 && img.naturalHeight === 630;
    }),
  );
  const pending = page.waitForEvent('download');
  await page.locator('#film-export').click();
  const download = await pending;
  assert.equal(download.suggestedFilename(), 'raid-relic-demo-ring-1.png');
  const chunks = [];
  let total = 0;
  for await (const b of await download.createReadStream()) {
    total += b.length;
    assert.ok(total <= 524288);
    chunks.push(b);
  }
  const bytes = Buffer.concat(chunks);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  assert.ok(
    await page.evaluate(
      async (raw) => {
        const img = await createImageBitmap(
          new Blob([Uint8Array.from(raw)], { type: 'image/png' }),
        );
        const c = document.createElement('canvas');
        c.width = 1200;
        c.height = 630;
        const x = c.getContext('2d');
        x.drawImage(img, 0, 0);
        const p = x.getImageData(0, 0, 1200, 630).data;
        let n = 0;
        for (let i = 0; i < p.length; i += 4)
          if (p[i + 3] && Math.max(p[i], p[i + 1], p[i + 2]) > 80) n++;
        img.close();
        c.width = c.height = 0;
        return n > 1000;
      },
      [...bytes],
    ),
  );
  await download.delete();
  assert.equal(downloads, 1);
  if (process.env.FILM_CAPTURE === '1')
    await capturePage(page, 'film-card', captures, captureCoverage);
  checks.push({
    name: '1920×1200/1080 and mobile fit; preview never auto-downloads; manual genuine simulated PNG',
    passed: true,
  });
  stage = 'film-reduced';
  await seek(60000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.runFor(500);
  await page.waitForFunction(() => document.querySelectorAll('#film-art canvas').length === 0);
  const image = page.locator('#film-art > img');
  assert.equal(await image.isVisible(), true);
  assert.ok(
    await image.evaluate(async (i) => {
      await i.decode();
      return i.naturalWidth > 0;
    }),
  );
  assert.equal(await page.locator('#film-art .growth-fallback').getAttribute('data-total'), '1');
  await page.locator('#film-restart').click();
  assert.match(await page.locator('#film-count').innerText(), /rings: 0/);
  assert.ok(Object.values(await page.evaluate(() => window.__demoIO)).every((n) => n === 0));
  const owned = await page.evaluate(() => ({
    preview: document.querySelector('#film-card').src,
    ownedPNGs: window.__filmOwnedPNGs,
  }));
  for (const request of requests) {
    const reason = filmResourceReason(request, { origin, ...owned });
    if (reason === 'owned-preview')
      diagnostic.ownedPreviewRequests = (diagnostic.ownedPreviewRequests ?? 0) + 1;
    if (!['static', 'owned-preview'].includes(reason)) {
      forbidden++;
      if (diagnostic.resourceReasonCode === undefined) {
        diagnostic.resourceReasonCode = FILM_RESOURCE_REASONS.indexOf(reason);
        try {
          diagnostic.resourcePathCode =
            ['/favicon.ico', '/edition-crystal/season-one-autumn-2026.svg'].indexOf(
              new URL(request.url).pathname,
            ) + 1;
        } catch {
          diagnostic.resourcePathCode = 0;
        }
        diagnostic.resourceMethodCode =
          request.method === 'GET' ? 1 : request.method === 'POST' ? 2 : 3;
        const protocol = (() => {
          try {
            return new URL(request.url).protocol;
          } catch {
            return '';
          }
        })();
        diagnostic.resourceProtocolCode = ['https:', 'blob:', 'data:'].indexOf(protocol) + 1;
      }
    }
  }
  diagnostic.requestCount = requests.length;
  assert.equal(forbidden, 0);
  assert.equal(fixture.calls.length, 0);
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  checks.push({
    name: 'Permanent reduced-motion GPU release, original decoded SVG, restart and zero API/storage/provider IO',
    passed: true,
  });
  for (const b of captures.values()) assert.ok(b.length <= 524288);
  assert.ok([...captures.values()].reduce((n, b) => n + b.length, 0) <= 4 * 1024 * 1024);
  assert.ok(captures.size <= 6);
  passed = true;
} catch (e) {
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(e?.name)
    ? e.name
    : 'browser-or-fixture';
  const line = /browser-smoke-film[.]js:(\d+)/.exec(e?.stack ?? '');
  if (line) diagnostic.assertionLine = Number(line[1]);
  diagnostic.browserErrors = review?.stats().errors ?? 0;
} finally {
  await review?.close();
  await mkdir('artifacts', { recursive: true });
  for (const [name, bytes] of captures) await writeFile('artifacts/' + name + '.png', bytes);
  const report = JSON.stringify({
    passed,
    stage,
    failureCategory,
    checks,
    diagnostic,
    forbidden,
    captureCoverage,
  });
  assert.ok(Buffer.byteLength(report) <= 65536);
  await writeFile('artifacts/film-browser-results.json', report + '\n');
}
if (!passed) process.exitCode = 1;
