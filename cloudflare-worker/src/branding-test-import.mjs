import {exclusiveSnapshot,exclusiveCatalogRoute} from './exclusive-catalog.mjs';
import {inspectCatalogSource} from './catalog-source-check.mjs';
import {BRANDING_TEST_CHANNEL as CHANNEL} from './public-tv-channels.mjs';

const KEY='catalog-import:branding-test-owner-20261104-v1';
export const BRANDING_TEST_REQUEST='branding-test-owner-20261104-v1';
export async function brandingTestImportStatus(store){
 const job=await store.get(KEY);
 return job?Object.fromEntries(['requestId','state','attempts','startedAt','finishedAt','results'].filter(k=>job[k]!==undefined).map(k=>[k,job[k]])):{requestId:BRANDING_TEST_REQUEST,state:'pending'};
}
// One owner-requested demonstration, through the existing private maintenance
// tick. At most three probes; no reset of previous jobs or replacement of feeds.
export async function runBrandingTestImport(store,leases,env,{probe=inspectCatalogSource,now=Date.now}={}){
 if(env.ENVIRONMENT!=='production'||env.CATALOG_MAINTENANCE_ENABLED!=='true')return;
 const claim=await store.transaction(async tx=>{
  const old=await tx.get(KEY);if(old?.state==='completed'||old?.claimUntil>now())return null;
  if(old?.attempts>=3){await tx.put(KEY,{...old,state:'completed',claimUntil:0,finishedAt:now()});return null;}
  const rows=(await exclusiveSnapshot(tx)).items,existing=rows.find(r=>r.id===CHANNEL.id)||rows.find(r=>r.page===CHANNEL.page);
  const job={requestId:BRANDING_TEST_REQUEST,state:'running',attempts:(old?.attempts||0)+1,startedAt:old?.startedAt||now(),results:old?.results||[],claim:crypto.randomUUID(),claimUntil:now()+600000};
  await tx.put(KEY,job);return {job,existing};
 });
 if(!claim)return;
 let status=claim.existing?(claim.existing.id===CHANNEL.id?'existing_preserved':'duplicate_preserved'):'unavailable';
 if(!claim.existing)try{if((await probe({mode:'direct',page:CHANNEL.page})).ok)status='ready';}catch{}
 const publication=await store.transaction(async tx=>{
  const job=await tx.get(KEY);if(job?.claim!==claim.job.claim)return;
  const rows=(await exclusiveSnapshot(tx)).items;let current=rows.find(r=>r.id===CHANNEL.id)||rows.find(r=>r.page===CHANNEL.page);
  if(current&&!claim.existing)status='catalog_changed';
  if(status==='ready'){
   const item={id:CHANNEL.id,type:'movie',name:CHANNEL.name,source:'PRUEBA SNAPTVNOW',mode:'direct',page:CHANNEL.page,poster:CHANNEL.poster,plot:CHANNEL.plot,year:null,visible:true,adult:false,usageKind:'channel',episodes:[]};
   const response=await exclusiveCatalogRoute(tx,'/exclusive-save',{item,revision:0,actor:'owner-branding-test-20261104'});
   if(response.ok){current=(await response.json()).item;status='added';}else status='save_failed';
  }
  const result={id:CHANNEL.id,name:CHANNEL.name,status,checkedAt:now(),monitoring:!!(current?.type==='movie'&&current.mode==='direct'&&current.page===CHANNEL.page),visible:current?.visible===true,...(current?{catalogId:current.id}:{}),...(status==='added'?{check:'playlist_and_segment'}:{})};
  const completed=status!=='unavailable'||job.attempts>=3;
  await tx.put(KEY,{...job,state:completed?'completed':'running',claimUntil:0,results:[result],...(completed?{finishedAt:now()}:{})});
  return {status,attempt:job.attempts,visible:result.visible};
 });
 if(publication)console.log({event:'branding_test_catalog',...publication});
}
