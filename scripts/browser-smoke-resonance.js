// Host-only fixed5191, all state memory and synthetic signed events. No providers.
import { mkdir, writeFile } from 'node:fs/promises';
import { createJudges, JUDGES_ORIGIN } from '../test-support/judges.js';
const judges = await createJudges({ intent: true }); let browser, failure;
const checks = [], captures = new Map();
try {
  await judges.listen(); const { chromium } = await import('playwright');
  browser = await chromium.launch({ executablePath: '/snap/bin/chromium', chromiumSandbox: true, headless: true, args: ['--disable-background-networking'] });
  const context = await browser.newContext({ viewport: { width: 700, height: 700 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === JUDGES_ORIGIN ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', route => new URL(route.url()).origin === JUDGES_ORIGIN.replace('http', 'ws') ? route.connectToServer() : route.close());
  const page = await context.newPage(); await page.goto(`${JUDGES_ORIGIN}/judges`); await page.locator('#result').filter({ hasText: 'local state refreshed' }).waitFor();
  async function step(action) {
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/judges/action' && r.request().method() === 'POST');
    await page.locator(`[data-action="${action}"]`).click(); if ((await response).status() !== 200) throw Error('Simulated kernel step failed');
    await page.waitForFunction(() => !document.querySelector('[data-action="reset"]').disabled);
  }
  for (const action of ['setup', 'mark', 'send', 'raid', 'offer', 'accept', 'closure', 'closure', 'closure']) await step(action);
  const overlay = await context.newPage(); await overlay.goto(`${JUDGES_ORIGIN}/overlay/1591806023`); await overlay.locator('.rune.faded').waitFor();
  const capture = async name => captures.set(name, await overlay.screenshot({ fullPage: true }));
  await capture('resonance-simulator-before');
  await step('echo'); await overlay.waitForFunction(() => document.querySelector('.archive').classList.contains('resonating'));
  if (await overlay.locator('.rune.faded').evaluate(el => getComputedStyle(el).opacity) !== '0.28') throw Error('Echo brightened faded rune');
  if (!await overlay.locator('.echo-note').textContent().then(t => t.includes('not proof'))) throw Error('Missing decorative explanation');
  await capture('resonance-simulator-during');
  await overlay.reload(); await overlay.locator('.rune.faded').waitFor();
  await overlay.waitForFunction(() => !document.querySelector('.archive').classList.contains('resonating'));
  await capture('resonance-simulator-after'); checks.push({ name: 'Reduced-motion outline, faded rune unchanged, reconnect seeks expiry', pass: true });
  await step('copycommand');
  const snapshot = await overlay.evaluate(async () => (await fetch('/api/overlay/1591806023')).json());
  if (snapshot.status !== 'ready' || snapshot.lineageRings !== 1 || snapshot.resonance) throw Error('Copied command changed state');
  // Set motion on the page; the receipt window still expires, never loops.
  await overlay.emulateMedia({ reducedMotion: 'no-preference' }); await step('echo');
  await overlay.waitForFunction(() => document.querySelector('.archive').classList.contains('resonating'));
  await step('forget'); await overlay.waitForFunction(() => !document.querySelector('.archive').classList.contains('resonating') && !document.querySelector('.rune'));
  checks.push({ name: 'Copied moderator command suppressed; ordinary-motion echo cancelled by privacy commit', pass: true });
  if (!(await overlay.title()).includes('SIMULATOR')) throw Error('Missing simulator label');
} catch (error) { failure = error; }
finally {
  try { await browser?.close(); } catch (error) { failure ??= error; }
  try { await judges.close(); } catch (error) { failure ??= error; }
  await mkdir('artifacts', { recursive: true });
  for (const [name, bytes] of captures) await writeFile(`artifacts/${name}.png`, bytes);
  await writeFile('artifacts/resonance-browser-results.json', JSON.stringify({ simulator: true, passed: !failure, checks, captures: [...captures.keys()], failure: failure ? String(failure.message).slice(0, 200) : null }, null, 2));
}
if (failure) { console.error('Local resonance browser gate failed; see bounded artifact results.'); process.exitCode = 1; }
