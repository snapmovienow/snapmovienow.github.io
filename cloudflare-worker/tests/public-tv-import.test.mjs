import assert from 'node:assert/strict';
import {PUBLIC_TV_CHANNELS,PUBLIC_TV_FOLDERS} from '../src/public-tv-channels.mjs';
import {runPublicTvImport,publicTvImportStatus,PUBLIC_TV_REQUEST} from '../src/public-tv-import.mjs';
import {exclusiveSnapshot} from '../src/exclusive-catalog.mjs';
import {inspectCatalogSource} from '../src/catalog-source-check.mjs';
import {officialMediaAllowed,isOfficialLivePage,resolveOfficialLive,LOCAL_TV_CHANNELS} from '../src/official-live.mjs';
import {readChannelUsage,usageChannel} from '../src/channel-usage.mjs';
import {publicTvFixture,publicTvFixtureUrls} from './public-tv-fixture.mjs';
class Store{
 constructor(rows=[]){this.data=new Map([['exclusive:index',{revision:1,ids:rows.map(r=>r.id),updatedAt:1}],...rows.map(r=>['exclusive:item:'+r.id,structuredClone(r)])]);this.queue=Promise.resolve();}
 async get(k){return structuredClone(this.data.get(k));}async put(k,v){this.data.set(k,structuredClone(v));}async delete(k){this.data.delete(k);}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)));}
 transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p;}
}
const env={ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true'},leases={};
assert.equal(PUBLIC_TV_CHANNELS.length,20);assert.equal(LOCAL_TV_CHANNELS.length,20,'the original local station list remains unchanged');
assert.equal(new Set(PUBLIC_TV_CHANNELS.map(c=>c.id)).size,20);assert.equal(new Set(PUBLIC_TV_CHANNELS.map(c=>c.xtreamId)).size,20);
for(const c of PUBLIC_TV_CHANNELS){
 assert.equal(isOfficialLivePage(c.page),true);
 const r=await resolveOfficialLive(c.page);assert.equal(r.url,c.page);assert.equal(r.officialPage,c.page);
 const urls=publicTvFixtureUrls(c);for(const url of [c.page,...Object.values(urls)])assert.equal(officialMediaAllowed(c.page,url),true,c.id+' '+url);
 const fetcher=async(u,o)=>{assert.equal(o.redirect,'manual');assert.equal(new Headers(o.headers).has('Cookie'),false);assert.equal(new Headers(o.headers).has('Authorization'),false);const value=publicTvFixture(u);assert.ok(value);return value;};
 assert.equal((await inspectCatalogSource({mode:'direct',page:c.page},{fetcher})).ok,true,c.id);
 for(const url of ['https://127.0.0.1/a.ts','http://'+new URL(c.page).hostname+'/a.ts','https://'+new URL(c.page).hostname+'.attacker.example/a.ts','https://user:password@'+new URL(c.page).hostname+'/a.ts','https://api.snaptvnow.com/private'])assert.equal(officialMediaAllowed(c.page,url),false);
 assert.equal(isOfficialLivePage(c.page+(c.page.includes('?')?'&':'?')+'redirect=private'),false);
 assert.equal((await inspectCatalogSource({mode:'direct',page:c.page},{fetcher:async()=>new Response(null,{status:302,headers:{Location:'https://127.0.0.1/private'}})})).ok,false);
}
assert.equal(officialMediaAllowed(PUBLIC_TV_CHANNELS[3].page,'https://us-b4-p-e-fixture.cdn.mdstrm.com/live-stream/610178c7db32a4112d994650/segment.ts'),false,'ADN cannot access Milenio resources');
let store=new Store(),calls=0,active=0,maxActive=0;
const good=async()=>{calls++;active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setImmediate(resolve));active--;return {ok:true};};
await Promise.all([runPublicTvImport(store,leases,env,{probe:good}),runPublicTvImport(store,leases,env,{probe:good})]);
const report=await publicTvImportStatus(store),rows=(await exclusiveSnapshot(store)).items;
assert.equal(calls,20);assert.ok(maxActive<=4);assert.equal(report.requestId,PUBLIC_TV_REQUEST);assert.equal(report.state,'completed');assert.equal(rows.length,20);
assert.ok(rows.every(r=>r.usageKind==='channel'&&r.mode==='direct'));assert.ok(report.results.every(r=>r.status==='added'&&r.monitoring===true));assert.ok(!JSON.stringify(report).includes('https://'));
const usage=await(await readChannelUsage(store,null,{accountId:'owner-test'},rows)).json();assert.equal(usage.channels.length,20,'all channels appear in monitoring before first use');
for(const row of rows)assert.deepEqual(usageChannel(row).folders,[PUBLIC_TV_FOLDERS.find(f=>f.key===PUBLIC_TV_CHANNELS.find(c=>c.id===row.id).categories[0]).name]);
const hidden={...rows[0],visible:false,plot:'Owner change'};await store.put('exclusive:item:'+hidden.id,hidden);await runPublicTvImport(store,leases,env,{probe:good});assert.deepEqual(await store.get('exclusive:item:'+hidden.id),hidden);
const duplicate={...rows[0],id:'existing-owner-dw',name:'Owner DW title',poster:'https://images.test-existing.org/logo.png',usageKind:undefined};store=new Store([duplicate]);await runPublicTvImport(store,leases,env,{probe:good});assert.equal((await publicTvImportStatus(store)).results[0].status,'duplicate_preserved');assert.deepEqual(await store.get('exclusive:item:'+duplicate.id),duplicate);assert.equal((await exclusiveSnapshot(store)).items.length,20);assert.equal(usageChannel(duplicate).folders[0],'CANALES-NOTICIA');
store=new Store();for(let i=0;i<3;i++)await runPublicTvImport(store,leases,env,{probe:async m=>({ok:m.page!==PUBLIC_TV_CHANNELS.at(-1).page})});assert.equal((await publicTvImportStatus(store)).state,'completed');assert.equal((await publicTvImportStatus(store)).results.filter(r=>r.status==='unavailable').length,1);assert.equal((await exclusiveSnapshot(store)).items.length,19);
store=new Store();let changed=false;await runPublicTvImport(store,leases,env,{probe:async()=>{if(!changed){changed=true;await store.put('exclusive:item:'+rows[0].id,{...rows[0],plot:'Concurrent owner edit'});const index=await store.get('exclusive:index');index.ids.push(rows[0].id);await store.put('exclusive:index',index);}return {ok:true};}});assert.equal((await publicTvImportStatus(store)).results[0].status,'catalog_changed');assert.equal((await store.get('exclusive:item:'+rows[0].id)).plot,'Concurrent owner edit');
const staged=new Store();await runPublicTvImport(staged,leases,{...env,ENVIRONMENT:'staging'},{probe:async()=>{throw Error('must not run');}});assert.equal((await exclusiveSnapshot(staged)).items.length,0);
console.log('PASS: twenty scoped public HLS sources, bounded finite import, real resource checks, monitoring inclusion, original station isolation, deduplication, manual edits/hides, concurrency and staging isolation.');
