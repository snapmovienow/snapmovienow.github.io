import test from 'node:test';
import assert from 'node:assert/strict';
import {rankProviderCandidates,providerCandidateHealth} from '../src/provider-health.mjs';
import {rankRotationCandidates} from '../src/provider-rotation.mjs';

const now=Date.UTC(2026,10,16,20),mediaKey='live|ccf|173|ts';
const provider=(id,source,extra={})=>({id,key:'physical-'+id,server:'ccf',sourceIds:[source],external:0,occupied:0,maxConnections:3,expiresAt:now+120*86400000,...extra});
const signal=(row,ok)=>({['channel|'+mediaKey+'|'+row.id]:{at:now-1000,ok,failures:ok?0:1,ms:ok?100:2000}});
const ranked=(candidates,options={})=>rankRotationCandidates(candidates,{lines:candidates,health:{},mediaKey,now,...options});

test('rotation cannot replace a recent channel success with a lower-load recent failure',()=>{
 for(const separatePanels of [true,false]){
  const good=provider('working','working-panel',{occupied:1}),bad=provider('failed',separatePanels?'empty-panel':'working-panel');
  const candidates=[bad,good],health={...signal(good,true),...signal(bad,false)},before=JSON.stringify({candidates,health});
  assert.equal(providerCandidateHealth(bad,health,mediaKey,now).cooling,true);
  assert.equal(rankProviderCandidates(candidates,health,mediaKey,now)[0].id,good.id);
  assert.equal(ranked(candidates,{health})[0].id,good.id,'panel balancing must preserve the existing health priority');
  assert.equal(JSON.stringify({candidates,health}),before,'ranking never changes inventory or advisory evidence');
 }
});

test('a working same-panel replacement beats a different panel with a recent failure',()=>{
 const primary=provider('home','home-panel'),good=provider('working','home-panel',{occupied:1}),bad=provider('failed','different-empty-panel');
 const health={...signal(good,true),...signal(bad,false)};
 assert.equal(ranked([primary,good,bad],{primary,health})[0].id,good.id);
});

test('a recent successful account outranks an unknown account before panel and expiry preferences',()=>{
 const primary=provider('home','home-panel'),good=provider('proven','home-panel',{occupied:1,expiresAt:now+70*86400000}),unknown=provider('unknown','different-empty-panel');
 assert.equal(ranked([primary,good,unknown],{primary,health:signal(good,true)})[0].id,good.id);
});

test('a healthy home remains available when every replacement has just failed',()=>{
 for(const remainingDays of [30,120]){
  const primary=provider('home','home-panel',{expiresAt:now+remainingDays*86400000}),bad=provider('failed','different-panel');
  const health={...signal(primary,true),...signal(bad,false)};
  assert.equal(ranked([primary,bad],{primary,health})[0].id,primary.id,'a timed rotation must yield to the working home');
 }
});

test('unknown alternatives can still be tried instead of pinning a proven home forever',()=>{
 const primary=provider('home','home-panel'),unknown=provider('unknown','different-panel');
 assert.equal(ranked([primary,unknown],{primary,health:signal(primary,true)})[0].id,unknown.id);
});

test('a working short-lived account is an emergency fallback when all mature accounts are cooling',()=>{
 const good=provider('working-short','short-panel',{expiresAt:now+30*86400000}),bad=provider('failed-mature','mature-panel');
 assert.equal(ranked([bad,good],{health:{...signal(good,true),...signal(bad,false)}})[0].id,good.id);
});

test('healthy full, blocked and externally busy accounts cannot override available capacity',()=>{
 const unavailable=provider('working','working-panel'),unknown=provider('available','available-panel');
 const success=signal(unavailable,true);
 assert.equal(ranked([{...unavailable,occupied:3},unknown],{health:success})[0].id,unknown.id);
 assert.equal(ranked([unavailable,unknown],{health:{...success,['account|'+unavailable.id]:{at:now,ok:true,busyUntil:now+5000}}})[0].id,unknown.id);
 assert.equal(ranked([unavailable,unknown],{health:{...success,['account|'+unavailable.id]:{at:now,ok:false,failures:3,openUntil:now+30000}}})[0].id,unknown.id);
 assert.deepEqual(ranked([{...unavailable,occupied:3},{...unknown,occupied:3}],{health:success}),[]);
});

test('a soft cooldown does not permanently deny all inventory when no ready option exists',()=>{
 const first=provider('first','panel-first'),second=provider('second','panel-second');
 const health={...signal(first,false),...signal(second,false)};
 assert.ok(ranked([first,second],{health}).length>0);
});
