import {exclusiveSnapshot,exclusiveCatalogRoute} from './exclusive-catalog.mjs';
import {inspectCatalogSource} from './catalog-source-check.mjs';
import {PUBLIC_TV_CHANNELS} from './public-tv-channels.mjs';

const KEY='catalog-import:public-tv-owner-20261102-v1';
export const PUBLIC_TV_REQUEST='public-tv-owner-20261102-7eae448c';
export async function publicTvImportStatus(store){
 const job=await store.get(KEY);
 return job?Object.fromEntries(['requestId','state','attempts','startedAt','finishedAt','results'].filter(k=>job[k]!==undefined).map(k=>[k,job[k]])):{requestId:PUBLIC_TV_REQUEST,state:'pending'};
}
// One finite owner-authorized publication; use the existing private cron and
// catalog writer. A failed source stays unpublished, and manual edits always win.
export async function runPublicTvImport(store,leases,env,{probe=inspectCatalogSource,now=Date.now}={}){
 if(env.ENVIRONMENT!=='production'||env.CATALOG_MAINTENANCE_ENABLED!=='true')return;
 const claim=await store.transaction(async tx=>{
  const old=await tx.get(KEY);if(old?.state==='completed'||old?.claimUntil>now())return null;
  const rows=(await exclusiveSnapshot(tx)).items,results=old?.results||[];
  const targets=PUBLIC_TV_CHANNELS.filter(c=>!results.some(r=>r.id===c.id&&r.status!=='unavailable')).map(channel=>({channel,old:rows.find(r=>r.id===channel.id),duplicate:rows.find(r=>r.id!==channel.id&&r.page===channel.page)}));
  const job={requestId:PUBLIC_TV_REQUEST,state:'running',attempts:(old?.attempts||0)+1,startedAt:old?.startedAt||now(),results,claim:crypto.randomUUID(),claimUntil:now()+600000};
  await tx.put(KEY,job);return {job,targets};
 });
 if(!claim)return;
 const choices=[];
 // Four checks at a time; release every upstream response before the next one.
 for(let start=0;start<claim.targets.length;start+=4)choices.push(...await Promise.all(claim.targets.slice(start,start+4).map(async target=>{
  if(target.old)return {...target,status:'existing_preserved'};
  if(target.duplicate)return {...target,status:'duplicate_preserved'};
  try{return {...target,status:(await probe({mode:'direct',page:target.channel.page})).ok?'ready':'unavailable'};}catch{return {...target,status:'unavailable'};}
 })));
 await store.transaction(async tx=>{
  const job=await tx.get(KEY);if(job?.claim!==claim.job.claim)return;
  const results=[...job.results];
  for(const choice of choices){
   const c=choice.channel,rows=(await exclusiveSnapshot(tx)).items;let status=choice.status;
   if(status==='ready'){
    if(rows.some(row=>row.id===c.id||row.page===c.page))status='catalog_changed';
    else{
     const item={id:c.id,type:'movie',name:c.name,source:'TV GRATUITA',mode:'direct',page:c.page,poster:c.poster,plot:c.plot,year:null,visible:true,adult:false,usageKind:'channel',episodes:[]};
     const saved=await exclusiveCatalogRoute(tx,'/exclusive-save',{item,revision:0,actor:'owner-public-tv-import-20261102'});status=saved.ok?'added':'save_failed';
    }
   }
   const current=rows.find(row=>row.id===c.id)||rows.find(row=>row.page===c.page);
   const result={id:c.id,name:c.name,status,checkedAt:now(),monitoring:status==='added'||!!(current&&current.type==='movie'&&current.mode==='direct'&&current.page===c.page),...(status==='added'?{check:'playlist_and_segment'}:{})};
   const index=results.findIndex(r=>r.id===c.id);if(index<0)results.push(result);else results[index]=result;
  }
  const completed=job.attempts>=3||results.length===PUBLIC_TV_CHANNELS.length&&results.every(r=>r.status!=='unavailable');
  await tx.put(KEY,{...job,state:completed?'completed':'running',claimUntil:0,results,...(completed?{finishedAt:now()}:{})});
 });
}
