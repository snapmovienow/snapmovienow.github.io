import assert from 'node:assert/strict';
import {runYagaImport,yagaImportStatus,YAGA_IMPORT} from '../src/yaga-import.mjs';
import {exclusiveSnapshot} from '../src/exclusive-catalog.mjs';
class Store{
 constructor(rows=[]){this.data=new Map([['exclusive:index',{revision:1,ids:rows.map(r=>r.id),updatedAt:1}],...rows.map(r=>['exclusive:item:'+r.id,structuredClone(r)])]);this.queue=Promise.resolve();}
 async get(k){return structuredClone(this.data.get(k));}async put(k,v){this.data.set(k,structuredClone(v));}async delete(k){this.data.delete(k);}
 transaction(fn){const result=this.queue.then(async()=>{const old=structuredClone(this.data);try{return await fn(this)}catch(e){this.data=old;throw e}});this.queue=result.catch(()=>{});return result;}
}
const env={ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true'},revoked=[];
const leases={in(){return {async removeMatching(filter){revoked.push(filter);}}}};
let calls=0;const good=async()=>{calls++;return {ok:true,check:'playlist_and_segment'}};
const rows=async s=>(await exclusiveSnapshot(s)).items;
let store=new Store();await runYagaImport(store,leases,env,{probe:good});
let report=await yagaImportStatus(store),catalog=await rows(store),saved=catalog[0];
assert.equal(report.state,'completed');assert.equal(catalog.length,1);assert.equal(saved.name,'YAGA (2026)');assert.equal(saved.visible,true);assert.equal(saved.year,2026);
assert.deepEqual(saved.episodes.map(ep=>[ep.season,ep.episode_num]),[[1,1],[1,2]]);assert.ok(saved.episodes.every(ep=>ep.page.startsWith('https://pelisflix200.city/episodio/yaga-1x')));
assert.ok(!JSON.stringify(report).includes('https://'),'the public report contains no upstream URLs');assert.ok(report.results.every(r=>r.status==='added'));
const revision=saved.revision,initialCalls=calls;await runYagaImport(store,leases,env,{probe:good});assert.equal(calls,initialCalls);assert.equal((await rows(store))[0].revision,revision);
await store.put('exclusive:item:'+saved.id,{...saved,visible:false,revision:revision+1});await runYagaImport(store,leases,env,{probe:good});assert.equal((await rows(store))[0].visible,false,'a completed import cannot reactivate a later manual hide');

const existing={...saved,id:'owner-yaga-series',name:'Yaga',poster:'https://images.snapcdn.net/owner-cover.jpg',plot:'Descripción del propietario',createdAt:17,episodes:[{id:'owner-yaga-ep1',season:1,episode_num:1,title:'Título elegido por el propietario',page:'https://www2.gnula.one/episode/existing-yaga/'},{id:'owner-yaga-ep3',season:1,episode_num:3,title:'Tres',page:'https://www2.gnula.one/episode/three/'}]};
store=new Store([existing]);await store.put('profile:favorite',{id:existing.id});await runYagaImport(store,leases,env,{probe:good});
saved=(await rows(store))[0];assert.equal(saved.id,existing.id);assert.equal(saved.poster,existing.poster);assert.equal(saved.plot,existing.plot);assert.equal(saved.createdAt,17);assert.equal(saved.episodes[0].id,'owner-yaga-ep1');assert.equal(saved.episodes[0].page,existing.episodes[0].page);assert.equal(saved.episodes[0].title,existing.episodes[0].title);assert.equal(saved.episodes.length,3);assert.deepEqual(await store.get('profile:favorite'),{id:existing.id});
assert.equal((await yagaImportStatus(store)).results[0].status,'online');

store=new Store([existing]);await runYagaImport(store,leases,env,{probe:async media=>({ok:!media.page.includes('existing-yaga')})});saved=(await rows(store))[0];assert.equal(saved.episodes[0].id,'owner-yaga-ep1');assert.equal(saved.episodes[0].page,'https://pelisflix200.city/episodio/yaga-1x1/');assert.equal((await yagaImportStatus(store)).results[0].status,'repaired');assert.ok(revoked.length>0);

store=new Store();let clock=1000;
for(let n=0;n<3;n++){await runYagaImport(store,leases,env,{now:()=>clock,probe:async()=>({ok:false})});clock+=300000;assert.equal((await rows(store)).length,0,'unavailable media cannot publish a partial series');}
assert.equal((await yagaImportStatus(store)).state,'failed');calls=0;await runYagaImport(store,leases,env,{probe:good});assert.equal(calls,0,'source failures have a finite retry budget');

store=new Store([existing,{...existing,id:'duplicate-yaga'}]);calls=0;await runYagaImport(store,leases,env,{probe:good});assert.equal(calls,0);assert.equal((await yagaImportStatus(store)).reason,'duplicate_series');assert.equal((await rows(store)).length,2);
store=new Store([{...existing,id:YAGA_IMPORT.id,name:'Otra serie',year:2025}]);await runYagaImport(store,leases,env,{probe:good});assert.equal((await yagaImportStatus(store)).reason,'identity_conflict');

store=new Store([existing]);let changed=false;
await runYagaImport(store,leases,env,{probe:async()=>{if(!changed){changed=true;await store.transaction(tx=>tx.put('exclusive:item:'+existing.id,{...existing,revision:existing.revision+1,plot:'Edición manual concurrente'}));}return {ok:true};}});
assert.equal((await yagaImportStatus(store)).reason,'catalog_changed');assert.equal((await rows(store))[0].plot,'Edición manual concurrente');assert.equal((await rows(store))[0].episodes.length,2);

store=new Store();calls=0;await Promise.all([runYagaImport(store,leases,env,{probe:good}),runYagaImport(store,leases,env,{probe:good})]);assert.equal(calls,2);assert.equal((await rows(store)).length,1);assert.equal((await yagaImportStatus(store)).attempts,1);
store=new Store();calls=0;await runYagaImport(store,leases,{...env,ENVIRONMENT:'staging'},{probe:good});await runYagaImport(store,leases,{...env,CATALOG_MAINTENANCE_ENABLED:'false'},{probe:good});assert.equal(calls,0);assert.equal((await rows(store)).length,0);
console.log('PASS: one-time private YAGA import, all-episode media gate, stable IDs/covers/history, healthy-source preservation, repairs, finite retries, conflict/duplicate protection, concurrency and staging isolation.');
