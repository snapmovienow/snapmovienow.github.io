import assert from 'node:assert/strict';
import {handleXtream} from '../src/xtream.mjs';
import {COMEDY_SERIES_DEFINITIONS} from '../src/comedy-series-catalog.mjs';
import {createComedySeriesXtream,comedyDefinitionForTitle,comedyEpisodeId,COMEDY_SERIES_SERVER} from '../src/comedy-series-xtream.mjs';

const origin='https://api.example.test',provider='private-comedy-fixture',customer={username:'comedy-customer',password:'comedy-fixture-password'};
const user={username:customer.username,permissions:{series:true,movies:false,tv:false,adults:false}};
const initial=COMEDY_SERIES_DEFINITIONS.map(definition=>({
 id:definition.id,name:definition.name,type:'series',mode:'gnula',year:definition.year,source:'Fixture',visible:true,adult:false,poster:'/exclusive-cover/'+ 'a'.repeat(64),plot:'Comedia española.',profileServer:'exclusive',createdAt:1795170000000,updatedAt:1795170000000,
 episodes:Object.entries(definition.seasons).flatMap(([season,count])=>Array.from({length:count},(_,index)=>({id:comedyEpisodeId(definition,Number(season),index+1),title:'Episodio '+(index+1),season:Number(season),episode_num:index+1,page:'https://page.fixture.invalid/'+definition.id+'/'+season+'/'+(index+1),plot:'Argumento del episodio.',durationSeconds:1500+index,poster:'https://images.fixture.invalid/'+definition.id+'.jpg'})))
}));
let saved=structuredClone(initial),comedyPresent=true,mediaFailure=false,providerDetails=0,providerPlays=0,legacyLists=0,released=0;
const prepared=[],mediaRequests=[],records=new Map(),keys=new Map();let next=100;
const register=async entries=>entries.map(entry=>{const key=[entry.kind,entry.server,entry.upstreamId].join(':');if(!keys.has(key))keys.set(key,next++);const id=keys.get(key);records.set(String(id),{...entry,id});return id;});
const rawCategories=()=>[{category_id:'44',category_name:comedyPresent?'Comedia':'Series generales',_server:provider},{category_id:'45',category_name:'Drama',_server:provider}];
const providerSeries=()=>[
 {series_id:'11',name:'Muertos S. L. (2024)',category_id:'44',_server:provider},
 {series_id:'12',name:'Machos Alfa',category_id:'45',_server:provider},
 {series_id:'13',name:'Cuñados',category_id:'44',_server:provider},
 {series_id:'14',name:'Comedia independiente',category_id:'44',_server:provider},
 {series_id:'15',name:'Machos alfa: documental',category_id:'45',_server:provider}
];
const catalog=async action=>{
 if(action==='get_series_categories')return rawCategories();
 if(action==='get_series')return providerSeries();
 if(action==='get_series_info'){providerDetails++;return {info:{name:'Favorito del proveedor'},episodes:{}};}
 if(['get_live_categories','get_live_streams','get_vod_categories','get_vod_streams'].includes(action))return [];
 throw Error('unexpected_fixture_action');
};
const read=async()=>({items:structuredClone(saved)});
const prepare=async(request,env,session,id,options)=>{prepared.push({id,session,options});return {url:origin+'/prepared/'+id,release:async()=>{released++;}};};
const media=async request=>{mediaRequests.push(request);if(mediaFailure)throw Error('fixture_media_failure');return new Response('fixture manifest',{headers:{'content-type':'application/vnd.apple.mpegurl'}});};
const adapter=()=>createComedySeriesXtream({read,prepare,media},{},{});
const dependencies=()=>({
 authenticate:async()=>({user,username:customer.username,session:{sid:'comedy-session',permissions:user.permissions}}),catalog,register,resolve:async id=>records.get(String(id)),
 play:async()=>{providerPlays++;return new Response('provider favourite');},
 adultPolicy:{allowed:async record=>record.server!==COMEDY_SERIES_SERVER,filter:async(action,rows)=>rows},
 localSeries:{matches:()=>false,list:async({rows})=>{legacyLists++;return rows;}},comedySeries:adapter(),json:(body,status=200)=>Response.json(body,{status})
});
const api=async(action,params={},method='GET')=>{
 const query=new URLSearchParams({...customer,action,...params});
 return handleXtream(new Request(origin+'/player_api.php'+(method==='GET'?'?'+query:''),{method,...(method==='POST'?{body:query}:{})}),dependencies());
};
const play=async(episode,ext='m3u8')=>handleXtream(new Request(episode.direct_source.replace(/\.[^.]+$/,'.'+ext)),dependencies());
const reset=()=>{saved=structuredClone(initial);};

