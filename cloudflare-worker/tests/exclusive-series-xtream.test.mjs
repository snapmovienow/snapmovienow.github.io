import assert from 'node:assert/strict';
import {handleXtream} from '../src/xtream.mjs';
import {ownedMediaForEpisode} from '../src/owned-media-source.mjs';
import {createExclusiveSeriesXtream,EXCLUSIVE_SERIES_SERVER,EXCLUSIVE_SERIES_ID} from '../src/exclusive-series-xtream.mjs';

const origin='https://api.example.test',provider='private-provider-scope',customer={username:'series-customer',password:'series-customer-fixture-password'};
const user={username:customer.username,permissions:{series:true,movies:false,tv:false,adults:false}};
let row={id:EXCLUSIVE_SERIES_ID,type:'series',mode:'gnula',year:2026,visible:true,adult:false,name:'La emperatriz divorciada (2026)',poster:'https://images.example.test/empress.jpg',plot:'Navier recovers her future.',profileServer:'exclusive',createdAt:1793660000000,updatedAt:1793660000000,playbackRevision:1,
 episodes:[1,2,3,4].map(n=>({id:'empress-2026-s1e'+n+'-es',title:'Episodio '+n,season:1,episode_num:n,page:'https://pelisflix200.rest/episodio/la-emperatriz-divorciada-1x'+n+'/',poster:'https://images.example.test/episode-'+n+'.jpg',plot:'Episode '+n+' plot',durationSeconds:2900+n,alternatives:[{id:'empress-2026-s1e'+n+'-subes',title:'Sub español',page:'https://tudorama.com/ver/the-remarried-empress-s1x'+n+'/',durationSeconds:3000+n}]}))};
const unrelated={...row,id:'other-exclusive-series',name:'Unrelated series'};
const records=new Map(),keys=new Map();let next=100,providerPlays=0,providerDetails=0,prepared=[],released=0,mediaFailure=false,disneyPresent=true;
const register=async entries=>entries.map(entry=>{const key=[entry.kind,entry.server,entry.upstreamId].join(':');if(!keys.has(key))keys.set(key,next++);const id=keys.get(key);records.set(String(id),{...entry,id});return id;});
const rawCategories=()=>[{category_id:'44',category_name:disneyPresent?'SERIES-DISNEY':'SERIES-OTHER',parent_id:0,_server:provider},{category_id:'45',category_name:'SERIES-NETFLIX',parent_id:0,_server:provider}];
const read=async()=>({items:[structuredClone(row),unrelated]});
const prepare=async(request,env,session,id)=>{prepared.push({id,session});return {url:origin+'/prepared/'+id,release:async()=>{released++;}};};
const media=async request=>{if(mediaFailure)throw Error('fixture_media_failure');return new Response(request.url,{headers:{'content-type':'application/vnd.apple.mpegurl'}});};
const catalog=async(action,server,params)=>{
 if(action==='get_series_categories')return rawCategories();
 if(action==='get_series')return [{series_id:12,name:'Original provider series',category_id:'44',_server:provider,cover:''}];
 if(action==='get_series_info'){providerDetails++;return {info:{name:'Provider details'},episodes:{}};}
 if(['get_live_categories','get_live_streams','get_vod_categories','get_vod_streams'].includes(action))return [];
 throw Error('unexpected action');
};
const api=async(action,params={},method='GET')=>{
 const query=new URLSearchParams({...customer,action,...params}),request=new Request(origin+'/player_api.php'+(method==='GET'?'?'+query:''),{method,...(method==='POST'?{body:query}: {})});
 return handleXtream(request,{authenticate:async()=>({user,username:customer.username,session:{sid:'owned-session',permissions:user.permissions}}),catalog,register,resolve:async id=>records.get(String(id)),play:async()=>{providerPlays++;return new Response('provider');},adultPolicy:{allowed:async record=>record.server!==EXCLUSIVE_SERIES_SERVER,filter:async(action,rows)=>rows},localSeries:createExclusiveSeriesXtream({read,prepare,media},{},{}),json:(body,status=200)=>Response.json(body,{status})});
};
const play=async(row,ext='m3u8')=>handleXtream(new Request(row.direct_source.replace(/\.[^.]+$/,'.'+ext)),{authenticate:async()=>({user,username:customer.username,session:{sid:'owned-session',permissions:user.permissions}}),resolve:async id=>records.get(String(id)),play:async()=>{providerPlays++;return new Response('provider');},adultPolicy:{allowed:async()=>{throw Error('own playback must not inspect provider permissions');}},localSeries:createExclusiveSeriesXtream({read,prepare,media},{},{}),json:(body,status=200)=>Response.json(body,{status})});

