import {isAdult} from './content-permissions.mjs';
import {isOwnedMediaSeries} from './owned-media-source.mjs';

// The registry namespace is independent of CCF and of existing exclusives.
// Four real episodes are exposed as eight explicitly labelled source choices.
export const EXCLUSIVE_SERIES_SERVER='smn-owned-series';
export const EXCLUSIVE_SERIES_ID='the-remarried-empress-2026';
export const EXCLUSIVE_SERIES_CATEGORY='SERIES-DISNEY';
const SERIES_UPSTREAM_ID='1',CATEGORY_UPSTREAM_ID='1';
const normal=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s_-]+/g,'').toUpperCase();
const disney=row=>normal(row.category_name)==='SERIESDISNEY';
const visible=(row,permissions)=>!!(row?.id===EXCLUSIVE_SERIES_ID&&row.type==='series'&&(row.mode==='gnula'||isOwnedMediaSeries(row))&&row.year===2026&&row.visible&&permissions.series&&(permissions.adults||!row.adult&&!isAdult(row)));
const image=(value,base)=>typeof value==='string'?(value.startsWith('/')?base+value:value):'';
const duration=value=>Number.isFinite(value)&&value>0&&value<=43200?Math.floor(value):0;
const clock=value=>[Math.floor(value/3600),Math.floor(value%3600/60),value%60].map(n=>String(n).padStart(2,'0')).join(':');
const saved=data=>data.items?.find(row=>row.id===EXCLUSIVE_SERIES_ID);
function choices(row){
 const result=[];
 for(let number=1;number<=4;number++){
  const primary=row.episodes?.find(ep=>ep.id==='empress-2026-s1e'+number+'-es'&&ep.season===1&&ep.episode_num===number);
  if(!primary)continue;
  result.push({id:primary.id,number,option:1,upstreamId:String(number*1000+1),title:'E'+String(number).padStart(2,'0')+' · Opción 1 · Español',metadata:primary});
  const alternate=primary.alternatives?.find(ep=>ep.id==='empress-2026-s1e'+number+'-subes');
  if(alternate)result.push({id:alternate.id,number,option:2,upstreamId:String(number*1000+2),title:'E'+String(number).padStart(2,'0')+' · Opción 2 · Coreano subtitulado',metadata:{...primary,...alternate}});
 }
 return result;
}

