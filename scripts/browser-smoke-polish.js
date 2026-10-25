import { captureTiles, RASTER_LIMIT } from '../test-support/capture-tiles.js';
// Optional host-only visual gate. Fixed registered5191, fresh memory, mocked
// provider transports and synthetic signed events; never cloud/live state.
import { mkdir, writeFile } from 'node:fs/promises';
import { createJudges, JUDGES_ORIGIN } from '../test-support/judges.js';
const judges = await createJudges({ intent: true }); let browser, failure;
const captures = new Map(), checks = [], pages = [], captureCoverage = [];
let stage='startup', captureDiagnostic=null, crashed=false, disconnected=false, closing=false;
const classifyFailure = error => {
  const text=String(error?.message??'');
  const signal=/\b(SIGXFSZ|SIGKILL|SIGSEGV|SIGABRT|SIGBUS)\b/.exec(text)?.[1]??null;
  const code=/(?:exitCode|exit code)[=: ]+(-?\d{1,3})/i.exec(text)?.[1];
  return { category: signal==='SIGXFSZ'?'file-size-limit':/ENOMEM|out of memory/i.test(text)?'memory-limit':/Target.*closed|browser has been closed/i.test(text)?'target-closed':'assertion-or-browser', signal, exitCode:code===undefined?null:Number(code) };
};
const capture = async (page, name, fullPage = true) => {
  if(!/^polish-simulator-[a-z0-9-]+$/.test(name))throw Error('Unknown capture name');
  stage='capture-measure';
  await page.evaluate(() => scrollTo({ top: 0, left: 0, behavior: 'instant' }));
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const dimensions=await page.evaluate(()=>({width:innerWidth,height:innerHeight,documentHeight:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight),documentWidth:Math.max(innerWidth,document.documentElement.scrollWidth)}));
  captureDiagnostic={captureName:name,viewportWidth:dimensions.width,viewportHeight:dimensions.height,documentHeight:dimensions.documentHeight,computedRawBytes:dimensions.documentWidth*dimensions.documentHeight*4};
  if (!fullPage && !(dimensions.width===1920&&dimensions.height===1080)) throw Error('Expected exact1920×1080 Atlas viewport');
  // Only when the measured full raster exceeds the existing file-size bound:
  // preserve all content in overlapping viewport rasters, never raise the cap.
  if(fullPage&&captureDiagnostic.computedRawBytes>=RASTER_LIMIT){
    const ranges=captureTiles(dimensions.width,dimensions.height,dimensions.documentHeight);
    const saved=[];
    for(let i=0;i<ranges.length;i++){
      stage='capture-tile';const range=ranges[i];
      await page.evaluate(y=>scrollTo({top:y,left:0,behavior:'instant'}),range.start);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const actual=await page.evaluate(()=>{
        const label=[...document.querySelectorAll('body>header')].find(n=>n.textContent.includes('SIMULATOR'))??document.querySelector('#simulator');
        const r=label?.getBoundingClientRect();
        return {start:scrollY,documentHeight:Math.max(document.documentElement.scrollHeight,document.body.scrollHeight),labelVisible:Boolean(r&&r.top>=0&&r.bottom<=innerHeight&&r.height>0&&getComputedStyle(label).visibility!=='hidden'&&getComputedStyle(label).display!=='none'),labelHeight:r?.height??0};
      });
      if(Math.abs(actual.start-range.start)>.5||actual.documentHeight!==dimensions.documentHeight||!actual.labelVisible||actual.labelHeight>64)throw Error('Tile coverage or Simulator label changed');
      const tileName=`${name}-tile${i+1}`;captures.set(tileName,await page.screenshot({fullPage:false}));saved.push({name:tileName,start:range.start,end:range.end});
    }
    captureCoverage.push({captureName:name,mode:'viewport-tiles',computedRawBytes:captureDiagnostic.computedRawBytes,documentHeight:dimensions.documentHeight,viewportWidth:dimensions.width,viewportHeight:dimensions.height,ranges:saved});
    await page.evaluate(()=>scrollTo({top:0,left:0,behavior:'instant'}));
  }else{
    stage=fullPage?'capture-full':'capture-viewport';captures.set(name,await page.screenshot({fullPage}));
    captureCoverage.push({captureName:name,mode:fullPage?'full-page':'exact-viewport',computedRawBytes:captureDiagnostic.computedRawBytes,documentHeight:dimensions.documentHeight,viewportWidth:dimensions.width,viewportHeight:dimensions.height,ranges:[{name,start:0,end:fullPage?dimensions.documentHeight:dimensions.height}]});
  }
  stage='functional-assertions';
};
async function fits(page, selector, name) {
  const result = await page.evaluate(selector => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }, selector);
  if (result.scrollWidth > result.width || result.left < -.5 || result.right > result.width + .5 || result.top < -.5 || result.bottom > result.height + .5) throw Error(`${name}: component outside viewport`);
}
async function contrast(page, selectors) {
  const ratios = await page.evaluate(selectors => {
    const rgb = value => (value.match(/[\d.]+/g) ?? []).map(Number);
    const lum = rgb => rgb.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((n, v, i) => n + v * [.2126, .7152, .0722][i], 0);
    return selectors.map(selector => {
      const el = document.querySelector(selector); let parent = el, bg;
      while (parent) { const c = rgb(getComputedStyle(parent).backgroundColor); if (c.length >= 3 && (c[3] ?? 1) > 0) { bg = c; break; } parent = parent.parentElement; }
      if (!bg) return 0;
      // Worst-case white OBS background through the nearly opaque backplate.
      const a = bg[3] ?? 1; bg = bg.slice(0, 3).map(v => v * a + 255 * (1 - a));
      const l = [lum(rgb(getComputedStyle(el).color)), lum(bg)].sort((a, b) => b - a);
      return (l[0] + .05) / (l[1] + .05);
    });
  }, selectors);
  if (ratios.some(value => value < 4.5)) throw Error('Text/backplate contrast below4.5:1');
}
try {
  await judges.listen(); const { chromium } = await import('playwright');
  browser = await chromium.launch({ executablePath: '/snap/bin/chromium', chromiumSandbox: true, headless: true, args: ['--disable-background-networking'] });
  browser.on('disconnected',()=>{if(!closing)disconnected=true;});
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  // Legacy SVG-fallback contract; default real WebGL is exercised independently.
  await context.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /^webgl/.test(type) ? null : original.call(this, type, ...args); };
  });
  await context.route('**/*', route => new URL(route.request().url()).origin === JUDGES_ORIGIN ? route.continue() : route.abort());
  await context.routeWebSocket('**/*', route => new URL(route.url()).origin === JUDGES_ORIGIN.replace('http', 'ws') ? route.connectToServer() : route.close());
  const errors = []; const page = async () => { const p = await context.newPage(); pages.push(p); p.on('crash',()=>{crashed=true;}); p.on('pageerror', () => errors.push('Local page error')); return p; };
  const atlas = await page(); await atlas.goto(`${JUDGES_ORIGIN}/atlas/`);
  await atlas.locator('#status').filter({ hasText: 'No completed hops yet' }).waitFor();
  if (await atlas.locator('.stop').count()) throw Error('Fresh memory has fake stops');
  await contrast(atlas, ['#description', '#search-help', '#search-submit']);
  await capture(atlas, 'polish-simulator-atlas-empty-1920');
  const overlay = await page(); await overlay.goto(`${JUDGES_ORIGIN}/overlay/1591806023`);
  await overlay.locator('#waiting-note').waitFor({ state: 'visible' });
  if (await overlay.locator('.rune, #rings span').count()) throw Error('New channel invented marks/rings');
  await fits(overlay, '.relic-overlay', 'Empty1080p overlay'); await contrast(overlay, ['#status', '#count']);
  await capture(overlay, 'polish-simulator-new-channel-1920');
  await overlay.setViewportSize({ width: 480, height: 720 }); await fits(overlay, '.relic-overlay', '480×720 empty browser source');
  await capture(overlay, 'polish-simulator-new-channel-480'); await overlay.setViewportSize({ width: 1920, height: 1080 });
  await overlay.setViewportSize({ width: 160, height: 160 }); await overlay.goto(`${JUDGES_ORIGIN}/overlay/1591806023?corner=1`);
  await overlay.locator('#compact-status').filter({ hasText: 'Waiting' }).waitFor();
  if (await overlay.locator('.rune, #rings span').count()) throw Error('Empty corner invented marks/rings');
  const emptyCount = await overlay.locator('#compact-count').textContent();
  if (!emptyCount.includes('Charge 0/160') || !emptyCount.includes('Rings 0')) throw Error('Empty corner not zero');
  for (const selector of ['.relic-overlay', '#simulator', '#compact-status', '#compact-count']) {
    if (!await overlay.locator(selector).isVisible()) throw Error('Empty corner label hidden');
    await fits(overlay, selector, 'Brand-new160px corner');
  }
  if (!(await overlay.locator('#simulator').textContent()).includes('SIMULATOR') || await overlay.evaluate(() => document.documentElement.scrollHeight > 160)) throw Error('Empty corner label/bounds');
  await capture(overlay, 'polish-simulator-new-channel-waiting-corner-160');
  await overlay.setViewportSize({ width: 1920, height: 1080 }); await overlay.goto(`${JUDGES_ORIGIN}/overlay/1591806023`);
  await overlay.locator('#waiting-note').waitFor({ state: 'visible' });
  await atlas.setViewportSize({ width: 375, height: 800 }); await capture(atlas, 'polish-simulator-atlas-empty-375');
  if (await atlas.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Empty mobile overflow');
  checks.push({ name: 'Fresh unplaced memory/brand-new configured channel: truthful empty Atlas and waiting OBS, contrast/bounds', pass: true });
  const consolePage = await page(); await consolePage.goto(`${JUDGES_ORIGIN}/judges`);
  await consolePage.locator('#result').filter({ hasText: 'local state refreshed' }).waitFor();
  async function step(action) {
    const response = consolePage.waitForResponse(r => new URL(r.url()).pathname === '/api/judges/action' && r.request().method() === 'POST');
    await consolePage.locator(`[data-action="${action}"]`).click(); if ((await response).status() !== 200) throw Error('Simulated signed kernel step failed');
    await consolePage.waitForFunction(() => !document.querySelector('[data-action="reset"]').disabled);
  }
  for (const action of ['setup', 'mark', 'send']) await step(action);
  if (await overlay.locator('.rune').count()) throw Error('API acceptance fabricated incoming preview');
  await overlay.emulateMedia({ reducedMotion: 'no-preference' }); await step('raid');
  await overlay.waitForFunction(() => ['streak', 'impact', 'unfurl'].includes(document.querySelector('.archive').dataset.phase));
  const receipt = await overlay.evaluate(async () => (await (await fetch('/api/overlay/1591806023')).json()).handoff.startedAt);
  await capture(overlay, 'polish-simulator-verified-arrival-1920');
  await overlay.emulateMedia({ reducedMotion: 'reduce' });
  await overlay.waitForFunction(() => document.querySelector('.archive').dataset.phase === 'settled');
  if (await overlay.locator('.crystal').evaluate(el => getComputedStyle(el).animationName) !== 'none') throw Error('Reduced motion crystal animates');
  await overlay.reload(); await overlay.waitForFunction(() => document.querySelector('.archive').dataset.phase === 'settled');
  if (await overlay.evaluate(async () => (await (await fetch('/api/overlay/1591806023')).json()).handoff.startedAt) !== receipt) throw Error('Reconnect reset receipt');
  await step('offer'); await step('accept'); await overlay.locator('#lineage').filter({ hasText: '1 completed growth rings' }).waitFor();
  await fits(overlay, '.relic-overlay', 'Claimed1080p overlay'); await capture(overlay, 'polish-simulator-claimed-1920');
  checks.push({ name: 'Verified fake receipt only arrival, real two-chat kernel claim, reduced motion and reconnect seek unchanged receipt', pass: true });
  await atlas.setViewportSize({ width: 1920, height: 1080 }); await atlas.getByRole('button', { name: 'Refresh history', exact: true }).click();
  await atlas.locator('.stop a').first().waitFor(); await capture(atlas, 'polish-simulator-atlas-populated-1920');
  await capture(atlas, 'polish-simulator-atlas-populated-viewport-1920x1080', false);
  await atlas.getByRole('link', { name: 'Where has my mark been?', exact: true }).click();
  await atlas.getByLabel('Approved mark text (one word or emoji)').fill('moon'); const searchURL = atlas.url();
  const searched = atlas.waitForResponse(r => new URL(r.url()).pathname === '/api/atlas/search' && r.request().method() === 'POST');
  await atlas.getByRole('button', { name: 'Search approved text', exact: true }).click(); if ((await searched).status() !== 200) throw Error('Search failed');
  await atlas.locator('#search-matches img').first().waitFor();
  if (atlas.url() !== searchURL || new URL(atlas.url()).search) throw Error('Query reached URL/history');
  await atlas.setViewportSize({ width: 375, height: 800 }); await atlas.locator('#mark-history').scrollIntoViewIfNeeded();
  if (await atlas.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Populated search mobile overflow');
  await atlas.locator('#search-query').focus();
  if (await atlas.locator('#search-query').evaluate(el => getComputedStyle(el).outlineStyle) === 'none') throw Error('Search focus invisible');
  await capture(atlas, 'polish-simulator-search-375');
  await atlas.getByLabel('Approved mark text (one word or emoji)').fill('absentword'); await atlas.getByRole('button', { name: 'Search approved text', exact: true }).click();
  await atlas.locator('#search-status').filter({ hasText: 'No approved shared-text matches' }).waitFor();
  if (await atlas.locator('#search-matches li').count()) throw Error('Old matches retained on empty result');
  await atlas.route('**/api/atlas/search', route => route.fulfill({ status: 503, json: { mode: 'simulator', error: 'Unavailable' } }));
  await atlas.getByRole('button', { name: 'Search approved text', exact: true }).click(); await atlas.locator('#search-status').filter({ hasText: 'Previous matches hidden' }).waitFor();
  if (await atlas.locator('#search-matches li').count()) throw Error('Old matches retained on error');
  checks.push({ name: 'Visible named search anchor, POST name-as-text semantics,375px focus/bounds, empty/error privacy', pass: true });
  await overlay.setViewportSize({ width: 160, height: 160 }); await overlay.goto(`${JUDGES_ORIGIN}/overlay/1591806023?corner=1`);
  await overlay.locator('#compact-count').filter({ hasText: 'Rings 1' }).waitFor(); await fits(overlay, '.relic-overlay', '160px corner');
  if (await overlay.evaluate(() => document.documentElement.scrollHeight > 160)) throw Error('Corner taller than160');
  for (const selector of ['#simulator', '#compact-status', '#compact-count']) await fits(overlay, selector, 'Corner label');
  await contrast(overlay, ['#compact-status', '#compact-count']); await capture(overlay, 'polish-simulator-corner-160');
  for (const p of [atlas, overlay]) if (!(await p.title()).includes('SIMULATOR')) throw Error('Missing immediate Simulator label');
  if (errors.length) throw Error('Local page error');
  checks.push({ name: '160×160 contrast/readable labels and persistent Simulator mode', pass: true });
} catch (error) { failure = error; }
finally {
  // Save any successfully captured bytes even if a later assertion fails.
  closing=true;
  try { await browser?.close(); } catch (error) { failure ??= error; }
  try { await judges.close(); } catch (error) { failure ??= error; }
  await mkdir('artifacts', { recursive: true });
  for (const [name, bytes] of captures) await writeFile(`artifacts/${name}.png`, bytes);
  await writeFile('artifacts/polish-browser-results.json', JSON.stringify({ simulator: true, passed: !failure, checks, captures: [...captures.keys()], stage, captureDiagnostic, crashed, disconnected, captureCoverage, failureCategory: failure ? classifyFailure(failure).category : null, failure: failure ? classifyFailure(failure) : null }, null, 2));
}
if (failure) { console.error('Local polish browser gate failed; see bounded Simulator artifact results.'); process.exitCode = 1; }
