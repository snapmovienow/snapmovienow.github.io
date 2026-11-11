import {openLeaseStore} from '../src/lease-store.mjs';
import {INVENTORY_MAX_AGE_MS,mergeInventories} from '../src/provider-inventory.mjs';
import assert from 'node:assert/strict';import worker,{PlaybackSession} from '../src/index.js';
class Store{constructor(){this.data=new Map();this.queue=Promise.resolve()}async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}async deleteAll(){this.data.clear()}async setAlarm(){}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))}transaction(fn){const r=this.queue.then(()=>fn(this));this.queue=r.catch(()=>{});return r}}
const objects=new Map(),env={TICKET_SECRET:'test-ticket-secret-only',ADMIN_SETUP_SECRET:'setup-test-only-123456789012345678901234567890'};env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {fetch:(url,options)=>objects.get(id).fetch(new Request(url,options))}}};
const row=id=>['<a>'+id+'</a>','<a>line'+id+'</a>','<span class="table-trunc-copy-cell__text tooltip" title="line-password-test">hidden</span>','owner','<i title="Active"></i>','','','0','3','','','2099-01-01'];
let inventoryReads=0,inventoryFails=false,inventoryGate=null,firstInventoryResponse;
globalThis.fetch=async(url,opts)=>{const u=new URL(url);if(u.pathname.endsWith('/login'))return new Response(opts.method==='POST'?'<a href="dashboard">Welcome</a>':'<input name="password">',{headers:{'set-cookie':'PHPSESSID='+((opts.body||'').includes('username=second')?'second':'first')+'; path=/'}});if(u.pathname.endsWith('/table')){
 inventoryReads++;
 if(inventoryGate)await inventoryGate();
 if(inventoryFails)return new Response('Unavailable',{status:503});
 if(opts.headers.Cookie?.includes('second'))return Response.json({recordsFiltered:2,data:[row(2),row(3)]});
 return Response.json((typeof firstInventoryResponse==='function'?firstInventoryResponse():firstInventoryResponse)??{recordsFiltered:2,data:[row(1),row(2)]});
}if(u.pathname==='/player_api.php'){assert.ok(['line1','line2','line3'].includes(u.searchParams.get('username')));assert.equal(u.searchParams.get('password'),'line-password-test');const action=u.searchParams.get('action');return Response.json(action==='get_vod_streams'?[{stream_id:123,name:'Movie'}]:action==='get_series'?[{series_id:456,name:'Series'}]:{user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}})}return new Response('sample',{headers:{'content-type':'video/mp4'}})};
const origin='https://snapmovienow-edge.juancanta89.workers.dev';const req=async(b,path='',ctx)=>{const r=await worker.fetch(new Request(origin+path,{method:'POST',body:JSON.stringify(b)}),env,ctx);return {status:r.status,data:await r.json()}};
await req({action:'setup',setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'owner-password-test'},'/admin');const login=await req({action:'login',username:'owner',password:'owner-password-test'},'/admin');assert.equal(login.status,200);const admin=(action,b={},ctx)=>req({action,access_token:login.data.access_token,...b},'/admin',ctx);assert.equal((await admin('provider-save',{mode:'panel',username:'owner',password:'panel-password-test'})).status,200);
const sessions=[];for(let i=0;i<7;i++){assert.equal((await admin('save',{create:true,username:'customer'+i,password:'customer-password-test',status:'active'})).status,200);sessions.push((await req({op:'auth',username:'customer'+i,password:'customer-password-test'})).data.access_token)}
assert.equal((await req({op:'vod',access_token:sessions[0]})).data[0].name,'Movie');assert.equal((await req({op:'series',access_token:sessions[0]})).data[0].name,'Series');const plays=await Promise.all(sessions.map(access_token=>req({op:'stream_token',access_token,type:'movie',id:123})));assert.equal(plays.filter(p=>p.status===200).length,6);assert.equal(plays.filter(p=>p.status===409).length,1);
const succeeded=plays.findIndex(p=>p.status===200),rejected=plays.findIndex(p=>p.status===409);assert.equal((await worker.fetch(new Request(plays[succeeded].data.url,{method:'HEAD'}),env)).status,200);await req({op:'logout',access_token:sessions[succeeded]});assert.equal((await worker.fetch(new Request(plays[succeeded].data.url,{method:'HEAD'}),env)).status,410);assert.equal((await req({op:'stream_token',access_token:sessions[rejected],type:'series',id:456})).status,200);const overview=await admin('overview');assert.equal(overview.data.provider.activeAccounts,2);assert.equal(overview.data.provider.maxConnections,6);assert.ok(!JSON.stringify(overview).includes('password'));
assert.ok([...objects.keys()].some(id=>id.startsWith('__smn_media_v1:')),'media runs in its own per-session relay');
console.log('PASS: panel connection → independent login → movie/series catalogs → encrypted tickets → protected stream; six simultaneous allocations across two accounts, seventh rejected, logout revokes and releases capacity.');

