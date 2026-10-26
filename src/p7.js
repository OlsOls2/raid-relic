import { hash } from './crypto.js';
import { boundedCall } from './bounded.js';
import { completionEligible } from './claim-ack.js';
export { P7_SCOPES } from './p7-scopes.js';
export const P7_KINDS=Object.freeze(['announcement','pin','shoutout']);
export function p7Config(env={}){
 const configured={master:env.P7_BOT_ACTIONS_ENABLED==='true',announcement:env.P7_ANNOUNCEMENTS_ENABLED==='true',pin:env.P7_PIN_ENABLED==='true',shoutout:env.P7_SHOUTOUTS_ENABLED==='true',pinReplace:env.P7_ALLOW_PIN_REPLACE==='true',duration:env.P7_PIN_DURATION_SECONDS===undefined?300:/^[1-9]\d{1,3}$/.test(env.P7_PIN_DURATION_SECONDS)&&Number(env.P7_PIN_DURATION_SECONDS)>=30&&Number(env.P7_PIN_DURATION_SECONDS)<=1800?Number(env.P7_PIN_DURATION_SECONDS):null};
 const off={enabled:false,announcement:false,pin:false,shoutout:false,duration:300,configured};
 if(env.P7_BOT_ACTIONS_ENABLED!=='true')return off;
 for(const k of['P7_ANNOUNCEMENTS_ENABLED','P7_PIN_ENABLED','P7_SHOUTOUTS_ENABLED','P7_ALLOW_PIN_REPLACE'])if(env[k]!==undefined&&!['true','false'].includes(env[k]))return off;
 if(env.P7_PIN_DURATION_SECONDS!==undefined&&(typeof env.P7_PIN_DURATION_SECONDS!=='string'||!/^\d{2,4}$/.test(env.P7_PIN_DURATION_SECONDS)))return off;
 const duration=env.P7_PIN_DURATION_SECONDS===undefined?300:Number(env.P7_PIN_DURATION_SECONDS);
 if((env.P7_PIN_DURATION_SECONDS?.startsWith('0'))||!Number.isInteger(duration)||duration<30||duration>1800)return off;
 const flags={announcement:env.P7_ANNOUNCEMENTS_ENABLED==='true',pin:env.P7_PIN_ENABLED==='true'&&env.P7_ALLOW_PIN_REPLACE==='true',shoutout:env.P7_SHOUTOUTS_ENABLED==='true'};
 return{...flags,duration,configured,enabled:Object.values(flags).some(Boolean)};
}
export const p7Key=(kind,host,eventId)=>hash(JSON.stringify(['p7-action-v1',kind,host,eventId]));
const messageId=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
function fresh(row,registry,lineage,channels,marks,now){
 if(!row||!Number.isSafeInteger(row.claimedAt)||now<row.claimedAt||now>=row.deadline||row.host!==row.proof?.to||row.source!==row.proof?.from||!Number.isInteger(row.ring)||row.ring<1||row.ring>16)return false;
 const s=lineage?.stops?.find(s=>s.eventId===row.proof.eventId&&s.from===row.proof.from&&s.to===row.proof.to&&s.claimedAt===row.claimedAt&&s.stopId===row.stopId&&s.ringIndex===row.ring);
 return !!s&&completionEligible({rows:[{key:row.key,completion:row.proof,ackUntil:row.deadline}]},row.key,registry,channels,marks,now);
}
export function enqueueP7(previous,ack,host,message,flags,registry,lineage,channels,marks,now){
 const unchanged={doc:previous,keys:[]};if(!flags?.enabled||!messageId(message)||!ack?.p7Proof||ack.status!=='sent'||ack.p7Proof.to!==host)return unchanged;
 const stop=lineage?.stops?.find(s=>s.eventId===ack.p7Proof.eventId&&s.from===ack.p7Proof.from&&s.to===host);if(!stop)return unchanged;
 const base={host,source:ack.p7Proof.from,proof:ack.p7Proof,stopId:stop.stopId,claimedAt:stop.claimedAt,deadline:stop.claimedAt+30000,ring:stop.ringIndex};
 if(!fresh({...base,key:ack.key},registry,lineage,channels,marks,now))return unchanged;
 const doc=structuredClone(previous??{rows:[],cooldowns:{},clock:0});doc.rows=doc.rows.filter(r=>r.expiresAt>now);const keys=[];
 for(const kind of P7_KINDS){if(!flags[kind])continue;const key=p7Key(kind,host,base.proof.eventId);if(doc.rows.some(r=>r.key===key))continue;if(doc.rows.length>=64)continue;
  const row={...base,key,kind,status:'queued',expiresAt:now+600000,...(kind==='pin'?{messageId:message}:{})};doc.rows.push(row);if(Buffer.byteLength(JSON.stringify(doc))>65536){doc.rows.pop();continue;}keys.push(key);
 }return{doc,keys};
}
export function p7Mutation(previous,op,flags,registry,lineage,channels,marks,now){
 if(!flags?.enabled||!previous)return{doc:previous,result:null};
 const doc=structuredClone(previous??{rows:[],cooldowns:{},clock:0});doc.rows=doc.rows.filter(r=>r.expiresAt>now);const row=doc.rows.find(r=>r.key===op.key);let result=null;
 if(row?.status==='queued'&&(!P7_KINDS.includes(row.kind)||!flags[row.kind]||!fresh(row,registry,lineage,channels,marks,now)||row.key!==p7Key(row.kind,row.host,row.proof.eventId))){row.status='cancelled';delete row.proof;delete row.messageId;}
 if(row?.status==='queued'&&op.type==='inspect')result=structuredClone(row);
 if(row?.status==='queued'&&op.type==='claim'){
  const pair=`pair:${row.proof.from}`,kind=row.kind,until=doc.cooldowns[kind]??0;
  if(now<(doc.clock??0)||now<until||(kind==='shoutout'&&now<(doc.cooldowns[pair]??0))){row.status='cooldown';delete row.proof;delete row.messageId;}
  else {doc.clock=now;doc.cooldowns[kind]=now+({announcement:10000,pin:60000,shoutout:120000}[kind]);if(kind==='shoutout')doc.cooldowns[pair]=now+3600000;row.status='dispatching';result=structuredClone(row);delete row.messageId;delete row.proof;}
 }
 if(row?.status==='dispatching'&&op.type==='finish'){
  row.status=op.outcome==='sent'?'sent':op.outcome==='rate-limited'?'rate-limited':op.outcome==='blocked'?'blocked':'unknown';
  if(Number.isInteger(op.httpStatus)&&op.httpStatus>=100&&op.httpStatus<=599)row.httpStatus=op.httpStatus;
  if(row.status==='rate-limited'&&Number.isSafeInteger(op.retryAt)&&op.retryAt>now&&op.retryAt<=now+86400000){doc.cooldowns[row.kind]=Math.max(doc.cooldowns[row.kind]??0,op.retryAt);if(row.kind==='shoutout')doc.cooldowns[`pair:${row.source}`]=Math.max(doc.cooldowns[`pair:${row.source}`]??0,op.retryAt);}
 }
 if(Buffer.byteLength(JSON.stringify(doc))>65536)throw Error('P7 capacity');
 return{doc,result};
}
// This transport alone accepts empty204. The existing OAuth protocol stays unchanged.
export async function p7HTTP(url,options={},fetchImpl=globalThis.fetch){
 return boundedCall(async signal=>{
  const r=await fetchImpl(url,{...options,signal,redirect:'error'});let data=null;
  if(r.status===200){let text='';if(r.body?.getReader){const reader=r.body.getReader(),chunks=[];let size=0;try{for(;;){const v=await reader.read();if(v.done)break;size+=v.value.byteLength;if(size>65536){void reader.cancel().catch(()=>{});throw Error('P7 response');}chunks.push(v.value);}const b=new Uint8Array(size);let at=0;for(const c of chunks){b.set(c,at);at+=c.byteLength;}text=new TextDecoder('utf-8',{fatal:true}).decode(b);}finally{reader.releaseLock();}}else{text=await r.text();if(Buffer.byteLength(text)>65536)throw Error('P7 response');}try{data=JSON.parse(text);}catch{throw Error('P7 response');}}
  if(r.status!==200&&r.status!==204){try{await r.body?.cancel?.();}catch{ /* Discard errors without exposing the body. */ }}
  const numeric=name=>{const v=r.headers?.get(name);return typeof v==='string'&&/^\d{1,12}$/.test(v)?Number(v):null;};
  return{status:r.status,data,retryAfter:numeric('retry-after'),rateReset:numeric('ratelimit-reset')};
 });
}
export function createP7({flags,env, state,oauth,clientId,clientSecret,botId,keeperIds,logins={},transport=p7HTTP,now=Date.now,logger=line=>console.warn(line)}){
 const config=flags??p7Config(env);const settings=config.configured??{master:config.enabled===true,announcement:config.announcement===true,pin:config.pin===true,shoutout:config.shoutout===true,pinReplace:config.pin===true,duration:Number.isInteger(config.duration)&&config.duration>=30&&config.duration<=1800?config.duration:null};const safeSettings=()=>({master:settings.master===true,announcement:settings.announcement===true,pin:settings.pin===true,shoutout:settings.shoutout===true,pinReplace:settings.pinReplace===true,duration:Number.isInteger(settings.duration)&&settings.duration>=30&&settings.duration<=1800?settings.duration:null});const effective=()=>({announcement:config.enabled===true&&config.announcement===true,pin:config.enabled===true&&config.pin===true,shoutout:config.enabled===true&&config.shoutout===true});if(!config.enabled)return{enabled:false,config,status:()=>({enabled:false,reason:'disabled',configured:safeSettings(),effective:effective()}),async process(){return{status:'disabled'};}};
 if(!Array.isArray(keeperIds)||keeperIds.length<2||keeperIds.length>4||new Set(keeperIds).size!==keeperIds.length||!keeperIds.every(v=>/^\d{1,32}$/.test(v))||!/^\d{1,32}$/.test(botId)||keeperIds.includes(botId))throw Error('P7 configured identities');
 let app=null,minting=null,roles=null,checking=null,grantsUntil=0;
 const call=(url,options)=>boundedCall(signal=>transport(url,{...options,signal}));
 async function appToken(){if(app?.until>now())return app.token;if(minting)return minting;minting=(async()=>{const r=await call('https://id.twitch.tv/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:'client_credentials'}).toString()});if(r.status!==200||typeof r.data?.access_token!=='string'||!r.data.access_token||r.data.access_token.length>4096||r.data.token_type?.toLowerCase()!=='bearer'||!Number.isInteger(r.data.expires_in)||r.data.expires_in<=60)throw Error('app-grant');app={token:r.data.access_token,until:now()+(Math.min(r.data.expires_in,86400)-60)*1000};return app.token;})();try{return await minting;}finally{minting=null;}}
 async function capabilities(){
  // A fresh identity/client/scope validation precedes every eligible invocation.
  if(grantsUntil>now()&&roles?.until>now())return;
  const token=await oauth.accessTokenForP7();for(const id of keeperIds)await oauth.accessTokenForKeeper(id);grantsUntil=now()+5000;
  if(roles?.until>now())return;
  if(checking)return checking;
  checking=(async()=>{let cursor=null;const seen=new Set(),found=new Set();for(let page=0;page<3;page++){
   const q=new URLSearchParams({user_id:botId,first:'100'});if(cursor)q.set('after',cursor);const r=await call(`https://api.twitch.tv/helix/moderation/channels?${q}`,{headers:{Authorization:`Bearer ${token}`,'Client-Id':clientId}}),v=r.data;
   if(r.status!==200||!Array.isArray(v?.data)||v.data.length>100||!v.pagination||typeof v.pagination!=='object'||Array.isArray(v.pagination)||Object.keys(v.pagination).some(k=>k!=='cursor'))throw Error('moderator-proof');
   for(const row of v.data){if(typeof row?.broadcaster_id!=='string'||!/^\d{1,32}$/.test(row.broadcaster_id))throw Error('moderator-proof');if(keeperIds.includes(row.broadcaster_id))found.add(row.broadcaster_id);}
   if(v.pagination.cursor!==undefined&&(typeof v.pagination.cursor!=='string'||!v.pagination.cursor.length||v.pagination.cursor.length>2048))throw Error('moderator-proof');
   if(found.size===keeperIds.length){roles={botId,checkedAt:now(),until:now()+300000,channels:Object.fromEntries(keeperIds.map(id=>[id,true]))};return;}
   cursor=v.pagination.cursor;if(cursor===undefined)break;if(typeof cursor!=='string'||!cursor.length||cursor.length>2048||seen.has(cursor))throw Error('moderator-proof');seen.add(cursor);
  }throw Error('moderator-proof');})();try{await checking;}finally{checking=null;}
 }
 const name=id=>/^[a-z0-9_]{1,25}$/.test(logins[id]??'')?'@'+logins[id]:`Channel ${id}`;
 async function process(host,key){if(!keeperIds.includes(host)||!/^[a-f0-9]{64}$/.test(key))return{status:'blocked'};
  const row=await state.p7Step(host,{type:'inspect',key,flags:config},now());if(!row)return{status:'skipped'};
  try{await capabilities();}catch{roles=null;grantsUntil=0;return{status:'capability-required'};}
  if(now()>=row.deadline)return{status:'expired'};
  // Token minting is a read prerequisite; recheck exact proof/deadline afterwards.
  let token;try{token=await appToken();}catch{return{status:'app-grant-required'};}
  const job=await state.p7Step(host,{type:'claim',key,flags:config},now());if(!job)return{status:'skipped'};
  let outcome='unknown',httpStatus=null,retryAt=null;
  try{let path,method='POST',body;const q=new URLSearchParams({broadcaster_id:host,moderator_id:botId});
   if(job.kind==='announcement'){path='announcements';body=JSON.stringify({message:`The relic is bound to ${name(host)}. Ring ${job.ring}. Thank you, ${name(job.proof.from)}.`,color:'purple',for_source_only:true});}
   else if(job.kind==='pin'){path='pins';method='PUT';q.set('message_id',job.messageId);q.set('duration_seconds',String(config.duration));}
   else{path='shoutouts';q.delete('broadcaster_id');q.set('from_broadcaster_id',host);q.set('to_broadcaster_id',job.proof.from);}
   const r=await call(`https://api.twitch.tv/helix/chat/${path}?${q}`,{method,headers:{Authorization:`Bearer ${token}`,'Client-Id':clientId,...(body?{'content-type':'application/json'}:{})},...(body?{body}:{})});
   httpStatus=Number.isInteger(r.status)&&r.status>=100&&r.status<=599?r.status:null;outcome=r.status===204?'sent':r.status===429?'rate-limited':r.status>=400&&r.status<500?'blocked':'unknown';
   if(r.status===401){app=null;roles=null;grantsUntil=0;}else if(r.status===403){roles=null;grantsUntil=0;}
   if(r.status===429){const after=Number.isInteger(r.retryAfter)&&r.retryAfter>=0?now()+Math.min(r.retryAfter,86400)*1000:0,reset=Number.isInteger(r.rateReset)&&r.rateReset>=0?Math.min(r.rateReset*1000,now()+86400000):0;retryAt=Math.max(after,reset,now());}
  }catch{}
  try{await state.p7Step(host,{type:'finish',key,flags:config,outcome,httpStatus,retryAt},now());}catch{}
  try{await logger(JSON.stringify({severity:outcome==='sent'?'INFO':'WARNING',event:'raid_relic_p7_action',host,key,kind:job.kind,outcome,httpStatus}));}catch{}
  return{status:outcome};
 }
 return{enabled:true,config,process,status:()=>({enabled:true,configured:safeSettings(),effective:effective(),moderatorChecked:!!roles&&roles.until>now(),reason:roles?.until>now()?'cached-capability':'capability-required'})};
}

export function cancelP7(previous){if(!previous)return previous;const doc=structuredClone(previous);for(const r of doc.rows)if(r.status==='queued'){r.status='cancelled';delete r.proof;delete r.messageId;}return doc;}
