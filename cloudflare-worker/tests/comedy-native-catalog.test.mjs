import assert from 'node:assert/strict';
import {COMEDY_SERIES_DEFINITIONS} from '../src/comedy-series-catalog.mjs';
import {comedyEpisodeId} from '../src/comedy-series-xtream.mjs';
import {comedyNativeCatalog,comedyNativeList,COMEDY_NATIVE_CATEGORY} from '../src/comedy-native-catalog.mjs';

// Catalogue fixtures exercise placement and identity, never claim playback.
const definition=COMEDY_SERIES_DEFINITIONS[0];
const saved={id:definition.id,name:definition.name,type:'series',mode:'gnula',year:definition.year,visible:true,adult:false,profileServer:'exclusive',poster:'/exclusive-cover/'+'a'.repeat(64),plot:'Comedia española.',page:definition.sourcePage,
 episodes:Object.entries(definition.seasons).flatMap(([season,count])=>Array.from({length:count},(_,index)=>({id:comedyEpisodeId(definition,Number(season),index+1),season:Number(season),episode_num:index+1,title:'Episodio '+(index+1),page:'https://episode.fixture.invalid/'+season+'/'+(index+1)})))};
const provider=[
 {name:'Muertos S. L. (2024)',series_id:25,_server:'provider-fixture',category_id:'4'},
 {name:'Machos alfa',series_id:26,_server:'provider-fixture',category_id:'4'},
 {name:'Muertos S.L.: documental',series_id:27,_server:'provider-fixture',category_id:'4'},
 {name:'Comedia independiente',series_id:28,_server:'provider-fixture',category_id:'4'}
];
const permissions={series:true,tv:false,movies:false,adults:false};
const snapshot=structuredClone(provider),items=structuredClone([saved]);
const project=(overrides={})=>comedyNativeCatalog({op:'series',rows:provider,items,permissions,origin:'https://api.fixture.invalid',...overrides});
assert.equal(comedyNativeList('series'),true);assert.equal(comedyNativeList('series_categories','exclusive'),true);
assert.equal(comedyNativeList('series','provider-fixture'),false);assert.equal(comedyNativeList('vod'),false);
let result=project();
assert.deepEqual(result.map(row=>row.name),['Machos alfa','Muertos S.L.: documental','Comedia independiente',definition.name]);
assert.deepEqual(provider,snapshot,'provider ID records are never deleted or mutated');
const own=result.at(-1);
assert.equal(own.series_id,definition.id);assert.equal(own.exclusive_id,definition.id);assert.equal(own.source,'gnula');assert.equal(own._server,'exclusive');assert.equal(own.category_id,COMEDY_NATIVE_CATEGORY);assert.equal(own.genre,'Comedia');
assert.deepEqual(own.smn_profile,{type:'series',id:definition.id,server:'exclusive'});
assert.equal(own.cover,'https://api.fixture.invalid'+saved.poster);
assert.equal(JSON.stringify(own).includes('episode.fixture.invalid'),false);assert.equal(JSON.stringify(own).includes('gnulahd'),false);
assert.deepEqual(project(),result,'refreshing the list keeps the same saved-content identities');
assert.equal(project({server:'provider-fixture'}),provider,'source-specific provider list is untouched');
assert.equal(project({op:'vod'}),provider);
for(const changed of [[],[{...saved,visible:false}],[{...saved,episodes:saved.episodes.slice(1)}],[{...saved,episodes:[...saved.episodes.slice(1),saved.episodes[1]]}], [saved,saved]]){
 assert.equal(project({items:changed}),provider,'hidden, incomplete or ambiguous rows restore the provider list');
}
assert.equal(project({permissions:{...permissions,series:false}}),provider);
assert.equal(project({items:[{...saved,adult:true}]}),provider);
assert.equal(project({rows:[],server:'exclusive'}).length,1);
const categories=[{category_id:'4',category_name:'Comedia',_server:'provider-fixture'}];
const projected=comedyNativeCatalog({op:'series_categories',rows:categories,items,permissions});
assert.deepEqual(projected,[...categories,{category_id:COMEDY_NATIVE_CATEGORY,category_name:'SERIES-COMEDIA',parent_id:0,_server:'exclusive'}]);
assert.equal(comedyNativeCatalog({op:'series_categories',rows:projected,items,permissions}),projected,'a category reply cannot duplicate its own identity');
assert.equal(comedyNativeCatalog({op:'series_categories',rows:categories,items:[],permissions}),categories);
console.log('PASS native/web comedy placement, stable exclusive protocols, exact alias replacement, complete visible series, current permissions and provider favourites.');
