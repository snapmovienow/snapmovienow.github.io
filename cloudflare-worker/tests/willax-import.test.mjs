import assert from 'node:assert/strict';
import {WILLAX_CHANNEL as channel,WILLAX_FOLDER} from '../src/willax-live.mjs';
import {runWillaxImport,willaxImportStatus,WILLAX_REQUEST} from '../src/willax-import.mjs';
import {exclusiveSnapshot} from '../src/exclusive-catalog.mjs';
import {readChannelUsage,usageChannel} from '../src/channel-usage.mjs';
import {ALL_TV_CHANNELS} from '../src/official-live.mjs';
import {PUBLIC_TV_CHANNELS} from '../src/public-tv-channels.mjs';
import {localTvXtreamStatus} from '../src/local-tv-xtream.mjs';

class Store{
 constructor(rows=[]){this.data=new Map([['exclusive:index',{revision:1,ids:rows.map(r=>r.id),updatedAt:1}],...rows.map(r=>['exclusive:item:'+r.id,structuredClone(r)])]);this.queue=Promise.resolve();}
 async get(k){return structuredClone(this.data.get(k));}async put(k,v){this.data.set(k,structuredClone(v));}async delete(k){this.data.delete(k);}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)));}
 transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p;}
}
const env={ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true'};
assert.equal(PUBLIC_TV_CHANNELS.length,20,'original public-channel import remains unchanged');
assert.equal(channel.id,'public-willax-peru');assert.equal(channel.xtreamId,'2000023');assert.equal(channel.adapter,'willax-public');assert.equal(channel.page,'https://willax.pe/en-vivo');
assert.equal(ALL_TV_CHANNELS.filter(c=>c.id===channel.id).length,1);assert.equal(new Set(ALL_TV_CHANNELS.map(c=>c.xtreamId).filter(Boolean)).size,ALL_TV_CHANNELS.map(c=>c.xtreamId).filter(Boolean).length);
assert.equal(WILLAX_FOLDER.key,'peru');assert.equal(WILLAX_FOLDER.upstreamId,'112');
let calls=0,store=new Store();
const probe=async media=>{calls++;assert.deepEqual(media,{mode:'gnula',page:channel.page});return {ok:true,check:'playlist_and_segment'};};
await Promise.all([runWillaxImport(store,{},env,{probe}),runWillaxImport(store,{},env,{probe})]);
let report=await willaxImportStatus(store),rows=(await exclusiveSnapshot(store)).items;
assert.equal(calls,1);assert.equal(report.requestId,WILLAX_REQUEST);assert.equal(report.state,'completed');assert.equal(report.attempts,1);assert.equal(report.results[0].status,'added');assert.equal(report.results[0].monitoring,true);assert.equal(report.results[0].visible,true);
assert.equal(rows.length,1);assert.equal(rows[0].mode,'gnula');assert.equal(rows[0].usageKind,'channel');assert.equal(rows[0].source,'WILLAX · señal alternativa');
assert.deepEqual(usageChannel(rows[0]).folders,['Perú']);
const usage=await(await readChannelUsage(store,null,{accountId:'willax-owner-test'},rows)).json();
assert.equal(usage.channels[0].id,channel.id);assert.deepEqual(usage.channels[0].folders,['Perú']);assert.equal(usage.channels[0].sessions,0,'panel includes the channel before its first playback');assert.equal(usage.channels[0].visible,true);
const health=await localTvXtreamStatus(store);assert.deepEqual(health.channels,[{id:channel.id,name:channel.name}]);assert.deepEqual(health.categories,[{name:'Perú',channels:[channel.id]}]);
const hidden={...rows[0],visible:false,name:'Owner custom Willax',plot:'Owner description'};
await store.put('exclusive:item:'+channel.id,hidden);await runWillaxImport(store,{},env,{probe:()=>{throw Error('completed import must not probe');}});assert.deepEqual(await store.get('exclusive:item:'+channel.id),hidden);
store=new Store([hidden]);await runWillaxImport(store,{},env,{probe:()=>{throw Error('existing import must not probe');}});assert.equal((await willaxImportStatus(store)).results[0].status,'existing_preserved');assert.deepEqual(await store.get('exclusive:item:'+channel.id),hidden);
const duplicate={...rows[0],id:'owner-existing-willax'};store=new Store([duplicate]);await runWillaxImport(store,{},env,{probe});assert.equal((await exclusiveSnapshot(store)).items.length,1);assert.equal((await willaxImportStatus(store)).results[0].status,'duplicate_preserved');assert.equal((await willaxImportStatus(store)).results[0].monitoring,false,'a duplicate with another identity is not claimed to be the integrated channel');
store=new Store();await runWillaxImport(store,{},env,{probe:async()=>{await store.put('exclusive:item:'+channel.id,hidden);await store.put('exclusive:index',{revision:2,ids:[channel.id],updatedAt:2});return {ok:true};}});assert.equal((await willaxImportStatus(store)).results[0].status,'catalog_changed');assert.deepEqual(await store.get('exclusive:item:'+channel.id),hidden);
store=new Store();let failures=0;for(let n=0;n<4;n++)await runWillaxImport(store,{},env,{probe:async()=>{failures++;return {ok:false};}});
report=await willaxImportStatus(store);assert.equal(report.state,'completed');assert.equal(report.attempts,3);assert.equal(failures,3);assert.equal(report.results[0].status,'unavailable');assert.equal(report.results[0].monitoring,false);assert.equal((await exclusiveSnapshot(store)).items.length,0);
assert.ok(!JSON.stringify(report).includes('https://'));assert.ok(!JSON.stringify(report).includes('190.93.224.42'));
const jobKey=[...store.data.keys()].find(key=>key.startsWith('catalog-import:willax-'));
await store.put(jobKey,{...(await store.get(jobKey)),state:'running',claimUntil:1});
await runWillaxImport(store,{},env,{probe:()=>{throw Error('an interrupted third attempt must not run a fourth probe');}});assert.equal((await willaxImportStatus(store)).state,'completed');assert.equal((await willaxImportStatus(store)).attempts,3);
for(const config of [{...env,ENVIRONMENT:'staging'},{...env,CATALOG_MAINTENANCE_ENABLED:'false'}]){store=new Store();await runWillaxImport(store,{},config,{probe:()=>{throw Error('disabled import');}});assert.equal((await willaxImportStatus(store)).state,'pending');}
console.log('PASS: finite private Willax import, concurrent deduplication, fixed identity, Peru monitoring before first use, manual edits/hides, unavailable retry cap and staging isolation.');
