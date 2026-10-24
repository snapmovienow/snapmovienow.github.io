import assert from 'node:assert/strict';
import {createProviderCatalog,CATALOG_FETCH_MS} from '../src/provider-catalog.mjs';
const realFetch=globalThis.fetch;
const credentials=[0,1,2].map(n=>({server:'ccf',origin:'https://provider.example',username:'source'+n,password:'secret'}));
const deps={directory:async()=>Response.json([{source:'ccf',encrypted:'fixture'}]),catalogCredentials:async()=>credentials,registry:async()=>new Response(null,{status:404})};
// CI can pause the event loop during WebCrypto/stream initialization. Keep
// test deadlines bounded without mistaking runner contention for provider latency.
// Production CATALOG_FETCH_MS and the performance release gate are unchanged.
const TEST_BUDGET_MS=1000, TEST_WALL_LIMIT_MS=3000;
const make=(overrides={},ctx,options={timeoutMs:TEST_BUDGET_MS,hedgeMs:5})=>createProviderCatalog({...deps,...overrides},{PLAYBACK_SESSIONS:{},TICKET_SECRET:'test-secret'},ctx,options);
try{
 const calls=[],cancelled=[];
 globalThis.fetch=(url,{signal})=>{const name=new URL(url).searchParams.get('username');calls.push(name);if(name==='source0')return new Promise((_,reject)=>signal.addEventListener('abort',()=>{cancelled.push(name);reject(Error('abort'))}));return Promise.resolve(Response.json([{stream_id:7,name:'Healthy',direct_source:'https://secret.example/live/source/secret/7'}]));};
 const fast=await make()('get_live_streams');assert.deepEqual(calls,['source0','source1']);assert.deepEqual(cancelled,['source0']);assert.equal(fast[0]._server,'ccf');assert.equal(fast[0].direct_source,undefined);
 let active=0,peak=0;const started=[];
 globalThis.fetch=(url,{signal})=>{const name=new URL(url).searchParams.get('username');started.push(name);active++;peak=Math.max(peak,active);if(name==='source2'){active--;return Promise.resolve(Response.json([{stream_id:8}]))}return new Promise((_,reject)=>signal.addEventListener('abort',()=>{active--;reject(Error('abort'))}));};
 const backup=await make()('get_vod_streams');assert.equal(backup[0].stream_id,8);assert.ok(peak<=2,'at most two large catalog responses may be in flight per server');assert.deepEqual(started,['source0','source1','source2']);
 let aborted=0;
 globalThis.fetch=(url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>{aborted++;reject(Error('abort'))}));
 const at=performance.now();await assert.rejects(make()('get_series'),/upstream_unavailable/);assert.ok(performance.now()-at<TEST_WALL_LIMIT_MS);assert.ok(aborted>=2,'the entire lookup cancels pending source reads');
 const lookup=performance.now();await assert.rejects(make({catalogCredentials:()=>new Promise(()=>{})})('get_series'),/catalog_timeout/);assert.ok(performance.now()-lookup<TEST_WALL_LIMIT_MS,'credential discovery shares the catalog deadline');
 let credentialReads=0;const sharedAt=Date.now();
 const shared=make({catalogCredentials:async()=>{credentialReads++;return credentials.slice(0,1)}},undefined,{timeoutMs:TEST_BUDGET_MS,hedgeMs:5});
 globalThis.fetch=async()=>{await new Promise(r=>setTimeout(r,45));return Response.json([{stream_id:12}])};
 await shared('get_live_streams');
 globalThis.fetch=(url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('abort'))));
 await assert.rejects(shared('get_series'),/upstream_unavailable|catalog_timeout/);
 // Timer completion may round a millisecond early. Exercise an actually
 // exhausted budget rather than depending on scheduler rounding.
 await new Promise(resolve=>setTimeout(resolve,Math.max(0,sharedAt+TEST_BUDGET_MS+10-Date.now())));
 assert.equal((await shared('get_live_streams'))[0].stream_id,12,'cached catalogs stay available after the request budget expires');
 await assert.rejects(shared('get_vod_streams'),/catalog_timeout/);
 assert.equal(credentialReads,2,'exhausting a request budget prevents another sequential provider scan');
 globalThis.fetch=async url=>Response.json(new URL(url).searchParams.get('username')==='source0'?[]:[{stream_id:9}]);
 assert.equal((await make()('get_live_streams'))[0].stream_id,9,'one blank account does not hide another account catalog');
 const background=[];let releaseSave,saveStarted=false;const saveGate=new Promise(r=>{releaseSave=r});
 const catalog=make({registry:async(env,path)=>{if(path==='/xtream-cache-get')return new Response(null,{status:404});saveStarted=true;await saveGate;return Response.json({ok:true})}},{waitUntil:p=>background.push(p)});
 const visible=await Promise.race([catalog('get_vod_streams'),new Promise((_,reject)=>setTimeout(()=>reject(Error('cache_write_blocked_catalog')),TEST_WALL_LIMIT_MS))]);assert.equal(visible[0].stream_id,9);assert.equal(background.length,1);releaseSave();await Promise.all(background);assert.equal(saveStarted,true);
 assert.equal(CATALOG_FETCH_MS,8000);
 console.log('PASS: complete catalog lookup deadline, two-request cap, third-account recovery, source cancellation, empty-account fallback, credential deadline and nonblocking durable cache saves.');
}finally{globalThis.fetch=realFetch}
