// Versioned cosmetic configuration only. No game state, network, storage or identity lookup.
const freeze=v=>{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;};
export const EDITION_CONFIG=freeze([{version:1,id:'twitchcon-2026',name:'TwitchCon 2026',badgeLabel:'Carried during TwitchCon 2026 edition',startsAt:'2026-10-23T00:00:00Z',endsAt:'2026-12-01T00:00:00Z',design:{version:1,shape:'crystal',facets:8,aspect:1.05,palette:['#101d30','#dce4ed','#9486b7','#e6bb70']},particles:{kind:'orbit-dust',count:64}}]);
export const EDITION_BADGE=EDITION_CONFIG[0].badgeLabel;
const exact=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join(',')===keys.split(',').sort().join(',');
export function validEditions(list){
 if(!Array.isArray(list)||list.length>8)return false;
 const seen=new Set(),badges=new Set(),windows=[];
 for(const e of list){
  if(!exact(e,'version,id,name,badgeLabel,startsAt,endsAt,design,particles')||e.version!==1||typeof e.id!=='string'||! /^[a-z0-9-]{1,40}$/.test(e.id)||seen.has(e.id)||typeof e.name!=='string'||! /^[A-Za-z0-9 -]{1,64}$/.test(e.name))return false;
  const time=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(Date.parse(s)).toISOString()===s.replace('Z','.000Z');
  if(typeof e.badgeLabel!=='string'||!/^[A-Za-z0-9][A-Za-z0-9 ,'-]{0,95}$/.test(e.badgeLabel)||badges.has(e.badgeLabel))return false;badges.add(e.badgeLabel);
  if(!time(e.startsAt)||!time(e.endsAt)||Date.parse(e.startsAt)>=Date.parse(e.endsAt))return false;
  const d=e.design,p=e.particles;
  if(!exact(d,'version,shape,facets,aspect,palette')||d.version!==1||!['crystal','orb','seed'].includes(d.shape)||!Number.isInteger(d.facets)||d.facets<3||d.facets>12||!Number.isFinite(d.aspect)||d.aspect<.6||d.aspect>1.6||!Array.isArray(d.palette)||d.palette.length!==4||!d.palette.every(c=>typeof c==='string'&&/^#[0-9a-f]{6}$/.test(c))||!exact(p,'kind,count')||!['none','orbit-dust'].includes(p.kind)||!Number.isInteger(p.count)||p.count<0||p.count>96||(p.kind==='none'&&p.count!==0))return false;
  const a=Date.parse(e.startsAt),b=Date.parse(e.endsAt);if(windows.some(([x,y])=>a<y&&b>x))return false;windows.push([a,b]);seen.add(e.id);
 }
 return true;
}
const DEFAULT_VALID=validEditions(EDITION_CONFIG);
export function selectEdition(now,list=EDITION_CONFIG){if(!Number.isFinite(now)||!(list===EDITION_CONFIG?DEFAULT_VALID:validEditions(list)))return null;for(const e of list)if(now>=Date.parse(e.startsAt)&&now<Date.parse(e.endsAt))return e;return null;}
export const editionForDate=selectEdition;
export function editionBadgesForInterval(start,end,{ongoing=false,list=EDITION_CONFIG}={}){
 if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||!validEditions(list))return [];
 return [...new Set(list.filter(e=>start<Date.parse(e.endsAt)&&(ongoing?end>=Date.parse(e.startsAt):end>Date.parse(e.startsAt))&&(ongoing||end>start)).map(e=>e.badgeLabel))];
}
export const editionBadgeForInterval=(start,end,options)=>editionBadgesForInterval(start,end,options).length>0;
export function editionWindowLabel(e){if(!e||!validEditions([e]))return '';const a=new Date(e.startsAt),b=new Date(Date.parse(e.endsAt)-1),format=(d,year)=>d.toLocaleDateString('en-GB',{day:'numeric',month:'short',...(year?{year:'numeric'}:{}),timeZone:'UTC'});return a.getUTCFullYear()===b.getUTCFullYear()?`${format(a,false)}–${format(b,false)} ${a.getUTCFullYear()} UTC`:`${format(a,true)}–${format(b,true)} UTC`;}
export const editionImageURL=e=>e&&validEditions([e])?'/edition-crystal/'+e.id+'.svg':null;
// Pure original geometry, generated only from closed validated configuration.
export function editionSVG(e){if(!e||!validEditions([e]))return null;const d=e.design,p=d.palette,rx=(d.shape==='orb'?54:d.shape==='seed'?32:46)/Math.max(1,d.aspect),ry=72*Math.min(1,d.aspect);const points=[];for(let i=0;i<d.facets;i++){const a=-Math.PI/2+i*Math.PI*2/d.facets,c=Math.cos(a),s=Math.sin(a),r=d.shape==='orb'?1/Math.sqrt(c*c/(rx*rx)+s*s/(ry*ry)):1/(Math.abs(c)/rx+Math.abs(s)/ry);points.push([60+c*r,80+s*r].map(n=>Number(n.toFixed(3))));}const paths=points.map((point,i)=>`<path d="M60 80 L${point.join(' ')} L${points[(i+1)%points.length].join(' ')}Z" fill="${p[1+i%3]}" stroke="${p[3]}" stroke-width="1"/>`).join('');return `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" viewBox="0 0 120 160">${paths}</svg>`;}
