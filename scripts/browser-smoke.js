// Optional host QA. Local simulator only; no external requests or sandbox bypass.
import { mkdir, writeFile } from 'node:fs/promises';
import { createJourneyFixture } from '../test-support/journey-fixture.js';
const fixture = await createJourneyFixture(); let browser; let failure;
const captures = new Map(); const checks = [];
const capture = async (page, name) => { captures.set(name, await page.screenshot({ fullPage: true })); };
async function fits(page, name) {
  const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('body *')].filter(el => { const r = el.getBoundingClientRect(); return r.width && (r.right > innerWidth + .5 || r.left < -.5); }).slice(0, 12).map(el => el.tagName + (el.id ? '#' + el.id : '')) }));
  checks.push({ name, ...geometry, pass: geometry.scrollWidth <= geometry.width });
  if (geometry.scrollWidth > geometry.width) throw new Error(`${name} overflow: ${JSON.stringify(geometry)}`);
}
try {
  await fixture.listen();
  const { chromium } = await import('playwright');
  browser = await chromium.launch({ executablePath: '/snap/bin/chromium', chromiumSandbox: true, headless: true,
    args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  // Legacy SVG-fallback contract; default real WebGL is exercised independently.
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /^webgl/.test(type) ? null : original.call(this, type, ...args); };
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === 'http://127.0.0.1:5191' ? route.continue() : route.abort();
  });
  await context.addInitScript(() => {
    window.__overlayAudioContexts = 0;
    const NativeAudioContext = window.AudioContext;
    if (NativeAudioContext) window.AudioContext = class extends NativeAudioContext {
      constructor(...args) { super(...args); window.__overlayAudioContexts++; }
    };
  });
  const page = await context.newPage(); const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5191/atlas/'); await page.locator('.stop a').first().waitFor();
  if (await page.locator('#simulator').isHidden()) throw new Error('Missing simulator label');
  await capture(page, 'atlas-after');
  const atlasURL = page.url();
  await page.getByLabel('Approved mark text (one word or emoji)').fill('ｍＯＯＮ');
  const searched = page.waitForResponse(r => new URL(r.url()).pathname === '/api/atlas/search' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Search approved text', exact: true }).click();
  const searchResponse = await searched; if (searchResponse.status() !== 200) throw new Error('Local search failed');
  await page.locator('#search-matches img').first().waitFor();
  if (page.url() !== atlasURL) throw new Error('Search changed URL');
  checks.push({ name: 'Shared approved-text search uses POST without URL change', pass: true });
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();

  await page.locator('.stop a').first().click(); await page.locator('.gallery img').first().waitFor();
  await capture(page, 'stop-after');
  const url = page.url();
  let optionalChronicle;
  await page.route('**/api/atlas/stops/**', route => route.fulfill({ json: { rings: 1, mode: 'simulator', total: 1, nextOffset: null,
    stop: { ringIndex: 1, from: '1', to: '2', claimedAt: Date.now(), raidSize: 1, chronicle: optionalChronicle },
    marks: [{ id: 'm1', text: '<img src=x onerror=alert(1)>', runeSvg: '<svg xmlns="http://www.w3.org/2000/svg"/>' }] } }));
  await page.goto(url); await page.getByText('<img src=x onerror=alert(1)>', { exact: true }).waitFor();
  if (await page.locator('.gallery img').count() !== 1) throw new Error('Text interpreted as markup');
  await page.getByText('Fiction · template: Beneath quiet stars, the relic gathered another ring of shared light.', { exact: true }).waitFor();
  checks.push({ name: 'Missing optional Chronicle preserves literal XSS mark gallery', pass: true });
  optionalChronicle = { source: 'model', fiction: true, line: '<img src=x onerror=alert(2)>' };
  await page.goto(url);
  await page.getByText('Fiction · model: <img src=x onerror=alert(2)>', { exact: true }).waitFor();
  await page.getByText('<img src=x onerror=alert(1)>', { exact: true }).waitFor();
  if (await page.locator('#journey img, #journey script').count() !== 0 || await page.locator('.gallery img').count() !== 1) throw new Error('Chronicle interpreted as markup');
  optionalChronicle = { source: 'unexpected', line: 42 };
  await page.goto(url); await page.getByText('<img src=x onerror=alert(1)>', { exact: true }).waitFor();
  await page.getByText('Fiction · template: Beneath quiet stars, the relic gathered another ring of shared light.', { exact: true }).waitFor();
  checks.push({ name: 'Optional Chronicle HTML stays literal; malformed caption preserves gallery', pass: true });

  await page.goto('http://127.0.0.1:5191/overlay/1591805230?corner=1');
  await page.locator('#compact-count').filter({ hasText: 'Rings 1' }).waitFor();
  await page.setViewportSize({ width: 160, height: 160 });
  await capture(page, 'overlay-corner-after'); await fits(page, 'Overlay corner 160px');
  const corner = await page.evaluate(async () => {
    const snapshot = await (await fetch('/api/overlay/1591805230')).json();
    const meter = snapshot.claimMeter;
    const meterVisible = meter && !document.querySelector('#claim-meter').hidden;
    const timingId = meterVisible ? 'claim-label' : 'compact-handoff';
    const r = document.querySelector('.relic-overlay').getBoundingClientRect();
    const labels = ['simulator', 'compact-status', 'compact-count', timingId].map(id => {
      const el = document.getElementById(id), box = el.getBoundingClientRect();
      return { id, text: el.textContent, visible: !el.hidden && box.width > 0 && box.height > 0 && box.left >= 0 && box.right <= 160 && box.top >= 0 && box.bottom <= 160 };
    });
    const timing = document.getElementById(timingId).textContent;
    const match = meterVisible ? / · (\d+)s · Offer (\d+)\/(\d+) · Accept (\d+)\/(\d+)$/.exec(timing) : null;
    const expectedSeconds = meter ? Math.max(0, Math.ceil((meter.endsAt - snapshot.serverNow) / 1000)) : null;
    const timingMatches = meterVisible
      ? Boolean(match && Math.abs(Number(match[1]) - expectedSeconds) <= 2
        && Number(match[2]) === meter.offers && Number(match[3]) === meter.threshold
        && Number(match[4]) === meter.accepts && Number(match[5]) === meter.threshold
        && timing.startsWith(meter.awaitingRaid ? 'Awaiting verified raid · provisional' : 'Verified raid · claim'))
      : Boolean(timing);
    return { width: r.width, height: r.height, scrollHeight: document.documentElement.scrollHeight, labels, timingMatches };
  });
  const compactPass = corner.width === 160 && corner.height === 160 && corner.scrollHeight <= 160 && corner.timingMatches && corner.labels.every(label => label.visible && label.text);
  checks.push({ name: 'Corner 160×160 and essential labels', ...corner, pass: compactPass });
  if (!compactPass) throw new Error('Corner canvas/labels: ' + JSON.stringify(corner));
  await page.setViewportSize({ width: 375, height: 800 }); await page.goto('http://127.0.0.1:5191/atlas/');
  await page.locator('.stop a').first().waitFor();
  await capture(page, 'atlas-mobile-after'); await fits(page, 'Atlas 375px');
  await page.getByLabel('Approved mark text (one word or emoji)').fill('moon');
  await page.getByLabel('Approved mark text (one word or emoji)').press('Enter');
  await page.locator('#search-matches img').first().waitFor(); await fits(page, 'Search results 375px');
  if (new URL(page.url()).search) throw new Error('Search query leaked into URL');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();

  const word = await page.evaluate(() => {
    const heading = document.getElementById('title'); const text = heading.firstChild;
    const start = text.textContent.indexOf('communities');
    if (start < 0) return { rectangles: 0 };
    const range = document.createRange(); range.setStart(text, start); range.setEnd(text, start + 'communities'.length);
    const rects = [...range.getClientRects()].filter(r => r.width > 0);
    return { rectangles: rects.length, width: rects[0]?.width, available: heading.clientWidth };
  });
  const wholeWord = word.rectangles === 1 && word.width <= word.available;
  checks.push({ name: 'Communities stays whole at 375px', ...word, pass: wholeWord });
  if (!wholeWord) throw new Error('Headline word split: ' + JSON.stringify(word));
  await page.locator('.stop a').first().click(); await page.locator('.gallery img').first().waitFor();
  await capture(page, 'stop-mobile-after'); await fits(page, 'Stop 375px');
  await page.setViewportSize({ width: 160, height: 160 });
  for (const suffix of ['?corner=1', '?corner=1&sound=0']) {
    await page.goto(`http://127.0.0.1:5191/overlay/1591805230${suffix}`);
    await page.locator('#compact-count').filter({ hasText: 'Rings 1' }).waitFor();
    if (await page.evaluate(() => window.__overlayAudioContexts) !== 0 || !await page.locator('#sound-toggle').isHidden()) throw new Error('Muted overlay created audio context or sound control');
  }
  checks.push({ name: 'Default and sound=0 construct no AudioContext', pass: true });
  await page.goto('http://127.0.0.1:5191/overlay/1591805230?sound=1&corner=1');
  await page.locator('#compact-count').filter({ hasText: 'Rings 1' }).waitFor();
  if (await page.evaluate(() => window.__overlayAudioContexts) !== 0) throw new Error('Opt-in created audio before gesture');
  await page.getByRole('button', { name: 'Enable optional overlay sounds', exact: true }).click();
  await page.waitForFunction(() => window.__overlayAudioContexts === 1);
  const audioBounds = await page.locator('#sound-toggle').evaluate(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= 160 && r.bottom <= 160 && document.documentElement.scrollHeight <= 160; });
  if (!audioBounds) throw new Error('Sound control outside 160px canvas');
  await fits(page, 'Sound opt-in corner 160px'); await capture(page, 'overlay-sound-corner-after');
  checks.push({ name: 'Only explicit local gesture constructs opted-in context; no listening proof', pass: true });
  if (errors.length) throw new Error('Browser errors: ' + errors.join(', '));
  checks.push({ name: 'Browser errors', pass: errors.length === 0 });
} catch (error) { failure = error; }
finally {
  try {
    // Persist every captured byte buffer even if a later assertion fails.
    await mkdir('artifacts', { recursive: true });
    for (const [name, bytes] of captures) await writeFile(`artifacts/${name}.png`, bytes);
    await writeFile('artifacts/browser-results.json', JSON.stringify({ passed: !failure, simulator: true, checks,
      captures: [...captures.keys()], failure: failure ? String(failure.message).slice(0, 2000) : null }, null, 2));
  } finally { try { await browser?.close(); } finally { await fixture.close(); } }
}
if (failure) throw failure;
console.log('Local sandboxed browser smoke passed; captures and results saved in artifacts/. Simulator only; no OBS/live validation.');
