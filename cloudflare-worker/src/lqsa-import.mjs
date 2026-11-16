import {exclusiveSnapshot,exclusiveCatalogRoute} from './exclusive-catalog.mjs';
import {makeLqsaSupplement,matchesLqsaTitle} from './series-supplement.mjs';

// Invoked only by an internal, owner-authorized maintenance job. It never
// accepts a source URL or a target identity from a public HTTP request.
const KEY='catalog-import:lqsa-t17-20261116-v1';
export const LQSA_IMPORT={requestId:'lqsa-t17-owner-publish-20261116-v1',id:'lqsa-t17-jonilar'};
const PREFIX='https://ia600409.us.archive.org/23/items/1701_20261115/';
const pages=new Set([1,2,3].map(number=>PREFIX+'170'+number+'.mp4'));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const numeric=value=>/^\d{1,16}$/.test(String(value||''))&&Number.isSafeInteger(Number(value));
const validServer=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value);
const failure=code=>Object.assign(Error(code),{importCode:code});

export function chooseLqsaSeries(rows){
 if(!Array.isArray(rows))throw failure('catalog_unavailable');
 const matches=rows.filter(row=>object(row)&&matchesLqsaTitle(row.name));
 if(!matches.length)throw failure('series_not_found');
 if(matches.some(row=>!numeric(row.series_id)||!validServer(row._server)))throw failure('series_identity_invalid');
 const refs=new Map(matches.map(row=>[row._server+'|'+String(row.series_id),row]));
 if(refs.size===1)return [...refs.values()][0];
 const primary=[...refs.values()].filter(row=>row._server==='ccf');
 if(primary.length===1)return primary[0];
 throw failure('ambiguous_series');
}

async function prefix(response,max){
 const reader=response.body?.getReader();if(!reader)throw Error('empty');
 const chunks=[];let size=0;
 try{while(size<max){const part=await reader.read();if(part.done)break;const kept=part.value.subarray(0,max-size);chunks.push(kept);size+=kept.length;}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}return bytes;
}

// A small ranged MP4 read verifies the actual delivery path, not an HTML page
// or a Content-Type alone. Nothing is stored and no client lease is acquired.
export async function inspectLqsaMedia(media,{fetcher=fetch}={}){
 let target;
 try{target=new URL(media?.page);if(!pages.has(target.href))throw Error('scope');}catch{return {ok:false,rangeSupported:false,ftyp:false,check:'unavailable'};}
 const signal=AbortSignal.timeout(10000);
 try{
  for(let hop=0;hop<=2;hop++){
   const response=await fetcher(target.href,{method:'GET',headers:{Accept:'video/mp4, application/octet-stream',Range:'bytes=0-65535'},redirect:'manual',signal});
   if(response.status>=300&&response.status<400){
    const location=response.headers.get('location');await response.body?.cancel();
    if(!location||hop===2)throw Error('redirect');const next=new URL(location,target);
    if(next.href!==target.href)throw Error('redirect');target=next;continue;
   }
   const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
   const range=/^bytes 0-(\d+)\/(\d+)$/.exec(response.headers.get('content-range')||'');
   const end=Number(range?.[1]),total=Number(range?.[2]);
   if(response.status!==206||!['video/mp4','application/octet-stream'].includes(type)||!range||!Number.isSafeInteger(end)||end<11||end>65535||!Number.isSafeInteger(total)||total<=end){await response.body?.cancel();throw Error('range');}
   const bytes=await prefix(response,65536),ftyp=bytes.length>=12&&String.fromCharCode(...bytes.subarray(4,8))==='ftyp';
   if(bytes.length!==end+1||!ftyp)throw Error('media');
   return {ok:true,rangeSupported:true,ftyp:true,check:'range_and_mp4_bytes'};
  }
 }catch{}
 return {ok:false,rangeSupported:false,ftyp:false,check:'unavailable'};
}

export async function lqsaImportStatus(store){
 const job=await store.get(KEY);
 return job?Object.fromEntries(['requestId','state','attempts','startedAt','finishedAt','seriesId','target','visible','reason','results'].filter(key=>job[key]!==undefined).map(key=>[key,job[key]])):{requestId:LQSA_IMPORT.requestId,state:'pending'};
}

