import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreboard, reduceScores, SCORE_LIMITS, TWITCHCON } from '../src/scoreboard.js';
import { createApp } from '../src/app.js';
import { badgeDescription, EVENT_BADGE, holdDuration, validScores } from '../public/scoreboard.js';
import { pilotFixture, HOME, OTHER, BOT } from '../test-support/pilot-fixture.js';
import { hash } from '../src/crypto.js';
const config={channels:[HOME,OTHER],logins:{raidrelichq:HOME,olsols2:OTHER}};
async function setup(kind){const f=await pilotFixture(kind);for(const id of[BOT,HOME,OTHER])await f.login(id);for(const id of[HOME,OTHER]){await f.control(id,'bootstrap');f.advance();await f.control(id,'keep');f.advance();}return f;}
async function hop(f,from,to,offer='811',accept='812'){assert.equal((await f.control(from,`send:${to}`)).status,200);f.advance();await f.raid(from,to,2);await f.chat(from,offer,'!offer');await f.chat(to,accept,'!accept');}
const scores=async f=>JSON.parse((await f.request('/api/scores')).body);
function history(count,base=Date.parse('2026-10-25T12:00:00Z')){return{stops:Array.from({length:count},(_,i)=>({eventId:`actual-${i}`,stopId:`stop-${i}`,ringIndex:i+1,from:i%2?OTHER:HOME,to:i%2?HOME:OTHER,claimedAt:base+i*1000,marks:[]}))};}
for(const kind of ['memory','firestore']) {
 test(`${kind}: scores count actual completed claims only after explicit prior consent; public whitelist`,async()=>{
  const f=await setup(kind);await f.chat(HOME,'811','!relic scores on');await f.chat(OTHER,'812','!relic scores on');
  let v=await scores(f);assert.equal(v.raiders.length,2);assert.equal(v.raiders[0].claimsJoined,0);assert.match(v.coverage,/unknown|not available/);
  await f.control(HOME,`send:${OTHER}`);assert.equal((await scores(f)).rings,0);await f.chat(HOME,'811','!offer');assert.equal((await scores(f)).raiders[0].claimsJoined,0);
  f.advance();await f.raid(HOME,OTHER,2);await f.chat(OTHER,'812','!accept');v=await scores(f);assert.equal(v.rings,1);assert.deepEqual(v.raiders.map(r=>r.claimsJoined),[1,1]);
  assert.deepEqual(Object.keys(v.raiders[0]).sort(),['claimsJoined','login','since']);assert.equal(JSON.stringify(v).includes('actorKey'),false);assert.equal(JSON.stringify(v).includes('userId'),false);assert.equal(JSON.stringify(v).includes('vote'),false);
  assert.ok(v.channels.find(r=>r.channelId===HOME).badges.includes('Ring 1'));assert.equal(v.channels.find(r=>r.channelId===HOME).knownHoldSeconds,0);
  f.advance(86400000);v=await scores(f);assert.equal(v.channels.find(r=>r.channelId===OTHER).knownHoldSeconds,86400);assert.ok(v.channels.find(r=>r.channelId===OTHER).badges.includes('24h Keeper'));
  if(f.db){f.db.writes.length=0;f.db.reads.length=0;await scores(f);assert.equal(f.db.writes.length,0);assert.equal(f.db.reads.length,7);}
 });
 test(`${kind}: late opt-in never counts previous vote or historic participation; replay/erasure stays erased`,async()=>{
  const f=await setup(kind);await f.control(HOME,`send:${OTHER}`);f.advance();await f.raid(HOME,OTHER,1);await f.chat(HOME,'811','!offer');
  await f.chat(HOME,'811','!relic scores on',{messageId:'score-on-original'});await f.chat(OTHER,'812','!accept');assert.equal((await scores(f)).raiders[0].claimsJoined,0);
  f.advance(30001);await f.chat(HOME,'811','!relic forgetme');assert.equal((await scores(f)).raiders.length,0);
  f.advance(30001);await f.chat(HOME,'811','!relic scores on',{messageId:'score-on-original'});assert.equal((await scores(f)).raiders.length,0);
  await f.chat(HOME,'811','!relic scores on',{messageId:'new-opt-in'});assert.equal((await scores(f)).raiders.length,1);await f.chat(HOME,'811','!relic scores off',{messageId:'score-off-original'});assert.equal((await scores(f)).raiders.length,0);f.advance(30001);await f.chat(HOME,'811','!relic scores on',{messageId:'later-explicit-opt-in'});assert.equal((await scores(f)).raiders.length,1);await f.chat(HOME,'811','!relic scores off',{messageId:'score-off-original'});assert.equal((await scores(f)).raiders.length,1);
 });
 test(`${kind}: policy withdrawal/block and bot/copied commands cannot publish or restore identity`,async()=>{
  const f=await setup(kind);await f.chat(HOME,'811','!relic scores on');await f.runtime.state.setChannelPolicy(HOME,{banned:false,blockedUserIds:['811']},f.now());assert.equal((await scores(f)).raiders.length,0);
  await f.chat(HOME,'811','!relic scores on');await f.chat(HOME,BOT,'!relic scores on');
  await f.signed('channel.chat.message',{broadcaster_user_id:HOME,chatter_user_id:'813',chatter_user_login:'copied_name',message_id:'copy-score',source_broadcaster_user_id:OTHER,source_message_id:'00000000-0000-4000-8000-000000000001',message:{text:'!relic scores on',fragments:[]}},HOME,{broadcaster_user_id:HOME,user_id:BOT});
  assert.equal((await scores(f)).raiders.length,0);
  await f.chat(OTHER,'814','!relic scores on');await f.control(OTHER,'opt-out');assert.equal((await scores(f)).raiders.length,0);
 });
 test(`${kind}: exact command ACK delivers once; 401/transport never retry and public queries remain read-only`,async()=>{
  const f=await setup(kind);const posts=()=>f.calls.filter(c=>c.url.endsWith('/chat/messages'));
  await f.chat(HOME,'811','!relic top',{messageId:'score-top'});assert.equal(posts().length,1);assert.match(JSON.parse(posts()[0].body).message,/Recorded Keepers/);assert.ok([...JSON.parse(posts()[0].body).message].length<=500);
  await f.chat(HOME,'811','!relic top',{messageId:'score-top'});assert.equal(posts().length,1);
  f.advance(30001);await f.chat(HOME,'811','!relic badges');assert.match(JSON.parse(posts().at(-1).body).message,/First Keeper/);
  f.advance(30001);f.chatFailure('401');await f.chat(HOME,'811','!relic top',{messageId:'score-401'});const n=posts().length;await f.chat(HOME,'811','!relic top',{messageId:'score-401'});assert.equal(posts().length,n);
  assert.equal((await f.request('/api/scores?limit=21')).status,400);assert.equal((await f.request('/api/scores','POST')).status,405);
 });
 test(`${kind}: actual five/ten completed hops, concurrent final votes and retry commit count once`,async()=>{
  const f=await setup(kind);await f.chat(HOME,'811','!relic scores on');await f.chat(OTHER,'812','!relic scores on');
  for(let i=0;i<10;i++){const from=i%2?OTHER:HOME,to=i%2?HOME:OTHER;await f.control(from,`send:${to}`);f.advance();await f.raid(from,to,1);await f.chat(from,'811','!offer');if(f.db)f.db.retry=true;await Promise.all([f.chat(to,'812','!accept'),f.chat(to,'812','!accept')]);f.advance();}
  const v=await scores(f);assert.equal(v.rings,10);assert.deepEqual(v.raiders.map(r=>r.claimsJoined),[10,10]);assert.ok(v.channels.some(r=>r.badges.includes('Ring 5')));assert.ok(v.channels.some(r=>r.badges.includes('Ring 10')));assert.ok(v.channels.some(r=>r.badges.includes('Chain of 3')));
 });
}
for(const kind of ['memory','firestore']) {
 test(`${kind}: capacity rejects consent clearly without blocking a completed game transfer`,async()=>{
  const f=await setup(kind);for(let i=0;i<128;i++)await f.chat(i%2?HOME:OTHER,String(1000+i),'!relic scores on');f.advance(600001);
  const n=f.calls.filter(c=>c.url.endsWith('/chat/messages')).length;await f.chat(HOME,'9999','!relic scores on');const replies=f.calls.filter(c=>c.url.endsWith('/chat/messages'));assert.equal(replies.length,n+1);assert.match(JSON.parse(replies.at(-1).body).message,/full/);
  await hop(f,HOME,OTHER,'1000','1001');assert.equal((await scores(f)).rings,1);assert.equal((await scores(f)).raiders.length,20);
 });
 test(`${kind}: queued consent reply cannot leak a forgotten name; wrong identity cannot opt in`,async()=>{
  const f=await setup(kind);const channel=HOME,actor='811';const chat={broadcasterId:channel,chatterId:actor,chatterLogin:'private_name',messageId:'queued-optin',markAction:{type:'scores-on'}};
  await f.runtime.state.accept({id:'queued-command',now:f.now(),sentAt:f.now(),expiresAt:f.now()+600000,chat});await f.chat(HOME,actor,'!relic forgetme');
  const {ackKey}=await import('../src/claim-ack.js');assert.equal(await f.runtime.state.scoreAckStep(HOME,{type:'claim',key:ackKey(chat)},f.now()),null);assert.equal((await scores(f)).raiders.length,0);
  await f.signed('channel.chat.message',{broadcaster_user_id:HOME,chatter_user_id:'812',chatter_user_login:'<script>',chatter_user_name:'innocent',message_id:'bad-login',message:{text:'!relic scores on',fragments:[]}},HOME,{broadcaster_user_id:HOME,user_id:BOT});assert.equal((await scores(f)).raiders.length,0);
 });
}
for(const kind of ['memory','firestore']) test(`${kind}: transport ambiguity and lost finalization never repeat exact score bot POST`,async()=>{
 const f=await setup(kind);const posts=()=>f.calls.filter(c=>c.url.endsWith('/chat/messages')).length;
 f.chatFailure('transport');await f.chat(HOME,'811','!relic top',{messageId:'score-timeout'});const n=posts();await f.chat(HOME,'811','!relic top',{messageId:'score-timeout'});assert.equal(posts(),n);
 f.chatFailure(null);const original=f.runtime.state.scoreAckStep.bind(f.runtime.state);f.runtime.state.scoreAckStep=(host,op,now)=>op.type==='finish'?Promise.reject(Error('synthetic-finalize-failure')):original(host,op,now);
 await f.chat(HOME,'812','!relic top',{messageId:'score-lost-finish'});const after=posts();await f.chat(HOME,'812','!relic top',{messageId:'score-lost-finish'});assert.equal(posts(),after);assert.equal(after,n+1);
});
test('strict public score validator rejects malformed names/fields and never accepts HTML or private associations',()=>{
 const base=scoreboard({stops:[]},{originated:true},null,config,Date.parse('2026-10-25T20:00:00Z')),v={...base,mode:'live',previewReadOnly:false};assert.equal(validScores(v),true);
 for(const patch of [{raiders:[null]},{raiders:[{login:'<script>',claimsJoined:1,since:1}]},{userId:'811'},{channels:[{...v.channels[0],actor:'private'}]}])assert.equal(validScores({...v,...patch}),false);
});
test('Firestore rollback never commits participant scores independently of transfer',async()=>{
 const f=await setup('firestore');await f.chat(HOME,'811','!relic scores on');await f.chat(OTHER,'812','!relic scores on');await f.control(HOME,`send:${OTHER}`);f.advance();await f.raid(HOME,OTHER,1);await f.chat(HOME,'811','!offer');
 f.db.failCommit=true;await assert.rejects(()=>f.chat(OTHER,'812','!accept'));f.db.failCommit=false;assert.equal((await scores(f)).rings,0);assert.ok((await scores(f)).raiders.every(r=>r.claimsJoined===0));await f.chat(OTHER,'812','!accept');assert.equal((await scores(f)).rings,1);assert.ok((await scores(f)).raiders.every(r=>r.claimsJoined===1));
});
test('known keeper coverage, zero/16 rings, cumulative time, deterministic ties and invalid archive fail closed',()=>{
 const base=Date.parse('2026-10-25T12:00:00Z');const zero=scoreboard({stops:[]},{originated:true},undefined,config,base);assert.equal(zero.rings,0);assert.ok(zero.channels.find(r=>r.channelId===HOME).badges.includes('First Keeper'));assert.ok(zero.channels.every(r=>r.knownHoldSeconds===0));
 const h=history(16,base),v=scoreboard(h,{holderId:HOME},undefined,config,base+16000);assert.equal(v.rings,16);assert.equal(v.channels.reduce((n,r)=>n+r.hopsCarried,0),16);assert.equal(v.channels.reduce((n,r)=>n+r.knownHoldSeconds,0),16);
 const broken=structuredClone(h);broken.stops[2].claimedAt=base-1;assert.throws(()=>scoreboard(broken,{},null,config,base+16000));broken.stops[2]=structuredClone(h.stops[2]);broken.stops[2].eventId=broken.stops[0].eventId;assert.throws(()=>scoreboard(broken,{},null,config,base+16000));
 const discontinuous=history(3);discontinuous.stops[1].from=HOME;assert.throws(()=>scoreboard(discontinuous,{},null,config,base+10000));
});
test('TwitchCon badge official San Diego PST boundaries, never October',()=>{
 for(const [time,awarded] of [[Date.parse('2026-10-25T20:00:00Z'),false],[TWITCHCON.startsAt-1,false],[TWITCHCON.startsAt,true],[TWITCHCON.endsAt-1,true],[TWITCHCON.endsAt,false]]){const v=scoreboard(history(1,time),{holderId:OTHER},null,config,time);assert.equal(v.channels.some(r=>r.badges.includes('Carried during TwitchCon San Diego 2026')),awarded);}
});
test('128 consent capacity refuses new entries but completion and bounded receipts continue',()=>{
 const channels={[HOME]:{online:true,optedIn:true,blockedUserIds:[]}},marks={[HOME]:{context:{optedIn:true},blocked:[]}};let doc;
 for(let i=0;i<128;i++){doc=reduceScores(doc,{channels,marks,chat:{broadcasterId:HOME,chatterId:String(i+1),chatterLogin:`person${i}`,messageId:`opt-${i}`,markAction:{type:'scores-on'}},now:1000}).doc;}
 const next=reduceScores(doc,{channels,marks,chat:{broadcasterId:HOME,chatterId:'999',chatterLogin:'extra',messageId:'extra',markAction:{type:'scores-on'}},now:602000});assert.equal(next.doc.players.length,128);assert.match(next.message,/full/);assert.ok(Buffer.byteLength(JSON.stringify(next.doc))<SCORE_LIMITS.bytes);
});
test('preview blocks EVERY mutation, OAuth/controls before store/auth/network; GET scores has no writes',async()=>{
 let touched=0;const state=new Proxy({getScoreboard:()=>({channels:[],raiders:[],rings:0})},{get(t,k){return k in t?t[k]:(()=>{touched++;throw Error();});}});const oauth={callbackPath:'/auth/callback',route(){touched++;},control:{route(){touched++;}}};const app=createApp({previewReadOnly:true,state,oauth});
 for(const path of ['/eventsub','/api/forge','/api/atlas/search','/api/my-marks','/control/1591805230','/oauth/bot/start','/oauth/keeper/1591806023/start','/auth/callback'])for(const method of ['POST','PUT','DELETE'])assert.equal((await app.dispatch({method,path,rawBody:Buffer.from('{}')})).status,403);
 for(const path of ['/control/1591805230/status','/oauth/bot/start','/auth/callback?code=not-real'])assert.equal((await app.dispatch({method:'GET',path})).status,403);
 assert.equal(touched,0);const r=await app.dispatch({method:'GET',path:'/api/scores'});assert.equal(r.status,200);assert.equal(JSON.parse(r.body).previewReadOnly,true);assert.equal(touched,0);const html=String((await app.dispatch({method:'GET',path:'/'})).body);assert.equal((html.match(/id="score-preview"/g)??[]).length,1);assert.match(html,/id="score-preview"[^>]*hidden>Read-only preview/);assert.equal(html.includes('<aside role="status">P5 READ-ONLY PREVIEW'),false);
});

