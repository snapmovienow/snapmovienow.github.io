import assert from 'node:assert/strict';
import {UNIVISION_NY_CHANNEL as channel} from '../src/public-tv-channels.mjs';
import {runUnivisionNyImport,univisionNyImportStatus,UNIVISION_NY_REQUEST} from '../src/univision-ny-import.mjs';
import {exclusiveSnapshot} from '../src/exclusive-catalog.mjs';
import {inspectCatalogSource} from '../src/catalog-source-check.mjs';
import {officialMediaAllowed,isOfficialLivePage,resolveOfficialLive} from '../src/official-live.mjs';
import {readChannelUsage,usageChannel} from '../src/channel-usage.mjs';
import {publicTvFixture,publicTvFixtureUrls} from './public-tv-fixture.mjs';
class Store{
 constructor(rows=[]){this.data=new Map([['exclusive:index',{revision:1,ids:rows.map(r=>r.id),updatedAt:1}],...rows.map(r=>['exclusive:item:'+r.id,structuredClone(r)])]);this.queue=Promise.resolve();}
 async get(k){return structuredClone(this.data.get(k));}async put(k,v){this.data.set(k,structuredClone(v));}async delete(k){this.data.delete(k);}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)));}
 transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p;}
}
const env={ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true'};
assert.equal(isOfficialLivePage(channel.page),true);
assert.equal((await resolveOfficialLive(channel.page)).url,channel.page);
for(const url of [channel.page,...Object.values(publicTvFixtureUrls(channel))])assert.equal(officialMediaAllowed(channel.page,url),true);
for(const url of ['https://streaming-live-fcdn.api.prd.univisionnow.com/wltv/wltv.isml/hls/wltv.m3u8','https://streaming-live-fcdn.api.prd.univisionnow.com/private','https://streaming-live-fcdn.api.prd.univisionnow.com/wxtv/wxtv.isml/hls/%2e%2e/private','https://127.0.0.1/a.ts','http://streaming-live-fcdn.api.prd.univisionnow.com/wxtv/wxtv.isml/hls/a.ts'])assert.equal(officialMediaAllowed(channel.page,url),false);
let fetches=0;
const probe=media=>inspectCatalogSource(media,{fetcher:async(u,o)=>{fetches++;assert.equal(o.redirect,'manual');assert.equal(new Headers(o.headers).has('Authorization'),false);assert.equal(new Headers(o.headers).has('Cookie'),false);return publicTvFixture(u);}});
let store=new Store();await Promise.all([runUnivisionNyImport(store,{},env,{probe}),runUnivisionNyImport(store,{},env,{probe})]);
let report=await univisionNyImportStatus(store),rows=(await exclusiveSnapshot(store)).items;
assert.equal(report.requestId,UNIVISION_NY_REQUEST);assert.equal(report.state,'completed');assert.equal(report.attempts,1);assert.equal(report.results[0].status,'added');assert.equal(report.results[0].monitoring,true);assert.equal(report.results[0].visible,true);assert.equal(rows.length,1);assert.ok(fetches>2);
assert.deepEqual(usageChannel(rows[0]).folders,['LOCAL NEW YORK']);
assert.equal((await(await readChannelUsage(store,null,{accountId:'owner-test'},rows)).json()).channels[0].name,channel.name,'visible in monitoring before first playback');
const hidden={...rows[0],visible:false,poster:'https://images.example.org/owner.png',name:'Owner label'};await store.put('exclusive:item:'+channel.id,hidden);
await runUnivisionNyImport(store,{},env,{probe:()=>{throw Error('completed import must not probe');}});assert.deepEqual(await store.get('exclusive:item:'+channel.id),hidden);
store=new Store([hidden]);await runUnivisionNyImport(store,{},env,{probe});assert.deepEqual(await store.get('exclusive:item:'+channel.id),hidden);assert.equal((await univisionNyImportStatus(store)).results[0].status,'existing_preserved');
const duplicate={...rows[0],id:'owner-existing-wxtv',name:'Owner existing WXTV'};store=new Store([duplicate]);await runUnivisionNyImport(store,{},env,{probe});assert.equal((await exclusiveSnapshot(store)).items.length,1);assert.equal((await univisionNyImportStatus(store)).results[0].catalogId,duplicate.id);assert.deepEqual(usageChannel(duplicate).folders,['LOCAL NEW YORK']);
store=new Store();await runUnivisionNyImport(store,{},env,{probe:async()=>{await store.put('exclusive:item:'+channel.id,hidden);await store.put('exclusive:index',{revision:2,ids:[channel.id],updatedAt:2});return {ok:true};}});assert.equal((await univisionNyImportStatus(store)).results[0].status,'catalog_changed');assert.deepEqual(await store.get('exclusive:item:'+channel.id),hidden);
store=new Store();let failures=0;for(let n=0;n<4;n++)await runUnivisionNyImport(store,{},env,{probe:media=>{failures++;return inspectCatalogSource(media,{fetcher:async()=>new Response('Forbidden',{status:403})});}});
report=await univisionNyImportStatus(store);assert.equal(report.state,'completed');assert.equal(report.attempts,3);assert.equal(failures,3);assert.equal(report.results[0].status,'unavailable');assert.equal(report.results[0].monitoring,false);assert.equal((await exclusiveSnapshot(store)).items.length,0);assert.ok(!JSON.stringify(report).includes('https://'));
for(const config of [{...env,ENVIRONMENT:'staging'},{...env,CATALOG_MAINTENANCE_ENABLED:'false'}]){store=new Store();await runUnivisionNyImport(store,{},config,{probe:()=>{throw Error('disabled import');}});assert.equal((await univisionNyImportStatus(store)).state,'pending');}
console.log('PASS: scoped WXTV HLS/media gate, one finite private publication, LOCAL NEW YORK monitoring, original IDs, concurrency, manual hides/metadata, duplicate preservation, 403 rejection and staging isolation.');