const categories=await(await api('get_series_categories')).json(),disney=categories.find(c=>c.category_name==='SERIES-DISNEY'),netflix=categories.find(c=>c.category_name==='SERIES-NETFLIX');
assert.equal(categories.length,2);assert.ok(disney);assert.equal(categories.filter(c=>c.category_name==='SERIES-DISNEY').length,1);
const list=await(await api('get_series')).json();assert.equal(list.length,2);assert.equal(list[0].name,'Original provider series');
const owned=list.find(c=>c.name===row.name);assert.ok(owned);assert.equal(owned.category_id,disney.category_id);assert.equal(owned.cover,row.poster);
assert.deepEqual(await(await api('get_series')).json(),list,'refresh keeps original/provider and owned numeric IDs stable');
assert.deepEqual((await(await api('get_series',{category_id:disney.category_id},'POST')).json()).map(x=>x.series_id),list.map(x=>x.series_id));
assert.deepEqual(await(await api('get_series',{category_id:netflix.category_id},'POST')).json(),[]);
const details=await(await api('get_series_info',{series_id:owned.series_id},'POST')).json();
assert.equal(details.info.category_id,disney.category_id);assert.equal(details.info.cover,row.poster);assert.equal(details.info.plot,row.plot);assert.equal(details.info.releaseDate,'2026-11-03');
assert.equal(details.seasons.length,1);assert.equal(details.seasons[0].season_number,1);assert.equal(details.seasons[0].episode_count,8);assert.deepEqual(Object.keys(details.episodes),['1']);
const episodes=details.episodes['1'];assert.equal(episodes.length,8);assert.equal(new Set(episodes.map(ep=>ep.id)).size,8);assert.deepEqual(episodes.map(ep=>ep.episode_num),[1,1,2,2,3,3,4,4]);
for(const [index,episode]of episodes.entries()){
 for(const key of ['id','title','direct_source','added','custom_sid','container_extension'])assert.equal(typeof episode[key],'string','strict Smarters episode reader requires '+key);
 assert.equal(episode.custom_sid,'');assert.equal(episode.season,1);assert.equal(episode.container_extension,'m3u8');assert.equal(new URL(episode.direct_source).origin,origin);assert.ok(episode.info.duration_secs>0);assert.ok(episode.info.movie_image);assert.ok(episode.info.plot);
 assert.match(episode.title,index%2?/Opción 2 · Coreano subtitulado/:/Opción 1 · Español/);
 const response=await play(episode);assert.equal(response.status,200);await response.body?.cancel();assert.equal(prepared.at(-1).id,'empress-2026-s1e'+(Math.floor(index/2)+1)+(index%2?'-subes':'-es'));
}
assert.equal(providerPlays,0);assert.equal(providerDetails,0,'owned series detail and playback use no provider detail/allocation');
assert.deepEqual((await(await api('get_series_info',{series_id:owned.series_id})).json()).episodes,details.episodes,'both option identities survive repeated detail reads');
assert.equal(JSON.stringify(details).includes('pelisflix200.rest'),false);assert.equal(JSON.stringify(details).includes('tudorama.com'),false);assert.equal(JSON.stringify(details).includes(provider),false);
assert.equal((await play(episodes[0],'mp4')).status,400);
const episodeRecord=records.get(episodes[0].id);records.set(episodes[0].id,{...episodeRecord,parentId:'999'});assert.equal((await play(episodes[0])).status,404);records.set(episodes[0].id,episodeRecord);
mediaFailure=true;await assert.rejects(()=>play(episodes[0]),/fixture_media_failure/);assert.equal(released,1);mediaFailure=false;
row.visible=false;assert.equal((await(await api('get_series')).json()).length,1);assert.equal((await api('get_series_info',{series_id:owned.series_id})).status,404);assert.equal((await play(episodes[0])).status,404);row.visible=true;
row.year=2025;assert.equal((await(await api('get_series')).json()).length,1);row.year=2026;
user.permissions.series=false;assert.deepEqual(await(await api('get_series')).json(),[]);assert.equal((await api('get_series_info',{series_id:owned.series_id})).status,403);assert.equal((await play(episodes[0])).status,403);user.permissions.series=true;
disneyPresent=false;const fallback=await(await api('get_series_categories')).json();assert.equal(fallback.length,3);assert.equal(fallback.filter(c=>c.category_name==='SERIES-DISNEY').length,1);const fallbackId=fallback.find(c=>c.category_name==='SERIES-DISNEY').category_id;assert.equal((await(await api('get_series',{category_id:fallbackId})).json()).length,1);

// Switching to verified copies preserves the same numeric identities and both
// DNS choices. Clients receive MP4 metadata while cached route IDs remain valid.
const oldIds=episodes.map(episode=>episode.id);
row.mode='direct';row.page='';
row.episodes=row.episodes.map(episode=>({...episode,page:ownedMediaForEpisode(episode.id).url,alternatives:episode.alternatives.map(option=>({...option,page:ownedMediaForEpisode(option.id).url}))}));
const copied=await(await api('get_series_info',{series_id:owned.series_id})).json();
assert.deepEqual(copied.episodes['1'].map(episode=>episode.id),oldIds);
assert.equal(JSON.stringify(copied).includes('.chatgpt.site'),false);
for(const episode of copied.episodes['1']){
 assert.equal(episode.container_extension,'mp4');assert.equal(new URL(episode.direct_source).pathname.endsWith('.mp4'),true);
 const response=await play(episode,'mp4');assert.equal(response.status,200);await response.body?.cancel();
}
console.log('PASS: owned Disney series Xtream folder reuse, one real season with eight labelled choices, strict client metadata, stable identities, GET/POST filters, all source selections, current visibility/permissions, parent isolation and zero provider playback.');
