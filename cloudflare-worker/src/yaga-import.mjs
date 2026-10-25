import {exclusiveSnapshot,exclusiveCatalogRoute} from './exclusive-catalog.mjs';
import {inspectCatalogSource} from './catalog-source-check.mjs';

// Owner-authorized, one-time catalog import. No public write route or credentials.
const KEY='catalog-import:yaga-2026-20261025-v1';
export const YAGA_IMPORT={requestId:'yaga-2026-owner-publish-20261025-v1',id:'pelisflix-yaga-2026',name:'YAGA (2026)',year:2026,page:'https://pelisflix200.city/serie/yaga/'};
const targetEpisodes=[1,2].map(number=>({id:YAGA_IMPORT.id+'-s1e'+number,title:'Episodio '+number,season:1,episode_num:number,page:'https://pelisflix200.city/episodio/yaga-1x'+number+'/'}));
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const matches=row=>row.type==='series'&&(row.year===2026||row.year===null)&&(['yaga','yaga 2026'].includes(norm(row.name))||row.page===YAGA_IMPORT.page);
export async function yagaImportStatus(store){
 const job=await store.get(KEY);return job?Object.fromEntries(['requestId','state','attempts','startedAt','finishedAt','seriesId','visible','reason','results'].filter(key=>job[key]!==undefined).map(key=>[key,job[key]])):{requestId:YAGA_IMPORT.requestId,state:'pending'};
}
export async function runYagaImport(store,leases,env,{probe=inspectCatalogSource,now=Date.now}={}){
 if(env.ENVIRONMENT!=='production'||env.CATALOG_MAINTENANCE_ENABLED!=='true')return;
 const claim=await store.transaction(async tx=>{
  const old=await tx.get(KEY);if(['completed','failed'].includes(old?.state)||old?.claimUntil>now())return null;
  const rows=(await exclusiveSnapshot(tx)).items,candidates=rows.filter(matches);
  const reason=candidates.length>1?'duplicate_series':rows.some(x=>x.id===YAGA_IMPORT.id&&!matches(x))?'identity_conflict':candidates[0]&&candidates[0].mode!=='gnula'?'manual_source_mode':null;
  if(reason){await tx.put(KEY,{requestId:YAGA_IMPORT.requestId,state:'failed',reason,finishedAt:now()});return null;}
  const row=candidates[0],job={requestId:YAGA_IMPORT.requestId,state:'running',attempts:(old?.attempts||0)+1,startedAt:old?.startedAt||now(),claim:crypto.randomUUID(),claimUntil:now()+120000};
  await tx.put(KEY,job);return {job,row};
 });
 if(!claim)return;
 const choices=await Promise.all(targetEpisodes.map(async target=>{
  const previous=claim.row?.episodes.find(ep=>ep.season===1&&ep.episode_num===target.episode_num);
  const check=async page=>{try{return (await probe({mode:'gnula',page})).ok===true}catch{return false}};
  if(previous&&await check(previous.page))return {target,previous,page:previous.page,ok:true};
  if(previous?.page===target.page)return {target,previous,page:target.page,ok:false};
  return {target,previous,page:target.page,ok:await check(target.page)};
 }));
 await store.transaction(async tx=>{
  const job=await tx.get(KEY);if(job?.claim!==claim.job.claim)return;
  const finish=(state,reason,extra={})=>tx.put(KEY,{...job,...extra,state,...(reason?{reason}:{}),...(state==='running'?{claimUntil:0}:{finishedAt:now(),claimUntil:0})});
  if(choices.some(x=>!x.ok)){
   await finish(job.attempts>=3?'failed':'running','source_unavailable',{results:choices.map(x=>({episode_num:x.target.episode_num,status:x.ok?'online':'unavailable'}))});return;
  }
  const rows=(await exclusiveSnapshot(tx)).items,candidates=rows.filter(matches),old=claim.row;
  if(candidates.length>(old?1:0)||old&&(candidates[0]?.id!==old.id||candidates[0]?.revision!==old.revision)){
   await finish('failed','catalog_changed');return;
  }
  const item=old?{...old,visible:true}:{...YAGA_IMPORT,type:'series',source:'PELISFLIX',mode:'gnula',poster:'https://i.pelisflix200.city/b/v2/w2/NXeCZ9uRM6p7bWgVEtz7beitXRhI4ItIwxblxw.webp',plot:'Serie de misterio y suspenso inspirada en la leyenda de Baba Yaga. Audio en español castellano.',visible:true,adult:false,episodes:[]};
  item.episodes=[...item.episodes];const results=[];
  for(const choice of choices){
   const previous=choice.previous,episode=previous?{...previous,page:choice.page}:{...choice.target};
   item.episodes=previous?item.episodes.map(ep=>ep.id===previous.id?episode:ep):[...item.episodes,episode];
   results.push({id:episode.id,episode_num:episode.episode_num,status:previous?(previous.page===choice.page?'online':'repaired'):'added',check:'playlist_and_segment'});
  }
  const changed=!old||!old.visible||JSON.stringify(old.episodes)!==JSON.stringify(item.episodes);
  if(changed){
   const response=await exclusiveCatalogRoute(tx,'/exclusive-save',{item,revision:old?.revision||0,actor:'owner-yaga-import-20261025'});
   if(!response.ok){await finish('failed','catalog_save_failed');return;}
   const saved=(await response.json()).item;await leases.in(tx).removeMatching(l=>l.exclusiveParentId===saved.id&&l.playbackRevision!==saved.playbackRevision);
  }
  await finish('completed',null,{seriesId:item.id,visible:true,results});
 });
}
