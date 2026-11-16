import test from 'node:test';
import assert from 'node:assert/strict';
import {privateDiagnosticReportRoute,boundedDiagnosticRead,schedulePrivateDiagnosticReport,PRIVATE_DIAGNOSTIC_OBJECT} from '../src/private-diagnostic-collector.mjs';

class Store{
 constructor(){this.rows=new Map();this.queue=Promise.resolve();}
 async get(key){return structuredClone(this.rows.get(key));}
 async put(key,value){this.rows.set(key,structuredClone(value));}
 transaction(fn){const next=this.queue.then(()=>fn(this));this.queue=next.catch(()=>{});return next;}
}
const at=Date.UTC(2026,10,16,22),env={ENVIRONMENT:'production',PRIVATE_DIAGNOSTIC_REPORTS_ENABLED:'true'};
const controlled=()=>({version:1,scope:'controlled_bytes_only',checkedAt:at,status:'passed',elapsedMs:1,checks:{initialPayload:'passed',rangeRecovery:'passed',streamGuard:'passed'},failureCode:null});
function fixture(){
 const storage=new Store(),logs=[],calls=[];
 const deps={now:()=>at,selfCheck:controlled,logger:value=>logs.push(value),
  readSnapshot:async(queries,signal)=>{calls.push({kind:'snapshot',queries,signal});return Response.json({generatedAt:at,readOnly:true,inventory:{state:'available',configuredSources:2,observedSources:2,freshSources:2,missingSources:0,staleSources:0,physicalAccounts:10,eligibleAccounts:10,totalCapacity:30,reported:2,reserved:1,available:27,unknownMembership:0},leases:{status:'available',reserved:1,orphanedReservations:0},rotation:{policy:{enabled:true},completed:2,lastCompletedAt:at-1000},health:{lastObservedAt:at,circuits:[],recentMediaFailures:[]},mapping:{checked:0,registered:0,inconsistent:0,notRegistered:0}});},
  readTimings:async signal=>{calls.push({kind:'timings',signal});return Response.json({windowMinutes:15,groups:[]});},
  readCanary:async signal=>{calls.push({kind:'canary',signal});return Response.json({canary:{configured:true,enabled:true,status:'healthy',lastCheckedAt:at,results:[]},settings:{apiKey:'must-not-leave',to:'private@example.invalid'}});}
 };
 const run=()=>privateDiagnosticReportRoute(storage,env,'/private-diagnostic/run',deps);
 return {storage,logs,calls,deps,run};
}
test('concurrent ticks publish one allowlisted report without provider or customer operations',async()=>{
 const f=fixture(),replies=await Promise.all(Array.from({length:10},f.run));
 assert.ok(replies.every(r=>r.status===200));assert.equal(f.logs.length,1);assert.equal(f.calls.length,3);assert.deepEqual(f.calls.map(c=>c.kind).sort(),['canary','snapshot','timings']);
 const output=JSON.stringify([...f.storage.rows.values(),...f.logs]);assert.ok(!output.includes('must-not-leave'));assert.ok(!output.includes('private@example.invalid'));assert.ok(new TextEncoder().encode(JSON.stringify(f.logs[0])).length<13000);
 const status=await (await privateDiagnosticReportRoute(f.storage,env,'/private-diagnostic/status',f.deps)).json();assert.equal(status.readStatus,'observed');assert.equal(status.stale,false);assert.equal(status.intervalMinutes,5);
 f.deps.now=()=>at+300000;assert.equal((await f.run()).status,200);assert.equal(f.logs.length,2,'the next five-minute interval is collected');
});
test('disabled and staging do not read or create report data',async()=>{
 for(const value of [{...env,ENVIRONMENT:'staging'},{...env,PRIVATE_DIAGNOSTIC_REPORTS_ENABLED:'false'},{}]){
  const f=fixture();const result=await privateDiagnosticReportRoute(f.storage,value,'/private-diagnostic/run',f.deps);assert.equal(result.status,200);assert.equal(f.calls.length,0);assert.equal(f.storage.rows.size,0);assert.equal(f.logs.length,0);
 }
});
test('only ten validated references from existing observations can cause bounded mapping reads',async()=>{
 const f=fixture(),base=f.deps.readSnapshot;f.deps.readSnapshot=async(queries,signal)=>{
  const response=await base(queries,signal),value=await response.json();value.health.recentMediaFailures=[{type:'live',id:'not-numeric',server:'https://secret.invalid'},...Array.from({length:15},(_,i)=>({type:i%2?'series':'live',id:String(i+1),server:'ccf',lastObservedAt:at,httpStatuses:[404]}))];
  value.mapping=queries.length?{checked:queries.length,registered:9,inconsistent:1,notRegistered:0,samples:[{queryIndex:0,kind:'live',state:'registry_inconsistent',publicId:'1'}]}:value.mapping;return Response.json(value);
 };
 assert.equal((await f.run()).status,200);const reads=f.calls.filter(c=>c.kind==='snapshot');assert.equal(reads.length,2);assert.equal(reads[1].queries.length,10);assert.ok(reads[1].queries.every(q=>/^\d+$/.test(q.upstreamId)&&q.server==='ccf'));assert.ok(!JSON.stringify(f.logs).includes('secret.invalid'));
});
test('failed reads produce unknown evidence, never a fabricated healthy report or leaked exception',async()=>{
 const f=fixture();f.deps.componentMs=10;f.deps.totalMs=50;f.deps.readSnapshot=()=>{throw Error('secret-token https://private.invalid');};f.deps.readTimings=()=>new Promise(()=>{});
 const start=Date.now();assert.equal((await f.run()).status,200);assert.ok(Date.now()-start<500);assert.equal(f.logs.length,1);assert.ok(!JSON.stringify(f.logs).includes('secret-token'));assert.equal(f.logs[0].report.complete,false);assert.equal(f.logs[0].report.readStatuses.snapshot,'unknown');assert.equal(f.logs[0].report.readStatuses.timings,'unknown');
});
test('bounded reads abort slow or oversized bodies and cancel late responses',async()=>{
 let resolve,cancelled=false,signal;const late=boundedDiagnosticRead(s=>{signal=s;return new Promise(r=>resolve=r);},{timeoutMs:10});assert.equal((await late).status,'unknown');assert.equal(signal.aborted,true);
 resolve(new Response(new ReadableStream({cancel(){cancelled=true;}})));await new Promise(r=>setTimeout(r,10));assert.equal(cancelled,true);
 const huge=await boundedDiagnosticRead(()=>Response.json({raw:'x'.repeat(140000)}));assert.equal(huge.status,'unknown');assert.equal(huge.reason,'invalid_response');
 assert.equal((await boundedDiagnosticRead(()=>new Response('{bad'))).status,'unknown');assert.equal((await boundedDiagnosticRead(()=>new Response('private',{status:503}))).status,'unknown');
});
test('logging failure cannot change the stored result or escape to customer playback',async()=>{
 const f=fixture();f.deps.logger=()=>{throw Error('logging failed');};assert.equal((await f.run()).status,200);const value=await (await privateDiagnosticReportRoute(f.storage,env,'/private-diagnostic/status',f.deps)).json();assert.equal(value.readStatus,'observed');
});
test('the scheduler makes one internal request only with the production operator flag',async()=>{
 const paths=[],waits=[],binding={idFromName:id=>id,get:id=>({fetch:(url,options)=>{paths.push({id,url,options});return Promise.resolve(Response.json({ok:true}));}})};
 assert.equal(schedulePrivateDiagnosticReport({...env,PLAYBACK_SESSIONS:binding},{waitUntil:p=>waits.push(p)}),true);await Promise.all(waits);assert.equal(paths.length,1);assert.equal(paths[0].id,PRIVATE_DIAGNOSTIC_OBJECT);assert.equal(paths[0].url,'https://private/private-diagnostic/run');
 for(const value of [{...env,ENVIRONMENT:'staging'},{...env,PRIVATE_DIAGNOSTIC_REPORTS_ENABLED:'false'},{}])assert.equal(schedulePrivateDiagnosticReport({...value,PLAYBACK_SESSIONS:binding},{waitUntil:p=>waits.push(p)}),false);
 assert.equal(paths.length,1);
});
