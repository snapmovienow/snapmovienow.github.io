// Only catalog labels enter the administrator's activity view. Never retain a
// playback URL, credential, client-supplied title or the complete catalog row.
const text=value=>typeof value==='string'&&!/(?:https?:\/\/|username=|password=)/i.test(value)?value.replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,200):'';
const number=value=>Number.isSafeInteger(Number(value))&&Number(value)>0&&Number(value)<10000?Number(value):null;
export function cleanPlaybackActivity(value,type){
 if(!value||!['live','movie','series'].includes(type))return null;
 const title=text(value.title),seriesTitle=type==='series'?text(value.seriesTitle):'';
 if(!title&&!seriesTitle)return null;
 return {title:title||seriesTitle,...(seriesTitle?{seriesTitle}:{}),...(type==='series'&&number(value.season)?{season:number(value.season)}:{}),...(type==='series'&&number(value.episode)?{episode:number(value.episode)}:{})};
}
export function episodeActivity(info,row,season){
 return cleanPlaybackActivity({title:row.title||row.name,seriesTitle:info?.name||info?.title,season:row.season||season,episode:row.episode_num||row.episode},'series');
}
// Administrator labels are optional metadata. Opening a channel never awaits
// a catalog read just to discover its name. Late results own one exact lease.
export function startPlaybackActivity(read,ctx){
 if(!read||!ctx?.waitUntil)return null;
 return read;
}
export function attachPlaybackActivity(read,{env,ctx,directory,session,lease_id,mediaKey}){
 if(!read||!ctx?.waitUntil)return;
 ctx.waitUntil(Promise.resolve().then(read).then(async activity=>{if(!activity)return;const response=await directory(env,'/playback-activity',{sid:session.sid,uid:session.uid,version:session.version,request_id:session.request_id,lease_id,mediaKey,activity});void response.body?.cancel().catch(()=>{})}).catch(()=>{}));
}
export async function cachedPlaybackActivity(catalog,{type,server='ccf',id,parentId}){
 if(!/^\d{1,16}$/.test(String(id)))return null;
 const lookup=async(action,params={})=>await catalog(action,server,params,{cachedOnly:true})||await catalog(action,undefined,params,{cachedOnly:true});
 if(type==='series'){
  if(!/^\d{1,16}$/.test(String(parentId)))return null;
  const data=await lookup('get_series_info',{series_id:parentId});
  for(const [season,rows]of Object.entries(data?.episodes||{}))for(const row of Array.isArray(rows)?rows:[])if(String(row.id)===String(id))return episodeActivity(data.info,row,season);
  return null;
 }
 const action=type==='live'?'get_live_streams':type==='movie'?'get_vod_streams':null;
 if(!action)return null;
 const rows=await lookup(action);
 const row=Array.isArray(rows)?rows.find(r=>String(r.stream_id)===String(id)&&(r._server||'ccf')===server):null;
 return row?cleanPlaybackActivity({title:row.name||row.title},type):null;
}
