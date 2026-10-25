// Optional scalars in the existing timing bucket. No new storage keys, IDs,
// server names, URLs, headers or credentials. Phase intervals may overlap;
// never subtract them from total startup or call the remainder "our server".
const operations=['vod_info','stream_token'],phases=['localCache','provider','unattributed'],cacheKinds=['memory','durable','miss'];
const bounded=(n,max)=>Number.isFinite(n)?Math.max(0,Math.min(max,Math.round(n))):0;
export class CatalogCost {
 constructor(operation,now=()=>performance.now()){this.operation=operations.includes(operation)?operation:null;this.now=now;this.lookups=0;this.cache={memory:0,durable:0,miss:0};this.elapsed={localCache:0,provider:0,unattributed:0};this.active={};}
 begin(action){
  if(!this.operation||!['get_vod_info','get_vod_streams','get_vod_categories'].includes(action)||this.lookups>=100)return null;
  this.lookups++;let finished=false,kind=null;const stops=new Set();
  return {cache:value=>{if(!finished&&cacheKinds.includes(value))kind=value;},phase:name=>{
   if(finished||!phases.includes(name))return ()=>{};
   const span=this.active[name]??={at:this.now(),count:0};span.count++;let done=false;
   const stop=()=>{if(done)return;done=true;stops.delete(stop);if(!--span.count){this.elapsed[name]+=Math.max(0,this.now()-span.at);delete this.active[name];}};stops.add(stop);return stop;
  },finish:()=>{if(finished)return;finished=true;for(const stop of [...stops])stop();if(kind)this.cache[kind]++;}};
 }
 snapshot(){if(!this.operation||!this.lookups)return null;return {operation:this.operation,lookups:this.lookups,cache:{...this.cache},ms:Object.fromEntries(phases.map(name=>[name,bounded(this.elapsed[name]+(this.active[name]?this.now()-this.active[name].at:0),300000)]))};}
}
export function cleanCatalogCost(value){
 if(!operations.includes(value?.operation)||!Number.isSafeInteger(value.lookups)||value.lookups<1||value.lookups>100)return null;
 const cache={},ms={};for(const name of cacheKinds){const n=value.cache?.[name];if(!Number.isSafeInteger(n)||n<0||n>value.lookups)return null;cache[name]=n;}
 if(Object.values(cache).reduce((a,b)=>a+b,0)>value.lookups)return null;
 for(const name of phases){const n=value.ms?.[name];if(!Number.isFinite(n)||n<0||n>300000)return null;ms[name]=Math.round(n);}
 return {operation:value.operation,lookups:value.lookups,cache,ms};
}
const empty=()=>({requests:0,lookups:0,cache:{memory:0,durable:0,miss:0},ms:{localCache:0,provider:0,unattributed:0}});
export function addCatalogCost(target,value){const clean=cleanCatalogCost(value);if(!clean)return target;const row=target[clean.operation]??=empty();row.requests++;row.lookups+=clean.lookups;for(const k of cacheKinds)row.cache[k]+=clean.cache[k];for(const k of phases)row.ms[k]+=clean.ms[k];return target;}
export function mergeCatalogCost(target,source){for(const op of operations){const value=source?.[op];if(!value)continue;const row=target[op]??=empty();row.requests+=value.requests;row.lookups+=value.lookups;for(const k of cacheKinds)row.cache[k]+=value.cache[k];for(const k of phases)row.ms[k]+=value.ms[k];}return target;}
export function catalogCostSummary(value){return operations.filter(op=>value?.[op]?.requests>0).map(operation=>{const row=value[operation];return {operation,requests:row.requests,lookups:row.lookups,cache:{...row.cache},avgMs:Object.fromEntries(phases.map(name=>[name,Math.round(row.ms[name]/row.requests)]))};});}