for(const definition of COMEDY_SERIES_DEFINITIONS){
 assert.equal(comedyDefinitionForTitle(definition.name)?.id,definition.id);
 for(const alias of definition.aliases)assert.equal(comedyDefinitionForTitle(alias)?.id,definition.id);
}
assert.equal(comedyDefinitionForTitle('Machos alfa: documental'),null,'finite aliases do not shadow a different title');
const categories=await(await api('get_series_categories')).json(),comedy=categories.find(row=>row.category_name==='SERIES-COMEDIA'),drama=categories.find(row=>row.category_name==='Drama');
assert.equal(categories.length,2);assert.ok(comedy);assert.ok(drama);assert.equal(categories.filter(row=>row.category_name==='SERIES-COMEDIA').length,1);
const list=await(await api('get_series')).json(),own=list.filter(row=>row.smn_profile.server==='exclusive');
assert.equal(list.length,5);assert.equal(own.length,3);assert.equal(list.filter(row=>row.name==='Machos alfa: documental').length,1);
assert.deepEqual(await(await api('get_series')).json(),list,'all public IDs survive catalogue refreshes');
assert.deepEqual((await(await api('get_series',{category_id:comedy.category_id},'POST')).json()).map(row=>row.name),['Comedia independiente',...COMEDY_SERIES_DEFINITIONS.map(row=>row.name)]);
assert.deepEqual((await(await api('get_series',{category_id:drama.category_id},'POST')).json()).map(row=>row.name),['Machos alfa: documental']);
assert.ok(legacyLists>0,'the existing local series adapter remains in the list pipeline');

const allEpisodes=[],allUpstreamIds=new Set();
for(const definition of COMEDY_SERIES_DEFINITIONS){
 const series=own.find(row=>row.smn_profile.id===definition.id),row=initial.find(row=>row.id===definition.id);
 assert.ok(series);assert.equal(series.category_id,comedy.category_id);assert.equal(series.cover,origin+row.poster);
 const response=await api('get_series_info',{series_id:series.series_id},'POST');assert.equal(response.status,200);
 const details=await response.json();assert.equal(details.info.name,definition.name);assert.equal(details.info.year,definition.year);assert.equal(details.info.category_id,comedy.category_id);assert.equal(details.info.genre,'Comedia');
 assert.deepEqual(details.seasons.map(season=>[season.season_number,season.episode_count]),Object.entries(definition.seasons).map(([season,count])=>[Number(season),count]));
 assert.deepEqual(Object.keys(details.episodes),Object.keys(definition.seasons));
 for(const [season,episodes]of Object.entries(details.episodes)){
  assert.equal(episodes.length,definition.seasons[season]);assert.deepEqual(episodes.map(episode=>episode.episode_num),Array.from({length:episodes.length},(_,index)=>index+1));
  for(const episode of episodes){
   for(const field of ['id','title','direct_source','added','custom_sid','container_extension'])assert.equal(typeof episode[field],'string','strict Xtream type: '+field);
   assert.equal(episode.container_extension,'m3u8');assert.equal(episode.custom_sid,'');assert.equal(episode.season,Number(season));assert.equal(new URL(episode.direct_source).origin,origin);assert.ok(episode.info.duration_secs>0);assert.ok(episode.info.movie_image);
   const record=records.get(episode.id);assert.equal(record.parentId,definition.upstreamId);assert.equal(allUpstreamIds.has(record.upstreamId),false,'episode registry key must include its parent series');allUpstreamIds.add(record.upstreamId);
   const playback=await play(episode);assert.equal(playback.status,200);await playback.body?.cancel();
   assert.equal(prepared.at(-1).id,comedyEpisodeId(definition,Number(season),episode.episode_num));assert.equal(prepared.at(-1).session.sid,'comedy-session');
   assert.deepEqual(prepared.at(-1).options,{usageRootContext:{rootServer:COMEDY_SERIES_SERVER,rootSeriesId:definition.id}});
   assert.deepEqual(await adapter().progressReference(record,{user}),{type:'series',id:definition.id,server:'exclusive',episodeId:prepared.at(-1).id});
   allEpisodes.push(episode);
  }
 }
 assert.equal(JSON.stringify(details).includes('page.fixture.invalid'),false);assert.equal(JSON.stringify(details).includes(provider),false);
 assert.deepEqual((await(await api('get_series_info',{series_id:series.series_id})).json()).episodes,details.episodes,'episode IDs are stable after replay/details refresh');
}
assert.equal(allEpisodes.length,77);assert.equal(new Set(allEpisodes.map(row=>row.id)).size,77);assert.equal(prepared.length,77);assert.equal(providerDetails,0);assert.equal(providerPlays,0,'own playback never allocates a provider account');
assert.equal(mediaRequests.length,77);assert.equal((await play(allEpisodes[0],'mp4')).status,400);

