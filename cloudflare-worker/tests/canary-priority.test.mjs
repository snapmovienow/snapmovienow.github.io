import assert from 'node:assert/strict';
import {accountsFetch} from '../src/accounts.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';
class Store{constructor(){this.data=new Map();this.queue=Promise.resolve()}async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)))}transaction(fn){const r=this.queue.then(()=>fn(this));this.queue=r.catch(()=>{});return r}}
async function fixture(mode='panel',multiple=false){
 const storage=new Store(),state={storage},env={PLAYBACK_CANARY_USERNAME:'probe'},leases=await openLeaseStore(storage);let sequence=0;
 await storage.put('provider',{mode,maxConnections:3});
 await storage.put('pool',{syncedAt:Date.now(),lines:(multiple?['a','b']:['a']).map(id=>({id,server:'ccf',encrypted:'opaque',credentialKey:'key',external:0,maxConnections:3}))});
 for(const username of ['probe','viewer1','viewer2','viewer3','viewer4','viewer5'])await storage.put('user:'+username,{id:username,username,version:1,status:'active'});
 const call=async(path,body)=>{const r=await accountsFetch(state,env,new Request('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)}));return {status:r.status,data:await r.json()}};
 const start=async(username,extra={})=>{const body={sid:username,uid:username,username,version:1,request_id:'r'+(++sequence),revision:sequence,server:'ccf',mediaKey:'live|ccf|1|ts',upstreamMax:3,...extra};await call('/playback-begin',body);return {...await call('/acquire',body),body}};
 const alive=r=>call('/lease-check',{...r.body,lease_id:r.data.lease_id});
 const release=r=>call('/release',{...r.body,lease_id:r.data.lease_id});
 return {storage,leases,call,start,alive,release};
}
for(const mode of ['panel','single']){
 const f=await fixture(mode),probe=await f.start('probe',{canary:true});assert.equal(probe.status,200);
 const first=await f.start('viewer1');assert.equal(first.status,200);assert.equal((await f.alive(probe)).status,200,'spare capacity preserves the background video');
 await f.start('viewer1',{mediaKey:'live|ccf|2|ts'});assert.equal((await f.alive(probe)).status,200,'a channel change cannot cancel an unrelated probe');
 const second=await f.start('viewer2');assert.equal(second.status,200);assert.equal((await f.alive(probe)).status,200);
 const third=await f.start('viewer3');assert.equal(third.status,200);assert.equal((await f.alive(probe)).status,410,'the customer immediately reclaims the required slot');assert.equal(await f.leases.count(),3);
 await f.release(probe);assert.equal(await f.leases.count(),3,'late probe cleanup preserves every customer');
 assert.equal((await f.start('probe',{canary:true})).status,409,'the test cannot evict customers');assert.equal((await f.start('viewer4')).status,409,'reclaiming the probe cannot overbook capacity');
}
{
 const f=await fixture('panel',true),prior=await f.start('viewer1',{exclude:['b']});await f.release(prior);
 const probe=await f.start('probe',{canary:true,exclude:['b']});assert.equal(probe.data.provider_id,'a');
 await f.start('viewer2',{exclude:['b']});await f.start('viewer3',{exclude:['b']});assert.equal((await f.alive(probe)).status,200);
 const other=await f.start('viewer4',{exclude:['a']});assert.equal(other.data.provider_id,'b');assert.equal((await f.alive(probe)).status,200,'requests on a separate provider cannot interrupt the probe');
 const home=await f.start('viewer1');assert.equal(home.data.provider_id,'a','a probe cannot force a customer off the assigned healthy account');assert.equal((await f.alive(probe)).status,410);assert.equal((await f.alive(other)).status,200);
}
{
 const f=await fixture(),probe=await f.start('probe',{canary:true});
 const arrivals=await Promise.all(['viewer1','viewer2','viewer3','viewer4'].map(name=>f.start(name)));
 assert.equal(arrivals.filter(r=>r.status===200).length,3);assert.equal(arrivals.filter(r=>r.status===409).length,1);assert.equal(await f.leases.count(),3);assert.equal((await f.alive(probe)).status,410,'concurrent customers atomically reclaim exactly one probe slot');
}
console.log('PASS: spare-capacity probe survival, channel changes, unrelated providers, customer affinity, atomic reclamation, single/panel capacity and late cleanup isolation.');
