import assert from 'node:assert/strict';
import {accountsFetch} from '../src/accounts.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';
import {rememberProvider,pruneAffinities} from '../src/provider-affinity.mjs';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve()}
 async get(k){return structuredClone(this.data.get(k))}
 async put(k,v){this.data.set(k,structuredClone(v))}
 async delete(k){this.data.delete(k)}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))}
 transaction(fn){const r=this.queue.then(()=>fn(this));this.queue=r.catch(()=>{});return r}
}
const now=Date.now;let offset=0;Date.now=()=>now()+offset;
const storage=new Store(),state={storage},leases=await openLeaseStore(storage);
const call=async(path,b={})=>{const r=await accountsFetch(state,{},new Request('https://private/accounts'+path,{method:'POST',body:JSON.stringify(b)}));return {status:r.status,data:await r.json()}};
const lines=[{id:'a',server:'ccf',external:0,maxConnections:3,encrypted:'sealed-a'},{id:'b',server:'ccf',external:0,maxConnections:3,encrypted:'sealed-b'},{id:'c',server:'beta',external:0,maxConnections:3,encrypted:'sealed-c'}];
await storage.put('provider',{mode:'panel'});await storage.put('pool',{lines,syncedAt:Date.now()});
for(let i=0;i<5;i++)await storage.put('user:viewer'+i,{id:'u'+i,username:'viewer'+i,version:1,status:'active'});
const session=(i=0,sid='s'+i)=>({sid,uid:'u'+i,username:'viewer'+i,version:1,xtream:true});
let sequence=0;
const start=async(s=session(),id=10,ext='ts',extra={})=>{
 const body={...s,request_id:'request-'+(++sequence),server:'ccf',mediaKey:'live|ccf|'+id+'|'+ext,...extra};
 assert.equal((await call('/playback-begin',body)).status,200);return {...await call('/acquire',body),body};
};
const release=r=>call('/release',{...r.body,lease_id:r.data.lease_id});
let current=await start();assert.equal(current.data.provider_id,'a');
assert.equal((await call('/provider-result',{...current.body,...current.data,ok:true,stage:'validation',elapsedMs:5})).status,200);
// Another provider is faster and less occupied. Those advisory facts may help
// new viewers, but must never rotate an already connected viewer on zapping.
await storage.put('provider-health',{'account|b':{at:Date.now(),ok:true,ms:1},'channel|live|ccf|11|m3u8|b':{at:Date.now(),ok:true,ms:1}});
const other=await start(session(1));assert.equal(other.data.provider_id,'b');
const first=current;current=await start(session(),11,'m3u8');assert.equal(current.data.provider_id,'a');assert.equal(current.data.affinity,true);assert.equal(current.data.validatedRecently,true);assert.notEqual(current.data.lease_id,first.data.lease_id);
assert.equal(await leases.count(),2);assert.equal((await release(first)).status,410,'old TS cleanup cannot release the new HLS channel');
const same=await start(session(),11,'m3u8');assert.equal(same.data.lease_id,current.data.lease_id);assert.equal(same.data.reused,true);assert.equal((await release(current)).data.reused,true);
assert.equal((await call('/provider-result',{...current.body,...current.data,ok:false,stage:'signal'})).status,403,'late source failure cannot unpin the replacement request');current=same;
await release(current);assert.equal(await leases.count(),1,'affinity hint retains no capacity');
current=await start(session(),12);assert.equal(current.data.provider_id,'a');assert.equal(current.data.validatedRecently,true,'quick TS close/reopen keeps the last validated source');
offset+=31000;current=await start(session(),13);assert.equal(current.data.provider_id,'a');assert.equal(current.data.validatedRecently,false,'the short validation cache is not extended by channel changes');
// A source failure clears the pin, including when stream cleanup arrives later.
await call('/provider-result',{...current.body,...current.data,ok:false,stage:'signal',elapsedMs:10});await release(current);
current=await start(session(),14,'ts',{exclude:['a']});assert.equal(current.data.provider_id,'b');
const failed=current;await call('/release',{...current.body,lease_id:current.data.lease_id,reason:'upstream_failed'});
const saved=await storage.get('playback:s0');assert.equal(saved.affinities.ccf,undefined,'timeout/failed validation cleanup must not restore a failed source');
current=await start(session(),15,'ts',{exclude:['b']});assert.equal(current.data.provider_id,'a');await release(failed);assert.equal((await storage.get('playback:s0')).affinities.ccf.provider_id,'a');
// Hint is advisory: another viewer can take the last slot while it is closed.
await release(current);await storage.put('pool',{lines:lines.map(l=>l.id==='a'?{...l,external:3}:l),syncedAt:Date.now()});
current=await start(session(),16);assert.equal(current.data.provider_id,'b','a full preferred account falls back without exceeding its capacity');
await storage.put('pool',{lines,syncedAt:Date.now()});
const beta=await start(session(),20,'ts',{server:'beta',mediaKey:'live|beta|20|ts'});assert.equal(beta.data.provider_id,'c');
current=await start(session(),17);assert.equal(current.data.provider_id,'b','different provider groups keep separate bindings');
await storage.put('pool',{lines:lines.filter(l=>l.id!=='b'),syncedAt:Date.now()});current=await start(session(),18);assert.equal(current.data.provider_id,'a','removed/inactive inventory cannot retain an affinity');
await storage.put('pool',{lines,syncedAt:Date.now()});
// Three distinct viewers of one local user retain separate slots and bindings.
const second=await start(session(0,'second'),30),third=await start(session(0,'third'),31);assert.equal(second.status,200);assert.equal(third.status,200);
const fourth=await start(session(0,'fourth'),32);assert.equal(fourth.status,409);assert.equal(fourth.data.error,'user_connection_limit');
for(let i=0;i<10;i++){current=await start(session(),40+i,i%2?'ts':'m3u8');assert.equal(current.status,200);assert.equal(current.data.provider_id,'a');assert.equal(await leases.count({uid:'u0'}),3);}
await call('/playback-cancel',current.body);assert.equal(await leases.count({uid:'u0'}),2);current=await start(session(),60);assert.equal(current.data.provider_id,'a');
await call('/release-session',{sid:'s0'});assert.equal(await storage.get('playback:s0'),undefined);assert.equal(await leases.count({uid:'u0'}),2);
await call('/release-session',{sid:'third'});await storage.put('provider-health',{'account|b':{at:Date.now(),ok:true,ms:1}});current=await start(session(),61);assert.equal(current.data.provider_id,'a','session close releases capacity but keeps the durable user assignment');
await storage.put('user:viewer0',{id:'u0',username:'viewer0',version:2,status:'active'});
assert.equal((await start(session(),62)).status,401,'a hint does not bypass a local credential/permission version change');
const renewed={...session(),version:2};current=await start(renewed,63);assert.equal(current.status,200);assert.equal(current.data.validatedRecently,undefined,'a new local version cannot inherit a validation cache');
await storage.put('user:viewer0',{id:'u0',username:'viewer0',version:2,status:'suspended'});assert.equal((await start(renewed,64)).status,401);
await storage.put('user:viewer0',{id:'u0',username:'viewer0',version:2,status:'active'});await release(current);offset+=90001;
current=await start(renewed,65);assert.equal(current.data.affinity,true,'the durable user assignment survives an expired session hint without reserving capacity');
let bounded={};for(let i=0;i<25;i++)bounded=rememberProvider(bounded,{provider_id:'a',providerServer:'group'+i,uid:'u',version:1,until:Date.now()+90000});assert.equal(Object.keys(bounded.affinities).length,16);
offset+=90001;assert.equal(Object.keys(pruneAffinities(bounded).affinities).length,0);
console.log('PASS: source affinity survives channels/formats/quick close and restart; atomic capacity, expiry, failover, server groups, revocation, three viewers and late cleanup remain isolated.');
