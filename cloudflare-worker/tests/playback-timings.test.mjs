import assert from 'node:assert/strict';
import {PlaybackTimings,playbackTimingsRoute,startupTimingObservations,queuePlaybackTiming} from '../src/playback-timings.mjs';
import {traceRequest} from '../src/request-diagnostics.mjs';
let now=0;const trace=new PlaybackTimings(()=>now).identify('series','android');
await trace.run('auth',async()=>{now+=20});
await assert.rejects(trace.run('origin',async()=>{now+=100;throw Error('secret-url')}));
trace.add('https://password.example',500);trace.add('catalog',NaN);
trace.merge(new Response(null,{headers:{'Server-Timing':'smn_first_byte;dur=37,smn_password;dur=999,smn_origin;dur=-10'}}));
assert.deepEqual(trace.snapshot(502),{type:'series',platform:'android',status:502,totalMs:120,stages:{auth:{ms:20,count:1},origin:{ms:100,count:1},first_byte:{ms:37,count:1}}});
let ingested;
const r=await traceRequest(new Request('https://test/series/private/password/1.mp4'),async t=>{t.identify('series','android');await t.run('origin',async()=>{now+=200});return new Response('media',{headers:{'Server-Timing':'smn_origin;dur=200'}})},{now:()=>now,onTiming:t=>{ingested=t}});
assert.equal((r.headers.get('Server-Timing').match(/smn_origin;/g)||[]).length,1,'DO timing is represented exactly once');
assert.equal(ingested.stages.origin.ms,200);assert.ok(!JSON.stringify(ingested).includes('private'));
class Store{constructor(){this.data=new Map()}async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)))}async transaction(fn){return fn(this)}}
const store=new Store(),route=(path,body={})=>playbackTimingsRoute(store,new Request('https://private/operations/'+path,{method:'POST',body:JSON.stringify(body)}));
for(let i=0;i<20;i++)assert.equal((await route('timing-ingest',{timing:{type:'series',platform:'android',status:i===19?502:200,totalMs:i===19?5000:100,stages:{origin:{ms:i===19?4500:80,count:1}}}})).status,200);
const report=await (await route('timing-read')).json();assert.equal(report.groups.length,1);assert.equal(report.groups[0].requests,20);assert.equal(report.groups[0].failures,1);assert.equal(report.groups[0].stages.total.p95UpperMs,100);assert.equal(report.groups[0].stages.origin.p95UpperMs,100);
assert.equal((await route('timing-ingest',{timing:{...ingested,stages:{password:{ms:1,count:1}}}})).status,400,'only allowlisted scalar stages persist');
assert.equal(startupTimingObservations([{...report.groups[0],stages:{total:{p95UpperMs:20000},origin:{p95UpperMs:15000}}}])[0].bad,true);
assert.match(startupTimingObservations([{...report.groups[0],stages:{total:{p95UpperMs:20000},origin:{p95UpperMs:15000}}}])[0].detail,/respuesta del origen/);
assert.equal(startupTimingObservations([{...report.groups[0],requests:1}]).length,0,'one sparse sample cannot declare an outage or recovery');
assert.equal(startupTimingObservations([{...report.groups[0],failures:0}])[0].bad,false);
for(const [type,requests,failures,stage] of [['series',9,1,'catalog'],['movie',21,2,'origin']]){
 const observation=startupTimingObservations([{type,platform:'other',requests,failures,stages:{total:{p95UpperMs:20000},[stage]:{p95UpperMs:20000}}}])[0];
 assert.equal(observation.bad,true);assert.equal(observation.title,'Demoras al iniciar contenido');assert.match(observation.detail,/P95 estimado \(más de 12 y hasta 20 s según el histograma\) · Objetivo de inicio: 12 s/);assert.match(observation.detail,/Reproductor sin identificar/);assert.ok(!observation.detail.includes('Alerta por respuestas con error'),'a latency alert cannot misrepresent a below-threshold error count as repeated failures');
 assert.equal(startupTimingObservations([{type,platform:'other',requests,failures,stages:{total:{p95UpperMs:12000}}}]).length,0,'existing error and startup thresholds remain unchanged');
}
const failedStarts=startupTimingObservations([{type:'series',platform:'web',requests:9,failures:3,stages:{total:{p95UpperMs:8000}}}])[0];assert.equal(failedStarts.title,'Fallos repetidos al iniciar contenido');assert.match(failedStarts.detail,/Alerta por respuestas con error/);assert.ok(!failedStarts.detail.includes('Alerta por demora'));
const mixed=startupTimingObservations([{type:'movie',platform:'other',requests:15,failures:3,stages:{total:{p95UpperMs:60000}},statusCounts:{416:3},errorCounts:{range_out_of_bounds:2,upstream_unavailable:1}}])[0];
assert.match(mixed.detail,/P95 estimado \(más de 20 y hasta 60 s según el histograma\) · Objetivo de inicio: 12 s/);
assert.match(mixed.detail,/HTTP 416: 3 · HTTP 416 con inicio del rango fuera del tamaño declarado: 2/);
let clock=0,resolveA,resolveB;const parallel=new PlaybackTimings(()=>clock).identify('movie','web');
const one=parallel.run('catalog',()=>new Promise(r=>{resolveA=r}));clock=10;
const two=parallel.run('catalog',()=>new Promise(r=>{resolveB=r}));clock=30;resolveA();await one;
assert.equal(parallel.snapshot().stages.catalog.ms,30,'a pending parallel catalog is measured through the response time');
clock=40;resolveB();await two;assert.deepEqual(parallel.snapshot().stages.catalog,{ms:40,count:2},'overlapping catalog calls count wall time once, not the sum of both durations');
console.log('PASS: bounded per-stage startup timing, failure attribution, DO merge without duplication, redacted aggregate p95 and invalid metric rejection.');

