import assert from 'node:assert/strict';
import {catalogCacheRoute,encodeCatalog,decodeCatalog} from '../src/catalog-cache.mjs';
import {createProviderCatalog} from '../src/provider-catalog.mjs';
import {CatalogCost} from '../src/catalog-cost.mjs';

// Deterministic clock and held writes: no provider traffic or timing sleeps.
const realNow=Date.now,realFetch=globalThis.fetch;
let now=1800000000000;Date.now=()=>now;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve();this.writes=0;this.deletes=0;}
 async get(k){return Array.isArray(k)?new Map(k.filter(x=>this.data.has(x)).map(x=>[x,structuredClone(this.data.get(x))])):structuredClone(this.data.get(k));}
 async put(k,v){this.writes++;this.data.set(k,structuredClone(v));}
 async delete(k){this.deletes++;this.data.delete(k);}
 transaction(fn){const work=this.queue.then(()=>fn(this));this.queue=work.catch(()=>{});return work;}
}
const content=async value=>Buffer.from(await encodeCatalog(value)).toString('base64');
const movie=name=>({movie_data:{stream_id:101,name}});

async function delayedDetailWrite(){
 const store=new Store(),firstPut=deferred(),releaseFirst=deferred();
 const pending=[],ctx={waitUntil:p=>pending.push(p)},start=now;
 let fetches=0,puts=0;
 const deps={
  directory:async()=>Response.json([{source:'ccf',encrypted:'synthetic-config'}]),
  catalogCredentials:async()=>[{server:'ccf',origin:'https://synthetic.invalid',username:'fixture',password:'fixture-only'}],
  registry:async(env,path,body)=>{
   if(path==='/xtream-cache-put'&&++puts===1){firstPut.resolve();await releaseFirst.promise;}
   return catalogCacheRoute(store,path,body);
  }
 };
 globalThis.fetch=async url=>{
  assert.equal(new URL(url).origin,'https://synthetic.invalid');
  assert.equal(new URL(url).searchParams.get('action'),'get_vod_info');
  return Response.json(movie(++fetches===1?'Older':fetches===2?'Newer':'Refetched'));
 };
 // Each call has a separate isolate cache but the same durable registry.
 const read=async()=>{
  const cost=new CatalogCost('vod_info',()=>now),env={TICKET_SECRET:'synthetic-detail-order',PLAYBACK_SESSIONS:{}};
  const data=await createProviderCatalog(deps,env,ctx,{catalogCost:cost})('get_vod_info','ccf',{vod_id:'101'});
  return {data,cost:cost.snapshot()};
 };
 assert.equal((await read()).data.movie_data.name,'Older');await firstPut.promise;
 now=start+20000;assert.equal((await read()).data.movie_data.name,'Newer');
 await Promise.all(pending.slice(1));
 const newerIndex=await store.get('catalog-detail-index');
 now=start+25000;releaseFirst.resolve();await Promise.all(pending);
 // The older result is still within its own 30-second TTL when it arrives,
 // but must not replace a newer snapshot already committed by another isolate.
 now=start+31000;const reused=await read();await Promise.all(pending);
 assert.equal(fetches,2,'a late older write must not expire the newer detail and trigger a third provider read');
 assert.equal(reused.data.movie_data.name,'Newer');
 assert.deepEqual(reused.cost.cache,{memory:0,durable:1,miss:0});
 assert.deepEqual(await store.get('catalog-detail-index'),newerIndex,'ignored writes must not alter generation, bytes or expiry');
 now=start+50001;assert.equal((await read()).data.movie_data.name,'Refetched');await Promise.all(pending);
 assert.equal(fetches,3,'the newer detail still expires after exactly its original 30-second TTL');
 console.log('PASS: separate-isolate out-of-order detail saves keep the newer value; post-expiry-of-old read is durable with 2 total fetches, not 3; genuine expiry still refreshes.');
}

async function writeBoundaries(){
 const store=new Store(),key='a'.repeat(64),other='b'.repeat(64),at=now;
 const write=(k,data,savedAt,kind='detail')=>catalogCacheRoute(store,'/xtream-cache-put',{kind,key:k,content:data,savedAt});
 const older=await content(movie('Older')),newer=await content(movie('Newer'));
 assert.equal((await write(key,newer,at)).status,200);
 const original=await store.get('catalog-detail-index'),writes=store.writes,deletes=store.deletes;
 now=at+1000;assert.equal((await write(key,older,at-1000)).status,200);
 assert.deepEqual(await store.get('catalog-detail-index'),original);
 assert.equal(store.writes,writes);assert.equal(store.deletes,deletes,'stale writes do not delete the current chunks');
 assert.equal((await write(other,older,at-1000)).status,200,'different keys are independent');
 assert.equal((await write(key,older,now)).status,200,'a genuinely newer result replaces the snapshot');
 assert.equal((await decodeCatalog(await catalogCacheRoute(store,'/xtream-cache-get',{kind:'detail',key}))).movie_data.name,'Older');
 assert.equal((await write(key,newer,now+1)).status,400,'future timestamps remain invalid');
 assert.equal((await write(key,newer,now-30000)).status,400,'expired timestamps remain invalid');
 assert.equal((await write(key,newer,'invalid')).status,400);
 assert.equal((await write(key,newer,now-999999,'list')).status,200,'list timestamps and TTL behavior are unchanged');
 assert.ok((await store.get('catalog-cache-index'))[key].until===now+12*3600000);
 console.log('PASS: monotonic detail writes, key isolation, no writes/deletes on older saves, unchanged invalid/future/expired validation and list TTL.');
}

try{await delayedDetailWrite();await writeBoundaries();}
finally{Date.now=realNow;globalThis.fetch=realFetch;}
