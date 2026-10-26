import test from 'node:test';
import assert from 'node:assert/strict';
import {pilotFixture,HOME,OTHER,BOT} from '../test-support/pilot-fixture.js';
import {completionAckKey} from '../src/claim-ack.js';
import {FUSION_TIMING,fusionEnvelope,cinematicPhase,createCinemaTracker} from '../public/cinematic.js';
import {validSnapshot} from '../public/overlay-client.js';
async function setup(kind){const f=await pilotFixture(kind);for(const id of[BOT,HOME,OTHER])await f.login(id);for(const id of[HOME,OTHER]){await f.control(id,'bootstrap');f.advance();await f.control(id,'keep');f.advance();}await f.control(HOME,`send:${OTHER}`);return f;}
const posts=f=>f.calls.filter(c=>c.url.endsWith('/chat/messages')).map(c=>JSON.parse(c.body));
const completed=f=>posts(f).filter(c=>c.message.startsWith('Claim complete'));
for(const kind of ['memory','firestore'])for(const order of ['online','offline-before','offline-after'])test(`${kind}:66.204s legal early offer survives ${order}, duplicate callbacks/status/late finish; accept alone completes and both chats SENT`,async()=>{
 const f=await setup(kind);const intent=(await f.runtime.state.getKeeperRegistry()).send;await f.chat(HOME,'811','!offer');assert.match(posts(f).at(-1).message,/Waiting for 1 accept in @olsols2/);assert.equal(completed(f).length,0);
 f.advance(66204);const sentAt=f.now();if(order==='offline-before'){f.advance();await f.signed('stream.offline',{broadcaster_user_id:HOME},HOME);assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop.offers,['811']);f.advance();}
 await f.signed('channel.raid',{from_broadcaster_user_id:HOME,to_broadcaster_user_id:OTHER,viewers:1},OTHER,{to_broadcaster_user_id:OTHER},{sentAt});const start=(await f.runtime.state.getKeeperRegistry()).pendingHop.startedAt;
 if(order==='offline-after'){f.advance();await f.signed('stream.offline',{broadcaster_user_id:HOME},HOME);}
 await f.signed('channel.raid',{from_broadcaster_user_id:HOME,to_broadcaster_user_id:OTHER,viewers:1},HOME,{from_broadcaster_user_id:HOME},{sentAt});
 await f.runtime.state.sendOffStep({type:'finish',id:intent.id,owner:intent.owner,status:'accepted'},f.now());for(const host of[HOME,OTHER])assert.equal((await f.request(`/control/${host}/status`,'GET',{cookie:f.cookies[host]})).status,200);
 let root=await f.runtime.state.getKeeperRegistry();assert.deepEqual(root.pendingHop.offers,['811']);assert.equal(root.pendingHop.startedAt,start);assert.equal(root.pendingHop.endsAt,start+180000);assert.equal(root.holderId,HOME);
 for(const host of [HOME,OTHER]){const snapshot=await f.runtime.overlayFeeds[host].snapshot(),api=JSON.parse((await f.request(`/api/overlay/${host}`)).body);for(const value of [snapshot,api]){assert.equal(validSnapshot(value),true);assert.equal(value.claimMeter.offers,1);assert.equal(value.claimMeter.accepts,0);assert.equal(value.claimMeter.threshold,1);assert.equal(value.claimMeter.endsAt,start+180000);assert.equal(value.lineageRings,0);}}
 if(order==='offline-before'){for(const elapsed of [19000,161000]){f.advance(start+elapsed-f.now());for(const host of [HOME,OTHER]){const value=JSON.parse((await f.request(`/api/overlay/${host}`)).body);assert.equal(value.claimMeter.offers,1);assert.equal(value.claimMeter.accepts,0);assert.equal(value.claimMeter.threshold,1);assert.equal(value.claimMeter.endsAt-value.serverNow,180000-elapsed);assert.equal(value.lineageRings,0);}assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop.offers,['811']);}}
 await f.chat(OTHER,'812','!accept',{messageId:'final-accept'});root=await f.runtime.state.getKeeperRegistry();assert.equal(root.holderId,OTHER);assert.equal((await f.runtime.state.getPublicJourney()).rings,1);assert.deepEqual(completed(f).map(c=>c.broadcaster_id),[HOME,OTHER]);
 for(const host of[HOME,OTHER])assert.equal((await f.runtime.state.getPrivateClaimAcks(host)).rows.find(r=>r.key===completionAckKey(host,root.pendingHop.eventId)).status,'sent');
 await f.chat(OTHER,'812','!accept',{messageId:'final-accept'});await f.raid(HOME,OTHER,1);assert.equal(completed(f).length,2);assert.equal((await f.runtime.state.getPublicJourney()).rings,1);
});
for(const kind of ['memory','firestore']){
 test(`${kind}: partial accept reports actual missing offer; pre-voted receipt completes once with two notices`,async()=>{
  const f=await setup(kind);await f.chat(OTHER,'812','!accept');assert.match(posts(f).at(-1).message,/Accepts 1\/1\. Waiting for Twitch.*Waiting for 1 offer in @raidrelichq/);assert.doesNotMatch(posts(f).at(-1).message,/Bound by/);await f.chat(HOME,'811','!offer');assert.equal((await f.runtime.state.getPublicJourney()).rings,0);f.advance(66204);await f.raid(HOME,OTHER,1);assert.equal((await f.runtime.state.getPublicJourney()).rings,1);assert.equal(completed(f).length,2);
 });
 test(`${kind}: completion commit retry recovers only exact two rows;401 and finalize loss never retry`,async()=>{
  for(const mode of['queued','401','finalize']){const f=await setup(kind);await f.raid(HOME,OTHER,1);await f.chat(HOME,'811','!offer');const process=f.runtime.claimAcks.process;f.runtime.claimAcks.process=async()=>{};await f.chat(OTHER,'812','!accept',{messageId:'completion-original'});f.runtime.claimAcks.process=process;
   if(mode==='401')f.chatFailure('401');const step=f.runtime.state.claimAckStep.bind(f.runtime.state);if(mode==='finalize')f.runtime.state.claimAckStep=(host,op,now)=>op.type==='finish'?Promise.reject(Error('synthetic-finish-loss')):step(host,op,now);
   await f.chat(OTHER,'812','!accept',{messageId:'completion-original'});assert.equal(completed(f).length,2);await f.chat(OTHER,'812','!accept',{messageId:'completion-original'});assert.equal(completed(f).length,2);assert.equal((await f.runtime.state.getPublicJourney()).rings,1);
  }
 });
 test(`${kind}: fresh privacy/policy cancels queued notices, no revival after resume`,async()=>{
  for(const action of['pause','forget','ban']){const f=await setup(kind);await f.raid(HOME,OTHER,1);await f.chat(HOME,'811','!offer');const process=f.runtime.claimAcks.process;f.runtime.claimAcks.process=async()=>{};await f.chat(OTHER,'812','!accept',{messageId:'private-final'});
   if(action==='pause'){await f.control(HOME,'pause');await f.control(HOME,'resume');}else if(action==='forget')await f.chat(HOME,'811','!relic forgetme');else await f.runtime.state.setChannelPolicy(HOME,{banned:true,blockedUserIds:[]},f.now());
   f.runtime.claimAcks.process=process;await f.chat(OTHER,'812','!accept',{messageId:'private-final'});assert.equal(completed(f).length,0);assert.equal((await f.runtime.state.getPublicJourney()).rings,1);
  }
 });
 test(`${kind}: full ACK registers cannot block game transfer or allow same GUID to count on next hop`,async()=>{
  const f=await setup(kind);for(let i=0;i<128;i++)await f.chat(HOME,String(2000+i),'!offer',{messageId:`fill-${i}`}); // bounded votes, all remaining GUIDs still get receipts
  for(let i=0;i<128;i++)await f.chat(OTHER,String(3000+i),'!accept',{messageId:`host-fill-${i}`});
  f.advance();await f.raid(HOME,OTHER,1);assert.equal((await f.runtime.state.getPublicJourney()).rings,1);assert.equal((await f.runtime.state.getKeeperRegistry()).holderId,OTHER);await f.control(OTHER,`send:${HOME}`);await f.chat(OTHER,'3000','!offer',{messageId:'host-fill-0'});assert.deepEqual((await f.runtime.state.getKeeperRegistry()).pendingHop.offers,[]);
 });
}
test('completed fusion has one250ms rise/3000ms plateau/400ms fall; source, reduced and cold remain quiet',()=>{
 assert.equal(FUSION_TIMING.duration,3650);for(const t of[250,800,1800,2800,3200,3250])assert.equal(fusionEnvelope(t),1);assert.equal(fusionEnvelope(-1),0);assert.equal(fusionEnvelope(3650),0);assert.equal(fusionEnvelope(3450),.5);
 const h={role:'host',startedAt:1000,endsAt:181000,completed:true,completedAt:2000},s={status:'ready',serverNow:2000,handoff:h};for(const delta of[200,800,1800,2800,3200]){const phase=cinematicPhase(s,21000+delta,{fresh:true});assert.ok(phase.fusionGlow>=.8);assert.notEqual(phase.fusion,null);assert.equal(cinematicPhase({...s,handoff:{...h,role:'source'}},21000+delta,{fresh:true}).fusion,null);assert.equal(cinematicPhase(s,21000+delta,{fresh:true,reduced:true}).fusionGlow,0);}
 const t=createCinemaTracker();t.observe(s);assert.equal(t.frame(s,21800).fusion,null);assert.equal(t.frame(s,21800).chord,false);
});

