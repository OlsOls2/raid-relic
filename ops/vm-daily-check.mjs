// Operator-only read adapter. Never run by source author; no grant refresh/lease/write.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createTokenCipher,hash } from '../src/crypto.js';
import { boundedCall } from '../src/bounded.js';
import { dailyCheck,observationHTTP,observationAllowed } from './daily-check.mjs';
const PROJECT='raid-relic-hackathon',REGION='us-central1',SERVICE='raid-relic';
export async function vmDailyCheck({once=false,dryRun=false,now=Date.now,command,readGrant,request=observationHTTP}={}){
 const allowed=()=>observationAllowed(once,now());
 if(!allowed())return{status:'not-run',reason:once?'outside-observation-window':'explicit-once-required'};
 if(dryRun)return{status:'dry-run',expiresAt:'2026-11-03T00:00:00Z',writes:false,refresh:false};
 const guard=()=>{if(!allowed())throw Error('closed');};
 const run=async args=>{guard();return command(args);};
 try{
  const service=JSON.parse(await run(['run','services','describe',SERVICE,'--project',PROJECT,'--region',REGION,'--format=json']));
  const traffic=service.status?.traffic;if(!Array.isArray(traffic))throw Error();
  const serving=traffic.filter(t=>t.percent>0);if(serving.length!==1||serving[0].percent!==100||!/^raid-relic-[a-z0-9-]+$/.test(serving[0].revisionName))throw Error();
  // CURRENT 100% revision, never service.spec.template / latest-created zero-traffic candidate.
  const revision=JSON.parse(await run(['run','revisions','describe',serving[0].revisionName,'--project',PROJECT,'--region',REGION,'--format=json']));
  const containers=revision.spec?.containers;if(!Array.isArray(containers)||containers.length!==1)throw Error();
  const env=containers[0].env;if(!Array.isArray(env)||env.length>128||new Set(env.map(e=>e.name)).size!==env.length)throw Error();
  const value=name=>env.find(e=>e.name===name)?.value;
  const secret=async name=>{const ref=env.find(e=>e.name===name)?.valueFrom?.secretKeyRef;if(!ref||typeof ref.name!=='string'||! /^(latest|[1-9]\d*)$/.test(ref.key))throw Error();const full=/^projects\/(raid-relic-hackathon|760724762396)\/secrets\/([a-zA-Z0-9_-]{1,255})$/.exec(ref.name),secretName=full?full[2]:ref.name;if(secretName!==({TWITCH_CLIENT_SECRET:'twitch-client-secret',TOKEN_ENCRYPTION_KEY:'token-encryption-key'})[name])throw Error();return run(['secrets','versions','access',ref.key,'--secret',secretName,'--project',full?full[1]:PROJECT]);};
  const clientId=value('TWITCH_CLIENT_ID'),botId=value('TWITCH_BOT_ID');
  if(typeof clientId!=='string'||! /^[a-zA-Z0-9]{1,128}$/.test(clientId)||botId!=='1591804828'||value('OVERLAY_ORIGIN')!=='https://raid-relic-760724762396.us-central1.run.app'||value('EVENTSUB_CALLBACK_URL')!==value('OVERLAY_ORIGIN')+'/eventsub'||value('KEEPER_CHANNEL_IDS')!=='1591805230,1591806023')throw Error();
  const clientSecret=(await secret('TWITCH_CLIENT_SECRET')).trim(),key=(await secret('TOKEN_ENCRYPTION_KEY')).trim();
  guard();const record=await readGrant(PROJECT,hash('bot'),guard);
  guard();const token=createTokenCipher(key).open(record,`${clientId}:bot:${botId}`);
  if(typeof token?.access_token!=='string'||!token.access_token||token.access_token.length>4096)throw Error();
  return await dailyCheck({origin:value('OVERLAY_ORIGIN'),callback:value('EVENTSUB_CALLBACK_URL'),clientId,clientSecret,botId,keeperIds:value('KEEPER_CHANNEL_IDS').split(','),botAccessToken:token.access_token,p7Enabled:value('P7_BOT_ACTIONS_ENABLED')==='true'},async(url,options)=>{guard();return request(url,options);});
 }catch{return{status:'attention',checks:[{name:'adapter',status:allowed()?'load-unavailable-or-reauth-required':'expired'}]};}
}
export async function operatorCommand(args){const {stdout}=await promisify(execFile)('gcloud',args,{timeout:8000,maxBuffer:262144,encoding:'utf8'});return stdout;}
export async function operatorReadGrant(projectId,key,guard){guard();const {Firestore}=await import('@google-cloud/firestore');guard();const db=new Firestore({projectId});try{guard();return(await boundedCall(()=>db.collection('oauthTokens').doc(key).get())).data();}finally{await db.terminate();}}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await vmDailyCheck({once:process.argv.includes('--once'),dryRun:process.argv.includes('--dry-run'),command:operatorCommand,readGrant:operatorReadGrant});console.log(JSON.stringify(r));if(!['ok','dry-run','not-run'].includes(r.status))process.exitCode=1;}
