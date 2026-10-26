import test from 'node:test';
import assert from 'node:assert/strict';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { httpTransport } from '../src/oauth.js';
import { sendState } from '../src/send-state.js';
import { connectOverlay } from '../public/overlay-client.js';
import { boundedResponse } from '../public/control-read.js';
import { boundedCall } from '../src/bounded.js';
async function ready(kind) {
  const f = await pilotFixture(kind); for (const id of [BOT,HOME,OTHER]) await f.login(id);
  for (const id of [HOME,OTHER]) { await f.control(id,'bootstrap'); f.advance(); await f.control(id,'keep'); f.advance(); }
  await f.control(HOME, `send:${OTHER}`); f.advance(); await f.raid(HOME,OTHER,3); return f;
}
for (const kind of ['memory','firestore']) test(`${kind}: authenticated ended-confirmed reconciliation is exact, idempotent and has no provider effects`, async () => {
  const f = await ready(kind), before = await f.runtime.state.getKeeperRegistry(), end = before.pendingHop.endsAt;
  f.advance(end-f.now()-1); await f.runtime.pilot.status(HOME); assert.equal((await f.runtime.state.getKeeperRegistry()).send.status,'confirmed');
  f.advance(); const providerCalls = f.calls.length;
  await Promise.all([f.runtime.pilot.status(HOME), f.runtime.pilot.status(HOME)]);
  const after = await f.runtime.state.getKeeperRegistry(); assert.equal(after.send.status,'expired-handoff'); assert.equal(after.holderId,HOME);
  assert.equal(after.pendingHop.offers,undefined); assert.equal(after.pendingHop.accepts,undefined); assert.equal(after.pendingHop.movedOffers,undefined);
  assert.equal((await f.runtime.state.getPublicJourney()).rings,0); assert.equal(f.calls.length,providerCalls);
  f.advance(); await f.control(HOME, `send:${OTHER}`); const newer = await f.runtime.state.getKeeperRegistry(); assert.equal(newer.send.status,'accepted');
  await f.runtime.state.sendOffStep({ type:'reconcile-ended',source:HOME,actor:HOME,id:before.send.id,generation:before.send.generation,hopId:before.pendingHop.eventId },f.now());
  assert.deepEqual((await f.runtime.state.getKeeperRegistry()).send,newer.send);
});
test('pure reconciliation refuses unknown/accepted, wrong actor/holder/generation/stream and respects authoritative closed proof', () => {
  const now = 1792929600000;
  const config = { channels:[HOME,OTHER],logins:{olsols2:OTHER} };
  const root = { holderId:HOME,send:{ id:'intent',generation:'generation',status:'confirmed',sourceId:HOME,targetId:OTHER,sourceStreamId:'one',targetStreamId:'two',dispatchAt:now-200000 },
    pendingHop:{ eventId:'raid',from:HOME,to:OTHER,sourceStreamId:'one',targetStreamId:'two',raidSentAt:now-190000,endsAt:now,offers:['811'],accepts:[] } };
  const op = { type:'reconcile-ended',source:HOME,actor:HOME,id:'intent',generation:'generation',hopId:'raid' };
  const run = (r=root,o=op,c={ [HOME]:{online:true,streamId:'one'} },time=now) => sendState(r,c,{},config,o,time);
  assert.equal(run().registry.send.status,'expired-handoff'); assert.equal(run(root,op,undefined,now-1).registry.send.status,'confirmed');
  for (const status of ['unknown','accepted','dispatching','preflight','queued']) assert.equal(run({...root,send:{...root.send,status}}).registry.send.status,status);
  assert.equal(run({...root,holderId:OTHER}).registry.send.status,'confirmed');
  for (const change of [{actor:OTHER},{generation:'new'},{id:'new'},{hopId:'new'}]) assert.equal(run(root,{...op,...change}).registry.send.status,'confirmed');
  assert.equal(run(root,op,{[HOME]:{online:true,streamId:'new',closedIds:[]}}).registry.send.status,'confirmed');
  assert.equal(run(root,op,{[HOME]:{online:true,streamId:'new',closedIds:['one']}}).registry.send.status,'expired-handoff');
});
test('socket recovery handles hung initial connection/error without close and ignores old socket/heartbeat/retry epochs', () => {
  const sockets=[], timers=new Map(), handlers={}, views=[]; let next=0;
  class Socket { constructor(){sockets.push(this);} close(){this.closed=true;} }
  const events={hidden:false,addEventListener(n,f){handlers[n]=f;},removeEventListener(n){delete handlers[n];}};
  const stop=connectOverlay({url:'ws://local',WebSocketImpl:Socket,render:v=>views.push(v),status(){},windowEvents:events,documentEvents:events,
    setTimer:(fn,delay)=>{const id=++next;timers.set(id,{fn,delay});return id;},clearTimer:id=>timers.delete(id)});
  const fire=delay=>{const entry=[...timers].find(([,v])=>v.delay===delay);assert.ok(entry,`timer${delay}`);timers.delete(entry[0]);entry[1].fn();};
  const value=revision=>({type:'snapshot',revision,mode:'simulator',status:'ready',marks:[],approvedCount:0,lineageRings:0});
  fire(8000); assert.equal(sockets[0].closed,true); fire(500); assert.equal(sockets.length,2);
  sockets[1].onmessage({data:JSON.stringify(value(9))}); sockets[1].onerror(); const before=timers.size;
  sockets[0].onmessage({data:'{"type":"heartbeat"}'}); sockets[0].onclose(); assert.equal(timers.size,before);
  handlers.online(); assert.equal(sockets.length,3); sockets[2].onmessage({data:JSON.stringify(value(0))}); assert.equal(views.at(-1).revision,0);
  sockets[1].onmessage({data:JSON.stringify(value(100))}); assert.equal(views.at(-1).revision,0);
  stop(); assert.equal(timers.size,0); assert.equal(Object.keys(handlers).length,0);
});
test('private bounded reads fail closed for hung fetch/body, authorization, malformed/oversized and cancellation, without retry', async () => {
  let calls=0;
  await assert.rejects(boundedResponse('/private',{}, { timeoutMs:5,fetchImpl:()=>{calls++;return new Promise(()=>{});} }),e=>e.code==='timeout'); assert.equal(calls,1);
  await assert.rejects(boundedResponse('/private',{}, { timeoutMs:5,fetchImpl:async()=>({status:200,text:()=>new Promise(()=>{})}) }),e=>e.code==='timeout');
  for (const [status,text,code] of [[401,'no','authorization'],[403,'no','authorization'],[200,'{','malformed'],[200,'x'.repeat(20),'oversize']]) {
    await assert.rejects(boundedResponse('/private',{}, {json:true,maxBytes:10,fetchImpl:async()=>({status,text:async()=>text})}),e=>e.code===code);
  }
  const c=new AbortController(); const pending=boundedResponse('/private',{signal:c.signal},{fetchImpl:()=>new Promise(()=>{})}); c.abort(); await assert.rejects(pending,e=>e.code==='aborted');
  await assert.rejects(boundedCall(()=>new Promise(()=>{}),5),/timed out/);
});
for (const kind of ['memory','firestore']) test(`${kind}: next reserve atomically retires only ended confirmed generation; stale retry cannot touch replacement`, async () => {
  const f=await ready(kind),old=await f.runtime.state.getKeeperRegistry();f.advance(old.pendingHop.endsAt-f.now());
  const op={type:'reserve',source:HOME,actor:HOME,login:'olsols2',id:'fresh-owner-reservation',sentAt:f.now()};const calls=f.calls.length;
  if(f.db){f.db.failCommit=true;await assert.rejects(f.runtime.state.sendOffStep(op,f.now()));f.db.failCommit=false;assert.equal((await f.runtime.state.getKeeperRegistry()).send.id,old.send.id);}
  const reserved=await f.runtime.state.sendOffStep(op,f.now());assert.equal(reserved.status,'reserved');
  const next=await f.runtime.state.getKeeperRegistry();assert.notEqual(next.send.id,old.send.id);assert.equal(next.send.status,'queued');assert.equal(next.holderId,HOME);assert.equal(f.calls.length,calls);
  await f.runtime.state.sendOffStep({type:'reconcile-ended',source:HOME,actor:HOME,id:old.send.id,generation:old.send.generation,hopId:old.pendingHop.eventId},f.now());
  assert.deepEqual((await f.runtime.state.getKeeperRegistry()).send,next.send);
  const offered=await f.runtime.state.getPrivateMarks(HOME,{broadcasterId:HOME,chatterId:HOME});assert.ok(offered.context.holdsRelic);
});
test('heartbeat cannot keep an opened socket without its initial snapshot alive indefinitely', () => {
  const sockets=[],timers=new Map();let id=0;
  class Socket{constructor(){sockets.push(this);}close(){}}
  const stop=connectOverlay({url:'ws://local',WebSocketImpl:Socket,status(){},render(){},setTimer:(fn,delay)=>{timers.set(++id,{fn,delay});return id;},clearTimer:n=>timers.delete(n)});
  sockets[0].onopen();sockets[0].onmessage({data:'{"type":"heartbeat"}'});
  const first=[...timers.values()].find(t=>t.delay===8000);assert.ok(first);first.fn();assert.ok([...timers.values()].some(t=>t.delay===500));stop();
});

