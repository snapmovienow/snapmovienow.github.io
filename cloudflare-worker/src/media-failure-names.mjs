import {cleanPlaybackActivity,cachedPlaybackActivity} from './playback-activity.mjs';

const safeTitle=value=>typeof value==='string'&&!/(?:https?:\/\/|password=|username=|access_token=)/i.test(value)?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,160):'';
// Resolve administrator diagnostics from already retained catalog data.
// Never fetch provider catalogs, media, credentials or a customer's session.
export async function cachedFailureNames(catalog,failures,resolveEpisode){
 const rows=Array.isArray(failures)?failures.slice(0,30):[],snapshots=new Map();
 const actions={live:'get_live_streams',movie:'get_vod_streams'};
 // The monitor includes at most three recent references. Resolve episodes
 // directly in the existing registry, without enumerating the series catalog.
 const episodes=new Map();
 if(resolveEpisode){
  for(const row of rows){
   if(row.type!=='series'||typeof row.id!=='string'||!/^\d{1,16}$/.test(row.id)||typeof row.server!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(row.server))continue;
   const key=row.server+':'+row.id;
   if(episodes.has(key))continue;
   episodes.set(key,Promise.resolve().then(async()=>{
    const response=await resolveEpisode(row.server,row.id);
    if(!response.ok){void response.body?.cancel().catch(()=>{});return null}
    const record=await response.json();
    if(record?.kind!=='episode'||record.server!==row.server||record.upstreamId!==row.id||!Number.isSafeInteger(record.id)||record.id<1||record.id>2147483647)return null;
    const activity=cleanPlaybackActivity(record.activity,'series')||await cachedPlaybackActivity(catalog,{type:'series',server:row.server,id:row.id,parentId:record.parentId}).catch(()=>null);
    const number=activity?.season&&activity?.episode?'T'+activity.season+' E'+activity.episode:'';
    return {publicId:String(record.id),title:safeTitle([activity?.seriesTitle,number,activity?.title!==activity?.seriesTitle?activity?.title:null].filter(Boolean).join(' · '))||null};
   }).catch(()=>null));
   if(episodes.size===3)break;
  }
 }
 for(const type of new Set(rows.map(r=>r.type))){
  if(!actions[type])continue;
  try{const data=await catalog(actions[type],undefined,{}, {cachedOnly:true});snapshots.set(type,Array.isArray(data)?data:[])}catch{snapshots.set(type,[])}
 }
 return Promise.all(rows.map(async row=>{
  if(row.type==='series')return {...row,title:null,...await episodes.get(row.server+':'+row.id)};
  const idField='stream_id';
  const match=(snapshots.get(row.type)||[]).find(item=>String(item[idField])===row.id&&String(item._server||'ccf')===row.server);
  return {...row,title:safeTitle(match?.name)||null};
 }));
}
