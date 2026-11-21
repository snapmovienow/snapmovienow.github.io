import {isAdult} from './content-permissions.mjs';
import {COMEDY_SERIES_DEFINITIONS,COMEDY_SERIES_SERVER} from './comedy-series-catalog.mjs';

// This namespace deliberately covers only the three owner-approved comedies.
// Existing provider IDs remain registered, including IDs saved as favourites.
export {COMEDY_SERIES_SERVER};
export const COMEDY_SERIES_CATEGORY='SERIES-COMEDIA';
const CATEGORY_UPSTREAM_ID='1';
const titleKey=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s*[([]\d{4}[)\]]\s*$/,'').replace(/[^a-z0-9]/gi,'').toUpperCase();
const comedyCategory=row=>['COMEDIA','SERIESCOMEDIA'].includes(titleKey(row.category_name));
const image=(value,base)=>typeof value==='string'?(value.startsWith('/')?base+value:value):'';
const duration=value=>Number.isFinite(value)&&value>0&&value<=43200?Math.floor(value):0;
const clock=value=>[Math.floor(value/3600),Math.floor(value%3600/60),value%60].map(n=>String(n).padStart(2,'0')).join(':');
const timestamp=value=>String(Math.floor((Number.isFinite(value)&&value>0?value:0)/1000));
const definitions=()=>COMEDY_SERIES_DEFINITIONS;
const definitionForUpstream=id=>definitions().find(definition=>String(definition.upstreamId)===String(id));

export function comedyDefinitionForTitle(value){
 const key=titleKey(value);
 return definitions().find(definition=>[definition.name,...(definition.aliases||[])].some(alias=>titleKey(alias)===key))||null;
}

export const comedyEpisodeId=(definition,season,number)=>definition.id+'-s'+season+'e'+number;
// Registry keys contain kind/server/upstreamId, not parentId. Include the series
// number so equally numbered episodes in different series never share a route.
const episodeUpstreamId=(definition,season,number)=>String(Number(definition.upstreamId)*1000000+season*1000+number);
const expectedEpisodes=definition=>Object.entries(definition.seasons).sort(([a],[b])=>Number(a)-Number(b)).flatMap(([season,count])=>Array.from({length:count},(_,index)=>({season:Number(season),number:index+1})));
const sourcePage=value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.hash;}catch{return false;}};

function completeEpisodes(row,definition){
 const expected=expectedEpisodes(definition);
 if(!Array.isArray(row.episodes)||row.episodes.length!==expected.length)return null;
 const saved=new Map();
 for(const episode of row.episodes){
  if(!episode||!Number.isInteger(episode.season)||!Number.isInteger(episode.episode_num)||episode.id!==comedyEpisodeId(definition,episode.season,episode.episode_num)||!sourcePage(episode.page)||episode.alternatives?.length)return null;
  const key=episode.season+':'+episode.episode_num;
  if(saved.has(key))return null;
  saved.set(key,episode);
 }
 const entries=[];
 for(const {season,number}of expected){
  const metadata=saved.get(season+':'+number);
  if(!metadata)return null;
  entries.push({id:metadata.id,season,number,title:metadata.title||'Episodio '+number,upstreamId:episodeUpstreamId(definition,season,number),metadata});
 }
 return entries;
}

function visible(row,definition,permissions){
 return !!(row&&definition&&row.type==='series'&&row.mode==='gnula'&&row.year===definition.year&&row.visible===true&&permissions.series&&(permissions.adults||!row.adult&&!isAdult(row)));
}

export function comedySeriesEntries(items,permissions){
 if(!permissions?.series)return [];
 const rows=Array.isArray(items)?items:[],result=[];
 for(const definition of definitions()){
  const matches=rows.filter(row=>row?.id===definition.id);
  if(matches.length!==1||!visible(matches[0],definition,permissions))continue;
  const episodes=completeEpisodes(matches[0],definition);
  if(episodes)result.push({definition,row:matches[0],episodes});
 }
 return result;
}

