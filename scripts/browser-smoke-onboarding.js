// Local signed/mock OAuth only. Never follows a real login or control URL.
import assert from 'node:assert/strict';
import { mkdir, writeFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
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
const axeResults = {
  status: process.env.FRONTDOOR_AXE === '1' ? 'pending' : 'not-run',
  version: null,
  scans: [],
};
let axeSource;
async function scanFrontdoor(page, name) {
  if (process.env.FRONTDOOR_AXE !== '1') return;
  stage = 'frontdoor-axe-' + name;
  if (axeSource === undefined) {
    // Trusted parent-mounted public tool only; never search the host or fetch an engine.
    const file = await open('/qa-tools/axe.min.js', constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const meta = await file.stat();
      assert.ok(meta.isFile() && meta.size === 652140);
      const bytes = await file.readFile();
      assert.equal(bytes.length, 652140);
      assert.equal(
        createHash('sha256').update(bytes).digest('hex'),
        '20c09fe157a8a34a30e241aaa1fcdade657734f08ab379ecfbeb7d45cc46e878',
      );
      axeSource = bytes.toString('utf8');
    } finally {
      await file.close();
    }
  }
  const session = await page.context().newCDPSession(page);
  try {
    const injected = await session.send('Runtime.evaluate', {
      expression: axeSource,
      returnByValue: true,
    });
    assert.equal(Boolean(injected.exceptionDetails), false);
  } finally {
    await session.detach();
  }
  const result = await page.evaluate(async () => {
    if (globalThis.axe?.version !== '4.14.0')
      return { version: globalThis.axe?.version ?? 'missing' };
    const v = await globalThis.axe.run(document); // All default rules; no excludes or disabled checks.
    const target = (s) =>
      typeof s === 'string' && s.length <= 160 && !/[<>\u0000-\u001f]/.test(s)
        ? s
        : '[bounded selector unavailable]';
    return {
      version: globalThis.axe.version,
      violations: v.violations.length,
      serious: v.violations.filter((r) => r.impact === 'serious').length,
      critical: v.violations.filter((r) => r.impact === 'critical').length,
      passes: v.passes.length,
      incomplete: v.incomplete.length,
      inapplicable: v.inapplicable.length,
      rules: v.violations.slice(0, 8).map((r) => ({
        id: /^[a-z0-9-]{1,80}$/.test(r.id) ? r.id : 'other',
        impact: ['minor', 'moderate', 'serious', 'critical'].includes(r.impact)
          ? r.impact
          : 'unknown',
        nodeCount: r.nodes.length,
        targets: r.nodes.slice(0, 2).map((n) => n.target.slice(0, 2).map(target)),
      })),
      ruleDetailsTruncated: v.violations.length > 8,
    };
  });
  assert.equal(result.version, '4.14.0');
  axeResults.version = result.version;
  axeResults.scans.push({ name, ...result });
  axeResults.status = result.serious || result.critical ? 'failed' : 'running';
  assert.equal(result.serious, 0);
  assert.equal(result.critical, 0);
}
async function captureFrontdoor(page, viewport) {
  if (process.env.FRONTDOOR_CAPTURE !== '1') return;
  stage = 'frontdoor-capture-' + viewport.width;
  await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.waitForFunction(() => scrollX === 0 && scrollY === 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const root = document.querySelector('#atlas-relic'),
      image = root?.querySelector(':scope > img');
    const canvas = root?.querySelector('canvas.relic3d');
    return (
      image?.complete &&
      image.naturalWidth > 0 &&
      (matchMedia('(prefers-reduced-motion: reduce)').matches
        ? Number(getComputedStyle(image).opacity) === 1
        : canvas &&
          Number(canvas.dataset.frames) > 0 &&
          Number(getComputedStyle(canvas).opacity) === 1 &&
          Number(getComputedStyle(image).opacity) === 0)
    );
  });
  const read = () =>
    page.evaluate(() => {
      const r = document.querySelector('#atlas-relic').getBoundingClientRect();
      return {
        width: innerWidth,
        height: innerHeight,
        scrollX,
        scrollY,
        heroX: r.x,
        heroY: r.y,
        heroWidth: r.width,
        heroHeight: r.height,
      };
    });
  const before = await read();
  assert.equal(before.width, viewport.width);
  assert.equal(before.height, viewport.height);
  const names =
    viewport.width === 1920
      ? [
          ['frontdoor-desktop-top', { x: 0, y: 0, width: 1920, height: 540 }],
          ['frontdoor-desktop-bottom', { x: 0, y: 540, width: 1920, height: 540 }],
        ]
      : [['frontdoor-mobile', null]];
  for (const [name, clip] of names) {
    assert.ok(captures.size < 6 && !captures.has(name));
    const width = clip?.width ?? viewport.width,
      height = clip?.height ?? viewport.height;
    assert.ok(width * height * 4 <= 4 * 1024 * 1024);
    const bytes = await page.screenshot({ fullPage: false, ...(clip ? { clip } : {}) });
    assert.ok(bytes.length <= 524288);
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.equal(bytes.readUInt32BE(16), width);
    assert.equal(bytes.readUInt32BE(20), height);
    assert.ok(
      [...captures.values()].reduce((n, b) => n + b.length, bytes.length) <= 4 * 1024 * 1024,
    );
    assert.deepEqual(page.viewportSize(), viewport);
    assert.deepEqual(await read(), before);
    captures.set(name, bytes);
    captureCoverage.push({
      name,
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      clipX: clip?.x ?? 0,
      clipY: clip?.y ?? 0,
      width,
      height,
      bytes: bytes.length,
    });
  }
}

