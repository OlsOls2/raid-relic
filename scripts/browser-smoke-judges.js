// Optional sequential host QA. All network is loopback, all provider work mocked.
import { mkdir, writeFile } from 'node:fs/promises';
import { createJudges, JUDGES_ORIGIN } from '../test-support/judges.js';
const judges = await createJudges({ intent: true }); let browser, failure;
const checks = [], captures = new Map();
const capture = async (page, name) => { captures.set(name, await page.screenshot({ fullPage: true })); };
try {
  await judges.listen(); const { chromium } = await import('playwright');
  browser = await chromium.launch({ executablePath: '/snap/bin/chromium', chromiumSandbox: true, headless: true, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === JUDGES_ORIGIN ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', route => new URL(route.url()).origin === JUDGES_ORIGIN.replace('http', 'ws') ? route.connectToServer() : route.close());
  const errors = []; context.on('page', page => page.on('pageerror', error => errors.push(error.message.slice(0, 200))));
  const page = await context.newPage(); await page.goto(`${JUDGES_ORIGIN}/judges`);
  await page.getByRole('status').filter({ hasText: 'local state refreshed' }).waitFor();
  if (!(await page.title()).includes('SIMULATOR')) throw Error('Missing tab label');
  await capture(page, 'judges-before');
  async function press(action) {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/judges/action' && r.request().method() === 'POST');
    await page.locator(`[data-action="${action}"]`).click(); const result = await response;
    if (result.status() !== 200) throw Error(`Simulated step ${action} failed: ${result.status()}`);
    await page.waitForFunction(() => !document.querySelector('[data-action="reset"]').disabled);
    return result.json();
  }
  await press('setup'); await press('mark');
  await page.getByLabel('Observed eligible simulated Keeper').getByText('Simulated olsols2', { exact: false }).waitFor({ state: 'attached' });
  const accepted = await press('send'); if (accepted.rings !== 0 || accepted.handoff !== null) throw Error('API acceptance incorrectly travelled');
  await press('raid'); const target = page.frameLocator('iframe[title="SIMULATOR host overlay"]');
  await target.locator('#compact-status').filter({ hasText: 'Incoming' }).waitFor();
  await target.locator('#claim-meter').waitFor({ state: 'visible' });
  await target.locator('#claim-label').filter({ hasText: 'Verified raid · claim' }).waitFor();
  const incoming = await page.evaluate(async () => (await fetch('/api/overlay/1591806023')).json());
  if (incoming.status !== 'incoming' || !incoming.handoff || incoming.handoff.completed || incoming.claimMeter.awaitingRaid) throw Error('Verified incoming proof missing');
  await target.locator('#compact-count').filter({ hasText: 'Charge 1/160 · Rings 0' }).waitFor();
  const statusBox = await target.locator('#compact-status').boundingBox();
  const countBox = await target.locator('#compact-count').boundingBox();
  const meterBox = await target.locator('#claim-meter').boundingBox();
  if (!statusBox || !countBox || !meterBox || statusBox.y + statusBox.height > countBox.y || countBox.y + countBox.height > meterBox.y || meterBox.y + meterBox.height > statusBox.y - 104 + 160) throw Error('Incoming corner rows overlap or exceed canvas');
  await capture(page, 'judges-incoming'); await press('offer');
  const claimed = await press('accept'); if (claimed.rings !== 1) throw Error('Two chats did not complete hop');
  await target.locator('#compact-count').filter({ hasText: 'Rings 1' }).waitFor();
  await capture(page, 'judges-after'); checks.push({ name: 'Labelled mock setup/API/receipt/two-chat claim and preview', pass: true });
  const atlas = await context.newPage(); await atlas.goto(`${JUDGES_ORIGIN}/atlas/`); await atlas.locator('.stop a').first().waitFor();
  await atlas.getByText('Fiction · template:', { exact: false }).waitFor(); const unchanged = atlas.url();
  await atlas.getByLabel('Approved mark text (one word or emoji)').fill('moon'); await atlas.getByRole('button', { name: 'Search approved text', exact: true }).click();
  await atlas.locator('#search-matches img').first().waitFor(); if (atlas.url() !== unchanged) throw Error('Query leaked into URL');
  await atlas.getByRole('button', { name: 'Clear search', exact: true }).click();
  await atlas.locator('.stop a').first().click(); await atlas.locator('#marks img').first().waitFor();
  if (!(await atlas.title()).includes('SIMULATOR')) throw Error('Stop title unlabelled');
  await capture(atlas, 'judges-stop-after');
  await press('forget'); await target.locator('#compact-count').filter({ hasText: 'Charge 0/160' }).waitFor();
  await atlas.goto(`${JUDGES_ORIGIN}/atlas/`); await atlas.getByLabel('Approved mark text (one word or emoji)').fill('moon'); await atlas.getByRole('button', { name: 'Search approved text', exact: true }).click();
  await atlas.getByText('No approved shared-text matches at completed stops.', { exact: true }).waitFor();
  checks.push({ name: 'Shared search/template fiction/stop detail and post-forget privacy', pass: true });
  await press('reset'); await target.locator('#compact-count').filter({ hasText: 'Rings 0' }).waitFor();
  await target.locator('#compact-status').filter({ hasText: 'Waiting' }).waitFor(); await capture(page, 'judges-reset-after');
  await page.setViewportSize({ width: 375, height: 800 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Judges mobile overflow');
  await capture(page, 'judges-mobile-after');
  checks.push({ name: 'Reset isolation/rebound feeds and 375px layout', pass: true });
  if (errors.length) throw Error('Local browser error');
} catch (error) { failure = error; }
finally {
  try { await mkdir('artifacts', { recursive: true }); for (const [name, bytes] of captures) await writeFile(`artifacts/${name}.png`, bytes);
    await writeFile('artifacts/judges-browser-results.json', JSON.stringify({ simulator: true, passed: !failure, checks, captures: [...captures.keys()], failure: failure ? String(failure.message).slice(0, 300) : null }, null, 2));
  } finally { try { await browser?.close(); } finally { await judges.close(); } }
}
if (failure) throw failure;
console.log('SIMULATOR local judges browser checks passed; not live Twitch/OBS/provider proof.');
