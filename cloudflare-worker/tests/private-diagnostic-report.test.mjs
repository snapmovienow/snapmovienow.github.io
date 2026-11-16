import test from 'node:test';
import assert from 'node:assert/strict';
import {buildPrivateDiagnosticReport} from '../src/private-diagnostic-report.mjs';

const NOW=Date.UTC(2026,10,16,12),SECRET='PRIVATE_SENTINEL_do_not_export';
function fixture(){return {
 generatedAt:NOW,version:'43',readStatuses:{snapshot:'observed',timings:'observed',canary:'observed',mapping:'not_observed'},
 snapshot:{inventory:{state:'available',configuredSources:2,observedSources:2,freshSources:2,missingSources:0,staleSources:0,retainedAfterFailedRefresh:0,physicalAccounts:12,eligibleAccounts:11,totalCapacity:33,reported:4,reserved:5,available:24,unknownMembership:0,unmatchedProviderReservations:0,syncedAt:NOW-1000,attemptedAt:NOW-1000,freshnessVerified:true},leases:{status:'available',reserved:5,unmatchedProviderReservations:0},health:{status:'available',lastObservedAt:NOW-50,circuits:[],recentMediaFailures:[]},rotation:{statsStatus:'available',completed:17,lastCompletedAt:NOW-2000,policy:{enabled:true,minHours:24,targetHours:36,overdueHours:48,minimumMonths:2,preferredMonths:3,scheduledOffersPerRequest:1,midnightPreference:true,healthBeforeBalance:true,activePlayback:'preserve',confirmation:'account-and-media'}},mapping:{status:'not_requested',checked:0,registered:0,inconsistent:0,notRegistered:0,samples:[],catalogCurrentVerified:false}},
 timings:{windowMinutes:15,groups:[]},canary:{configured:true,enabled:true,lastCheckedAt:NOW-50,results:[]},
 selfCheck:{version:1,scope:'controlled_bytes_only',checkedAt:NOW,status:'passed',checks:{initialPayload:'passed',rangeRecovery:'passed',streamGuard:'passed'},failureCode:null,elapsedMs:5}
};}
function failure(overrides={}){return {type:'live',server:'private-panel-id',id:'123',ext:'ts',lastObservedAt:NOW-50,sourcesObserved:2,httpStatuses:[504],failureCauses:[],...overrides};}
function timing(overrides={}){return {type:'live',platform:'other',requests:10,measuredRequests:10,failures:0,rawErrors:0,legacyFailures:0,accessRejected:0,cancelled:0,clientCapacity:0,stages:{total:{samples:10,avgMs:300,p95UpperMs:1000},allocation:{samples:10,avgMs:10,p95UpperMs:100}},statusCounts:{200:10},errorCounts:{},...overrides};}
const build=(input,options={})=>buildPrivateDiagnosticReport(input,{now:NOW,...options});

test('projects finite, bounded infrastructure facts without declaring playback healthy',()=>{
 const input=fixture();input.timings.groups=[timing()];
 const report=build(input);
 assert.equal(report.schema,'SNAP-private-diagnostic-v1');assert.equal(report.complete,true);assert.equal(report.classification,'unknown');
 assert.equal(report.snapshot.inventory.totalCapacity,33);assert.equal(report.snapshot.rotation.completed,17);
 assert.equal(report.snapshot.rotation.policy.activePlayback,'preserve');assert.equal(report.timings.groups[0].stages.allocation.avgMs,10);
 assert.equal(report.snapshot.mapping.checked,0);assert.equal(report.readStatuses.mapping,'not_observed');
 assert.equal(report.limitations.playbackValidated,false);assert.equal(report.selfCheck.devicePlaybackVerified,false);
 assert.ok(new TextEncoder().encode(JSON.stringify(report)).byteLength<=12000);
});

test('missing or malformed observations remain unknown and never become zero or complete',()=>{
 const report=build({});assert.equal(report.classification,'unknown');assert.equal(report.complete,false);
 assert.equal(report.snapshot.inventory.totalCapacity,null);assert.equal(report.snapshot.leases.reserved,null);
 assert.equal(report.readStatuses.snapshot,'unknown');assert.equal(report.selfCheck.status,'unknown');
 const input=fixture();delete input.snapshot.inventory.totalCapacity;assert.equal(build(input).complete,false);
 input.snapshot.inventory.totalCapacity=Infinity;input.snapshot.inventory.available=NaN;input.snapshot.inventory.syncedAt=NOW+1;
 const invalid=build(input);assert.equal(invalid.snapshot.inventory.totalCapacity,null);assert.equal(invalid.snapshot.inventory.available,null);assert.equal(invalid.snapshot.inventory.syncedAt,null);
 assert.equal(JSON.stringify(invalid).includes('NaN'),false);
});

