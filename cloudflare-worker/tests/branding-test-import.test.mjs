import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {BRANDING_TEST_CHANNEL as channel,PUBLIC_TV_CHANNELS,PUBLIC_TV_FOLDERS} from '../src/public-tv-channels.mjs';
import {ALL_TV_CHANNELS} from '../src/official-live.mjs';
import {runBrandingTestImport,brandingTestImportStatus,BRANDING_TEST_REQUEST} from '../src/branding-test-import.mjs';
import {exclusiveSnapshot} from '../src/exclusive-catalog.mjs';
import {inspectCatalogSource} from '../src/catalog-source-check.mjs';
import {officialMediaAllowed,isOfficialLivePage,resolveOfficialLive} from '../src/official-live.mjs';
import {usageChannel} from '../src/channel-usage.mjs';
import {LOCAL_TV_SERVER} from '../src/local-tv-xtream.mjs';

class Store{
 constructor(rows=[]){this.data=new Map([['exclusive:index',{revision:1,ids:rows.map(r=>r.id),updatedAt:1}],...rows.map(r=>['exclusive:item:'+r.id,structuredClone(r)])]);this.queue=Promise.resolve();}
 async get(k){return Array.isArray(k)?new Map(k.filter(key=>this.data.has(key)).map(key=>[key,structuredClone(this.data.get(key))])):structuredClone(this.data.get(k));}
 async put(k,v){if(typeof k==='object')for(const [key,value]of Object.entries(k))this.data.set(key,structuredClone(value));else this.data.set(k,structuredClone(v));}
 async delete(k){this.data.delete(k);}async setAlarm(){}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]));}
 transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p;}
}
const production={ENVIRONMENT:'production',CATALOG_MAINTENANCE_ENABLED:'true'},assetBase='https://app.snaptvnow.com/branding-test/',appleBase='https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/';
const hls=text=>new Response(text,{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
const fixture=(value,options={})=>{
 const url=String(value);assert.equal(options.redirect,'manual');assert.equal(new Headers(options.headers).has('Authorization'),false);assert.equal(new Headers(options.headers).has('Cookie'),false);
 if(url===channel.page)return hls('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Audio",DEFAULT=YES,AUTOSELECT=YES,URI="audio.m3u8"\n#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="brand",NAME="SNAPTVNOW",LANGUAGE="es",DEFAULT=YES,AUTOSELECT=YES,FORCED=YES,URI="subtitles.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=500000,AUDIO="audio",SUBTITLES="brand"\nvideo.m3u8\n');
 if(url===assetBase+'video.m3u8')return hls('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n'+appleBase+'v3/fileSequence0.ts\n#EXT-X-ENDLIST\n');
 if(url===assetBase+'audio.m3u8')return hls('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\n'+appleBase+'a1/fileSequence0.aac\n#EXT-X-ENDLIST\n');
 if(url===assetBase+'subtitles.m3u8')return hls('#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nbrand.vtt\n#EXT-X-ENDLIST\n');
 if(url===assetBase+'brand.vtt')return new Response('WEBVTT\n\n00:00:00.000 --> 00:00:06.000 line:85% position:95% align:end\nEXCLUSIVO · SNAPTVNOW\n',{headers:{'Content-Type':'text/vtt'}});
 if(url===appleBase+'v3/fileSequence0.ts'||url===appleBase+'a1/fileSequence0.aac')return new Response(new Uint8Array(2048).fill(0x47),{headers:{'Content-Type':url.endsWith('.aac')?'audio/aac':'video/mp2t'}});
 throw Error('Unexpected fixture media');
};
assert.equal(PUBLIC_TV_CHANNELS.length,20,'original fixed import stays unchanged');assert.equal(ALL_TV_CHANNELS.at(-1),channel);
assert.deepEqual(PUBLIC_TV_FOLDERS.find(f=>f.key==='branding-test'),{key:'branding-test',upstreamId:'111',name:'PRUEBAS SNAPTVNOW'});
assert.equal(isOfficialLivePage(channel.page),true);assert.equal((await resolveOfficialLive(channel.page)).url,channel.page);
for(const url of [channel.page,assetBase+'subtitles.m3u8',assetBase+'brand.vtt','https://snapmovienow.github.io/branding-test/master.m3u8',appleBase+'v3/fileSequence0.ts',appleBase+'a1/fileSequence0.aac'])assert.equal(officialMediaAllowed(channel.page,url),true,url);
for(const url of ['https://app.snaptvnow.com/private/secret.m3u8','https://app.snaptvnow.com/branding-test-extra/a.vtt','https://snapmovienow.github.io/index.html','https://devstreaming-cdn.apple.com/videos/other/segment.ts','https://devstreaming-cdn.apple.com.evil.test/videos/streaming/examples/bipbop_adv_example_hevc/a.ts',assetBase+'%2e%2e/private',appleBase+'v3/a.ts#fragment','http://app.snaptvnow.com/branding-test/master.m3u8'])assert.equal(officialMediaAllowed(channel.page,url),false,url);
let probes=0;const probe=media=>{probes++;return inspectCatalogSource(media,{fetcher:fixture});};
const logger=console.log,importLogs=[];console.log=value=>importLogs.push(value);
let store=new Store();await store.put('catalog-import:prior-test',{state:'completed',attempts:1});
await Promise.all([runBrandingTestImport(store,{},production,{probe}),runBrandingTestImport(store,{},production,{probe})]);
let report=await brandingTestImportStatus(store),rows=(await exclusiveSnapshot(store)).items;
assert.equal(report.requestId,BRANDING_TEST_REQUEST);assert.equal(report.state,'completed');assert.equal(report.attempts,1);assert.equal(probes,1);assert.equal(report.results[0].status,'added');assert.equal(report.results[0].monitoring,true);assert.equal(rows.length,1);assert.deepEqual(usageChannel(rows[0]).folders,['PRUEBAS SNAPTVNOW']);assert.deepEqual(await store.get('catalog-import:prior-test'),{state:'completed',attempts:1});
assert.deepEqual(importLogs,[{event:'branding_test_catalog',status:'added',attempt:1,visible:true}],'one URL-free log after the committed import');
const hidden={...rows[0],visible:false,name:'Owner label',poster:'https://images.example.org/owner.png'};await store.put('exclusive:item:'+channel.id,hidden);
await runBrandingTestImport(store,{},production,{probe:()=>{throw Error('completed job must not probe');}});assert.deepEqual(await store.get('exclusive:item:'+channel.id),hidden);
assert.equal(importLogs.length,1,'completed job does not repeat its log');
store=new Store([hidden]);await runBrandingTestImport(store,{},production,{probe});assert.deepEqual(await store.get('exclusive:item:'+channel.id),hidden);assert.equal((await brandingTestImportStatus(store)).results[0].status,'existing_preserved');
const duplicate={...rows[0],id:'owner-existing-branding'};store=new Store([duplicate]);await runBrandingTestImport(store,{},production,{probe});assert.equal((await exclusiveSnapshot(store)).items.length,1);assert.equal((await brandingTestImportStatus(store)).results[0].status,'duplicate_preserved');
store=new Store();await runBrandingTestImport(store,{},production,{probe:async()=>{await store.put('exclusive:item:'+channel.id,hidden);await store.put('exclusive:index',{revision:2,ids:[channel.id],updatedAt:2});return {ok:true};}});assert.equal((await brandingTestImportStatus(store)).results[0].status,'catalog_changed');assert.deepEqual(await store.get('exclusive:item:'+channel.id),hidden);
store=new Store();let failures=0;const logsBeforeFailure=importLogs.length;for(let n=0;n<4;n++)await runBrandingTestImport(store,{},production,{probe:async()=>{failures++;return {ok:false};}});
report=await brandingTestImportStatus(store);assert.equal(report.state,'completed');assert.equal(report.attempts,3);assert.equal(failures,3);assert.equal(report.results[0].status,'unavailable');assert.equal((await exclusiveSnapshot(store)).items.length,0);assert.ok(!JSON.stringify(report).includes('https://'));
assert.deepEqual(importLogs.slice(logsBeforeFailure).map(log=>log.attempt),[1,2,3],'at most one log per attempt');
// A stale claim after a terminated third attempt cannot trigger a fourth probe.
const jobKey=[...store.data.keys()].find(key=>key.startsWith('catalog-import:branding-test-'));await store.put(jobKey,{...(await store.get(jobKey)),state:'running',claimUntil:1});
await runBrandingTestImport(store,{},production,{probe:()=>{throw Error('attempt limit');}});assert.equal((await brandingTestImportStatus(store)).state,'completed');assert.equal((await brandingTestImportStatus(store)).attempts,3);assert.equal(importLogs.length,logsBeforeFailure+3);
for(const config of [{...production,ENVIRONMENT:'staging'},{...production,CATALOG_MAINTENANCE_ENABLED:'false'}]){store=new Store();await runBrandingTestImport(store,{},config,{probe:()=>{throw Error('disabled import');}});assert.equal((await brandingTestImportStatus(store)).state,'pending');}
console.log=logger;

// Real Worker catalog registration and signed video, audio and subtitle paths.
const env={TICKET_SECRET:'branding-test-secret-only',ADMIN_SETUP_SECRET:'branding-test-setup-only-1234567890'},objects=new Map(),origin='https://api.snaptvnow.com',provider='https://branding-provider.example.test';
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {fetch:(url,options)=>objects.get(id).fetch(new Request(url,options))};}};
let allocations=0;
globalThis.fetch=async(value,options={})=>{
 const u=new URL(value);if(u.origin!==provider)return fixture(value,options);
 const action=u.searchParams.get('action');if(!action){allocations++;return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});}
 if(action==='get_live_categories')return Response.json([{category_id:'7',category_name:'CANALES-NOVELAS',parent_id:0}]);
 if(action==='get_live_streams')return Response.json([{stream_id:55,name:'Original provider channel',category_id:'7',stream_icon:''}]);
 if(['get_vod_categories','get_vod_streams','get_series_categories','get_series'].includes(action))return Response.json([]);
 throw Error('unexpected provider action');
};
const post=async body=>{const r=await worker.fetch(new Request(origin+'/admin',{method:'POST',body:JSON.stringify(body)}),env);assert.equal(r.status,200);return r.json();};
await post({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'branding-owner-fixture'});
const login=await post({action:'login',username:'owner',password:'branding-owner-fixture'}),admin=(action,body={})=>post({action,access_token:login.access_token,...body});
await admin('provider-save',{mode:'single',url:provider,username:'branding-provider-user',password:'branding-provider-pass'});
const customer={username:'branding-viewer',password:'branding-viewer-fixture'};await admin('save',{create:true,...customer,status:'active',expiresAt:Date.now()+86400000,permissions:{tv:true,movies:false,series:false,adults:false}});
const api=(action,params={})=>worker.fetch(new Request(origin+'/player_api.php?'+new URLSearchParams({...customer,action,...params})),env);
const beforeCategories=await(await api('get_live_categories')).json(),beforeRows=await(await api('get_live_streams')).json();
store=objects.get('__smn_accounts_v1').state.storage;await runBrandingTestImport(store,{},production,{probe});
const categories=await(await api('get_live_categories')).json(),streams=await(await api('get_live_streams')).json(),category=categories.find(c=>c.category_name==='PRUEBAS SNAPTVNOW'),stream=streams.find(c=>c.name===channel.name);
assert.deepEqual(categories.filter(c=>c!==category),beforeCategories);assert.deepEqual(streams.slice(0,beforeRows.length),beforeRows);assert.equal(streams.length,beforeRows.length+1);assert.ok(category);assert.equal(stream.category_id,category.category_id);assert.equal(stream.container_extension,'m3u8');assert.deepEqual(await(await api('get_live_streams')).json(),streams);
assert.deepEqual((await(await api('get_live_streams',{category_id:category.category_id})).json()).map(c=>c.stream_id),[stream.stream_id]);
const registry=objects.get('__smn_xtream_catalog_v1').state.storage;assert.equal((await registry.get('xtream-id:'+stream.stream_id)).upstreamId,'2000022');assert.equal((await registry.get('xtream-id:'+stream.stream_id)).server,LOCAL_TV_SERVER);assert.equal((await registry.get('xtream-id:'+category.category_id)).upstreamId,'111');
const capacityBefore=allocations,masterResponse=await worker.fetch(new Request(stream.direct_source),env);assert.equal(masterResponse.status,200);const master=await masterResponse.text();assert.ok(master.startsWith('#EXTM3U'));assert.ok(!master.includes('apple.com'));assert.ok(!master.includes('app.snaptvnow.com'));
const tracks=[...master.matchAll(/URI="([^"]+)"/g)].map(m=>m[1]);assert.equal(tracks.length,2);
for(const playlistUrl of [...tracks,master.split('\n').find(s=>s.startsWith('https://'))]){
 const response=await worker.fetch(new Request(playlistUrl),env);assert.equal(response.status,200);const playlist=await response.text(),resource=playlist.split('\n').find(s=>s.startsWith('https://'));assert.ok(resource);assert.ok(!playlist.includes('apple.com'));assert.ok(!playlist.includes('app.snaptvnow.com'));
 const media=await worker.fetch(new Request(resource),env);assert.equal(media.status,200);
 if(/TYPE=SUBTITLES[^\n]*URI="/.test(master)&&playlistUrl===tracks[1]){assert.match(media.headers.get('Content-Type'),/text\/vtt/);assert.ok((await media.text()).includes('EXCLUSIVO · SNAPTVNOW'));}else assert.equal((await media.arrayBuffer()).byteLength,2048);
}
assert.equal(allocations,capacityBefore,'demo media does not reserve provider capacity');
const ts=await worker.fetch(new Request(stream.direct_source.replace('.m3u8','.ts')),env);assert.equal(ts.status,302);assert.equal(ts.headers.get('Location'),stream.direct_source);
await store.put('exclusive:item:'+channel.id,{...(await store.get('exclusive:item:'+channel.id)),visible:false});assert.equal((await worker.fetch(new Request(stream.direct_source),env)).status,404);assert.deepEqual(await(await api('get_live_streams')).json(),beforeRows);
await admin('save',{...customer,status:'active',expiresAt:Date.now()+86400000,permissions:{tv:false,movies:true,series:true,adults:false}});assert.equal((await worker.fetch(new Request(stream.direct_source),env)).status,403);assert.deepEqual(await(await api('get_live_streams')).json(),[]);
console.log('PASS: isolated branding test import, finite three attempts, manual/duplicate preservation, scoped hosts, stable Xtream category/stream IDs, signed video/audio/WebVTT, TV permissions and reversible visibility.');
