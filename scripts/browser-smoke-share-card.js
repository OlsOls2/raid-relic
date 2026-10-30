// Parent native QA only: signed local kernel, actual canvas PNGs, no provider access.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReview } from '../test-support/visual-review.js';
import { HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
let review,
  stage = 'setup',
  passed = false,
  failureCategory = null;
const checks = [],
  captures = new Map(),
  diagnostic = {};
async function decode(page, download, width, height, capture) {
  const chunks = [];
  let size = 0;
  for await (const b of await download.createReadStream()) {
    size += b.length;
    assert.ok(size <= 524288);
    chunks.push(b);
  }
  const bytes = Buffer.concat(chunks);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), width);
  assert.equal(bytes.readUInt32BE(20), height);
  assert.ok(width * height * 4 <= 4 * 1024 * 1024);
  const pixels = await page.evaluate(
    async (raw) => {
      const image = await createImageBitmap(
        new Blob([Uint8Array.from(raw)], { type: 'image/png' }),
      );
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const c = canvas.getContext('2d');
      c.drawImage(image, 0, 0);
      const rgba = c.getImageData(0, 0, image.width, image.height).data;
      let colored = 0;
      for (let i = 0; i < rgba.length; i += 4)
        if (rgba[i + 3] && Math.max(rgba[i], rgba[i + 1], rgba[i + 2]) > 80) colored++;
      image.close();
      canvas.width = canvas.height = 0;
      return colored;
    },
    [...bytes],
  );
  assert.ok(pixels > 1000);
  if (process.env.SHARE_CARD_CAPTURE === '1' && capture) captures.set(capture, bytes);
  await download.delete();
}
try {
  review = await visualReview();
  const { fixture: f, page, context, origin } = review;
  await context.addInitScript(() => {
    // This workflow explicitly covers the format-menu fallback, not OS sharing.
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    window.__shareLabels = { recorded: false, current: false, engraving: false, journey: false };
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      const flags = window.__shareLabels;
      if (text === 'Keeper at this stop: @olsols2') flags.recorded = true;
      if (text === 'Current holder at export: @raidrelichq') flags.current = true;
      if (text === 'moon') flags.engraving = true;
      if (typeof text === 'string' && text.startsWith('Retained journey')) flags.journey = true;
      return original.call(this, text, ...args);
    };
  });
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) f.streams.get(id).viewer_count = 1;
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  await f.chat(HOME, '8101', '!mark moon');
  await f.chat(HOME, HOME, '!relic approve m1');
  for (const [from, to, i] of [
    [HOME, OTHER, 1],
    [OTHER, HOME, 2],
  ]) {
    f.advance(31000);
    assert.equal(JSON.parse((await f.control(from, 'send:' + to)).body).status, 'accepted');
    await f.raid(from, to);
    await f.chat(from, '820' + i, '!offer');
    await f.chat(to, '830' + i, '!accept');
  }
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 2);
  stage = 'atlas-historical-stop';
  await page.goto(origin + '/atlas/');
  let pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download ring card Stop 1', exact: true }).click();
  let download = await pending;
  assert.equal(download.suggestedFilename(), 'raid-relic-stop-1-olsols2.png');
  await decode(page, download, 1200, 630, 'share-atlas.png');
  assert.deepEqual(await page.evaluate(() => window.__shareLabels), {
    recorded: true,
    current: true,
    engraving: true,
    journey: true,
  });
  f.advance(31000);
  pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download ring card Stop 2', exact: true }).click();
  download = await pending;
  assert.equal(download.suggestedFilename(), 'raid-relic-stop-2-raidrelichq.png');
  await decode(page, download, 1200, 630);
  checks.push({
    name: 'Historical stop PNG distinguishes recorded/current Keeper with approved engraving and retained journey; distinct filenames',
    passed: true,
  });
  stage = 'keeper-orientations';
  f.advance(31000);
  await page.goto(origin + '/keeper/olsols2');
  const ring = page
    .locator('.keeper-arrival')
    .filter({ has: page.getByRole('button', { name: 'Share · Ring 1', exact: true }) });
  await ring.locator('.keeper-card-preview').waitFor({ state: 'visible' });
  assert.equal(await ring.locator('button').count(), 2);
  assert.equal(await page.getByLabel('Share format · Ring 1', { exact: true }).isVisible(), false);
  await page.getByRole('button', { name: 'Share · Ring 1', exact: true }).click();
  await page.getByLabel('Share format · Ring 1', { exact: true }).waitFor({ state: 'visible' });
  for (const [orientation, w, h] of [
    ['landscape', 1200, 675],
    ['vertical', 720, 1280],
  ]) {
    stage = 'keeper-' + orientation;
    f.advance(31000);
    await page.getByLabel('Share format · Ring 1', { exact: true }).selectOption(orientation);
    assert.equal(await ring.locator('button').count(), 2);
    await page.evaluate(() => {
      window.__shareLabels = { recorded: false, current: false, engraving: false, journey: false };
    });
    pending = page.waitForEvent('download');
    await page
      .getByRole('button', { name: 'Download ' + orientation + ' card · Ring 1', exact: true })
      .click();
    download = await pending;
    assert.equal(
      download.suggestedFilename(),
      'raid-relic-keeper-olsols2-ring-1-' + orientation + '.png',
    );
    await decode(page, download, w, h, 'share-keeper-' + orientation + '.png');
    assert.deepEqual(await page.evaluate(() => window.__shareLabels), {
      recorded: true,
      current: true,
      engraving: true,
      journey: true,
    });
  }
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  checks.push({
    name: 'Keeper landscape/vertical actual PNG bytes and pixels, honest canvas labels and responsive controls',
    passed: true,
  });
  stage = 'privacy-race';
  f.advance(31000);
  let stopReads = 0,
    downloads = 0;
  page.on('download', () => downloads++);
  await page.route('**/api/atlas/stops/*', async (route) => {
    if (++stopReads === 2) {
      f.advance(31000);
      await f.chat(HOME, '8101', '!relic forgetme');
    }
    await route.continue();
  });
  await page.getByLabel('Share format · Ring 1', { exact: true }).selectOption('landscape');
  await page.getByRole('button', { name: 'Download landscape card · Ring 1', exact: true }).click();
  await page.locator('#receiving-status').filter({ hasText: 'Card unavailable' }).waitFor();
  assert.equal(stopReads, 2);
  assert.equal(downloads, 0);
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  checks.push({
    name: 'Erasure during PNG generation/final fresh comparison refuses stale download',
    passed: true,
  });
  passed = true;
  stage = 'complete';
} catch (error) {
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(error?.name)
    ? error.name
    : 'browser-or-fixture';
  const line = /browser-smoke-share-card[.]js:(\d+)/.exec(error?.stack ?? '');
  if (line) diagnostic.assertionLine = Number(line[1]);
} finally {
  await review?.close();
  await mkdir('artifacts', { recursive: true });
  for (const [name, bytes] of captures) {
    assert.ok(bytes.length <= 524288);
    await writeFile('artifacts/' + name, bytes);
  }
  const report = JSON.stringify({ passed, stage, failureCategory, checks, diagnostic });
  assert.ok(Buffer.byteLength(report) <= 65536);
  await writeFile('artifacts/share-card-browser-results.json', report);
}
if (!passed) process.exitCode = 1;
