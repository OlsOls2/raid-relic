// Native QA only: complete document coverage with small sequential raster tiles.
import assert from 'node:assert/strict';
import { captureTiles } from './capture-tiles.js';
export const TILE_RAW_LIMIT = 4 * 1024 * 1024;
export const CAPTURE_PNG_LIMIT = 16 * 1024 * 1024;
export function pageCapturePlan(width, viewportHeight, documentHeight) {
  if (
    ![width, viewportHeight, documentHeight].every(Number.isSafeInteger) ||
    width < 1 ||
    viewportHeight < 1
  )
    throw Error('Invalid capture geometry');
  const height = Math.min(viewportHeight, 1080, Math.floor((TILE_RAW_LIMIT - 1) / (width * 4)));
  const ranges = captureTiles(width, height, documentHeight);
  return { width, height, rawBytes: width * height * 4, ranges };
}
export async function capturePage(page, name, captures, coverage) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw Error('Capture name rejected');
  const original = page.viewportSize();
  if (!original) throw Error('Explicit viewport required');
  const scroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
  await page.evaluate(() => document.fonts.ready);
  // Wait for the optional receiving panel's initial read to finish before
  // measuring. No masks, app state injection or hidden-content substitution.
  await page.waitForFunction(
    () => !document.querySelector('#receiving-status')?.textContent.startsWith('Reading'),
  );
  const before = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    documentHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
  }));
  const frame = {
    width: before.width,
    height: before.height,
    documentHeight: before.documentHeight,
    rawFullPageBytes: before.width * before.documentHeight * 4,
    tileCount: 0,
    complete: false,
  };
  coverage.push(frame);
  const initial = pageCapturePlan(before.width, before.height, before.documentHeight);
  try {
    if (initial.height !== original.height)
      await page.setViewportSize({ width: original.width, height: initial.height });
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );
    const documentHeight = await page.evaluate(() =>
      Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
    );
    const plan = pageCapturePlan(original.width, initial.height, documentHeight);
    Object.assign(frame, { documentHeight, tileRawBytes: plan.rawBytes, tileHeight: plan.height });
    let bytesTotal = [...captures.values()].reduce((n, bytes) => n + bytes.length, 0);
    const actual = [];
    for (const [index, range] of plan.ranges.entries()) {
      await page.evaluate((y) => scrollTo(0, y), range.start);
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      const position = await page.evaluate(() => ({
        start: scrollY,
        height: innerHeight,
        documentHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
      }));
      assert.equal(position.documentHeight, documentHeight, 'Document changed during capture');
      assert.equal(position.start, range.start, 'Tile scroll position');
      const bytes = await page.screenshot({ fullPage: false });
      assert.ok(bytes.length <= TILE_RAW_LIMIT, 'Bounded encoded tile');
      bytesTotal += bytes.length;
      assert.ok(bytesTotal <= CAPTURE_PNG_LIMIT, 'Cumulative PNG bound');
      const key = index === 0 ? name : `${name}-tile-${index + 1}`;
      captures.set(key, bytes);
      actual.push({
        start: position.start,
        end: Math.min(documentHeight, position.start + position.height),
      });
      frame.tileCount = actual.length;
    }
    assert.equal(actual[0].start, 0);
    assert.equal(actual.at(-1).end, documentHeight);
    for (let i = 1; i < actual.length; i++) assert.ok(actual[i].start <= actual[i - 1].end);
    Object.assign(frame, { ranges: actual, pngBytesTotal: bytesTotal, complete: true });
  } finally {
    if (initial.height !== original.height) await page.setViewportSize(original);
    await page.evaluate((p) => scrollTo(p.x, p.y), scroll).catch(() => {});
  }
}
