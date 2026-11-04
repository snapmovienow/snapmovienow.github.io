import {exclusiveSnapshot,exclusiveCatalogRoute} from './exclusive-catalog.mjs';
import {inspectCatalogSource} from './catalog-source-check.mjs';
import {EMPRESS_SERIES_ID,EMPRESS_SERIES_META,EMPRESS_SERIES_PAGES,EMPRESS_EPISODES} from './empress-catalog.mjs';

// A new bounded attempt follows the reviewed /st1/files/ resolver correction.
// Keep the earlier failed job as evidence and preserve any owner-saved series.
const KEY='catalog-import:empress-disney-owner-20261104-st1-v2';
export const EMPRESS_IMPORT_REQUEST='empress-disney-owner-20261104-st1-fix';
const matches=row=>row.type==='series'&&(row.id===EMPRESS_SERIES_ID||EMPRESS_SERIES_PAGES.includes(row.page)||row.year===2026&&String(row.name).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/ 2026$/,'')==='la emperatriz divorciada');
export async function empressImportStatus(store){
 const job=await store.get(KEY);return job?Object.fromEntries(['requestId','state','attempts','startedAt','finishedAt','seriesId','visible','reason','results'].filter(key=>job[key]!==undefined).map(key=>[key,job[key]])):{requestId:EMPRESS_IMPORT_REQUEST,state:'pending'};
}
export async function runEmpressImport(store,leases,env,{probe=inspectCatalogSource,now=Date.now}={}){
 if(env.ENVIRONMENT!=='production'||env.CATALOG_MAINTENANCE_ENABLED!=='true')return;
 const claim=await store.transaction(async tx=>{
  const old=await tx.get(KEY);if(['completed','failed'].includes(old?.state)||old?.claimUntil>now())return null;
  const rows=(await exclusiveSnapshot(tx)).items,candidates=rows.filter(matches),existing=rows.find(row=>row.id===EMPRESS_SERIES_ID);
  const reason=candidates.length>1?'duplicate_series':existing&&!matches(existing)?'identity_conflict':candidates[0]&&candidates[0].id!==EMPRESS_SERIES_ID?'existing_identity_needs_review':null;
  if(reason){await tx.put(KEY,{requestId:EMPRESS_IMPORT_REQUEST,state:'failed',reason,finishedAt:now()});return null;}
  // A saved series is a manual owner decision. Never reactivate, rewrite its
  // identity, or overwrite later edits through this one-time publication.
  if(existing){await tx.put(KEY,{requestId:EMPRESS_IMPORT_REQUEST,state:'completed',attempts:0,seriesId:existing.id,visible:existing.visible===true,reason:'existing_preserved',finishedAt:now(),results:[]});return null;}
  const job={requestId:EMPRESS_IMPORT_REQUEST,state:'running',attempts:(old?.attempts||0)+1,startedAt:old?.startedAt||now(),claim:crypto.randomUUID(),claimUntil:now()+600000,results:[]};
  await tx.put(KEY,job);return job;
 });
 if(!claim)return;
 const targets=EMPRESS_EPISODES.flatMap(ep=>[{...ep,option:1},...ep.alternatives.map(option=>({...option,season:ep.season,episode_num:ep.episode_num,option:2}))]),results=[];
 // Bound both work and concurrency. The catalog is published atomically only
 // when all four episodes have two verified video sources in this attempt.
 for(let start=0;start<targets.length;start+=2)results.push(...await Promise.all(targets.slice(start,start+2).map(async target=>{
  let online=false;try{online=(await probe({mode:'gnula',page:target.page})).ok===true;}catch{}
  return {id:target.id,season:1,episode_num:target.episode_num,option:target.option,status:online?'online':'unavailable',checkedAt:now(),check:online?'playlist_and_segment':'unavailable'};
 })));
 await store.transaction(async tx=>{
  const job=await tx.get(KEY);if(job?.claim!==claim.claim)return;
  const finish=(state,reason,extra={})=>tx.put(KEY,{...job,state,results,claimUntil:0,...(reason?{reason}:{}),...(state!=='running'?{finishedAt:now()}:{}),...extra});
  if(results.some(result=>result.status!=='online')){await finish(job.attempts>=3?'failed':'running','source_unavailable');return;}
  const current=(await exclusiveSnapshot(tx)).items;if(current.some(row=>row.id===EMPRESS_SERIES_ID||matches(row))){await finish('failed','catalog_changed');return;}
  const item={...EMPRESS_SERIES_META,type:'series',source:'PELISFLIX / TUDORAMA',mode:'gnula',visible:true,adult:false,episodes:structuredClone(EMPRESS_EPISODES)};
  const response=await exclusiveCatalogRoute(tx,'/exclusive-save',{item,revision:0,actor:'owner-empress-import-20261103'});
  if(!response.ok){await finish('failed','catalog_save_failed');return;}
  await finish('completed',null,{seriesId:item.id,visible:true,results:results.map(result=>({...result,status:'added'}))});
 });
}
