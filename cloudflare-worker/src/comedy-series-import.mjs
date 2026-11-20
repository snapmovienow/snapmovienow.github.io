import {exclusiveSnapshot,exclusiveCatalogRoute} from './exclusive-catalog.mjs';
import {inspectCatalogSource} from './catalog-source-check.mjs';
import {COMEDY_SERIES_DEFINITIONS} from './comedy-series-catalog.mjs';
import {COMEDY_GNULA_EPISODES} from './comedy-gnula-source.mjs';
import {comedyDefinitionForTitle,comedyEpisodeId} from './comedy-series-xtream.mjs';

const KEY='catalog-import:comedy-series-owner-20261120-v2';
export const COMEDY_SERIES_IMPORT_REQUEST='comedy-series-owner-20261120-v2';
const definition=COMEDY_SERIES_DEFINITIONS.find(row=>row.id==='comedy-muertos-sl');
const poster='https://i0.wp.com/ww3.gnulahd.nu/wp-content/uploads/2026/08/g6vptk7afH3OHOKSjdjJJtEoOMh.webp';
const plot='Tras la muerte del fundador de una funeraria familiar, su viuda y los empleados se disputan el futuro del negocio.';
const states=new Set(['pending','running','completed','failed']);
const reasons=new Set(['source_unavailable','inventory_incomplete','duplicate_series','identity_conflict','existing_identity_needs_review','existing_preserved','catalog_changed','catalog_save_failed']);
const positive=value=>Number.isSafeInteger(value)&&value>=0;

function targets(){
 const expected=Object.entries(definition.seasons).flatMap(([season,count])=>Array.from({length:count},(_,index)=>({season:Number(season),episode_num:index+1})));
 if(COMEDY_GNULA_EPISODES.length!==expected.length)return null;
 const result=[],pages=new Set();
 for(const episode of expected){
  const matches=COMEDY_GNULA_EPISODES.filter(row=>row.season===episode.season&&row.episode===episode.episode_num);
  if(matches.length!==1||pages.has(matches[0].page))return null;
  pages.add(matches[0].page);
  result.push({...episode,id:comedyEpisodeId(definition,episode.season,episode.episode_num),title:'Episodio '+episode.episode_num,page:matches[0].page});
 }
 return result;
}

function matchingRows(rows){
 const pages=new Set(COMEDY_GNULA_EPISODES.map(episode=>episode.page));
 return rows.filter(row=>row.type==='series'&&(row.id===definition.id||row.page===definition.sourcePage||comedyDefinitionForTitle(row.name)?.id===definition.id||row.episodes?.some(episode=>pages.has(episode.page))));
}

function conflict(rows){
 const candidates=matchingRows(rows),existing=rows.find(row=>row.id===definition.id);
 return candidates.length>1?'duplicate_series':existing&&existing.type!=='series'?'identity_conflict':candidates[0]&&candidates[0].id!==definition.id?'existing_identity_needs_review':null;
}

// Expose only static catalogue identities and bounded probe evidence. Stored
// claims, arbitrary exception strings and temporary source URLs stay private.
export async function comedySeriesImportStatus(store){
 const job=await store.get(KEY),state=states.has(job?.state)?job.state:'pending',result={requestId:COMEDY_SERIES_IMPORT_REQUEST,state};
 for(const field of ['attempts','startedAt','finishedAt'])if(positive(job?.[field]))result[field]=field==='attempts'?Math.min(job[field],3):job[field];
 if(reasons.has(job?.reason))result.reason=job.reason;
 if(job?.seriesId===definition.id)result.seriesId=definition.id;
 if(typeof job?.visible==='boolean')result.visible=job.visible;
 const known=new Map((targets()||[]).map(episode=>[episode.id,episode]));
 result.results=(Array.isArray(job?.results)?job.results:[]).filter(row=>known.has(row?.id)).slice(0,known.size).map(row=>{
  const episode=known.get(row.id),status=['online','unavailable','added'].includes(row.status)?row.status:'unavailable';
  return {id:episode.id,season:episode.season,episode_num:episode.episode_num,status,check:row.check==='playlist_and_segment'?'playlist_and_segment':'unavailable',...(positive(row.checkedAt)?{checkedAt:row.checkedAt}:{})};
 });
 result.series=COMEDY_SERIES_DEFINITIONS.map(row=>row.id===definition.id?{id:row.id,name:row.name,state,...(result.reason?{reason:result.reason}:{}),...(result.visible!==undefined?{visible:result.visible}:{})}:row.id==='comedy-machos-alfa'?{id:row.id,name:row.name,state:'pending_source'}:{id:row.id,name:row.name,state:'blocked_subscription'});
 return result;
}

