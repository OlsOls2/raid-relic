import test from 'node:test';
import assert from 'node:assert/strict';
import { cinematicPhase, ambientSigils, decorativePoints } from '../public/cinematic.js';
import { validSnapshot } from '../public/overlay-client.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
const snapshot = { status:'incoming', marks:[], handoff:{ role:'host', startedAt:1000, endsAt:181000, sourceLogin:'raidrelichq', completed:false } };
test('15fps arrival has 45 visible comet frames and one capped soft pulse, then bounded shock', () => {
  const samples = Array.from({length:300},(_,i)=>cinematicPhase(snapshot,1000+i*1000/15,{fresh:true}));
  assert.equal(samples.filter(p=>p.comet!==null).length,45);
  const bright = samples.map(p=>p.flash>0); let runs=0;
  bright.forEach((v,i)=>{ if(v&&!bright[i-1]) runs++; }); assert.equal(runs,1);
  assert.ok(bright.filter(Boolean).length>=8); assert.ok(samples.every(p=>p.flash<=.45&&Math.abs(p.shake)<=3));
  assert.ok(samples.filter(p=>p.shock!==null).length>=20);
  for(const t of [1200,2500,3800]) assert.notEqual(cinematicPhase(snapshot,t).comet,null);
  for(const t of [4200,4600]) assert.ok(cinematicPhase(snapshot,t,{fresh:true}).flash>0);
  assert.equal(cinematicPhase(snapshot,4700,{fresh:true}).flash,0);
  assert.equal(cinematicPhase(snapshot,4400,{fresh:false}).shock,null);
});
test('six original ambient vectors only for empty verified target unfurl; never approved-mark entries', () => {
  for(const t of [6500,13000,20000]) assert.equal(ambientSigils(snapshot,cinematicPhase(snapshot,t)),6);
  assert.equal(ambientSigils({...snapshot,marks:[{id:'m1'}]},cinematicPhase(snapshot,7000)),0);
  assert.equal(ambientSigils(snapshot,cinematicPhase(snapshot,7000),true),0);
  assert.equal(ambientSigils(snapshot,cinematicPhase(snapshot,3000)),0);
  assert.equal(ambientSigils({...snapshot,handoff:{...snapshot.handoff,sourceLogin:'viewer'}},cinematicPhase(snapshot,7000)),0);
  assert.equal(ambientSigils(snapshot,cinematicPhase({...snapshot,handoff:{...snapshot.handoff,role:'source'}},7000)),0);
  const points=Array.from({length:6},(_,i)=>decorativePoints(i)); assert.equal(new Set(points).size,6);
  assert.ok(points.every(p=>/^[\d., -]+$/.test(p)));
});
for(const kind of ['memory','firestore']) test(`${kind}: verified Keeper caption crosses safe HTTP/feed only, zero approved count remains truthful`,async()=>{
  const f=await pilotFixture(kind); for(const id of [BOT,HOME,OTHER]) await f.login(id);
  for(const id of [HOME,OTHER]) { await f.control(id,'bootstrap'); f.advance(); await f.control(id,'keep'); f.advance(); }
  await f.control(HOME,`send:${OTHER}`);
  assert.equal((await f.runtime.overlayFeeds[OTHER].snapshot()).handoff,null);
  f.advance(); await f.raid(HOME,OTHER,2);
  const v=await f.runtime.overlayFeeds[OTHER].snapshot(); assert.equal(v.handoff.sourceLogin,'raidrelichq'); assert.equal(v.approvedCount,0); assert.deepEqual(v.marks,[]); assert.equal(validSnapshot(v),true);
  assert.equal(validSnapshot({...v,handoff:{...v.handoff,sourceLogin:'<viewer>'}}),false);
  assert.equal(validSnapshot({...v,handoff:{...v.handoff,sourceLogin:HOME}}),false);
  const response=await f.request(`/api/overlay/${OTHER}`); assert.equal(response.status,200);
  const http=JSON.parse(response.body); assert.equal(http.handoff.sourceLogin,v.handoff.sourceLogin); assert.equal(http.approvedCount,0); assert.deepEqual(http.marks,[]);
  for(const key of ['from','to','userId','sourceStreamId','intentId']) assert.equal(Object.hasOwn(http.handoff,key),false);
  assert.equal((await f.runtime.state.getPublicJourney()).rings,0);
  await f.chat(HOME,HOME,'!offer'); await f.chat(OTHER,OTHER,'!accept');
  const complete=await f.runtime.overlayFeeds[OTHER].snapshot(); assert.equal(complete.lineageRings,1); assert.equal(complete.approvedCount,0); assert.deepEqual(complete.marks,[]);
});
