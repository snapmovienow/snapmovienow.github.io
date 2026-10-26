import assert from 'node:assert/strict';
import {catalogCacheRoute,encodeCatalog} from '../src/catalog-cache.mjs';
import {inspectCatalog} from '../src/catalog-permissions.mjs';

const deferred=()=>{let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j});return {promise,resolve,reject}};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
class Store{
 data=new Map();payloadReads=0;gate=null;
 async get(key){
  if(Array.isArray(key)){
   this.payloadReads++;const values=new Map(key.filter(k=>this.data.has(k)).map(k=>[k,structuredClone(this.data.get(k))]));
   if(this.gate)await this.gate.promise;
   return values;
  }
  return structuredClone(this.data.get(key));
 }
 async put(key,value){this.data.set(key,structuredClone(value));}
 async delete(key){this.data.delete(key);}
 transaction(fn){return fn(this);}
}
const rowsKey='a'.repeat(64),categoriesKey='b'.repeat(64);
const put=async(store,key,data)=>{
 const bytes=await encodeCatalog(data);
 const response=await catalogCacheRoute(store,'/xtream-cache-put',{key,content:Buffer.from(bytes).toString('base64')});
 assert.equal(response.status,200);
};
const request={rowKeys:[rowsKey],categoryKeys:[categoriesKey],idField:'stream_id',id:'1',server:'alpha'};
const fixture=async()=>{
 const store=new Store();
 await put(store,rowsKey,[{stream_id:1,_server:'alpha',category_id:1,name:'General'},{stream_id:2,_server:'alpha',category_id:2,name:'Neutral'},{stream_id:1,_server:'beta',category_id:1,name:'General'}]);
 await put(store,categoriesKey,[{category_id:1,_server:'alpha',category_name:'General'},{category_id:2,_server:'alpha',category_name:'Adults'},{category_id:1,_server:'beta',category_name:'Adults'}]);
 return store;
};

const store=await fixture(),gate=deferred();store.gate=gate;
const one=inspectCatalog(store,request),two=inspectCatalog(store,{...request,id:'2'}),three=inspectCatalog(store,{...request,server:'beta'});
await turn();const blockedReads=store.payloadReads;gate.resolve();
const responses=await Promise.all([one,two,three]);
assert.deepEqual(await responses[0].json(),{found:true,adult:false});
assert.deepEqual(await responses[1].json(),{found:true,adult:true});
assert.deepEqual(await responses[2].json(),{found:true,adult:true});
assert.equal(blockedReads,2,'concurrent checks of one generation must load titles/categories only once, not once per request');
assert.deepEqual(await (await inspectCatalog(store,{...request,id:'999'})).json(),{found:false,adult:false});
assert.equal(store.payloadReads,2,'completed index is reused without another snapshot load');
console.log('PASS: three concurrent permission checks share two snapshot reads instead of six; decisions remain per resource/provider.');

// Generations are part of the shared-work key. A refresh must never join an
// older build, and completing that build later cannot replace the new result.
{
 const store=await fixture(),oldGate=deferred(),newGate=deferred();store.gate=oldGate;
 const old=inspectCatalog(store,request);await turn();
 await put(store,categoriesKey,[{category_id:1,_server:'alpha',category_name:'Adults'}]);
 store.gate=newGate;const current=inspectCatalog(store,request);await turn();
 assert.equal(store.payloadReads,4,'a new category generation starts an independent build');
 newGate.resolve();assert.deepEqual(await (await current).json(),{found:true,adult:true});
 oldGate.resolve();assert.deepEqual(await (await old).json(),{found:true,adult:false});
 assert.deepEqual(await (await inspectCatalog(store,request)).json(),{found:true,adult:true});
 assert.equal(store.payloadReads,4);
}

