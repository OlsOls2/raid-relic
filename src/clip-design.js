// P9 DESIGN ONLY. Not imported by runtime, OAuth, webhooks, controls or public code.
// No default transport, credentials, timers, workers, storage or provider effects.
import {hash} from './crypto.js';
import {P7_SCOPES} from './p7-scopes.js';
export const CLIP_BOT='1591804828';
const KEEPERS=Object.freeze(['1591805230','1591806023']);
export const PROPOSED_CLIP_BOT_SCOPES=Object.freeze(['user:read:chat','user:write:chat','user:bot',...P7_SCOPES,'clips:edit']);
const time=n=>Number.isSafeInteger(n)&&n>=0;
const clipId=s=>typeof s==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(s);
export function clipDesignConfig(value={}) {return Object.freeze({enabled:value.CLIPS_ENABLED==='true'&&value.CLIPS_ALLOW_CREATE==='true',activationApproved:value.activationApproved===true,clientId:typeof value.clientId==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value.clientId)?value.clientId:null});}
export function planClip(config,proof,auth,now){
 if(!config?.enabled||!config.activationApproved)return{status:'disabled'};
 if(!config.clientId||!proof||!auth||!time(now)||!time(proof.receiptAt)||proof.receiptAt>now||now>=proof.receiptAt+30000||proof.verified!==true||proof.finalized===true||proof.cancelled===true||!KEEPERS.includes(proof.from)||!KEEPERS.includes(proof.to)||proof.from===proof.to||! /^[a-f0-9]{64}$/.test(proof.eventId??'')||typeof proof.targetStreamId!=='string'||! /^\d{1,128}$/.test(proof.targetStreamId)||proof.currentTargetStreamId!==proof.targetStreamId||proof.targetLive!==true||proof.clipsEnabled!==true||proof.creatorEligible!==true||proof.keeperConsent!==true||proof.optedIn!==true||proof.paused!==false||proof.banned!==false)return{status:'blocked',reason:'receipt-or-policy'};
 if(auth.kind!=='user'||auth.subject!==CLIP_BOT||auth.clientId!==config.clientId||!time(auth.validatedAt)||auth.validatedAt>now||now-auth.validatedAt>5000||!time(auth.expiresAt)||auth.expiresAt<=now||!Array.isArray(auth.scopes)||auth.scopes.length!==8||new Set(auth.scopes).size!==8||!PROPOSED_CLIP_BOT_SCOPES.every(s=>auth.scopes.includes(s)))return{status:'blocked',reason:'explicit-bot-consent-required'};
 const job={version:1,key:hash('clip-request-v1:'+proof.to+':'+proof.eventId),eventId:proof.eventId,stopId:hash(proof.eventId),from:proof.from,to:proof.to,targetStreamId:proof.targetStreamId,receiptAt:proof.receiptAt,deadline:proof.receiptAt+30000,attemptedAt:now,creatorId:CLIP_BOT};
 return{status:'planned',job,request:{method:'POST',path:'/helix/clips',query:{broadcaster_id:job.to},tokenKind:'user',requiredScope:'clips:edit'}};
}
export function confirmedClip(job,response,now){
 if(!job||!KEEPERS.includes(job.to)||job.creatorId!==CLIP_BOT||!time(job.attemptedAt)||!time(now)||now<job.attemptedAt||now>=job.attemptedAt+60000||response?.status!==200||!Array.isArray(response.data?.data)||response.data.data.length!==1)return null;
 const row=response.data.data[0];if(!clipId(job.clipId)||row.id!==job.clipId||row.broadcaster_id!==job.to||!KEEPERS.includes(row.broadcaster_id))return null;
 return{clipId:row.id,broadcasterId:row.broadcaster_id,confirmedAt:now};
}
export function clipAttachment(job,confirmation,completedStop,{retained=false,policyAllowed=false}={}){
 if(!retained||!policyAllowed||!job||!confirmation||!completedStop||!clipId(confirmation.clipId)||confirmation.clipId!==job.clipId||confirmation.broadcasterId!==job.to||!KEEPERS.includes(job.to)||!time(confirmation.confirmedAt)||confirmation.confirmedAt<job.attemptedAt||confirmation.confirmedAt>=job.attemptedAt+60000||completedStop.stopId!==job.stopId||completedStop.eventId!==job.eventId||completedStop.from!==job.from||completedStop.to!==job.to||!time(completedStop.claimedAt)||completedStop.claimedAt<job.receiptAt||completedStop.claimedAt>=job.receiptAt+180000||!Number.isInteger(completedStop.ringIndex)||completedStop.ringIndex<1||completedStop.ringIndex>16)return null;
 return{stopId:completedStop.stopId,url:'https://clips.twitch.tv/'+confirmation.clipId};
}
// Injected design harness only. A future ledger must atomically persist dispatching
// before reserve returns true and never re-claim dispatching/terminal keys. No
// production ledger or transport is supplied, and there is no startup drain.
export function createClipDesign({config=clipDesignConfig(),ledger,transport,authorize,now=Date.now}={}){
 return{
 async attempt(proof,auth){if(!config.enabled||!config.activationApproved)return{status:'disabled'};const p=planClip(config,proof,auth,now());if(p.status!=='planned')return p;if(!await ledger.reserve(p.job))return{status:'duplicate'};
  let status='unknown',id=null;try{const fresh=await authorize(p.job),checked=planClip(config,fresh?.proof,fresh?.auth,now());if(checked.status!=='planned'||checked.job.key!==p.job.key||checked.job.targetStreamId!==p.job.targetStreamId){try{await ledger.finish(p.job.key,{status:'blocked'});}catch{}return{status:'blocked',key:p.job.key,providerAccepted:false,clipCreated:false};}const r=await transport.createUserClip(p.request);if(r?.status===202&&clipId(r.data?.data?.[0]?.id)){status='accepted';id=r.data.data[0].id;}else if([400,401,403,404,429].includes(r?.status))status='blocked';}catch{}
  try{await ledger.finish(p.job.key,{status,...(id?{clipId:id}:{})});}catch{/* persisted dispatch boundary prevents another creation attempt */}
  return{status,key:p.job.key,providerAccepted:status==='accepted',clipCreated:false};
 },
 async confirm(key){if(!config.enabled||!config.activationApproved)return{status:'disabled'};const job=await ledger.claimConfirmation(key,now());if(!job||job.status!=='accepted'||now()<job.attemptedAt||now()>=job.attemptedAt+60000)return{status:'unavailable'};
  let proof=null;try{proof=confirmedClip(job,await transport.getClips({method:'GET',path:'/helix/clips',query:{id:job.clipId},tokenKind:'app-or-user'}),now());}catch{}
  try{await ledger.finishConfirmation(key,proof?{status:'confirmed',confirmation:proof}:{status:'unconfirmed'});}catch{}
  return proof?{status:'confirmed',confirmation:proof}:{status:'unconfirmed'};
 }
 };
}
