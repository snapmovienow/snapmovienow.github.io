import {normaliseSeries} from './xtream-series.mjs';

export const LQSA_SUPPLEMENT_ID='lqsa-t17-jonilar';
export const LQSA_SUPPLEMENT_SERVER='smn-series-supplement';
const TITLES=['Un crytobro, una fotopolla perfumada y una Cristiana intermitente','Un casi viudo, dos bolleras marrulleras y una raya de marihuana','Un rellano hummusexual, un animal televisivo y una aristócrata adicta al popper'];
export const LQSA_EPISODES=Object.freeze([1,2,3].map(number=>Object.freeze({
  nativeId:String(990017000+number),exclusiveId:'lqsa-t17-e'+number,
  season:17,episode_num:number,title:TITLES[number-1],
  page:'https://ia600409.us.archive.org/23/items/1701_20261115/170'+number+'.mp4',
})));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const numeric=value=>(typeof value==='string'||Number.isSafeInteger(value))&&/^[1-9]\d{0,15}$/.test(String(value));
const inputError=()=>Object.assign(Error('series_supplement_input'),{status:400});
export const matchesLqsaTitle=value=>typeof value==='string'&&value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'')==='laqueseavecina';

// The binding is exact and private. Never match a playback request by title.
export function cleanSeriesSupplement(value){
  if(!object(value)||Object.keys(value).some(key=>!['server','seriesId'].includes(key))||
    typeof value.server!=='string'||! /^[A-Za-z0-9_-]{1,100}$/.test(value.server)||
    value.server===LQSA_SUPPLEMENT_SERVER||!numeric(value.seriesId))throw inputError();
  return {server:value.server,seriesId:String(value.seriesId)};
}

export function makeLqsaSupplement(target){
  const supplement=cleanSeriesSupplement({server:target?.server,seriesId:target?.seriesId});
  if(!matchesLqsaTitle(target.name))throw inputError();
  return {id:LQSA_SUPPLEMENT_ID,type:'series',name:target.name,source:'JONILAR',mode:'direct',page:'',
    poster:target.poster||'',plot:target.plot||'',year:target.year??null,visible:true,adult:false,supplement,
    episodes:LQSA_EPISODES.map(({exclusiveId,title,season,episode_num,page})=>({id:exclusiveId,title,season,episode_num,page}))};
}

export function matchesSeriesSupplement(row,context){
  if(row?.id!==LQSA_SUPPLEMENT_ID||row.type!=='series'||row.mode!=='direct'||row.visible!==true)return false;
  try{
    const saved=cleanSeriesSupplement(row.supplement),requested=cleanSeriesSupplement(context);
    return saved.server===requested.server&&saved.seriesId===requested.seriesId;
  }catch{return false}
}

export function epToExclusiveId(value){
  if(typeof value!=='string'&&!Number.isSafeInteger(value))return null;
  const id=String(value),episode=LQSA_EPISODES.find(ep=>ep.nativeId===id||ep.exclusiveId===id);
  return episode?.exclusiveId||null;
}

export function supplementEpisode(row,context,episodeId){
  if(!matchesSeriesSupplement(row,context))return null;
  const id=epToExclusiveId(episodeId);if(!id)return null;
  const expected=LQSA_EPISODES.find(ep=>ep.exclusiveId===id);
  const actual=row.episodes?.find(ep=>ep.id===id&&ep.season===17&&ep.episode_num===expected.episode_num);
  return actual?{...actual,nativeId:expected.nativeId}:null;
}

export function supplementRangeRequestId(row,episodeId){
  if(!Number.isSafeInteger(row?.playbackRevision)||row.playbackRevision<1)return null;
  const media=supplementEpisode(row,row.supplement,episodeId),expected=LQSA_EPISODES.find(ep=>ep.exclusiveId===media?.id);
  return media&&media.page===expected?.page?'supplement-range-'+media.id+'-'+row.playbackRevision:null;
}

// Preserve the provider's series identity, categories and other seasons. Public
// episode metadata never contains the private backing-row page or source URL.
export function mergeSeriesSupplement(data,row,context){
  if(!matchesSeriesSupplement(row,context))return data;
  if(!object(data))throw inputError();
  if(!matchesLqsaTitle(data.info?.name))return data;
  const normalized=normaliseSeries(data),saved=LQSA_EPISODES.map(ep=>supplementEpisode(row,context,ep.nativeId));
  if(saved.some(ep=>!ep))throw Object.assign(Error('series_supplement_incomplete'),{status:503});
  for(const episodes of Object.values(normalized.episodes))for(const episode of episodes){
    const reserved=LQSA_EPISODES.find(ep=>ep.nativeId===String(episode.id));
    if(reserved&&(episode.season!==17||episode.episode_num!==reserved.episode_num))
      throw Object.assign(Error('series_supplement_id_conflict'),{status:409});
  }
  const added=saved.map(ep=>({id:ep.nativeId,season:17,episode_num:ep.episode_num,title:ep.title,
    container_extension:'mp4',custom_sid:'',added:String(Math.floor((row.createdAt||0)/1000)),
    info:{movie_image:ep.poster||row.poster||normalized.info.cover||'',plot:ep.plot||row.plot||'',
      ...(Number.isSafeInteger(ep.durationSeconds)&&ep.durationSeconds>0?{duration_secs:ep.durationSeconds}:{})},
    smn_profile:{type:'series',id:String(row.supplement.seriesId),server:row.supplement.server,episodeId:ep.nativeId}}));
  const episodes={...normalized.episodes,'17':[
    ...(normalized.episodes['17']||[]).filter(ep=>!LQSA_EPISODES.some(target=>target.episode_num===ep.episode_num)),...added,
  ].sort((a,b)=>a.episode_num-b.episode_num)};
  const existing=normalized.seasons.find(season=>season.season_number===17);
  const season={...(existing||{}),season_number:17,id:existing?.id??17,name:existing?.name||'Temporada 17',
    episode_count:episodes['17'].length,cover:existing?.cover||normalized.info.cover||'',
    cover_big:existing?.cover_big||existing?.cover||normalized.info.cover||''};
  const seasons=[...normalized.seasons.filter(value=>value.season_number!==17),season].sort((a,b)=>a.season_number-b.season_number);
  return {...data,info:normalized.info,episodes,seasons};
}
