import assert from 'node:assert/strict';
import {openLeaseStore} from '../src/lease-store.mjs';
import {accountsFetch} from '../src/accounts.mjs';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve();this.calls=[];this.failKey=null}
 async get(k){this.calls.push(['get',k]);return structuredClone(this.data.get(k))}
 async put(k,v){this.calls.push(['put',k,JSON.stringify(v).length]);if(k===this.failKey)throw Error('injected_write_failure');this.data.set(k,structuredClone(v))}
 async delete(k){this.calls.push(['delete',k]);this.data.delete(k)}
 async list({prefix}){this.calls.push(['list',prefix]);return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))}
 transaction(fn){const result=this.queue.then(async()=>{const before=structuredClone(this.data);try{return await fn(this)}catch(e){this.data=before;throw e}});this.queue=result.catch(()=>{});return result}
}
const store=new Store(),now=Date.now();
const old={a:{sid:'session-a',uid:'customer-a',username:'customer-a',version:1,provider_id:'account-a',until:now+90000,request_id:'request-a',mediaKey:'live|ccf|10|m3u8'},b:{sid:'session-b',uid:'customer-b',username:'customer-b',version:1,provider_id:'account-b',until:now+90000},expired:{sid:'expired',uid:'expired',until:now-1}};
await store.put('leases',old);store.failKey='playback-lease:b';
await assert.rejects(openLeaseStore(store));assert.deepEqual(await store.get('leases'),old);assert.equal(await store.get('lease-schema-v2'),undefined);assert.equal(await store.get('playback-lease:a'),undefined,'partial migration rolls back');
store.failKey=null;const repo=await openLeaseStore(store);assert.equal(await repo.count(),2);assert.equal(await store.get('leases'),undefined);assert.equal(await store.get('lease-schema-v2'),2);assert.equal((await repo.get('a')).request_id,'request-a');assert.equal(await openLeaseStore(store),repo);
await store.put('user:customer-a',{id:'customer-a',username:'customer-a',version:1,status:'active'});await store.put('playback:session-a',{request_id:'request-a'});
for(let i=0;i<1000;i++)await repo.put('other-'+i,{sid:'s'+i,uid:'u'+i,username:'u'+i,version:1,provider_id:'p'+i,until:now+90000});
store.calls=[];
const response=await accountsFetch({storage:store},{},new Request('https://private/accounts/heartbeat',{method:'POST',body:JSON.stringify({sid:'session-a',lease_id:'a',request_id:'request-a'})}));assert.equal(response.status,200);
assert.equal(store.calls.some(([op])=>op==='list'),false,'heartbeat never enumerates unrelated leases');
assert.ok(store.calls.every(([,key])=>['playback-lease:a','playback:session-a','user:customer-a'].includes(key)),'heartbeat only touches its own lease, ownership and customer');
assert.equal(store.calls.filter(([op])=>op==='put').length,1,'one heartbeat writes exactly one lease');
assert.ok(store.calls.find(([op])=>op==='put')[2]<500,'heartbeat payload stays small with a thousand other leases');
const release=await accountsFetch({storage:store},{},new Request('https://private/accounts/release-session',{method:'POST',body:JSON.stringify({sid:'session-a'})}));assert.equal(release.status,200);assert.equal(await repo.get('a'),undefined);assert.ok(await repo.get('b'));assert.equal(await repo.count(),1001);
console.log('PASS: transactional migration with rollback/retry, active lease identity preservation, no legacy aggregate, isolated constant-size heartbeat and session cleanup.');