test('Firestore final vote rollback/retry keeps both notices, scores, holder and ring atomic',async()=>{
 const f=await setup('firestore');await f.raid(HOME,OTHER,1);await f.chat(HOME,'811','!offer');f.db.failCommit=true;await assert.rejects(()=>f.chat(OTHER,'812','!accept',{messageId:'atomic-final'}));f.db.failCommit=false;assert.equal(completed(f).length,0);assert.equal((await f.runtime.state.getPublicJourney()).rings,0);
 f.db.retry=true;await Promise.all([f.chat(OTHER,'812','!accept',{messageId:'atomic-final'}),f.chat(OTHER,'812','!accept',{messageId:'atomic-final'})]);assert.equal(completed(f).length,2);assert.equal((await f.runtime.state.getPublicJourney()).rings,1);assert.equal((await f.runtime.state.getKeeperRegistry()).holderId,OTHER);
});

test('fusion parent opacity consumes the same envelope, overriding shared inverse progress',async()=>{
 const {readFile}=await import('node:fs/promises');const css=await readFile('public/overlay.css','utf8');assert.match(css,/\.p3-fusion\{opacity:var\(--fusion-glow,0\);/);assert.ok(css.lastIndexOf('.p3-fusion{opacity:var(--fusion-glow,0);')>css.indexOf('opacity:calc(1 - var(--p3-progress))'));
});
