import assert from 'node:assert/strict';
import {recordProviderHealth,providerCircuitState,claimProviderTrial,providerHealthSummary} from '../src/provider-health.mjs';
import {accountsFetch} from '../src/accounts.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';
const key='movie|ccf|123|mp4';let clock=100000,health={};
for(let i=0;i<2;i++){health=recordProviderHealth(health,'a',key,false,100,'validation',clock++);assert.equal(providerCircuitState(health,'a',key,clock).blocked,false,'one isolated failure is not an open circuit')}
health=recordProviderHealth(health,'a',key,false,100,'validation',clock++);assert.equal(providerCircuitState(health,'a',key,clock).blocked,true);
assert.equal(providerCircuitState(health,'a','series|ccf|9|mp4',clock).blocked,true,'account validation failure applies to every media type');
assert.equal(providerCircuitState(health,'b',key,clock).blocked,false,'other provider remains independent');
assert.equal(claimProviderTrial(health,'a',key,'early',clock),null);
clock+=30000;let claimed=claimProviderTrial(health,'a',key,'probe',clock);assert.equal(claimed.claimed,true);health=claimed.health;
assert.equal(claimProviderTrial(health,'a',key,'second',clock),null,'only one half-open probe may run');
health=recordProviderHealth(health,'a',key,true,1,'validation',clock,'stale');assert.equal(providerCircuitState(health,'a',key,clock).blocked,true,'a different request cannot complete the active probe');
health=recordProviderHealth(health,'a',key,false,100,'validation',clock,'probe');assert.equal(health['account|a'].backoff,60000,'failed recovery doubles cooldown');
clock+=60001;claimed=claimProviderTrial(health,'a',key,'recovery',clock);health=recordProviderHealth(claimed.health,'a',key,true,10,'validation',clock,'recovery');assert.equal(providerCircuitState(health,'a',key,clock).blocked,false);
for(const type of ['live','movie','series']){
 const media=type+'|ccf|404|mp4';for(let i=0;i<3;i++)health=recordProviderHealth(health,'a',media,false,1,'signal',clock++);
 assert.equal(providerCircuitState(health,'a',media,clock).blocked,true);assert.equal(providerCircuitState(health,'a',type+'|ccf|405|mp4',clock).blocked,false,'missing title cannot disable the entire account');
}
const snapshot=JSON.stringify(providerHealthSummary(health,clock));assert.ok(!snapshot.includes('404')&&!snapshot.includes('account|a'));assert.equal(providerHealthSummary(health,clock).circuits.length,3);
let backoffHealth={};let backoffTime=clock;for(let i=0;i<12;i++){
 backoffHealth=recordProviderHealth(backoffHealth,'bounded',key,false,10,'validation',backoffTime++);
 if(i>=2){assert.ok(backoffHealth['account|bounded'].backoff<=300000);backoffTime+=backoffHealth['account|bounded'].backoff;}
}assert.equal(backoffHealth['account|bounded'].backoff,300000,'backoff has a finite five-minute ceiling');
let bounded={};for(let i=0;i<600;i++)bounded=recordProviderHealth(bounded,'source-'+i+'x'.repeat(70),'series|'+'x'.repeat(80)+'|1234567890123456|mp4',false,100,'signal',clock+i);
assert.ok(Object.keys(bounded).length<=512);assert.ok(new TextEncoder().encode(JSON.stringify(bounded)).byteLength<100000,'persisted health stays within SQLite KV size budget');
// A disappeared probe must become testable again without a manual reset.
clock+=30000;claimed=claimProviderTrial(health,'a','movie|ccf|404|mp4','lost',clock);assert.equal(claimed.claimed,true);
assert.equal(claimProviderTrial(claimed.health,'a','movie|ccf|404|mp4','wait',clock),null);clock+=20001;assert.equal(claimProviderTrial(claimed.health,'a','movie|ccf|404|mp4','again',clock).claimed,true);
class Store{constructor(){this.data=new Map();this.queue=Promise.resolve()}async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))}transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p}}
const actualNow=Date.now;let time=actualNow();Date.now=()=>time;
try{
 const storage=new Store(),state={storage},env={PLAYBACK_CANARY_USERNAME:'viewer0'},leases=await openLeaseStore(storage);
 const call=async(path,b={},config=env)=>{const r=await accountsFetch(state,config,new Request('https://private/accounts'+path,{method:'POST',body:JSON.stringify(b)}));return {status:r.status,data:await r.json()}};
 await storage.put('provider',{mode:'panel'});await storage.put('pool',{syncedAt:time,lines:['a','b'].map(id=>({id,server:'ccf',encrypted:'secret-'+id,external:0,maxConnections:100}))});
 for(let i=0;i<8;i++)await storage.put('user:viewer'+i,{id:'uid'+i,username:'viewer'+i,version:1,status:'active',hash:'must-not-return',salt:'must-not-return',comments:'private'});
 let n=0;const start=async(i,{type='movie',id=100,exclude=[]}={})=>{const body={sid:'sid'+i,uid:'uid'+i,username:'viewer'+i,version:1,xtream:true,server:'ccf',mediaKey:type+'|ccf|'+id+'|mp4',request_id:'r'+(++n),exclude};await call('/playback-begin',body);return {...await call('/acquire',body),body}};
 const report=(r,ok,stage='validation')=>call('/provider-result',{...r.body,lease_id:r.data.lease_id,provider_id:r.data.provider_id,ok,stage,elapsedMs:10});
 const release=r=>call('/release',{...r.body,lease_id:r.data.lease_id,reason:'upstream_failed'});
 // Keep one independently healthy viewer on A while three other attempts fail.
 let active=await start(1,{exclude:['b']});await report(active,true);await report(active,true,'signal');
 for(let i=0;i<3;i++){const r=await start(0,{exclude:['b']});assert.equal(r.data.provider_id,'a');await report(r,false);assert.equal((await report(r,false)).data.duplicate,true);await release(r)}
 assert.equal((await call('/provider-health')).data.circuits[0].state,'open');
 active=await start(1,{id:101});assert.equal(active.data.provider_id,'a','other viewers cannot evict a healthy active source');
 const fresh=await start(2);assert.equal(fresh.data.provider_id,'b','new viewer avoids the failed account for VOD');
 assert.equal(await leases.count(),2,'circuit failures release only their own slots');
 const blocked=await start(3,{exclude:['b']});assert.equal(blocked.status,503);assert.ok(blocked.data.retry_after_ms>0);assert.equal(await leases.count(),2);
 time+=30001;const trial=await start(3,{exclude:['b']});assert.equal(trial.data.provider_id,'a');
 const concurrent=await Promise.all([start(4,{exclude:['b']}),start(5,{exclude:['b']})]);assert.ok(concurrent.every(r=>r.status===503),'atomic half-open claim prevents retry storms');
 await report(trial,true);await report(trial,true,'signal');const after=await start(4,{exclude:['b']});assert.equal(after.data.provider_id,'a','successful probe restores source without manual action');
 for(let i=0;i<3;i++){const r=await start(0,{type:'series',id:200,exclude:['b']});await report(r,true);await report(r,false,'signal');await release(r)}
 assert.equal((await start(5,{type:'series',id:200})).data.provider_id,'b','series uses the same circuit policy');
 assert.equal((await start(6,{type:'series',id:201,exclude:['b']})).data.provider_id,'a','a missing series cannot poison unrelated titles');
 const invalid=await start(7);await storage.put('user:viewer7',{id:'uid7',username:'viewer7',version:2,status:'active'});assert.equal((await call('/acquire',invalid.body)).status,401,'health never bypasses normal account version checks');
 const canary=await call('/canary-identity',{username:'viewer0'});assert.equal(canary.status,200);assert.ok(!JSON.stringify(canary.data).includes('must-not-return'));assert.deepEqual(Object.keys(canary.data).sort(),['id','permissions','username','version']);
 assert.equal((await call('/canary-identity',{username:'viewer1'})).status,403);assert.equal((await call('/canary-identity',{username:'viewer0'},{})).status,403);assert.equal((await call('/canary-identity',{username:'viewer0',admin:true})).status,403);
 await storage.put('provider-health',{
  'channel|live|ccf|7|m3u8|a':{ok:true,at:time-500},
  'channel|live|ccf|8|m3u8|b':{ok:true,at:time-100},
  'channel|live|ccf|9|m3u8|removed':{ok:true,at:time},
  'channel|live|unknown|10|m3u8|a':{ok:true,at:time},
  'channel|live|ccf|11|m3u8|a':{ok:true,at:time+1},
  'channel|live|ccf|12|m3u8|a':{ok:true,at:time-1800001},
  'channel|live|ccf|13|m3u8|a':{ok:false,at:time},
  'channel|live|ccf|https://secret/password|m3u8|a':{ok:true,at:time},
  'account|a':{ok:true,at:time}
 });
 const sample=await call('/canary-sample',{username:'viewer0',type:'live'});assert.equal(sample.status,200);assert.deepEqual(sample.data,{sample:{type:'live',id:'8',server:'ccf',ext:'m3u8'}});
 assert.ok(!JSON.stringify(sample.data).includes('secret')&&!JSON.stringify(sample.data).includes('provider'));
 assert.deepEqual((await call('/canary-sample',{username:'viewer0',type:'movie'})).data,{sample:null});
 assert.equal((await call('/canary-sample',{username:'viewer1',type:'live'})).status,403);assert.equal((await call('/canary-sample',{username:'viewer0',type:'live'},{})).status,403);assert.equal((await call('/canary-sample',{username:'viewer0',type:'invalid'})).status,400);
 await storage.put('pool',{syncedAt:time,lines:[{id:'a',server:'ccf'}]});assert.equal((await call('/canary-sample',{username:'viewer0',type:'live'})).data.sample.id,'7','removed source cannot remain a canary hint');
 time+=1800001;assert.deepEqual((await call('/canary-sample',{username:'viewer0',type:'live'})).data,{sample:null},'stale or failed signals are ignored');
 await storage.put('user:viewer0',{id:'uid0',username:'viewer0',version:1,status:'suspended'});assert.equal((await call('/canary-identity',{username:'viewer0'})).status,409);assert.equal((await call('/canary-sample',{username:'viewer0',type:'live'})).status,409);
 assert.equal((await call('/check',{username:'viewer1',uid:'uid1',version:1})).status,200,'canary identity does not weaken normal authorization');
 console.log('PASS: persisted scoped circuits, bounded backoff, one recovery probe, duplicate/late report isolation, healthy affinity, all-media routing, automatic recovery and restricted canary identity.');
}finally{Date.now=actualNow}
