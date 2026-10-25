// Optional host gate: real browser downloads, sandboxed Chromium, local fixtures only.
import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createJudges, JUDGES_ORIGIN } from '../test-support/judges.js';
import { validDesign } from '../src/forge.js';
const judges = await createJudges({ intent: true }); let browser, failure, ownedDownloads;
const captures = new Map(), checks = [], downloadsVerified = [];
const capture = async (page, name) => captures.set(name, await page.screenshot({ fullPage: true }));
try {
  await judges.listen(); const { chromium } = await import('playwright');
  ownedDownloads = await mkdtemp(join(homedir(), 'Downloads', 'raid-relic-forge-'));
  browser = await chromium.launch({ executablePath: '/snap/bin/chromium', downloadsPath: ownedDownloads, chromiumSandbox: true, headless: true, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true, serviceWorkers: 'block' });
  // Legacy SVG-fallback contract; default real WebGL is exercised independently.
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /^webgl/.test(type) ? null : original.call(this, type, ...args); };
  });
  await context.route('**/*', route => new URL(route.request().url()).origin === JUDGES_ORIGIN ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', route => new URL(route.url()).origin === JUDGES_ORIGIN.replace('http', 'ws') ? route.connectToServer() : route.close());
  const errors = []; context.on('page', page => page.on('pageerror', error => errors.push(error.message.slice(0, 200))));
  const page = await context.newPage(); await page.goto(`${JUDGES_ORIGIN}/forge`);
  if (!(await page.title()).includes('SIMULATOR')) throw Error('Missing initial Simulator label'); const url = page.url(); await capture(page, 'forge-before');
  async function preview(description) {
    await page.getByLabel('Design description (up to240 Unicode characters)').fill(description);
    const responding = page.waitForResponse(r => new URL(r.url()).pathname === '/api/forge' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Preview template', exact: true }).click(); const response = await responding; if (response.status() !== 200) throw Error('Template request failed');
    await page.locator('#status').filter({ hasText: 'Template preview · schema v1' }).waitFor();
    const data = JSON.parse(await page.locator('#design-json').textContent());
    if (!validDesign(data.design) || data.source !== 'template' || data.mode !== 'simulator' || data.applied !== false || page.url() !== url) throw Error('Invalid template/schema/source/URL');
    return data;
  }
  const first = await preview('tall violet crystal with 8 facets'); await capture(page, 'forge-crystal-after');
  const second = await preview('warm amber orb'); if (JSON.stringify(first.design) === JSON.stringify(second.design)) throw Error('Distinct descriptions did not select distinct templates');
  const repeated = await preview('ＴＡＬＬ ＶＩＯＬＥＴ ＣＲＹＳＴＡＬ with 8 facets'); if (JSON.stringify(first.design) !== JSON.stringify(repeated.design)) throw Error('Normalization changed deterministic design');
  checks.push({ name: 'Two distinct deterministic templates, strict schema, no URL description or AI claim', pass: true });
  for (const kind of ['JSON', 'SVG']) {
    const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: `Download ${kind}`, exact: true }).click(); const download = await downloading;
    await mkdir('artifacts', { recursive: true }); const path = `artifacts/forge-simulator.${kind.toLowerCase()}`; await download.saveAs(path); const bytes = await readFile(path);
    if (kind === 'JSON') { const data = JSON.parse(bytes.toString()); if (!validDesign(data.design) || data.mode !== 'simulator' || data.source !== 'template' || 'description' in data) throw Error('Invalid JSON download'); }
    else if (!bytes.toString().includes('SIMULATOR') || /<script|foreignObject|href=/.test(bytes.toString())) throw Error('SVG unsafe or missing watermark');
    downloadsVerified.push(kind);
  }
  await page.setViewportSize({ width: 375, height: 800 }); if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Forge375 overflow'); await capture(page, 'forge-mobile-after');
  await page.getByRole('button', { name: 'Clear description & preview', exact: true }).click(); if (!await page.locator('#preview-image').isHidden()) throw Error('Clear retained preview');
  await page.getByLabel('Design description (up to240 Unicode characters)').fill('<svg>'); await page.getByRole('button', { name: 'Preview template', exact: true }).click();
  await page.locator('#status').filter({ hasText: 'Preview unavailable or invalid' }).waitFor(); if (!await page.getByRole('button', { name: 'Download JSON', exact: true }).isDisabled()) throw Error('Error retained export');
  await capture(page, 'forge-error-after');
  checks.push({ name: 'Actual JSON/SVG downloads,375px and clear/error states remain labelled', pass: true });
  if (errors.length) throw Error('Browser error');
} catch (error) { failure = error; }
finally {
  let browserClosed = !browser; try { await browser?.close(); browserClosed = true; } catch (error) { failure ??= error; }
  if (ownedDownloads && browserClosed) { try { await rm(ownedDownloads, { recursive: true, force: true }); } catch (error) { failure ??= error; } }
  try { await judges.close(); } catch (error) { failure ??= error; }
  await mkdir('artifacts', { recursive: true }); for (const [name, bytes] of captures) await writeFile(`artifacts/${name}.png`, bytes);
  await writeFile('artifacts/forge-browser-results.json', JSON.stringify({ simulator: true, passed: !failure, checks, downloadsVerified, captures: [...captures.keys()], downloadsRetainedBecauseBrowserCloseFailed: Boolean(ownedDownloads && !browserClosed), failure: failure ? String(failure.message).slice(0, 300) : null }, null, 2));
}
if (failure) throw failure;
console.log('SIMULATOR Forge template browser gate passed; not live customization/model/provider proof.');
