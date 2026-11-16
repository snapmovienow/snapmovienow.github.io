import test from 'node:test';
import assert from 'node:assert/strict';
import {rotationPlan,logicalMediaKey,rankRotationCandidates,ROTATION_MIN_MS,ROTATION_TARGET_MS,ROTATION_MAX_MS} from '../src/provider-rotation.mjs';

const HOUR=3600000,DAY=24*HOUR;
const current={id:'current',key:'physical-current',server:'ccf',status:'active',sourceIds:['panel-a'],maxConnections:3,external:0};
function plan(selectedAt,now,extra={}){
 return rotationPlan({binding:{provider_id:current.id,provider_key:current.key,selectedAt},primary:current,now,timeZone:'UTC',...extra});
}
function rank(candidates,{primary=current,now=Date.UTC(2030,0,31,12),lines=candidates,counts=new Map(),health={},mediaKey='live|ccf|1|ts'}={}){
 return rankRotationCandidates(candidates,{primary,now,lines,counts,health,mediaKey});
}
function provider(id,expiresAt,extra={}){return {id,key:'physical-'+id,server:'ccf',status:'active',sourceIds:['panel-b'],external:0,maxConnections:3,expiresAt,...extra};}

test('rotation has a strict 24-hour minimum, a 36-hour target and an advisory 48-hour deadline',()=>{
 assert.equal(ROTATION_MIN_MS,24*HOUR);assert.equal(ROTATION_TARGET_MS,36*HOUR);assert.equal(ROTATION_MAX_MS,48*HOUR);
 const start=Date.UTC(2026,0,1,12);
 const before=plan(start,start+24*HOUR-1);assert.equal(before.due,false);assert.equal(before.eligible,false);
 const ready=plan(start,start+24*HOUR);assert.equal(ready.due,true);assert.equal(ready.eligible,true);assert.equal(ready.status,'ready');
 assert.equal(ready.dueAt,start+24*HOUR);assert.equal(ready.targetAt,start+36*HOUR);assert.equal(ready.overdueAt,start+48*HOUR);
 assert.equal(ready.preferredAt,Date.UTC(2026,0,3),'midnight is preferred without delaying the first safe opportunity');
 assert.equal(plan(start,start+48*HOUR-1).overdue,false);assert.equal(plan(start,start+48*HOUR).overdue,true);
 const busy=plan(start,start+49*HOUR,{active:true});assert.equal(busy.due,true);assert.equal(busy.overdue,true);assert.equal(busy.eligible,false);assert.equal(busy.status,'active-playback','passing the advisory deadline cannot authorise interrupting active media');
});

test('a local midnight outside the target window does not weaken the minimum or turn into a forced reset',()=>{
 const start=Date.UTC(2026,0,1,0,30),value=plan(start,start+DAY);
 assert.equal(value.preferredAt,value.dueAt,'the first eligible midnight would be 47.5 hours later, so the target uses its safe 24-hour fallback');
 assert.equal(value.dueAt-start,DAY);assert.equal(value.targetAt-start,36*HOUR);
 assert.equal(plan(start,start+DAY-1).eligible,false);assert.equal(plan(start,start+DAY).eligible,true);
});

