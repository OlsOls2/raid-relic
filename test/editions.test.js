import test from 'node:test';
import assert from 'node:assert/strict';
import {EDITION_CONFIG,EDITION_BADGE,validEditions,selectEdition,editionBadgeForInterval,editionBadgesForInterval,editionWindowLabel,editionSVG} from '../public/editions.js';
import {validRelicDesign,crystalMesh,DEFAULT_DESIGN} from '../public/relic3d.js';
import {scoreboard,TWITCHCON} from '../src/scoreboard.js';
import {validScores,badgeDescription} from '../public/scoreboard.js';
import {pilotFixture,HOME,OTHER,BOT} from '../test-support/pilot-fixture.js';
const edition=EDITION_CONFIG[0],start=Date.parse(edition.startsAt),end=Date.parse(edition.endsAt),config={channels:[HOME,OTHER],logins:{raidrelichq:HOME,olsols2:OTHER}};
test('edition config frozen, exact inclusive start/exclusive end, one original deterministic design',()=>{
 assert.ok(Object.isFrozen(edition.design.palette));assert.equal(validEditions(EDITION_CONFIG),true);
 for(const t of [start-1,end,end+1,NaN,Infinity,undefined])assert.equal(selectEdition(t),null);
 for(const t of [start,start+1000,end-1])assert.equal(selectEdition(t),edition);
 assert.equal(validRelicDesign(edition.design),true);assert.equal(crystalMesh(edition.design).triangles,48);assert.equal(DEFAULT_DESIGN.facets,6);
 assert.ok(crystalMesh(edition.design).triangles*2+16*2*8*24*2+160*2<20000);
 assert.equal(edition.particles.count,64);assert.match(editionSVG(edition),/#e6bb70/);assert.equal(editionSVG(null),null);
});
test('malformed, overlapping, duplicate and unknown edition config fails closed to base',()=>{
 const clone=()=>JSON.parse(JSON.stringify(edition));
 for(const change of [e=>e.extra=true,e=>e.startsAt='bad',e=>e.endsAt=e.startsAt,e=>e.startsAt='2026-02-30T00:00:00Z',e=>e.design.palette[0]='url(x)',e=>e.design.facets=13,e=>e.particles.count=97,e=>e.particles.kind='script',e=>e.name='<img>']){const e=clone();change(e);assert.equal(validEditions([e]),false);assert.equal(selectEdition(start,[e]),null);}
 assert.equal(validEditions([edition,edition]),false);assert.equal(validEditions([edition,{...edition,id:'next',badgeLabel:'Carried during Next edition',startsAt:edition.endsAt,endsAt:'2026-12-02T00:00:00Z'}]),true);assert.equal(validEditions([edition,{...edition,id:'overlap'}]),false);assert.equal(selectEdition(start,[{...edition,id:'__proto__'}]),null);
});
test('edition hold evidence is independent from official November conference evidence, with no initial duration guess',()=>{
 const stop={eventId:'real-stop',from:HOME,to:OTHER,claimedAt:start-1000,ringIndex:1};
 const read=(at,stops=[stop],holder=OTHER)=>scoreboard({stops},{holderId:holder,originated:true},undefined,config,at);
 assert.equal(read(start-1).channels.find(r=>r.channelId===OTHER).badges.includes(EDITION_BADGE),false);
 assert.equal(read(start).channels.find(r=>r.channelId===OTHER).badges.includes(EDITION_BADGE),true);
 assert.equal(read(start,[]).channels.some(r=>r.badges.includes(EDITION_BADGE)),false);
 const late={...stop,claimedAt:end};assert.equal(read(end,[late]).channels.some(r=>r.badges.includes(EDITION_BADGE)),false);
 const current=read(Date.parse('2026-10-26T12:00:00Z'));assert.ok(current.channels.find(r=>r.channelId===OTHER).badges.includes(EDITION_BADGE));assert.ok(!current.channels.some(r=>r.badges.includes('Carried during TwitchCon San Diego 2026')));
 assert.equal(TWITCHCON.startsAt,Date.parse('2026-11-13T08:00:00Z'));assert.equal(TWITCHCON.endsAt,Date.parse('2026-11-16T08:00:00Z'));
 assert.equal(editionBadgeForInterval(start-1,start),false);assert.equal(editionBadgeForInterval(start-1,start,{ongoing:true}),true);assert.equal(editionBadgeForInterval(end,end+1),false);
 assert.ok(badgeDescription(EDITION_BADGE).includes('cosmetic'));
});
for(const kind of ['memory','firestore'])test(`${kind}: only actual stored claim earns edition badge; public reads don't mutate/opt-in`,async()=>{
 const f=await pilotFixture(kind);for(const id of [BOT,HOME,OTHER])await f.login(id);for(const id of[HOME,OTHER]){await f.control(id,'bootstrap');f.advance();await f.control(id,'keep');f.advance();}
 await f.control(HOME,`send:${OTHER}`);let v=JSON.parse((await f.request('/api/scores')).body);assert.equal(v.channels.some(r=>r.badges.includes(EDITION_BADGE)),false);assert.equal(v.rings,0);
 f.advance();await f.raid(HOME,OTHER,1);await f.chat(HOME,'811','!offer');await f.chat(OTHER,'812','!accept');
 const root=await f.runtime.state.getKeeperRegistry(),writes=f.db?.writes.length,calls=f.calls.length;
 v=JSON.parse((await f.request('/api/scores')).body);assert.equal(v.rings,1);assert.ok(v.channels.some(r=>r.badges.includes(EDITION_BADGE)));assert.equal(validScores(v),true);assert.equal(v.raiders.length,0);assert.deepEqual(await f.runtime.state.getKeeperRegistry(),root);assert.equal(f.db?.writes.length,writes);assert.equal(f.calls.length,calls);
 await f.chat(HOME,'811','!relic forgetme');v=JSON.parse((await f.request('/api/scores')).body);assert.equal(v.raiders.length,0);assert.equal(v.rings,1);assert.ok(!JSON.stringify(v).includes('811'));
});

test('presentation clears edition on a later BASE render without duplicate labels or changing game data',async()=>{
 const {presentEdition}=await import('../public/edition-view.js');let src='/crystal.svg',labels=0,removed=0;const attributes={};
 const image={getAttribute:()=>src,setAttribute:(key,value)=>{src=value;}};
 const archive={dataset:{},querySelector:()=>image,ownerDocument:{body:{classList:{contains:()=>false}},createElement:()=>({style:{},remove(){removed++;}})},after(){labels++;},setAttribute:(key,value)=>{attributes[key]=value;},removeAttribute:key=>delete attributes[key]};
 assert.equal(presentEdition(archive,start).id,edition.id);assert.equal(labels,1);assert.equal(src,'/edition-crystal/twitchcon-2026.svg');presentEdition(archive,start+1);assert.equal(labels,1);presentEdition(archive,end);assert.equal(src,'/crystal.svg');assert.equal(archive.dataset.edition,'base');assert.equal(removed,1);
});

test('second event derives its own dates and earned label; malformed badge labels fail closed',()=>{
 const next={...edition,id:'winter-2027',name:'Winter 2027',badgeLabel:'Carried during Winter 2027 edition',startsAt:'2027-01-02T00:00:00Z',endsAt:'2027-01-05T00:00:00Z'};
 assert.equal(validEditions([edition,next]),true);assert.equal(editionWindowLabel(next),'2 Jan–4 Jan 2027 UTC');assert.equal(editionWindowLabel(edition),'23 Oct–30 Nov 2026 UTC');
 assert.deepEqual(editionBadgesForInterval(Date.parse(next.startsAt),Date.parse(next.endsAt),{list:[edition,next]}),[next.badgeLabel]);
 for(const badgeLabel of ['', '<img>', 'x'.repeat(97)])assert.equal(validEditions([{...next,badgeLabel}]),false);
 assert.equal(validEditions([{...next,badgeUnknown:'bad'}]),false);
});
test('same-origin edition SVG is decoded art, pure before OAuth/store and rejects unknown/mutating routes',async()=>{
 const {createApp}=await import('../src/app.js');let touched=0;const trap=new Proxy({},{get(){touched++;throw Error();}}),app=createApp({state:trap,oauth:trap});
 const r=await app.dispatch({method:'GET',path:'/edition-crystal/twitchcon-2026.svg'});assert.equal(r.status,200);assert.equal(r.type,'image/svg+xml');assert.equal(String(r.body),editionSVG(edition));assert.equal((String(r.body).match(/<path /g)||[]).length,edition.design.facets);
 for(const path of ['/edition-crystal/unknown.svg','/edition-crystal/twitchcon-2026.svg?x=1'])assert.equal((await app.dispatch({method:'GET',path})).status,404);
 assert.equal((await app.dispatch({method:'POST',path:'/edition-crystal/twitchcon-2026.svg'})).status,405);assert.equal(touched,0);
});
