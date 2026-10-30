// Optional host-only LOCAL HTTPS mocked browser gate. Fixed registered5191.
import { createServer } from 'node:https';
import assert from 'node:assert/strict';
import { BOT_COPY, claimComplete } from '../public/ritual-copy.js';
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

const claimDiagnostic = {
  claimAckHomeSent: -1,
  claimAckOtherSent: -1,
  chatPostCount: -1,
  arrivalPromptCount: -1,
  completionHomeCount: -1,
  completionOtherCount: -1,
  postReplayChatPosts: -1,
  journeyRings: -1,
  sourceAssertionLine: 0,
};
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
      !document.querySelector('#refresh').disabled &&
      document.querySelector('#ledger').textContent.includes('confirmed'),
  );
  assert.equal(
    (await f.runtime.state.getKeeperRegistry()).send.status,
    'confirmed',
    'GET must not retire the handoff',
  );
  await page.locator('#control-advanced > summary').click();
  const callsBeforeExpiry = f.calls.length;
  await page.getByRole('button', { name: 'Expire ended handoff', exact: true }).click();
  await page.waitForFunction(
    () =>
      !document.querySelector('#refresh').disabled &&
      document.querySelector('#ledger').textContent.includes('expired-handoff'),
  );
  assert.equal(
    f.calls.length,
    callsBeforeExpiry,
    'Explicit app-window expiry cannot call a provider',
  );
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
    throw Error('Explicit confirmed recovery proof failed');
  checks.push({
    name: 'SIMULATOR authenticated explicit expiry retires only proved ended confirmed handoff after a read-only GET without a POST',
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
  await f.chat(HOME, HOME, '!offer', { messageId: 'claims-t1-offer' });
  await f.chat(OTHER, OTHER, '!accept', { messageId: 'claims-t1-accept' });
  // Sender vote ACK, one receiver arrival prompt, then one completion per room.
  const chatPosts = () => f.calls.filter((c) => c.url.endsWith('/chat/messages'));
  const replies = chatPosts().map((c) => JSON.parse(c.body));
  let replayObserved = false;
  const recordClaimDiagnostic = async () => {
    const home = await f.runtime.state.getPrivateClaimAcks(HOME);
    const other = await f.runtime.state.getPrivateClaimAcks(OTHER);
    const posts = chatPosts().map((c) => JSON.parse(c.body));
    claimDiagnostic.claimAckHomeSent = home.rows.filter((r) => r.status === 'sent').length;
    claimDiagnostic.claimAckOtherSent = other.rows.filter((r) => r.status === 'sent').length;
    claimDiagnostic.chatPostCount = posts.length;
    claimDiagnostic.arrivalPromptCount = posts.filter((r) => r.message === BOT_COPY.arrival).length;
    claimDiagnostic.completionHomeCount = home.rows.filter(
      (r) => r.completionReceipt && !r.arrivalReceipt,
    ).length;
    claimDiagnostic.completionOtherCount = other.rows.filter(
      (r) => r.completionReceipt && !r.arrivalReceipt,
    ).length;
    claimDiagnostic.postReplayChatPosts = replayObserved ? posts.length : -1;
    claimDiagnostic.journeyRings = (await f.runtime.state.getPublicJourney()).rings;
  };
  await recordClaimDiagnostic();
  assert.equal(replies.length, 4);
  await recordClaimDiagnostic();
  assert.deepEqual(
    replies.map((r) => ({ host: r.broadcaster_id, sender: r.sender_id, message: r.message })),
    [
      { host: HOME, sender: BOT, message: 'Offers 1/1. Waiting for 1 accept in @olsols2.' },
      { host: OTHER, sender: BOT, message: BOT_COPY.arrival },
      { host: HOME, sender: BOT, message: claimComplete('olsols2') },
      { host: OTHER, sender: BOT, message: claimComplete('olsols2') },
    ],
  );
  await recordClaimDiagnostic();
  assert.deepEqual(
    replies.filter((r) => r.message === BOT_COPY.arrival).map((r) => r.broadcaster_id),
    [OTHER],
  );
  for (const host of [HOME, OTHER]) {
    const doc = await f.runtime.state.getPrivateClaimAcks(host);
    await recordClaimDiagnostic();
    assert.equal(doc.rows.filter((r) => r.status === 'sent').length, 2);
    const arrival = doc.rows.filter((r) => r.arrivalReceipt);
    await recordClaimDiagnostic();
    assert.equal(arrival.length, host === OTHER ? 1 : 0);
    if (host === OTHER) {
      await recordClaimDiagnostic();
      assert.equal(arrival[0].status, 'sent');
      await recordClaimDiagnostic();
      // Dispatch erases payload; exact delivered text is checked on mock POSTs above.
      assert.equal(Object.hasOwn(arrival[0], 'message'), false);
      await recordClaimDiagnostic();
      assert.equal(Object.hasOwn(arrival[0], 'completion'), false);
    }
    const completion = doc.rows.filter((r) => r.completionReceipt && !r.arrivalReceipt);
    await recordClaimDiagnostic();
    assert.equal(completion.length, 1);
    await recordClaimDiagnostic();
    assert.equal(completion[0].status, 'sent');
    await recordClaimDiagnostic();
    assert.equal(Object.hasOwn(completion[0], 'message'), false);
    await recordClaimDiagnostic();
    assert.equal(Object.hasOwn(completion[0], 'completion'), false);
  }
  await recordClaimDiagnostic();
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
  await f.chat(HOME, HOME, '!offer', { messageId: 'claims-t1-offer' });
  await f.chat(OTHER, OTHER, '!accept', { messageId: 'claims-t1-accept' });
  replayObserved = true;
  await recordClaimDiagnostic();
  assert.equal(
    chatPosts().length,
    4,
    'replayed votes cannot repeat arrival or completion delivery',
  );
  await recordClaimDiagnostic();
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
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
    name: 'SIMULATOR T1 two-account claim, four SENT notices: sender ACK, single receiver prompt and both completion channels and postclaim control response/DOM',
    passed: true,
  });
  stage = 'complete';
} catch (error) {
  failure = true;
  const assertionLine = /browser-smoke-claims\.js:(\d+):\d+/.exec(error?.stack ?? '');
  claimDiagnostic.sourceAssertionLine = assertionLine ? Number(assertionLine[1]) : 0;
  failureCategory = ['EPERM', 'EADDRINUSE', 'ENOENT'].includes(error?.code)
    ? error.code
    : pageErrors.length
      ? 'page-error'
      : error?.name === 'TimeoutError'
        ? 'timeout'
        : error?.name === 'AssertionError'
          ? 'assertion-error'
          : error?.name === 'ProtocolError'
            ? 'protocol-error'
            : error?.name === 'TypeError'
              ? 'type-error'
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
        claimDiagnostic,
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
  console.log(
    JSON.stringify({
      stage,
      failureCategory,
      claimDiagnostic,
      reloadDiagnostic,
      safeGets,
      pageErrors,
    }),
  );
  process.exitCode = 1;
}
