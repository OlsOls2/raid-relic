import {selectEdition,FAN_DISCLAIMER} from './editions.js';
export const CARD_WIDTH=1200,CARD_HEIGHT=630,CARD_MAX_BYTES=512*1024;
// Only closed metadata reaches canvas; never mark SVG/text or participant identities.
export function ringCardModel(value,options={}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['mode','now'].includes(k)))throw Error('Card options');
 const {mode='live',now=Date.now()}=options;
 if(!['live','simulator','demo'].includes(mode))throw Error('Card mode');
 const demo=mode==='demo',simulated=mode!=='live';
 if(!value||Object.keys(value).sort().join(',')!=='claimedAt,keeper,ringIndex,stopId')throw Error('Card metadata');
 const {keeper,ringIndex,claimedAt,stopId}=value;
 if(!Number.isInteger(ringIndex)||ringIndex<(demo?0:1)||ringIndex>16||typeof keeper!=='string'||!(demo?/^@demo_keeper_[ab]$/:/^@[a-z0-9_]{1,25}$/).test(keeper))throw Error('Card metadata');
 if(demo?stopId!==null:typeof stopId!=='string'||! /^[a-f0-9]{64}$/.test(stopId))throw Error('Card stop');
 if(claimedAt!==null&&(!Number.isSafeInteger(claimedAt)||claimedAt<0||!Number.isFinite(now)||claimedAt>now))throw Error('Card date');
 const edition=claimedAt===null?null:selectEdition(claimedAt);
 return Object.freeze({keeper,ringIndex,stopId,mode,simulated,edition,caption:demo?'SIMULATED DEMO—no Twitch connection':mode==='simulator'?'SIMULATOR—mock recorded stop; no real Twitch':'Recorded completion · Ring '+ringIndex,editionCaption:(demo?'Demo cosmetic edition: ':mode==='simulator'?'Edition at mock completion: ':'Edition at recorded completion: ')+(edition?.name??'Base'),disclaimer:edition?FAN_DISCLAIMER:''});
}
export async function ringCardPNG(model){
 const canvas=document.createElement('canvas');canvas.width=CARD_WIDTH;canvas.height=CARD_HEIGHT;
 try{const c=canvas.getContext('2d');if(!c)throw Error('Canvas unavailable');const p=model.edition?.design.palette??['#101d30','#dce4ed','#9486b7','#e6bb70'];
 c.fillStyle=p[0];c.fillRect(0,0,CARD_WIDTH,CARD_HEIGHT);c.strokeStyle=p[3];c.lineWidth=3;c.strokeRect(24,24,1152,582);
 c.save();c.translate(300,300);const facets=model.edition?.design.facets??6,aspect=model.edition?.design.aspect??1;
 for(let i=0;i<facets;i++){const point=n=>{const a=-Math.PI/2+n*Math.PI*2/facets;return[Math.cos(a)*115/aspect,Math.sin(a)*180];},a=point(i),b=point(i+1);c.beginPath();c.moveTo(0,0);c.lineTo(...a);c.lineTo(...b);c.closePath();c.fillStyle=p[1+i%3];c.fill();c.strokeStyle=p[3];c.lineWidth=2;c.stroke();}
 for(let i=0;i<model.ringIndex;i++){c.beginPath();c.ellipse(0,(i-7.5)*8,140+i*2,22+i, -.18,0,Math.PI*2);c.strokeStyle=p[3];c.lineWidth=3;c.stroke();}c.restore();
 const text=(s,x,y,size,color=p[1])=>{c.font=`${size}px system-ui`;c.fillStyle=color;c.fillText(s,x,y,650);};
 text('RAID RELIC',510,150,38,p[3]);text(model.keeper,510,225,38);text('Ring '+model.ringIndex,510,285,34);text(model.caption,70,535,24,p[3]);text(model.editionCaption,510,345,22);if(model.disclaimer){text('Unofficial fan edition; not affiliated with or',510,400,18);text('endorsed by Twitch/TwitchCon.',510,426,18);}text('Saved downloads cannot be recalled after erasure.',70,580,18);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob||blob.type!=='image/png'||blob.size>CARD_MAX_BYTES)throw Error('Card encoding');return blob;
 }finally{canvas.width=canvas.height=0;}
}
export function ringCardFilename(ringIndex,keeper){if(!Number.isInteger(ringIndex)||ringIndex<1||ringIndex>16||typeof keeper!=='string'||keeper!==keeper.trim()||!/^@[a-z0-9_]{1,25}$/i.test(keeper))throw Error('Card filename');return `raid-relic-stop-${ringIndex}-${keeper.slice(1).toLowerCase()}.png`;}
export function demoCardFilename(ringIndex){if(!Number.isInteger(ringIndex)||ringIndex<1||ringIndex>16)throw Error('Demo card filename');return `raid-relic-demo-ring-${ringIndex}.png`;}
export function saveRingCard(blob,simulated=false,filename=null){if(filename!==null&&(typeof filename!=='string'||filename!==filename.trim()||!(/^raid-relic-stop-(?:[1-9]|1[0-6])-[a-z0-9_]{1,25}\.png$/.test(filename)||simulated===true&&/^raid-relic-demo-ring-(?:[1-9]|1[0-6])\.png$/.test(filename))))throw Error('Card filename');const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=filename??(simulated?'raid-relic-simulated-ring.png':'raid-relic-recorded-ring.png');try{a.click();}finally{setTimeout(()=>URL.revokeObjectURL(url),1000);}}