assert.equal((await admin('provider-save',{mode:'panel',username:'second',password:'panel-second-test'})).status,200);
let combined=await admin('overview');assert.equal(combined.data.provider.sourceCount,2);assert.equal(combined.data.provider.activeAccounts,3);assert.equal(combined.data.provider.maxConnections,9);assert.equal(combined.data.connections,6);
const storage=objects.get('__smn_accounts_v1').state.storage;const pool=await storage.get('pool');pool.attemptedAt=0;await storage.put('pool',pool);
assert.equal((await req({op:'vod',access_token:sessions[rejected]})).status,200);
combined=await admin('overview');assert.equal(combined.data.provider.activeAccounts,3);assert.equal(combined.data.provider.maxConnections,9);assert.equal(combined.data.connections,6);
console.log('PASS: second reseller adds capacity, overlapping line deduplicated, refresh retains both sources and active playback leases.');
assert.ok(objects.has('__smn_provider_refresh_v1'),'panel refresh executes in a dedicated Durable Object rather than in the video request');

const directory = async body => {
 const result = await env.PLAYBACK_SESSIONS.get('__smn_accounts_v1').fetch('https://private/accounts/pool-sync', {method:'POST',body:JSON.stringify(body)});
 assert.equal(result.status,200);
};
const sources=Object.keys(await storage.get('source-pools'));
const readPool=()=>env.PLAYBACK_SESSIONS.get('__smn_accounts_v1').fetch('https://private/accounts/pool',{method:'POST',body:'{}'}).then(r=>r.json());
const refresh=force=>env.PLAYBACK_SESSIONS.get('__smn_provider_refresh_v1').fetch('https://private/refresh-pool',{method:'POST',body:JSON.stringify({force})});
const goodAt=Date.now()-3600000,legacyAttempt=Date.now()-60000,aged=await storage.get('source-pools');
for(const snapshot of Object.values(aged)){snapshot.syncedAt=goodAt;snapshot.attemptedAt=legacyAttempt;}
await storage.put('source-pools',aged);
await storage.put('pool',{lines:(await storage.get('pool')).lines,syncedAt:legacyAttempt});
assert.equal((await readPool()).syncedAt,goodAt,'older stored aggregates are reconstructed from successful source timestamps');

inventoryFails=true;
const readsBeforeFailure=inventoryReads;
assert.equal((await refresh(false)).status,200);
assert.equal(inventoryReads,readsBeforeFailure+2);
const retained=await readPool();
assert.equal(retained.syncedAt,goodAt,'a failed refresh never advances inventory validity');
assert.ok(retained.attemptedAt>legacyAttempt);
assert.equal(await (await openLeaseStore(storage)).count(),6);
assert.equal((await refresh(false)).status,200);
assert.equal(inventoryReads,readsBeforeFailure+2,'the failed attempt still enforces the automatic retry cooldown');

inventoryFails=false;
assert.equal((await refresh(true)).status,200);
const refreshed=await readPool();
assert.ok(refreshed.syncedAt>goodAt);
assert.equal(refreshed.attemptedAt,refreshed.syncedAt);
const forMixedAge=await storage.get('source-pools');

firstInventoryResponse={recordsFiltered:0,data:[]};
assert.equal((await refresh(true)).status,200);
assert.deepEqual((await readPool()).lines.map(line=>line.id),['1','2','3'],'an ambiguous empty result preserves the prior inventory');
assert.equal((await storage.get('source-pools'))[sources[0]].syncedAt,forMixedAge[sources[0]].syncedAt,'an ambiguous empty result does not renew source validity');
assert.equal(await (await openLeaseStore(storage)).count(),6,'an ambiguous empty result preserves authorised running streams');
// Even an explicit all-zero table can be a transient panel response. A second
// bounded read must agree before it can retire a source's existing accounts.
const beforeEmptyConfirmation=inventoryReads;
let emptyConfirmationReads=0;
firstInventoryResponse=()=>++emptyConfirmationReads===1
 ?{recordsFiltered:0,recordsTotal:0,data:[]}
 :{recordsFiltered:2,recordsTotal:2,data:[row(1),row(2)]};
