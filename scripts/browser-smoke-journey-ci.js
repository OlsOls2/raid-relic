// Entire real runtime path, entirely LOCAL signed/mock identities and transport.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReview, growthPixels } from '../test-support/visual-review.js';
import { HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
let review,
  timer,
  stage = 'setup',
  passed = false,
  failureCategory = null;
const checks = [],
  diagnostic = { syntheticFixture: true };
try {
  review = await visualReview({ seekers: true, durable: true });
  const { page, context, fixture: f, origin } = review;
  timer = setTimeout(() => {
    void context.close().catch(() => {});
  }, 140000);
  await context.routeWebSocket('**/*', (r) =>
    new URL(r.url()).origin === origin.replace('https:', 'wss:') ? r.connectToServer() : r.close(),
  );
  await context.addInitScript(() => {
    window.__journeyCard = { approved: false, held: false, simulated: false };
    const draw = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      if (text === 'moon') window.__journeyCard.approved = true;
      if (text === 'private') window.__journeyCard.held = true;
      if (typeof text === 'string' && text.includes('SIMULATOR'))
        window.__journeyCard.simulated = true;
      return draw.call(this, text, ...args);
    };
  });
  stage = 'fixture-streams';
  // Bootstrap's status projection can observe the entire network. Populate
  // BOTH valid provider rows before the first read, as receiving fixtures do;
  // otherwise OTHER's missing count poisons the bounded observation cache.
  for (const id of [HOME, OTHER]) f.streams.get(id).viewer_count = 4;
  for (const id of [BOT, HOME, OTHER]) await f.login(id);
  for (const id of [HOME, OTHER]) {
    await f.control(id, 'bootstrap');
    f.advance();
    await f.control(id, 'keep');
    f.advance();
  }
  await f.chat(HOME, '301', '!mark moon');
  const doc = await f.runtime.state.getPrivateMarks(HOME, { broadcasterId: HOME, chatterId: HOME });
  const moon = doc.sessions.flatMap((s) => s.marks).find((m) => m.text === 'moon');
  assert.ok(moon);
  await f.chat(HOME, HOME, `!relic approve ${moon.id}`);
  await f.chat(HOME, '302', '!mark private');
  stage = 'own-control-preflight';
  const status = await f.request('/control/' + HOME + '/status', 'GET', {
    cookie: f.cookies[HOME],
  });
  diagnostic.controlStatusCode = status.status;
  assert.equal(status.status, 200);
  const own = JSON.parse(status.body);
  const candidate = own.pilot?.candidates?.find((row) => row.id === OTHER);
  diagnostic.candidateCount = own.pilot?.candidates?.length ?? 0;
  diagnostic.targetOnline = Number(candidate?.observedOnline === true);
  diagnostic.targetOptedIn = Number(candidate?.optedIn === true);
  diagnostic.targetEligible = Number(candidate?.eligible === true);
  assert.ok(candidate?.observedOnline && candidate?.optedIn && candidate?.eligible);
  const [name, value] = f.cookies[HOME].split('=');
  await context.addCookies([
    { name, value, url: origin, secure: true, httpOnly: true, sameSite: 'Lax' },
  ]);
  stage = 'own-control-send';
  await page.goto(origin + '/control/' + HOME);
  await page.waitForFunction(
    () =>
      !document.querySelector('#refresh').disabled &&
      document.querySelector('#raid-target').options.length > 0,
  );
  await page.locator('#raid-target').selectOption(OTHER);
  page.once('dialog', (dialog) => {
    void dialog.accept();
  });
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/control/' + HOME && r.request().method() === 'POST',
    ),
    page.getByRole('button', { name: 'Send Off to olsols2', exact: true }).click(),
  ]);
  diagnostic.sendStatusCode = response.status();
  assert.equal(response.status(), 200);
  assert.equal((await response.json()).status, 'accepted');
  assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
  const raids = () => f.calls.filter((c) => c.url.includes('/raids?') && c.method === 'POST');
  assert.equal(raids().length, 1);
  assert.equal(new URL(raids()[0].url).searchParams.get('from_broadcaster_id'), HOME);
  checks.push({
    name: 'Mock OAuth/session/own CSRF control requests one principal-bound Raid POST; acceptance does not transfer',
    passed: true,
  });
  stage = 'signed-arrival';
  const overlay = await context.newPage();
  review.observe(overlay);
  await overlay.setViewportSize({ width: 480, height: 800 });
  await overlay.goto(origin + '/overlay/' + OTHER);
  await overlay.bringToFront();
  await overlay.waitForFunction(() => document.body.dataset.connection === 'connected');
  await f.raid(HOME, OTHER, 4);
  const receipt = (await f.runtime.state.getKeeperRegistry()).pendingHop;
  assert.equal(receipt.verified, true);
  await overlay.waitForFunction(
    () =>
      Number(document.querySelector('.archive')?.dataset.cinematicElapsed) >= 0 &&
      ['streak', 'impact', 'unfurl', 'settled'].includes(
        document.querySelector('.archive')?.dataset.phase,
      ) &&
      Number(document.querySelector('canvas.relic3d')?.dataset.frames) > 0,
  );
  assert.equal(await growthPixels(overlay, async () => {}), true);
  await f.chat(HOME, '101', '!offer', { messageId: 'journey-source-one' });
  await f.chat(OTHER, '201', '!accept', { messageId: 'journey-host-one' });
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 0);
  await overlay.waitForFunction(() =>
    /Offer 1\/2.*Accept 1\/2/.test(document.querySelector('#claim-label').textContent),
  );
  await f.chat(HOME, '102', '!offer', { messageId: 'journey-source-two' });
  await f.chat(OTHER, '202', '!accept', { messageId: 'journey-host-two' });
  const registry = await f.runtime.state.getKeeperRegistry();
  assert.equal(registry.holderId, OTHER);
  assert.equal(registry.pendingHop.arrivalStartedAt, receipt.arrivalStartedAt);
  const journey = await f.runtime.state.getPublicJourney();
  assert.equal(journey.rings, 1);
  assert.ok(journey.stops[0].marks.some((m) => m.text === 'moon'));
  assert.equal(
    journey.stops[0].marks.some((m) => m.text === 'private'),
    false,
  );
  await f.chat(OTHER, '202', '!accept', { messageId: 'journey-host-two' });
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
  for (const host of [HOME, OTHER])
    assert.equal(
      (await f.runtime.state.getPrivateClaimAcks(host)).rows.filter((r) => r.completionReceipt)
        .length,
      1,
    );
  assert.equal(raids().length, 1);
  await overlay.close();
  await page.bringToFront();
  checks.push({
    name: 'HMAC raid opens real local arrival/WSS pixels; distinct two-chat quorum commits one ring and deduplicated notices with approved archive',
    passed: true,
  });
  stage = 'spotlight-replay-export';
  await page.goto(origin + '/keeper/olsols2');
  await page
    .locator('.holder-spotlight h3')
    .filter({ hasText: '@olsols2 holds the relic' })
    .waitFor();
  assert.match(await page.locator('.holder-spotlight').innerText(), /Live.*observed/);
  const projected = JSON.parse((await f.request('/api/receiving')).body);
  assert.equal(projected.holder.login, 'olsols2');
  assert.equal(projected.holder.ringCount, 1);
  await page.goto(origin + '/atlas/');
  await page.locator('#map-play').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('#map-play').disabled);
  await page.locator('#map-play').click();
  assert.equal(await page.locator('#journey-map').getAttribute('data-playing'), 'true');
  await page.getByRole('button', { name: 'Pause replay', exact: true }).click();
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download ring card Stop 1', exact: true }).click(),
  ]);
  assert.equal(download.suggestedFilename(), 'raid-relic-stop-1-olsols2.png');
  const chunks = [];
  let size = 0;
  for await (const bytes of await download.createReadStream()) {
    size += bytes.length;
    assert.ok(size <= 524288);
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks);
  assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(bytes.readUInt32BE(16), 1200);
  assert.equal(bytes.readUInt32BE(20), 630);
  const pixels = await page.evaluate(
    async (raw) => {
      const img = await createImageBitmap(new Blob([Uint8Array.from(raw)], { type: 'image/png' }));
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      const data = x.getImageData(0, 0, c.width, c.height).data;
      let count = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i + 3] && Math.max(data[i], data[i + 1], data[i + 2]) > 80) count++;
      img.close();
      c.width = c.height = 0;
      return count;
    },
    [...bytes],
  );
  assert.ok(pixels > 1000);
  assert.deepEqual(await page.evaluate(() => window.__journeyCard), {
    approved: true,
    held: false,
    simulated: true,
  });
  await download.delete();
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  diagnostic.rings = 1;
  diagnostic.raidPosts = raids().length;
  diagnostic.pngBytes = size;
  checks.push({
    name: 'Actual public Keeper/Atlas/replay and manual decoded simulator PNG carry approved moon, no held word and no extra raid',
    passed: true,
  });
  passed = true;
} catch (e) {
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(e?.name)
    ? e.name
    : 'fixture-or-browser';
  const line = /browser-smoke-journey-ci[.]js:(\d+)/.exec(e?.stack ?? '');
  if (line) diagnostic.assertionLine = Number(line[1]);
  try {
    if (review)
      Object.assign(
        diagnostic,
        await review.page.evaluate(() => ({
          targetOptionCount: document.querySelector('#raid-target')?.options.length ?? 0,
          targetDisabled: Number(document.querySelector('#raid-target')?.disabled === true),
          refreshDisabled: Number(document.querySelector('#refresh')?.disabled === true),
        })),
      );
  } catch {
    diagnostic.domDiagnosticUnavailable = 1;
  }
} finally {
  clearTimeout(timer);
  await review?.close();
  await mkdir('artifacts', { recursive: true });
  const report = JSON.stringify({ passed, stage, failureCategory, checks, diagnostic });
  assert.ok(Buffer.byteLength(report) <= 65536);
  await writeFile('artifacts/journey-ci-browser-results.json', report + '\n');
}
if (!passed) process.exitCode = 1;
