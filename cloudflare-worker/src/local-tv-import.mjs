import {exclusiveSnapshot,exclusiveCatalogRoute} from './exclusive-catalog.mjs';
import {inspectCatalogSource} from './catalog-source-check.mjs';
import {OFFICIAL_CHANNELS,EXTRA_OFFICIAL_CHANNELS,REGIONAL_CHANNELS} from './official-live.mjs';
const KEY='catalog-import:kansas-local-tv-20261029-v2';
export const LOCAL_TV_REQUEST='kansas-local-tv-owner-20261029-v2';
const EXPANSION_KEY='catalog-import:kansas-local-tv-expansion-20261030-v1';
export const LOCAL_TV_EXPANSION_REQUEST='kansas-local-tv-expansion-owner-20261030-v1';
const REGIONAL_KEY='catalog-import:regional-local-tv-20261030-v1';
export const REGIONAL_TV_REQUEST='regional-local-tv-owner-20261030-v1';
export async function regionalTvImportStatus(store){const job=await store.get(REGIONAL_KEY);return job?Object.fromEntries(['requestId','state','attempts','startedAt','finishedAt','results'].filter(k=>job[k]!==undefined).map(k=>[k,job[k]])):{requestId:REGIONAL_TV_REQUEST,state:'pending'};}
export async function localTvImportStatus(store){
 const job=await store.get(KEY);return job?Object.fromEntries(['requestId','state','attempts','startedAt','finishedAt','results'].filter(k=>job[k]!==undefined).map(k=>[k,job[k]])):{requestId:LOCAL_TV_REQUEST,state:'pending'};
}
export async function localTvExpansionStatus(store){const job=await store.get(EXPANSION_KEY);return job?Object.fromEntries(['requestId','state','attempts','startedAt','finishedAt','results'].filter(k=>job[k]!==undefined).map(k=>[k,job[k]])):{requestId:LOCAL_TV_EXPANSION_REQUEST,state:'pending'};}
// A finite owner-requested import through the existing private cron, not a public write API.
export const runLocalTvImport=(store,leases,env,options)=>runImport(store,leases,env,{key:KEY,requestId:LOCAL_TV_REQUEST,channels:OFFICIAL_CHANNELS,actor:'owner-local-tv-import-20261029'},options);
export const runLocalTvExpansion=(store,leases,env,options)=>runImport(store,leases,env,{key:EXPANSION_KEY,requestId:LOCAL_TV_EXPANSION_REQUEST,channels:EXTRA_OFFICIAL_CHANNELS,actor:'owner-local-tv-expansion-20261030'},options);
export const runRegionalTvImport=(store,leases,env,options)=>runImport(store,leases,env,{key:REGIONAL_KEY,requestId:REGIONAL_TV_REQUEST,channels:REGIONAL_CHANNELS,actor:'owner-regional-local-tv-20261030'},options);
async function runImport(store,leases,env,{key:KEY,requestId:LOCAL_TV_REQUEST,channels:OFFICIAL_CHANNELS,actor},{probe=inspectCatalogSource,now=Date.now}={}){
 if(env.ENVIRONMENT!=='production'||env.CATALOG_MAINTENANCE_ENABLED!=='true')return;
 const claim=await store.transaction(async tx=>{
  const old=await tx.get(KEY);if(old?.state==='completed'||old?.claimUntil>now())return null;
  const rows=(await exclusiveSnapshot(tx)).items,results=old?.results||[],targets=OFFICIAL_CHANNELS.filter(c=>!results.some(r=>r.id===c.id&&r.status!=='unavailable'));
  const job={requestId:LOCAL_TV_REQUEST,state:'running',attempts:(old?.attempts||0)+1,startedAt:old?.startedAt||now(),results,claim:crypto.randomUUID(),claimUntil:now()+180000};
  await tx.put(KEY,job);return {job,targets:targets.map(channel=>({channel,old:rows.find(row=>row.id===channel.id),duplicate:rows.some(row=>row.id!==channel.id&&row.page===channel.page)}))};
 });
 if(!claim)return;
 const choices=await Promise.all(claim.targets.map(async target=>{
  if(target.duplicate)return {...target,status:'duplicate_preserved'};
  if(target.old)return {...target,status:'existing_preserved'};
  try{return {...target,status:(await probe({mode:'gnula',page:target.channel.page})).ok?'ready':'unavailable'};}catch{return {...target,status:'unavailable'};}
 }));
 await store.transaction(async tx=>{
  const job=await tx.get(KEY);if(job?.claim!==claim.job.claim)return;const results=[...job.results];
  for(const choice of choices){
   const c=choice.channel,rows=(await exclusiveSnapshot(tx)).items;let status=choice.status;
   if(status==='ready'){
    if(rows.some(row=>row.id===c.id||row.page===c.page))status='catalog_changed';
    else{
     const item={id:c.id,type:'movie',name:c.name,source:'TV LOCAL OFICIAL',mode:'gnula',page:c.page,poster:c.poster,plot:c.plot,year:null,visible:true,adult:false,episodes:[]};
     const saved=await exclusiveCatalogRoute(tx,'/exclusive-save',{item,revision:0,actor});status=saved.ok?'added':'save_failed';
    }
   }
   const result={id:c.id,name:c.name,status,checkedAt:now(),...(status==='added'?{check:'playlist_and_segment'}:{})},index=results.findIndex(r=>r.id===c.id);if(index<0)results.push(result);else results[index]=result;
  }
  const completed=job.attempts>=3||results.every(r=>r.status!=='unavailable');
  await tx.put(KEY,{...job,state:completed?'completed':'running',claimUntil:0,results,...(completed?{finishedAt:now()}:{})});
 });
}
