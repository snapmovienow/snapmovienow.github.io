import assert from 'node:assert/strict';
import {createXtreamBridge} from '../src/xtream-bridge.mjs';
import {recordProviderHealth,recentMediaFailures,providerCircuitState} from '../src/provider-health.mjs';
import {classifyObservation} from '../src/range-observation.mjs';
import {initialRangeEvidence,cleanInitialRangeEvidence,rangeFailureDetail} from '../src/initial-range-evidence.mjs';
import {initialRangeEvidenceText} from '../../admin-alerts.js';
import {readFileSync} from 'node:fs';
const realFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('No external network in this offline fixture')};
const json=(body,status=200)=>Response.json(body,{status}),mediaKey='movie|ccf|101|mp4',now=2000000;
async function sample(requestRange){
 const reports=[];let mediaCalls=0;
 const deps={json,
 directory:async(env,path,body)=>{
  if(path==='/xtream-config')return json({enabled:true,version:1});
  if(path==='/xtream-login')return json({id:'synthetic-viewer',username:'synthetic',version:1,permissions:{movies:true,adults:true}});
  if(path==='/provider-result')reports.push(body);
  if(['/playback-begin','/provider-result','/release'].includes(path))return json({ok:true});
  throw Error('unexpected fixture path '+path);
 },
 sessionCall:async()=>json({exp:Date.now()+60000}),
 registry:async(env,path)=>{assert.equal(path,'/xtream-resolve');return json({kind:'movie',server:'ccf',upstreamId:'101',ext:'mp4',activity:{title:'Synthetic'}})},
 managedPlayback:async()=>({r:json({lease_id:'synthetic-lease'}),provider_id:'synthetic-source',credentials:{username:'fixture',password:'fixture',origin:'https://synthetic.invalid'}}),
 ticket:async()=>'synthetic-ticket',
 serverStream:async request=>{mediaCalls++;assert.equal(request.headers.get('range'),requestRange);return new Response(null,{status:416,headers:{'content-range':'bytes */100','accept-ranges':'bytes'}})}
 };
 const response=await createXtreamBridge(deps)(new Request('https://synthetic.invalid/movie/synthetic/fixture/1.mp4',{headers:{range:requestRange}}),{TICKET_SECRET:'synthetic-test-only',PLAYBACK_SESSIONS:{}},{});
 assert.equal(response.status,416);assert.equal(response.headers.get('content-range'),'bytes */100');assert.equal(mediaCalls,1);assert.equal(reports.length,1);assert.equal(reports[0].httpStatus,416);
 const report=reports[0];let health={};
 for(let i=0;i<3;i++)health=recordProviderHealth(health,'synthetic-source',mediaKey,report.ok,1,report.stage,now+i,null,null,report.httpStatus,report);
 const retained=recentMediaFailures(health,now+3);
 const inference=classifyObservation({caseKey:'synthetic',method:'GET',outgoingMethod:'GET',phase:'initial',transport:'mock',incomingRange:requestRange,outgoingRange:requestRange,status:416,contentRange:'bytes */100'});
 assert.equal(inference.definitiveCause,false);
 return {retained,inference,circuitBlocked:providerCircuitState(health,'synthetic-source',mediaKey,now+3).blocked,mediaCalls};
}
try{
 const unsatisfiable=await sample('bytes=100-199'),compatible=await sample('bytes=0-99');
 assert.equal(unsatisfiable.inference.reason,'request_unsatisfiable_for_reported_size');
 assert.equal(compatible.inference.reason,'rejection_despite_satisfiable_reported_bounds');
 assert.notDeepEqual(unsatisfiable.retained,compatible.retained,'distinct numeric range evidence survives the native report and health projection');
 assert.deepEqual(unsatisfiable.retained[0].rangeEvidence[0].outgoingRange,{kind:'bytes',start:100,end:199});
 assert.deepEqual(compatible.retained[0].rangeEvidence[0].outgoingRange,{kind:'bytes',start:0,end:99});
 assert.equal(unsatisfiable.circuitBlocked,false);assert.equal(compatible.circuitBlocked,false);
 console.log('PASS: initial native 416 retains distinct numeric evidence with unchanged requests and no resource circuit penalty.');
}finally{globalThis.fetch=realFetch}