for (const kind of ['memory','firestore']) test(`${kind}: signed fresh post-window chat100ms before processing queues once with monotonic retirement watermark`, async () => {
  const f=await ready(kind),old=await f.runtime.state.getKeeperRegistry();f.advance(old.pendingHop.endsAt-f.now()+1000);
  const now=f.now(),sentAt=now-100,calls=f.calls.length;
  const response=await f.chat(HOME,HOME,'!relic send @olsols2',{sentAt,messageId:'post-window-original'});assert.equal(response.status,204);
  const next=await f.runtime.state.getKeeperRegistry();assert.equal(next.send.status,'queued');assert.equal(next.send.requestedAt,sentAt);assert.ok(next.sendWatermark>=now);assert.notEqual(next.send.id,old.send.id);assert.equal(f.calls.filter(c=>c.url.endsWith('/chat/messages')).length,1);assert.equal(JSON.parse(f.calls.filter(c=>c.url.endsWith('/chat/messages'))[0].body).message,'Send Off request checked. The Keeper uses private control to process an eligible queued request; never repeat an unknown dispatch.');assert.equal(f.calls.length,calls+2);assert.deepEqual(f.calls.slice(calls).map(c=>new URL(c.url).pathname).sort(),['/helix/chat/messages','/oauth2/validate']);
  await f.chat(HOME,HOME,'!relic send @olsols2',{sentAt,messageId:'post-window-original'});
  await f.runtime.state.sendOffStep({type:'reconcile-ended',source:HOME,actor:HOME,id:old.send.id,generation:old.send.generation,hopId:old.pendingHop.eventId},now);
  assert.deepEqual((await f.runtime.state.getKeeperRegistry()).send,next.send);assert.equal(f.calls.filter(c=>c.url.endsWith('/chat/messages')).length,1);assert.equal(JSON.parse(f.calls.filter(c=>c.url.endsWith('/chat/messages'))[0].body).message,'Send Off request checked. The Keeper uses private control to process an eligible queued request; never repeat an unknown dispatch.');assert.equal(f.calls.length,calls+2);assert.deepEqual(f.calls.slice(calls).map(c=>new URL(c.url).pathname).sort(),['/helix/chat/messages','/oauth2/validate']);
});
for (const kind of ['memory','firestore']) test(`${kind}: retired reservation rejects old-window/prior-watermark/future requests and concurrent replacement is protected`, async () => {
  const f=await ready(kind),old=await f.runtime.state.getKeeperRegistry();f.advance(old.pendingHop.endsAt-f.now()+1000);const now=f.now();
  const channels={},marks={};for(const id of [HOME,OTHER]){channels[id]=await f.runtime.state.getStreamStatus(id);marks[id]=await f.runtime.state.getPrivateMarks(id,{broadcasterId:id,chatterId:id});}
  const config={channels:[HOME,OTHER],logins:{olsols2:OTHER}};
  for(const sentAt of [old.pendingHop.endsAt-1,old.pendingHop.endsAt,old.sendWatermark,now+1,now-600001]){
    const r=sendState(old,channels,marks,config,{type:'reserve',source:HOME,actor:HOME,login:'olsols2',id:'old-or-future',sentAt},now);
    assert.equal(r.result.status,'blocked');assert.notEqual(r.registry.send.status,'queued');assert.ok(r.registry.sendWatermark>=old.sendWatermark);
  }
  const reserve=id=>f.runtime.state.sendOffStep({type:'reserve',source:HOME,actor:HOME,login:'olsols2',id,sentAt:now-100},now);
  const results=await Promise.all([reserve('owner-one'),reserve('owner-two')]);assert.equal(results.filter(r=>r.status==='reserved').length,1);
  const next=await f.runtime.state.getKeeperRegistry();assert.equal(next.send.status,'queued');assert.ok(next.sendWatermark>=now);
});
test('native HTTP transport preserves JSON401/403/409 status/body without retry', async t => {
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=0;
  for(const status of [401,403,409]){
    const body={error:'Synthetic provider rejection',message:'Exact bounded synthetic message',status};
    globalThis.fetch=async()=>{calls++;return new Response(JSON.stringify(body),{status});};
    assert.deepEqual(await httpTransport('https://synthetic.invalid/test',{}),{status,data:body});
  }
  assert.equal(calls,3);
});
test('native HTTP transport bounds oversized body and never retries known provider responses', async t => {
  const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response('x'.repeat(65537),{status:409});};
  await assert.rejects(httpTransport('https://synthetic.invalid/test',{}),/Upstream request failed/);assert.equal(calls,1);
  // Existing boundedResponse hung-fetch/body tests exercise the same finite
  // native transport deadline without a slow eight-second test or real HTTP.
});

