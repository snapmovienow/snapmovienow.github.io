import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createOwnerPortal} from '../src/owner-portal.mjs';
import {accountsFetch} from '../src/accounts.mjs';
import {clientSupportRoute} from '../src/client-support.mjs';
import {PORTAL_ACCOUNT,PORTAL_SOURCE} from '../src/reseller-portal.mjs';

const origin='https://api.snaptvnow.com',endpoint=origin+'/owner-panel/api/client-support';
const session='s'.repeat(64),cookie='__Host-SNAP_Owner_Portal='+session;
const accountId='fixture-account',lineId='fixture-line';
const customer={id:'11111111-1111-4111-8111-111111111111',username:'cliente01',displayUsername:'Cliente01',name:'Cliente de prueba',version:3,status:'active',expiresAt:Date.now()+86400000,permissions:{tv:true,movies:true,series:true,adults:false},resellerBridge:{accountId,lineId},hash:'PRIVATE_HASH',salt:'PRIVATE_SALT'};
class Store{
 constructor(){
  this.values=new Map([['user:cliente01',structuredClone(customer)],['reseller-line:'+accountId+':'+lineId,{username:'cliente01',version:3,revoked:false}],['business-sentinel',{untouched:true}]]);this.queue=Promise.resolve();
  this.db=new DatabaseSync(':memory:');this.sql={exec:(query,...values)=>{if(!values.length&&/;\s*\S/.test(query)){this.db.exec(query);return {toArray:()=>[]};}const rows=this.db.prepare(query).all(...values);return {toArray:()=>rows};}};
 }
 async get(key){return structuredClone(this.values.get(key));}
 async put(key,value){this.values.set(key,structuredClone(value));}
 async delete(key){this.values.delete(key);}
 async list(){assert.fail('support cannot enumerate business accounts');}
 transaction(operation){const pending=this.queue.then(async()=>{const before=structuredClone(this.values);this.db.exec('BEGIN');try{const value=await operation(this);this.db.exec('COMMIT');return value;}catch(e){this.values=before;this.db.exec('ROLLBACK');throw e;}});this.queue=pending.catch(()=>{});return pending;}
}
function harness(){
 const store=new Store(),authorizations=[],support=[];
 let authorize=()=>Response.json({ok:true,actor:{id:'owner',role:'owner'},customer:{accountId,lineId,username:'Cliente01'}});
 const handle=createOwnerPortal({
  getConfig:async()=>({accountId:PORTAL_ACCOUNT,sourceOrigin:PORTAL_SOURCE,siteToken:'PRIVATE_SITE_TOKEN',gatewaySecret:'f'.repeat(64)}),
  fetcher:async(url,options)=>{assert.equal(url,PORTAL_SOURCE+'/api/owner-portal');assert.equal(options.redirect,'manual');assert.equal(options.headers.Cookie,undefined);const body=JSON.parse(options.body);authorizations.push(body);return authorize(body);},
  supportCall:async(env,body)=>{support.push(body);return accountsFetch({storage:store},env,new Request('https://private/accounts/client-support-portal',{method:'POST',body:JSON.stringify(body)}));}
 });
 const request=(body={action:'client-support-read',accountId,lineId},options={})=>handle(new Request(endpoint+(options.query||''),{method:options.method||'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie,...options.headers},...((options.method||'POST')==='POST'?{body:options.raw??JSON.stringify(body)}:{})}),{});
 return {store,authorizations,support,request,setAuthorize(fn){authorize=fn;}};
}
async function result(response){return {status:response.status,data:await response.json(),headers:response.headers};}
const payload=(action='client-support-read',extra={})=>({action,accountId,lineId,...extra});
const business=store=>JSON.stringify([...store.values].filter(([k])=>!k.startsWith('support:')));
function safe(value){const text=JSON.stringify(value);for(const privateValue of ['PRIVATE_HASH','PRIVATE_SALT','PRIVATE_SITE_TOKEN',cookie,accountId,lineId])assert.ok(!text.includes(privateValue));}

test('private portal configuration reads never initialize or change the business lease store',async()=>{
 const store=new Store(),configuration={encrypted:'fixture-encrypted-configuration',revision:1};await store.put('reseller-portal:'+PORTAL_ACCOUNT,configuration);const before=business(store);
 const response=await accountsFetch({storage:store},{},new Request('https://private/accounts/reseller-portal-config',{method:'POST',body:JSON.stringify({accountId:PORTAL_ACCOUNT})}));assert.equal(response.status,200);assert.deepEqual(await response.json(),configuration);assert.equal(business(store),before);assert.equal(store.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='smn_playback_leases'").get().n,0);
});

test('owner support endpoint retains private cookie, method, origin and JSON controls before authorization',async()=>{
 const h=harness();
 for(const headers of [{Cookie:''},{Cookie:cookie+'; '+cookie},{Cookie:'__Host-SNAP_Resellers='+session}])assert.equal((await h.request(payload(),{headers})).status,401);
 assert.equal((await h.request(payload(),{method:'GET'})).status,405);
 for(const headers of [{Origin:''},{Origin:'https://foreign.invalid'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await h.request(payload(),{headers})).status,403);
 assert.equal((await h.request(payload(),{headers:{'Content-Type':'text/plain'}})).status,415);
 assert.equal(h.authorizations.length,0);assert.equal(h.support.length,0);
});

test('owner support input allowlist rejects browser identities, observation actions and malformed or oversized fields',async()=>{
 const h=harness();
 for(const body of [payload(undefined,{username:'cliente01'}),payload(undefined,{actor:'owner'}),payload('client-support-observe'),payload('save'),payload(undefined,{accountId:'../other'}),payload(undefined,{lineId:''}),payload(undefined,{page:0}),payload(undefined,{pageSize:100}),payload(undefined,{note:'not a read field'}),payload('client-support-incident-save',{title:'Hi',status:'open'}),payload('client-support-incident-save',{title:'Consulta',status:'invalid'}),payload('client-support-incident-save',{title:'Consulta',status:'open',note:'x'.repeat(2001)}),payload('client-support-incident-save',{id:crypto.randomUUID(),status:'resolved'}),payload('client-support-incident-save',{id:crypto.randomUUID(),status:'resolved',expectedRevision:0})])assert.equal((await h.request(body)).status,400,JSON.stringify(body).slice(0,120));
 for(const raw of ['null','[]','{bad'])assert.equal((await h.request(undefined,{raw})).status,400);
 assert.equal((await h.request(payload(),{headers:{'Content-Length':'24001'}})).status,400);
 assert.equal((await h.request(payload(),{query:'?username=cliente01'})).status,400);
 assert.equal(h.authorizations.length,0);assert.equal(h.support.length,0);
});

test('owner support demands a freshly authorized owner and exact Site account/line pair',async()=>{
 const h=harness(),good={ok:true,actor:{id:'owner',role:'owner'},customer:{accountId,lineId,username:'Cliente01'}};
 for(const value of [{...good,ok:false},{...good,actor:{id:'other',role:'owner'}},{...good,actor:{id:'owner',role:'reseller'}},{...good,customer:{...good.customer,accountId:'foreign'}},{...good,customer:{...good.customer,lineId:'foreign'}},{...good,customer:{...good.customer,username:'https://private.invalid'}}]){
  h.setAuthorize(()=>Response.json(value));assert.equal((await h.request()).status,403);
 }
 assert.equal(h.support.length,0);
 h.setAuthorize(()=>Response.json({error:'PRIVATE_SITE_TOKEN'},{status:401}));const expired=await result(await h.request());assert.equal(expired.status,401);assert.ok(expired.headers.get('Set-Cookie').includes('Max-Age=0'));safe(expired.data);
 h.setAuthorize(()=>Response.json({error:'PRIVATE_SITE_TOKEN'},{status:503}));const unavailable=await result(await h.request());assert.equal(unavailable.status,503);assert.deepEqual(unavailable.data,{error:'support_unavailable'});safe(unavailable.data);
});

test('owner support revalidates every read/check and resolves the UUID through the current account/line mapping without changing business state',async()=>{
 const h=harness(),before=business(h.store);
 for(const action of ['client-support-read','client-support-check']){
  const response=await result(await h.request(payload(action)));assert.equal(response.status,200);assert.equal(response.data.customer.id,customer.id);assert.equal(response.data.customer.username,'Cliente01');assert.equal(response.data.check.playbackValidated,false);assert.equal(response.headers.get('Cache-Control'),'private, no-store, max-age=0');safe(response.data);
  assert.deepEqual(h.authorizations.at(-1),{action:'support-authorize',token:session,input:{accountId,lineId},accountId:PORTAL_ACCOUNT});
  assert.deepEqual(h.support.at(-1),{action,accountId,lineId,confirmedUsername:'Cliente01'});
 }
 assert.equal(h.authorizations.length,2);assert.equal(business(h.store),before);assert.equal(h.store.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='smn_playback_leases'").get().n,0);
});

test('owner support manual notes remain optional, actor is server-defined, revisions cannot overwrite another follow-up',async()=>{
 const h=harness(),before=business(h.store),created=await result(await h.request(payload('client-support-incident-save',{title:'No aparece un canal',status:'open',note:''})));assert.equal(created.status,200);assert.equal(created.data.incident.note,'');const id=created.data.incident.id;
 assert.deepEqual(h.authorizations[0].input,{accountId,lineId},'notes and operation data never enter the Site authorization request');
 const stored=JSON.parse(h.store.db.prepare('SELECT data FROM smn_support_incidents WHERE id=?').get(id).data);assert.equal(stored.updatedBy,'owner');
 let updated=await result(await h.request(payload('client-support-incident-save',{id,status:'investigating',note:'',expectedRevision:1})));assert.equal(updated.status,200);assert.equal(updated.data.incident.revision,2);
 updated=await result(await h.request(payload('client-support-incident-save',{id,status:'resolved',note:'',expectedRevision:1})));assert.equal(updated.status,409);assert.equal(business(h.store),before);safe(updated.data);
 const internal=await clientSupportRoute(h.store,'/client-support-portal',payload('client-support-incident-save',{confirmedUsername:'cliente01',title:'Otro caso manual',status:'open',actor:'forged-owner'}));assert.equal(internal.status,200);const other=(await internal.json()).incident.id;assert.equal(JSON.parse(h.store.db.prepare('SELECT data FROM smn_support_incidents WHERE id=?').get(other).data).updatedBy,'owner');
});

test('owner support fails closed when Site identity or bridge ownership changes between authorization and directory lookup',async()=>{
 for(const change of [async s=>s.delete('reseller-line:'+accountId+':'+lineId),async s=>s.put('reseller-line:'+accountId+':'+lineId,{username:'cliente02'}),async s=>s.delete('user:cliente01'),async s=>s.put('user:cliente01',{...customer,resellerBridge:{accountId:'foreign',lineId}}),async s=>s.put('user:cliente01',{...customer,resellerBridge:{accountId,lineId:'foreign'}})]){
  const h=harness();h.setAuthorize(async()=>{await change(h.store);return Response.json({ok:true,actor:{id:'owner',role:'owner'},customer:{accountId,lineId,username:'Cliente01'}});});const response=await result(await h.request());assert.equal(response.status,403);assert.deepEqual(response.data,{error:'support_scope'});assert.equal(h.store.db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE 'smn_support_%'").get().n,0);
 }
});

test('a recreated customer cannot inherit the former UUID history through owner portal, and suspended mapped accounts remain inspectable',async()=>{
 const h=harness();const made=await result(await h.request(payload('client-support-incident-save',{title:'Caso de la cuenta anterior',status:'open'})));assert.equal(made.status,200);
 await h.store.put('user:cliente01',{...customer,id:'22222222-2222-4222-8222-222222222222',version:1,status:'suspended'});await h.store.put('reseller-line:'+accountId+':'+lineId,{username:'cliente01',version:4,revoked:true});
 const response=await result(await h.request());assert.equal(response.status,200);assert.equal(response.data.incidents.total,0);assert.equal(response.data.check.access,'suspended');assert.ok(response.data.lists.every(x=>x.status==='not_observed'));
 assert.equal((await h.request(payload('client-support-incident-save',{id:made.data.incident.id,status:'resolved',expectedRevision:1}))).status,404);
 for(const action of ['client-support-observe','reseller-apply','client-support-portal'])assert.equal((await clientSupportRoute(h.store,'/client-support-portal',payload(action,{confirmedUsername:'cliente01'}))).status,400);
});
