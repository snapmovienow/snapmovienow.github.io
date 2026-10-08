import assert from 'node:assert/strict';
import {parseLines,readPanel} from '../src/reseller.mjs';
import {accountsFetch} from '../src/accounts.mjs';
const row=(id,used=0,max=3,active=true)=>["<a href=\"line?id="+id+"\">"+id+"</a>",'<a>test-line-'+id+'</a>','<span class="table-trunc-copy-cell__text tooltip" title="fake-line-password">hidden</span>','owner',active?'<i title="Active"></i>':'<i title="Expired"></i>','','',String(used),String(max),'','','2099-01-01'];
assert.equal(parseLines({data:[row(1),row(2,0,3,false)]}).length,1);
assert.equal(parseLines({data:[row(1)]})[0].password,'fake-line-password');
let loginCalls=0;globalThis.fetch=async(url,opts)=>{const u=new URL(url);assert.equal(u.origin,'http://ccf.center:8444');if(u.pathname.endsWith('/login')){if(opts.method==='POST'){loginCalls++;assert.ok(opts.body.includes('username=owner'));assert.ok(opts.headers.Cookie);return new Response('<a href="dashboard">Welcome</a>')}return new Response('<input name="password">',{headers:{'set-cookie':'PHPSESSID=fake-cookie; path=/'}})}if(u.pathname.endsWith('/table')){assert.equal(u.searchParams.get('id'),'lines');return Response.json({recordsFiltered:2,data:[row(1,1),row(2)]})}throw Error('unexpected_request')};
const loaded=await readPanel('owner','fake-password');assert.equal(loaded.length,2);assert.equal(loginCalls,1);
// The provider-filtered inventory can omit idle active subscriptions.
// Read all lines, then exclude disabled and expired subscriptions locally.
globalThis.fetch=async(url,opts)=>{
 const u=new URL(url);
 if(u.pathname.endsWith('/login'))return opts.method==='POST'?new Response('<a href="dashboard">Welcome</a>'):new Response('<input name="password">',{headers:{'set-cookie':'PHPSESSID=idle-test; path=/'}});
 if(u.pathname.endsWith('/table')){
  assert.equal(u.searchParams.get('filter'),'','read the complete authorised inventory before validating active subscriptions');
  return Response.json({recordsFiltered:14,data:[...Array.from({length:12},(_,i)=>row(i+10,0,3)),row(30,0,3,false),[...row(31)].map((cell,i)=>i===11?'2000-01-01':cell)]});
 }
 throw Error('unexpected_request');
};
const idle=await readPanel('idle-reseller','test-password');
assert.equal(idle.length,12);assert.equal(idle.reduce((n,l)=>n+l.maxConnections-l.external,0),36);
assert.ok(idle.every(l=>l.external===0),'idle active accounts contribute capacity');
console.log('PASS: Provider-side inventory filters cannot hide idle active subscriptions; disabled and expired subscriptions stay excluded.');
class Store{constructor(){this.data=new Map();this.queue=Promise.resolve()}async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}transaction(fn){const r=this.queue.then(()=>fn(this));this.queue=r.catch(()=>{});return r}}
const storage=new Store(),state={storage};const call=async(path,b={})=>{const r=await accountsFetch(state,{},new Request('https://internal/accounts'+path,{method:'POST',body:JSON.stringify(b)}));return {status:r.status,data:await r.json()}};
await call('/provider-save',{mode:'panel',encrypted:'fake-encrypted-reseller',username:'owner'});
await call('/pool-sync',{lines:loaded.map(l=>({id:l.id,external:l.external,maxConnections:l.maxConnections,encrypted:'fake-encrypted-line-'+l.id}))});
for(let i=0;i<6;i++)await storage.put('user:customer'+i,{id:'u'+i,username:'customer'+i,version:1,status:'active'});
const acquire=i=>call('/acquire',{sid:'sid'+i,username:'customer'+i,uid:'u'+i,version:1});
const allocations=await Promise.all(Array.from({length:6},(_,i)=>acquire(i)));assert.equal(allocations.filter(a=>a.status===200).length,5);assert.equal(allocations.filter(a=>a.status===409).length,1);
assert.ok(allocations.filter(a=>a.status===200).every(a=>a.data.maxConnections<=3));
assert.equal((await call('/release',{sid:'wrong',lease_id:allocations[0].data.lease_id})).status,410);
await call('/release-session',{sid:'sid0'});assert.equal((await acquire(5)).status,200);
await call('/pool-sync',{lines:[{id:'2',external:0,maxConnections:3,encrypted:'fake-encrypted-line-2'}]});
const leases=await storage.get('leases');assert.ok(Object.values(leases).every(l=>l.provider_id==='2'));
const overview=await call('/overview');assert.equal(overview.data.provider.activeAccounts,1);assert.ok(!JSON.stringify(overview).includes('encrypted'));
console.log('PASS: reseller login/read-only pagination, active-line parsing, capacity with existing external connections, concurrent pool allocation, ownership, release, removed-line revocation and public credential isolation.');

const before=Object.keys(await storage.get('leases')).length;
await call('/provider-add',{source:'panel:second',mode:'panel',username:'second',encrypted:'second-secret',lines:[{id:'2',external:0,maxConnections:3,encrypted:'line2'},{id:'3',external:0,maxConnections:3,encrypted:'line3'}]});
let added=await call('/overview');assert.equal(added.data.provider.sourceCount,2);assert.equal(added.data.provider.activeAccounts,2);assert.equal(added.data.provider.maxConnections,6);assert.equal(Object.keys(await storage.get('leases')).length,before);
await call('/provider-add',{source:'panel:second',mode:'panel',username:'second',encrypted:'updated-secret',lines:[{id:'2',external:0,maxConnections:3,encrypted:'line2'},{id:'3',external:0,maxConnections:3,encrypted:'line3'}]});
assert.equal((await call('/overview')).data.provider.sourceCount,2);
await call('/pool-sync',{source:'panel:owner',lines:[{id:'4',external:0,maxConnections:3,encrypted:'line4'}]});
added=await call('/overview');assert.equal(added.data.provider.activeAccounts,3);assert.equal(added.data.provider.maxConnections,9);assert.ok(!JSON.stringify(added).includes('secret'));
console.log('PASS: additive panels, duplicate accounts counted once, same panel updated without duplication, source refresh preserves other panels, existing leases preserved.');
