import test from 'node:test';
import assert from 'node:assert/strict';
import {createLocalTvAudit,LOCAL_AUDIT_KEY,localAuditEnabled} from '../src/local-tv-audit.mjs';
import {ALL_TV_CHANNELS} from '../src/official-live.mjs';
const NOW=Date.parse('2026-11-04T22:00:00Z'),env={ENVIRONMENT:'production',PLAYBACK_CANARY_USERNAME:'owner-fixture'};
const defs=ALL_TV_CHANNELS.filter(channel=>channel.id.startsWith('local-'));
const row=channel=>({id:channel.id,name:channel.name,page:channel.page,type:'movie',mode:channel.adapter==='public-hls'?'direct':'gnula',visible:true,revision:7,playbackRevision:3});
class Store{
 data=new Map();alarms=[];queue=Promise.resolve();
 async get(key){return structuredClone(this.data.get(key));}async put(key,value){this.data.set(key,structuredClone(value));}
 transaction(fn){const value=this.queue.then(()=>fn(this));this.queue=value.catch(()=>{});return value;}
 async setAlarm(at){this.alarms.push(at);}
}
const drain=async audit=>{for(let at=0;at<50;at++){const status=await audit.status();if(status.state!=='running')return status;await audit.step();}throw Error('unbounded audit');};
test('actual saved local snapshot produces 21 unique checks and shared NY/NJ folder entries',async()=>{
 assert.equal(defs.length,21);const rows=defs.map(row),storage=new Store(),events=[];let checks=0;
 const audit=createLocalTvAudit(storage,env,{inventory:async()=>({items:[...rows,{id:'public-other',page:'https://never-fetch.invalid/media.m3u8'}]}),probe:async(current,{signal})=>{assert.equal(signal.aborted,false);assert.ok(rows.some(row=>row.id===current.id));checks++;return{ok:true,check:'signed_playlist_and_segment'};}},{now:()=>NOW,onResult:result=>events.push(result)});
 await audit.start();const status=await drain(audit);assert.equal(status.state,'completed');assert.equal(status.total,21);assert.equal(status.online,21);assert.equal(checks,21);
 assert.deepEqual(status.categories.map(folder=>[folder.key,folder.total]),[['kansas',8],['new-york',4],['new-jersey',3],['california',7]]);
 assert.equal(status.categories.reduce((sum,folder)=>sum+folder.total,0),22);assert.equal(events.length,1);
 assert.equal(JSON.stringify(status).includes('https://'),false);assert.equal(JSON.stringify(status).includes(env.PLAYBACK_CANARY_USERNAME),false);assert.equal(JSON.stringify(events).includes('page'),false);
 await audit.start();await audit.step();assert.equal(checks,21,'completed jobs do not replay');assert.ok(storage.alarms.every(at=>at>=NOW+1000));
});
test('missing saved channels are never seeded, unknown and changed-source locals never fetched',async()=>{
 const saved=row(defs[0]),changed={...row(defs[1]),page:'https://foreign.invalid/private-token'},unknown={id:'local-unrecognized',name:'https://secret.invalid/password',page:'https://secret.invalid/password'};let calls=0;
 const audit=createLocalTvAudit(new Store(),env,{inventory:async()=>({items:[saved,changed,unknown]}),probe:async current=>{calls++;assert.equal(current.id,saved.id);return{ok:true};}},{now:()=>NOW,onResult:()=>{}});
 await audit.start();const result=await drain(audit);assert.equal(result.total,3);assert.equal(result.online,1);assert.equal(result.needsReview,2);assert.equal(calls,1);assert.equal(JSON.stringify(result).includes('secret.invalid'),false);
});
test('concurrent starts and alarms claim each source only once',async()=>{
 const storage=new Store();let releaseProbe,calls=0;const gate=new Promise(resolve=>releaseProbe=resolve),saved=row(defs[0]);
 const audit=createLocalTvAudit(storage,env,{inventory:async()=>({items:[saved]}),probe:async()=>{calls++;await gate;return{ok:true};}},{now:()=>NOW,onResult:()=>{}});
 await Promise.all([audit.start(),audit.start()]);const first=audit.step();await new Promise(resolve=>setImmediate(resolve));const second=await audit.step();assert.equal(calls,1);assert.equal(second.channels[0].status,'checking');releaseProbe();await first;assert.equal((await audit.status()).online,1);
});
test('catalog edit during verification wins and cannot be labelled online from stale bytes',async()=>{
 const saved=row(defs[0]);let rows=[saved];const audit=createLocalTvAudit(new Store(),env,{inventory:async()=>({items:rows}),probe:async()=>{rows=[{...saved,revision:8,visible:false}];return{ok:true};}},{now:()=>NOW,onResult:()=>{}});
 await audit.start();await audit.step();const result=await audit.status();assert.equal(result.online,0);assert.equal(result.needsReview,1);assert.equal(result.channels[0].reason,'catalog_changed');
});
test('busy and transient failures retry only once; arbitrary errors remain redacted',async()=>{
 for(const reason of ['test_account_busy','transient','verification_timeout','private-password https://secret.invalid']){
  const storage=new Store();let calls=0;const audit=createLocalTvAudit(storage,env,{inventory:async()=>({items:[row(defs[0])]}),probe:async()=>{calls++;return{ok:false,reason,httpStatus:503,raw:'secret'};}},{now:()=>NOW,onResult:()=>{}});
  await audit.start();const result=await drain(audit);assert.equal(result.state,'completed');assert.equal(result.offline,1);assert.equal(calls,reason.startsWith('private')?1:2);assert.equal(result.channels[0].reason,reason.startsWith('private')?'verification_failed':reason);assert.equal(JSON.stringify(result).includes('secret'),false);
 }
});
test('a deadline bounds a probe which ignores its signal and interrupted claims stay finite',async()=>{
 let time=NOW,calls=0;const storage=new Store(),audit=createLocalTvAudit(storage,env,{inventory:async()=>({items:[row(defs[0])]}),probe:async()=>{calls++;return new Promise(()=>{});}},{now:()=>time,probeTimeoutMs:5,onResult:()=>{}});
 await audit.start();await audit.step();await audit.step();assert.equal(calls,2);assert.equal((await audit.status()).offline,1);
 const interrupted=new Store();await interrupted.put(LOCAL_AUDIT_KEY,{state:'running',startedAt:NOW,claimUntil:NOW-1,channels:[{id:defs[0].id,name:defs[0].name,categories:['kansas'],expected:row(defs[0]),status:'checking',attempts:2}]});
 const resumed=createLocalTvAudit(interrupted,env,{inventory:()=>{throw Error('must not read');},probe:()=>{throw Error('must not probe');}},{now:()=>NOW,onResult:()=>{}});const result=await resumed.step();assert.equal(result.state,'completed');assert.equal(result.offline,1);
});
test('staging, absent owner account and expired authorization never start or probe',async()=>{
 assert.equal(localAuditEnabled(env,NOW),true);
 for(const [config,time] of [[{...env,ENVIRONMENT:'staging'},NOW],[{...env,PLAYBACK_CANARY_USERNAME:''},NOW],[env,Date.parse('2026-11-06T00:00:00Z')]]){
  const storage=new Store(),audit=createLocalTvAudit(storage,config,{inventory:()=>{throw Error('disabled');},probe:()=>{throw Error('disabled');}},{now:()=>time});
  await audit.start();await audit.step();assert.equal((await audit.status()).state,'pending');assert.equal(storage.alarms.length,0);
 }
 const storage=new Store();let time=NOW;const audit=createLocalTvAudit(storage,env,{inventory:async()=>({items:[row(defs[0])]}),probe:()=>{throw Error('expired');}},{now:()=>time});await audit.start();time=Date.parse('2026-11-06T00:00:00Z');await audit.step();assert.equal((await audit.status()).state,'expired');assert.equal(storage.alarms.length,1);
});