export async function runLqsaImport(store,leases,env,{catalog,probe=inspectLqsaMedia,now=Date.now,save=exclusiveCatalogRoute}={}){
 if(env.ENVIRONMENT!=='production'||env.CATALOG_MAINTENANCE_ENABLED!=='true'||typeof catalog!=='function')return;
 const claim=await store.transaction(async tx=>{
  const old=await tx.get(KEY);if(['completed','failed'].includes(old?.state)||old?.claimUntil>now())return null;
  const row=(await exclusiveSnapshot(tx)).items.find(item=>item.id===LQSA_IMPORT.id);
  const job={requestId:LQSA_IMPORT.requestId,state:'running',attempts:(old?.attempts||0)+1,startedAt:old?.startedAt||now(),claim:crypto.randomUUID(),claimUntil:now()+120000};
  await tx.put(KEY,job);return {job,row};
 });
 if(!claim)return;
 const finish=async(state,reason,extra={})=>store.transaction(async tx=>{
  const job=await tx.get(KEY);if(job?.claim!==claim.job.claim)return;
  await tx.put(KEY,{...job,...extra,state,...(reason?{reason}:{}),claimUntil:0,...(state==='running'?{}:{finishedAt:now()})});
 });
 let target,item;
 try{
  const row=chooseLqsaSeries(await catalog('get_series',undefined,{}, {fresh:true}));
  const details=await catalog('get_series_info',row._server,{series_id:String(row.series_id)},{fresh:true});
  if(!object(details)||!object(details.episodes)||details.info!==undefined&&!object(details.info))throw failure('catalog_unavailable');
  if(details.info?.name!==undefined&&!matchesLqsaTitle(details.info.name))throw failure('series_identity_invalid');
  target={server:row._server,seriesId:String(row.series_id)};
  const info=details.info||{},year=Number(info.year||row.year);
  item=makeLqsaSupplement({...target,name:row.name,poster:typeof info.cover==='string'?info.cover:typeof row.cover==='string'?row.cover:'',plot:typeof info.plot==='string'?info.plot.slice(0,3000):'',year:Number.isInteger(year)&&year>=1880&&year<=2200?year:null});
  if(claim.row){
   const old=claim.row;
   if(old.type!=='series'||old.mode!=='direct'||!matchesLqsaTitle(old.name)||old.source!=='JONILAR'||JSON.stringify(old.supplement)!==JSON.stringify(target)||!old.visible||JSON.stringify(old.episodes)!==JSON.stringify(item.episodes))throw failure('identity_conflict');
   item={...old};
  }
 }catch(error){
  const reason=error?.importCode||'catalog_unavailable',terminal=['ambiguous_series','series_identity_invalid','identity_conflict'].includes(reason);
  await finish(terminal||claim.job.attempts>=3?'failed':'running',reason);return;
 }
 const results=await Promise.all(item.episodes.map(async episode=>{
  let valid=false;try{const result=await probe({mode:'direct',page:episode.page});valid=result?.ok===true&&result.rangeSupported===true&&result.ftyp===true;}catch{}
  return {episode_num:episode.episode_num,status:valid?'online':'unavailable',check:valid?'range_and_mp4_bytes':'unavailable'};
 }));
 if(results.some(result=>result.status!=='online')){await finish(claim.job.attempts>=3?'failed':'running','source_unavailable',{target,results});return;}
 try{
  await store.transaction(async tx=>{
   const job=await tx.get(KEY);if(job?.claim!==claim.job.claim)return;
   const current=(await exclusiveSnapshot(tx)).items.find(row=>row.id===LQSA_IMPORT.id);
   if(JSON.stringify(current)!==JSON.stringify(claim.row)){await tx.put(KEY,{...job,state:'failed',reason:'catalog_changed',finishedAt:now(),claimUntil:0});return;}
   const response=await save(tx,'/exclusive-save',{item,revision:claim.row?.revision||0,actor:'owner-lqsa-import-20261116'});
   if(!response.ok){await tx.put(KEY,{...job,state:'failed',reason:'catalog_save_failed',finishedAt:now(),claimUntil:0});return;}
   const saved=(await response.json()).item;
   if(JSON.stringify(saved?.supplement)!==JSON.stringify(target))throw failure('supplement_not_persisted');
   await leases.in(tx).removeMatching(lease=>lease.exclusiveParentId===saved.id&&lease.playbackRevision!==saved.playbackRevision);
   await tx.put(KEY,{...job,state:'completed',seriesId:saved.id,target,visible:true,results,finishedAt:now(),claimUntil:0});
  });
 }catch{await finish('failed','catalog_save_failed');}
}