test('IANA midnight preference follows DST, fractional offsets and the frozen customer zone',()=>{
 const spring=Date.UTC(2026,2,7,18),springPlan=plan(spring,spring+DAY,{timeZone:'America/Chicago'});
 assert.equal(springPlan.preferredAt,Date.UTC(2026,2,9,5),'spring transition moves the eligible midnight to 35 elapsed hours');
 const shortDay=Date.UTC(2026,2,8,6),shortPlan=plan(shortDay,shortDay+DAY,{timeZone:'America/Chicago'});
 assert.equal(shortPlan.preferredAt,shortDay+DAY,'the midnight 23 hours later cannot satisfy the 24-hour minimum');
 const fall=Date.UTC(2026,10,1,5),fallPlan=plan(fall,fall+DAY,{timeZone:'America/Chicago'});
 assert.equal(fallPlan.preferredAt,Date.UTC(2026,10,2,6),'fall transition midnight is 25 elapsed hours later');
 const kathmandu=Date.UTC(2026,0,1,6,15);
 assert.equal(plan(kathmandu,kathmandu+DAY,{timeZone:'Asia/Kathmandu'}).preferredAt,Date.UTC(2026,0,2,18,15));
 const lordHowe=Date.UTC(2026,3,4,13);
 assert.equal(plan(lordHowe,lordHowe+DAY,{timeZone:'Australia/Lord_Howe'}).preferredAt,Date.UTC(2026,3,5,13,30),'a half-hour DST transition is not rounded to a whole hour');
 const frozen=rotationPlan({binding:{provider_id:current.id,provider_key:current.key,selectedAt:spring,timeZone:'America/Chicago'},primary:current,now:spring+DAY,timeZone:'Asia/Tokyo'});
 assert.equal(frozen.timeZone,'America/Chicago');assert.equal(frozen.preferredAt,springPlan.preferredAt,'another device cannot keep moving this cycle’s schedule');
 const fallback=plan(spring,spring+DAY,{timeZone:'not/a-zone'});assert.equal(fallback.timeZone,'UTC');
});

test('missing and future assignment clocks cannot trigger an immediate rotation',()=>{
 const now=Date.UTC(2026,0,3);
 for(const selectedAt of [undefined,null,0,NaN]){const value=plan(selectedAt,now);assert.equal(value.due,false);assert.equal(value.eligible,false);}
 const skew=plan(now+HOUR,now);assert.equal(skew.due,false);assert.equal(skew.eligible,false);assert.equal(skew.status,'clock-skew');
 const unassigned=rotationPlan({binding:null,primary:null,now,timeZone:'UTC'});assert.equal(unassigned.due,false);assert.equal(unassigned.eligible,false);assert.equal(unassigned.status,'unassigned');
});

test('the same movie or episode stays pinned across formats and long buffered pauses',()=>{
 const start=Date.UTC(2026,0,1),now=start+60*HOUR;
 for(const type of ['movie','series']){
  const lastMediaKey=type+'|ccf|42|mp4',mediaKey=type+'|ccf|42|mkv';
  assert.ok(logicalMediaKey(lastMediaKey));assert.equal(logicalMediaKey(lastMediaKey),logicalMediaKey(mediaKey));
  const paused=plan(start,now,{lastMediaKey,mediaKey});assert.equal(paused.due,true);assert.equal(paused.overdue,true);assert.equal(paused.eligible,false);assert.equal(paused.status,'same-title','a long pause is not evidence that a title ended');
  const next=plan(start,now,{lastMediaKey,mediaKey:type+'|ccf|43|mp4'});assert.equal(next.eligible,true);
  const elsewhere=plan(start,now,{lastMediaKey,mediaKey:type+'|another-source|42|mp4'});assert.equal(elsewhere.eligible,true);
 }
 assert.notEqual(logicalMediaKey('movie|ccf|42|mp4'),logicalMediaKey('series|ccf|42|mp4'));
 assert.equal(plan(start,now,{lastMediaKey:'live|ccf|42|ts',mediaKey:'live|ccf|42|ts'}).eligible,true,'live protection comes from actual active playback, not a permanent same-channel string');
 for(const key of [null,undefined,'','movie|ccf','series|ccf|'])assert.ok(!logicalMediaKey(key));
});

test('normal rotation uses two calendar months, with a three-month preference within the same source',()=>{
 const now=Date.UTC(2030,0,31,12),two=Date.UTC(2030,2,31,12),three=Date.UTC(2030,3,30,12);
 const enough=provider('two-months',two),short=provider('short',two-1),unknown=provider('unknown',null);
 const boundary=rank([short,enough,unknown],{now});assert.equal(boundary[0].id,enough.id);assert.ok(!boundary.some(p=>p.id===short.id||p.id===unknown.id));
 const preferred=provider('three-months',three),almost=provider('almost-three',three-1),result=rank([almost,enough,preferred],{now});
 assert.equal(result[0].id,preferred.id,'31 January plus three calendar months clamps to 30 April, rather than approximating months as days');
 const leapNow=Date.UTC(2028,1,29,12),leapEnough=provider('leap-two',Date.UTC(2028,3,29,12)),leapShort=provider('leap-short',Date.UTC(2028,3,29,12)-1);
 assert.equal(rank([leapShort,leapEnough],{now:leapNow})[0].id,leapEnough.id);
});