const capture=(range,total='bytes */100',method='GET')=>initialRangeEvidence(new Request('https://synthetic.invalid/',{method,headers:{...(range===undefined?{}:{range}),'if-range':'private-validator'}}),new Response(null,{status:416,headers:{'content-range':total,'content-length':'999','X-SMN-Case-Observation':'private-forged-observation','X-SMN-Range-Evidence':'private-forged-evidence'}}));
const good=capture('bytes=0-99');
assert.equal(good.reportedTotal,100);assert.equal(good.ifRangePresent,true);
assert.deepEqual(capture('bytes=-10').outgoingRange,{kind:'suffix',length:10});
assert.equal(capture('bytes=0-0,2-3,5-6,-10').outgoingRange.ranges.length,4);
for(const range of ['bytes=0-0,2-2,4-4,6-6,8-8','bytes=9007199254740992-','bytes=9-2','bytes=-','x'.repeat(257)])assert.equal(capture(range).outgoingRange.kind,'invalid');
assert.equal(capture(undefined).incomingRange.kind,'absent');
for(const total of ['bytes */9007199254740992','bytes 0-99/100','private-size','bytes */'+'1'.repeat(257)])assert.equal(capture('bytes=0-1',total).reportedTotal,null,'never fall back to the error-body length or forged header');
assert.equal(capture('bytes=0-1','bytes */0').reportedTotal,0);
assert.deepEqual(capture('bytes=5-10','bytes */100','HEAD').outgoingRange,{kind:'bytes',start:0,end:0});
assert.deepEqual(capture('bytes=5-10','bytes */100','HEAD').incomingRange,{kind:'bytes',start:5,end:10});
assert.equal(initialRangeEvidence(new Request('https://synthetic.invalid/'),new Response(null,{status:200})),null);
assert.equal(initialRangeEvidence(new Request('https://synthetic.invalid/',{method:'POST'}),new Response(null,{status:416})),null);
assert.equal(cleanInitialRangeEvidence({...good,phase:'resume'}),null);
assert.equal(cleanInitialRangeEvidence({...good,outgoingRange:{kind:'bytes',start:1,end:2}}),null,'contradictory GET evidence is not accepted');
assert.equal(cleanInitialRangeEvidence({...good,method:'HEAD'}),null,'HEAD evidence must match the known one-byte probe');
assert.equal(cleanInitialRangeEvidence(Object.create(good)),null,'inherited fields cannot fabricate a retained observation');
const getter=Object.defineProperty({},'method',{get(){assert.fail('untrusted getter must not run')}});assert.equal(cleanInitialRangeEvidence(getter),null);
const parts=[];Object.defineProperty(parts,'0',{get(){assert.fail('range getter must not run')}});parts[1]={kind:'suffix',length:1};
const accessorRange={kind:'multiple',ranges:parts};assert.equal(cleanInitialRangeEvidence({...good,incomingRange:accessorRange,outgoingRange:accessorRange}).outgoingRange.kind,'unknown');
for(const bad of [-1,Infinity,NaN,1.5,'100',Number.MAX_SAFE_INTEGER+1])assert.equal(cleanInitialRangeEvidence({...good,reportedTotal:bad}).reportedTotal,null);
assert.deepEqual(rangeFailureDetail(504,{rangeEvidence:good}),{});
const dirty={...good,url:'https://private.invalid/password',headers:{authorization:'private-secret'},ifRange:'private-validator',username:'private-account'};
const safe=cleanInitialRangeEvidence(dirty);assert.deepEqual(safe,good);assert.ok(!JSON.stringify(safe).includes('private'));
assert.ok(JSON.stringify(capture('bytes=0-0,2-3,5-6,-9007199254740991')).length<700);

let health={};const put=(source,evidence,time=now)=>health=recordProviderHealth(health,source,mediaKey,false,1,'signal',time,null,null,416,{rangeEvidence:evidence});
put('private-source-1',good);put('private-source-2',good);
let rows=recentMediaFailures(health,now);assert.equal(rows[0].sourcesObserved,2);assert.equal(rows[0].rangeEvidence.length,1);assert.equal(rows[0].rangeEvidenceIncomplete,false);
put('private-source-3',capture('bytes=1-2'));put('private-source-4',capture('bytes=2-3'));put('private-source-5',capture('bytes=3-4'));
rows=recentMediaFailures(health,now);assert.equal(rows[0].rangeEvidence.length,3);assert.equal(rows[0].rangeEvidenceIncomplete,true);
put('private-legacy',undefined);rows=recentMediaFailures(health,now);assert.equal(rows[0].rangeEvidenceIncomplete,true);assert.ok(!JSON.stringify(rows).includes('private'));
put('private-partial',capture('bytes=0-1','invalid'));assert.equal(recentMediaFailures(health,now)[0].rangeEvidenceIncomplete,true);
assert.deepEqual(recentMediaFailures(health,now+1800001),[],'same 30-minute TTL');
for(let i=0;i<600;i++)health=recordProviderHealth(health,'private-source-'+i,'movie|ccf|'+(1000+i)+'|mp4',false,1,'signal',now+i,null,null,416,{rangeEvidence:capture('bytes=0-0,2-3,5-6,-9007199254740991')});
assert.ok(Object.keys(health).length<=512);assert.ok(new TextEncoder().encode(JSON.stringify(health)).byteLength<128000);assert.equal(recentMediaFailures(health,now+600).length,30);
// Diagnostic-only: preserve the existing Web 416 exclusion and lease gate.
assert.match(readFileSync(new URL('../src/index.js',import.meta.url),'utf8'),/\[410,416\]\.includes\(response.status\)/);
assert.match(readFileSync(new URL('../src/accounts.mjs',import.meta.url),'utf8'),/lease\.sid!==b.sid\|\|lease.request_id!==b.request_id\|\|lease.provider_id!==b.provider_id/);
assert.match(initialRangeEvidenceText(good),/Rango solicitado: 0–99.*Tamaño declarado: 100 bytes.*If-Range: presente/);
assert.match(initialRangeEvidenceText(good),/no determina causa ni acredita la misma representación/);
assert.ok(!initialRangeEvidenceText(dirty).includes('private'));
assert.ok(!initialRangeEvidenceText({...good,reportedTotal:'private-secret',outgoingRange:{kind:'bytes',start:'private-secret',end:2}}).includes('private'));
assert.equal(initialRangeEvidenceText({...good,method:'private-method'}),'416 inicial: rango no retenido');
console.log('PASS: HEAD/GET, four-part bounds, untrusted input redaction, deduplication, saturation, 30-row/30-minute bounds and safe UI labels.');
