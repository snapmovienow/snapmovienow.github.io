import assert from 'node:assert/strict';
import {EMPRESS_SERIES_ID,EMPRESS_SERIES_META,EMPRESS_EPISODES} from '../src/empress-catalog.mjs';
import {runEmpressImport,empressImportStatus,EMPRESS_IMPORT_REQUEST} from '../src/empress-import.mjs';
import {exclusiveSnapshot,exclusiveCatalogRoute,selectExclusive,exportExclusives,validExclusiveBackup,restoreExclusives} from '../src/exclusive-catalog.mjs';

class Store{
 constructor(rows=[]){this.data=new Map([['exclusive:index',{revision:1,ids:rows.map(row=>row.id),updatedAt:1}],...rows.map(row=>['exclusive:item:'+row.id,structuredClone(row)])]);this.queue=Promise.resolve();}
 async get(k){return structuredClone(this.data.get(k));}async put(k,v){this.data.set(k,structuredClone(v));}async delete(k){this.data.delete(k);}
 async list({prefix}){return new Map([...this.data].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key,structuredClone(value)]));}
 transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p;}
}
const env={ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true'},leases={};
let calls=0,active=0,maximum=0;
const good=async media=>{calls++;active++;maximum=Math.max(maximum,active);assert.equal(media.mode,'gnula');await new Promise(resolve=>setImmediate(resolve));active--;return {ok:true,check:'playlist_and_segment'};};
let store=new Store();await Promise.all([runEmpressImport(store,leases,env,{probe:good}),runEmpressImport(store,leases,env,{probe:good})]);
const report=await empressImportStatus(store),rows=(await exclusiveSnapshot(store)).items,row=rows[0];
assert.equal(calls,8);assert.ok(maximum<=2);assert.equal(report.requestId,EMPRESS_IMPORT_REQUEST);assert.equal(report.state,'completed');assert.equal(report.attempts,1);assert.equal(report.seriesId,EMPRESS_SERIES_ID);assert.equal(report.results.length,8);assert.ok(report.results.every(r=>r.status==='added'&&r.check==='playlist_and_segment'));assert.ok(!JSON.stringify(report).includes('https://'));
assert.equal(rows.length,1);assert.equal(row.episodes.length,4);assert.equal(row.poster,EMPRESS_SERIES_META.poster);
for(const ep of row.episodes){
 assert.equal(ep.alternatives.length,1);assert.ok(ep.plot&&ep.poster&&ep.durationSeconds);assert.equal(selectExclusive(rows,ep.id).row.id,row.id);
 const alternate=selectExclusive(rows,ep.alternatives[0].id);assert.equal(alternate.row.id,row.id);assert.equal(alternate.media.episode_num,ep.episode_num);assert.equal(alternate.media.season,1);assert.equal(alternate.media.page,ep.alternatives[0].page);assert.equal(alternate.media.type,'series');
}
const backup=await exportExclusives(store);assert.equal(validExclusiveBackup(backup),true);const restored=new Store();await restoreExclusives(restored,backup);assert.deepEqual((await exclusiveSnapshot(restored)).items,rows);
const forged=structuredClone(backup);forged.items[0].episodes[1].alternatives[0].id=forged.items[0].episodes[0].id;assert.equal(validExclusiveBackup(forged),false);
const collision={...row,id:'other-series',name:'Other series',episodes:[{...row.episodes[0],id:'other-ep',alternatives:[{...row.episodes[0].alternatives[0]}]}]};assert.equal((await exclusiveCatalogRoute(store,'/exclusive-save',{item:collision,revision:0,actor:'fixture'})).status,409,'an alternative ID cannot be attached to a different series');
const unsafe=structuredClone(row);unsafe.episodes[0].alternatives[0].page='https://127.0.0.1/private';assert.equal((await exclusiveCatalogRoute(store,'/exclusive-save',{item:unsafe,revision:row.revision,actor:'fixture'})).status,400);
const invalid=structuredClone(row);invalid.episodes[0].alternatives.push({...invalid.episodes[0].alternatives[0],id:'extra-choice'});assert.equal((await exclusiveCatalogRoute(store,'/exclusive-save',{item:invalid,revision:row.revision,actor:'fixture'})).status,400);
const hidden={...row,visible:false,name:'Owner title',plot:'Owner edit'};store=new Store([hidden]);await runEmpressImport(store,leases,env,{probe:()=>{throw Error('manual entry must not trigger probes');}});assert.deepEqual(await store.get('exclusive:item:'+row.id),hidden);assert.equal((await empressImportStatus(store)).reason,'existing_preserved');assert.equal((await empressImportStatus(store)).visible,false);
store=new Store([{...row,id:'existing-manual-empress'}]);await runEmpressImport(store,leases,env,{probe:good});assert.equal((await empressImportStatus(store)).state,'failed');assert.equal((await empressImportStatus(store)).reason,'existing_identity_needs_review');assert.equal((await exclusiveSnapshot(store)).items.length,1);
store=new Store();let badCalls=0;for(let n=0;n<4;n++)await runEmpressImport(store,leases,env,{probe:async media=>{badCalls++;return {ok:media.page!==EMPRESS_EPISODES[2].alternatives[0].page};}});assert.equal(badCalls,24);assert.equal((await empressImportStatus(store)).state,'failed');assert.equal((await empressImportStatus(store)).attempts,3);assert.equal((await exclusiveSnapshot(store)).items.length,0,'a missing source prevents partial publication');
store=new Store();let inserted=false;await runEmpressImport(store,leases,env,{probe:async()=>{if(!inserted){inserted=true;await store.put('exclusive:item:'+hidden.id,hidden);await store.put('exclusive:index',{revision:2,ids:[hidden.id],updatedAt:2});}return {ok:true};}});assert.equal((await empressImportStatus(store)).reason,'catalog_changed');assert.deepEqual(await store.get('exclusive:item:'+hidden.id),hidden);
for(const config of [{...env,ENVIRONMENT:'staging'},{...env,CATALOG_MAINTENANCE_ENABLED:'false'}]){store=new Store();await runEmpressImport(store,leases,config,{probe:()=>{throw Error('disabled publication');}});assert.equal((await empressImportStatus(store)).state,'pending');}
console.log('PASS: all-eight-source publication gate, bounded single concurrent claim, four canonical episodes/options, alternative identity and parent scope, backups, manual hide/edit preservation, no partial publish, finite retries and staging isolation.');