// A failed or incomplete shared build is not retained and never grants access.
{
 const store=await fixture(),gate=deferred();store.gate=gate;
 const pending=[inspectCatalog(store,request),inspectCatalog(store,request)];await turn();
 gate.reject(Error('synthetic_storage_failure'));
 const failed=await Promise.allSettled(pending);assert.ok(failed.every(x=>x.status==='rejected'));
 assert.equal(store.payloadReads,2);store.gate=null;
 assert.deepEqual(await (await inspectCatalog(store,request)).json(),{found:true,adult:false});
 assert.equal(store.payloadReads,4,'failed work is removed so a later request can rebuild');
 const incomplete=await fixture(),index=incomplete.data.get('catalog-cache-index');
 const chunk=`catalog-cache:${rowsKey}:${index[rowsKey].generation}:0`,saved=incomplete.data.get(chunk);incomplete.data.delete(chunk);
 assert.equal((await inspectCatalog(incomplete,request)).status,404);
 incomplete.data.set(chunk,saved);
 assert.deepEqual(await (await inspectCatalog(incomplete,request)).json(),{found:true,adult:false});
 assert.equal(incomplete.payloadReads,4,'an incomplete snapshot is not a cached permission decision');
}

// Abandoning one consumer must not cancel another consumer's shared build.
{
 const store=await fixture(),gate=deferred();store.gate=gate;
 const controller=new AbortController(),first=inspectCatalog(store,request);
 const abandoned=Promise.race([first,new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}))]);
 const other=inspectCatalog(store,{...request,id:'2'});await turn();
 controller.abort();await assert.rejects(abandoned,/cancelled/);assert.equal(store.payloadReads,2);
 gate.resolve();assert.deepEqual(await (await other).json(),{found:true,adult:true});
 await (await first).body?.cancel();
}

// Current freshness, input validation and store isolation still precede reuse.
{
 const store=await fixture();await inspectCatalog(store,request);
 const reads=store.payloadReads,now=Date.now;Date.now=()=>now()+300001;
 try{assert.equal((await inspectCatalog(store,request)).status,404);}finally{Date.now=now;}
 assert.equal(store.payloadReads,reads);
 assert.equal((await inspectCatalog(store,{...request,rowKeys:['invalid']})).status,400);
 const other=await fixture();await inspectCatalog(other,request);assert.equal(other.payloadReads,2,'another store cannot reuse this store index');
 assert.deepEqual(await (await inspectCatalog(other,{...request,idField:'series_id'})).json(),{found:false,adult:false});
 assert.equal(other.payloadReads,4,'different ID fields never share decisions');
}

// Sharing must not turn one stalled builder into a persistent head-of-line
// block. A later request can recover after the short sharing window without
// cancelling the original caller or changing the stored generation/expiry.
{
 const store=await fixture(),gate=deferred(),clock=Date.now,base=clock();store.gate=gate;
 Date.now=()=>base;
 try{
  const original=inspectCatalog(store,request);await turn();assert.equal(store.payloadReads,2);
  Date.now=()=>base+501;store.gate=null;
  assert.deepEqual(await (await inspectCatalog(store,request)).json(),{found:true,adult:false});
  assert.equal(store.payloadReads,4);
  gate.resolve();assert.deepEqual(await (await original).json(),{found:true,adult:false});
  assert.deepEqual(await (await inspectCatalog(store,request)).json(),{found:true,adult:false});
  assert.equal(store.payloadReads,4,'a late builder does not invalidate the completed index');
 }finally{Date.now=clock;gate.resolve();}
}

// At most sixteen unique builds are tracked. Overflow follows the previous
// build path without blocking unrelated generations or adding a global queue.
{
 const store=await fixture(),keys=Array.from({length:17},(_,i)=>(i+1).toString(16).padStart(64,'0'));
 for(const key of keys)await put(store,key,[{stream_id:1,_server:'alpha',category_id:1,name:'General'}]);
 const gate=deferred();store.gate=gate;
 const pending=keys.map(key=>inspectCatalog(store,{...request,rowKeys:[key]}));await turn();
 assert.equal(store.payloadReads,34);
 pending.push(inspectCatalog(store,{...request,rowKeys:[keys[0]]}),inspectCatalog(store,{...request,rowKeys:[keys[16]]}));await turn();
 assert.equal(store.payloadReads,36,'tracked work is shared; the seventeenth build does not grow the pending map');
 gate.resolve();for(const response of await Promise.all(pending))assert.deepEqual(await response.json(),{found:true,adult:false});
}
console.log('PASS: generation invalidation, failed/incomplete build cleanup, abandoned/stalled consumer recovery, freshness, validation, store/ID-field isolation and bounded pending work.');
