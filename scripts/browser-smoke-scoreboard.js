// LOCAL mock-only P5 gate. Fixed registered5191; all provider calls injected.
import assert from 'node:assert/strict';
import { createServer } from 'node:https';
import { mkdir, writeFile } from 'node:fs/promises';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { createLocalTLS } from '../test-support/local-tls.js';
import { TWITCHCON } from '../src/scoreboard.js';
const origin='https://localhost:5191';let browser,server,tls,active,stage='setup',failed=false;const checks=[], captures=[], captureBytes=new Map();let page;
async function capture(name){if(process.env.P5_CAPTURE!=='1')return;await page.locator('#keeper-scores').evaluate(n=>{n.scrollIntoView({block:'start'});window.scrollBy(0,-28);});await page.locator('#p5-simulator-label').waitFor();await mkdir('artifacts',{recursive:true});const bytes=await page.screenshot({fullPage:false});assert.ok(bytes.length<=512*1024);captureBytes.set(name,bytes);}
async function prepared(at){const f=await pilotFixture('firestore',{origin});if(at)f.advance(at-f.now());for(const id of[BOT,HOME,OTHER])await f.login(id);for(const id of[HOME,OTHER]){await f.control(id,'bootstrap');f.advance();await f.control(id,'keep');f.advance();}return f;}
async function hop(f){await f.control(HOME,`send:${OTHER}`);f.advance();await f.raid(HOME,OTHER,1);await f.chat(HOME,'811','!offer');await f.chat(OTHER,'812','!accept');}
try{
 active=await prepared();await active.chat(HOME,'811','!relic scores on');await active.chat(OTHER,'812','!relic scores on');
 tls=await createLocalTLS();server=createServer(tls.options,(req,res)=>{res.setHeader('x-raid-relic-mode','simulator');active.runtime.handler(req,res);});await new Promise((r,j)=>{server.once('error',j);server.listen(5191,'127.0.0.1',r);});
 const {chromium}=await import('playwright');browser=await chromium.launch({executablePath:'/snap/bin/chromium',chromiumSandbox:true,headless:true});const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1280,height:800},serviceWorkers:'block'});
 await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await context.routeWebSocket('**/*',r=>r.close());
 await context.addInitScript(()=>{addEventListener('DOMContentLoaded',()=>{const label=document.createElement('aside');label.id='p5-simulator-label';label.textContent='SIMULATOR · LOCAL MOCK P5 ONLY';label.style.cssText='position:fixed;top:0;left:0;right:0;z-index:100;background:#101d30;color:#ffe3a6';document.body.prepend(label);document.title='SIMULATOR P5';});});
 page=await context.newPage();stage='empty-coverage';await page.goto(origin+'/atlas/');await page.locator('#scores-status').filter({hasText:'0 recorded rings'}).waitFor();assert.match(await page.locator('#scores-coverage').textContent(),/unknown|not available/);assert(await page.locator('#simulator').isVisible());
 stage='completed-score';await hop(active);await page.locator('#scores-refresh').click();await page.locator('#scores-status').filter({hasText:'1 recorded ring'}).waitFor();assert.match(await page.locator('#raider-rows').textContent(),/1 completed claim joined/);assert.match(await page.locator('#keeper-rows').textContent(),/Ring 1/);
 active.advance(86400000);await page.locator('#scores-refresh').click();await page.locator('#keeper-rows').filter({hasText:'24h Keeper'}).waitFor();assert.equal((await page.locator('#keeper-rows').textContent()).includes('Carried during TwitchCon'),false);
 await capture('scoreboard-desktop.png');
 await page.setViewportSize({width:375,height:800});await page.locator('#scores-refresh').focus();assert.equal(await page.locator('#scores-refresh').evaluate(n=>n===document.activeElement),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await capture('scoreboard-mobile.png');
 checks.push({name:'SIMULATOR completed-only scores, known24h badge, desktop/mobile bounds and keyboard refresh',passed:true});
 stage='erase';await active.chat(HOME,'811','!relic forgetme');await page.locator('#scores-refresh').click();await page.waitForFunction(()=>!document.querySelector('#scores-refresh').disabled);assert.equal((await page.locator('#raider-rows').textContent()).includes('@viewer811'),false);
 await active.chat(OTHER,'812','!relic top');active.advance(30001);await active.chat(OTHER,'812','!relic badges');const posts=active.calls.filter(c=>c.url.endsWith('/chat/messages')).map(c=>JSON.parse(c.body).message);assert.ok(posts.some(m=>m.startsWith('Recorded Keepers:')));assert.ok(posts.some(m=>m.startsWith('Keeper badges:')));assert.ok(posts.every(m=>[...m].length<=500));
 checks.push({name:'SIMULATOR fresh erasure without reload and exact mock top/badges bot replies',passed:true});
 stage='official-event';active=await prepared(TWITCHCON.startsAt);await hop(active);await page.locator('#scores-refresh').click();await page.locator('#keeper-rows').filter({hasText:'Carried during TwitchCon San Diego 2026'}).waitFor();checks.push({name:'SIMULATOR fake-clock November official San Diego badge, not an October/live claim',passed:true});
 stage='preview-read-only';active=await pilotFixture('firestore',{origin,chronicleEnv:{P5_PREVIEW_READ_ONLY:'true'}});await page.goto(origin+'/atlas/');await page.locator('#score-preview').waitFor();
 await capture('scoreboard-preview.png');
 const denied=await page.evaluate(async()=>{const paths=['/eventsub','/api/forge','/api/atlas/search','/api/my-marks','/control/1591805230','/oauth/bot/start','/auth/callback'];const codes=[];for(const path of paths)codes.push((await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status);codes.push((await fetch('/control/1591805230/status')).status);codes.push((await fetch('/oauth/keeper/1591806023/start')).status);return codes;});assert.ok(denied.every(n=>n===403));assert.equal(active.calls.length,0);assert.equal(active.db.writes.length,0);
 checks.push({name:'SIMULATOR actual HTTPS preview denies OAuth/control/EventSub/all mutations before provider or storage writes',passed:true});
}catch{failed=true;}
finally{try{if(captureBytes.size){await mkdir('artifacts',{recursive:true});for(const[name,bytes]of captureBytes){await writeFile(`artifacts/${name}`,bytes);captures.push(name);}}}catch{failed=true;}await browser?.close().catch(()=>{});server?.closeAllConnections();if(server?.listening)await new Promise(r=>server.close(r));await tls?.cleanup();await mkdir('artifacts',{recursive:true});await writeFile('artifacts/scoreboard-browser-results.json',JSON.stringify({simulator:true,passed:!failed,stage,checks,captures},null,2));}
if(failed)process.exitCode=1;