test('rotation can share load across known sources without counting the same physical credentials twice',()=>{
 const now=Date.UTC(2030,0,31,12),expiry=Date.UTC(2030,8,30,12),primary={...current,expiresAt:expiry};
 const same=provider('same-source',expiry,{sourceIds:['panel-a']}),other=provider('other-source',Date.UTC(2030,2,31,12)),alias=provider('alias',expiry,{key:primary.key,sourceIds:['panel-b']});
 const candidates=[primary,alias,same,other],before=structuredClone(candidates),result=rank(candidates,{now,primary});
 assert.equal(result[0].id,other.id,'a different eligible source gets an opportunity instead of always preferring the longest-lived source');
 assert.ok(!result.some(p=>p.id===primary.id||p.key===primary.key),'renamed copies of the old credentials are not a real rotation');assert.deepEqual(candidates,before);
 const sourceA=provider('a-free',expiry,{sourceIds:['panel-a']}),sourceB=provider('b-free',expiry,{sourceIds:['panel-b']}),busyA=provider('a-busy',expiry,{sourceIds:['panel-a']}),idleB=provider('b-idle',expiry,{sourceIds:['panel-b']});
 const unrelated={...primary,sourceIds:['panel-old']};
 const balanced=rank([sourceA,sourceB],{now,primary:unrelated,lines:[sourceA,sourceB,busyA,idleB],counts:new Map([['a-busy',3]])});
 assert.equal(balanced[0].id,sourceB.id,'source utilisation includes other physical accounts, not just the two free candidates');
});

test('short or unknown expiry is an emergency fallback, not a reason to discard a healthy long-lived assignment',()=>{
 const now=Date.UTC(2030,0,31,12),primary={...current,expiresAt:Date.UTC(2030,8,30,12)},short=provider('short',now+DAY),unknown=provider('unknown',null);
 const keep=rank([primary,short,unknown],{now,primary});assert.equal(keep[0].id,primary.id,'without an eligible replacement the existing valid assignment remains available');
 const emergency=rank([short,unknown],{now,primary:{...primary,expiresAt:now-1}});assert.ok(emergency.length>0);assert.ok(emergency.every(p=>[short.id,unknown.id].includes(p.id)),'service can recover through a shorter-lived available account when no normal replacement exists');
});

test('a proven two-month account outranks an unproven three-month account at the same source load',()=>{
 const now=Date.UTC(2030,0,31,12),proven=provider('proven-two-months',Date.UTC(2030,2,31,12)),unproven=provider('unknown-three-months',Date.UTC(2030,4,31,12));
 const health={'account|proven-two-months':{at:now,ok:true,ms:10}},result=rank([unproven,proven],{now,health});
 assert.equal(result[0].id,proven.id,'known account health takes precedence over a later expiry once the normal two-month minimum is met');
});

test('unavailable account capacity cannot make its source look artificially empty',()=>{
 const now=Date.UTC(2030,0,31,12),expiry=Date.UTC(2030,8,30,12),primary={...current,sourceIds:['panel-old'],expiresAt:expiry};
 const a=provider('a-free',expiry,{sourceIds:['panel-a'],external:1}),b=provider('b-free',expiry,{sourceIds:['panel-b']}),dead=provider('a-unavailable',expiry,{sourceIds:['panel-a'],maxConnections:300}),busy=provider('b-busy',expiry,{sourceIds:['panel-b'],external:1});
 const lines=[a,b,dead,busy];
 for(const unavailable of [{at:now,ok:false,openUntil:now+30000},{at:now,ok:true,busyUntil:now+5000}]){
  const health={'account|a-unavailable':unavailable},result=rank([a,b],{now,primary,lines,health});
  assert.equal(result[0].id,b.id,'dead or busy accounts contribute no spare capacity to panel-a; healthy occupied capacity at panel-b remains counted');
 }
});