// Optional evidence of this actual authenticated mock DOM, never a dispatch.
async function captureControl(page) {
  if (process.env.CONTROL_CAPTURE !== '1') return;
  const savedViewport = page.viewportSize();
  const steps = {
    'connect-step': 'Connect',
    'setup-step': 'Set up channel',
    'overlay-step': 'Add overlay',
    'send-step': 'Send Off',
  };
  const saved = await page.evaluate(() => ({
    step: [...document.querySelectorAll('#first-run > details')].find((n) => n.open)?.id,
    advanced: document.querySelector('#control-advanced').open,
    x: scrollX,
    y: scrollY,
  }));
  assert.ok(Object.hasOwn(steps, saved.step));
  try {
    if (saved.advanced) await page.locator('#control-advanced > summary').click();
    await page.getByRole('link', { name: 'Send Off', exact: true }).click();
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      stage = 'control-capture-' + viewport.width;
      await page.setViewportSize(viewport);
      await page.waitForFunction(
        () =>
          !document.querySelector('#refresh').disabled &&
          document.querySelector('#first-session').dataset.state === 'ready' &&
          document.querySelector('#send-step').open,
      );
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: 'instant' }));
      await page.waitForFunction(() => scrollX === 0 && scrollY === 0);
      const read = () =>
        page.evaluate(() => ({ width: innerWidth, height: innerHeight, x: scrollX, y: scrollY }));
      const before = await read();
      assert.deepEqual(before, { width: viewport.width, height: viewport.height, x: 0, y: 0 });
      assert.equal(await page.locator('#first-run > details > summary').count(), 4);
      assert.equal(await page.locator('#send-result').isVisible(), true);
      const clips =
        viewport.width === 1280
          ? [
              ['control-desktop-top', { x: 0, y: 0, width: 1280, height: 450 }],
              ['control-desktop-bottom', { x: 0, y: 450, width: 1280, height: 450 }],
            ]
          : [['control-mobile', null]];
      for (const [name, clip] of clips) {
        assert.ok(captures.size < 6 && !captures.has(name));
        const width = clip?.width ?? viewport.width,
          height = clip?.height ?? viewport.height;
        assert.ok(width * height * 4 <= 4 * 1024 * 1024);
        const bytes = await page.screenshot({ fullPage: false, ...(clip ? { clip } : {}) });
        assert.ok(bytes.length <= 524288);
        assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
        assert.equal(bytes.readUInt32BE(16), width);
        assert.equal(bytes.readUInt32BE(20), height);
        assert.ok(
          [...captures.values()].reduce((n, b) => n + b.length, bytes.length) <= 4 * 1024 * 1024,
        );
        assert.deepEqual(page.viewportSize(), viewport);
        assert.deepEqual(await read(), before);
        captures.set(name, bytes);
        captureCoverage.push({
          name,
          viewportWidth: viewport.width,
          viewportHeight: viewport.height,
          clipX: clip?.x ?? 0,
          clipY: clip?.y ?? 0,
          width,
          height,
          bytes: bytes.length,
        });
      }
    }
  } finally {
    await page.setViewportSize(savedViewport);
    await page.getByRole('link', { name: steps[saved.step], exact: true }).click();
    if (saved.advanced) await page.locator('#control-advanced > summary').click();
    await page.evaluate(({ x, y }) => scrollTo({ left: x, top: y, behavior: 'instant' }), saved);
    assert.deepEqual(page.viewportSize(), savedViewport);
    assert.equal(await page.locator('#' + saved.step).evaluate((n) => n.open), true);
    assert.equal(await page.locator('#control-advanced').evaluate((n) => n.open), saved.advanced);
  }
}

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
  stage = 'frontdoor-layout';
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(origin + '/');
    await page.evaluate(() => document.fonts.ready);
    await page.getByRole('heading', { name: 'Raids that leave a story.', exact: true }).waitFor();
    await page.waitForFunction(
      () => document.querySelector('#ledger-details').open === innerWidth >= 600,
    );
    const proof = await page.evaluate(() => {
      const rect = (selector) => {
        const b = document.querySelector(selector).getBoundingClientRect();
        return { top: b.top, bottom: b.bottom, width: b.width, height: b.height };
      };
      return {
        primary: rect('.hero-actions .primary-cta'),
        secondary: rect('.hero-actions .secondary-cta'),
        hero: rect('#atlas-relic'),
        sticky: rect('.mobile-cta'),
        scrollWidth: document.documentElement.scrollWidth,
        viewport: innerWidth,
        height: document.documentElement.scrollHeight,
        ledgerOpen: document.querySelector('#ledger-details').open,
        font: getComputedStyle(document.querySelector('h1')).fontFamily,
        bodyFont: parseFloat(getComputedStyle(document.body).fontSize),
        verification: document.querySelectorAll('#how-we-verify').length,
        isoVisible: /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(document.body.innerText),
      };
    });
    diagnostic.frontdoorWidth = viewport.width;
    diagnostic.frontdoorHeight = proof.height;
    diagnostic.primaryBottom = Math.ceil(proof.primary.bottom);
    assert.ok(proof.primary.top >= 0 && proof.primary.bottom <= viewport.height);
    assert.ok(proof.scrollWidth <= proof.viewport);
    assert.match(proof.font, /Cinzel/);
    assert.ok(proof.bodyFont >= 15);
    assert.equal(proof.verification, 1);
    assert.equal(proof.isoVisible, false);
    if (viewport.width === 1920) {
      assert.ok(proof.secondary.bottom <= viewport.height);
      assert.ok(proof.hero.top >= 0 && proof.hero.bottom <= viewport.height);
      assert.ok(proof.hero.width >= 440);
    } else {
      assert.equal(proof.ledgerOpen, false);
      assert.ok(proof.height <= 4500);
      assert.ok(proof.hero.width >= viewport.width * 0.6);
      assert.equal(proof.sticky.height, 56);
      assert.equal(proof.sticky.bottom, viewport.height);
    }
    assert.equal(
      await page.locator('.hero-actions .primary-cta').getAttribute('href'),
      '/demo/judge',
    );
    assert.equal(await page.locator('.hero-actions .secondary-cta').getAttribute('href'), '/start');
    await scanFrontdoor(page, viewport.width === 1920 ? 'landing-desktop' : 'landing-mobile');
    await captureFrontdoor(page, viewport);
    await page.keyboard.press('Tab');
    assert.ok(
      await page.evaluate(() => {
        const n = document.activeElement,
          s = getComputedStyle(n);
        return n !== document.body && s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2;
      }),
    );
  }
  assert.equal(f.calls.length, 0);
  checks.push({
    name: 'Front door actual1920/390 rectangles: above-fold actions/relic, mobile56px safe-area bar, collapsed ledger, bounded height, named navigation and no visible ISO',
    passed: true,
  });
  stage = 'public-guide';
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/start');
  assert.equal(f.calls.length, 0);
  assert.equal(await page.locator('select').count(), 0);
  assert.match(await page.locator('h1').evaluate((n) => getComputedStyle(n).fontFamily), /Cinzel/);
  await page.evaluate(() => document.fonts.ready);
  await scanFrontdoor(page, 'start-default');
  assert.equal(await page.locator('#start-channel').inputValue(), '');
  assert.equal(await page.locator('#start-connect').getAttribute('href'), '/oauth/keeper/start');
  assert.notEqual(await page.locator('#start-connect').getAttribute('aria-disabled'), 'true');
  await page.locator('#start-channel').fill('olsols2');
  assert.equal(await page.locator('#start-connect').getAttribute('href'), '/oauth/keeper/start');
  assert.match(await page.locator('#start-status').innerText(), /not verified ready/);
  await scanFrontdoor(page, 'start-configured');
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
  await page.locator('#start-channel').fill('not_admitted_dummy');
  assert.equal(await page.locator('#start-connect').getAttribute('href'), '/oauth/keeper/start');
  assert.equal(await page.locator('#start-copy').isDisabled(), true);
  assert.match(await page.locator('#start-status').innerText(), /not admitted yet/);
  await scanFrontdoor(page, 'start-invitation');
  if (process.env.FRONTDOOR_AXE === '1') {
    assert.equal(axeResults.scans.length, 5);
    axeResults.status = 'complete';
  }
  // Private-control stale-tick assertions retain their virtual-clock contract.
  await page.clock.install();
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
  let controlReads = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'GET' &&
      /^\/control\/\d+\/status$/.test(new URL(request.url()).pathname)
    )
      controlReads++;
  });
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
  await page.getByRole('link', { name: 'Set up channel', exact: true }).click();
  await page.locator('#control-advanced > summary').click();
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
  await page.getByRole('link', { name: 'Set up channel', exact: true }).click();
  assert.equal(await page.locator('#first-optin').getAttribute('data-state'), 'unknown');
  assert.equal(await page.locator('#first-subscriptions').getAttribute('data-state'), 'unknown');
  assert.equal(await page.locator('#first-obs-confirm').isChecked(), false);
  assert.equal(f.subscriptions.length, baselineSubscriptions);
  assert.equal(await page.locator('#setup-primary > button').count(), 1);
  assert.equal(await page.locator('#setup-primary > button').getAttribute('id'), 'first-bootstrap');
  assert.equal(await page.locator('#setup-utilities').evaluate((n) => n.open), false);
  assert.equal(await page.locator('#first-keep').isVisible(), false);
  assert.equal(await page.locator('#copy-mod').isVisible(), false);
  const beforeFix = f.calls.length;
  const beforeFixChannel = await f.runtime.state.getStreamStatus(OTHER);
  assert.equal(
    await page.locator('#light-subscriptions-fix').getAttribute('href'),
    '#first-bootstrap',
  );
  assert.equal(
    await page.locator('#light-subscriptions-fix').getAttribute('aria-describedby'),
    'light-subscriptions-reason',
  );
  await page.locator('#light-subscriptions-fix').click();
  assert.equal(
    await page.locator('#first-bootstrap').evaluate((n) => n === document.activeElement),
    true,
  );
  assert.equal(f.calls.length, beforeFix, 'Fix navigation must not dispatch setup');
  assert.deepEqual(await f.runtime.state.getStreamStatus(OTHER), beforeFixChannel);
  for (const key of ['bot', 'subscriptions', 'live']) {
    assert.equal(
      await page.locator(`#light-${key}`).getAttribute('aria-describedby'),
      `light-${key}-reason`,
    );
    assert.ok((await page.locator(`#light-${key}-reason`).textContent()).trim().length > 0);
    assert.equal(await page.locator(`#light-${key}-fix`).count(), 1);
  }
  const pendingReadCount = controlReads,
    callsBeforePending = f.calls.length;
  const pendingPoll = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/control/${OTHER}/status` && r.request().method() === 'GET',
  );
  await page.clock.runFor(5001);
  await pendingPoll;
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(controlReads, pendingReadCount + 1);
  assert.equal(f.calls.length, callsBeforePending, 'Pending GET cannot call the provider');
  async function action(id) {
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => new URL(r.url()).pathname === '/control/' + OTHER && r.request().method() === 'POST',
      ),
      page.locator('#' + id).click(),
    ]);
    assert.equal(response.status(), 200);
    const expected = {
      'first-bootstrap': 'bootstrap',
      'first-keep': 'keep',
      'first-seek': 'seek-on',
    };
    assert.equal(response.request().postDataJSON().action, expected[id]);
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
  assert.equal(await page.locator('#setup-primary > button').getAttribute('id'), 'first-keep');
  assert.equal(await page.locator('#first-bootstrap').isVisible(), false);
  assert.equal(
    await page.locator('#first-keep').evaluate((n) => document.activeElement === n),
    true,
  );
  assert.equal(await page.locator('#light-subscriptions-fix').isVisible(), false);
  stage = 'explicit-opt-in';
  await action('first-keep');
  await page.waitForFunction(
    () => document.querySelector('#first-optin').dataset.state === 'ready',
  );
  assert.notEqual((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
  assert.equal(await page.locator('#setup-primary > button').getAttribute('id'), 'first-bootstrap');
  assert.equal(await page.locator('#first-keep').isVisible(), false);
  await page.getByRole('link', { name: 'Add overlay', exact: true }).click();
  assert.equal(
    await page.locator('#overlay-primary > button').getAttribute('id'),
    'first-obs-copy',
  );
  assert.equal(await page.locator('#overlay-utilities').evaluate((n) => n.open), false);
  assert.equal(await page.locator('#first-obs-confirm').isVisible(), false);
  const beforeOverlay = f.calls.length;
  const beforeOverlayChannel = await f.runtime.state.getStreamStatus(OTHER);
  await page.locator('#first-obs-copy').click();
  assert.match(await page.locator('#first-copy-status').innerText(), /URL copied/);
  assert.equal(await page.locator('#first-obs').getAttribute('data-state'), 'unknown');
  assert.equal(
    await page.locator('#overlay-primary > label').getAttribute('id'),
    'first-obs-check',
  );
  assert.equal(await page.locator('#first-obs-copy').isVisible(), false);
  assert.equal(await page.locator('#first-obs-confirm').isChecked(), false);
  assert.equal(
    await page.locator('#first-obs-confirm').evaluate((n) => document.activeElement === n),
    true,
  );
  await page.locator('#first-obs-confirm').check();
  assert.equal(await page.locator('#first-obs').getAttribute('data-state'), 'ready');
  assert.equal(
    await page.locator('#overlay-primary > button').getAttribute('id'),
    'first-obs-copy',
  );
  assert.equal(f.calls.length, beforeOverlay, 'Clipboard/manual OBS actions cannot call providers');
  assert.deepEqual(await f.runtime.state.getStreamStatus(OTHER), beforeOverlayChannel);
  stage = 'explicit-seeker';
  assert.equal((await f.runtime.state.getKeeperRegistry()).holderId, HOME);
  assert.equal(await page.locator('#first-seek').isDisabled(), false);
  await page.locator('#control-advanced > summary').click();
  await action('first-seek');
  await page.waitForFunction(() =>
    document.querySelector('#first-queue').textContent.startsWith('Explicit Seeker'),
  );
  assert.equal((await f.runtime.state.getStreamStatus(OTHER)).seeking, true);
  stage = 'checklist-width';
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    const wizardGeometry = await page.locator('.wizard-steps > li').evaluateAll((items) => {
      const rows = items.map((n) => {
        const box = n.getBoundingClientRect(),
          link = n.querySelector('a').getBoundingClientRect();
        return {
          x: box.x,
          y: box.y,
          right: box.right,
          bottom: box.bottom,
          containsLink: link.left >= box.left && link.right <= box.right,
          markerInside: getComputedStyle(n).listStylePosition === 'inside',
        };
      });
      let overlaps = 0;
      for (let i = 0; i < rows.length; i++)
        for (let j = i + 1; j < rows.length; j++) {
          const a = rows[i],
            b = rows[j];
          if (
            Math.min(a.right, b.right) > Math.max(a.x, b.x) &&
            Math.min(a.bottom, b.bottom) > Math.max(a.y, b.y)
          )
            overlaps++;
        }
      return {
        count: rows.length,
        containsLinks: rows.every((r) => r.containsLink),
        markersInside: rows.every((r) => r.markerInside),
        overlaps,
      };
    });
    diagnostic.wizardGeometry = { width, ...wizardGeometry };
    assert.deepEqual(wizardGeometry, {
      count: 4,
      containsLinks: true,
      markersInside: true,
      overlaps: 0,
    });
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
  await scanFrontdoor(page, 'control-ready');
  if (process.env.FRONTDOOR_AXE === '1') {
    assert.equal(axeResults.scans.length, 6);
    axeResults.status = 'complete';
  }
  await captureControl(page);
  stage = 'control-local-preview';
  await page.getByRole('link', { name: 'Add overlay', exact: true }).click();
  await page.locator('#overlay-utilities > summary').click();
  const beforePreview = await f.runtime.state.getKeeperRegistry(),
    callsBeforePreview = f.calls.length;
  let previewSockets = 0;
  page.on('websocket', () => previewSockets++);
  await page
    .getByRole('button', { name: '▶ Play test arrival on my overlay', exact: true })
    .click();
  const child = page.frameLocator('#local-overlay-preview');
  await child.locator('body[data-local-preview-ready="true"]').waitFor();
  await child.locator('#simulator').filter({ hasText: 'LOCAL TEST' }).waitFor();
  assert.equal(await child.locator('body').getAttribute('data-connection'), 'local-test');
  assert.equal(previewSockets, 0);
  assert.equal(f.calls.length, callsBeforePreview);
  assert.deepEqual(await f.runtime.state.getKeeperRegistry(), beforePreview);
  checks.push({
    name: 'Own control embeds only a ready LOCAL TEST preview; no provider/game mutation or live read socket',
    passed: true,
  });
  stage = 'control-saved-observation-and-recovery-reasons';
  // Mock only this authenticated read response; no provider fetch or real target lookup.
  const savedStatus = JSON.parse(
    (await f.request(`/control/${OTHER}/status`, 'GET', { cookie: f.cookies[OTHER] })).body,
  );
  const now = await page.evaluate(() => Date.now());
  let observedAt = now - 30000;
  let offlineObservation = false;
  const statusPattern = `**/control/${OTHER}/status`;
  let routeHitCount = 0;
  let pilotHasObservation = false;
  let controlRoomMatches = false;
  const mockStatus = async (route) => {
    routeHitCount++;
    const value = {
      ...savedStatus,
      pilot: {
        ...savedStatus.pilot,
        online: offlineObservation ? false : savedStatus.pilot.online,
        candidates: [],
        candidatesObservedAt: observedAt,
        statusReadAt: now,
      },
    };
    pilotHasObservation = Number.isSafeInteger(value.pilot.candidatesObservedAt);
    controlRoomMatches =
      value.keeperId === OTHER &&
      new URL(route.request().url()).pathname === `/control/${OTHER}/status`;
    await route.fulfill({
      status: 200,
      headers: { 'x-local-observation-fixture': 'saved' },
      json: value,
    });
  };
  async function recordObservationDiagnostic() {
    const labels = await page.evaluate(() => {
      const target = document.querySelector('#target-observation-age').textContent;
      const read = document.querySelector('#first-freshness').textContent;
      const age = (text, pattern) => {
        const match = pattern.exec(text);
        const value = match ? Number(match[1]) : -1;
        return Number.isSafeInteger(value) && value >= 0 ? value : -1;
      };
      return {
        actualObservationAge: age(target, /observation: (\d+) s ago/),
        actualReadAge: age(read, /Status read (\d+) s ago/),
        targetLabelCategory: target.startsWith('Saved target observation:')
          ? 'read'
          : target.startsWith('Targets: not observed.')
            ? 'unknown'
            : 'unavailable',
        readLabelCategory: read.startsWith('Status read ')
          ? 'read'
          : read.startsWith('Sign in ')
            ? 'unknown'
            : 'unavailable',
      };
    });
    diagnostic.observation = {
      ...labels,
      routeHitCount,
      pilotHasObservation,
      controlRoomMatches,
      expectedDelta: 30000,
    };
    return labels;
  }
  async function refreshMockObservation() {
    const response = page.waitForResponse(
      (value) =>
        new URL(value.url()).pathname === `/control/${OTHER}/status` &&
        value.request().method() === 'GET' &&
        value.headers()['x-local-observation-fixture'] === 'saved',
    );
    await page.locator('#refresh').click();
    assert.equal((await response).status(), 200);
    await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  }
  await page.route(statusPattern, mockStatus);
  const callsBeforeAge = f.calls.length;
  await refreshMockObservation();
  try {
    // An enabled refresh button alone does not identify which response rendered.
    await page.waitForFunction(() => {
      const target = document.querySelector('#target-observation-age').textContent;
      const read = document.querySelector('#first-freshness').textContent;
      const observation = /observation: (\d+) s ago/.exec(target);
      const status = /Status read (\d+) s ago/.exec(read);
      return (
        observation &&
        status &&
        Number(observation[1]) >= 30 &&
        Number(observation[1]) > Number(status[1])
      );
    });
  } finally {
    await recordObservationDiagnostic();
  }
  const initialObservationAge = diagnostic.observation.actualObservationAge;
  const initialReadAge = diagnostic.observation.actualReadAge;
  assert.ok(routeHitCount > 0 && pilotHasObservation && controlRoomMatches);
  assert.ok(initialObservationAge >= 30 && initialObservationAge > initialReadAge);
  await page.getByRole('link', { name: 'Send Off', exact: true }).click();
  const emptyText = await page.locator('#target-empty').innerText();
  assert.match(emptyText, /raidrelichq, olsols2 and olsols3/);
  assert.match(emptyText, /live and explicitly opted in/);
  assert.match(emptyText, /admission invitation/);
  assert.equal(await page.locator('#raid button').count(), 0);
  assert.equal(
    await page
      .locator('#advanced-send-actions button')
      .filter({ hasText: 'Process queued own send' })
      .count(),
    1,
  );
  await page.clock.runFor(11000);
  const laterObservationAge = Number(
    (await page.locator('#target-observation-age').textContent()).match(
      /observation: (\d+) s ago/,
    )?.[1],
  );
  assert.ok(laterObservationAge >= initialObservationAge + 11);
  assert.equal(await page.locator('#first-optin').getAttribute('data-state'), 'ready');
  observedAt = null;
  await refreshMockObservation();
  try {
    await page.waitForFunction(() =>
      document
        .querySelector('#target-observation-age')
        .textContent.startsWith('Targets: not observed.'),
    );
  } finally {
    await recordObservationDiagnostic();
  }
  assert.match(
    await page.locator('#target-observation-age').textContent(),
    /Targets: not observed/,
  );
  const refreshedReadAge = Number(
    (await page.locator('#first-freshness').textContent()).match(/Status read (\d+) s ago/)?.[1],
  );
  assert.ok(refreshedReadAge < initialObservationAge);
  assert.equal(f.calls.length, callsBeforeAge, 'Observation labels and GET mocks cannot reconcile');
  assert.equal(await page.locator('#cancel-queued').isDisabled(), true);
  assert.equal(
    await page.locator('#cancel-queued').getAttribute('aria-describedby'),
    'recovery-status recovery-disabled-reason',
  );
  assert.match(
    await page.locator('#recovery-disabled-reason').textContent(),
    /No cancellable never-dispatched queue/,
  );
  assert.equal(await page.locator('#expire-handoff').isDisabled(), true);
  assert.equal(
    await page.locator('#expire-handoff').getAttribute('aria-describedby'),
    'expiry-state expiry-disabled-reason',
  );
  assert.match(
    await page.locator('#expiry-disabled-reason').textContent(),
    /No source-owned ended confirmed handoff/,
  );
  offlineObservation = true;
  await refreshMockObservation();
  try {
    await page.waitForFunction(() =>
      document.querySelector('#light-live-reason').textContent.includes('requires a live stream'),
    );
  } finally {
    await recordObservationDiagnostic();
  }
  assert.match(
    await page.locator('#light-live-reason').textContent(),
    /offline.*requires a live stream/,
  );
  assert.equal(await page.locator('#light-live-fix').getAttribute('href'), '#first-bootstrap');
  await page.locator('#light-live-fix').click();
  assert.equal(await page.locator('#setup-step').evaluate((n) => n.open), true);
  assert.equal(
    await page.locator('#first-bootstrap').evaluate((n) => document.activeElement === n),
    true,
  );
  assert.equal(
    f.calls.length,
    callsBeforeAge,
    'Offline fix reveals existing Setup without invoking it',
  );
  await page.unroute(statusPattern, mockStatus);
  checks.push({
    name: 'Current-primary transitions preserve explicit consent; light navigation is read-only; saved observation age/null are distinct from GET age and recovery reasons are associated',
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
  // Anchor this cadence check to an actual completed own GET, independent of optional axe/capture duration.
  const cadenceRead = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/control/${OTHER}/status` && r.request().method() === 'GET',
  );
  await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await cadenceRead;
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  const before = f.calls.length,
    idleReadCount = controlReads;
  await page.clock.runFor(11000);
  assert.equal(controlReads, idleReadCount, 'Known idle wizard uses30s, not5s polling');
  assert.equal(await page.locator('#first-optin').getAttribute('data-state'), 'ready');
  assert.match(await page.locator('#first-freshness').innerText(), /Status read \d+ s ago/);
  assert.equal(f.calls.length, before);
  const idlePoll = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === `/control/${OTHER}/status` && r.request().method() === 'GET',
  );
  await page.clock.runFor(19001);
  await idlePoll;
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.equal(controlReads, idleReadCount + 1);
  assert.equal(f.calls.length, before, 'Idle GET cannot rotate grants or reconcile');
  f.advance(12 * 3600000 + 1);
  await page.locator('#refresh').click();
  await page.waitForFunction(() =>
    document.querySelector('#result').textContent.includes('expired or unauthorized'),
  );
  assert.equal(await page.locator('#first-session').getAttribute('data-state'), 'unknown');
  assert.equal(await page.locator('#first-keep').isDisabled(), true);
  assert.match(
    await page.locator('#recovery-disabled-reason').textContent(),
    /Sign in.*own saved recovery status/,
  );
  assert.match(
    await page.locator('#expiry-disabled-reason').textContent(),
    /Sign in.*own saved recovery status/,
  );
  for (const key of ['bot', 'subscriptions', 'live']) {
    assert.match(await page.locator(`#light-${key}-reason`).textContent(), /Sign in first/);
    assert.equal(await page.locator(`#light-${key}-fix`).getAttribute('href'), '#reconnect');
  }
  assert.deepEqual(review.stats(), { errors: 0, external: 0 });
  checks.push({
    name: 'Own-room/origin/CSRF boundaries, observed ticks survive ten seconds; read-only polling and expired session still fail closed without game effects',
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
    axeResults,
  });
  assert.ok(Buffer.byteLength(report) <= 65536);
  await writeFile('artifacts/onboarding-browser-results.json', report + '\n');
}
if (!passed) process.exitCode = 1;
