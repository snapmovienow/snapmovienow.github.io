import {openLeaseStore} from '../src/lease-store.mjs';
import assert from 'node:assert/strict';
import worker,{PlaybackSession} from '../src/index.js';
import {providerDashboard} from '../src/provider-dashboard.mjs';
import {parseInventory,readPanel} from '../src/reseller.mjs';
import {selectAccounts} from '../../admin-provider-view.js';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve()}
 async get(k){return structuredClone(this.data.get(k))}
 async put(k,v){this.data.set(k,structuredClone(v))}
 async delete(k){this.data.delete(k)}async deleteAll(){this.data.clear()}async setAlarm(){}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))}
 transaction(fn){const r=this.queue.then(()=>fn(this));this.queue=r.catch(()=>{});return r}
}
const now=Date.now(),store=new Store();
const line=(id,username,external=0)=>({id,username,key:username,server:'ccf',maxConnections:3,external,encrypted:'must-not-leak',password:'also-must-not-leak'});
const first=line('1','provider-one',1),second=line('2','provider-two',0);
await store.put('provider',{mode:'panel',username:'owner',encrypted:'must-not-leak'});
await store.put('providers',[{source:'a',name:'CCF · Primero',username:'owner',encrypted:'must-not-leak'},{source:'b',name:'CCF · Segundo',username:'owner2',encrypted:'must-not-leak'}]);
await store.put('pool',{lines:[first,second],syncedAt:now});
await store.put('source-pools',{a:{lines:[first],inventory:[first,{id:'3',username:'expired-account',key:'expired-account',status:'expired',maxConnections:3,reported:0,expiresAt:now-1}],syncedAt:now},b:{lines:[{...first,id:'99'},second],inventory:[{...first,id:'99'},second,{id:'4',username:'disabled-account',status:'suspended',maxConnections:3,reported:0}],syncedAt:now}});
await store.put('user:nito',{id:'n',username:'nito',version:1,status:'active'});
await store.put('user:revoked',{id:'r',username:'revoked',version:2,status:'suspended'});
await store.put('leases',{current:{provider_id:'1',uid:'n',username:'nito',version:1,mediaKey:'live|ccf|10|m3u8',until:now+90000,sid:'private-sid',request_id:'private-request'},expired:{provider_id:'2',uid:'n',username:'nito',version:1,until:now-1},revoked:{provider_id:'2',uid:'r',username:'revoked',version:1,until:now+90000}});
let view=await providerDashboard(store,now);
assert.equal(view.accounts.length,4,'overlapping subscription belongs to both sources but is counted once');
assert.deepEqual(view.summary,{accounts:4,receivedRows:5,activeAccounts:2,usableAccounts:2,totalCapacity:6,reported:1,reserved:1,available:4});
assert.equal(view.accounts.find(a=>a.id==='1').sources.length,2);
assert.equal(view.assignments.length,1);assert.equal(view.assignments[0].username,'nito');assert.equal(view.assignments[0].accountUsername,'provider-one');assert.equal(view.assignments[0].type,'live');
const activityLeaseStore=await openLeaseStore(store),current=await activityLeaseStore.get('current');await activityLeaseStore.put('current',{...current,activity:{title:'ESPN 1 · 1080',password:'activity-secret',url:'private-url'}});
view=await providerDashboard(store,now);assert.deepEqual(view.assignments[0].activity,{title:'ESPN 1 · 1080'});assert.equal(view.assignments[0].lastSeenAt,now);assert.ok(!JSON.stringify(view).includes('activity-secret'));assert.ok(!JSON.stringify(view).includes('private-url'));
assert.equal(view.accounts.find(a=>a.username==='expired-account').available,0);
assert.equal(view.accounts.find(a=>a.username==='disabled-account').available,0);
for(const forbidden of ['must-not-leak','private-sid','private-request','encrypted','password'])assert.ok(!JSON.stringify(view).includes(forbidden));
assert.equal(selectAccounts(view.accounts,{query:'NiTo'}).length,1);
assert.equal(selectAccounts(view.accounts,{status:'inactive'}).length,2);
assert.equal(selectAccounts(view.accounts,{status:'free'}).length,1);
assert.equal(selectAccounts(view.accounts,{source:'a'}).length,2);
assert.equal(selectAccounts(view.accounts,{query:'missing'}).length,0);
await (await openLeaseStore(store)).clear();view=await providerDashboard(store,now);assert.equal(view.assignments.length,0);assert.equal(view.summary.available,5,'closing playback removes the assignment and restores its slot');
const pools=await store.get('source-pools');pools.a.attemptedAt=now;await store.put('source-pools',pools);assert.equal((await providerDashboard(store,now)).stale,true);
// The merged pool can establish capacity, but never membership in a source.
const attribution=new Store(),shared=line('7','shared'),old=line('8','previous-owner'),reused=line('8','new-owner');
const sources=[
 {source:'current',name:'Actual'},
 {source:'unknown',name:'Sin lectura'},
 {source:'empty',name:'Vacío'},
 {source:'historical',name:'Histórico'},
 {source:'contradictory',name:'Coincidente'}
];
await attribution.put('providers',sources);
await attribution.put('pool',{lines:[shared,reused],syncedAt:now,attemptedAt:now,sourceBacked:true});
await attribution.put('source-pools',{
 current:{lines:[shared,reused],inventory:[{...shared,status:'active'},{...shared,id:'77',status:'active'},{...reused,status:'active'}],syncedAt:now},
 unknown:{lines:[],inventory:[],syncedAt:0,attemptedAt:now},
 empty:{lines:[],inventory:[],syncedAt:now},
 historical:{lines:[old],inventory:[{...old,status:'active'}],syncedAt:now-12*3600000},
 contradictory:{lines:[],inventory:[{...shared,status:'suspended'}],syncedAt:now}
});
const attributed=await providerDashboard(attribution,now),bySource=Object.fromEntries(attributed.sources.map(s=>[s.source,s]));
assert.deepEqual(attributed.summary,{accounts:3,receivedRows:null,activeAccounts:3,usableAccounts:2,totalCapacity:6,reported:0,reserved:0,available:6});
assert.deepEqual([bySource.current.receivedRows,bySource.current.activeAccounts,bySource.current.usableAccounts],[3,2,2],'received rows and distinct accounts are separate');
assert.equal(attributed.accounts.find(a=>a.username==='shared').sources.length,2,'a duplicate row cannot duplicate source attribution');
assert.deepEqual([bySource.unknown.inventoryStatus,bySource.unknown.receivedRows,bySource.unknown.activeAccounts,bySource.unknown.usableAccounts],['missing',null,null,null]);
assert.deepEqual([bySource.empty.inventoryStatus,bySource.empty.receivedRows,bySource.empty.activeAccounts,bySource.empty.usableAccounts],['verified',0,0,0]);
assert.deepEqual([bySource.historical.receivedRows,bySource.historical.activeAccounts,bySource.historical.usableAccounts],[1,1,0]);
assert.deepEqual([bySource.contradictory.receivedRows,bySource.contradictory.activeAccounts,bySource.contradictory.usableAccounts],[1,0,0]);
assert.equal(selectAccounts(attributed.accounts,{source:'unknown'}).length,0,'a failed first refresh cannot assign the merged pool to that source');
const retiredView=selectAccounts(attributed.accounts,{source:'contradictory'})[0];
assert.equal(retiredView.status,'suspended','a different source cannot override this source’s observed state');
assert.equal(retiredView.available,0);
assert.equal(selectAccounts(attributed.accounts,{source:'historical',status:'active'})[0].username,'previous-owner','a reused numeric ID cannot override historical account identity');
assert.equal(selectAccounts(attributed.accounts,{source:'historical',status:'usable'}).length,0);
const legacy=new Store();
await legacy.put('provider',{mode:'panel',username:'Owner'});
assert.equal((await providerDashboard(legacy,now)).sources[0].inventoryStatus,'missing');
await legacy.put('pool',{lines:[shared],syncedAt:now});
const legacyView=await providerDashboard(legacy,now);
assert.deepEqual(legacyView.sources.map(({source,inventoryStatus,receivedRows,usableAccounts})=>({source,inventoryStatus,receivedRows,usableAccounts})),[{source:'panel:owner',inventoryStatus:'partial',receivedRows:null,usableAccounts:1}]);
assert.equal(legacyView.accounts[0].username,'shared','the single-source legacy pool remains visible as partial inventory');
const row=(id,status='Active',date='2099-01-01')=>[String(id),'line'+id,'<span title="upstream-secret" class="table-trunc-copy-cell__text">hidden</span>','owner','<i title="'+status+'"></i>','','','0','3','','',date];
const inventory=parseInventory({data:[row(1),row(2,'Disabled'),row(3,'Active','2000-01-01')]});assert.deepEqual(inventory.map(a=>a.status),['active','suspended','expired']);assert.ok(!JSON.stringify(inventory).includes('upstream-secret'));
const objects=new Map(),env={TICKET_SECRET:'dashboard-test-secret-only',ADMIN_SETUP_SECRET:'test-only-setup-secret-longer-than-32-characters'};
env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return {fetch:(url,opts)=>objects.get(id).fetch(new Request(url,opts))}}};
let upstreamCalls=0,fail=false,invalidLogin=false;
let table=()=>({recordsFiltered:3,data:[row(1),row(2,'Disabled'),row(3,'Active','2000-01-01')]});
globalThis.fetch=async(url,opts={})=>{upstreamCalls++;const u=new URL(url);if(fail)return new Response('Unavailable',{status:503});if(u.pathname.endsWith('/login'))return new Response(opts.method==='POST'&&!invalidLogin?'<a href="dashboard">Welcome</a>':'<input name="password">',{headers:{'set-cookie':'PHPSESSID=test; path=/'}});if(u.pathname.endsWith('/table'))return Response.json(table(Number(u.searchParams.get('start'))));if(u.pathname==='/player_api.php')return Response.json({user_info:{auth:1,status:'Active',max_connections:'3',active_cons:'0'}});throw Error('Unexpected upstream')};
const root='https://snapmovienow-edge.juancanta89.workers.dev',request=async(action,data={})=>{const r=await worker.fetch(new Request(root+'/admin',{method:'POST',body:JSON.stringify({action,...data})}),env);return {status:r.status,data:await r.json()}};
assert.equal((await request('provider-dashboard',{refresh:true})).status,401);assert.equal(upstreamCalls,0,'unauthenticated inventory requests never reach the provider');
await request('setup',{setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password:'test-admin-password-long'});
const token=(await request('login',{username:'owner',password:'test-admin-password-long'})).data.access_token;
const admin=(action,data={})=>request(action,{access_token:token,...data});
assert.equal((await admin('provider-dashboard',{refresh:true})).data.refreshError,null,'an empty configuration is a normal empty view');
assert.equal((await admin('provider-save',{mode:'panel',username:'owner',password:'test-provider-secret'})).status,200);
view=(await admin('provider-dashboard',{refresh:true})).data;assert.equal(view.accounts.length,3);assert.equal(view.summary.activeAccounts,1);
assert.ok(view.accounts.some(a=>a.username==='line2'&&a.status==='suspended'));
await admin('save',{username:'nito',password:'test-customer-password',status:'active',create:true});
const auth=await worker.fetch(new Request(root,{method:'POST',body:JSON.stringify({op:'auth',username:'nito',password:'test-customer-password'})}),env);const customer=(await auth.json()).access_token;
assert.equal((await request('provider-dashboard',{access_token:customer})).status,401,'a customer token cannot see another provider account or its allocations');
fail=true;const failed=await admin('provider-dashboard',{refresh:true});assert.equal(failed.status,200);assert.equal(failed.data.stale,true,'a retained snapshot is explicitly marked stale');assert.equal(failed.data.summary.activeAccounts,1,'a transient outage preserves the known inventory');assert.equal(failed.data.stale,true);
const before=JSON.stringify([...await (await openLeaseStore(objects.get('__smn_accounts_v1').state.storage)).active()]);await admin('provider-dashboard');assert.equal(JSON.stringify([...await (await openLeaseStore(objects.get('__smn_accounts_v1').state.storage)).active()]),before,'viewing a dashboard never starts or stops playback');