test('drops hostile private strings at every projection boundary and pseudonymizes source identities',()=>{
 const input=fixture();input.rawKV={secret:SECRET};input.headers={authorization:SECRET};input.stack=SECRET;input.version=SECRET;
 input.snapshot.inventory.username=SECRET;input.snapshot.inventory.url='https://'+SECRET;input.snapshot.rotation.policy.activePlayback=SECRET;
 input.snapshot.health.recentMediaFailures=[failure({server:SECRET,password:SECRET,headers:{x:SECRET},url:SECRET,title:SECRET}),failure({id:'456',server:SECRET})];
 input.canary.username=SECRET;input.canary.results=[{type:'live',status:'failed',reason:SECRET,at:NOW,totalMs:1,username:SECRET,stages:{authenticationMs:1,[SECRET]:1},failure:{phase:'media_headers',code:SECRET,httpStatus:502,message:SECRET,request:{url:SECRET}}}];
 input.timings.groups=[timing({errorCounts:{[SECRET]:5,stream_unavailable:2},statusCounts:{200:4,[SECRET]:8},stages:{total:{samples:2,avgMs:10,p95UpperMs:100},[SECRET]:{samples:1,avgMs:1,p95UpperMs:1}}})];
 const output=build(input),json=JSON.stringify(output);assert.equal(json.includes(SECRET),false);assert.equal(output.version,null);
 assert.deepEqual(output.mediaFailures.map(row=>row.source),['source-1','source-1']);assert.equal(output.canary.results[0].reason,'unknown');
 assert.deepEqual(output.timings.groups[0].errorCounts,{stream_unavailable:2});assert.equal(output.complete,false);
});

test('does not evaluate own or inherited getters and ignores prototype fields',()=>{
 let invoked=0;const input=fixture();Object.defineProperty(input,'version',{get(){invoked++;return SECRET;}});
 Object.defineProperty(input.snapshot.inventory,'username',{get(){invoked++;throw Error(SECRET);}});
 Object.defineProperty(input.snapshot.inventory,'totalCapacity',{get(){invoked++;throw Error(SECRET);}});
 input.canary=Object.create({username:SECRET,enabled:true});
 const output=build(input);assert.equal(invoked,0);assert.equal(output.version,null);assert.equal(output.snapshot.inventory.totalCapacity,null);assert.equal(output.canary.enabled,null);assert.equal(JSON.stringify(output).includes(SECRET),false);
 const nullObject=Object.create(null);nullObject.version='43';assert.equal(build(nullObject).version,'43');
 const arrayInput=fixture();Object.defineProperty(arrayInput.timings.groups,'0',{get(){invoked++;throw Error(SECRET);},configurable:true});
 assert.equal(build(arrayInput).invalidFields,1);assert.equal(invoked,0);
});

test('HTTP errors, long stages and local deadlines alone do not assign responsibility',()=>{
 for(const status of [400,401,404,416,500,502,504]){
  const input=fixture();input.snapshot.health.recentMediaFailures=[failure({httpStatuses:[status]})];input.timings.groups=[timing({failures:1,stages:{origin:{samples:1,avgMs:300000,p95UpperMs:300000}},statusCounts:{[status]:1}})];
  assert.equal(build(input).classification,'unknown');
 }
 const input=fixture();input.snapshot.health.recentMediaFailures=[failure({failureCauses:[{httpStatus:504,errorOrigin:'local_deadline',serviceError:'live_startup_timeout'}]})];
 assert.equal(build(input).classification,'unknown');
});

test('only a complete, fresh server-recorded response-origin tuple yields upstream_response',()=>{
 const input=fixture();input.snapshot.health.recentMediaFailures=[failure({failureCauses:[{httpStatus:504,errorOrigin:'upstream_response',serviceError:'upstream_unavailable'}]})];
 const report=build(input);assert.equal(report.classification,'upstream_response');assert.equal(report.limitations.upstreamResponseDoesNotProveResponsibility,true);
 input.snapshot.health.recentMediaFailures[0].lastObservedAt=NOW-16*60000;assert.equal(build(input).classification,'unknown');
 input.snapshot.health.recentMediaFailures[0].lastObservedAt=NOW;input.snapshot.health.recentMediaFailures[0].failureCauses[0].serviceError='live_startup_timeout';assert.equal(build(input).classification,'unknown');
 input.snapshot.health.recentMediaFailures[0].failureCauses[0].serviceError='upstream_unavailable';input.readStatuses.snapshot='unknown';assert.equal(build(input).classification,'unknown');
});

test('expected policy decisions are distinguishable from unconfirmed failures',()=>{
 const input=fixture();input.timings.groups=[timing({accessRejected:2,cancelled:1,clientCapacity:1})];
 assert.equal(build(input).classification,'local_policy');assert.equal(build(input).findings[0].count,4);
 input.timings.groups[0].failures=1;assert.equal(build(input).classification,'unknown');
 input.timings.groups[0].failures=0;input.readStatuses.timings='unknown';assert.equal(build(input).classification,'unknown');
});

