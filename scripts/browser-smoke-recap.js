// Optional host gate; owns only fixed loopback5191. All provider work is mocked.
import { mkdir, mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createJudges, JUDGES_ORIGIN } from '../test-support/judges.js';
const judges = await createJudges({ intent: true }); let browser, failure, ownedDownloads;
const downloadsVerified = [];
const checks = [], captures = new Map();
const capture = async (page, name) => captures.set(name, await page.screenshot({ fullPage: true }));
try {
  await judges.listen(); const { chromium } = await import('playwright');
  // Snap Chromium and host Node cannot share Snap-private /tmp. Create only
  // this unique child in the standard visible Downloads directory; no fallback.
  ownedDownloads = await mkdtemp(join(homedir(), 'Downloads', 'raid-relic-recap-'));
  browser = await chromium.launch({ downloadsPath: ownedDownloads, executablePath: '/snap/bin/chromium', chromiumSandbox: true, headless: true, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 950 }, acceptDownloads: true, serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === JUDGES_ORIGIN ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', route => new URL(route.url()).origin === JUDGES_ORIGIN.replace('http', 'ws') ? route.connectToServer() : route.close());
  const errors = []; context.on('page', page => page.on('pageerror', error => errors.push(error.message.slice(0, 200))));
  const page = await context.newPage(); await page.goto(`${JUDGES_ORIGIN}/recap`); await page.getByText('No completed hops yet.', { exact: false }).waitFor(); await capture(page, 'recap-empty-before');
  const consolePage = await context.newPage(); await consolePage.goto(`${JUDGES_ORIGIN}/judges`);
  await consolePage.locator('#result').filter({ hasText: 'local state refreshed' }).waitFor();
  for (const action of ['setup', 'mark', 'send', 'raid', 'offer', 'accept']) {
    const result = consolePage.waitForResponse(r => new URL(r.url()).pathname === '/api/judges/action' && r.request().method() === 'POST');
    await consolePage.locator(`[data-action="${action}"]`).click(); if ((await result).status() !== 200) throw Error('Mock step failed');
    await consolePage.waitForFunction(() => !document.querySelector('[data-action="reset"]').disabled);
  }
  await page.getByRole('button', { name: 'Refresh snapshot' }).click(); await page.locator('#summary').filter({ hasText: '1 completed stops' }).waitFor();
  await capture(page, 'recap-desktop-after');
  for (const kind of ['SVG', 'PNG']) {
    const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: `Download ${kind}`, exact: true }).click();
    const download = await downloading; await mkdir('artifacts', { recursive: true }); const path = `artifacts/recap-simulator.${kind.toLowerCase()}`; await download.saveAs(path);
    const bytes = await readFile(path);
    if (kind === 'SVG' && (!bytes.toString().includes('SIMULATOR SNAPSHOT') || bytes.toString().includes('<script'))) throw Error('SVG unsafe or unlabelled');
    if (kind === 'PNG' && (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(16) !== 1200 || bytes.readUInt32BE(20) !== 630)) throw Error('Invalid PNG header/size');
    downloadsVerified.push(kind);
  }
  checks.push({ name: 'Fresh SVG and actual1200x630 PNG downloads from labelled Simulator card', pass: true });
  await page.setViewportSize({ width: 375, height: 800 }); if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Mobile recap overflow');
  await capture(page, 'recap-mobile-after');
  const forgotten = consolePage.waitForResponse(r => new URL(r.url()).pathname === '/api/judges/action'); await consolePage.locator('[data-action="forget"]').click(); if ((await forgotten).status() !== 200) throw Error('Forget failed');
  await page.getByRole('button', { name: 'Refresh snapshot' }).click(); await page.locator('#summary').filter({ hasText: '0 retained approved mark entries' }).waitFor();
  await capture(page, 'recap-erased-after'); checks.push({ name: '375px full route and fresh privacy erasure', pass: true });
  await page.route('**/api/recap', route => route.fulfill({ status: 503, body: 'unavailable' })); await page.getByRole('button', { name: 'Refresh snapshot' }).click();
  await page.locator('#status').filter({ hasText: 'Previous snapshot cleared' }).waitFor(); if (!await page.locator('#card').isHidden()) throw Error('Stale card retained');
  if (!(await page.title()).includes('SIMULATOR') || errors.length) throw Error('Missing label/browser error');
  checks.push({ name: 'Read failure clears prior snapshot; persistent Simulator label', pass: true });
} catch (error) { failure = error; }
finally {
  let browserClosed = !browser;
  try { await browser?.close(); browserClosed = true; }
  catch (error) { failure ??= error; }
  // Never remove the parent Downloads directory or anyone else's files. If
  // Chromium failed to close, retain our directory and report failure instead.
  if (ownedDownloads && browserClosed) {
    try { await rm(ownedDownloads, { recursive: true, force: true }); }
    catch (error) { failure ??= error; }
  }
  try { await judges.close(); } catch (error) { failure ??= error; }
  await mkdir('artifacts', { recursive: true });
  for (const [name, bytes] of captures) await writeFile(`artifacts/${name}.png`, bytes);
  await writeFile('artifacts/recap-browser-results.json', JSON.stringify({ simulator: true, passed: !failure, checks, downloadsVerified,
    downloadsStorage: 'unique owned standard Downloads child; no private-tmp fallback',
    downloadsRetainedBecauseBrowserCloseFailed: Boolean(ownedDownloads && !browserClosed),
    captures: [...captures.keys()], failure: failure ? String(failure.message).slice(0, 300) : null }, null, 2));
}
if (failure) throw failure;
console.log('SIMULATOR recap browser gate passed; not live/cloud/provider proof.');
