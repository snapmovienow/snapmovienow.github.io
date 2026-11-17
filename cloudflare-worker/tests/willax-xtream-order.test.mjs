import assert from 'node:assert/strict';
import {WILLAX_CHANNEL as channel,WILLAX_FOLDER} from '../src/willax-live.mjs';
import {createLocalTvXtream,LOCAL_TV_CATEGORIES,LOCAL_TV_SERVER,visibleLocalTv} from '../src/local-tv-xtream.mjs';

const row={...channel,type:'movie',mode:'gnula',usageKind:'channel',source:'WILLAX · señal alternativa',year:null,adult:false,visible:true,episodes:[],createdAt:1000};
const permissions={tv:true,movies:false,series:false,adults:false},auth={username:'fixture-viewer',password:'fixture-password',user:{permissions}},base='https://api.snaptvnow.com';
const peru={category_id:'61',category_name:'CANALES-PERU',parent_id:0,_server:'provider-fixture'},foreign={category_id:'62',category_name:'OTROS',parent_id:0,_server:'provider-fixture'};
const original=[
 {num:1,name:'ATV',stream_id:101,category_id:'61'},
 {num:2,name:'WILLAX HD',stream_id:102,category_id:'61'},
 {num:3,name:'Willax TV',stream_id:103,category_id:'61'},
 {num:4,name:'Latina',stream_id:104,category_id:'61'},
 {num:5,name:'PE | WillaxTV',stream_id:105,category_id:'61'},
 {num:6,name:'Panamericana',stream_id:106,category_id:'61'},
 {num:7,name:'WILLAX OTHER COUNTRY',stream_id:107,category_id:'62'}
];
const before=structuredClone(original),registered=[],register=async records=>records.map(record=>{
 registered.push(record);return record.kind==='live'?900023:record.server===LOCAL_TV_SERVER?9112:Number(record.upstreamId);
});
const make=(saved=[row],overrides={})=>createLocalTvXtream({read:async()=>({items:saved}),prepare:()=>{throw Error('listing must not prepare playback');},media:()=>{throw Error('listing must not fetch media');},...overrides},{},null);
const options={action:'get_live_streams',rows:original,auth,base,register,catalog:async action=>{assert.equal(action,'get_live_categories');return [peru,foreign];}};
let result=await make().list(options),added=result.find(item=>item.stream_id===900023);
assert.deepEqual(result.map(item=>item.stream_id),[101,102,103,104,105,900023,106,107],'alternative follows the third existing Willax within Peru, not the foreign match');
assert.deepEqual(original,before);assert.deepEqual(result.filter(item=>item.stream_id!==900023),before,'all provider objects, ordinals and identities remain unchanged');
for(const name of ['WILLAXHD','WILLAX_HD','PE_WILLAX_HD']){
 const labeled=original.map(item=>item.stream_id===105?{...item,name}:item),ordered=await make().list({...options,rows:labeled});
 assert.deepEqual(ordered.map(item=>item.stream_id),[101,102,103,104,105,900023,106,107],'joined provider label still places the alternative after the third Willax: '+name);
}
assert.equal(added.category_id,'61');assert.equal(added.num,original.length+1);assert.equal(new URL(added.direct_source).origin,base);assert.equal(added.container_extension,'m3u8');assert.equal(added.stream_type,'live');assert.equal(registered.find(record=>record.kind==='live').upstreamId,channel.xtreamId);
const categories=await make().list({...options,action:'get_live_categories',rows:[peru,foreign]});assert.deepEqual(categories,[peru,foreign],'existing Peru category reused without duplicate');
const filtered=await make().list({...options,categoryId:'61',rows:original.filter(item=>item.category_id==='61')});assert.deepEqual(filtered.map(item=>item.stream_id),[101,102,103,104,105,900023,106]);
assert.deepEqual(await make().list({...options,categoryId:'62',rows:[original.at(-1)]}),[original.at(-1)]);
const noMatch=original.filter(item=>!item.name.toLowerCase().includes('willax'));result=await make().list({...options,rows:noMatch});assert.deepEqual(result.map(item=>item.stream_id),[...noMatch.map(item=>item.stream_id),900023]);
result=await make().list({...options,rows:[],catalog:async()=>[]});assert.equal(result[0].category_id,'9112');
const newFolders=await make().list({...options,action:'get_live_categories',rows:[],catalog:async()=>[]});assert.equal(newFolders.length,1);assert.equal(newFolders[0].category_name,'Perú');assert.equal(newFolders[0].category_id,'9112');
assert.equal(LOCAL_TV_CATEGORIES.find(item=>item.key===WILLAX_FOLDER.key).upstreamId,'112');assert.equal(new Set(LOCAL_TV_CATEGORIES.map(item=>item.upstreamId)).size,LOCAL_TV_CATEGORIES.length);
assert.equal(visibleLocalTv(row,permissions),true);assert.equal(visibleLocalTv({...row,visible:false},permissions),false);assert.equal(visibleLocalTv({...row,page:channel.page+'?other=1'},permissions),false);assert.equal(visibleLocalTv({...row,mode:'direct'},permissions),false);assert.equal(visibleLocalTv(row,{...permissions,tv:false}),false);
assert.deepEqual(await make([{...row,visible:false}]).list(options),original);assert.deepEqual(await make().list({...options,auth:{...auth,user:{permissions:{...permissions,tv:false}}}}),original);
console.log('PASS: Willax is fourth after the three Peru entries, provider order/objects/IDs preserved, foreign names excluded, existing folder reused, filtered/unfiltered catalogs agree and TV visibility applies.');
