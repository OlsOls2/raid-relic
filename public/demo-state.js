import { claimComplete } from './ritual-copy.js';
// Fictional browser-memory presentation only. Never imported by server/game code.
export const DEMO_TOUR_MS=35000;
export const DEMO_NAMES=Object.freeze(['demo_keeper_a','demo_keeper_b']);
export const freshDemo=()=>({clock:0,rings:0,phase:'idle',acceptedAt:null,receiptAt:null,completedAt:null,offer:false,accept:false,source:DEMO_NAMES[0],target:DEMO_NAMES[1],notice:'Choose two fictional Keepers, then Send Off.'});
export function demoStep(previous,action){let s={...previous};
 if(action.type==='reset')return freshDemo();
 if(action.type==='advance'){if(Number.isFinite(action.ms)&&action.ms>=0)s.clock+=Math.min(1000,action.ms);return s;}
 if(action.type==='send'){if(!['idle','settled'].includes(s.phase)||s.rings>=16)return s;if(!DEMO_NAMES.includes(action.source)||!DEMO_NAMES.includes(action.target)||action.source===action.target)return{...s,notice:'Choose two different fictional Keepers.'};return{...s,source:action.source,target:action.target,acceptedAt:s.clock,receiptAt:null,completedAt:null,offer:false,accept:false,phase:'countdown',notice:'Simulated request accepted. Voting only; no arrival or transfer yet.'};}
 if(action.type==='raid'&&s.phase==='countdown'){s.receiptAt=s.clock;s.phase='arrival';s.notice='SIMULATED EventSub receipt. The real server would verify its HMAC, direction, streams and consent.';}
 if(action.type==='offer'&&['countdown','arrival'].includes(s.phase)){s.offer=true;s.notice=s.receiptAt===null?'Offer retained. Waiting for the simulated raid.':'Offer 1/1. Waiting for the other fictional participant.';}
 if(action.type==='accept'&&s.phase==='arrival'){s.accept=true;s.notice='Accept 1/1. Waiting for the source offer.';}
 if(s.phase==='arrival'&&s.offer&&s.accept){s.rings++;s.completedAt=s.clock;s.phase='bound';s.notice=claimComplete(s.target);}
 if(action.type==='settle'&&s.phase==='bound')s.phase='settled';
 return s;
}

export function demoProgress(s){
 if(s.phase==='idle')return 'Step 1/5: choose two fictional Keepers, then Send Off or Autoplay.';
 if(s.phase==='countdown')return 'Step 2/5: simulated raid in flight. Offer early; accept unlocks after the simulated receipt. Skip countdown is available.';
 if(s.phase==='arrival')return s.offer?'Step 3/5: simulated raid received. Send !accept from the other fictional chat.':'Step 3/5: simulated raid received. Add the source offer and distinct host accept.';
 if(s.phase==='bound')return 'Step 4/5: claim complete. Watch the receipt-time arrival and one new ring settle.';
 return 'Step 5/5: tour complete. The real relic is unchanged. Reset to zero or Send Off again.';
}

export function demoControls(s,{playing=false,tour=false}={}){
 const locked=playing&&tour;
 return{locked,pauseLabel:s.phase==='settled'?'Replay tour':playing?'Pause':'Resume',pauseDisabled:s.phase==='idle',notice:locked?'Controls locked during the tour. Press Pause to take over.':s.phase==='settled'?'Tour complete. Replay tour starts a fresh fictional run at zero rings.':tour?'Tour paused. Manual controls are unlocked; using them takes over. Resume continues the tour.':'Manual controls are ready. Send Off starts a new run only before departure or after completion; Reset starts over.'};
}

// Clock advances animate presentation without changing the scene payload. All fictional semantic fields are covered.
export function demoSceneKey(s){return s===null?null:JSON.stringify([s.rings,s.phase,s.acceptedAt,s.receiptAt,s.completedAt,s.offer,s.accept,s.source,s.target,s.notice]);}
