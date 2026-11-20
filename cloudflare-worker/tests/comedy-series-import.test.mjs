import assert from 'node:assert/strict';
import {COMEDY_GNULA_EPISODES} from '../src/comedy-gnula-source.mjs';
import {COMEDY_SERIES_DEFINITIONS} from '../src/comedy-series-catalog.mjs';
import {runComedySeriesImport,comedySeriesImportStatus,COMEDY_SERIES_IMPORT_REQUEST} from '../src/comedy-series-import.mjs';
import {comedySeriesEntries} from '../src/comedy-series-xtream.mjs';
import {exclusiveSnapshot,exclusiveCatalogRoute,exportExclusives,validExclusiveBackup} from '../src/exclusive-catalog.mjs';

class Store{
 constructor(rows=[]){this.data=new Map([['exclusive:index',{revision:1,ids:rows.map(row=>row.id),updatedAt:1}],...rows.map(row=>['exclusive:item:'+row.id,structuredClone(row)])]);this.queue=Promise.resolve();}
 async get(key){return structuredClone(this.data.get(key));}
 async put(key,value){this.data.set(key,structuredClone(value));}
 async delete(key){this.data.delete(key);}
 async list({prefix}){return new Map([...this.data].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key,structuredClone(value)]));}
 transaction(fn){const operation=this.queue.then(()=>fn(this));this.queue=operation.catch(()=>{});return operation;}
}
const env={ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true',COMEDY_SERIES_IMPORT_ENABLED:'true'},now=()=>1000000,key='catalog-import:'+COMEDY_SERIES_IMPORT_REQUEST;
const leases=new Proxy({},{get(){throw Error('catalog probes must not allocate customer playback leases');}});
let calls=0,active=0,maximum=0;
const good=async media=>{calls++;active++;maximum=Math.max(maximum,active);assert.deepEqual(Object.keys(media).sort(),['mode','page']);assert.equal(media.mode,'gnula');assert.ok(COMEDY_GNULA_EPISODES.some(episode=>episode.page===media.page));await new Promise(resolve=>setImmediate(resolve));active--;return {ok:true,check:'playlist_and_segment'};};
let store=new Store();
const pending=await comedySeriesImportStatus(store);assert.equal(pending.state,'pending');assert.deepEqual(pending.series.map(row=>row.state),['pending','pending_source','blocked_subscription']);
await Promise.all([runComedySeriesImport(store,leases,env,{probe:good,now}),runComedySeriesImport(store,leases,env,{probe:good,now})]);
const report=await comedySeriesImportStatus(store),rows=(await exclusiveSnapshot(store)).items,row=rows[0];
assert.equal(calls,26);assert.equal(maximum,2);assert.equal(report.requestId,COMEDY_SERIES_IMPORT_REQUEST);assert.equal(report.state,'completed');assert.equal(report.attempts,1);assert.equal(report.results.length,26);assert.ok(report.results.every(result=>result.status==='added'&&result.check==='playlist_and_segment'));assert.equal(report.finishedAt,now());
assert.equal(rows.length,1);assert.equal(row.id,'comedy-muertos-sl');assert.equal(row.mode,'gnula');assert.equal(row.type,'series');assert.equal(row.episodes.length,26);assert.ok(row.poster);assert.ok(row.plot);assert.equal(row.visible,true);assert.equal(row.revision,1);
assert.deepEqual(row.episodes.map(episode=>[episode.season,episode.episode_num,episode.page]),COMEDY_GNULA_EPISODES.map(episode=>[episode.season,episode.episode,episode.page]));
assert.deepEqual(comedySeriesEntries(rows,{series:true,adults:false}).map(entry=>entry.definition.id),[row.id]);
assert.deepEqual(report.series.map(item=>item.state),['completed','pending_source','blocked_subscription']);assert.equal(rows.some(row=>row.id==='comedy-machos-alfa'||row.id==='comedy-cunados'),false);
assert.equal(validExclusiveBackup(await exportExclusives(store)),true);
assert.equal(JSON.stringify(report).includes('https://'),false);assert.equal(JSON.stringify(report).includes('claim'),false);assert.equal(JSON.stringify(row).includes('/e/'),false,'temporary player bindings are not stored in the catalogue');
await runComedySeriesImport(store,leases,env,{probe:()=>{throw Error('terminal jobs must not probe');},now});assert.equal((await exclusiveSnapshot(store)).items.length,1);

// Owner saves, edits and hides are preserved without making remote requests.
const hidden={...row,name:'Edición del propietario',plot:'No modificar',visible:false};store=new Store([hidden]);
await runComedySeriesImport(store,leases,env,{probe:()=>{throw Error('manual entries must not probe');},now});
assert.deepEqual(await store.get('exclusive:item:'+row.id),hidden);assert.equal((await comedySeriesImportStatus(store)).reason,'existing_preserved');assert.equal((await comedySeriesImportStatus(store)).visible,false);
store=new Store([{...row,id:'manual-muertos'}]);await runComedySeriesImport(store,leases,env,{probe:good,now});assert.equal((await comedySeriesImportStatus(store)).reason,'existing_identity_needs_review');assert.equal((await exclusiveSnapshot(store)).items.length,1);
store=new Store([row,{...row,id:'manual-duplicate'}]);await runComedySeriesImport(store,leases,env,{probe:good,now});assert.equal((await comedySeriesImportStatus(store)).reason,'duplicate_series');assert.equal((await exclusiveSnapshot(store)).items.length,2);
store=new Store([{...row,type:'movie',episodes:[]}]);await runComedySeriesImport(store,leases,env,{probe:good,now});assert.equal((await comedySeriesImportStatus(store)).reason,'identity_conflict');assert.equal((await exclusiveSnapshot(store)).items[0].type,'movie');

// A single missing episode prevents the whole series, including every season.
store=new Store();let badCalls=0;
for(let attempt=0;attempt<4;attempt++)await runComedySeriesImport(store,leases,env,{probe:async media=>{badCalls++;if(media.page===COMEDY_GNULA_EPISODES[12].page)throw Error('https://secret.invalid/?password=never-retain-this');return {ok:true,check:'playlist_and_segment'};},now});
assert.equal(badCalls,78);assert.equal((await comedySeriesImportStatus(store)).state,'failed');assert.equal((await comedySeriesImportStatus(store)).attempts,3);assert.equal((await exclusiveSnapshot(store)).items.length,0);assert.equal(JSON.stringify(await comedySeriesImportStatus(store)).includes('never-retain'),false);
assert.equal((await comedySeriesImportStatus(store)).results.filter(result=>result.status==='unavailable').length,1);

// HTTP success or a metadata-only probe is not playable-media evidence.
for(const weakEvidence of [{ok:true},{ok:true,check:'media_bytes'},{ok:false,check:'playlist_and_segment'}]){
 store=new Store();let count=0;await runComedySeriesImport(store,leases,env,{probe:async()=>{count++;return weakEvidence;},now});
 assert.equal(count,26);assert.equal((await exclusiveSnapshot(store)).items.length,0);assert.equal((await comedySeriesImportStatus(store)).state,'running');assert.equal((await comedySeriesImportStatus(store)).reason,'source_unavailable');
}

// A later successful full attempt may finish the bounded job cleanly.
store=new Store();await runComedySeriesImport(store,leases,env,{probe:async()=>({ok:false}),now});await runComedySeriesImport(store,leases,env,{probe:good,now});
assert.equal((await comedySeriesImportStatus(store)).attempts,2);assert.equal((await comedySeriesImportStatus(store)).state,'completed');assert.equal((await comedySeriesImportStatus(store)).reason,undefined);

// Manual changes or a replacement claim made during probes always win.
store=new Store();let inserted=false;
await runComedySeriesImport(store,leases,env,{probe:async()=>{if(!inserted){inserted=true;const response=await exclusiveCatalogRoute(store,'/exclusive-save',{item:hidden,revision:0,actor:'fixture-owner'});assert.equal(response.status,200);await response.body?.cancel();}return {ok:true,check:'playlist_and_segment'};},now});
assert.equal((await comedySeriesImportStatus(store)).reason,'catalog_changed');assert.equal((await exclusiveSnapshot(store)).items.length,1);assert.equal((await exclusiveSnapshot(store)).items[0].visible,false);assert.equal((await exclusiveSnapshot(store)).items[0].plot,hidden.plot);
store=new Store();let replaced=false;
await runComedySeriesImport(store,leases,env,{probe:async()=>{if(!replaced){replaced=true;await store.put(key,{requestId:COMEDY_SERIES_IMPORT_REQUEST,state:'running',attempts:1,claim:'replacement-claim',claimUntil:now()+10000});}return {ok:true,check:'playlist_and_segment'};},now});
assert.equal((await exclusiveSnapshot(store)).items.length,0);assert.equal((await store.get(key)).claim,'replacement-claim');

// Expired work consumes the same finite attempt budget; active claims do not.
store=new Store();await store.put(key,{state:'running',attempts:2,claim:'expired',claimUntil:now()-1,startedAt:now()-5000});await runComedySeriesImport(store,leases,env,{probe:async()=>({ok:false}),now});
assert.equal((await comedySeriesImportStatus(store)).attempts,3);assert.equal((await comedySeriesImportStatus(store)).state,'failed');
store=new Store();await store.put(key,{state:'running',attempts:3,claimUntil:0});await runComedySeriesImport(store,leases,env,{probe:()=>{throw Error('attempts exhausted');},now});assert.equal((await comedySeriesImportStatus(store)).state,'failed');

for(const config of [{...env,ENVIRONMENT:'staging'},{...env,CATALOG_MAINTENANCE_ENABLED:'false'},{...env,COMEDY_SERIES_IMPORT_ENABLED:'false'},{ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true'}]){
 store=new Store();await runComedySeriesImport(store,leases,config,{probe:()=>{throw Error('disabled imports must not probe');},now});assert.equal((await comedySeriesImportStatus(store)).state,'pending');assert.equal(store.data.size,1);
}
// Even unexpected persisted fields are projected through a finite safe schema.
store=new Store();await store.put(key,{state:'completed',attempts:700,claim:'never-show',reason:'https://secret.invalid/',seriesId:'https://secret.invalid/',results:[{id:row.episodes[0].id,status:'added',check:'playlist_and_segment',checkedAt:now(),page:'https://secret.invalid/'},{id:'foreign',status:'https://secret.invalid/'}]});
const sanitized=JSON.stringify(await comedySeriesImportStatus(store));assert.equal(sanitized.includes('https://'),false);assert.equal(sanitized.includes('never-show'),false);assert.equal((await comedySeriesImportStatus(store)).attempts,3);assert.equal((await comedySeriesImportStatus(store)).results.length,1);
// A reviewed protocol fix has its own bounded request. The failed earlier
// attempt remains evidence; it is neither deleted nor granted more retries.
store=new Store();const previousKey='catalog-import:comedy-series-owner-20261120-v1',previous={requestId:'comedy-series-owner-20261120-v1',state:'failed',attempts:3,reason:'source_unavailable',results:[]};
await store.put(previousKey,previous);await runComedySeriesImport(store,leases,env,{probe:async()=>({ok:true,check:'playlist_and_segment'}),now});
assert.equal(COMEDY_SERIES_IMPORT_REQUEST,'comedy-series-owner-20261120-v2');assert.equal((await comedySeriesImportStatus(store)).state,'completed');assert.deepEqual(await store.get(previousKey),previous);
assert.equal(COMEDY_SERIES_DEFINITIONS.length,3);
console.log('PASS: atomic all-26-episode comedy publication gate, maximum two source probes, exclusive concurrent claims, three persistent attempts, manual edit/hide preservation, stable catalogue/usage identity, sanitized status, blocked other series and production flag isolation.');
