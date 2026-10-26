// Operator-run one-shot observation. No SDK/ADC/auth-file reads or token refresh/save.
import { pathToFileURL } from 'node:url';
import { boundedResponse } from '../public/control-read.js';
import { matchesSubscriptionCondition } from '../src/subscriptions.js';
const baseBotScopes=['user:read:chat','user:write:chat','user:bot'];
export async function dailyCheck({origin,callback,clientId,clientSecret,botId,keeperIds,botAccessToken},request){
 const checks=[];const note=(name,status)=>checks.push({name,status});
 if(!request||!clientId||!clientSecret||!botAccessToken||!Array.isArray(keeperIds)||keeperIds.length!==2||!keeperIds.every(id=>/^\d{1,32}$/.test(id))||!/^\d{1,32}$/.test(botId))return{status:'attention',checks:[{name:'config',status:'required'}]};
 try{const u=new URL(origin);if(u.origin!==origin||u.protocol!=='https:'||callback!==origin+'/eventsub')throw Error();}catch{return{status:'attention',checks:[{name:'config',status:'invalid'}]};}
 try{const r=await request(origin+'/health',{});note('health',r.status===200&&r.data?.status==='ok'?'ok':'unavailable');}catch{note('health','unavailable');}
 try{const r=await request('https://id.twitch.tv/oauth2/validate',{headers:{Authorization:`OAuth ${botAccessToken}`}});note('bot',r.status===401?'reauth-or-explicit-refresh-required':r.status===200&&r.data?.client_id===clientId&&r.data.user_id===botId&&Number.isFinite(r.data.expires_in)&&r.data.expires_in>0&&Array.isArray(r.data.scopes)&&baseBotScopes.every(s=>r.data.scopes?.includes(s))?'ok':'identity-or-scope');}catch{note('bot','unavailable');}
 try{
  // Ephemeral APP-token mint is the only observational auth exception, not a user refresh.
  const token=await request('https://id.twitch.tv/oauth2/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,grant_type:'client_credentials'}).toString()});
  if(token.status!==200||typeof token.data?.access_token!=='string'||!token.data.access_token)throw Error();
  const items=[],seen=new Set();let cursor=null,complete=false;
  for(let page=0;page<3;page++){const q=new URLSearchParams({first:'100'});if(cursor)q.set('after',cursor);const r=await request('https://api.twitch.tv/helix/eventsub/subscriptions?'+q,{headers:{Authorization:`Bearer ${token.data.access_token}`,'Client-Id':clientId}});if(r.status!==200||!Array.isArray(r.data?.data)||r.data.data.length>100||!r.data.pagination||typeof r.data.pagination!=='object')throw Error();items.push(...r.data.data);cursor=r.data.pagination.cursor;if(cursor===undefined){complete=true;break;}if(typeof cursor!=='string'||!cursor.length||cursor.length>2048||seen.has(cursor))throw Error();seen.add(cursor);}
  if(!complete)throw Error();const desired=keeperIds.flatMap(id=>[{type:'stream.online',condition:{broadcaster_user_id:id}},{type:'stream.offline',condition:{broadcaster_user_id:id}},{type:'channel.raid',condition:{from_broadcaster_user_id:id}},{type:'channel.raid',condition:{to_broadcaster_user_id:id}},{type:'channel.chat.message',condition:{broadcaster_user_id:id,user_id:botId}}]);
  const ready=desired.every(d=>(()=>{const m=items.filter(s=>s.type===d.type&&s.version==='1'&&matchesSubscriptionCondition(s.type,s.condition,d.condition));return m.length===1&&m[0].transport?.method==='webhook'&&m[0].transport.callback===callback&&m[0].status==='enabled';})());note('subscriptions',ready?'ok':'exact-ten-canonical-required');
 }catch{note('subscriptions','unavailable-or-incomplete');}
 return{status:checks.every(c=>c.status==='ok')?'ok':'attention',checks};
}
export async function observationHTTP(url,options){const r=await boundedResponse(url,{...options,redirect:'error'},{maxBytes:65536});let data=null;try{data=JSON.parse(r.text);}catch{}return{status:r.status,data};}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const day=new Date().toISOString().slice(0,10);if(!process.argv.includes('--once')){console.log(JSON.stringify({status:'not-run',reason:'explicit-once-required'}));process.exitCode=1;}
 else if(day<'2026-11-02'||day>'2026-11-15')console.log(JSON.stringify({status:'not-run',reason:'outside-observation-window'}));
 else{const e=process.env;const r=await dailyCheck({origin:e.OVERLAY_ORIGIN,callback:e.EVENTSUB_CALLBACK_URL,clientId:e.TWITCH_CLIENT_ID,clientSecret:e.TWITCH_CLIENT_SECRET,botId:e.TWITCH_BOT_ID,keeperIds:(e.KEEPER_CHANNEL_IDS??'').split(','),botAccessToken:e.TWITCH_BOT_ACCESS_TOKEN},observationHTTP);console.log(JSON.stringify(r));if(r.status!=='ok')process.exitCode=1;}
}