export function createComedySeriesXtream({read,prepare,media},env,ctx){
 const current=async permissions=>{
  if(!permissions.series)return [];
  return comedySeriesEntries((await read(env))?.items,permissions);
 };
 const categoryId=async({action,rows,auth,register,catalog,adultPolicy})=>{
  if(action==='get_series_categories'){
   const existing=rows.find(comedyCategory);
   return existing?String(existing.category_id):String((await register([{kind:'series_category',server:COMEDY_SERIES_SERVER,upstreamId:CATEGORY_UPSTREAM_ID}]))[0]);
  }
  let raw=await catalog('get_series_categories');
  if(!Array.isArray(raw))throw Error('invalid_catalog');
  if(auth.user.permissions.adults===false&&adultPolicy)raw=await adultPolicy.filter('get_series_categories',raw);
  const existing=raw.find(comedyCategory);
  return String((await register([{kind:'series_category',server:existing?existing._server:COMEDY_SERIES_SERVER,upstreamId:existing?String(existing.category_id):CATEGORY_UPSTREAM_ID}]))[0]);
 };
 const selectedEpisode=async(record,auth)=>{
  if(record?.server!==COMEDY_SERIES_SERVER||record.kind!=='episode')return null;
  const definition=definitionForUpstream(record.parentId);
  if(!definition)return null;
  const entry=(await current(auth.user.permissions)).find(value=>value.definition.id===definition.id);
  const episode=entry?.episodes.find(value=>value.upstreamId===record.upstreamId);
  return episode?{...entry,episode}:null;
 };
 return {
  matches:record=>record?.server===COMEDY_SERIES_SERVER,
  async progressReference(record,auth){
   const entry=await selectedEpisode(record,auth);
   return entry?{type:'series',id:entry.row.id,server:entry.row.profileServer,episodeId:entry.episode.id}:null;
  },
  async list(input){
   const {action,rows,auth,base,categoryId:selected,register}=input;
   if(!['get_series_categories','get_series'].includes(action))return rows;
   const entries=await current(auth.user.permissions);
   if(!entries.length)return rows;
   const category=await categoryId(input);
   if(action==='get_series_categories'){
    const existing=rows.find(comedyCategory);
    return existing?rows.map(row=>row===existing?{...row,category_name:COMEDY_SERIES_CATEGORY}:row):rows.concat({category_id:category,category_name:COMEDY_SERIES_CATEGORY,parent_id:0});
   }
   const ownIds=new Set(entries.map(entry=>entry.definition.id));
   // Hide only exact finite title aliases while the complete own entry is
   // available. Hidden/incomplete own entries restore the provider list.
   const result=rows.filter(row=>!ownIds.has(comedyDefinitionForTitle(row.name)?.id));
   if(selected&&String(selected)!==category)return result;
   const ids=await register(entries.map(({definition})=>({kind:'series_list',server:COMEDY_SERIES_SERVER,upstreamId:String(definition.upstreamId),activity:{title:definition.name,seriesTitle:definition.name}})));
   return result.concat(entries.map(({definition,row},index)=>({num:result.length+index+1,name:definition.name,series_id:ids[index],cover:image(row.poster,base),plot:row.plot||'',cast:definition.cast||'',director:definition.director||'',genre:'Comedia',releaseDate:definition.releaseDate||'',last_modified:timestamp(row.updatedAt||row.createdAt),rating:'0',rating_5based:0,backdrop_path:[],youtube_trailer:'',episode_run_time:'',category_id:category,smn_profile:{type:'series',id:row.id,server:row.profileServer}})));
  },
  async details(input){
   const {record,auth,base,register}=input,definition=definitionForUpstream(record.upstreamId);
   if(record.server!==COMEDY_SERIES_SERVER||record.kind!=='series_list'||!definition)return Response.json({error:'not_found'},{status:404});
   const entry=(await current(auth.user.permissions)).find(value=>value.definition.id===definition.id);
   if(!entry)return Response.json({error:'title_not_allowed'},{status:404});
   const {row,episodes:choices}=entry,cover=image(row.poster,base),category=await categoryId({...input,action:'get_series_info'}),releaseDate=definition.releaseDate||'';
   const ids=await register(choices.map(episode=>({kind:'episode',server:COMEDY_SERIES_SERVER,upstreamId:episode.upstreamId,parentId:String(definition.upstreamId),ext:episode.metadata.container_extension||'m3u8',activity:{title:episode.title,seriesTitle:definition.name,season:episode.season,episode:episode.number}})));
   const episodes={};
   for(const [index,episode]of choices.entries()){
    const seconds=duration(episode.metadata.durationSeconds),season=String(episode.season);
    if(!episodes[season])episodes[season]=[];
    episodes[season].push({id:String(ids[index]),episode_num:episode.number,title:episode.title,container_extension:episode.metadata.container_extension||'m3u8',season:episode.season,added:timestamp(row.createdAt),custom_sid:'',direct_source:base+'/series/'+encodeURIComponent(auth.username)+'/'+encodeURIComponent(auth.password)+'/'+ids[index]+'.'+(episode.metadata.container_extension||'m3u8'),info:{movie_image:image(episode.metadata.poster||row.poster,base),plot:episode.metadata.plot||row.plot||'',duration_secs:seconds,duration:clock(seconds),releasedate:episode.metadata.releaseDate||releaseDate,rating:0},smn_profile:{type:'series',id:row.id,server:row.profileServer,episodeId:episode.id}});
   }
   const info={name:definition.name,cover,plot:row.plot||'',cast:definition.cast||'',director:definition.director||'',genre:'Comedia',releaseDate,release_date:releaseDate,year:definition.year,last_modified:timestamp(row.updatedAt||row.createdAt),rating:'0',rating_5based:0,backdrop_path:[],youtube_trailer:'',episode_run_time:'',category_id:category};
   return Response.json({info,seasons:Object.entries(episodes).map(([season,items])=>({season_number:Number(season),id:Number(season),name:'Temporada '+season,episode_count:items.length,air_date:releaseDate,overview:row.plot||'',cover,cover_big:cover})),episodes});
  },
  async play(request,auth,record){
   if(!auth.user.permissions.series)return Response.json({error:'content_disabled'},{status:403});
   const entry=await selectedEpisode(record,auth);
   if(!entry)return Response.json({error:'title_not_allowed'},{status:404});
   if(record.ext!==(entry.episode.metadata.container_extension||'m3u8'))return Response.json({error:'invalid_stream'},{status:400});
   const prepared=await prepare(request,env,auth.session,entry.episode.id,{usageRootContext:{rootServer:COMEDY_SERIES_SERVER,rootSeriesId:entry.definition.id}});
   try{return await media(new Request(prepared.url,request),env,ctx);}
   catch(error){await prepared.release?.();throw error;}
  }
 };
}
