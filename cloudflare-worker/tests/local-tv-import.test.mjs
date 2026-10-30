import assert from 'node:assert/strict';
import {runLocalTvImport,localTvImportStatus,runLocalTvExpansion,localTvExpansionStatus} from '../src/local-tv-import.mjs';
import {OFFICIAL_CHANNELS,EXTRA_OFFICIAL_CHANNELS} from '../src/official-live.mjs';
import {exclusiveSnapshot} from '../src/exclusive-catalog.mjs';
class Store{
 constructor(rows=[]){this.data=new Map([['exclusive:index',{revision:1,ids:rows.map(r=>r.id),updatedAt:1}],...rows.map(r=>['exclusive:item:'+r.id,structuredClone(r)])]);this.queue=Promise.resolve();}
 async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}
 transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p;}
}
const env={ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true'},leases={},good=async()=>({ok:true});let store=new Store(),calls=0;
await Promise.all([runLocalTvImport(store,leases,env,{probe:async()=>{calls++;return {ok:true}}}),runLocalTvImport(store,leases,env,{probe:good})]);
assert.equal(calls,4);let report=await localTvImportStatus(store),rows=(await exclusiveSnapshot(store)).items;assert.equal(report.state,'completed');assert.equal(rows.length,4);assert.ok(report.results.every(r=>r.status==='added'));assert.ok(!JSON.stringify(report).includes('https://'));
const saved=rows[0];await store.put('exclusive:item:'+saved.id,{...saved,visible:false,revision:saved.revision+1});await runLocalTvImport(store,leases,env,{probe:good});assert.equal((await store.get('exclusive:item:'+saved.id)).visible,false,'completed jobs cannot reactivate manually hidden channels');
store=new Store();for(let n=0;n<3;n++)await runLocalTvImport(store,leases,env,{probe:async m=>({ok:m.page===OFFICIAL_CHANNELS[3].page})});
assert.equal((await exclusiveSnapshot(store)).items.length,1);report=await localTvImportStatus(store);assert.equal(report.state,'completed');assert.equal(report.results.filter(r=>r.status==='unavailable').length,3);assert.equal(report.attempts,3);
store=new Store([{...saved,visible:false,plot:'Owner edit'}]);await runLocalTvImport(store,leases,env,{probe:good});assert.equal((await store.get('exclusive:item:'+saved.id)).visible,false);assert.equal((await store.get('exclusive:item:'+saved.id)).plot,'Owner edit');assert.equal((await localTvImportStatus(store)).results[0].status,'existing_preserved');
store=new Store();let changed=false;await runLocalTvImport(store,leases,env,{probe:async()=>{if(!changed){changed=true;await store.put('exclusive:item:'+saved.id,{...saved,plot:'Concurrent owner edit'});const index=await store.get('exclusive:index');index.ids.push(saved.id);await store.put('exclusive:index',index);}return {ok:true}}});assert.equal((await store.get('exclusive:item:'+saved.id)).plot,'Concurrent owner edit');assert.equal((await localTvImportStatus(store)).results[0].status,'catalog_changed');
store=new Store();calls=0;await runLocalTvImport(store,leases,{...env,ENVIRONMENT:'staging'},{probe:async()=>{calls++;return {ok:true}}});assert.equal(calls,0);assert.equal((await exclusiveSnapshot(store)).items.length,0);
console.log('PASS: finite private local TV import, partial publication only after media checks, no reactivation, conflict protection and staging isolation.');
store=new Store(rows);const original=await exclusiveSnapshot(store);await runLocalTvImport(store,leases,env,{probe:good});const originalReport=await localTvImportStatus(store);
await Promise.all([runLocalTvExpansion(store,leases,env,{probe:good}),runLocalTvExpansion(store,leases,env,{probe:good})]);
assert.deepEqual(await localTvImportStatus(store),originalReport,'expansion never resets the completed original import');
assert.equal((await localTvExpansionStatus(store)).state,'completed');assert.equal((await localTvExpansionStatus(store)).results.filter(r=>r.status==='added').length,EXTRA_OFFICIAL_CHANNELS.length);
assert.equal((await exclusiveSnapshot(store)).items.length,8);for(const old of original.items)assert.deepEqual(await store.get('exclusive:item:'+old.id),old,'existing records keep metadata and visibility');
const extra=await store.get('exclusive:item:'+EXTRA_OFFICIAL_CHANNELS[0].id);await store.put('exclusive:item:'+extra.id,{...extra,visible:false});await runLocalTvExpansion(store,leases,env,{probe:good});assert.equal((await store.get('exclusive:item:'+extra.id)).visible,false);
const stage=new Store();await runLocalTvExpansion(stage,leases,{...env,ENVIRONMENT:'staging'},{probe:good});assert.equal((await exclusiveSnapshot(stage)).items.length,0);
console.log('PASS: isolated finite expansion adds only verified extra stations and preserves original import, manual hides, metadata, concurrency and staging isolation.');
