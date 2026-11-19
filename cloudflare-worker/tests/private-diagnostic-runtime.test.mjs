import {workerBundleOptions,bundledWorkerModules} from './workerd-bundle.mjs';
// Exercise the complete production Worker/DO wiring in real workerd and SQLite.
// Fixture seeding is bundled only into this test; production has no seed route.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';

const fixture=String.raw`
import worker,{PlaybackSession,OperationsMonitor} from '../src/index.js';
export {OperationsMonitor};
export class DiagnosticFixture extends PlaybackSession {
 async fetch(request){
  const path=new URL(request.url).pathname,store=this.state.storage;
  if(path==='/__fixture/seed'){
   const body=await request.json();
   for(const [key,value] of Object.entries(body.values||{}))await store.put(key,value);
   for(const key of body.remove||[])await store.delete(key);
   if(body.leases){
    store.sql.exec('CREATE TABLE IF NOT EXISTS smn_playback_leases(id TEXT PRIMARY KEY,provider_id TEXT NOT NULL,until INTEGER NOT NULL,data TEXT NOT NULL)');
    for(const row of body.leases)store.sql.exec('INSERT OR REPLACE INTO smn_playback_leases VALUES(?,?,?,?)',row.id,row.provider,row.until,JSON.stringify(row.data));
   }
   return Response.json({ok:true});
  }
  if(path==='/__fixture/inspect')return Response.json({keys:[...(await store.list()).keys()].sort(),leaseTables:store.sql.exec("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='smn_playback_leases'").toArray()[0].n,marker:(await store.get('diagnostic-business-sentinel'))||null});
  return super.fetch(request);
 }
}
export default {async fetch(request,env,ctx){
 const url=new URL(request.url);
 if(url.pathname.startsWith('/__fixture/')){
  const target=url.searchParams.get('target')||'__smn_private_diagnostic_v1';
  const path=url.searchParams.get('path')||url.pathname;
  return env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName(target)).fetch('https://private'+path,{method:request.method,body:request.method==='GET'?undefined:await request.text()});
 }
 return worker.fetch(request,env,ctx);
}};
`;
const built=await build({stdin:{contents:fixture,resolveDir:fileURLToPath(new URL('.',import.meta.url)),sourcefile:'private-diagnostic-runtime-fixture.mjs'},...workerBundleOptions});
let outbound=0;
const options=environment=>({name:'private-diagnostic-'+environment,modules:bundledWorkerModules(built),compatibilityDate:'2026-10-03',compatibilityFlags:['enable_request_signal'],bindings:{ENVIRONMENT:environment,PRIVATE_DIAGNOSTIC_REPORTS_ENABLED:'true',TICKET_SECRET:'diagnostic-runtime-ticket-secret',ADMIN_SETUP_SECRET:'diagnostic-runtime-setup-secret-long'},durableObjects:{PLAYBACK_SESSIONS:{className:'DiagnosticFixture',useSQLite:true},OPERATION_ALERTS:{className:'OperationsMonitor',useSQLite:true}},durableObjectsPersist:false,outboundService:()=>{outbound++;throw Error('Private diagnostic runtime must not request providers or external services');}});
const runtime=new Miniflare(convertV4MiniflareOptions(options('production')));
const call=async(path,body={},target='__smn_private_diagnostic_v1',method='POST')=>{
 const response=await runtime.dispatchFetch('https://diagnostic.invalid/__fixture/call?target='+encodeURIComponent(target)+'&path='+encodeURIComponent(path),{method,...(method==='GET'?{}:{body:JSON.stringify(body)})});
 return {status:response.status,data:await response.json()};
};
const seed=(values,extra={})=>call('/__fixture/seed',{values,...extra},'__smn_accounts_v1');
const forbidden=/fixture-owner|fixture-customer|fixture-password|fixture-credential|fixture-source|private-panel|private-provider|https?:|198\.51\.100|session-cookie|access_token/;
try{
 await runtime.ready;
 const at=Date.now(),provider={id:'private-provider',key:'private-physical',server:'fixture_server',sourceIds:['fixture-source'],username:'fixture-customer',encrypted:'fixture-credential',maxConnections:3,external:0},values={providers:[{source:'fixture-source',username:'fixture-owner',encrypted:'private-panel'}],pool:{lines:[provider],syncedAt:at,attemptedAt:at,sourceBacked:true},'source-pools':{'fixture-source':{lines:[provider],syncedAt:at}},'provider-rotation-stats':{completed:2,lastCompletedAt:at},'diagnostic-business-sentinel':{preserve:true}};
 await seed(values);
 const before=(await call('/__fixture/inspect',{},'__smn_accounts_v1')).data;
 assert.equal(before.leaseTables,0);
 const rawSnapshot=await call('/accounts/server-diagnostic-snapshot',{},'__smn_accounts_v1');
 assert.equal(rawSnapshot.status,200);assert.equal(rawSnapshot.data.readOnly,true);assert.equal(rawSnapshot.data.leases.status,'unknown');assert.equal(rawSnapshot.data.leases.reason,'schema_unavailable');
 assert.deepEqual((await call('/__fixture/inspect',{},'__smn_accounts_v1')).data,before,'the actual snapshot route must not initialize leases or change business data');
 const first=await call('/private-diagnostic/run');assert.equal(first.status,200,JSON.stringify(first.data));
 let saved=(await call('/private-diagnostic/status')).data;
 assert.equal(saved.readStatus,'observed');assert.equal(saved.stale,false);assert.equal(saved.report.schema,'SNAP-private-diagnostic-v1');assert.equal(saved.report.complete,false);assert.equal(saved.report.snapshot.leases.status,'unknown');
 assert.equal(saved.report.selfCheck.status,'passed');assert.deepEqual(Object.values(saved.report.selfCheck.checks),['passed','passed','passed']);assert.equal(saved.report.selfCheck.scope,'controlled_bytes_only');
 assert.equal(saved.report.classification,'unknown');assert.ok(!forbidden.test(JSON.stringify(saved.report)),'private report must contain no customer, credential, URL, IP or session values');
 assert.deepEqual((await call('/__fixture/inspect',{},'__smn_accounts_v1')).data,before,'collecting a report must leave the business object unchanged');
 assert.equal((await call('/private-diagnostic/run')).data.skipped,true,'production wiring deduplicates the next cron within five minutes');
 const collectorKeys=(await call('/__fixture/inspect')).data.keys;assert.deepEqual(collectorKeys,['private-diagnostic-control-v1','private-diagnostic-report-v1'],'the dedicated object retains only control and sanitized report');

 // A saved generic HTTP 502 remains unconfirmed; actual broken registry
 // roundtrips are affirmative local evidence, even with the same HTTP status.
 const health={'channel|movie|fixture_server|321|mp4|private-provider':{at:Date.now(),ok:false,httpStatus:502,failures:1}};
 await seed({'provider-health':health},{leases:[{id:'private-lease',provider:'private-provider',until:Date.now()+90000,data:{username:'fixture-customer',password:'fixture-password',ip:'198.51.100.9',cookie:'session-cookie'}}]});
 await call('/__fixture/seed',{remove:['private-diagnostic-control-v1']});await call('/private-diagnostic/run');saved=(await call('/private-diagnostic/status')).data;
 assert.equal(saved.report.classification,'unknown','502 alone must not blame our code or the provider');assert.equal(saved.report.mediaFailures.length,1);assert.equal(saved.report.mediaFailures[0].id,'321');assert.equal(saved.report.snapshot.leases.reserved,1);assert.equal(saved.report.snapshot.inventory.available,2);assert.ok(!forbidden.test(JSON.stringify(saved.report)));
 // The real media registry lives in a distinct DO. A plausible account-object
 // decoy would look healthy if collector wiring accidentally queried it.
 await seed({'xtream-map:movie:fixture_server:321':41,'xtream-id:41':{id:41,kind:'movie',server:'fixture_server',upstreamId:'321'}});
 await call('/__fixture/seed',{values:{'xtream-map:movie:fixture_server:321':41,'xtream-id:41':{id:41,kind:'movie',server:'fixture_server',upstreamId:'999'}}},'__smn_xtream_catalog_v1');
 const registryBefore=(await call('/__fixture/inspect',{},'__smn_xtream_catalog_v1')).data;
 assert.equal(registryBefore.leaseTables,0,'registry reads must not initialize business lease tables');
 await call('/__fixture/seed',{remove:['private-diagnostic-control-v1']});await call('/private-diagnostic/run');saved=(await call('/private-diagnostic/status')).data;
 assert.equal(saved.report.classification,'local_fault','collector must inspect the separate real registry object, not the healthy account-object decoy');assert.equal(saved.report.snapshot.mapping.checked,1);assert.equal(saved.report.snapshot.mapping.inconsistent,1);assert.equal(saved.report.mappingReferences[0].state,'registry_inconsistent');assert.equal(saved.report.mappingReferences[0].upstreamId,'321');assert.equal(saved.report.snapshot.leases.reserved,1,'the primary account inventory must remain separate from the registry snapshot');assert.equal(saved.report.snapshot.inventory.physicalAccounts,1);assert.ok(saved.report.findings.some(row=>row.evidence==='stored_registry_inconsistent'));assert.ok(!forbidden.test(JSON.stringify(saved.report)));assert.ok(Buffer.byteLength(JSON.stringify(saved.report))<=12000);
 assert.deepEqual((await call('/__fixture/inspect',{},'__smn_xtream_catalog_v1')).data,registryBefore,'exact-key mapping reads leave registry records and missing lease schema unchanged');
 await runtime.unsafeEvictDurableObject('private-diagnostic-production','DiagnosticFixture',{name:'__smn_private_diagnostic_v1'});
 assert.deepEqual((await call('/private-diagnostic/status')).data.report,saved.report,'the sanitized report survives an actual DO restart');

 // Real public router must not forward internal paths or report data.
 let response=await runtime.dispatchFetch('https://api.snaptvnow.com/health'),publicHealth=await response.json();
 assert.equal(response.status,200);assert.deepEqual(publicHealth.privateDiagnostics,{enabled:true,intervalMinutes:5,access:'private_cloudflare_observability',schema:1});assert.equal(publicHealth.playbackValidated,false);assert.ok(!JSON.stringify(publicHealth).includes('SNAP-private-diagnostic-v1'));assert.ok(!('report' in publicHealth));
 response=await runtime.dispatchFetch('https://api.snaptvnow.com/admin',{method:'POST',body:JSON.stringify({action:'private-diagnostic-report'})});assert.equal(response.status,401,'the admin report action keeps existing administrator authorization');await response.body.cancel();
 for(const path of ['/private-diagnostic/run','/private-diagnostic/status','/accounts/server-diagnostic-snapshot']){
  const rejected=await runtime.dispatchFetch('https://api.snaptvnow.com'+path,{method:'POST',body:'{}'}),text=await rejected.text();assert.notEqual(rejected.status,200,'public router rejects '+path);assert.ok(!text.includes('SNAP-private-diagnostic-v1'));assert.ok(!text.includes('mappingReferences'));
 }
 assert.equal((await call('/private-diagnostic/status',{},undefined,'GET')).status,405,'internal report requests require POST');
 assert.equal(outbound,0,'all full-worker diagnostic reads and byte checks must stay within our infrastructure');
 console.log('PASS: real workerd/SQLite private diagnostics preserve business data, run production media checks, classify mapping versus 502 evidence, persist sanitized results, enforce five-minute deduplication and reject public/unauthenticated access.');
}finally{await runtime.dispose();}

const staging=new Miniflare(convertV4MiniflareOptions(options('staging')));
try{
 await staging.ready;
 const run=await staging.dispatchFetch('https://diagnostic.invalid/__fixture/call?path='+encodeURIComponent('/private-diagnostic/run'),{method:'POST',body:'{}'});
 assert.deepEqual(await run.json(),{enabled:false,readStatus:'disabled'});
 const inspect=await staging.dispatchFetch('https://diagnostic.invalid/__fixture/call?path='+encodeURIComponent('/__fixture/inspect'),{method:'POST',body:'{}'});assert.deepEqual((await inspect.json()).keys,[],'staging must not save diagnostic data');
 const health=await(await staging.dispatchFetch('https://api.snaptvnow.com/health')).json();assert.equal(health.privateDiagnostics.enabled,false);assert.equal(outbound,0);
 console.log('PASS: staging disables the private collector without storing data or making provider requests.');
}finally{await staging.dispose();}
