import assert from 'node:assert/strict';
import {createProviderCatalog} from '../src/provider-catalog.mjs';
import {catalogCacheRoute,encodeCatalog} from '../src/catalog-cache.mjs';
import {inspectCatalog} from '../src/catalog-permissions.mjs';
import {createAdultPolicy} from '../src/content-permissions.mjs';
import {CatalogCost} from '../src/catalog-cost.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
const realFetch=globalThis.fetch,realNow=Date.now;
let now=1800000000000;Date.now=()=>now;
const makeEnv=()=>({TICKET_SECRET:'synthetic-reuse-secret',PLAYBACK_SESSIONS:{}});
const credential=server=>({server,origin:'https://synthetic.invalid',username:server,password:'fixture-password'});
const movie=name=>({movie_data:{stream_id:101,name}});

async function lateRead(mode,{action='get_vod_info',force=false}={}){
 const env=makeEnv(),list=action!=='get_vod_info',params=list?{}:{vod_id:'101'};
 const fresh=list?[{stream_id:101,_server:'ccf',name:'Fresh'}]:movie('Fresh');
 const stale=list?[{stream_id:101,_server:'ccf',name:'Old'}]:movie('Old');
 const staleAt=now-1000,compressed=await encodeCatalog(stale);
 const firstFetch=deferred(),releaseFetch=deferred(),secondRead=deferred(),releaseRead=deferred();
 const pending=[];let fetches=0,ownReads=0;const costs=[];
 const deps={
  directory:async()=>Response.json([{source:'ccf',encrypted:'synthetic-config'}]),
  registry:async(e,path,b)=>{
   if(path==='/xtream-cache-get'){
    // Scoped lists first try the full-snapshot key. Hold that first lookup
    // for the second request, exercising both snapshot-selection branches.
    ownReads++;
    if(ownReads===(list?3:2)){
     secondRead.resolve();await releaseRead.promise;
     if(mode==='error')throw Error('synthetic_cache_unavailable');
     if(mode==='old')return new Response(compressed,{headers:{'x-catalog-saved-at':String(staleAt)}});
    }
    return new Response(null,{status:404});
   }
   assert.equal(path,'/xtream-cache-put');return Response.json({ok:true});
  },catalogCredentials:async()=>[credential('ccf')]
 };
 globalThis.fetch=async input=>{
  const url=new URL(input);assert.equal(url.origin,'https://synthetic.invalid');assert.equal(url.searchParams.get('action'),action);
  fetches++;if(fetches===1){firstFetch.resolve();await releaseFetch.promise;}
  return Response.json(fresh);
 };
 const ctx={waitUntil:p=>pending.push(p)},read=options=>{
  const cost=new CatalogCost('vod_info',()=>now);costs.push(cost);
  return createProviderCatalog(deps,env,ctx,{catalogCost:cost})(action,'ccf',params,options);
 };
 const one=read();await firstFetch.promise;
 const two=read(force?{fresh:true}:{});await secondRead.promise;
 now++;releaseFetch.resolve();assert.deepEqual(await one,fresh);
 releaseRead.resolve();assert.deepEqual(await two,fresh,'an old durable snapshot must not replace a newly published result');
 await Promise.all(pending);
 assert.equal(fetches,force?2:1,'a late durable miss must reuse the identical fresh result published while it was waiting');
 assert.equal(costs[1].snapshot().cache[force?'miss':'memory'],1);
 const before=fetches;assert.deepEqual(await read(),fresh);assert.equal(fetches,before,'a third request retains the fresh result');
}

