import test from 'node:test';
import assert from 'node:assert/strict';
import {runOwnedMediaMigration,ownedMediaMigrationStatus} from '../src/owned-media-migration.mjs';
import {EMPRESS_SERIES_ID,EMPRESS_SERIES_META,EMPRESS_EPISODES} from '../src/empress-catalog.mjs';
import {exclusiveSnapshot,exportExclusives,validExclusiveBackup} from '../src/exclusive-catalog.mjs';
import {isOwnedMediaSeries,OWNED_MEDIA_UNTIL} from '../src/owned-media-source.mjs';
const original={...EMPRESS_SERIES_META,type:'series',source:'PELISFLIX / TUDORAMA',mode:'gnula',visible:true,adult:false,episodes:structuredClone(EMPRESS_EPISODES),revision:5,playbackRevision:3,profileServer:'exclusive',createdAt:1,updatedAt:2};
class Store{
 constructor(row=original){this.data=new Map([['exclusive:index',{revision:7,ids:[row.id],updatedAt:1}],['exclusive:item:'+row.id,structuredClone(row)]]);this.queue=Promise.resolve();}
 async get(key){return structuredClone(this.data.get(key));}async put(key,value){this.data.set(key,structuredClone(value));}async delete(key){this.data.delete(key);}async list({prefix}){return new Map([...this.data].filter(([key])=>key.startsWith(prefix)));}
 transaction(fn){const value=this.queue.then(()=>fn(this));this.queue=value.catch(()=>{});return value;}
}
const env={ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true',SNAP_OWNED_MEDIA_SITE_TOKEN:'fixture-owned-site-secret-0123456789012345'};
const leaseList=[{exclusiveParentId:EMPRESS_SERIES_ID,playbackRevision:3},{exclusiveParentId:'other',playbackRevision:3}];
const leases={in:()=>({removeMatching:async predicate=>{for(let i=leaseList.length-1;i>=0;i--)if(predicate(leaseList[i]))leaseList.splice(i,1);}})};
test('migration gates all eight copies and preserves identities, owner metadata and valid backup',async()=>{
 const store=new Store({...original,name:'Título del propietario',plot:'Sinopsis editada',poster:original.poster});let probes=0;
 const probe=async()=>{probes++;return{ready:true}};
 await Promise.all([runOwnedMediaMigration(store,leases,env,{now:()=>Date.parse('2026-11-04T19:00:00Z'),probe}),runOwnedMediaMigration(store,leases,env,{now:()=>Date.parse('2026-11-04T19:00:00Z'),probe})]);
 const row=(await exclusiveSnapshot(store)).items.find(row=>row.id===EMPRESS_SERIES_ID);
 assert.equal(probes,1);assert.equal(isOwnedMediaSeries(row),true);assert.equal(row.revision,6);assert.equal(row.playbackRevision,4);assert.equal(row.name,'Título del propietario');assert.equal(row.plot,'Sinopsis editada');assert.equal(row.profileServer,original.profileServer);
 assert.deepEqual(row.episodes.flatMap(ep=>[ep.id,...ep.alternatives.map(option=>option.id)]),original.episodes.flatMap(ep=>[ep.id,...ep.alternatives.map(option=>option.id)]));
 assert.equal((await ownedMediaMigrationStatus(store)).state,'completed');assert.equal(validExclusiveBackup(await exportExclusives(store)),true);assert.deepEqual(leaseList,[{exclusiveParentId:'other',playbackRevision:3}]);
 await runOwnedMediaMigration(store,leases,env,{now:()=>Date.parse('2026-11-04T19:00:00Z'),probe:()=>{throw new Error('no repeated import');}});
});
test('hidden series remains hidden',async()=>{
 const store=new Store({...original,visible:false});await runOwnedMediaMigration(store,leases,env,{now:()=>Date.parse('2026-11-04T19:00:00Z'),probe:async()=>({ready:true})});assert.equal((await store.get('exclusive:item:'+EMPRESS_SERIES_ID)).visible,false);
});
test('missing copies produce finite retries with no partial catalog changes',async()=>{
 const store=new Store();let calls=0;
 for(let i=0;i<4;i++)await runOwnedMediaMigration(store,leases,env,{now:()=>Date.parse('2026-11-04T19:00:00Z'),probe:async()=>{calls++;return{ready:false}}});
 assert.equal(calls,3);assert.equal((await ownedMediaMigrationStatus(store)).state,'failed');assert.deepEqual(await store.get('exclusive:item:'+EMPRESS_SERIES_ID),original);
});
test('concurrent owner edit wins and disables this import',async()=>{
 const store=new Store();await runOwnedMediaMigration(store,leases,env,{now:()=>Date.parse('2026-11-04T19:00:00Z'),probe:async()=>{await store.put('exclusive:item:'+EMPRESS_SERIES_ID,{...original,revision:6,name:'Cambio reciente'});return{ready:true}}});assert.equal((await ownedMediaMigrationStatus(store)).reason,'catalog_changed');assert.equal((await store.get('exclusive:item:'+EMPRESS_SERIES_ID)).name,'Cambio reciente');
});
test('different sources, staging, missing credential and expired trial cannot migrate',async()=>{
 const changed=structuredClone(original);changed.episodes[0].page='https://media.snapcdn.net/manual.mp4';const store=new Store(changed);
 await runOwnedMediaMigration(store,leases,env,{now:()=>Date.parse('2026-11-04T19:00:00Z'),probe:()=>{throw new Error('not a reviewed source');}});assert.equal((await ownedMediaMigrationStatus(store)).reason,'catalog_requires_review');
 for(const config of [{...env,ENVIRONMENT:'staging'},{...env,SNAP_OWNED_MEDIA_SITE_TOKEN:''}]){const untouched=new Store();await runOwnedMediaMigration(untouched,leases,config,{probe:()=>{throw new Error('disabled');}});assert.equal((await ownedMediaMigrationStatus(untouched)).state,'pending');}
 const expired=new Store();await runOwnedMediaMigration(expired,leases,env,{now:()=>OWNED_MEDIA_UNTIL,probe:()=>{throw new Error('expired');}});assert.equal((await ownedMediaMigrationStatus(expired)).state,'pending');
});
