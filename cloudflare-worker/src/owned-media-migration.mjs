import {exclusiveSnapshot,exclusiveCatalogRoute} from './exclusive-catalog.mjs';
import {EMPRESS_EPISODES,EMPRESS_SERIES_ID,EMPRESS_SERIES_PAGES} from './empress-catalog.mjs';
import {ownedMediaForEpisode,isOwnedMediaSeries,probeOwnedMedia,OWNED_MEDIA_UNTIL} from './owned-media-source.mjs';
const KEY='catalog-import:empress-owned-media-20261104-v2';
const REQUEST='empress-owned-media-20261104-v2';
const original=row=>row?.id===EMPRESS_SERIES_ID&&row.type==='series'&&row.mode==='gnula'&&EMPRESS_SERIES_PAGES.includes(row.page)&&row.episodes?.length===4&&EMPRESS_EPISODES.every(expected=>{
 const episode=row.episodes.find(item=>item.id===expected.id);
 return episode?.season===1&&episode.episode_num===expected.episode_num&&episode.page===expected.page&&episode.alternatives?.length===1&&episode.alternatives[0].id===expected.alternatives[0].id&&episode.alternatives[0].page===expected.alternatives[0].page;
});
export async function ownedMediaMigrationStatus(store){return await store.get(KEY)||{requestId:REQUEST,state:'pending'};}
export async function runOwnedMediaMigration(store,leases,env,{probe=probeOwnedMedia,now=Date.now}={}){
 if(env.ENVIRONMENT!=='production'||env.CATALOG_MAINTENANCE_ENABLED!=='true'||!env.SNAP_OWNED_MEDIA_SITE_TOKEN||now()>=OWNED_MEDIA_UNTIL)return;
 const claim=await store.transaction(async tx=>{
  const old=await tx.get(KEY);if(old?.state==='completed'||old?.state==='failed'||old?.claimUntil>now())return null;
  const row=(await exclusiveSnapshot(tx)).items.find(item=>item.id===EMPRESS_SERIES_ID);
  if(isOwnedMediaSeries(row)){await tx.put(KEY,{requestId:REQUEST,state:'completed',reason:'already_connected',finishedAt:now()});return null;}
  if(!original(row)){await tx.put(KEY,{requestId:REQUEST,state:'failed',reason:'catalog_requires_review',finishedAt:now()});console.log({event:'owned_media_migration',state:'failed',reason:'catalog_requires_review'});return null;}
  const next={requestId:REQUEST,state:'running',claim:crypto.randomUUID(),claimUntil:now()+120000,revision:row.revision,attempts:(old?.attempts||0)+1};await tx.put(KEY,next);return next;
 });
 if(!claim)return;
 let verified=false,probeCode='owned_media_not_ready';try{verified=(await probe(env)).ready===true;}catch(error){if(/^(?:owned_media_(?:fetch_1042|timeout|network|integrity|not_connected)|owned_media_http_[1-5][0-9]{2})$/.test(error?.message||''))probeCode=error.message;}
 await store.transaction(async tx=>{
  const job=await tx.get(KEY);if(job?.claim!==claim.claim)return;
  const finish=async(state,reason,extra={})=>{await tx.put(KEY,{...job,state,claimUntil:0,reason,...extra,finishedAt:now()});console.log({event:'owned_media_migration',state,reason,count:extra.count||0});};
  if(!verified){await finish(job.attempts>=3?'failed':'retry','storage_not_ready',{probeCode});return;}
  const row=(await exclusiveSnapshot(tx)).items.find(item=>item.id===EMPRESS_SERIES_ID);
  if(!original(row)||row.revision!==claim.revision){await finish('failed','catalog_changed');return;}
  const episodes=row.episodes.map(episode=>({...episode,page:ownedMediaForEpisode(episode.id).url,durationSeconds:Math.round(ownedMediaForEpisode(episode.id).durationSeconds),alternatives:episode.alternatives.map(option=>({...option,page:ownedMediaForEpisode(option.id).url,durationSeconds:Math.round(ownedMediaForEpisode(option.id).durationSeconds)}))}));
  const item={...row,mode:'direct',source:'SNAPTVNOW · COPIA PROPIA',page:'',episodes};
  const response=await exclusiveCatalogRoute(tx,'/exclusive-save',{item,revision:row.revision,actor:'owner-owned-media-20261104'});
  if(!response.ok){await response.body?.cancel();await finish('failed','catalog_save_failed');return;}
  const saved=await response.json();await leases.in(tx).removeMatching(lease=>lease.exclusiveParentId===row.id&&lease.playbackRevision!==saved.item.playbackRevision);
  await finish('completed','connected',{seriesId:row.id,count:8,visible:row.visible,playbackRevision:saved.item.playbackRevision});
 });
}
