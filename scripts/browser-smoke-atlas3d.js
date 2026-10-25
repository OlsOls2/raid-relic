// Local labelled fixture only. Actual WebGL remains independent of SVG gates.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createJudges, JUDGES_ORIGIN } from '../test-support/judges.js';
const judges = await createJudges({ intent: true, env: {} });
let browser, stage = 'startup', failed = false; const checks = [];
try {
  await judges.listen(); const { chromium } = await import('playwright');
  browser = await chromium.launch({ executablePath: '/snap/bin/chromium', chromiumSandbox: true, headless: true });
  for (const mode of ['webgl', 'reduced', 'no-gl', 'import-failure']) {
    stage = mode;
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 }, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
    if (mode === 'no-gl') await context.addInitScript(() => { const original = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type, ...args) { return /^webgl/.test(type) ? null : original.call(this, type, ...args); }; });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      return url.origin !== JUDGES_ORIGIN || (mode === 'import-failure' && url.pathname === '/relic3d.js') ? route.abort() : route.continue();
    });
    const page = await context.newPage(); await page.goto(`${JUDGES_ORIGIN}/atlas/`);
    await page.evaluate(async () => { await fetch('/api/judges/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'reset'})}); });
    await page.locator('#refresh').click();
    await page.waitForFunction(() => document.querySelector('#rings').textContent.includes('0 completed'));
    const hero = page.locator('#atlas-relic');
      await page.evaluate(async () => { for (const action of ['setup','mark','send','raid','offer','accept']) { const r = await fetch('/api/judges/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action})}); if(!r.ok) throw Error('Local fixture failed'); } });
      await page.locator('#refresh').click();
    await page.waitForFunction(() => document.querySelector('#atlas-relic').dataset.rings === '1' && document.querySelectorAll('#journey .stop').length === 1);

    if (mode === 'webgl') {
      await page.waitForFunction(() => document.querySelector('#atlas-relic').classList.contains('webgl-relic'));
      const pixels = await page.locator('canvas.relic3d').evaluate(canvas => new Promise(resolve => {
        const timer = setTimeout(() => { canvas.removeAttribute('data-pixel-probe'); resolve(null); }, 5000);
        canvas.setAttribute('data-pixel-probe', '');
        canvas.addEventListener('relic3d-frame', () => {
          clearTimeout(timer); canvas.removeAttribute('data-pixel-probe'); const gl = canvas.getContext('webgl2');
          const bytes = new Uint8Array(canvas.width * canvas.height * 4); gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,bytes);
          let colored = 0; for(let i=0;i<bytes.length;i+=4) if(bytes[i+3] && Math.max(bytes[i],bytes[i+1],bytes[i+2])>20) colored++;
          resolve({ colored, corner: bytes[3] });
        }, { once:true });
      }));
      assert(pixels && pixels.colored > 0); assert.equal(pixels.corner, 0);
      await page.waitForFunction(() => document.querySelector('#atlas-relic').dataset.rings === '1' && document.querySelector('canvas.relic3d')?.dataset.bands === '2');
      await page.evaluate(() => { window.__priorHidden = Object.getOwnPropertyDescriptor(document, 'hidden'); Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}); document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => document.querySelector('canvas.relic3d').dataset.frameScheduled === 'false');
      await page.evaluate(() => { if(window.__priorHidden) Object.defineProperty(document,'hidden',window.__priorHidden); else delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
      await page.waitForFunction(() => document.querySelector('#atlas-relic').classList.contains('webgl-relic'));
      if(process.env.P4_CAPTURE === '1') {
        await mkdir('artifacts',{recursive:true});
        const image = await page.screenshot({fullPage:false}); if(image.length <= 524288) await writeFile('artifacts/p4-simulator-atlas.png',image);
        const glow = await hero.screenshot(); if(glow.length <= 524288) await writeFile('artifacts/p4-simulator-glow.png',glow);
      }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForFunction(() => !document.querySelector('#atlas-relic').classList.contains('webgl-relic'));
    }
    assert(await hero.locator('img').isVisible());
    await page.setViewportSize({ width:375,height:800 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert(await page.locator('#search-query').isEnabled());
    assert((await hero.getAttribute('data-rings')) === '1');
    checks.push({ name: `SIMULATOR Atlas ${mode}: aggregate-only hero, gallery and mobile`, passed:true });
    await context.close();
  }
} catch { failed = true; }
finally {
  await browser?.close(); await judges.close(); await mkdir('artifacts',{recursive:true});
  await writeFile('artifacts/atlas3d-browser-results.json',JSON.stringify({simulator:true,passed:!failed,stage,checks},null,2));
}
if(failed) process.exitCode=1;
