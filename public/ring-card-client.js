import {ringCardModel,ringCardPNG,saveRingCard,ringCardFilename} from './ring-card.js';
// Atlas only. Fresh exact-stop read before each manual export; no cache or writes.
export async function downloadStopCard(h,keeper,{signal,current=()=>true}={}){
 const own=new AbortController(),abort=()=>own.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)own.abort();const timer=setTimeout(abort,8000);
 try{if(!current())throw Error('Stale stop');const r=await fetch('/api/atlas/stops/'+h.stopId,{signal:own.signal,cache:'no-store',credentials:'omit'});if(!r.ok)throw Error('Unavailable');const raw=await r.text();if(raw.length>131072||own.signal.aborted)throw Error('Bounded response');const v=JSON.parse(raw),s=v.stop;
 if(!['live','simulator'].includes(v.mode)||!s||['stopId','from','to','claimedAt','ringIndex','raidSize'].some(k=>s[k]!==h[k])||!current())throw Error('Changed stop');
 const model=ringCardModel({stopId:s.stopId,keeper,ringIndex:s.ringIndex,claimedAt:s.claimedAt},{mode:v.mode});const blob=await ringCardPNG(model);if(own.signal.aborted||!current())throw Error('Stale stop');saveRingCard(blob,model.simulated,ringCardFilename(s.ringIndex,model.keeper));return true;
 }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
