// Pure short-testable analysis; never substitutes for the real-clock browser run.
export const DEMO_SOAK_MS=900000;
const finite=n=>Number.isFinite(n)&&Math.abs(n)<1e9;
const median=a=>{const v=[...a].sort((x,y)=>x-y);return v.length%2?v[(v.length-1)/2]:(v[v.length/2-1]+v[v.length/2])/2;};
export function analyseDemoSoak(samples){
 if(!Array.isArray(samples)||samples.length<2||samples.length>100||samples.some((s,i)=>!['atMs','heapUsedBeforeGC','heapRetained','nodes','listeners','documents','openSockets','pages','contexts','canvases','activeCanvases'].every(k=>finite(s[k])&&s[k]>=0)||(i&&s.atMs<=samples[i-1].atMs)))throw Error('Invalid numeric samples');
 const first=samples[0],last=samples.at(-1),xs=samples.map(s=>s.atMs/60000),ys=samples.map(s=>s.heapRetained),mx=xs.reduce((a,b)=>a+b)/xs.length,my=ys.reduce((a,b)=>a+b)/ys.length;
 const denominator=xs.reduce((n,x)=>n+(x-mx)**2,0),slope=xs.reduce((n,x,i)=>n+(x-mx)*(ys[i]-my),0)/denominator;
 const growth=last.heapRetained-first.heapRetained,limit=Math.max(2*1024*1024,first.heapRetained*.15),firstMedian=median(ys.slice(0,3)),lastMedian=median(ys.slice(-3));
 return{heapBaselineBytes:first.heapRetained,heapEndBytes:last.heapRetained,heapPeakBytes:Math.max(...samples.map(s=>s.heapUsedBeforeGC)),heapRetainedPeakBytes:Math.max(...ys),heapGrowthBytes:growth,heapGrowthLimitBytes:limit,heapSlopeBytesPerMinute:slope,heapMedianGrowthBytes:lastMedian-firstMedian,
  heapPassed:growth<=limit&&Math.max(...ys)-first.heapRetained<=limit&&slope<=16384&&lastMedian-firstMedian<=limit,
  domBaseline:first.nodes,domEnd:last.nodes,listenerBaseline:first.listeners,listenerEnd:last.listeners,documentsBaseline:first.documents,documentsEnd:last.documents,pagesBaseline:first.pages,pagesEnd:last.pages,contextsBaseline:first.contexts,contextsEnd:last.contexts,serverSocketBaseline:first.openSockets,serverSocketEnd:last.openSockets,
  domPassed:samples.every(s=>s.nodes<=first.nodes+8&&s.listeners<=first.listeners+4&&s.documents<=first.documents),isolationPassed:samples.every(s=>s.pages===1&&s.contexts===1&&s.openSockets===0&&s.canvases<=1&&s.activeCanvases===0&&s.canvases===first.canvases)};
}

export function closedSoakError(error){return ['TimeoutError','TargetClosedError','ProtocolError','AssertionError','Error'].includes(error?.name)?error.name:'Other';}
export function browserCpuSummary(info){
 if(!Array.isArray(info)||info.length>256||!info.some(p=>typeof p.type==='string'&&p.type.toLowerCase()==='browser'))throw Error('Process metrics unavailable');
 const out={maxRendererCpuSeconds:0,maxGpuCpuSeconds:0,maxBrowserCpuSeconds:0};
 for(const p of info){const type=typeof p.type==='string'?p.type.toLowerCase():'',key=type==='renderer'?'maxRendererCpuSeconds':['gpu','gpu-process'].includes(type)?'maxGpuCpuSeconds':type==='browser'?'maxBrowserCpuSeconds':null;if(key){if(!finite(p.cpuTime)||p.cpuTime<0)throw Error('Process metrics unavailable');out[key]=Math.max(out[key],p.cpuTime);}}
 return out;
}
export function partialDemoSoak(samples,observedMs,cycles){
 const observationComplete=finite(observedMs)&&observedMs>=DEMO_SOAK_MS&&Number.isInteger(cycles)&&cycles>=20;
 try{return{...analyseDemoSoak(samples),analysisAvailable:true,partialAnalysis:!observationComplete,observationComplete};}catch{return{analysisAvailable:false,partialAnalysis:true,observationComplete:false};}
}