for (const kind of ['memory', 'firestore']) test(`${kind}: automatic retirement then fresh T1 completion returns consistent authenticated control status`, async () => {
  const f = await ready(kind);
  const old = await f.runtime.state.getKeeperRegistry();
  f.advance(old.pendingHop.endsAt - f.now() + 1000);
  const get = id => f.request(`/control/${id}/status`, 'GET', { cookie: f.cookies[id] });
  assert.equal((await get(HOME)).status, 200);
  f.advance(); assert.equal(JSON.parse((await f.control(HOME, `send:${OTHER}`)).body).status, 'accepted');
  f.advance(); await f.raid(HOME, OTHER, 2);
  await f.chat(HOME, HOME, '!offer'); await f.chat(OTHER, OTHER, '!accept');
  const root = await f.runtime.state.getKeeperRegistry();
  assert.equal(root.holderId, OTHER); assert.equal(root.send, undefined); assert.equal(root.pendingHop.finalized, true);
  for (const id of [HOME, OTHER]) {
    const html = await f.request(`/control/${id}`, 'GET', { cookie: f.cookies[id] });
    assert.equal(html.status, 200);
    const response = await get(id); assert.equal(response.status, 200);
    const value = JSON.parse(response.body);
    assert.equal(value.pilot.holder, root.holderId); assert.equal(value.pilot.intent, null);
    assert.equal(value.pilot.claimProgress.finalized, true);
  }
  assert.equal((await f.runtime.state.getPublicJourney()).rings, 1);
});