assert.equal((await refresh(true)).status,200);
assert.deepEqual((await readPool()).lines.map(line=>line.id),['1','2','3'],'a transient explicit empty table cannot replace the prior inventory');
assert.equal(emptyConfirmationReads,2,'the empty result gets exactly one confirmation read');
assert.equal(inventoryReads,beforeEmptyConfirmation+3,'only the empty source requires an extra table read');
assert.equal((await storage.get('source-pools'))[sources[0]].syncedAt,forMixedAge[sources[0]].syncedAt,'disagreeing empty confirmation does not renew validity');
assert.equal(await (await openLeaseStore(storage)).count(),6,'disagreeing empty confirmation preserves existing authorised leases');
emptyConfirmationReads=0;
firstInventoryResponse=()=>{
 if(++emptyConfirmationReads===1)return {recordsFiltered:0,recordsTotal:0,data:[]};
 throw new DOMException('fixture confirmation timeout','TimeoutError');
};
assert.equal((await refresh(true)).status,200);
assert.equal(emptyConfirmationReads,2,'a failed confirmation is never retried');
assert.deepEqual((await readPool()).lines.map(line=>line.id),['1','2','3']);
assert.equal((await storage.get('source-pools'))[sources[0]].syncedAt,forMixedAge[sources[0]].syncedAt);
assert.equal(await (await openLeaseStore(storage)).count(),6,'failed confirmation cannot revoke leases');
firstInventoryResponse={recordsFiltered:'0',recordsTotal:'0',data:[]};
const beforeConfirmedEmpty=inventoryReads;
assert.equal((await refresh(true)).status,200);
assert.equal(inventoryReads,beforeConfirmedEmpty+3,'a stable explicit empty inventory is confirmed once then accepted');
firstInventoryResponse=undefined;
assert.deepEqual((await storage.get('pool')).lines.map(l=>l.id),['2','3']);
assert.ok([...(await (await openLeaseStore(storage)).active()).values()].every(l=>l.provider_id!=='1'),'a confirmed inactive source revokes its accounts immediately');
const retainedPools=await storage.get('source-pools');retainedPools[sources[1]].syncedAt=Date.now()-3600000;await storage.put('source-pools',retainedPools);
await directory({source:sources[1],retain:true});assert.equal((await storage.get('pool')).lines.length,2,'a one-hour panel outage does not erase authorised accounts');
const expiredPools=await storage.get('source-pools');expiredPools[sources[1]].syncedAt=Date.now()-12*3600000-1;await storage.put('source-pools',expiredPools);
await directory({source:sources[1],retain:true});
assert.equal((await storage.get('pool')).lines.length,0); assert.equal(await (await openLeaseStore(storage)).count(),0,'inventory retention expires after twelve hours');
console.log('PASS: transient inventory failure preserves leases; confirmed inactivity revokes them; stale inventory expires after twelve hours.');

const checkAt=Date.now(),expiredAt=checkAt-INVENTORY_MAX_AGE_MS-1000;
forMixedAge[sources[0]].syncedAt=expiredAt;
forMixedAge[sources[0]].attemptedAt=checkAt;
forMixedAge[sources[1]].syncedAt=checkAt;
await storage.put('source-pools',forMixedAge);
await storage.put('pool',mergeInventories(forMixedAge,checkAt-2000));
const mixed=await readPool();
assert.deepEqual(mixed.lines.map(l=>l.id),['2','3'],'a source crossing its expiry cannot hide the usable inventory of another source');
assert.equal(mixed.syncedAt,checkAt);
const staleUser=await storage.get('user:customer0');
const allocation=await env.PLAYBACK_SESSIONS.get('__smn_accounts_v1').fetch('https://private/accounts/acquire',{method:'POST',body:JSON.stringify({sid:'mixed-age-test',uid:staleUser.id,username:'customer0',version:staleUser.version})});
assert.equal(allocation.status,200);assert.ok(['2','3'].includes((await allocation.json()).provider_id));
console.log('PASS: legacy inventory freshness, separate failed-attempt cooldown, successful refresh and isolation of an expired source.');

