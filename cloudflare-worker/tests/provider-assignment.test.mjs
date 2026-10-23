import assert from 'node:assert/strict';
import {accountsFetch} from '../src/accounts.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';
import {assignmentKey,recentAccountProof} from '../src/provider-assignment.mjs';
import {recordProviderHealth,rankProviderCandidates} from '../src/provider-health.mjs';
import {deferPlaybackReport} from '../src/live-startup.mjs';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve()}
 async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)))}
 transaction(fn){const task=this.queue.then(()=>fn(this));this.queue=task.catch(()=>{});return task}
}
const realNow=Date.now;let now=realNow();Date.now=()=>now;
async function fixture(){
 const storage=new Store(),state={storage},env={PLAYBACK_CANARY_USERNAME:'viewer'};
 const lines=['a','b'].map((id,i)=>({id,key:id,server:'ccf',credentialKey:'generation-'+id,encrypted:'sealed-'+id,external:0,maxConnections:3,expiresAt:now+(i+1)*86400000}));
 await storage.put('provider',{mode:'panel'});await storage.put('pool',{lines,syncedAt:now});await storage.put('user:viewer',{id:'viewer-id',username:'viewer',version:1,status:'active'});
 const call=async(path,body)=>{const response=await accountsFetch(state,env,new Request('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)}));return {status:response.status,data:await response.json()}};
 let sequence=0;
 const start=async(sid,id=1,extra={})=>{const body={sid,uid:'viewer-id',username:'viewer',version:1,xtream:true,request_id:'request-'+(++sequence),server:'ccf',mediaKey:'live|ccf|'+id+'|ts',...extra};await call('/playback-begin',body);return {...await call('/acquire',body),body}};
 const report=(r,ok,stage='signal',extra={})=>call('/provider-result',{...r.body,...r.data,ok,stage,elapsedMs:10,...extra});
 return {storage,lines,call,start,report,leases:await openLeaseStore(storage)};
}
try{
 const f=await fixture();let r=await f.start('first');assert.equal(r.data.provider_id,'b','equal health and capacity prefer the known later expiry');
 assert.ok(!JSON.stringify(await f.storage.get(assignmentKey('viewer-id'))).includes('sealed'),'persistent assignments contain no credentials or media tickets');
 await f.call('/release-session',{sid:'first'});assert.equal(await f.leases.count(),0);
 now+=86400001;await f.storage.put('pool',{lines:f.lines.map(p=>({...p,expiresAt:now+86400000})),syncedAt:now});
 await f.storage.put('provider-health',{'account|a':{at:now,ok:true,ms:1}});
 r=await f.start('after-tv-restart');assert.equal(r.data.provider_id,'b','new session next day retains the durable assignment despite another faster account');
 await f.report(r,true,'validation');
 await f.call('/release-session',{sid:r.body.sid});
 r=await f.start('second-tv');assert.equal(r.data.validatedRecently,true,'new sessions reuse a credential-bound proof without another provider request');
 await f.call('/release-session',{sid:r.body.sid});
 await f.storage.put('pool',{lines:f.lines.map(p=>({...p,expiresAt:now+86400000,external:p.id==='b'?3:0})),syncedAt:now});
 r=await f.start('overflow');assert.equal(r.data.provider_id,'a');assert.equal((await f.storage.get(assignmentKey('viewer-id'))).groups.ccf.provider_id,'b','full capacity causes a temporary fallback, not a permanent reassignment');
 await f.call('/release-session',{sid:r.body.sid});await f.storage.put('pool',{lines:f.lines.map(p=>({...p,expiresAt:now+86400000})),syncedAt:now});
 r=await f.start('back-home',99);assert.equal(r.data.provider_id,'b');await f.report(r,false);await f.call('/release-session',{sid:r.body.sid});
 r=await f.start('same-bad-channel',99);assert.equal(r.data.provider_id,'a','one bad title can use another account');await f.call('/release-session',{sid:r.body.sid});
 r=await f.start('different-channel',100);assert.equal(r.data.provider_id,'b','a channel failure never destroys the primary account assignment');
 await f.report(r,false,'validation',{confirmedInactive:true});await f.call('/release-session',{sid:r.body.sid});
 r=await f.start('account-replacement',101);assert.equal(r.data.provider_id,'a');assert.equal((await f.storage.get(assignmentKey('viewer-id'))).groups.ccf.provider_id,'a','an explicit inactive account is replaced across titles');
 await f.call('/release-session',{sid:r.body.sid});
 now+=31000;await f.storage.put('pool',{lines:f.lines.map(p=>({...p,expiresAt:p.id==='a'?now-1:now+86400000})),syncedAt:now});
 r=await f.start('expired-primary');assert.equal(r.data.provider_id,'b','an expired subscription cannot remain assigned');await f.report(r,true,'validation');
 await f.call('/release-session',{sid:r.body.sid});
 await f.storage.put('user:viewer',{id:'viewer-id',username:'viewer',version:2,status:'active'});
 assert.equal((await f.start('stale-token')).status,401,'persistent mapping is never authorization');
 r=await f.start('renewed-token',102,{version:2});assert.equal(r.status,200);assert.equal(r.data.provider_id,'b','local subscription renewal keeps the routing preference');
 await f.call('/release-session',{sid:r.body.sid});

 const capacity=await fixture();let full=await capacity.start('external-full');await capacity.report(full,true,'validation',{capacityBusy:true});await capacity.call('/release-session',{sid:'external-full'});const overflow=await capacity.start('external-overflow');assert.equal(overflow.data.provider_id,'a','fresh upstream capacity exhaustion causes a temporary fallback');assert.equal((await capacity.storage.get(assignmentKey('viewer-id'))).groups.ccf.provider_id,'b');assert.equal(recentAccountProof(await capacity.storage.get('provider-health'),capacity.lines[1],now,now),0,'a full-account check cannot create a fast-path capacity proof');

 const g=await fixture();r=await g.start('proof');await g.report(r,true,'validation');
 const oldLease=r.data.lease_id;
 await g.storage.put('pool',{lines:g.lines.map(p=>p.id==='b'?{...p,credentialKey:'rotated-generation'}:p),syncedAt:now});
 r=await g.start('proof');assert.notEqual(r.data.lease_id,oldLease);assert.equal(r.data.reused,undefined);assert.equal(r.data.validatedRecently,false,'credential rotation invalidates both the session hint and account proof');
 await g.call('/release-session',{sid:'proof'});
 r=await g.start('canary',2,{canary:true,exclude:['b']});assert.equal(r.data.provider_id,'a');assert.equal((await g.storage.get(assignmentKey('viewer-id'))).groups.ccf.provider_id,'b','background tests cannot change a real viewer assignment');
 await g.call('/release-session',{sid:'canary'});
 await g.storage.put('user:viewer',{id:'viewer-id',username:'viewer',version:1,status:'suspended'});assert.equal((await g.start('blocked')).status,401);

 const provider={id:'a',credentialKey:'key'},at=now;
 let health=recordProviderHealth({},'a','live|ccf|1|ts',true,10,'validation',at,'lease','key');
 assert.equal(recentAccountProof(health,provider,at,at+119999),at);
 assert.equal(recentAccountProof(health,provider,at,at+120001),0,'positive proof expires without requests extending it');
 assert.equal(recentAccountProof(health,{...provider,credentialKey:'other'},at,at+1),0);
 assert.equal(recentAccountProof(health,provider,at-120001,at+1),0,'stale inventory forces validation');
 health=recordProviderHealth(health,'a','live|ccf|1|ts',true,5,'signal',at+100000,'lease2','key');
 assert.equal(recentAccountProof(health,provider,at+100000,at+150000),at+100000,'only observed media can refresh the media proof');
 health=recordProviderHealth(health,'a','live|ccf|1|ts',false,5,'validation',at+150001,'lease3','key');
 health=recordProviderHealth(health,'a','live|ccf|2|ts',true,5,'signal',at+150002,'lease4','key');
 assert.equal(recentAccountProof(health,provider,at+150002,at+150003),0,'video cannot clear an independent negative account validation');
 const ranked=rankProviderCandidates([{id:'a',occupied:0,maxConnections:3,expiresAt:at+100000},{id:'b',occupied:1,maxConnections:3,expiresAt:at+999999}],{},'live|ccf|1|ts',at);
 assert.equal(ranked[0].id,'a','capacity takes precedence over the longest expiry');

 let release,started=false;const gate=new Promise(r=>{release=r}),pending=[];
 deferPlaybackReport({waitUntil:p=>pending.push(p)},async()=>{started=true;await gate});await Promise.resolve();assert.equal(started,true);assert.equal(pending.length,1);release();await Promise.all(pending);
 console.log('PASS: durable per-user assignments across restarts/renewal, health/capacity before expiry, temporary channel/overflow fallback, account replacement, credential-bound proof expiry, customer authorization and probe isolation.');
}finally{Date.now=realNow}
