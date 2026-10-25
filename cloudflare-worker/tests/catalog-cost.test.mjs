import assert from 'node:assert/strict';
import {CatalogCost,cleanCatalogCost} from '../src/catalog-cost.mjs';
import {createProviderCatalog} from '../src/provider-catalog.mjs';
import {encodeCatalog} from '../src/catalog-cache.mjs';
import {PlaybackTimings,playbackTimingsRoute} from '../src/playback-timings.mjs';
import {traceRequest} from '../src/request-diagnostics.mjs';
let clock=0;
const overlap=new CatalogCost('vod_info',()=>clock),a=overlap.begin('get_vod_info'),b=overlap.begin('get_vod_categories');
const endA=a.phase('provider');clock=10;const endB=b.phase('provider');clock=30;endA();clock=40;endB();a.cache('miss');b.cache('memory');a.finish();b.finish();
assert.equal(overlap.snapshot().ms.provider,40,'overlapping provider reads count wall time once, not 60 ms');assert.equal(overlap.snapshot().lookups,2);
assert.equal(overlap.begin('get_series_info'),null);assert.equal(new CatalogCost('private-url').begin('get_vod_info'),null);
const bound=new CatalogCost('stream_token',()=>clock);for(let i=0;i<110;i++)bound.begin('get_vod_info')?.finish();assert.equal(bound.snapshot().lookups,100);
assert.equal(cleanCatalogCost({...overlap.snapshot(),cache:{memory:90,durable:0,miss:0}}),null);
const redacted=cleanCatalogCost({...overlap.snapshot(),url:'private-url',username:'private-user',ms:{...overlap.snapshot().ms,password:99}});assert.ok(!JSON.stringify(redacted).includes('private'));assert.equal(redacted.ms.password,undefined);
const realFetch=globalThis.fetch,realDate=Date.now;let elapsed=0;Date.now=()=>realDate()+elapsed;
const movie={movie_data:{stream_id:1,name:'Synthetic movie'}},credentials=[{server:'ccf',origin:'https://synthetic.invalid',username:'private-user',password:'private-password'}];
let fetches=0,discoveries=0,directoryReads=0,cacheReads=0;
const env=()=>({PLAYBACK_SESSIONS:{},TICKET_SECRET:'synthetic-secret'}),deps={directory:async()=>{directoryReads++;clock+=2;return Response.json([{source:'ccf',encrypted:'synthetic'}])},registry:async(e,path)=>{if(path==='/xtream-cache-get'){cacheReads++;clock+=3;return new Response(null,{status:404})}return Response.json({ok:true})},catalogCredentials:async()=>{discoveries++;clock+=5;return credentials}};
globalThis.fetch=async()=>{fetches++;clock+=17;return Response.json(movie)};
try{
 const sharedEnv=env(),cost=new CatalogCost('vod_info',()=>clock),catalog=createProviderCatalog(deps,sharedEnv,{waitUntil:p=>p.catch(()=>{})},{catalogCost:cost});
 assert.deepEqual(await catalog('get_vod_info','ccf',{vod_id:1}),movie);assert.equal(fetches,1);assert.deepEqual(cost.snapshot().cache,{memory:0,durable:0,miss:1});assert.deepEqual(cost.snapshot().ms,{localCache:5,provider:17,unattributed:5});
 const hit=new CatalogCost('vod_info',()=>clock);assert.deepEqual(await createProviderCatalog(deps,sharedEnv,null,{catalogCost:hit})('get_vod_info','ccf',{vod_id:1}),movie);assert.deepEqual(hit.snapshot().cache,{memory:1,durable:0,miss:0});assert.equal(hit.snapshot().ms.provider,0);assert.equal(fetches,1);assert.equal(discoveries,1);
 const compressed=await encodeCatalog(movie),durable=new CatalogCost('vod_info',()=>clock),savedDeps={...deps,registry:async()=>{clock+=3;return new Response(compressed,{headers:{'x-catalog-saved-at':String(Date.now())}})}};
 assert.deepEqual(await createProviderCatalog(savedDeps,env(),null,{catalogCost:durable})('get_vod_info','ccf',{vod_id:1}),movie);assert.deepEqual(durable.snapshot().cache,{memory:0,durable:1,miss:0});assert.equal(fetches,1);
 const optional=new CatalogCost('stream_token',()=>clock);await createProviderCatalog(deps,env(),null,{catalogCost:optional})('get_vod_streams','ccf',{}, {cachedOnly:true});assert.equal(optional.snapshot(),null,'off-path activity/cache-only reads do not become startup measurements');assert.equal(fetches,1);
 // Detail freshness and physical provider-call counts are unchanged.
 elapsed+=31000;await createProviderCatalog(deps,sharedEnv,{waitUntil:p=>p.catch(()=>{})},{catalogCost:new CatalogCost('vod_info',()=>clock)})('get_vod_info','ccf',{vod_id:1});assert.equal(fetches,2);
 // Background list refresh does not contaminate foreground latency.
 globalThis.fetch=async()=>{fetches++;clock+=17;return Response.json([{stream_id:1}])};const listEnv=env(),background=[],ctx={waitUntil:p=>background.push(p)};
 await createProviderCatalog(deps,listEnv,ctx)('get_vod_streams','ccf');await Promise.all(background.splice(0));elapsed+=300001;
 const stale=new CatalogCost('stream_token',()=>clock);await createProviderCatalog(deps,listEnv,ctx,{catalogCost:stale})('get_vod_streams','ccf');const foreground=stale.snapshot();await Promise.all(background.splice(0));assert.deepEqual(stale.snapshot(),foreground);assert.equal(foreground.cache.memory,1);assert.equal(foreground.ms.provider,0);assert.equal(foreground.ms.unattributed,0);
 // A second request joining pending work has unseparated wait, not fabricated
 // provider timing or another provider fetch.
 let release,started;const startedPromise=new Promise(r=>{started=r});globalThis.fetch=()=>{fetches++;started();return new Promise(r=>{release=()=>r(Response.json(movie))})};const pendingEnv=env(),first=new CatalogCost('vod_info',()=>clock),second=new CatalogCost('vod_info',()=>clock),before=fetches;
 const one=createProviderCatalog(deps,pendingEnv,ctx,{catalogCost:first})('get_vod_info','ccf',{vod_id:1});await startedPromise;
 const two=createProviderCatalog(deps,pendingEnv,ctx,{catalogCost:second})('get_vod_info','ccf',{vod_id:1});await new Promise(r=>setTimeout(r,5));clock+=20;release();await Promise.all([one,two]);await Promise.all(background.splice(0));assert.equal(fetches,before+1);assert.equal(second.snapshot().ms.provider,0);assert.ok(second.snapshot().ms.unattributed>=20);
}finally{globalThis.fetch=realFetch;Date.now=realDate;}
class Store{constructor(){this.data=new Map()}async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)))}async transaction(fn){return fn(this)}}
const storage=new Store(),route=(path,timing)=>playbackTimingsRoute(storage,new Request('https://private/operations/'+path,{method:'POST',body:JSON.stringify(timing?{timing}:{})}));
const timing={type:'movie',platform:'web',status:200,totalMs:100,stages:{catalog:{ms:100,count:1}},catalogCost:overlap.snapshot()};
await route('timing-ingest',timing);await route('timing-ingest',{...timing,catalogCost:undefined});await route('timing-ingest',{...timing,catalogCost:{...timing.catalogCost,operation:'https://private'}});
let report=await (await route('timing-read')).json();assert.equal(report.groups[0].requests,3);assert.equal(report.groups[0].catalogCost[0].requests,1,'only requests with valid detail contribute to its denominator');assert.equal(report.groups[0].catalogCost[0].avgMs.provider,40);
assert.ok([...storage.data.keys()].every(k=>k.startsWith('startup-timing:')||k==='startup-timing-pruned'),'no new persistence namespace');assert.ok(!JSON.stringify([...storage.data]).includes('https://private'));
await route('timing-ingest',{...timing,type:'live'});report=await (await route('timing-read')).json();assert.equal(report.groups.find(g=>g.type==='live').catalogCost,undefined);
let sent;const response=await traceRequest(new Request('https://synthetic.invalid/'),async trace=>{trace.identify('movie','web');const sample=trace.movieCatalog('vod_info').begin('get_vod_info');sample.cache('memory');sample.finish();return Response.json({ok:true})},{onTiming:value=>{sent=value}});
assert.equal(sent.catalogCost.cache.memory,1);assert.ok(![...response.headers].flat().join(' ').includes('localCache'),'no new diagnostic response headers');assert.ok(![...response.headers].flat().join(' ').includes('catalogCost'));
assert.equal(new PlaybackTimings().identify('series').snapshot().catalogCost,undefined);
console.log('PASS: movie catalog-only cache classification, non-additive phase timings, background/shared-work isolation, unchanged provider calls/TTL, bounded private existing-bucket aggregation and header exclusion.');
