import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {clientSupportRoute} from '../src/client-support.mjs';

const at=Date.UTC(2026,10,17,2),DAY=86400000;
const user={id:'11111111-1111-4111-8111-111111111111',username:'cliente01',displayUsername:'Cliente01',version:3,name:'Cliente de ejemplo',status:'active',expiresAt:at+DAY,permissions:{tv:true,movies:true,series:true,adults:false},hash:'private-user-hash',salt:'private-user-salt',resellerBridge:{accountId:'private-reseller-id',lineId:'private-line-id'}};
const second={...user,id:'22222222-2222-4222-8222-222222222222',username:'cliente02',displayUsername:'Cliente02'};
class Store{
 constructor(sql=true){
  this.values=new Map([['user:cliente01',structuredClone(user)],['user:cliente02',structuredClone(second)],['pool',{lines:[{id:'provider@id',key:'private-provider-key',username:'private-provider-login',encrypted:'private-provider-credential',credentialKey:'private-credential-key',server:'private-server',status:'active',expiresAt:at+DAY,maxConnections:3,external:0}],syncedAt:at-1000,attemptedAt:at-1000}],['business-sentinel',{untouched:true}]]);this.queue=Promise.resolve();this.queries=[];
  if(sql){this.db=new DatabaseSync(':memory:');this.sql={exec:(query,...values)=>{this.queries.push(query);if(!values.length&&/;\s*\S/.test(query)){this.db.exec(query);return {toArray:()=>[]};}const rows=this.db.prepare(query).all(...values);return {toArray:()=>rows};}};}
 }
 async get(key){return structuredClone(this.values.get(key));}
 async put(key,value){this.values.set(key,structuredClone(value));}
 async delete(key){this.values.delete(key);}
 async list(){assert.fail('support must use own bounded indexes rather than enumerate business records');}
 transaction(operation){const result=this.queue.then(async()=>{const snapshot=structuredClone(this.values);if(this.db)this.db.exec('BEGIN');try{const value=await operation(this);if(this.db)this.db.exec('COMMIT');return value;}catch(error){this.values=snapshot;if(this.db)this.db.exec('ROLLBACK');throw error;}});this.queue=result.catch(()=>{});return result;}
 leases(){this.db.exec('CREATE TABLE smn_playback_leases(id TEXT PRIMARY KEY,uid TEXT,until INTEGER,data TEXT)');const statement=this.db.prepare('INSERT INTO smn_playback_leases VALUES(?,?,?,?)');statement.run('private-live-lease',user.id,at+60000,'private-playback-payload');statement.run('private-expired-lease',user.id,at-1,'private-expired-payload');statement.run('private-foreign-lease',second.id,at+60000,'private-foreign-payload');}
}
const call=async(store,path,body={},now=at)=>{const response=await clientSupportRoute(store,path,{username:'cliente01',...body},{sql:store.sql,now});return {status:response.status,data:await response.json(),response};};
const observe=(store,body={},now=at)=>call(store,'/client-support-observe',{uid:user.id,version:3,kind:'catalog',type:'live',requestId:crypto.randomUUID(),at:now,httpStatus:200,itemCount:25,selection:'all',access:'xtream',...body},now);
const read=(store,body={},now=at)=>call(store,'/client-support-read',body,now);
const incident=(store,body={},now=at)=>call(store,'/client-support-incident-save',{actor:'propietario',title:'No aparece el canal',status:'open',note:'',...body},now);
const forbidden=['private-user-hash','private-user-salt','private-reseller-id','private-line-id','private-provider-key','private-provider-login','private-provider-credential','private-credential-key','private-server','private-live-lease','private-playback-payload'];
function safe(value){const text=JSON.stringify(value);for(const secret of forbidden)assert.ok(!text.includes(secret),secret+' must not enter support data');assert.ok(!/https?:\/\//.test(text));}

for(const sql of [true,false]){
 const suffix=sql?'real SQLite':'bounded KV';
 test(suffix+': new support view has explicit unknown observations and never creates or changes business leases',async()=>{
  const store=new Store(sql),before=JSON.stringify([...store.values]);
  const result=await read(store);assert.equal(result.status,200);assert.equal(result.response.headers.get('Cache-Control'),'no-store');
  assert.equal(result.data.customer.username,'Cliente01');assert.equal(result.data.customer.id,user.id);assert.equal(result.data.customer.permissions.adults,false);assert.equal(result.data.recordingSince,null);
  assert.deepEqual(result.data.lists.map(row=>row.status),['not_observed','not_observed','not_observed']);assert.equal(result.data.incidents.total,0);assert.equal(result.data.check.access,'active');assert.equal(result.data.check.connections.status,'unknown');assert.equal(result.data.check.connections.reserved,null);assert.equal(result.data.check.source.status,'observed');assert.equal(result.data.check.source.usableAccounts,1);assert.equal(result.data.check.playbackValidated,false);
  assert.equal(JSON.stringify([...store.values]),before);if(sql)assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='smn_playback_leases'").get().n,0);safe(result.data);
 });
 test(suffix+': catalog observation preserves exact request/response scope, deduplicates and cannot be overtaken by an older request',async()=>{
  const store=new Store(sql),requestId=crypto.randomUUID();
  assert.equal((await observe(store,{requestId,at:at-100,respondedAt:at,itemCount:0,selection:'category'})).status,200);
  assert.equal((await observe(store,{requestId,at:at-100,itemCount:999})).data.duplicate,true);
  let result=(await read(store)).data;assert.equal(result.recordingSince,at);const live=result.lists[0];assert.equal(live.lastRequestedAt,at-100);assert.equal(live.lastRespondedAt,at);assert.equal(live.itemCount,0);assert.equal(live.status,'empty');assert.equal(live.selection,'category');
  await observe(store,{at:at-200,itemCount:123});result=(await read(store)).data;assert.equal(result.lists[0].itemCount,0,'older completions cannot replace newer list observations');
  await observe(store,{type:'movie',access:'api',itemCount:4});await observe(store,{type:'series',itemCount:5});
  result=(await read(store)).data;assert.deepEqual(result.lists.map(row=>[row.type,row.status,row.itemCount]),[['live','empty',0],['movie','delivered',4],['series','delivered',5]]);assert.equal(result.incidents.total,0);safe(result);
 });
 test(suffix+': observation identity/version, input bounds and isolated service-check rules hold',async()=>{
  const store=new Store(sql),before=JSON.stringify([...store.values]);
  assert.equal((await observe(store,{uid:second.id})).status,403);assert.equal((await observe(store,{version:2})).status,403);assert.equal((await observe(store,{at:at+1})).status,400);assert.equal((await observe(store,{requestId:'not-a-request'})).status,400);assert.equal((await observe(store,{publicId:'https://private.invalid'})).status,400);assert.equal((await observe(store,{type:'password'})).status,400);assert.equal((await observe(store,{itemCount:-1})).status,400);assert.equal((await observe(store,{at:at-31*60000})).status,400);
  assert.equal((await observe(store,{serviceCheck:true})).data.ignored,true);assert.equal(JSON.stringify([...store.values]),before);if(sql)assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'smn_support_%'").get().n,0);
 });
 test(suffix+': genuine errors remain unconfirmed while policy denials and cancellation do not create incidents',async()=>{
  const store=new Store(sql);
  for(const [httpStatus,code]of [[403,'content_disabled'],[410,'playback_superseded'],[409,'user_connection_limit'],[409,'ccf_capacity'],[416,'range_out_of_bounds']])await observe(store,{kind:'playback',httpStatus,code});
  assert.equal((await read(store)).data.incidents.total,0);
  await observe(store,{httpStatus:403,code:'content_disabled'});assert.equal((await read(store)).data.lists[0].status,'restricted');
  const requestId=crypto.randomUUID();await observe(store,{requestId,kind:'playback',type:'movie',httpStatus:502,code:'upstream_unavailable',publicId:'123'});await observe(store,{requestId,kind:'playback',type:'movie',httpStatus:502,code:'upstream_unavailable',publicId:'123'});
  const result=(await read(store)).data;assert.equal(result.incidents.total,1);assert.equal(result.incidents.rows[0].count,1);assert.equal(result.incidents.rows[0].publicId,'123');assert.equal(result.incidents.rows[0].status,'open');assert.ok(!JSON.stringify(result).includes('local_fault'));safe(result);
 });
 test(suffix+': exact-resource failures aggregate but distinct/unknown/category resources stay separate and successful requests never close them',async()=>{
  const store=new Store(sql);const failure={kind:'playback',httpStatus:404,code:'upstream_unavailable',publicId:'123'};
  await observe(store,failure);await observe(store,failure);await observe(store,{...failure,publicId:'124'});await observe(store,{...failure,publicId:undefined});await observe(store,{...failure,publicId:undefined});
  await observe(store,{httpStatus:502,selection:'category',code:'upstream_unavailable'});await observe(store,{httpStatus:502,selection:'category',code:'upstream_unavailable'});
  let result=(await read(store)).data;assert.equal(result.incidents.total,6);assert.equal(result.incidents.rows.find(row=>row.publicId==='123').count,2);
  await observe(store,{...failure,httpStatus:200,code:undefined});result=(await read(store)).data;assert.equal(result.incidents.total,6);assert.ok(result.incidents.rows.every(row=>row.status==='open'));
  const target=result.incidents.rows.find(row=>row.publicId==='123');assert.equal((await incident(store,{id:target.id,status:'resolved',expectedRevision:target.revision,note:'Cliente confirmó el recurso exacto.'})).status,200);
  await observe(store,failure);result=(await read(store)).data;assert.equal(result.incidents.total,7,'a recurrence does not silently reopen or rewrite the resolved incident');assert.equal(result.incidents.rows.filter(row=>row.status==='resolved').length,1);
 });
 test(suffix+': optional blank notes, optimistic edits, no foreign-user writes and explicit owner resolution work',async()=>{
  const store=new Store(sql),created=await incident(store);assert.equal(created.status,200);assert.equal(created.data.incident.note,'');assert.equal(created.data.incident.revision,1);const id=created.data.incident.id;
  assert.equal((await incident(store,{id,status:'investigating',expectedRevision:1,note:'<b>Texto solamente</b>'})).status,200);
  assert.equal((await incident(store,{id,status:'resolved',expectedRevision:1})).status,409);
  assert.equal((await incident(store,{username:'cliente02',id,status:'resolved',expectedRevision:2})).status,404);
  assert.equal((await incident(store,{id,status:'resolved',expectedRevision:2,note:''})).status,200);
  const result=(await read(store)).data;assert.equal(result.incidents.rows[0].status,'resolved');assert.equal(result.incidents.rows[0].note,'');assert.equal(result.incidents.rows[0].revision,3);
  assert.equal((await incident(store,{note:'x'.repeat(2001)})).status,400);assert.equal((await incident(store,{title:'x'.repeat(161)})).status,400);assert.equal((await incident(store,{title:'ab'})).status,400);assert.equal((await incident(store,{note:'password=private-secret'})).status,400);assert.equal((await incident(store,{note:'https://private.invalid'})).status,400);assert.equal((await incident(store,{note:'IP 198.51.100.7'})).status,400);safe(result);
 });
 test(suffix+': deleting and recreating a username cannot inherit another user UUID observations',async()=>{
  const store=new Store(sql);await observe(store);await incident(store);
  await store.put('user:cliente01',{...user,id:'33333333-3333-4333-8333-333333333333',version:1});
  const result=(await read(store)).data;assert.equal(result.incidents.total,0);assert.ok(result.lists.every(row=>row.status==='not_observed'));assert.equal((await observe(store)).status,403);safe(result);
 });
 test(suffix+': per-user bounded history, receipt window, pagination and thirty-day retention hold',async()=>{
  const store=new Store(sql);for(let n=0;n<105;n++)await incident(store,{title:'Consulta '+n},at+n);
  let result=(await read(store,{},at+105)).data;assert.equal(result.incidents.total,100);assert.equal(result.incidents.rows.length,25);assert.equal(result.incidents.pages,4);
  result=(await read(store,{page:4},at+105)).data;assert.equal(result.incidents.page,4);assert.equal(result.incidents.rows.length,25);assert.equal((await read(store,{pageSize:9})).status,400);
  for(let n=0;n<140;n++)await observe(store,{at:at+200+n},at+200+n);
  assert.equal((await store.get('support:receipts:'+user.id)).length,128);
  result=(await read(store,{},at+31*DAY)).data;assert.equal(result.incidents.total,0);assert.ok(result.lists.every(row=>row.status==='not_observed'));
  await incident(store,{title:'Consulta vigente'},at+31*DAY);result=(await read(store,{},at+31*DAY)).data;assert.equal(result.incidents.total,1);
  if(!sql)assert.equal((await store.get('support:incident-index:'+user.id)).length,1);
 });
}

test('source-scoped catalog observations remain partial and do not merge distinct unknown sources',async()=>{
 const store=new Store();await observe(store,{selection:'source',httpStatus:502,code:'upstream_unavailable'});await observe(store,{selection:'source',httpStatus:502,code:'upstream_unavailable'});
 const result=(await read(store)).data;assert.equal(result.lists[0].selection,'source');assert.equal(result.incidents.total,2);assert.ok(result.incidents.rows.every(row=>row.count===1));
});
test('manual follow-up timestamps preserve first/last observed times while exposing the actual edit time',async()=>{
 const store=new Store(),created=await incident(store);const updated=await incident(store,{id:created.data.incident.id,status:'investigating',expectedRevision:1},at+60000);
 assert.equal(updated.data.incident.firstSeenAt,at);assert.equal(updated.data.incident.lastSeenAt,at);assert.equal(updated.data.incident.updatedAt,at+60000);
});

test('real SQLite counts only active exact-user leases and never changes the lease rows or user data',async()=>{
 const store=new Store();store.leases();const before=store.db.prepare('SELECT * FROM smn_playback_leases ORDER BY id').all(),userBefore=JSON.stringify(await store.get('user:cliente01'));
 const result=await call(store,'/client-support-check');assert.equal(result.status,200);assert.deepEqual(result.data.check.connections,{reserved:1,limit:3,status:'observed'});assert.equal(JSON.stringify(await store.get('user:cliente01')),userBefore);assert.deepEqual(store.db.prepare('SELECT * FROM smn_playback_leases ORDER BY id').all(),before);assert.ok(!store.queries.some(query=>/^(?:DELETE|UPDATE|INSERT).*smn_playback_leases/.test(query)));safe(result.data);
});
test('expired and suspended users remain inspectable while freshness and failed reads remain explicit',async()=>{
 const store=new Store();await store.put('user:cliente01',{...user,expiresAt:at-1});assert.equal((await read(store)).data.check.access,'expired');
 await store.put('user:cliente01',{...user,status:'suspended'});assert.equal((await read(store)).data.check.access,'suspended');
 const pool=await store.get('pool');pool.syncedAt=at-6*60000;await store.put('pool',pool);assert.equal((await read(store)).data.check.source.status,'stale');
 pool.syncedAt=at+1;await store.put('pool',pool);assert.equal((await read(store)).data.check.source.status,'unknown');
 const original=store.get.bind(store);store.get=key=>key==='pool'?Promise.reject(Error('private-provider-secret')):original(key);
 const result=(await read(store)).data;assert.deepEqual(result.check.source,{status:'unknown',observedAt:null,usableAccounts:null});safe(result);
});
test('unexpected failures expose a fixed diagnostic error and unknown routes never initialize support storage',async()=>{
 const store=new Store();store.get=()=>{throw Error('https://private.invalid/password=secret');};
 const missing=await clientSupportRoute(store,'/not-support',{}, {now:at});assert.equal(missing.status,404);
 const result=await call(store,'/client-support-read');assert.equal(result.status,503);assert.deepEqual(result.data,{error:'support_unavailable'});
});
