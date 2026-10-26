import assert from 'node:assert/strict';
import {pilotFixture,HOME,OTHER,BOT} from './pilot-fixture.js';
export {HOME,OTHER,BOT};
export async function streakFixture(kind='memory',enabled=true,origin='https://pilot.example'){
 const f=await pilotFixture(kind,{origin,chronicleEnv:{P9_STREAK_ENABLED:String(enabled)}});
 for(const id of[BOT,HOME,OTHER])await f.login(id);
 for(const id of[HOME,OTHER]){await f.control(id,'bootstrap');f.advance();await f.control(id,'keep');f.advance();}
 return f;
}
export async function openHop(f){const from=(await f.runtime.state.getKeeperRegistry()).holderId,to=from===HOME?OTHER:HOME;f.advance(120001);const r=await f.control(from,`send:${to}`);assert.equal(r.status,200);assert.equal(JSON.parse(r.body).status,'accepted');f.advance();await f.raid(from,to,1);return{from,to};}
export async function winHop(f){const h=await openHop(f);await f.chat(h.from,h.from,'!offer');await f.chat(h.to,h.to,'!accept');assert.equal((await f.runtime.state.getKeeperRegistry()).holderId,h.to);return h;}