// The normal private maintenance invocation owns this bounded publication.
// No subscriber credentials or playback leases are requested by these probes.
export async function runComedySeriesImport(store,leases,env,{probe=inspectCatalogSource,now=Date.now}={}){
 if(env.ENVIRONMENT!=='production'||env.CATALOG_MAINTENANCE_ENABLED!=='true'||env.COMEDY_SERIES_IMPORT_ENABLED!=='true')return;
 const claim=await store.transaction(async tx=>{
  const old=await tx.get(KEY),at=now();
  if(['completed','failed'].includes(old?.state)||old?.claimUntil>at)return null;
  const attempts=positive(old?.attempts)?old.attempts:0;
  if(attempts>=3){await tx.put(KEY,{...old,requestId:COMEDY_SERIES_IMPORT_REQUEST,state:'failed',attempts:3,reason:'source_unavailable',claimUntil:0,finishedAt:at});return null;}
  const rows=(await exclusiveSnapshot(tx)).items,reason=conflict(rows),existing=rows.find(row=>row.id===definition.id);
  if(reason){await tx.put(KEY,{requestId:COMEDY_SERIES_IMPORT_REQUEST,state:'failed',attempts,reason,finishedAt:at,results:[]});return null;}
  // A manual save or hide always wins, including later metadata/source edits.
  if(existing){await tx.put(KEY,{requestId:COMEDY_SERIES_IMPORT_REQUEST,state:'completed',attempts,seriesId:existing.id,visible:existing.visible===true,reason:'existing_preserved',finishedAt:at,results:[]});return null;}
  const episodes=targets();
  if(!episodes){await tx.put(KEY,{requestId:COMEDY_SERIES_IMPORT_REQUEST,state:'failed',attempts,reason:'inventory_incomplete',finishedAt:at,results:[]});return null;}
  const job={requestId:COMEDY_SERIES_IMPORT_REQUEST,state:'running',attempts:attempts+1,startedAt:positive(old?.startedAt)?old.startedAt:at,claim:crypto.randomUUID(),claimUntil:at+900000,results:[]};
  await tx.put(KEY,job);return {job,episodes};
 });
 if(!claim)return;
 const results=[];
 // All 26 checks must succeed in this attempt. Two normal HTTPS source probes
 // at a time keep remote work bounded and avoid reserving customer connections.
 for(let start=0;start<claim.episodes.length;start+=2)results.push(...await Promise.all(claim.episodes.slice(start,start+2).map(async episode=>{
  let online=false;try{const result=await probe({mode:'gnula',page:episode.page});online=result?.ok===true&&result.check==='playlist_and_segment';}catch{}
  return {id:episode.id,season:episode.season,episode_num:episode.episode_num,status:online?'online':'unavailable',checkedAt:now(),check:online?'playlist_and_segment':'unavailable'};
 })));
 await store.transaction(async tx=>{
  const job=await tx.get(KEY);if(job?.claim!==claim.job.claim)return;
  const finish=(state,reason,extra={})=>{
   const {reason:previousReason,finishedAt:previousFinished,...base}=job;
   return tx.put(KEY,{...base,state,results,claimUntil:0,...(reason?{reason}:{}),...(state==='completed'||state==='failed'?{finishedAt:now()}:{}),...extra});
  };
  if(results.some(result=>result.status!=='online')){await finish(job.attempts>=3?'failed':'running','source_unavailable');return;}
  const current=(await exclusiveSnapshot(tx)).items;
  if(current.some(row=>row.id===definition.id)||matchingRows(current).length){await finish('failed','catalog_changed');return;}
  const item={id:definition.id,name:definition.name,year:definition.year,page:definition.sourcePage,poster,plot,type:'series',source:'GNULA',mode:'gnula',visible:true,adult:false,episodes:claim.episodes.map(episode=>({...episode,poster,plot}))};
  const response=await exclusiveCatalogRoute(tx,'/exclusive-save',{item,revision:0,actor:'owner-comedy-series-import-20261120'});
  const saved=response.ok;await response.body?.cancel();
  if(!saved){await finish('failed','catalog_save_failed');return;}
  await finish('completed',null,{seriesId:item.id,visible:true,results:results.map(result=>({...result,status:'added'}))});
 });
}
