import assert from 'node:assert/strict';
import {catalogCacheRoute,encodeCatalog} from '../src/catalog-cache.mjs';
import {inspectCatalog} from '../src/catalog-permissions.mjs';
import {createProviderCatalog} from '../src/provider-catalog.mjs';
import {createAdultPolicy} from '../src/content-permissions.mjs';
class Store{
 data=new Map();payloadReads=0;
 async get(k){if(Array.isArray(k)){this.payloadReads++;return new Map(k.map(k=>[k,this.data.get(k)]))}return structuredClone(this.data.get(k))}
 async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}transaction(fn){return fn(this)}
}
const store=new Store(),rowKey='a'.repeat(64),categoryKey='b'.repeat(64);
const put=async(key,data)=>{const bytes=await encodeCatalog(data);return catalogCacheRoute(store,'/xtream-cache-put',{key,content:Buffer.from(bytes).toString('base64')})};
await put(rowKey,[{stream_id:1,_server:'alpha',category_id:1,name:'News'},{stream_id:2,_server:'alpha',category_id:2,name:'News'},{stream_id:1,_server:'beta',name:'Adult'},{stream_id:3,_server:'alpha',category_id:3,name:'News'}]);
await put(categoryKey,[{category_id:1,_server:'alpha',category_name:'General'},{category_id:2,_server:'alpha',category_name:'Adults'},{category_id:3,_server:'alpha',category_name:'Nested',parent_id:2}]);
const body={rowKeys:[rowKey],categoryKeys:[categoryKey],idField:'stream_id',id:'1',server:'alpha'};
const inspect=async extra=>(await inspectCatalog(store,{...body,...extra})).json();
assert.deepEqual(await inspect(),{found:true,adult:false});const reads=store.payloadReads;
assert.equal((await inspect({id:'2'})).adult,true);assert.equal((await inspect({id:'3'})).adult,true);assert.equal((await inspect({server:'beta'})).adult,true);
assert.deepEqual(await inspect({id:'999'}),{found:false,adult:false});assert.equal(store.payloadReads,reads,'warm channel changes never read or decode full snapshots');
await put(categoryKey,[{category_id:1,_server:'alpha',category_name:'Adults'}]);
assert.equal((await inspect()).adult,true,'refreshing only categories invalidates old allow decisions');
await put(rowKey,[{stream_id:1,_server:'alpha',name:'Weather'}]);assert.equal((await inspect()).adult,false,'refreshing rows invalidates old classification');
assert.equal((await inspectCatalog(store,{...body,rowKeys:['f'.repeat(64)]})).status,404,'unknown config never reuses an old decision');
const clock=Date.now;Date.now=()=>clock()+300001;try{assert.equal((await inspectCatalog(store,body)).status,404,'stale permissions fall back to refreshing the catalog')}finally{Date.now=clock}
let directoryReads=0,catalogReads=0;const deps={directory:async()=>{directoryReads++;return Response.json([{source:'alpha',encrypted:'v1'}])},registry:async(env,path,b)=>{if(path==='/xtream-cache-inspect')return Response.json({found:true,adult:false});catalogReads++;throw Error('full_catalog_should_not_load')}};
const catalog=createProviderCatalog(deps,{TICKET_SECRET:'fixture-secret',PLAYBACK_SESSIONS:{}}),policy=createAdultPolicy(catalog);
assert.equal(await policy.allowed({kind:'live',server:'alpha',upstreamId:1}),true);assert.equal(await policy.allowed({kind:'movie',server:'alpha',upstreamId:1}),true);
assert.equal(directoryReads,1,'related checks share current request config');assert.equal(catalogReads,0);
console.log('PASS: targeted durable permission decisions, provider isolation, nested adult categories, cache generation invalidation, bounded freshness and one current configuration read.');
