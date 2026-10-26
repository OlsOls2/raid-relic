// Optional host-only LOCAL HTTPS mocked browser gate. Fixed registered5191.
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
const origin = 'https://localhost:5191',
  f = await pilotFixture('memory', { origin });
let browser, server, tls, failure;
let stage = 'local-startup',
  failureCategory = null;
const checks = [],
  safeGets = [],
  pageErrors = [];

const reloadDiagnostic = {
  reason: null,
  status: null,
  holderMatches: null,
  intentNull: null,
  finalized: null,
};
function failReload(reason) {
  reloadDiagnostic.reason = reason;
  throw Error('Closed reload assertion');
}
try {
  stage = 'local-tls';
  tls = await createLocalTLS();
  server = createServer(tls.options, (req, res) => {
    res.setHeader('x-raid-relic-mode', 'simulator');
    return f.runtime.handler(req, res);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(5191, '127.0.0.1', resolve);
  });
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  await f.control(HOME, `send:${OTHER}`);
  f.advance();
  await f.raid(HOME, OTHER, 3);
  f.advance(180000);
  stage = 'browser-launch';
  const { chromium } = await import('playwright');
  browser = await chromium.launch({
    executablePath: '/snap/bin/chromium',
    chromiumSandbox: true,
    headless: true,
  });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  // Legacy SVG-fallback contract; default real WebGL is exercised independently.
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return /^webgl/.test(type) ? null : original.call(this, type, ...args);
    };
  });
  await context.route('**/*', (r) =>
    new URL(r.request().url()).origin === origin ? r.continue() : r.abort(),
  );
  await context.addCookies(
    Object.entries(f.cookies).map(([, cookie]) => {
      const i = cookie.indexOf('=');
      return {
        name: cookie.slice(0, i),
        value: cookie.slice(i + 1),
        url: origin,
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
      };
    }),
  );
  await context.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await nativeFetch(...args);
      if (new URL(String(args[0]), location.href).pathname === location.pathname + '/status') {
        const copy = response.clone();
        window.__claimStatus = copy.json().then(
          (value) => ({
            status: response.status,
            holderMatches: value.pilot?.holder === '1591806023',
            intentNull: value.pilot?.intent === null,
            finalized: value.pilot?.claimProgress?.finalized === true,
          }),
          (error) => ({
            status: response.status,
            bodyError: error?.name === 'SyntaxError' ? 'syntax' : 'body-unavailable',
          }),
        );
      }
      return response;
    };
  });
  stage = 'control-load';
  const page = await context.newPage();
  page.on('pageerror', (error) => {
    if (pageErrors.length < 4)
      pageErrors.push(
        ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError'].includes(error.name)
          ? error.name
          : 'Error',
      );
  });
  page.on('response', (response) => {
    if (response.request().method() !== 'GET' || safeGets.length >= 12) return;
    const path = new URL(response.url()).pathname;
    const name =
      path === `/control/${HOME}`
        ? 'source-control-html'
        : path === `/control/${HOME}/status`
          ? 'source-control-status'
          : path === '/control.js'
            ? 'control-module'
            : null;
    if (name) safeGets.push({ name, status: response.status() });
  });
  page.on('dialog', (d) => d.accept());
  await page.goto(`${origin}/control/${HOME}`);
  await page.waitForFunction(
    () =>
      document.querySelector('#ledger').textContent.includes('expired-handoff') &&
      !document.getElementById('refresh').disabled,
  );
  if (!(await page.locator('body').textContent()).includes('0–2 viewers'))
    throw Error('Missing truthful threshold policy');
  const retired = await f.runtime.state.getKeeperRegistry();
  if (
    retired.send.status !== 'expired-handoff' ||
    retired.holderId !== HOME ||
    (await f.runtime.state.getPublicJourney()).rings !== 0
  )
    throw Error('Automatic confirmed recovery proof failed');
  checks.push({
    name: 'SIMULATOR authenticated status retires only proved ended confirmed handoff without a POST',
    passed: true,
  });
  stage = 'post-expiry-send';
  f.advance();
  const send = await f.control(HOME, `send:${OTHER}`);
  if (JSON.parse(send.body).status !== 'accepted') throw Error('mock send blocked');
  stage = 'verified-raid';
  f.advance();
  await f.raid(HOME, OTHER, 2);
  stage = 't1-votes-ack';
  await f.chat(HOME, HOME, '!offer');
  await f.chat(OTHER, OTHER, '!accept');
  for (const host of [HOME, OTHER]) {
    const doc = await f.runtime.state.getPrivateClaimAcks(host);
    if (doc.rows.filter((r) => r.status === 'sent').length !== (host === HOME ? 2 : 1))
      throw Error('mock ACK not sent');
  }
  if (
    (await f.runtime.state.getPublicJourney()).rings !== 1 ||
    f.calls.filter((c) => c.url.endsWith('/chat/messages')).length !== 3
  )
    throw Error('Mocked T1/ACK failed');
  // #account exists in initial HTML: it cannot prove the async status fetch rendered.
  // Arm status BEFORE navigation, then assert both response and committed DOM.
  const statusReload = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/control/${HOME}/status` && r.request().method() === 'GET',
  );
  stage = 'reload-html';
  const html = await page.reload();
  if (html?.status() !== 200) throw Error('control html failed');
  stage = 'reload-status-code';
  const response = await statusReload;
  reloadDiagnostic.status = response.status();
  if (response.status() !== 200) failReload('http-status');
  stage = 'reload-status-body';
  let privateValue;
  try {
    await response.finished();
    privateValue = await response.json();
  } catch (error) {
    if (error?.name === 'SyntaxError') failReload('invalid-json-syntax');
    // Chromium may discard the CDP body after the streaming page consumer.
    // Validate a clone of THAT reload fetch inside the page, never a second GET.
    stage = 'reload-status-browser-clone';
    await page.waitForFunction(() => Boolean(window.__claimStatus));
    const proof = await page.evaluate(() => window.__claimStatus);
    if (!proof || proof.bodyError)
      failReload(proof?.bodyError === 'syntax' ? 'invalid-json-syntax' : 'body-unavailable');
    reloadDiagnostic.status = proof.status;
    reloadDiagnostic.holderMatches = proof.holderMatches;
    reloadDiagnostic.intentNull = proof.intentNull;
    reloadDiagnostic.finalized = proof.finalized;
    if (proof.status !== 200) failReload('http-status');
    privateValue = {
      pilot: {
        holder: proof.holderMatches ? OTHER : null,
        intent: proof.intentNull ? null : 'present',
        claimProgress: { finalized: proof.finalized },
      },
    };
  }
  if (!privateValue || typeof privateValue.pilot !== 'object' || !privateValue.pilot)
    failReload('missing-pilot');
  reloadDiagnostic.holderMatches = privateValue.pilot.holder === OTHER;
  reloadDiagnostic.intentNull = privateValue.pilot.intent === null;
  reloadDiagnostic.finalized = privateValue.pilot.claimProgress?.finalized === true;
  stage = 'reload-status-holder';
  if (!reloadDiagnostic.holderMatches) failReload('holder-mismatch');
  stage = 'reload-status-intent';
  if (!reloadDiagnostic.intentNull) failReload('intent-not-null');
  stage = 'reload-status-finalized';
  if (!reloadDiagnostic.finalized) failReload('not-finalized');
  stage = 'reload-dom';
  await page.locator('#account').filter({ hasText: 'Keeper control' }).waitFor();
  await page.waitForFunction((other) => {
    const fields = Object.fromEntries(
      [...document.querySelectorAll('#ledger dt')].map((dt) => [
        dt.textContent,
        dt.nextElementSibling?.textContent,
      ]),
    );
    try {
      return (
        JSON.parse(fields.holder) === other &&
        JSON.parse(fields.intent) === null &&
        JSON.parse(fields.claimProgress).finalized === true
      );
    } catch {
      return false;
    }
  }, OTHER);
  if (pageErrors.length) throw Error('control page error');
  stage = 'simulator-label';
  await page.evaluate(() => {
    const label = document.createElement('p');
    label.textContent = 'SIMULATOR · LOCAL MOCK ONLY · NO REAL CHAT/RAID';
    document.body.prepend(label);
    document.title = 'SIMULATOR claims';
  });
  // Functional hotfix gate only: no screenshot capture or visual-proof assertion.
  checks.push({
    name: 'SIMULATOR T1 two-account claim, three SENT ACKs including both completion channels and postclaim control response/DOM',
    passed: true,
  });
  stage = 'complete';
} catch (error) {
  failure = true;
  failureCategory = ['EPERM', 'EADDRINUSE', 'ENOENT'].includes(error?.code)
    ? error.code
    : pageErrors.length
      ? 'page-error'
      : error?.name === 'TimeoutError'
        ? 'timeout'
        : 'assertion-or-browser';
} finally {
  await browser?.close().catch(() => {});
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await tls?.cleanup();
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/claims-browser-results.json',
    JSON.stringify(
      {
        simulator: true,
        passed: !failure,
        stage,
        failureCategory,
        reloadDiagnostic,
        safeGets,
        pageErrors,
        checks,
        captures: [],
        screenshotCapture: false,
      },
      null,
      2,
    ),
  );
}
if (failure) {
  console.log(JSON.stringify({ stage, failureCategory, reloadDiagnostic, safeGets, pageErrors }));
  process.exitCode = 1;
}