test('confirmed registry inconsistency retains exact numeric IDs for repair and no provider identity',()=>{
 const input=fixture();input.readStatuses.mapping='observed';input.mapping={status:'available',checked:2,registered:1,inconsistent:1,notRegistered:0,samples:[{queryIndex:0,state:'registered',kind:'live',publicId:'987',upstreamId:'123',server:SECRET},{queryIndex:1,state:'registry_inconsistent',kind:'episode',publicId:'988',upstreamId:'124',username:SECRET}]};
 const report=build(input);assert.equal(report.classification,'local_fault');assert.equal(report.mappingReferences[1].upstreamIdScope,'upstream_content');assert.equal(report.mappingReferences[1].publicIdScope,'public_catalog');assert.equal(report.mappingReferences[1].upstreamId,'124');assert.equal(JSON.stringify(report).includes(SECRET),false);
 input.mapping.samples=[];assert.equal(build(input).classification,'unknown');
 input.mapping.samples=[{queryIndex:1,state:'registry_inconsistent',kind:'episode',publicId:SECRET,upstreamId:SECRET}];assert.equal(build(input).classification,'unknown');
 input.mapping.samples=[{state:'not_registered',kind:'episode',upstreamId:'124'}];input.mapping.inconsistent=0;input.mapping.notRegistered=1;assert.equal(build(input).classification,'unknown');
});

test('legacy exact-registry reference format is projected without raw queries or URLs',()=>{
 const input=fixture();input.readStatuses.mapping='observed';input.mapping={status:'available',checked:1,registered:0,inconsistent:1,notRegistered:0,references:[{query:{kind:'live',server:SECRET,upstreamId:'123',url:SECRET},state:'registry_inconsistent',reference:{kind:'live',publicId:'555',server:SECRET,upstreamId:'123',password:SECRET}}]};
 const report=build(input);assert.equal(report.mappingReferences[0].source,'source-1');assert.equal(report.classification,'local_fault');assert.equal(JSON.stringify(report).includes(SECRET),false);
});

test('only fresh, matching controlled-check failures establish a local code-path fault',()=>{
 const input=fixture();input.selfCheck.status='failed';input.selfCheck.checks.rangeRecovery='failed';input.selfCheck.failureCode='range_recovery_failed';
 assert.equal(build(input).classification,'local_fault');assert.equal(build(input).complete,false);
 for(const code of ['self_check_timeout','self_check_unavailable',null,SECRET,'initial_payload_failed']){input.selfCheck.failureCode=code;assert.equal(build(input).classification,'unknown');}
 input.selfCheck.failureCode='range_recovery_failed';input.selfCheck.checkedAt=NOW-16*60000;assert.equal(build(input).classification,'unknown');
 input.selfCheck.checkedAt=NOW;input.selfCheck.scope=SECRET;assert.equal(build(input).classification,'unknown');
});

test('caps arrays and log bytes with explicit omissions instead of implying missing entries passed',()=>{
 const input=fixture();input.snapshot.health.recentMediaFailures=Array.from({length:200},(_,i)=>failure({id:String(i)}));
 input.timings.groups=Array.from({length:100},()=>timing({statusCounts:Object.fromEntries(Array.from({length:500},(_,i)=>[String(i+100),1]))}));
 input.mapping={status:'available',checked:100,registered:100,inconsistent:0,notRegistered:0,samples:Array.from({length:100},(_,i)=>({state:'registered',kind:'movie',publicId:String(i),upstreamId:String(i)}))};
 for(const maxBytes of [512,1000,4000,9500,12000]){
  const report=build(input,{maxBytes});assert.ok(new TextEncoder().encode(JSON.stringify(report)).byteLength<=maxBytes);assert.equal(report.truncated,true);assert.equal(report.complete,false);assert.equal(report.classification,'unknown');assert.ok(Object.values(report.omitted).some(value=>value>0));assert.equal(JSON.stringify(report).includes(SECRET),false);
 }
});

test('a proven fault removed by size trimming cannot leave a positive fault claim',()=>{
 const input=fixture();input.readStatuses.mapping='observed';input.mapping={status:'available',checked:1,registered:0,inconsistent:1,notRegistered:0,samples:[{queryIndex:0,state:'registry_inconsistent',kind:'movie',upstreamId:'123'}]};
 assert.equal(build(input).classification,'local_fault');assert.equal(build(input,{maxBytes:512}).classification,'unknown');
});

test('canonical canary phase and safe operation survive while unknown telemetry cannot be complete',()=>{
 const input=fixture();input.canary.status='failed';input.canary.running=false;input.canary.username=SECRET;input.canary.results=[{type:'movie',status:'failed',reason:'playback_unavailable',at:NOW-20,stages:{catalogPrepareMs:250},failure:{phase:'catalog_prepare',code:'http_error',httpStatus:503,operation:'vod',serviceError:'ccf_capacity',url:SECRET}}];
 let report=build(input);assert.equal(report.canary.status,'failed');assert.equal(report.canary.fresh,true);assert.equal(report.canary.results[0].failure.operation,'vod');assert.equal(report.canary.results[0].failure.serviceError,'ccf_capacity');assert.equal(report.classification,'unknown');assert.equal(JSON.stringify(report).includes(SECRET),false);
 input.timings.groups=[timing({requests:NaN})];assert.equal(build(input).complete,false);
 input.timings.groups=[];input.canary=null;assert.equal(build(input).complete,false);
 input.canary={configured:true,enabled:true};input.generatedAt=NOW+1;report=build(input);assert.equal(report.complete,false);
});
