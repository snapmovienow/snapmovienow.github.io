import {exclusiveSnapshot,exclusiveCatalogRoute} from './exclusive-catalog.mjs';
import {inspectCatalogSource} from './catalog-source-check.mjs';
import {UNIVISION_NY_CHANNEL as CHANNEL} from './public-tv-channels.mjs';

const KEY='catalog-import:univision-ny-owner-20261102-v1';
export const UNIVISION_NY_REQUEST='univision-ny-owner-20261103-dba5fdfd';
export async function univisionNyImportStatus(store){
 const job=await store.get(KEY);
 return job?Object.fromEntries(['requestId','state','attempts','startedAt','finishedAt','results'].filter(k=>job[k]!==undefined).map(k=>[k,job[k]])):{requestId:UNIVISION_NY_REQUEST,state:'pending'};
}
// Finite publication through the existing private cron. No new public write
// endpoint, customer credentials, permanent CDN sessions or provider allocation.
export async function runUnivisionNyImport(store,leases,env,{probe=inspectCatalogSource,now=Date.now}={}){
 if(env.ENVIRONMENT!=='production'||env.CATALOG_MAINTENANCE_ENABLED!=='true')return;
 const claim=await store.transaction(async tx=>{
  const old=await tx.get(KEY);if(old?.state==='completed'||old?.claimUntil>now())return null;
  const rows=(await exclusiveSnapshot(tx)).items,existing=rows.find(r=>r.id===CHANNEL.id)||rows.find(r=>r.page===CHANNEL.page);
  const job={requestId:UNIVISION_NY_REQUEST,state:'running',attempts:(old?.attempts||0)+1,startedAt:old?.startedAt||now(),results:old?.results||[],claim:crypto.randomUUID(),claimUntil:now()+600000};
  await tx.put(KEY,job);return {job,existing};
 });
 if(!claim)return;
 let status=claim.existing?(claim.existing.id===CHANNEL.id?'existing_preserved':'duplicate_preserved'):'unavailable';
 if(!claim.existing)try{if((await probe({mode:'direct',page:CHANNEL.page})).ok)status='ready';}catch{}
 await store.transaction(async tx=>{
  const job=await tx.get(KEY);if(job?.claim!==claim.job.claim)return;
  const rows=(await exclusiveSnapshot(tx)).items;let current=rows.find(r=>r.id===CHANNEL.id)||rows.find(r=>r.page===CHANNEL.page);
  if(current&&!claim.existing)status='catalog_changed';
  if(status==='ready'){
   const item={id:CHANNEL.id,type:'movie',name:CHANNEL.name,source:'UNIVISION WXTV',mode:'direct',page:CHANNEL.page,poster:CHANNEL.poster,plot:CHANNEL.plot,year:null,visible:true,adult:false,usageKind:'channel',episodes:[]};
   const response=await exclusiveCatalogRoute(tx,'/exclusive-save',{item,revision:0,actor:'owner-univision-ny-import-20261102'});
   if(response.ok){current=(await response.json()).item;status='added';}else status='save_failed';
  }
  const result={id:CHANNEL.id,name:CHANNEL.name,status,checkedAt:now(),monitoring:!!(current?.type==='movie'&&current.mode==='direct'&&current.page===CHANNEL.page),visible:current?.visible===true,...(current?{catalogId:current.id}:{}),...(status==='added'?{check:'playlist_and_segment'}:{})};
  const completed=status!=='unavailable'||job.attempts>=3;
  await tx.put(KEY,{...job,state:completed?'completed':'running',claimUntil:0,results:[result],...(completed?{finishedAt:now()}:{})});
 });
}
