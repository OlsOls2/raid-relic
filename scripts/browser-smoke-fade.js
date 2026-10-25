// Optional host-only gate: fixed registered loopback5191, synthetic signed lifecycle only.
import { mkdir, writeFile } from 'node:fs/promises';
import { createJudges, JUDGES_ORIGIN } from '../test-support/judges.js';
const judges = await createJudges({ intent: true });
let browser, failure; const captures = new Map(), checks = [];
try {
  await judges.listen(); const { chromium } = await import('playwright');
  browser = await chromium.launch({ executablePath: '/snap/bin/chromium', chromiumSandbox: true, headless: true, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 700, height: 700 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === JUDGES_ORIGIN ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', route => new URL(route.url()).origin === JUDGES_ORIGIN.replace('http', 'ws') ? route.connectToServer() : route.close());
  const consolePage = await context.newPage(); await consolePage.goto(`${JUDGES_ORIGIN}/judges`);
  await consolePage.locator('#result').filter({ hasText: 'local state refreshed' }).waitFor();
  async function step(action) {
    const response = consolePage.waitForResponse(r => new URL(r.url()).pathname === '/api/judges/action' && r.request().method() === 'POST');
    await consolePage.locator(`[data-action="${action}"]`).click();
    if ((await response).status() !== 200) throw Error('Simulated kernel action failed');
    await consolePage.waitForFunction(() => !document.querySelector('[data-action="reset"]').disabled);
  }
  for (const action of ['setup', 'mark', 'send', 'raid', 'offer', 'accept']) await step(action);
  const overlay = await context.newPage(); await overlay.goto(`${JUDGES_ORIGIN}/overlay/1591806023`);
  await overlay.locator('.rune').waitFor();
  const capture = async name => {
    const rune = overlay.locator('.rune').first(); await rune.waitFor({ state: 'visible' });
    if (!await rune.evaluate(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight && Number(getComputedStyle(node).opacity) > 0; })) throw Error('Rune outside capture viewport');
    captures.set(name, await overlay.screenshot({ fullPage: true }));
  };
  if (await overlay.locator('.rune.faded').count()) throw Error('Fresh carry incorrectly faded');
  await capture('fade-simulator-before');
  await step('closure'); await step('closure');
  await overlay.locator('.rune').waitFor();
  if (await overlay.locator('.rune.faded').count()) throw Error('Two closures incorrectly faded');
  await capture('fade-simulator-after2');
  await step('closure'); await overlay.locator('.rune.faded').waitFor();
  const opacity = await overlay.locator('.rune.faded').evaluate(node => getComputedStyle(node).opacity);
  if (Number(opacity) !== 0.28 || !(await overlay.locator('.rune.faded').getAttribute('alt')).includes('not deleted')) throw Error('Fade presentation/accessibility mismatch');
  await capture('fade-simulator-after3'); checks.push({ name: 'Actual kernel closures: bright at0/2, dim at3; accessible retained-content explanation', pass: true });
  await overlay.reload(); await overlay.locator('.rune.faded').waitFor();
  await step('forget'); await overlay.waitForFunction(() => document.querySelectorAll('.rune').length === 0);
  checks.push({ name: 'Reconnect converges; self-forget removes faded rune', pass: true });
  if (!(await overlay.title()).includes('SIMULATOR')) throw Error('Missing simulator label');
} catch (error) { failure = error; }
finally {
  try { await browser?.close(); } catch (error) { failure ??= error; }
  try { await judges.close(); } catch (error) { failure ??= error; }
  await mkdir('artifacts', { recursive: true });
  for (const [name, bytes] of captures) await writeFile(`artifacts/${name}.png`, bytes);
  await writeFile('artifacts/fade-browser-results.json', JSON.stringify({ simulator: true, passed: !failure, checks, captures: [...captures.keys()], failure: failure ? String(failure.message).slice(0, 200) : null }, null, 2));
}
if (failure) { console.error('Local simulated fade browser gate failed; see bounded artifact results.'); process.exitCode = 1; }
