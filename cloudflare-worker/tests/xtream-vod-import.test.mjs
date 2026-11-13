import assert from 'node:assert/strict';
import {handleXtream} from '../src/xtream.mjs';
import {publicMetadata} from '../src/provider-catalog.mjs';

// Strict native VOD importers require these keys before committing their local
// catalogue. Exercise the public handler and privacy filter; no real network,
// customer account, application binary or playback is used by this regression.
const origin='https://api.example.test';
const credentials={origin:'https://provider.example.test',username:'private-provider',password:'private-password'};
const user={username:'customer',permissions:{movies:true,adults:true}};
const required=['num','name','stream_type','stream_id','stream_icon','category_id','container_extension','custom_sid','direct_source'];
const source=[
 {stream_id:31,name:'First movie',stream_icon:'https://images.example.test/one.jpg',category_id:'7',container_extension:'mkv',custom_sid:'private-sid'},
 {stream_id:32,name:'Second movie',stream_icon:'https://images.example.test/two.jpg',category_id:'7',container_extension:'mp4'}
];
const records=new Map(),keys=new Map();let next=100;
const deps={
 authenticate:async()=>({user,username:user.username,session:{sid:'synthetic-session'}}),
 catalog:async action=>{assert.equal(action,'get_vod_streams');return publicMetadata(source,credentials).map(row=>({...row,_server:'test'}));},
 register:async entries=>entries.map(entry=>{const key=JSON.stringify([entry.kind,entry.server,entry.upstreamId]);if(!keys.has(key)){const id=next++;keys.set(key,id);records.set(String(id),entry);}return keys.get(key);}),
 resolve:async id=>records.get(String(id)),
 json:(data,status=200)=>Response.json(data,{status}),
 play:async()=>{throw Error('catalogue regression must never start playback');}
};
const request=(method='GET',extra={})=>{
 const query=new URLSearchParams({username:user.username,password:'customer-password',action:'get_vod_streams',...extra});
 return new Request(origin+'/player_api.php'+(method==='GET'?'?'+query:''),{method,...(method==='POST'?{headers:{'content-type':'application/x-www-form-urlencoded'},body:query}:{})});
};
const importContract=rows=>rows.map(row=>{
 for(const key of required)assert.ok(Object.hasOwn(row,key),`strict VOD importer: missing ${key}`);
 assert.equal(row.custom_sid,'','the compatibility field is always empty, never an upstream SID');
 assert.equal(new URL(row.direct_source).origin,origin);
 return String(row.stream_id);
});
assert.equal(Object.hasOwn(publicMetadata(source[0],credentials),'custom_sid'),false,'provider SID must remain stripped by the privacy layer');
const getResponse=await handleXtream(request(),deps);assert.equal(getResponse.status,200);
const get=await getResponse.json();assert.equal(get.length,2);assert.equal(importContract(get).length,2);
assert.deepEqual(get.map(row=>row.name),source.map(row=>row.name));
assert.deepEqual(get.map(row=>row.container_extension),['mkv','mp4']);
for(const secret of [...Object.values(credentials),'private-sid'])assert.equal(JSON.stringify(get).includes(secret),false);
const post=await (await handleXtream(request('POST'),deps)).json();assert.deepEqual(post,get,'POST and refresh preserve the same contract and public IDs');
const filtered=await (await handleXtream(request('GET',{category_id:get[0].category_id}),deps)).json();assert.deepEqual(importContract(filtered),importContract(get));
user.permissions.movies=false;
assert.deepEqual(await (await handleXtream(request(),deps)).json(),[],'disabled movie access remains disabled');
user.permissions.movies=true;
deps.authenticate=async()=>Response.json({error:'unauthorized'},{status:401});
assert.equal((await handleXtream(request(),deps)).status,401,'compatibility must not bypass authentication');
console.log('PASS: strict VOD import, safe empty SID, stable IDs, filtering, refresh and access controls.');
