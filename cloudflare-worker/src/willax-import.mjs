import {exclusiveSnapshot,exclusiveCatalogRoute} from './exclusive-catalog.mjs';
import {inspectCatalogSource} from './catalog-source-check.mjs';
import {WILLAX_CHANNEL as CHANNEL} from './willax-live.mjs';

const KEY='catalog-import:willax-peru-owner-20261117-v1';
export const WILLAX_REQUEST='willax-peru-owner-20261117-v1';
export async function willaxImportStatus(store){
 const job=await store.get(KEY);
 return job?Object.fromEntries(['requestId','state','attempts','startedAt','finishedAt','results'].filter(k=>job[k]!==undefined).map(k=>[k,job[k]])):{requestId:WILLAX_REQUEST,state:'pending'};
}
// One finite owner-authorized addition through the existing private catalog
// maintenance tick. Existing provider rows and manual catalog edits stay intact.
export async function runWillaxImport(store,leases,env,{probe=inspectCatalogSource,now=Date.now}={}){
 if(env.ENVIRONMENT!=='production'||env.CATALOG_MAINTENANCE_ENABLED!=='true')return;
 const claim=await store.transaction(async tx=>{
  const old=await tx.get(KEY);if(old?.state==='completed'||old?.claimUntil>now())return null;
  if(old?.attempts>=3){await tx.put(KEY,{...old,state:'completed',claimUntil:0,finishedAt:now()});return null;}
  const rows=(await exclusiveSnapshot(tx)).items,existing=rows.find(r=>r.id===CHANNEL.id)||rows.find(r=>r.page===CHANNEL.page);
  const job={requestId:WILLAX_REQUEST,state:'running',attempts:(old?.attempts||0)+1,startedAt:old?.startedAt||now(),results:old?.results||[],claim:crypto.randomUUID(),claimUntil:now()+600000};
  await tx.put(KEY,job);return {job,existing};
 });
 if(!claim)return;
 let status=claim.existing?(claim.existing.id===CHANNEL.id?'existing_preserved':'duplicate_preserved'):'unavailable';
 if(!claim.existing)try{if((await probe({mode:'gnula',page:CHANNEL.page})).ok)status='ready';}catch{}
 await store.transaction(async tx=>{
  const job=await tx.get(KEY);if(job?.claim!==claim.job.claim)return;
  const rows=(await exclusiveSnapshot(tx)).items;let current=rows.find(r=>r.id===CHANNEL.id)||rows.find(r=>r.page===CHANNEL.page);
  if(current&&!claim.existing)status='catalog_changed';
  if(status==='ready'){
   const item={id:CHANNEL.id,type:'movie',name:CHANNEL.name,source:'WILLAX · señal alternativa',mode:'gnula',page:CHANNEL.page,poster:CHANNEL.poster,plot:CHANNEL.plot,year:null,visible:true,adult:false,usageKind:'channel',episodes:[]};
   const response=await exclusiveCatalogRoute(tx,'/exclusive-save',{item,revision:0,actor:'owner-willax-peru-import-20261117'});
   if(response.ok){current=(await response.json()).item;status='added';}else status='save_failed';
  }
  const result={id:CHANNEL.id,name:CHANNEL.name,status,checkedAt:now(),monitoring:!!(current?.id===CHANNEL.id&&current.type==='movie'&&current.mode==='gnula'&&current.page===CHANNEL.page&&current.usageKind==='channel'),visible:current?.visible===true,...(current?{catalogId:current.id}:{}),...(status==='added'?{check:'playlist_and_segment'}:{})};
  const completed=status!=='unavailable'||job.attempts>=3;
  await tx.put(KEY,{...job,state:completed?'completed':'running',claimUntil:0,results:[result],...(completed?{finishedAt:now()}:{})});
 });
}
