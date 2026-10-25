const $ = id => document.getElementById(id);
let generation = 0, controller;
const badgeNames = new Set(['First Keeper','24h Keeper','Ring 1','Ring 5','Ring 10','Chain of 3','Carried during TwitchCon San Diego 2026']);
export function validScores(v) {
  try { return v && Number.isSafeInteger(v.asOf) && v.asOf >= 0 && Number.isInteger(v.rings) && v.rings >= 0 && v.rings <= 16
    && Object.keys(v).sort().join(',') === 'asOf,channels,coverage,event,mode,previewReadOnly,raiders,rings' && ['live','simulator'].includes(v.mode) && typeof v.previewReadOnly === 'boolean' && typeof v.coverage === 'string' && v.coverage.length <= 500
    && v.event && Object.keys(v.event).sort().join(',') === 'checked,endsAt,label,source,startsAt' && v.event.label === 'TwitchCon San Diego 2026' && v.event.source === 'https://www.twitchcon.com/san-diego-2026/' && v.event.checked === '2026-10-25' && v.event.startsAt === Date.parse('2026-11-13T08:00:00Z') && v.event.endsAt === Date.parse('2026-11-16T08:00:00Z')
    && Array.isArray(v.channels) && v.channels.length <= 4 && v.channels.every(r => Object.keys(r).sort().join(',') === 'badges,channelId,hopsCarried,knownHoldSeconds,login'
      && /^\d{1,32}$/.test(r.channelId) && (r.login === null || (typeof r.login === 'string' && /^[a-z0-9_]{1,25}$/.test(r.login))) && Number.isInteger(r.knownHoldSeconds) && r.knownHoldSeconds >= 0 && Number.isInteger(r.hopsCarried) && r.hopsCarried >= 0 && r.hopsCarried <= 16 && Array.isArray(r.badges) && r.badges.length <= 8 && r.badges.every(b => badgeNames.has(b)))
    && Array.isArray(v.raiders) && v.raiders.length <= 20 && v.raiders.every(r => Object.keys(r).sort().join(',') === 'claimsJoined,login,since' && typeof r.login === 'string' && /^[a-z0-9_]{1,25}$/.test(r.login) && Number.isInteger(r.claimsJoined) && r.claimsJoined >= 0 && r.claimsJoined <= 16 && Number.isSafeInteger(r.since) && r.since <= v.asOf); } catch { return false; }
}
export function holdDuration(seconds) {
  let remaining=seconds; const parts=[]; for(const [unit,size] of [['d',86400],['h',3600],['m',60],['s',1]]) { const count=Math.floor(remaining/size); remaining%=size; if(count)parts.push(`${count}${unit}`); } return parts.join(' ') || '0s';
}
const clear = () => { $('keeper-rows').replaceChildren(); $('raider-rows').replaceChildren(); $('scores-coverage').textContent=''; };
const node = (tag,text,className) => { const n=document.createElement(tag);n.textContent=text;if(className)n.className=className;return n; };
async function loadScores() {
  const current=++generation;controller?.abort();controller=new AbortController();const active=controller;
  clear();$('scores-refresh').disabled=true;$('scores-status').textContent='Reading recorded scores…';const timer=setTimeout(()=>active.abort(),8000);
  try {
    const r=await fetch('/api/scores',{cache:'no-store',signal:active.signal});if(!r.ok)throw Error();const v=await r.json();if(current!==generation)return;if(!validScores(v))throw Error();
    $('score-preview').hidden=!v.previewReadOnly;if(v.mode==='simulator')$('simulator').hidden=false;
    for(const row of v.channels){const li=node('li',undefined);const time=node('p',`${holdDuration(row.knownHoldSeconds)} known hold · ${row.hopsCarried} completed ${row.hopsCarried === 1 ? 'carry' : 'carries'}`);time.title=`${row.knownHoldSeconds.toLocaleString()} known hold seconds`;time.setAttribute('aria-label',`${row.knownHoldSeconds} known hold seconds; ${row.hopsCarried} completed ${row.hopsCarried === 1 ? 'carry' : 'carries'}`);li.append(node('h3',row.login?`@${row.login}`:`Channel ${row.channelId}`),time);
      const badges=node('ul',undefined,'score-badges');for(const b of row.badges)badges.append(node('li',`◇ ${b}`));li.append(badges);$('keeper-rows').append(li);}
    for(const row of v.raiders)$('raider-rows').append(node('li',`@${row.login} · ${row.claimsJoined} completed ${row.claimsJoined === 1 ? 'claim' : 'claims'} joined · since opt-in ${new Date(row.since).toLocaleString()}`));
    if(!v.raiders.length)$('raider-rows').append(node('li','No consenting raider scores recorded. Historical participation is unknown.'));
    $('scores-coverage').textContent=v.coverage;$('scores-status').textContent=`${v.rings} recorded ${v.rings === 1 ? 'ring' : 'rings'} · as of ${new Date(v.asOf).toLocaleString()}. Refresh manually.`;
  }catch{if(current===generation){clear();$('scores-status').textContent='Scores unavailable. Previous names and counts hidden. Refresh to try again.';}}
  finally{clearTimeout(timer);if(current===generation)$('scores-refresh').disabled=false;}
}
if(typeof document!=='undefined' && $('keeper-scores')){ $('scores-refresh').onclick=loadScores;addEventListener('pagehide',()=>{generation++;controller?.abort();clear();});addEventListener('pageshow',e=>{if(e.persisted)loadScores();});loadScores(); }
