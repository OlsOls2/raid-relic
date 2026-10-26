// LOCAL SIMULATOR: actual PNG bytes and pixels, no external assets/provider calls.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createJudges, JUDGES_ORIGIN as origin } from '../test-support/judges.js';
const judges = await createJudges({ intent: true, env: {} });
let browser,
  page,
  stage = 'setup',
  failed = false,
  failureCategory = null;
const checks = [],
  images = new Map(),
  captures = [];
async function png(download, captureName) {
  assert.match(
    download.suggestedFilename(),
    captureName === 'p9-atlas-ring-card.png'
      ? /^raid-relic-stop-1-olsols2\.png$/
      : /^raid-relic-demo-ring-1\.png$/,
  );
  const stream = await download.createReadStream(),
    chunks = [];
  let size = 0;
  for await (const b of stream) {
    size += b.length;
    assert.ok(size <= 512 * 1024);
    chunks.push(b);
  }
  const bytes = Buffer.concat(chunks);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  const proof = await page.evaluate(async (data) => {
    const raw = Uint8Array.from(atob(data), (c) => c.charCodeAt(0)),
      url = URL.createObjectURL(new Blob([raw], { type: 'image/png' }));
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      const c = document.createElement('canvas');
      c.width = 1200;
      c.height = 630;
      const x = c.getContext('2d');
      x.drawImage(image, 0, 0);
      const p = x.getImageData(0, 0, 1200, 630).data;
      let colored = 0;
      for (let i = 0; i < p.length; i += 4) if (p[i + 3] && p[i] !== p[i + 1]) colored++;
      return image.naturalWidth === 1200 && image.naturalHeight === 630 && colored > 10000;
    } finally {
      URL.revokeObjectURL(url);
    }
  }, bytes.toString('base64'));
  assert.ok(proof);
  if (process.env.P9_CAPTURE === '1') images.set(captureName, bytes);
  await download.delete();
}
try {
  await judges.seedReviewJourney();
  await judges.listen();
  const { chromium } = await import('playwright');
  browser = await chromium.launch({
    executablePath: '/snap/bin/chromium',
    headless: true,
    chromiumSandbox: true,
  });
  const c = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  await c.route('**/*', (r) =>
    new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
  );
  page = await c.newPage();
  let exact = 0;
  page.on('request', (r) => {
    if (/^\/api\/atlas\/stops\/[a-f0-9]{64}$/.test(new URL(r.url()).pathname)) exact++;
  });
  stage = 'atlas-fresh-stop';
  await page.goto(origin + '/atlas/');
  const button = page.getByRole('button', { name: 'Download ring card Stop 1', exact: true });
  await button.waitFor();
  const d = page.waitForEvent('download');
  await button.click();
  await png(await d, 'p9-atlas-ring-card.png');
  assert.equal(exact, 1);
  stage = 'removed-stop';
  await page.route('**/api/atlas/stops/*', (r) =>
    r.fulfill({ status: 404, body: '{}', contentType: 'application/json' }),
  );
  let unexpected = 0;
  page.on('download', () => unexpected++);
  await button.click();
  await page.locator('#map-status').filter({ hasText: 'Ring card unavailable' }).waitFor();
  assert.equal(unexpected, 0);
  checks.push({
    name: 'SIMULATOR actual completed stop fresh-read PNG1200x630/colored pixels; missing stop refuses download',
    passed: true,
  });
  await c.close();
  stage = 'demo-no-io';
  const demo = await browser.newContext({
    viewport: { width: 390, height: 800 },
    serviceWorkers: 'block',
    acceptDownloads: true,
  });
  await demo.route('**/*', (r) => {
    const u = new URL(r.request().url());
    return u.origin === origin && !u.pathname.startsWith('/api/') ? r.continue() : r.abort();
  });
  await demo.addInitScript(() => {
    window.__cardIO = 0;
    const no = () => {
      window.__cardIO++;
      throw Error('Forbidden');
    };
    window.fetch = no;
    window.XMLHttpRequest = no;
    window.WebSocket = no;
    navigator.sendBeacon = no;
    Storage.prototype.setItem = no;
  });
  page = await demo.newPage();
  await page.goto(origin + '/demo/');
  assert.ok(await page.locator('#demo-download').isDisabled());
  await page.locator('#demo-send').click();
  await page.locator('#demo-source-chat button').click();
  await page.locator('#demo-raid').click();
  await page.locator('#demo-host-chat button').click();
  assert.ok(await page.locator('#demo-download').isEnabled());
  const saved = page.waitForEvent('download');
  await page.locator('#demo-download').click();
  await png(await saved, 'p9-demo-ring-card.png');
  assert.equal(await page.locator('#demo-rings').innerText(), 'Rings: 1');
  await page.locator('#demo-reset').click();
  assert.ok(await page.locator('#demo-download').isDisabled());
  assert.equal(await page.locator('#demo-rings').innerText(), 'Rings: 0');
  assert.equal(await page.evaluate(() => window.__cardIO), 0);
  assert.ok(await page.locator('#demo-banner').isVisible());
  checks.push({
    name: 'PERMANENT SIMULATED DEMO holder-gated PNG export/reset with no API/socket/storage IO',
    passed: true,
  });
  await demo.close();
} catch (e) {
  failed = true;
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(e.name)
    ? e.name
    : 'browser-or-fixture';
} finally {
  await browser?.close().catch(() => {});
  await judges.close();
  await mkdir('artifacts', { recursive: true });
  for (const [name, bytes] of images) {
    await writeFile('artifacts/' + name, bytes);
    captures.push(name);
  }
  await writeFile(
    'artifacts/ring-card-browser-results.json',
    JSON.stringify({ passed: !failed, stage, failureCategory, checks, captures }, null, 2),
  );
}
if (failed) process.exitCode = 1;