const directory=objects.get('__smn_accounts_v1').state.storage;
const savedUser=await directory.get('user:nito'),leases=await openLeaseStore(directory);
await leases.put('inventory-test-lease',{provider_id:'1',uid:savedUser.id,version:savedUser.version,sid:'test-session',until:Date.now()+90000});
const savedProviders=await directory.get('providers');
async function assertRetained(){
 const result=await admin('provider-dashboard',{refresh:true});
 assert.equal(result.status,200);assert.equal(result.data.stale,true);
 assert.equal(result.data.summary.activeAccounts,1);assert.ok(await leases.get('inventory-test-lease'));
}
await assertRetained(); // Temporary HTTP failure.
fail=false;invalidLogin=true;await assertRetained();invalidLogin=false;
await directory.put('providers',[{...savedProviders[0],encrypted:'unreadable-config'}]);await assertRetained();
await directory.put('providers',savedProviders);
for(const incomplete of [
 {recordsFiltered:1,data:[]},
 {recordsFiltered:0,data:[]},
 {recordsFiltered:0,recordsTotal:1,data:[]},
 {data:[]},
 {recordsFiltered:2,data:[row(2,'Disabled'),['invalid']]},
 {recordsFiltered:1,data:[row(1,'Unrecognized')]},
 {recordsFiltered:1,data:[row(1).map((value,index)=>index===2?'':value)]}
]){table=()=>incomplete;await assertRetained();}
table=()=>({recordsFiltered:2,data:[row(2,'Disabled')]});
await assertRetained(); // Duplicated page; total alone cannot prove completeness.
table=start=>start===0?{recordsFiltered:2,data:[row(2,'Disabled')]}:{recordsFiltered:3,data:[row(3,'Disabled')]};
await assertRetained(); // The inventory changed between pages.
table=start=>start===0?{recordsFiltered:2,data:[row(1,'active')]}:{recordsFiltered:2,data:[row(2,'Disabled')]};
const verified=await admin('provider-dashboard',{refresh:true});assert.equal(verified.data.stale,false);assert.equal(verified.data.accounts.length,2);assert.equal(verified.data.summary.activeAccounts,1);assert.ok(await leases.get('inventory-test-lease'));
table=()=>({recordsFiltered:0,recordsTotal:0,data:[]});
const empty=await admin('provider-dashboard',{refresh:true});assert.equal(empty.data.summary.activeAccounts,0);assert.equal(empty.data.accounts.length,0);assert.equal(await leases.count(),0,'a complete empty inventory revokes existing reservations');
await admin('logout');assert.equal((await admin('provider-dashboard')).status,401);
// A panel with no playable accounts still returns all account metadata.
fail=false;globalThis.fetch=async(url,opts={})=>new URL(url).pathname.endsWith('/table')?Response.json({recordsFiltered:1,data:[row(5,'Disabled')]}):new Response(opts.method==='POST'?'<a href="dashboard">Welcome</a>':'<input name="password">',{headers:{'set-cookie':'PHPSESSID=test; path=/'}});
const disabled=await readPanel('owner','test-provider-secret',undefined,{inventory:true});assert.equal(disabled.lines.length,0);assert.equal(disabled.inventory.length,1);
console.log('PASS: protected provider inventory, inactive accounts, duplicate sources, conservative capacity, real user mapping, release/expiry/revocation, search/filter, transient failure retention and credential isolation.');
