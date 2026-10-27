// Local signed/mock OAuth only. Never follows a real login or control URL.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { visualReview } from '../test-support/visual-review.js';
import { BOT, OTHER, HOME } from '../test-support/pilot-fixture.js';
import { capturePage } from '../test-support/capture-page.js';
let review,
  stage = 'setup',
  passed = false,
  failureCategory = null;
const checks = [],
  diagnostic = {},
  captures = new Map(),
  captureCoverage = [];
try {
  review = await visualReview({ seekers: true });
  const { page, context, fixture: f, origin } = review;
  await context.addInitScript(() => {
    window.__onboardCopies = [];
    window.__copyDenied = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value) => {
          if (window.__copyDenied) throw Error('denied');
          window.__onboardCopies.push(value);
        },
      },
    });
  });
  await page.clock.install();
  stage = 'public-guide';
  await page.goto(origin + '/start');
  assert.equal(f.calls.length, 0);
  await page.locator('#start-channel').selectOption(OTHER);
  const canonical = 'https://raid-relic-760724762396.us-central1.run.app';
  assert.equal(
    await page.locator('#start-connect').getAttribute('href'),
    canonical + '/oauth/keeper/' + OTHER + '/start',
  );
  assert.match(await page.locator('#start-status').innerText(), /not verified ready/);
  assert.deepEqual(await page.evaluate(() => window.__onboardCopies), []);
  await page.locator('#start-copy').click();
  assert.match(
    await page.locator('#start-copy-status').innerText(),
    /URL copied.*does not prove OBS/,
  );
  assert.equal(await page.locator('#start-confirm').isChecked(), false);
  await page.evaluate(() => {
    window.__copyDenied = true;
  });
  await page.locator('#start-copy').click();
  assert.match(await page.locator('#start-copy-status').innerText(), /Copy failed/);
  assert.equal(await page.locator('#start-confirm').isChecked(), false);
  await page.locator('#start-channel').selectOption('unconfigured');
  assert.equal(await page.locator('#start-connect').getAttribute('href'), null);
  assert.equal(await page.locator('#start-copy').isDisabled(), true);
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }
  assert.equal(f.calls.length, 0);
  if (process.env.ONBOARD_CAPTURE === '1')
    await capturePage(page, 'onboard-guide', captures, captureCoverage);
  checks.push({
    name: 'Public configured pilot guide has no private reads or automatic actions; canonical own links and honest clipboard outcomes',
    passed: true,
  });
  stage = 'existing-network-baseline';
  for (const stream of f.streams.values()) stream.viewer_count = 1;
  await f.login(BOT);
  await f.login(HOME);
  assert.equal((await f.control(HOME, 'bootstrap')).status, 200);
  f.advance();
  assert.equal((await f.control(HOME, 'keep')).status, 200);
  assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
  const baselineSubscriptions = f.subscriptions.length;
  stage = 'holder-cannot-join';
  const [holderCookieName, holderCookieValue] = f.cookies[HOME].split('=');
  await context.addCookies([
    {
      name: holderCookieName,
      value: holderCookieValue,
      url: origin,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    },
  ]);
  await page.goto(origin + '/control/' + HOME);
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  await page.locator('#first-run > summary').click();
  assert.match(await page.locator('#first-queue').innerText(), /You hold the relic/);
  assert.equal(await page.locator('#first-seek').isDisabled(), true);
  assert.notEqual((await f.runtime.state.getStreamStatus(HOME)).seeking, true);

  stage = 'fresh-own-connection';
  assert.ok(!(await f.runtime.store.getToken('keeper:' + OTHER)));
  assert.notEqual((await f.runtime.state.getStreamStatus(OTHER))?.optedIn, true);
  assert.notEqual((await f.runtime.state.getStreamStatus(OTHER))?.seeking, true);
  await f.login(OTHER); // Actual application state-cookie callback against mock transport.
  const [name, value] = f.cookies[OTHER].split('=');
  await context.addCookies([
    { name, value, url: origin, httpOnly: true, secure: true, sameSite: 'Lax' },
  ]);
  await page.goto(origin + '/control/' + OTHER);
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  await page.locator('#first-run > summary').click();
  assert.equal(await page.locator('#first-optin').getAttribute('data-state'), 'unknown');
  assert.equal(await page.locator('#first-subscriptions').getAttribute('data-state'), 'unknown');
  assert.equal(await page.locator('#first-obs-confirm').isChecked(), false);
  assert.equal(f.subscriptions.length, baselineSubscriptions);
  async function action(id) {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/control/' + OTHER && r.request().method() === 'POST',
      ),
      page.locator('#' + id).click(),
    ]);
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  }
  stage = 'explicit-setup';
  await action('first-bootstrap');
  await page.waitForFunction(
    () => document.querySelector('#first-subscriptions').dataset.state === 'ready',
  );
  assert.equal(f.subscriptions.length, baselineSubscriptions + 5);
  assert.equal(f.subscriptions.filter((s) => Object.values(s.condition).includes(OTHER)).length, 5);
  assert.equal((await f.runtime.state.getStreamStatus(OTHER)).optedIn, false);
  stage = 'explicit-opt-in';
  await action('first-keep');
  await page.waitForFunction(
    () => document.querySelector('#first-optin').dataset.state === 'ready',
  );
  assert.notEqual((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
  await page.locator('#first-obs-copy').click();
  assert.match(await page.locator('#first-copy-status').innerText(), /URL copied/);
  assert.equal(await page.locator('#first-obs').getAttribute('data-state'), 'unknown');
  await page.locator('#first-obs-confirm').check();
  assert.equal(await page.locator('#first-obs').getAttribute('data-state'), 'ready');
  stage = 'explicit-seeker';
  assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
  assert.equal(await page.locator('#first-seek').isDisabled(), false);
  await action('first-seek');
  await page.waitForFunction(() =>
    document.querySelector('#first-queue').textContent.startsWith('Explicit Seeker'),
  );
  assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
  stage = 'checklist-width';
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    Object.assign(
      diagnostic,
      await page.evaluate(() => {
        const known = [
          '#first-run',
          '#first-run summary',
          '#first-obs-url',
          '#first-obs-confirm',
          '#first-run label',
          '#first-run .actions',
          '#first-bootstrap',
          '#first-keep',
          '#first-seek',
          '#first-run ol',
          '#first-run li',
          '#first-copy-status',
          '#first-freshness',
          '#first-queue',
          '#keeper-summary',
          '#authorization-status',
          '#ledger',
          '#setup',
          '#keeper',
          '#raid',
          '#p7-consent-url',
          '#intent-confirm',
          'header',
          'main',
          '#result',
          '#p7-setup code',
          '#p7-setup',
          '#ledger dd',
        ];
        let overflowPx = 0,
          offenderCode = 0;
        for (const node of document.querySelectorAll('body *')) {
          const rect = node.getBoundingClientRect();
          const overflow = Math.max(0, rect.right - innerWidth, -rect.left);
          if (overflow > overflowPx) {
            overflowPx = overflow;
            offenderCode = known.findIndex((selector) => node.matches(selector)) + 1;
          }
        }
        let textOverflowPx = 0,
          textOffenderCode = 0,
          textNodesMeasured = 0;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let textNode;
        while (textNodesMeasured < 1024 && (textNode = walker.nextNode())) {
          textNodesMeasured++;
          const range = document.createRange();
          range.selectNodeContents(textNode);
          for (const rect of Array.from(range.getClientRects()).slice(0, 128)) {
            const overflow = Math.max(0, rect.right - innerWidth, -rect.left);
            if (overflow > textOverflowPx) {
              textOverflowPx = overflow;
              let parent = textNode.parentElement;
              textOffenderCode = 0;
              while (parent && !textOffenderCode) {
                textOffenderCode = known.findIndex((selector) => parent.matches(selector)) + 1;
                parent = parent.parentElement;
              }
            }
          }
          range.detach();
        }
        return {
          textOffenderCode,
          textNodesMeasured,
          textOverflowPx: Math.min(10000, Math.ceil(textOverflowPx)),
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          offenderCode,
          overflowPx: Math.min(10000, Math.ceil(overflowPx)),
        };
      }),
    );
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  }

  checks.push({
    name: 'Fresh own account explicitly sets up five subscriptions, opts in, copies/acknowledges OBS and chooses Seeker without a raid',
    passed: true,
  });
  stage = 'boundaries';
  assert.equal(
    (await f.request('/control/' + HOME + '/status', 'GET', { cookie: f.cookies[OTHER] })).status,
    401,
  );
  assert.equal((await f.control(OTHER, 'keep', { origin: 'https://evil.invalid' })).status, 403);
  assert.equal(
    (
      await f.request(
        '/control/' + OTHER,
        'POST',
        { cookie: f.cookies[OTHER], origin, 'content-type': 'application/json' },
        Buffer.from(JSON.stringify({ action: 'keep', csrf: 'bad' })),
      )
    ).status,
    403,
  );
  assert.ok(f.calls.every((c) => !c.url.endsWith('/raids') && !c.url.endsWith('/chat/messages')));
  const before = f.calls.length;
  await page.clock.runFor(11000);
  assert.equal(await page.locator('#first-optin').getAttribute('data-state'), 'unknown');
  assert.match(await page.locator('#first-freshness').innerText(), /Not freshly verified/);
  assert.equal(f.calls.length, before);
  f.advance(12 * 3600000 + 1);
  await page.locator('#refresh').click();
  await page.waitForFunction(() =>
    document.querySelector('#result').textContent.includes('expired or unauthorized'),
  );
  assert.equal(await page.locator('#first-session').getAttribute('data-state'), 'unknown');
  assert.equal(await page.locator('#first-keep').isDisabled(), true);
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  checks.push({
    name: 'Own-room/origin/CSRF boundaries, ten-second stale ticks and expired session fail closed without polling or game effects',
    passed: true,
  });
  for (const b of captures.values()) assert.ok(b.length <= 524288);
  assert.ok(captures.size <= 6);
  assert.ok([...captures.values()].reduce((n, b) => n + b.length, 0) <= 4 * 1024 * 1024);
  passed = true;
} catch (e) {
  failureCategory = ['AssertionError', 'TimeoutError', 'TypeError'].includes(e?.name)
    ? e.name
    : 'browser-or-fixture';
  const line = /browser-smoke-onboarding[.]js:(\d+)/.exec(e?.stack ?? '');
  if (line) diagnostic.assertionLine = Number(line[1]);
  diagnostic.browserErrors = review?.stats().errors ?? 0;
} finally {
  await review?.close();
  await mkdir('artifacts', { recursive: true });
  for (const [name, bytes] of captures) await writeFile('artifacts/' + name + '.png', bytes);
  const report = JSON.stringify({
    passed,
    stage,
    failureCategory,
    checks,
    diagnostic,
    captureCoverage,
  });
  assert.ok(Buffer.byteLength(report) <= 65536);
  await writeFile('artifacts/onboarding-browser-results.json', report + '\n');
}
if (!passed) process.exitCode = 1;
