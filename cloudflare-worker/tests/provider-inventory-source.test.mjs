import test from 'node:test';
import assert from 'node:assert/strict';
import {INVENTORY_MAX_AGE_MS,mergeInventories,readInventoryPool} from '../src/provider-inventory.mjs';

const now=Date.UTC(2026,10,16,12),line=(id,key=id,extra={})=>({id,key,server:'ccf',maxConnections:3,external:0,encrypted:'synthetic-'+id,...extra});
const snapshot=(lines,extra={})=>({lines,syncedAt:now-1000,...extra});
function storeFor(values){const calls=[];return {calls,async get(key){calls.push(key);return structuredClone(values[key]);}};}

test('shared provider credentials retain every fresh source without duplicating capacity',()=>{
 const a=line('source-a-id','shared',{maxConnections:3,external:1,sourceIds:['forged-source']}),b=line('source-b-id','shared',{maxConnections:2,external:2});
 const pools={'panel:z':snapshot([a,line('only-z')]),'panel:a':snapshot([b,b]),'panel:other':snapshot([line('only-other')])},before=structuredClone(pools),merged=mergeInventories(pools,now);
 assert.equal(merged.lines.length,3);const shared=merged.lines.find(row=>row.key==='shared');
 assert.equal(shared.id,a.id);assert.equal(shared.maxConnections,2);assert.equal(shared.external,2);assert.deepEqual(shared.sourceIds,['panel:a','panel:z']);
 assert.deepEqual(merged.lines.find(row=>row.id==='only-z').sourceIds,['panel:z']);assert.deepEqual(merged.lines.find(row=>row.id==='only-other').sourceIds,['panel:other']);
 assert.deepEqual(pools,before,'merging must not decorate the retained original source snapshots');
});

test('membership expires with its source timestamp and a failed attempt cannot extend it',()=>{
 const pools={old:snapshot([line('old','shared')],{syncedAt:now-INVENTORY_MAX_AGE_MS,attemptedAt:now}),fresh:snapshot([line('fresh','shared')],{syncedAt:now-50})};
 const merged=mergeInventories(pools,now);assert.equal(merged.lines.length,1);assert.equal(merged.lines[0].id,'fresh');assert.deepEqual(merged.lines[0].sourceIds,['fresh']);assert.equal(merged.syncedAt,now-50);
 const oldOnly=mergeInventories({old:pools.old},now);assert.deepEqual(oldOnly.lines,[]);assert.equal(oldOnly.syncedAt,pools.old.syncedAt);assert.equal(oldOnly.attemptedAt,now);
});

test('a legacy aggregate repairs source membership without changing its freshness or writing state',async()=>{
 const pools={a:snapshot([line('a','shared')],{syncedAt:now-2000}),b:snapshot([line('b','shared')])},old={lines:[line('a','shared')],syncedAt:now-2000,attemptedAt:now-1000,sourceBacked:true},values={pool:old,'source-pools':pools},before=structuredClone(values),store=storeFor(values);
 const repaired=await readInventoryPool(store,now);assert.deepEqual(repaired.lines[0].sourceIds,['a','b']);assert.equal(repaired.syncedAt,old.syncedAt);assert.equal(repaired.attemptedAt,now-2000);assert.deepEqual(store.calls,['pool','source-pools']);assert.deepEqual(values,before);
});

test('current aggregates read only the pool, while unlabelled direct pools retain legacy behavior',async()=>{
 const pool=mergeInventories({a:snapshot([line('a')])},now),store=storeFor({pool,'source-pools':null});
 assert.deepEqual(await readInventoryPool(store,now),pool);assert.deepEqual(store.calls,['pool']);
 const direct={lines:[line('direct')],syncedAt:now-1000,attemptedAt:now-1000},legacy=storeFor({pool:direct});assert.deepEqual(await readInventoryPool(legacy,now),direct);assert.deepEqual(legacy.calls,['pool']);
});

test('aggregate expiry rebuild removes only the expired source membership',async()=>{
 const pools={old:snapshot([line('a','shared')],{syncedAt:now-INVENTORY_MAX_AGE_MS+10}),fresh:snapshot([line('b','shared')])},pool=mergeInventories(pools,now),store=storeFor({pool,'source-pools':pools});
 assert.deepEqual(pool.lines[0].sourceIds,['fresh','old']);const refreshed=await readInventoryPool(store,now+11);assert.deepEqual(refreshed.lines[0].sourceIds,['fresh']);assert.equal(refreshed.lines[0].id,'b');assert.equal(refreshed.syncedAt,pools.fresh.syncedAt);assert.deepEqual(store.calls,['pool','source-pools']);
});

test('missing or invalid membership can be repaired, and missing retained sources stay unknown',async()=>{
 for(const sourceIds of [undefined,[],[null]]){const pool={lines:[line('a','a',{sourceIds})],syncedAt:now-1000,attemptedAt:now-1000,sourceBacked:true},store=storeFor({pool,'source-pools':{a:snapshot([line('a')])}});assert.deepEqual((await readInventoryPool(store,now)).lines[0].sourceIds,['a']);}
 const pool={lines:[line('a')],syncedAt:now-1000,attemptedAt:now-1000,sourceBacked:true},store=storeFor({pool});assert.deepEqual(await readInventoryPool(store,now),pool);assert.deepEqual(store.calls,['pool','source-pools']);
});
