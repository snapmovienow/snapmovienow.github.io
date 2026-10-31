import assert from 'node:assert/strict';
import {accountsFetch} from '../src/accounts.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';
import {LOCAL_TV_CHANNELS} from '../src/official-live.mjs';
import {localStartupSummary,recordLocalStartup,observeFirstChunk} from '../src/local-startup-observations.mjs';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve();}
 async get(key){return structuredClone(this.data.get(key));}
 async put(key,value){this.data.set(key,structuredClone(value));}
 async delete(key){this.data.delete(key);}
 async list({prefix}){return new Map([...this.data].filter(([key])=>key.startsWith(prefix)));}
 transaction(fn){const next=this.queue.then(()=>fn(this));this.queue=next.catch(()=>{});return next;}
}
const store=new Store(),channel=LOCAL_TV_CHANNELS[0],row={...channel,type:'movie',mode:'gnula',visible:true,adult:false,playbackRevision:1},user={id:'synthetic-viewer',username:'synthetic',version:1,status:'active',permissions:{tv:true}},lease={sid:'synthetic-session',uid:user.id,username:user.username,version:1,request_id:'current-request',exclusiveId:row.id,exclusiveParentId:row.id,playbackRevision:1,until:Date.now()+90000},scope={sid:lease.sid,lease_id:'lease',request_id:lease.request_id,exclusiveId:row.id,parentId:row.id,playbackRevision:1};
const leases=await openLeaseStore(store),reset=async()=>{await store.put('user:'+user.username,user);await store.put('exclusive:item:'+row.id,row);await store.put('playback:'+lease.sid,{request_id:lease.request_id});await leases.put('lease',lease);};
const call=async(path,body=scope)=>{const response=await accountsFetch({storage:store},{},new Request('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)}));return {status:response.status,data:await response.json()};};
await reset();assert.equal((await call('/heartbeat')).data.exclusiveScopeChecked,true);
for(const patch of [{exclusiveId:'other'},{parentId:'other'},{playbackRevision:2},{request_id:'old-request'},{sid:'other-session'}])assert.equal((await call('/heartbeat',{...scope,...patch})).status,410);
await store.put('exclusive:item:'+row.id,{...row,visible:false});assert.equal((await call('/heartbeat')).data.error,'title_not_allowed');
await store.put('exclusive:item:'+row.id,{...row,playbackRevision:2});assert.equal((await call('/heartbeat')).status,410);
await reset();await store.put('user:'+user.username,{...user,status:'suspended'});assert.equal((await call('/heartbeat')).status,410);
await reset();await store.put('user:'+user.username,{...user,version:2});assert.equal((await call('/heartbeat')).status,410);
await reset();await store.put('user:'+user.username,{...user,permissions:{tv:false}});assert.equal((await call('/heartbeat')).status,410);
await reset();await store.put('playback:'+lease.sid,{request_id:'replacement'});assert.equal((await call('/heartbeat')).status,410);
await reset();assert.equal((await call('/local-startup-observe',{...scope,stage:'firstVideoBytes',durationMs:1000})).status,400,'a fragment claim is required');
assert.equal((await call('/heartbeat',{...scope,localVideo:true})).data.localVideoProbe,true);
assert.equal((await call('/heartbeat',{...scope,localVideo:true})).data.localVideoProbe,undefined,'only one fragment per lease claims a sample');
for(const stage of ['playlist','firstVideoBytes']){assert.equal((await call('/local-startup-observe',{...scope,stage,durationMs:1200})).status,200);await call('/local-startup-observe',{...scope,stage,durationMs:9999});}
const summary=await localStartupSummary(store);assert.equal(summary.channels.length,1);assert.equal(summary.channels[0].firstVideoBytes.samples,1);assert.equal(summary.channels[0].playlist.lastMs,1200);assert.ok(!JSON.stringify(summary).includes('synthetic'));assert.ok(!JSON.stringify(summary).includes('https://'));
assert.equal((await localStartupSummary(store,Date.now()+3600001)).channels.length,0);
for(const args of [['unknown','playlist',100],[row.id,'unknown',100],[row.id,'playlist',-1],[row.id,'playlist',Infinity],[row.id,'playlist',120001]])assert.equal(await recordLocalStartup(store,...args),false);
let reports=0,cancelled=false;const source=new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2]));c.enqueue(new Uint8Array([3]));},cancel(){cancelled=true;}}),observed=observeFirstChunk(source,()=>reports++),reader=observed.getReader();assert.equal(reports,0,'no eager body consumption');assert.deepEqual([...((await reader.read()).value)],[1,2]);assert.equal(reports,1);assert.deepEqual([...((await reader.read()).value)],[3]);assert.equal(reports,1);await reader.cancel();assert.equal(cancelled,true);
const chunks=observeFirstChunk(new Response('video').body,()=>{throw Error('report failure')});assert.equal(await new Response(chunks).text(),'video','observation failure never blocks media');
console.log('PASS: atomic current-account/catalog/binding/lease checks, one fragment claim, deduplicated bounded nonpersonal timings, expiry, streaming and cancellation.');