const regular={type:'live',platform:'web',status:200,totalMs:120,stages:{origin:{ms:90,count:1}}};
const grouped=new Store(),sent=[],pending=[];
const binding={idFromName:name=>name,get:()=>({fetch:async(url,options)=>{
 const body=JSON.parse(options.body);sent.push(body);
 return playbackTimingsRoute(grouped,new Request(url,options));
}})};
const ctx={waitUntil:promise=>pending.push(promise)};
let writes=0;const put=grouped.put.bind(grouped);
grouped.put=async(k,v)=>{if(k.startsWith('startup-timing:'))writes++;return put(k,v);};
for(let index=0;index<24;index++)queuePlaybackTiming(binding,ctx,regular);
queuePlaybackTiming(binding,ctx,{...regular,status:502});
assert.equal(sent.length,1,'a failure is sent without waiting for the healthy batch');
await Promise.all(pending);
assert.equal(sent.length,2);
assert.equal(writes,2,'one grouped write for 24 successful starts plus one immediate failure');
const batchReport=await(await playbackTimingsRoute(grouped,new Request('https://private/operations/timing-read',{method:'POST',body:'{}'}))).json();
assert.equal(batchReport.groups[0].requests,25);
assert.equal(batchReport.groups[0].failures,1);
assert.equal(batchReport.groups[0].stages.total.samples,25);

const duringRollout=[],tasks=[];
const legacy={idFromName:name=>name,get:()=>({fetch:async(url,options)=>{
 const body=JSON.parse(options.body);duringRollout.push(body);
 return new Response(null,{status:body.timings?400:200});
}})};
for(let index=0;index<2;index++)queuePlaybackTiming(legacy,{waitUntil:p=>tasks.push(p)},regular);
await Promise.all(tasks);
assert.deepEqual(duringRollout.map(body=>[!!body.timings,!!body.timing]),[[true,false],[false,true],[false,true]]);
