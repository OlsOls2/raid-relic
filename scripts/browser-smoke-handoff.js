// Explicit LOCAL-only mocked own-mark capability flow. No providers/auth files.
import { mkdir, writeFile } from 'node:fs/promises';
import { createJudges, JUDGES_ORIGIN } from '../test-support/judges.js';
const judges = await createJudges({ intent: true });
let browser, failure, failureCode;
const captures = new Map(),
  checks = [];
try {
  await judges.listen();
  const { chromium } = await import('playwright');
  browser = await chromium.launch({
    executablePath: '/snap/bin/chromium',
    chromiumSandbox: true,
    headless: true,
    args: ['--disable-background-networking'],
  });
  const context = await browser.newContext({
    viewport: { width: 1000, height: 850 },
    serviceWorkers: 'block',
  });
  // Legacy SVG-fallback contract; default real WebGL is exercised independently.
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /^webgl/.test(type) ? null : original.call(this, type, ...args);
    };
  });
  await context.route('**/*', (route) =>
    new URL(route.request().url()).origin === JUDGES_ORIGIN ? route.continue() : route.abort(),
  );
  await context.routeWebSocket('**/*', (route) =>
    new URL(route.url()).origin === JUDGES_ORIGIN.replace('http', 'ws')
      ? route.connectToServer()
      : route.close(),
  );
  const page = await context.newPage();
  await page.goto(`${JUDGES_ORIGIN}/judges`);
  await page.locator('#result').filter({ hasText: 'local state refreshed' }).waitFor();
  async function step(action) {
    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/judges/action' && r.request().method() === 'POST',
    );
    await page.locator(`[data-action="${action}"]`).click();
    if ((await response).status() !== 200) throw Error('Simulated kernel step failed');
    await page.waitForFunction(() => !document.querySelector('[data-action="reset"]').disabled);
  }
  for (const action of ['setup', 'mark', 'send', 'raid', 'offer', 'accept', 'mymarks'])
    await step(action);
  const href = await page.locator('#own-share').getAttribute('href');
  const shared = await context.newPage();
  await shared.goto(`${JUDGES_ORIGIN}${href}`);
  await shared.locator('#matches img').waitFor();
  if (new URL(shared.url()).hash || new URL(shared.url()).search)
    throw Error('Capability retained in address/history');
  if (
    !(await shared.title()).includes('SIMULATOR') ||
    !(await shared.locator('#status').textContent()).includes('1 retained approved')
  )
    throw Error('Missing safe Simulator history');
  if ((await shared.locator('#self-login').inputValue()) !== 'viewer811')
    throw Error('Missing proven named binding');
  captures.set('handoff-simulator-own-history', await shared.screenshot({ fullPage: true }));
  checks.push({
    name: 'Original-chat named opt-in, automatic exact mocked bot reply, encrypted fragment removed, safe own approved history',
    pass: true,
  });
  await shared.locator('#self-login').fill('someone_else');
  await shared.getByRole('button', { name: 'Show this shared name', exact: true }).click();
  await shared.locator('#status').filter({ hasText: 'Previous content hidden' }).waitFor();
  if (await shared.locator('#matches li').count()) throw Error('Cross-name history leaked');
  await shared.locator('#self-login').fill('@VIEWER811');
  await shared.getByRole('button', { name: 'Show this shared name', exact: true }).click();
  await shared.locator('#matches img').waitFor();
  let releaseResponse;
  const held = new Promise((resolve) => {
    releaseResponse = resolve;
  });
  let intercepted, delivered;
  const finished = new Promise((resolve) => {
    delivered = resolve;
  });
  const arrived = new Promise((resolve) => {
    intercepted = resolve;
  });
  await shared.route('**/api/my-marks', async (route) => {
    const response = await route.fetch();
    intercepted();
    await held;
    try {
      await route.fulfill({ response });
    } catch {
      /* Input invalidation may abort the old request. */
    } finally {
      delivered();
    }
  });
  await shared.getByRole('button', { name: 'Refresh shared history', exact: true }).click();
  await arrived;
  await shared.locator('#self-login').fill('different_name');
  releaseResponse();
  await finished;
  await shared.unroute('**/api/my-marks');
  if (await shared.locator('#matches li').count())
    throw Error('Stale response survived input invalidation');
  await shared.locator('#self-login').fill('viewer811');
  await step('forget');
  await shared.getByRole('button', { name: 'Refresh shared history', exact: true }).click();
  await shared.locator('#status').filter({ hasText: 'Previous content hidden' }).waitFor();
  if (await shared.locator('#matches li').count()) throw Error('Forgotten content survived');
  captures.set('handoff-simulator-forgotten', await shared.screenshot({ fullPage: true }));
  await shared.reload();
  await shared.locator('#status').filter({ hasText: 'Previous content hidden' }).waitFor();
  checks.push({
    name: 'Fresh forget revocation and reload fail closed without browser capability storage',
    pass: true,
  });
} catch (error) {
  failure = true;
  failureCode = ['EPERM', 'EADDRINUSE', 'ENOENT'].includes(error.code)
    ? error.code
    : 'assertion-or-browser';
} finally {
  try {
    await browser?.close();
  } catch {
    failure = true;
  }
  try {
    await judges.close();
  } catch {
    failure = true;
  }
  await mkdir('artifacts', { recursive: true });
  for (const [name, bytes] of captures) await writeFile(`artifacts/${name}.png`, bytes);
  // Deliberately no raw exception/URL: it could include a capability fragment.
  await writeFile(
    'artifacts/handoff-browser-results.json',
    JSON.stringify(
      {
        simulator: true,
        passed: !failure,
        failureCode: failureCode ?? null,
        checks,
        captures: [...captures.keys()],
        failure: failure
          ? 'Local gate unavailable or assertion failed; no private URL/token logged.'
          : null,
      },
      null,
      2,
    ),
  );
}
if (failure) {
  console.error('Local mocked handoff gate failed; see safe result metadata.');
  process.exitCode = 1;
}