// Presentation replacement preserves old numeric provider bookmarks.
const oldProviderId=keys.get(['series_list',provider,'11'].join(':'));
assert.equal((await api('get_series_info',{series_id:oldProviderId})).status,200);assert.equal(providerDetails,1);
const oldEpisodeId=(await register([{kind:'episode',server:provider,upstreamId:'legacy-episode',parentId:'11',ext:'m3u8'}]))[0];
assert.equal((await handleXtream(new Request(origin+'/series/'+customer.username+'/'+customer.password+'/'+oldEpisodeId+'.m3u8'),dependencies())).status,200);assert.equal(providerPlays,1);

const first=allEpisodes[0],record=records.get(first.id),series=own[0];
records.set(first.id,{...record,parentId:'2'});assert.equal((await play(first)).status,404);assert.equal(await adapter().progressReference(records.get(first.id),{user}),null);records.set(first.id,record);
mediaFailure=true;await assert.rejects(()=>play(first),/fixture_media_failure/);assert.equal(released,1);mediaFailure=false;

// Incomplete, ambiguous, altered or hidden rows never replace a working source.
for(const mutate of [
 row=>{row.visible=false;},row=>{row.episodes.pop();},row=>{row.episodes.push({...row.episodes[0]});},row=>{row.episodes[0].id='foreign-episode';},row=>{row.episodes[0].season=9;},row=>{row.episodes[0].page='http://insecure.fixture.invalid/';},row=>{row.year=2001;},row=>{row.mode='direct';},row=>{row.adult=true;},row=>{row.episodes[0].alternatives=[{id:'foreign-choice',page:row.episodes[0].page}];}
]){
 reset();mutate(saved[0]);
 const restored=await(await api('get_series')).json();
 assert.equal(restored.some(row=>row.smn_profile?.id===initial[0].id),false);assert.equal(restored.some(row=>row.name==='Muertos S. L. (2024)'),true);
 assert.equal((await api('get_series_info',{series_id:series.series_id})).status,404);assert.equal((await play(first)).status,404);assert.equal(await adapter().progressReference(record,{user}),null);
}
reset();saved.push(structuredClone(saved[0]));assert.equal((await(await api('get_series')).json()).some(row=>row.smn_profile?.id===initial[0].id),false);reset();
saved[0].adult=true;user.permissions.adults=true;assert.equal((await api('get_series_info',{series_id:series.series_id})).status,200);user.permissions.adults=false;reset();

user.permissions.series=false;
assert.deepEqual(await(await api('get_series')).json(),[]);assert.deepEqual(await(await api('get_series_categories')).json(),[]);assert.equal((await api('get_series_info',{series_id:series.series_id})).status,403);assert.equal((await play(first)).status,403);user.permissions.series=true;
assert.equal(user.permissions.tv,false,'comedy series never require or grant television permission');

comedyPresent=false;
const fallback=await(await api('get_series_categories')).json(),fallbackCategory=fallback.find(row=>row.category_name==='SERIES-COMEDIA');
assert.equal(fallback.length,3);assert.ok(fallbackCategory);assert.equal((await(await api('get_series',{category_id:fallbackCategory.category_id})).json()).length,3);
assert.deepEqual((await(await api('get_series_categories')).json()),fallback,'standalone category keeps its numeric ID');
assert.equal(adapter().matches({server:'some-other-namespace'}),false);assert.equal(adapter().matches({server:COMEDY_SERIES_SERVER}),true);
console.log('PASS: finite comedy catalogue exposes all 77 episodes across 10 seasons with stable isolated IDs, existing category reuse, provider favourite preservation, strict metadata, private sources, current permissions/visibility/completeness and usage attribution.');
