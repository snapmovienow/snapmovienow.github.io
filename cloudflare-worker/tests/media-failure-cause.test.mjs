import assert from 'node:assert/strict';
import {createXtreamBridge} from '../src/xtream-bridge.mjs';
import {playbackErrorHeaders} from '../src/playback-outcomes.mjs';
import {mediaFailureCause} from '../src/media-failure-cause.mjs';
import {recordProviderHealth,recentMediaFailures} from '../src/provider-health.mjs';
const realFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Network is forbidden in this synthetic fixture')};

const json=(body,status=200)=>Response.json(body,{status,headers:playbackErrorHeaders(body,status)});
async function failure(code){
 const reports=[],pending=[];let mediaCalls=0;
 const deps={json,
  directory:async(env,path,body)=>{
   if(path==='/xtream-config')return json({enabled:true,version:1});
   if(path==='/xtream-login')return json({id:'synthetic-viewer',username:'synthetic',version:1,permissions:{movies:true,adults:true}});
   if(path==='/provider-result')reports.push(body);
   if(['/playback-begin','/provider-result','/release'].includes(path))return json({ok:true});
   throw Error('unexpected fixture directory operation: '+path);
  },
  sessionCall:async()=>json({exp:Date.now()+60000}),
  registry:async(env,path)=>{assert.equal(path,'/xtream-resolve');return json({kind:'movie',server:'ccf',upstreamId:'101',ext:'mp4',activity:{title:'Synthetic'}})},
  managedPlayback:async()=>({r:json({lease_id:'synthetic-lease'}),provider_id:'synthetic-source',credentials:{username:'fixture',password:'fixture',origin:'https://synthetic.invalid'}}),
  ticket:async()=>'synthetic-ticket',
  serverStream:async()=>{mediaCalls++;return new Response(null,{status:504,headers:code?{'X-SMN-Error-Code':code}:{}})}
 };
 const response=await createXtreamBridge(deps)(new Request('https://synthetic.invalid/movie/synthetic/fixture/1.mp4'),{TICKET_SECRET:'synthetic-cause-secret',PLAYBACK_SESSIONS:{}},{waitUntil:p=>pending.push(p)});
 await Promise.all(pending);return {response,body:await response.json(),reports,mediaCalls};
}
const local=await failure('live_startup_timeout'),upstream=await failure('upstream_unavailable');
assert.equal(local.response.status,504);assert.equal(upstream.response.status,504);
assert.equal(local.body.error,'live_startup_timeout','a trusted local deadline must not be rewritten as an upstream failure');
assert.equal(upstream.body.error,'upstream_unavailable');
assert.equal(local.mediaCalls,3);assert.equal(upstream.mediaCalls,3,'diagnostic preservation does not add or remove retry attempts');
for(const report of local.reports){assert.equal(report.errorOrigin,'local_deadline');assert.equal(report.serviceError,'live_startup_timeout');}
for(const report of upstream.reports){assert.equal(report.errorOrigin,'upstream_response');assert.equal(report.serviceError,'upstream_unavailable');}
for(const code of [null,'https://private.invalid/credential']){
 const unknown=await failure(code);assert.equal(unknown.body.error,'upstream_unavailable');
 for(const report of unknown.reports){assert.equal(report.errorOrigin,'unknown');assert.equal(report.serviceError,undefined);}
}
assert.deepEqual(mediaFailureCause(504,{errorOrigin:'local_deadline',serviceError:'upstream_unavailable'}),{errorOrigin:'unknown'});
assert.deepEqual(mediaFailureCause(502,{errorOrigin:'local_deadline',serviceError:'live_startup_timeout'}),{});
const now=2000000;let health={};
for(const [i,cause] of [local.reports[0],upstream.reports[0],{errorOrigin:'https://private.invalid',serviceError:'credential'}].entries())health=recordProviderHealth(health,'private-account-'+i,'movie|ccf|101|mp4',false,12,'signal',now,null,null,504,cause);
let rows=recentMediaFailures(health,now);
assert.equal(rows.length,1);assert.equal(rows[0].failureCauses.length,3);assert.equal(rows[0].sourcesObserved,3);
assert.deepEqual(rows[0].failureCauses.map(x=>x.errorOrigin).sort(),['local_deadline','unknown','upstream_response']);
assert.ok(!JSON.stringify(rows).includes('private-account'));assert.ok(!JSON.stringify(rows).includes('private.invalid'));assert.ok(!JSON.stringify(rows).includes('credential'));
assert.deepEqual(recentMediaFailures(health,now+1800001),[],'retention remains 30 minutes');
for(let i=0;i<600;i++)health=recordProviderHealth(health,'private-account-'+i,'movie|ccf|'+(1000+i)+'|mp4',false,12,'signal',now+i,null,null,504,local.reports[0]);
assert.ok(Object.keys(health).length<=512);assert.ok(new TextEncoder().encode(JSON.stringify(health)).byteLength<128000);
assert.equal(recentMediaFailures(health,now+600).length,30,'the existing 30-row projection stays bounded');
console.log('PASS: native 504 preserves local deadline versus received HTTP without changing attempts.');
console.log('PASS: unknown/malicious codes stay unknown; deduplicated allowlist, 30-minute TTL, 30-row and storage limits remain.');
globalThis.fetch=realFetch;
