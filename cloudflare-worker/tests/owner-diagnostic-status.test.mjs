import test from 'node:test';
import assert from 'node:assert/strict';
import {OperationsMonitor} from '../src/monitor.mjs';
import {cleanOwnerDiagnostic,retainOwnerDiagnostic,ownerDiagnosticStatus} from '../src/owner-diagnostic-status.mjs';

const now=1800000000000,interval=300000;
test('diagnostic expiry is based on valid evidence and withstands missed or replayed timers',()=>{
 const successful={state:'ok',attemptedAt:now,lastValidAt:now};
 const failed={state:'failed',attemptedAt:now+interval,lastValidAt:null};
 let latest=retainOwnerDiagnostic(null,cleanOwnerDiagnostic(successful,now),now);
 latest=retainOwnerDiagnostic(latest,cleanOwnerDiagnostic(failed,now+interval),now+interval);
 assert.equal(latest.lastValidAt,now);
 assert.equal(ownerDiagnosticStatus(latest,now+3*interval-1).stale,false);
 assert.equal(ownerDiagnosticStatus(latest,now+3*interval).stale,true);
 assert.equal(retainOwnerDiagnostic(latest,successful,now+3*interval),latest);
 assert.equal(retainOwnerDiagnostic(latest,{...failed,state:'running'},now+3*interval),latest);
 assert.equal(cleanOwnerDiagnostic({state:'ok',attemptedAt:now,lastValidAt:null},now),null);
 assert.equal(cleanOwnerDiagnostic({state:'never',attemptedAt:null,lastValidAt:now},now),null);
 assert.equal(cleanOwnerDiagnostic({state:'private-injected',attemptedAt:now,lastValidAt:now},now),null);
 const untested=retainOwnerDiagnostic(null,{state:'never',attemptedAt:null,lastValidAt:null},now);
 assert.equal(ownerDiagnosticStatus(untested,now+3*interval).stale,true);
});

test('the private monitor opens one expiry incident and recovers when a new reading arrives',async()=>{
 const time=Date.now;let current=now,saved;
 Date.now=()=>current;
 const store={get:async()=>structuredClone(saved),put:async(_,state)=>{saved=structuredClone(state)},transaction:async work=>work(store)};
 const monitor=new OperationsMonitor({storage:store},{});
 monitor.collect=async()=>({providers:{configuredIds:[],providers:[]},playback:{groups:[],timings:[]},backups:{lastAutomaticAt:current}});
 const call=async(path,body={})=>monitor.fetch(new Request('https://private'+path,{method:'POST',body:JSON.stringify(body)}));
 try{
  await call('/tick');
  assert.equal((await (await call('/status')).json()).ownerDiagnostic,null);
  assert.equal((await call('/owner-diagnostic',{state:'ok',attemptedAt:current,lastValidAt:current,scope:'private-fixture'})).status,200);
  current+=2*interval;await call('/tick');
  assert.equal(saved.history.length,0);
  current+=interval;await call('/tick');
  assert.equal(saved.history.length,1);assert.equal(saved.history[0].changes[0].kind,'opened');
  assert.match(saved.history[0].changes[0].title,/Diagnóstico privado/);
  current+=interval;await call('/tick');assert.equal(saved.history.length,1);
  await call('/owner-diagnostic',{state:'ok',attemptedAt:current,lastValidAt:current});
  current+=interval;await call('/tick');assert.equal(saved.history[0].changes[0].kind,'resolved');
  const result=await (await call('/status')).json();
  assert.equal(result.ownerDiagnostic.stale,false);assert.ok(!JSON.stringify(result).includes('private-fixture'));
 }finally{Date.now=time}
});
