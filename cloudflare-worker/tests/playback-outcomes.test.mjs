import assert from 'node:assert/strict';
import {playbackErrorCode,playbackErrorHeaders,expectedPlaybackOutcome} from '../src/playback-outcomes.mjs';
import {playbackTimingsRoute,startupTimingObservations} from '../src/playback-timings.mjs';
import {traceRequest} from '../src/request-diagnostics.mjs';
import {createXtreamBridge} from '../src/xtream-bridge.mjs';
import {applyObservations} from '../src/monitor.mjs';
class Store{
 constructor(){this.data=new Map()}
 async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))}async transaction(fn){return fn(this)}
}
const store=new Store(),route=(path,body={})=>playbackTimingsRoute(store,new Request('https://private/operations/'+path,{method:'POST',body:JSON.stringify(body)}));
const ingest=async(status,errorCode,platform='other')=>{const r=await route('timing-ingest',{timing:{type:'live',platform,status,errorCode,totalMs:100,stages:{auth:{ms:50,count:1}}}});assert.equal(r.status,200)};
const excluded=[[401,'invalid_credentials','accessRejected'],[401,'account_expired','accessRejected'],[403,'content_disabled','accessRejected'],[409,'user_connection_limit','clientCapacity'],[410,'playback_superseded','cancelled'],[410,'session_expired','cancelled']];
for(const [status,code,category]of excluded){assert.equal(expectedPlaybackOutcome(status,code),category);await ingest(status,code)}
let group=(await (await route('timing-read')).json()).groups[0];
assert.equal(group.requests,6);assert.equal(group.measuredRequests,0);assert.equal(group.failures,0);assert.equal(group.rawErrors,6);
assert.deepEqual([group.accessRejected,group.clientCapacity,group.cancelled],[3,1,2]);
assert.deepEqual(startupTimingObservations([group]),[],'denials/cancellations alone cannot open or resolve a playback incident');
const genuine=[[401,'upstream_unavailable'],[403,'upstream_unavailable'],[409,'ccf_capacity'],[502,'xtream_unavailable'],[503,'provider_unavailable'],[504,'live_startup_timeout'],[500,'invalid_credentials'],[401,undefined],[410,undefined]];
for(const [status,code]of genuine){assert.equal(expectedPlaybackOutcome(status,code),null);await ingest(status,code)}
group=(await (await route('timing-read')).json()).groups[0];
assert.equal(group.requests,15);assert.equal(group.measuredRequests,9);assert.equal(group.failures,9);assert.equal(group.rawErrors,15);assert.equal(group.stages.total.samples,9);
const observation=startupTimingObservations([group])[0];assert.equal(observation.bad,true);assert.match(observation.detail,/HTTP 503: 1/);assert.match(observation.detail,/provider_unavailable: 1/);assert.match(observation.detail,/9 respuestas con error de 9 solicitudes de reproducción/);
assert.equal(playbackErrorCode('https://private/password'),undefined);assert.deepEqual(playbackErrorHeaders({error:'https://private/password'},502),{});
assert.deepEqual(playbackErrorHeaders({error:'provider_unavailable'},503),{'X-SMN-Error-Code':'provider_unavailable'});
const invalid=await route('timing-ingest',{timing:{type:'live',platform:'other',status:502,totalMs:1,stages:{},errorCode:'secret-password'}});assert.equal(invalid.status,400);
// Existing aggregates have no status evidence: retain their failures, even when
// the first new sample in their bucket is a harmless channel cancellation.
const bucket=Math.floor(Date.now()/300000),legacyKey='startup-timing:'+bucket+':live:web';
await store.put(legacyKey,{bucket,type:'live',platform:'web',requests:5,failures:5,stages:{total:{samples:5,sum:500,histogram:[5,...Array(10).fill(0)]}}});
await ingest(410,'playback_superseded','web');
const legacy=(await (await route('timing-read')).json()).groups.find(g=>g.platform==='web');assert.equal(legacy.failures,5);assert.equal(legacy.legacyFailures,5);assert.equal(legacy.measuredRequests,5);assert.equal(legacy.cancelled,1);assert.equal(startupTimingObservations([legacy])[0].bad,true);
// Exercise the real Xtream boundary: cancellation from managed allocation and
// from the media relay must be 410, while origin rejections remain failures.
const json=(body,status=200)=>Response.json(body,{status,headers:playbackErrorHeaders(body,status)});
let scenario='allocation_cancel',calls=0,releases=0,captured;
const deps={json,directory:async(_env,path)=>{
 if(path==='/xtream-config')return json({enabled:true,version:1});
 if(path==='/xtream-login')return json({id:'fixture',username:'viewer',version:1,permissions:{tv:true,movies:true,series:true,adults:true}});
 if(path==='/playback-begin')return json({ok:true});
 if(path==='/release'){releases++;return json({ok:true})}
 throw Error('Unexpected fixture directory operation '+path);
},sessionCall:async()=>json({exp:Date.now()+60000}),registry:async()=>json({kind:'live',server:'fixture',upstreamId:'1',activity:{title:'Fixture channel'}}),managedPlayback:async()=>{calls++;if(scenario==='allocation_cancel')throw Error('playback_superseded');return {r:json({lease_id:'fixture-lease'}),provider_id:'fixture-source',credentials:{username:'source',password:'synthetic',origin:'https://fixture.invalid'}}},ticket:async()=> 'fixture-ticket',serverStream:async()=>{
 if(scenario==='relay_cancel')return json({error:'playback_superseded'},410);
 if(scenario==='throw_cancel')throw Error('playback_superseded');
 return json({error:'invalid_credentials'},401);
}};
const bridge=createXtreamBridge(deps),req=new Request('https://fixture.invalid/live/viewer/synthetic/1.ts');
for(const current of ['allocation_cancel','relay_cancel','throw_cancel','origin_reject']){
 scenario=current;calls=0;releases=0;
 const r=await traceRequest(req,t=>bridge(req,{TICKET_SECRET:'fixture-test-secret'},undefined,t),{onTiming:t=>{captured=t},logger:()=>{}});
 const body=await r.json();assert.equal(r.status,current==='origin_reject'?401:410);
 assert.equal(body.error,current==='origin_reject'?'upstream_unavailable':'playback_superseded');assert.equal(captured.errorCode,body.error);
 assert.equal(calls,current==='origin_reject'?3:1,'channel cancellation cannot retry another provider');
 assert.equal(releases,current==='allocation_cancel'?0:calls);assert.ok(!JSON.stringify(captured).includes('synthetic'));
}
// Recovery must describe a new good sample, preserving the old incident and
// opening event for audit. An empty aggregate still cannot clear an incident.
const state={createdAt:Date.now(),config:{channel:'email',version:1},checks:{},incidents:{},history:[],outbox:[]};
const snapshot=timings=>({providers:{providers:[]},playback:{groups:[],timings},backups:{automaticStatus:'success',lastAutomaticAt:Date.now()}});
const bad={type:'live',platform:'other',requests:10,measuredRequests:10,failures:5,stages:{total:{p95UpperMs:1000}}};
let now=Date.now();applyObservations(state,snapshot([bad]),now);const opening=structuredClone(state.history[0]);
applyObservations(state,snapshot([]),now+=300000);assert.equal(state.incidents['startup:live:other'].status,'open');
applyObservations(state,snapshot([{...bad,failures:0}]),now+=300000);
const recovery=state.history[0].changes.find(c=>c.kind==='resolved');assert.equal(recovery.title,'Inicio de contenido');assert.match(recovery.detail,/0 respuestas con error/);assert.ok(!recovery.detail.includes('5 respuestas'));
assert.deepEqual(state.history[1],opening);assert.match(state.incidents['startup:live:other'].detail,/5 respuestas con error/);assert.match(state.outbox.at(-1).changes[0].detail,/0 respuestas con error/);
console.log('PASS: exact outcome classification, real Xtream cancellation/retry boundary, upstream failures retained, legacy evidence preserved, redacted status codes and evidence-based recovery emails.');