class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve();}
 async get(k){return Array.isArray(k)?new Map(k.filter(x=>this.data.has(x)).map(x=>[x,structuredClone(this.data.get(x))])):structuredClone(this.data.get(k));}
 async put(k,v){this.data.set(k,structuredClone(v));}async delete(k){this.data.delete(k);}
 transaction(fn){const work=this.queue.then(()=>fn(this));this.queue=work.catch(()=>{});return work;}
}
async function permissionSequence(){
 const store=new Store(),env=makeEnv(),pending=[],ctx={waitUntil:p=>pending.push(p)};
 const flush=async()=>{while(pending.length)await Promise.all(pending.splice(0));};
 let config='v1',configReads=0,physical=[];const keyedReads=[];
 const deps={
  directory:async()=>{configReads++;return Response.json([{source:'ccf',encrypted:config}]);},
  registry:async(e,path,b)=>{if(path==='/xtream-cache-inspect')return inspectCatalog(store,b);keyedReads.push([path,b.key]);return catalogCacheRoute(store,path,b);},
  catalogCredentials:async(e,server)=>[credential(server)]
 };
 globalThis.fetch=async input=>{
  const url=new URL(input);assert.equal(url.origin,'https://synthetic.invalid');
  const action=url.searchParams.get('action'),server=url.searchParams.get('username');physical.push([action,server]);
  return Response.json(action==='get_vod_streams'?[{stream_id:101,category_id:1,name:'General'},{stream_id:102,category_id:2,name:'Neutral title'}]:action==='get_vod_categories'?[{category_id:1,category_name:'General'},{category_id:2,category_name:'Adults'}]:{movie_data:{stream_id:Number(url.searchParams.get('vod_id')),name:server+':'+config}});
 };
 const request=async({adults=false,id='101',server='ccf',binding=env}={})=>{
  const cost=new CatalogCost('vod_info',()=>now),catalog=createProviderCatalog(deps,binding,ctx,{catalogCost:cost}),policy=createAdultPolicy(catalog);
  if(!adults&&!await policy.allowed({kind:'movie',server,upstreamId:id}))return {status:403};
  return {status:200,data:await catalog('get_vod_info',server,{vod_id:id}),cost:cost.snapshot()};
 };
 const cold=await request();await flush();
 assert.equal(cold.status,200);assert.deepEqual(physical.map(x=>x[0]).sort(),['get_vod_categories','get_vod_info','get_vod_streams']);assert.equal(configReads,1);
 assert.equal(cold.cost.lookups,3);assert.deepEqual(cold.cost.cache,{memory:0,durable:0,miss:3});
 const warm=await request();await flush();assert.equal(warm.cost.lookups,1);assert.equal(warm.cost.cache.memory,1);assert.equal(physical.length,3,'equivalent successive requests do not repeat provider reads');
 const replaced=await request({binding:makeEnv()});await flush();assert.equal(replaced.cost.cache.durable,1);assert.equal(physical.length,3,'isolate replacement retains durable reuse');
 now+=31000;const expired=await request();await flush();assert.equal(expired.cost.cache.miss,1);assert.equal(physical.length,4,'30-second detail TTL still refreshes exactly the detail');
 await request({adults:true,id:'102'});await flush();const beforeDenied=physical.length;
 assert.equal((await request({id:'102'})).status,403);assert.equal(physical.length,beforeDenied,'an adult-enabled request never authorizes a later restricted caller');
 const other=await request({server:'beta'});await flush();assert.equal(other.data.movie_data.name,'beta:v1','provider-scoped keys never borrow another provider result');
 const oldKeys=new Set(keyedReads.map(x=>x[1]));config='v2';const before=physical.length,changed=await request();await flush();
 assert.equal(changed.data.movie_data.name,'ccf:v2');assert.equal(physical.length-before,3,'configuration edits invalidate all three lookup keys');assert.ok(keyedReads.some(x=>!oldKeys.has(x[1])));
 // Reproduce the observed aggregate shape without assuming it is a defect:
 // only categories exist durably; titles and this detail have no snapshot.
 config='v3';await createProviderCatalog(deps,makeEnv(),ctx)('get_vod_categories','ccf');await flush();
 const partialEnv=makeEnv(),beforePartial=physical.length,partial=await request({binding:partialEnv});await flush();
 assert.deepEqual(partial.cost.cache,{memory:0,durable:1,miss:2});assert.equal(partial.cost.lookups,3);assert.equal(physical.length-beforePartial,2);
 await request({binding:partialEnv});await flush();assert.equal(physical.length-beforePartial,2,'the two cold misses are not repeated by an equivalent warm request');
 console.log('PASS: full permission/detail path: cold=3 physical reads, same request=0 additional, cold isolate=0 additional, detail expiry=1 additional; adult and provider/config isolation preserved.');
 console.log('PASS: categories-only durable fixture yields exactly 1 durable + 2 expected misses; the next equivalent request adds no provider traffic.');
}

async function abandonedWaiter(){
 const env=makeEnv(),started=deferred(),release=deferred(),secondRead=deferred(),pending=[];let reads=0,fetches=0;
 const deps={directory:async()=>Response.json([{source:'ccf',encrypted:'synthetic'}]),registry:async(e,path)=>{
  if(path==='/xtream-cache-get'){if(++reads===2)secondRead.resolve();return new Response(null,{status:404});}return Response.json({ok:true});
 },catalogCredentials:async()=>[credential('ccf')]};
 globalThis.fetch=async(input,options)=>{assert.equal(new URL(input).origin,'https://synthetic.invalid');fetches++;started.resolve();await release.promise;assert.equal(options.signal.aborted,false);return Response.json(movie('Shared'));};
 const ctx={waitUntil:p=>pending.push(p)},read=()=>createProviderCatalog(deps,env,ctx)('get_vod_info','ccf',{vod_id:'101'});
 const controller=new AbortController(),work=read();
 const caller=Promise.race([work,new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))]);
 await started.promise;const other=read();await secondRead.promise;controller.abort();await assert.rejects(caller,/cancelled/);
 release.resolve();assert.deepEqual(await other,movie('Shared'));await work;await Promise.all(pending);assert.equal(fetches,1,'abandoning one waiter does not cancel or duplicate another request');
}

try{
 for(const mode of ['miss','old','error'])await lateRead(mode);
 for(const mode of ['miss','old','error'])await lateRead(mode,{action:'get_vod_streams'});
 await lateRead('miss',{force:true});
 await permissionSequence();await abandonedWaiter();
 console.log('PASS: late durable miss/error/old snapshot races, scoped/full keys, fresh override, unchanged TTL, request/config isolation and abandoned waiter.');
}finally{globalThis.fetch=realFetch;Date.now=realNow;}