// View calls must stay read-only even with an old attempted timestamp and a
// context that would run a background refresh.
const oldPool=await storage.get('pool');
await storage.put('pool',{...oldPool,attemptedAt:0});
const viewTasks=[],beforeViews=inventoryReads;
const views=await Promise.all(Array.from({length:3},()=>admin('provider-dashboard',{refresh:false},{waitUntil:task=>viewTasks.push(task)})));
assert.ok(views.every(view=>view.status===200));
assert.equal(viewTasks.length,0);
assert.equal(inventoryReads,beforeViews);
await storage.put('pool',oldPool);

// Hold the automatic request just before its freshness decision. An explicit
// request must still cause exactly one complete refresh.
const originalGet=storage.get.bind(storage),freshnessEntered=Promise.withResolvers(),freshnessRelease=Promise.withResolvers();
let holdFreshness=true;
storage.get=async key=>{
 if(key==='pool'&&holdFreshness){holdFreshness=false;freshnessEntered.resolve();await freshnessRelease.promise;}
 return originalGet(key);
};
const originalLog=console.log,telemetry=[];
console.log=event=>telemetry.push(event);
let beforeRefresh=inventoryReads;
try{
 const automatic=refresh(false);
 await freshnessEntered.promise;
 const manual=refresh(true);
 await new Promise(resolve=>setImmediate(resolve));
 freshnessRelease.resolve();
 assert.ok((await Promise.all([automatic,manual])).every(result=>result.ok));
 assert.equal(inventoryReads,beforeRefresh+2);
 assert.ok(telemetry.some(event=>event.event==='provider_inventory_refresh'&&event.operation==='manual'&&event.outcome==='refreshed'&&event.shared&&Number.isInteger(event.waitMs)));
}finally{freshnessRelease.resolve();storage.get=originalGet;console.log=originalLog;}

// A monitor that joins an in-flight read must see progress for the current
// page, and it shares that read with the automatic and manual refresh callers.
const gated=Promise.withResolvers(),release=Promise.withResolvers();
let entered=0;
inventoryGate=()=>{if(++entered===2)gated.resolve();return release.promise};
await storage.put('pool',{...(await storage.get('pool')),attemptedAt:0});
beforeRefresh=inventoryReads;
console.log=event=>telemetry.push(event);
try{
 const automatic=refresh(false);
 await gated.promise;
 const manual=admin('provider-dashboard',{refresh:true});
 const check=env.PLAYBACK_SESSIONS.get('__smn_provider_refresh_v1').fetch('https://private/monitor-providers',{method:'POST',body:'{}'});
 const refreshObject=objects.get('__smn_provider_refresh_v1');
 for(let tries=0;tries<100&&([...refreshObject.inventoryReads.values()].some(flight=>!flight.observers.size)||!refreshObject.refreshing.force);tries++)await new Promise(resolve=>setTimeout(resolve,5));
 assert.ok([...refreshObject.inventoryReads.values()].every(flight=>flight.observers.size===1));
 assert.equal(refreshObject.refreshing.force,true);
 release.resolve();
 const [a,m,c]=await Promise.all([automatic,manual,check]);
 assert.equal(a.status,200);assert.equal(m.status,200);assert.equal(c.status,200);
 assert.equal(inventoryReads,beforeRefresh+2);
 const evidence=(await c.json()).providers;
 assert.ok(evidence.every(sample=>sample.stage==='inventory'&&sample.ok&&sample.receivedRows===2&&sample.acceptedRows===2));
 const shared=telemetry.filter(event=>event.event==='provider_inventory_read_shared');
 assert.equal(shared.length,2);
 assert.ok(shared.every(event=>/^[A-Za-z0-9_-]{43}$/.test(event.sourceId)&&event.operation==='monitor'&&Number.isInteger(event.waitMs)&&event.waitMs>=0));
 assert.ok(!JSON.stringify(shared).includes('panel:owner'));
}finally{release.resolve();inventoryGate=null;console.log=originalLog;}

const removalEntered=Promise.withResolvers(),removalRelease=Promise.withResolvers();
inventoryGate=()=>{removalEntered.resolve();return removalRelease.promise};
try{
 const updating=refresh(true);
 await removalEntered.promise;
 assert.equal((await admin('provider-remove',{source:sources[0]})).status,200);
 removalRelease.resolve();
 assert.equal((await updating).status,200);
 assert.ok(!Object.hasOwn(await storage.get('source-pools'),sources[0]),'an old refresh cannot restore a removed source');
}finally{removalRelease.resolve();inventoryGate=null;}
console.log('PASS: opening the dashboard only reads saved data; manual refresh, background refresh and monitor share reads with safe wait telemetry; a removed source stays removed.');
