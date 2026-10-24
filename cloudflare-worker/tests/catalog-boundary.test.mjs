import assert from 'node:assert/strict';
import {createProviderCatalog} from '../src/provider-catalog.mjs';
import {encodeCatalog} from '../src/catalog-cache.mjs';
const realFetch=globalThis.fetch;
const providers=[{source:'fixture',encrypted:'fixture-v1'}],credentials=[{server:'fixture',origin:'https://fixture.invalid',username:'synthetic',password:'test-only'}];
let sourceReads=0;
const deps={directory:async()=>Response.json(providers),catalogCredentials:async()=>credentials,registry:async()=>new Response(null,{status:404})};
const make=(overrides={},ctx,env={PLAYBACK_SESSIONS:{},TICKET_SECRET:'test-catalog-boundary-secret'})=>createProviderCatalog({...deps,...overrides},env,ctx,{timeoutMs:160,hedgeMs:5,cacheReadMs:15});
const guard=async task=>{let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('catalog_waited_outside_deadline')),500)})])}finally{clearTimeout(timer)}};
try{
 globalThis.fetch=async()=>{sourceReads++;return Response.json([{stream_id:10,name:'Fresh fixture'}])};
 let started=performance.now();const fromSlowCache=await guard(make({registry:()=>new Promise(()=>{})})('get_vod_streams'));
 assert.equal(fromSlowCache[0].stream_id,10);assert.equal(sourceReads,1);assert.ok(performance.now()-started<400,'an optional cache cannot hold the playback path indefinitely');
 started=performance.now();await assert.rejects(guard(make({directory:()=>new Promise(()=>{})})('get_vod_streams')),/catalog_timeout/);assert.ok(performance.now()-started<400,'current provider configuration is bounded and never bypassed');assert.equal(sourceReads,1);
 // A cache that replies after its read budget must be cancelled and cannot
 // replace a newer provider response in the in-memory cache.
 let late,cancelled=0;const pending=new Promise(resolve=>{late=resolve}),env={PLAYBACK_SESSIONS:{},TICKET_SECRET:'test-catalog-late-cache-secret'};
 const current=make({registry:async(_env,path)=>path==='/xtream-cache-get'?pending:Response.json({ok:true})},{waitUntil:p=>{void p.catch(()=>{})}},env);
 assert.equal((await guard(current('get_vod_streams')))[0].stream_id,10);
 late(new Response(new ReadableStream({cancel(){cancelled++}})));await new Promise(r=>setTimeout(r,5));assert.equal(cancelled,1);
 const before=sourceReads;assert.equal((await current('get_vod_streams'))[0].stream_id,10);assert.equal(sourceReads,before);
 const gzip=await encodeCatalog([{stream_id:33,name:'Cached fixture',_server:'fixture'}]);
 const cached=make({registry:async()=>new Response(gzip,{headers:{'x-catalog-saved-at':String(Date.now())}})});
 assert.equal((await cached('get_vod_streams'))[0].stream_id,33);assert.equal(sourceReads,before,'a fast valid durable snapshot still avoids all source traffic');
 // An incomplete cache body and a stalled permission inspector also share the
 // request budget. Inspection may fall back, but never grants access itself.
 let bodyCancelled=0;
 const bodyCache=make({registry:async(_env,path)=>path==='/xtream-cache-get'?new Response(new ReadableStream({cancel(){bodyCancelled++}}),{headers:{'x-catalog-saved-at':String(Date.now())}}):Response.json({ok:true})},{waitUntil:p=>{void p.catch(()=>{})}});
 assert.equal((await guard(bodyCache('get_vod_streams')))[0].stream_id,10);assert.ok(bodyCancelled>=1);
 const inspect=make({registry:()=>new Promise(()=>{})});assert.equal(await guard(inspect.inspect('movie','fixture',1)),undefined);
 console.log('PASS: configuration/cache/permission waits bounded, healthy cache retained, stalled/late cache cancelled without replacing fresh results, and no access bypass.');
}finally{globalThis.fetch=realFetch}