for(const kind of ['memory','firestore']) {
 test(`${kind}: full score receipts AND score outbox cannot prevent self withdrawal or consume game ACKs`,async()=>{
  const f=await setup(kind);await f.chat(HOME,'811','!relic scores on');await f.chat(OTHER,'812','!relic scores on');await hop(f,HOME,OTHER);
  for(let i=0;i<128;i++)await f.chat(HOME,String(2000+i),'!relic top');
  if(f.db){assert.equal(f.db.docs.get(`scoreboard/${hash('single')}`).receipts.length,128);assert.equal(f.db.docs.get(`scoreAcks/${hash(HOME)}`).rows.length,128);}
  const before=await f.runtime.state.getPrivateClaimAcks(HOME), posts=f.calls.filter(c=>c.url.endsWith('/chat/messages')).length;
  await f.chat(HOME,'811','!relic scores off',{messageId:'full-off'});await f.chat(HOME,'811','!relic scores off',{messageId:'full-off'});
  const v=await scores(f);assert.equal(v.raiders.some(r=>r.login==='viewer811'),false);assert.equal(v.raiders.find(r=>r.login==='viewer812').claimsJoined,1);assert.deepEqual(await f.runtime.state.getPrivateClaimAcks(HOME),before);assert.equal(f.calls.filter(c=>c.url.endsWith('/chat/messages')).length,posts);
  if(f.db){const doc=f.db.docs.get(`scoreboard/${hash('single')}`);assert.equal(JSON.stringify(doc.players).includes('viewer811'),false);}
 });
 test(`${kind}: pause/offline/real new stream preserve earned consent; true withdrawal remains erased after resume`,async()=>{
  const f=await setup(kind);await f.chat(HOME,'811','!relic scores on');await hop(f,HOME,OTHER);const original=(await scores(f)).raiders.find(r=>r.login==='viewer811');assert.equal(original.claimsJoined,1);
  await f.control(HOME,'pause');await f.chat(HOME,'811','!relic scores on');await f.raid(OTHER,HOME,1);await f.chat(HOME,'811','!accept');assert.equal((await scores(f)).rings,1);assert.equal((await f.runtime.state.getKeeperRegistry()).holderId,OTHER);assert.deepEqual((await scores(f)).raiders.find(r=>r.login==='viewer811'),original);
  f.advance();await f.signed('stream.offline',{broadcaster_user_id:HOME},HOME);f.advance(1001);await f.signed('stream.online',{broadcaster_user_id:HOME,id:'99901',type:'live',started_at:new Date(f.now()).toISOString()},HOME);await f.control(HOME,'resume');assert.deepEqual((await scores(f)).raiders.find(r=>r.login==='viewer811'),original);
  await f.control(HOME,'opt-out');await f.control(HOME,'keep');await f.control(HOME,'resume');assert.equal((await scores(f)).raiders.length,0);
 });
 test(`${kind}: GET fresh policy filter is read-only even when cached score purge was bypassed`,async()=>{
  const f=await setup(kind);await f.chat(HOME,'811','!relic scores on');
  if(f.db){const r=`streamChannels/${hash(HOME)}`,c=f.db.docs.get(r);c.blockedUserIds=['811'];f.db.docs.set(r,c);f.db.writes.length=0;assert.equal((await scores(f)).raiders.length,0);assert.equal(f.db.writes.length,0);}
  else {await f.runtime.state.setChannelPolicy(HOME,{banned:true,blockedUserIds:[]},f.now());assert.equal((await scores(f)).raiders.length,0);}
 });
}
test('specific-channel event badge uses proven half-open holds/current instant, never guessed initial time',()=>{
 const badge=(h,holder,now,id)=>scoreboard(h,{holderId:holder},null,config,now).channels.find(r=>r.channelId===id).badges.includes('Carried during TwitchCon San Diego 2026');
 const start=TWITCHCON.startsAt,end=TWITCHCON.endsAt,h=history(1,start-1000);
 assert.equal(badge(h,OTHER,start-1,OTHER),false);assert.equal(badge(h,OTHER,start,OTHER),true);assert.equal(badge(h,OTHER,start,HOME),false);
 const crossing=history(2,start-1000);crossing.stops[1].claimedAt=end+1000;assert.equal(badge(crossing,HOME,end+2000,OTHER),true);
 const ended=history(2,start-2000);ended.stops[1].claimedAt=start;assert.equal(badge(ended,HOME,start,OTHER),false);assert.equal(badge(ended,HOME,start,HOME),true);
 const atEnd=history(1,end);assert.equal(badge(atEnd,OTHER,end,OTHER),false);assert.equal(badge(atEnd,OTHER,end+1000,HOME),false);
 assert.equal(badge(history(1,start-2000),null,start-1000,OTHER),false);
});

test('compact duration keeps exact seconds independently available',()=>{assert.equal(holdDuration(0),'0s');assert.equal(holdDuration(86400),'1d');assert.equal(holdDuration(90061),'1d 1h 1m 1s');});

test('every earned badge has a human meaning; event label is only a locked UI affordance until earned',async()=>{
 for(const name of ['First Keeper','24h Keeper','Ring 1','Ring 5','Ring 10','Chain of 3',EVENT_BADGE])assert.ok(badgeDescription(name).length>20);
 assert.match(badgeDescription('Chain of 3'),/third or later raid in an unbroken chain/);assert.match(badgeDescription(EVENT_BADGE),/13–15 Nov 2026/);assert.equal(badgeDescription('__proto__'),'');
 const {readFile}=await import('node:fs/promises');const html=await readFile('public/atlas.html','utf8');assert.ok(html.indexOf('id="keeper-scores"')<html.indexOf('<nav'));assert.equal(html.includes('Reading recorded scores'),false);assert.match(html,/Recorded journeys only; the first hold and past raiders are unknown/);
});