export function createExclusiveSeriesXtream({read,prepare,media},env,ctx){
 const current=async permissions=>{const row=saved(await read(env));return visible(row,permissions)?row:null;};
 const categoryId=async({action,rows,auth,register,catalog,adultPolicy})=>{
  if(action==='get_series_categories'){
   const existing=rows.find(disney);
   return existing?String(existing.category_id):String((await register([{kind:'series_category',server:EXCLUSIVE_SERIES_SERVER,upstreamId:CATEGORY_UPSTREAM_ID}]))[0]);
  }
  let raw=await catalog('get_series_categories');if(!Array.isArray(raw))throw Error('invalid_catalog');
  if(auth.user.permissions.adults===false&&adultPolicy)raw=await adultPolicy.filter('get_series_categories',raw);
  const existing=raw.find(disney);
  return String((await register([{kind:'series_category',server:existing?existing._server:EXCLUSIVE_SERIES_SERVER,upstreamId:existing?String(existing.category_id):CATEGORY_UPSTREAM_ID}]))[0]);
 };
 return {
  matches:record=>record?.server===EXCLUSIVE_SERIES_SERVER,
  async list(input){
   const {action,rows,auth,base,categoryId:selected,register}=input;
   if(!['get_series_categories','get_series'].includes(action))return rows;
   const row=await current(auth.user.permissions);if(!row)return rows;
   const category=await categoryId(input);
   if(action==='get_series_categories')return rows.some(disney)?rows:rows.concat({category_id:category,category_name:EXCLUSIVE_SERIES_CATEGORY,parent_id:0});
   if(selected&&String(selected)!==category)return rows;
   const id=(await register([{kind:'series_list',server:EXCLUSIVE_SERIES_SERVER,upstreamId:SERIES_UPSTREAM_ID,activity:{title:row.name,seriesTitle:row.name}}]))[0];
   const cover=image(row.poster,base);
   return rows.concat({num:rows.length+1,name:row.name,series_id:id,cover,plot:row.plot||'',cast:'Shin Mina, Ju Jihoon, Lee Jongsuk, Lee Seyoung',director:'Cho Suwon',genre:'Drama, Romance, Fantasía',releaseDate:'2026-11-03',last_modified:String(Math.floor((row.updatedAt||row.createdAt||0)/1000)),rating:'0',rating_5based:0,backdrop_path:[],youtube_trailer:'',episode_run_time:'',category_id:category,smn_profile:{type:'series',id:row.id,server:row.profileServer}});
  },
  async details(input){
   const {record,auth,base,register}=input;
   if(record.kind!=='series_list'||record.upstreamId!==SERIES_UPSTREAM_ID)return Response.json({error:'not_found'},{status:404});
   const row=await current(auth.user.permissions);if(!row)return Response.json({error:'title_not_allowed'},{status:404});
   const entries=choices(row),cover=image(row.poster,base),category=await categoryId({...input,action:'get_series_info'}),ext=isOwnedMediaSeries(row)?'mp4':'m3u8';
   const ids=await register(entries.map(choice=>({kind:'episode',server:EXCLUSIVE_SERIES_SERVER,upstreamId:choice.upstreamId,parentId:SERIES_UPSTREAM_ID,ext,activity:{title:choice.title,seriesTitle:row.name,season:1,episode:choice.number}})));
   const episodes=entries.map((choice,index)=>{
    const seconds=duration(choice.metadata.durationSeconds),poster=image(choice.metadata.poster||row.poster,base);
    return {id:String(ids[index]),episode_num:choice.number,title:choice.title,container_extension:ext,season:1,added:String(Math.floor((row.createdAt||0)/1000)),custom_sid:'',direct_source:base+'/series/'+encodeURIComponent(auth.username)+'/'+encodeURIComponent(auth.password)+'/'+ids[index]+'.'+ext,info:{movie_image:poster,plot:choice.metadata.plot||row.plot||'',duration_secs:seconds,duration:clock(seconds),releasedate:'2026-11-03',rating:0},smn_profile:{type:'series',id:row.id,server:row.profileServer,episodeId:choice.id}};
   });
   const info={name:row.name,cover,plot:row.plot||'',cast:'Shin Mina, Ju Jihoon, Lee Jongsuk, Lee Seyoung',director:'Cho Suwon',genre:'Drama, Romance, Fantasía',releaseDate:'2026-11-03',release_date:'2026-11-03',year:2026,last_modified:String(Math.floor((row.updatedAt||row.createdAt||0)/1000)),rating:'0',rating_5based:0,backdrop_path:[],youtube_trailer:'',episode_run_time:'',category_id:category};
   return Response.json({info,seasons:episodes.length?[{season_number:1,id:1,name:'Temporada 1',episode_count:episodes.length,air_date:'2026-11-03',overview:row.plot||'',cover,cover_big:cover}]:[],episodes:episodes.length?{'1':episodes}:{}});
  },
  async play(request,auth,record){
   if(!auth.user.permissions.series)return Response.json({error:'content_disabled'},{status:403});
   if(record.kind!=='episode'||record.parentId!==SERIES_UPSTREAM_ID)return Response.json({error:'not_found'},{status:404});
   const row=await current(auth.user.permissions),choice=row&&choices(row).find(item=>item.upstreamId===record.upstreamId);
   if(!choice)return Response.json({error:'title_not_allowed'},{status:404});
   if(record.ext!=='m3u8'&&!(isOwnedMediaSeries(row)&&record.ext==='mp4'))return Response.json({error:'invalid_stream'},{status:400});
   const prepared=await prepare(request,env,auth.session,choice.id);
   try{return await media(new Request(prepared.url,request),env,ctx);}
   catch(error){await prepared.release?.();throw error;}
  }
 };
}
