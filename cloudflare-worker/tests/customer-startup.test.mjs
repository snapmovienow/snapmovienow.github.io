import assert from 'node:assert/strict';
import {createProviderCatalog} from '../src/provider-catalog.mjs';
import {catalogCacheRoute} from '../src/catalog-cache.mjs';
import {createAdultPolicy} from '../src/content-permissions.mjs';
import {prepareWebPlayback} from '../src/web-playback.mjs';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve()}
 async get(key){if(Array.isArray(key))return new Map(key.filter(k=>this.data.has(k)).map(k=>[k,structuredClone(this.data.get(k))]));return structuredClone(this.data.get(key))}
 async put(key,value){this.data.set(key,structuredClone(value))}async delete(key){this.data.delete(key)}
 transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p}
}
const store=new Store(),secret='customer-startup-fixture',realFetch=globalThis.fetch,realNow=Date.now;
let elapsed=0,reads=0,cacheReads=0,outage=false,configuration='v1';Date.now=()=>realNow()+elapsed;
const series={info:{name:'Fixture series'},episodes:{1:[{id:8,title:'Episode'}]}};
const deps={directory:async()=>Response.json([{source:'alpha',encrypted:configuration},{source:'beta',encrypted:'v1'}]),registry:(env,path,body)=>{if(path==='/xtream-cache-get')cacheReads++;return catalogCacheRoute(store,path,body)},catalogCredentials:async(env,server)=>{if(outage)throw Error('provider_unavailable');return ['alpha','beta'].filter(id=>!server||id===server).map(server=>({server,origin:'https://'+server+'.example',username:'fixture',password:'fixture-password'}))}};
const make=()=>createProviderCatalog(deps,{TICKET_SECRET:secret,PLAYBACK_SESSIONS:{}});
try{
 globalThis.fetch=async url=>{reads++;const u=new URL(url);return Response.json(u.searchParams.get('action')==='get_series_info'?series:[{stream_id:1,name:u.hostname}])};
 const all=await make()('get_live_streams');assert.equal(all.length,2);assert.equal(reads,2);
 outage=true;const scoped=await make()('get_live_streams','alpha');assert.equal(scoped.length,1);assert.equal(scoped[0]._server,'alpha');assert.equal(reads,2,'a cold scoped permission check reuses the verified full snapshot without provider traffic');
 const beforeMemory=cacheReads;assert.equal(await make()('get_live_streams','alpha',{}, {cachedOnly:true,memoryOnly:true}),null);assert.equal(cacheReads,beforeMemory,'optional labels never load a durable full catalog');
 outage=false;assert.deepEqual(await make()('get_series_info','alpha',{series_id:7}),series);const detailReads=reads;
 outage=true;assert.deepEqual(await make()('get_series_info','alpha',{series_id:7}),series);assert.equal(reads,detailReads,'a second isolate reuses details within their existing thirty-second lifetime');
 const detailIndex=await store.get('catalog-detail-index');assert.equal(Object.values(detailIndex)[0].until-Object.values(detailIndex)[0].savedAt,30000);
 elapsed=31000;await assert.rejects(make()('get_series_info','alpha',{series_id:7}),/provider_unavailable/,'details fail closed after thirty seconds');
 assert.equal((await make()('get_live_streams','alpha'))[0]._server,'alpha','expired detail records cannot evict the full catalog namespace');
 configuration='v2';await assert.rejects(make()('get_live_streams','alpha'),/provider_unavailable/,'provider configuration changes invalidate scoped snapshot reuse');
}finally{globalThis.fetch=realFetch;Date.now=realNow}

let nameReads=0;const rows=Array.from({length:10000},(_,i)=>({stream_id:i,_server:'alpha',category_id:1,get name(){nameReads++;return 'News '+i}})),categories=[{category_id:1,_server:'alpha',category_name:'News'}];
const calls=[],catalog=async(action,server)=>{calls.push({action,server});assert.equal(server,'alpha','opening a channel cannot scan unrelated servers');return action==='get_live_streams'?rows:categories};
assert.equal(await createAdultPolicy(catalog).allowed({kind:'live',server:'alpha',upstreamId:777}),true);
assert.equal(await createAdultPolicy(catalog).allowed({kind:'live',server:'alpha',upstreamId:888}),true);
assert.equal(nameReads,2,'permission checks inspect only the chosen rows, rather than reclassifying ten thousand titles per channel');
const restricted=async(action,server)=>action==='get_live_streams'?rows:[{category_id:1,_server:server,category_name:'Adults'}];
assert.equal(await createAdultPolicy(restricted).allowed({kind:'live',server:'alpha',upstreamId:777}),false,'a new category snapshot immediately invalidates the prior adult classification');

let resolveActivity,activityStarted=false;const gate=new Promise(r=>{resolveActivity=r}),background=[],updates=[],ctx={waitUntil:p=>background.push(p)};
const owned={managed:true,sid:'viewer',uid:'viewer-id',version:1,username:'viewer'};
const d={activity:()=>{activityStarted=true;return gate},directory:async(env,path,body)=>{if(path==='/playback-activity')updates.push(body);return Response.json({ok:true})},managedPlayback:async()=>{assert.equal(activityStarted,false,'optional metadata reads cannot compete with allocation');return {r:Response.json({lease_id:'lease'}),credentials:{username:'source',password:'fixture-password',origin:'https://fixture.example'}}},ticket:async()=> 'opaque-fixture',json:(data,status=200)=>Response.json(data,{status}),cleanExt:()=> 'ts'};
let timer;try{
 const response=await Promise.race([prepareWebPlayback({type:'live',id:1,request_id:'request'},owned,'https://gateway.example/',{},ctx,d),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('optional_label_blocked_playback')),200)})]);
 assert.equal(response.status,200);assert.equal(updates.length,0);resolveActivity({title:'Verified channel'});await Promise.all(background);
 assert.equal(updates.length,1);assert.deepEqual({sid:updates[0].sid,lease_id:updates[0].lease_id,request_id:updates[0].request_id,mediaKey:updates[0].mediaKey},{sid:'viewer',lease_id:'lease',request_id:'request',mediaKey:'live|ccf|1|ts'});
}finally{clearTimeout(timer);resolveActivity(null)}
console.log('PASS: scoped cold-cache reuse, thirty-second cross-isolate detail validity, provider invalidation, indexed single-server permission checks and nonblocking owned playback labels.');
