// Actual production Worker/DO routes with synthetic accounts, SQLite and saved
// catalogues. Test-only fixture endpoints never enter the deployed Worker.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';

const fixture=String.raw`
import worker,{PlaybackSession,OperationsMonitor,BackupRecovery} from '../src/index.js';
import {fingerprint} from '../src/provider-catalog.mjs';
import {encodeCatalog} from '../src/catalog-cache.mjs';
import {markServiceVerification} from '../src/service-verification.mjs';
export {OperationsMonitor,BackupRecovery};
const providers=[{source:'fixture-source',origin:'https://provider.invalid',url:'https://provider.invalid',encrypted:'fixture-provider-credential'}];
export class SupportFixture extends PlaybackSession {
 async fetch(request){
  const path=new URL(request.url).pathname,store=this.state.storage;
  if(path==='/__fixture/seed'){
   const body=await request.json();
   for(const [key,value] of Object.entries(body.values||{}))await store.put(key,value);
   for(const key of body.remove||[])await store.delete(key);
   return Response.json({ok:true});
  }
  if(path==='/__fixture/inspect'){
   const tables=store.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='smn_playback_leases'").toArray();
   return Response.json({business:{users:[...(await store.list({prefix:'user:'})).values()],providers:await store.get('providers')||null,pool:await store.get('pool')||null,marker:await store.get('business-sentinel')||null},leaseTables:tables.length,leases:tables.length?store.sql.exec('SELECT id,uid,until,provider_id,data FROM smn_playback_leases ORDER BY id').toArray():[]});
  }
  if(path==='/accounts/client-support-observe'&&await store.get('fixture-fail-support'))return Response.json({error:'support_unavailable'},{status:503});
  return super.fetch(request);
 }
}
const privateCall=(env,target,path,body={})=>env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName(target)).fetch('https://private'+path,{method:'POST',body:JSON.stringify(body)});
async function proofRequest(request){
 const username=new URL(request.url).searchParams.get('username'),pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
 const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const trust={accountId:'fixture-service',keyId:'fixture-key',publicKey:b64(await crypto.subtle.exportKey('raw',pair.publicKey))};
 const raw=new TextEncoder().encode(JSON.stringify({v:1,accountId:trust.accountId,keyId:trust.keyId,action:'probe',issuedAt:Date.now(),nonce:crypto.randomUUID(),body:{purpose:'access-verification',lineId:'fixture-line',username}}));
 const packet=JSON.stringify({payload:b64(raw),signature:b64(await crypto.subtle.sign('Ed25519',pair.privateKey,raw))});
 const headers=new Headers(request.headers);headers.set('X-SNAP-Service-Check',packet);headers.delete('X-Fixture-Service');
 const checked=new Request(request,{headers});if(!await markServiceVerification(checked,trust))throw Error('fixture_service_proof');return checked;
}
export default {async fetch(request,env,ctx){
 const url=new URL(request.url);
 if(url.pathname==='/__fixture/catalog'){
  const body=await request.json();
  await privateCall(env,'__smn_accounts_v1','/__fixture/seed',{values:{providers}});
  const scope=await fingerprint(env.TICKET_SECRET,JSON.stringify(providers.map(row=>[row.source,row.origin,row.url,row.encrypted])));
  const key=await fingerprint(env.TICKET_SECRET,JSON.stringify([scope,body.action,body.server||'',body.params||{}]));
  const encoded=await encodeCatalog(body.rows),content=btoa(String.fromCharCode(...encoded));
  return privateCall(env,'__smn_xtream_catalog_v1','/accounts/xtream-cache-put',{key,content});
 }
 if(url.pathname.startsWith('/__fixture/'))return privateCall(env,url.searchParams.get('target')||'__smn_accounts_v1',url.searchParams.get('path')||url.pathname,await request.json());
 const tasks=[],context={waitUntil:work=>{const pending=Promise.resolve(work);tasks.push(pending);ctx.waitUntil(pending);}};
 if(request.headers.get('X-Fixture-Service')==='true')request=await proofRequest(request);
 const response=await worker.fetch(request,env,context);
 // Deterministically drain the handler's real waitUntil work for assertions.
 // The production handler itself has already returned its response here.
 await Promise.all(tasks);return response;
}};
`;
const built=await build({stdin:{contents:fixture,sourcefile:'client-support-runtime-fixture.mjs',resolveDir:fileURLToPath(new URL('.',import.meta.url))},bundle:true,format:'esm',platform:'browser',external:['cloudflare:sockets'],write:false});
let outbound=0;
const runtime=new Miniflare(convertV4MiniflareOptions({name:'support-runtime',modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-03',compatibilityFlags:['enable_request_signal'],bindings:{ENVIRONMENT:'production',TICKET_SECRET:'support-runtime-ticket-secret-never-published',ADMIN_SETUP_SECRET:'support-runtime-setup-secret-never-published'},durableObjects:{PLAYBACK_SESSIONS:{className:'SupportFixture',useSQLite:true},OPERATION_ALERTS:{className:'OperationsMonitor',useSQLite:true},BACKUP_RECOVERY:{className:'BackupRecovery',useSQLite:true}},durableObjectsPersist:false,outboundService:()=>{outbound++;throw Error('Support runtime must not contact providers or other external services');}}));
const post=async(path,body)=>{
 const response=await runtime.dispatchFetch('https://api.snaptvnow.com'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 return {status:response.status,headers:response.headers,data:await response.json()};
};
const internal=(path,body={},target='__smn_accounts_v1')=>post('/__fixture/call?target='+encodeURIComponent(target)+'&path='+encodeURIComponent(path),body);
const seed=(values,target)=>internal('/__fixture/seed',{values},target);
const inspect=async target=>(await internal('/__fixture/inspect',{},target)).data;
const assertPrivate=data=>assert.ok(!/fixture-provider-credential|customer-password-test|owner-password-test|provider\.invalid|fixture-source|access_token|cookie|salt|\bhash\b|Authorization/i.test(JSON.stringify(data)),'support projection must exclude authentication, raw provider and request values');
let token;
const admin=(action,body={})=>post('/admin',{action,access_token:token,...body});
const list=async(action,{method='GET',categoryId,serviceCheck=false}={})=>{
 const params=new URLSearchParams({username:'customer',password:'customer-password-test',action,...(categoryId?{category_id:categoryId}:{})});
 const response=await runtime.dispatchFetch('https://api.snaptvnow.com/player_api.php'+(method==='POST'?'':'?'+params),{method,headers:{...(method==='POST'?{'Content-Type':'application/x-www-form-urlencoded'}:{}),...(serviceCheck?{'X-Fixture-Service':'true'}:{})},...(method==='POST'?{body:params.toString()}: {})});
 return {status:response.status,text:await response.text()};
};
try{
 await runtime.ready;
 const isolated='support-read-only-fixture',at=Date.now(),isolatedUser={id:'support-isolated-user',username:'isolated',displayUsername:'Isolated',version:1,status:'active',expiresAt:at+86400000,permissions:{movies:true,series:true,tv:true,adults:false}};
 await seed({'user:isolated':isolatedUser,'business-sentinel':{preserve:true}},isolated);
 const untouched=await inspect(isolated);assert.equal(untouched.leaseTables,0);
 for(const path of ['/accounts/client-support-read','/accounts/client-support-check']){
  const checked=await internal(path,{username:'isolated'},isolated);assert.equal(checked.status,200,JSON.stringify(checked.data));assert.equal(checked.data.check.connections.status,'unknown');assert.equal(checked.data.check.source.status,'unknown');assert.equal(checked.data.check.playbackValidated,false);assert.ok(checked.data.lists.every(row=>row.status==='not_observed'));assert.equal(checked.data.recordingSince,null);assertPrivate(checked.data);
 }
 assert.deepEqual(await inspect(isolated),untouched,'read/check may create only support schema and never initialize business leases or modify accounts');
 assert.equal((await internal('/accounts/client-support-observe',{username:'isolated',uid:isolatedUser.id,version:1,requestId:crypto.randomUUID(),kind:'catalog',type:'series',at:Date.now(),httpStatus:200,itemCount:2,selection:'all',access:'xtream'},isolated)).status,200);
 const isolatedIncident=await internal('/accounts/client-support-incident-save',{username:'isolated',actor:'owner',title:'Persisted synthetic case',status:'investigating',note:''},isolated);assert.equal(isolatedIncident.status,200);
 const isolatedLists=(await internal('/accounts/client-support-read',{username:'isolated'},isolated)).data.lists;assert.deepEqual(await inspect(isolated),untouched,'support observations and notes write only support storage');
 await runtime.unsafeEvictDurableObject('support-runtime','SupportFixture',{name:isolated});
 const isolatedRestored=(await internal('/accounts/client-support-read',{username:'isolated'},isolated)).data;assert.deepEqual(isolatedRestored.lists,isolatedLists);assert.ok(isolatedRestored.incidents.rows.some(row=>row.id===isolatedIncident.data.incident.id&&row.status==='investigating'),'real SQLite observations and incident history survive object restart');assert.deepEqual(await inspect(isolated),untouched);

 assert.equal((await post('/admin',{action:'setup',username:'owner',password:'owner-password-test',setupSecret:'support-runtime-setup-secret-never-published'})).status,200);
 token=(await post('/admin',{action:'login',username:'owner',password:'owner-password-test'})).data.access_token;assert.ok(token);
 assert.equal((await admin('save',{create:true,username:'customer',password:'customer-password-test',status:'active',expiresAt:at+86400000,permissions:{movies:true,series:true,tv:true,adults:true}})).status,200);
 const customer=(await admin('users')).data.find(row=>row.username==='customer');assert.ok(customer?.id);
 const nativeToken=(await post('/',{op:'auth',username:'customer',password:'customer-password-test'})).data.access_token;assert.ok(nativeToken);
 for(const action of ['client-support-read','client-support-check','client-support-incident-save']){
  assert.equal((await post('/admin',{action,username:'customer'})).status,401);
  assert.equal((await post('/admin',{action,username:'customer',access_token:nativeToken})).status,401,'a valid customer token cannot read or edit the owner support panel');
 }
 for(const path of ['/accounts/client-support-read','/accounts/client-support-observe'])assert.notEqual((await post(path,{username:'customer',uid:customer.id})).status,200,'public router does not expose internal support routes');
 const beforeCheck=await inspect();assert.equal((await admin('client-support-check',{username:'customer'})).status,200);assert.deepEqual(await inspect(),beforeCheck,'the owner check does not modify real account/lease rows');

 await post('/__fixture/catalog',{action:'get_live_streams',rows:[{stream_id:11,name:'Synthetic TV',category_id:'31',_server:'ccf',container_extension:'ts'}]});
 const live=await list('get_live_streams');assert.equal(live.status,200);const liveRows=JSON.parse(live.text);assert.equal(liveRows.length,1);assert.equal(liveRows[0].name,'Synthetic TV');assert.equal(liveRows[0].stream_type,'live');
 let report=(await admin('client-support-read',{username:'customer'})).data,liveObservation=report.lists.find(row=>row.type==='live');
 assert.equal(liveObservation.status,'delivered');assert.equal(liveObservation.itemCount,1);assert.equal(liveObservation.selection,'all');assert.equal(liveObservation.access,'xtream');assert.ok(liveObservation.lastRespondedAt>=liveObservation.lastRequestedAt);assert.equal(report.check.playbackValidated,false);assertPrivate(report);

 const beforeUnobserved=report.lists;
 assert.equal((await list('get_live_streams',{method:'HEAD'})).status,200);
 assert.equal((await list('get_live_streams',{serviceCheck:true})).status,200);
 assert.deepEqual((await admin('client-support-read',{username:'customer'})).data.lists,beforeUnobserved,'HEAD and verified service checks do not impersonate a customer catalogue refresh');
 assert.equal((await list('get_live_streams',{method:'POST',categoryId:String(liveRows[0].category_id)})).status,200);
 report=(await admin('client-support-read',{username:'customer'})).data;assert.equal(report.lists.find(row=>row.type==='live').selection,'category','POST category filters retain their actual scope');
 await post('/__fixture/catalog',{action:'get_vod_streams',rows:[]});assert.equal((await list('get_vod_streams',{method:'POST'})).text,'[]');
 report=(await admin('client-support-read',{username:'customer'})).data;assert.equal(report.lists.find(row=>row.type==='movie').status,'empty');assert.equal(report.lists.find(row=>row.type==='movie').itemCount,0);
 await post('/__fixture/catalog',{action:'get_series',rows:[{series_id:22,name:'Synthetic Series',category_id:'41',_server:'ccf'}]});
 const xtreamSeries=await list('get_series',{method:'POST'});assert.equal(xtreamSeries.status,200);assert.equal(JSON.parse(xtreamSeries.text)[0].name,'Synthetic Series');
 report=(await admin('client-support-read',{username:'customer'})).data;assert.equal(report.lists.find(row=>row.type==='series').status,'delivered');assert.equal(report.lists.find(row=>row.type==='series').access,'xtream');
 const apiSeries=await post('/',{op:'series',access_token:nativeToken});assert.equal(apiSeries.status,200);assert.equal(apiSeries.data[0].name,'Synthetic Series');
 report=(await admin('client-support-read',{username:'customer'})).data;assert.equal(report.lists.find(row=>row.type==='series').status,'delivered');assert.equal(report.lists.find(row=>row.type==='series').access,'api');
 await post('/__fixture/catalog',{action:'get_series',server:'ccf',rows:[{series_id:22,name:'Synthetic Series',category_id:'41',_server:'ccf'}]});
 assert.equal((await post('/',{op:'series',server:'ccf',access_token:nativeToken})).status,200);report=(await admin('client-support-read',{username:'customer'})).data;assert.equal(report.lists.find(row=>row.type==='series').selection,'source','a source-filtered API list does not claim all sources were delivered');

 const beforeDenied=JSON.stringify(report.lists);
 const badObservation={username:'customer',uid:'another-account',version:1,kind:'catalog',type:'live',requestId:crypto.randomUUID(),at:Date.now(),httpStatus:200,itemCount:999,selection:'all',access:'xtream'};
 assert.equal((await internal('/accounts/client-support-observe',badObservation)).status,403);assert.equal(JSON.stringify((await admin('client-support-read',{username:'customer'})).data.lists),beforeDenied,'another user identity cannot replace this user\'s observation');
 assert.equal((await internal('/accounts/client-support-observe',{...badObservation,uid:customer.id,version:999})).status,403,'stale or invented credential generations cannot write support history');

 const baselineLive=await list('get_live_streams');await seed({'fixture-fail-support':true});assert.deepEqual(await list('get_live_streams'),baselineLive,'a support write failure cannot change successful catalogue bytes or status');await seed({'fixture-fail-support':false});
 await seed({providers:[]});assert.equal((await list('get_live_streams')).status,502);
 report=(await admin('client-support-read',{username:'customer'})).data;assert.equal(report.lists.find(row=>row.type==='live').status,'failed');assert.ok(report.incidents.rows.some(row=>row.type==='catalog'&&row.httpStatus===502));assert.ok(!JSON.stringify(report.incidents).includes('local_fault'),'a generic 502 does not establish our fault or provider blame');
 const saved=await admin('client-support-incident-save',{username:'customer',title:'Synthetic support case',status:'open',note:''});assert.equal(saved.status,200);assert.equal(saved.data.incident.note,'');
 const original=saved.data.incident,updated=await admin('client-support-incident-save',{username:'customer',id:original.id,status:'investigating',note:'',expectedRevision:original.revision});assert.equal(updated.status,200);assert.equal(updated.data.incident.status,'investigating');
 assert.equal((await admin('client-support-incident-save',{username:'customer',id:original.id,status:'resolved',note:'',expectedRevision:original.revision})).status,409,'a stale editor cannot overwrite a newer incident');
 assert.equal((await admin('client-support-incident-save',{username:'customer',title:'Unsafe link https://credential.invalid/private',status:'open',note:''})).status,400,'private URLs are not retained in support notes');
 report=(await admin('client-support-read',{username:'customer'})).data;assertPrivate(report);assert.ok(report.incidents.rows.some(row=>row.id===original.id&&row.status==='investigating'));
 assert.equal(outbound,0,'support checks and cached catalogue observations must start no provider or media requests');
 console.log('PASS: actual workerd/SQLite owner-only support, authenticated Xtream/API list metadata, empty/filter/HEAD/service-check scope, nonblocking write failures, unknown 502 cause, optional notes, update conflicts, privacy and restart persistence.');
}finally{await runtime.dispose();}
