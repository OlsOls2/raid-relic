// Native fictional presentation; never a live Twitch/OBS observation.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReview, noDemoIO, growthPixels } from '../test-support/visual-review.js';
import { filmResourceReason } from '../test-support/film-resources.js';
let review,
  stage = 'setup',
  passed = false,
  failureCategory = null,
  downloads = 0,
  requestOverflow = false;
const checks = [],
  diagnostic = {},
  captures = new Map(),
  requests = [];
async function closedIO(page, origin) {
  assert.equal(requestOverflow, false);
  const owned = await page.evaluate(() => ({
    preview: document.querySelector('#film-card').src,
    ownedPNGs: window.__judgeOwnedPNGs,
  }));
  for (const request of requests)
    assert.ok(
      ['static', 'owned-preview'].includes(filmResourceReason(request, { origin, ...owned })),
    );
  assert.ok(Object.values(await page.evaluate(() => window.__demoIO)).every((n) => n === 0));
  requests.length = 0;
}
try {
  review = await visualReview();
  const { page, context, origin, fixture } = review;
  await noDemoIO(context);
  await context.addInitScript(() => {
    window.__judgeOwnedPNGs = [];
    window.__judgeCardText = { watermark: false, engraving: false, journey: false };
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      if (
        blob instanceof Blob &&
        blob.type === 'image/png' &&
        blob.size > 0 &&
        blob.size <= 524288 &&
        window.__judgeOwnedPNGs.length < 4
      )
        window.__judgeOwnedPNGs.push({ url, type: blob.type, size: blob.size });
      return url;
    };
    const draw = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (typeof text === 'string') {
        if (text.includes('FILM / SIMULATOR')) window.__judgeCardText.watermark = true;
        if (text === 'Approved sample engraving: moon') window.__judgeCardText.engraving = true;
        if (text.startsWith('1 retained fictional hop')) window.__judgeCardText.journey = true;
      }
      return draw.call(this, text, ...args);
    };
  });
  page.on('request', (r) => {
    if (requests.length >= 64) {
      requestOverflow = true;
      return;
    }
    requests.push({ url: r.url(), method: r.method(), resourceType: r.resourceType() });
  });
  page.on('download', () => downloads++);
  await page.clock.install({ time: new Date('2026-10-31T12:00:00Z') });
  await page.setViewportSize({ width: 1280, height: 720 });
  stage = 'judge-start';
  await page.goto(origin + '/demo/judge');
  assert.match(await page.locator('#film-banner').innerText(), /JUDGE.*SIMULATOR.*no Twitch/);
  assert.equal(await page.locator('body').getAttribute('data-presentation-duration'), '45000');
  assert.equal(await page.locator('#film-heading').innerText(), 'Send Off');
  const visited = new Set(['Send Off']);
  let spent = 0;
  for (const target of [6000, 12500, 17000, 19000, 25000, 31000, 37000, 42000, 45500]) {
    await page.clock.runFor(target - spent);
    spent = target;
    visited.add(await page.locator('#film-heading').innerText());
    assert.match(await page.locator('#film-banner').innerText(), /SIMULATOR.*no Twitch/);
    if (target === 6000) {
      assert.equal(await growthPixels(page, () => page.clock.runFor(100)), true);
    }
    if (target === 12500) {
      assert.match(await page.locator('#film-claim').innerText(), /Provisional/);
      assert.match(await page.locator('#film-count').innerText(), /rings: 0/);
    }
    if (target === 17000) assert.match(await page.locator('#film-count').innerText(), /rings: 1/);
    if (target === 19000) assert.equal(await page.locator('#film-engraving').isVisible(), true);
    if (target === 25000)
      assert.match(await page.locator('#film-spotlight').innerText(), /SIMULATED LIVE/);
    if (target === 37000) assert.equal(await page.locator('#film-journey').isVisible(), true);
  }
  assert.equal(visited.size, 8);
  assert.equal(await page.locator('body').getAttribute('data-film-playing'), 'false');
  assert.match(await page.locator('#film-time').innerText(), /0:45 \/ 0:45/);
  diagnostic.presentationDurationMs = 45000;
  diagnostic.testUsesControlledClock = true;
  checks.push({
    name: 'Exact45-second presentation traverses all8 fictional scenes, actual GL pixels, provisional claim then one ring and replay',
    passed: true,
  });
  stage = 'manual-export';
  await page.waitForFunction(() => !document.querySelector('#film-export').disabled);
  assert.equal(downloads, 0);
  assert.deepEqual(await page.evaluate(() => window.__judgeCardText), {
    watermark: true,
    engraving: true,
    journey: true,
  });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#film-export').click(),
  ]);
  const chunks = [];
  let total = 0;
  for await (const b of await download.createReadStream()) {
    total += b.length;
    assert.ok(total <= 524288);
    chunks.push(b);
  }
  const png = Buffer.concat(chunks);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  assert.ok(
    await page.locator('#film-card').evaluate(async (img) => {
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 630;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const pixels = x.getImageData(0, 0, 1200, 630).data;
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i + 3] && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 80) colored++;
      c.width = c.height = 0;
      return colored > 1000;
    }),
  );
  await download.delete();
  assert.equal(downloads, 1);
  await closedIO(page, origin);
  assert.equal(fixture.calls.length, 0);
  checks.push({
    name: 'Manual-only bounded decoded PNG with original art, simulated watermark, engraving and retained fictional route; zero application IO',
    passed: true,
  });
  if (process.env.README_CAPTURE === '1') {
    stage = 'readme-film-captures';
    await page.goto(origin + '/demo/film');
    assert.equal(await page.locator('body').getAttribute('data-presentation-duration'), '150000');
    await page.locator('#film-play').click();
    for (const [ms, name] of [
      [80000, 'readme-film-story'],
      [135000, 'readme-film-card'],
    ]) {
      await page.locator('#film-seek').evaluate((el, value) => {
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, ms);
      if (ms === 135000)
        await page.waitForFunction(() => !document.querySelector('#film-export').disabled);
      await page.evaluate(() => {
        scrollTo(0, 0);
      });
      await page.evaluate(() => document.fonts.ready);
      assert.ok(1280 * 720 * 4 < 4 * 1024 * 1024);
      const bytes = await page.screenshot({ fullPage: false });
      assert.ok(bytes.length <= 524288);
      assert.ok(captures.size < 2);
      assert.equal(bytes.readUInt32BE(16), 1280);
      assert.equal(bytes.readUInt32BE(20), 720);
      assert.ok(
        [...captures.values()].reduce((n, b) => n + b.length, bytes.length) <= 4 * 1024 * 1024,
      );
      captures.set(name, bytes);
    }
    await closedIO(page, origin);
  }
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  passed = true;
} catch (e) {
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(e?.name)
    ? e.name
    : 'browser-or-fixture';
  const line = /browser-smoke-judge[.]js:(\d+)/.exec(e?.stack ?? '');
  if (line) diagnostic.assertionLine = Number(line[1]);
} finally {
  await review?.close();
  await mkdir('artifacts', { recursive: true });
  for (const [name, bytes] of captures) await writeFile(`artifacts/${name}.png`, bytes);
  await writeFile(
    'artifacts/judge-browser-results.json',
    JSON.stringify({ passed, stage, failureCategory, checks, diagnostic }) + '\n',
  );
}
if (!passed) process.exitCode = 1;
