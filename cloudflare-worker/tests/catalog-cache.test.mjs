import assert from 'node:assert/strict';
import {catalogCacheRoute,encodeCatalog,decodeCatalog} from '../src/catalog-cache.mjs';
import {createXtreamBridge} from '../src/xtream-bridge.mjs';

class Store {
  constructor(){this.data=new Map();this.queue=Promise.resolve()}
  async get(key){if(Array.isArray(key))return new Map(key.filter(k=>this.data.has(k)).map(k=>[k,structuredClone(this.data.get(k))]));return structuredClone(this.data.get(key))}
  async put(key,value){if(value instanceof Uint8Array)assert.ok(value.length<128*1024);this.data.set(key,structuredClone(value))}
  async delete(key){this.data.delete(key)}
  transaction(fn){const result=this.queue.then(()=>fn(this));this.queue=result.catch(()=>{});return result}
}
const storage=new Store(), now=Date.now;let offset=0;Date.now=()=>now()+offset;
const content=bytes=>{let text='';for(let i=0;i<bytes.length;i+=24000)text+=String.fromCharCode(...bytes.slice(i,i+24000));return btoa(text)};
const key='a'.repeat(64);
const large=Array.from({length:4000},(_,i)=>({id:i,title:crypto.randomUUID()+' '+crypto.randomUUID()+' película 日本語'}));
const zipped=await encodeCatalog(large);assert.ok(zipped.length>48000);
assert.equal((await catalogCacheRoute(storage,'/xtream-cache-put',{key,content:content(zipped)})).status,200);
assert.deepEqual(await decodeCatalog(await catalogCacheRoute(storage,'/xtream-cache-get',{key})),large,'chunked Unicode catalogs survive compression and durable storage');
assert.equal((await catalogCacheRoute(storage,'/xtream-cache-get',{key:'invalid'})).status,400);
await Promise.all([catalogCacheRoute(storage,'/xtream-cache-put',{key,content:content(await encodeCatalog(['first']))}),catalogCacheRoute(storage,'/xtream-cache-put',{key,content:content(await encodeCatalog(['second']))})]);
assert.deepEqual(await decodeCatalog(await catalogCacheRoute(storage,'/xtream-cache-get',{key})),['second']);

let configured=[{source:'provider-one',origin:'https://provider.example.test',encrypted:'test-provider-configuration'}], outage=false, disabled=false, upstreamCalls=0;
const rows=[{category_id:'7',category_name:'News',parent_id:0}];
const deps={
  directory:async(env,path)=>{
    if(path==='/providers')return Response.json(configured);
    if(path==='/xtream-config')return Response.json({enabled:true,version:1});
    if(path==='/xtream-login')return disabled?Response.json({error:'account_inactive'},{status:401}):Response.json({id:'customer-id',username:'customer',version:1,permissions:{tv:true,movies:true,series:true}});
    if(path==='/xtream-count')return Response.json({connections:0});throw Error(path);
  },
  registry:async(env,path,body)=>path.startsWith('/xtream-cache-')?catalogCacheRoute(storage,path,body):Response.json(body.entries.map(e=>Number(e.upstreamId)+100)),
  sessionCall:async()=>Response.json({exp:Date.now()+3600000}),
  catalogCredentials:async()=>{if(outage)throw Error('provider_unavailable');return [0,1].map(i=>({server:'test-server',origin:'https://provider.example.test',username:'provider-'+i,password:'provider-password-test'}))},
  json:(data,status=200)=>Response.json(data,{status})
};
globalThis.fetch=async url=>{upstreamCalls++;const u=new URL(url);assert.equal(u.searchParams.get('action'),'get_live_categories');return u.searchParams.get('username')==='provider-0'?Response.json({user_info:{auth:0}}):Response.json(rows)};
const bridge=createXtreamBridge(deps),env={TICKET_SECRET:'cache-test-secret',PLAYBACK_SESSIONS:{}},req=()=>new Request('https://gateway.example.test/player_api.php?username=customer&password=customer-password-test&action=get_live_categories');
const initial=await bridge(req(),env);assert.equal(initial.status,200);assert.equal(upstreamCalls,2,'an invalid provider account is skipped for another authorised account');
const expected=await initial.json();assert.equal(expected.length,1);assert.equal(expected[0].category_name,'News');
outage=true;const cold={...env,PLAYBACK_SESSIONS:{}};
assert.deepEqual(await (await bridge(req(),cold)).json(),expected,'a new Worker isolate reads the durable catalog without the reseller panel');
offset+=3600000;
const background=[],ctx={waitUntil:task=>background.push(task)};
assert.deepEqual(await (await bridge(req(),cold,ctx)).json(),expected,'a one-hour outage serves the last valid categories immediately');
await Promise.all(background);assert.equal(upstreamCalls,2);
disabled=true;assert.equal((await bridge(req(),cold,ctx)).status,401,'cached catalogs do not bypass suspension');disabled=false;
configured=[];assert.equal((await bridge(req(),cold)).status,502,'removed providers cannot use old catalogs');
configured=[{source:'provider-one',origin:'https://different.example.test',encrypted:'changed-test-configuration'}];
assert.equal((await bridge(req(),cold)).status,502,'editing a provider invalidates the previous catalog scope');
configured=[{source:'provider-one',origin:'https://provider.example.test',encrypted:'test-provider-configuration'}];
offset+=12*3600000;
assert.equal((await bridge(req(),cold)).status,502,'expired snapshots do not renew themselves during an outage');
assert.equal((await catalogCacheRoute(storage,'/xtream-cache-get',{key})).status,404);
Date.now=now;
console.log('PASS: durable chunked catalog snapshots, provider account fallback, cold starts and one-hour outages, scope invalidation, suspension and expiry.');
