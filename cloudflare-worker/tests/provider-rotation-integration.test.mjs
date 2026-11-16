import test from 'node:test';
import assert from 'node:assert/strict';
import {accountsFetch} from '../src/accounts.mjs';
import {openLeaseStore} from '../src/lease-store.mjs';
import {assignmentKey} from '../src/provider-assignment.mjs';

const HOUR=3600000,BASE=Date.UTC(2026,10,16,12);
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve();}
 async get(key){return structuredClone(this.data.get(key));}
 async put(key,value){this.data.set(key,structuredClone(value));}
 async delete(key){this.data.delete(key);}
 async list({prefix=''}){return new Map([...this.data].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key,structuredClone(value)]));}
 transaction(fn){const task=this.queue.then(async()=>{const before=structuredClone(this.data);try{return await fn(this);}catch(error){this.data=before;throw error;}});this.queue=task.catch(()=>{});return task;}
}
async function fixture(options={}){
 const clock={now:BASE},oldNow=Date.now;Date.now=()=>clock.now;
 const storage=new Store(),state={storage},env={PROVIDER_ROTATION_ENABLED:'true',PLAYBACK_CANARY_USERNAME:'probe'},lines=['a','b',...(options.third?['c']:[])].map(id=>({id,key:'physical-'+id,server:'ccf',sourceIds:['panel:'+id],credentialKey:'generation-'+id,encrypted:'synthetic-'+id,maxConnections:3,external:0,expiresAt:BASE+120*24*HOUR}));
 const homeAt=clock.now-49*HOUR;
 await storage.put('provider',{mode:'panel'});await storage.put('pool',{lines,syncedAt:clock.now,attemptedAt:clock.now,sourceBacked:true});
 for(let i=0;i<8;i++){await storage.put('user:viewer'+i,{id:'u'+i,username:'viewer'+i,version:1,status:'active',expiresAt:BASE+365*24*HOUR});await storage.put(assignmentKey('u'+i),{uid:'u'+i,groups:{ccf:{provider_id:'a',provider_key:'physical-a',selectedAt:homeAt,timeZone:'America/Chicago'}}});}
 const call=async(path,body={})=>{const response=await accountsFetch(state,env,new Request('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)}));return {status:response.status,data:await response.json()};};
 const leases=await openLeaseStore(storage);let sequence=0;
 const start=async({sid='viewer-session',user=0,id=1,type='live',ext='ts',range,...extra}={})=>{
  let body={sid,uid:'u'+user,username:'viewer'+user,version:1,xtream:true,server:'ccf',request_id:'request-'+(++sequence),mediaKey:type+'|ccf|'+id+'|'+ext,...(range?{native_media_key:type+'|ccf|'+id+'|'+ext,native_range_id:range}:{}),...extra};
  const begun=await call('/playback-begin',body);assert.equal(begun.status,200);if(begun.data.request_id)body={...body,request_id:begun.data.request_id};return {...await call('/acquire',body),body};
 };
 const report=(result,ok=true,extra={})=>call('/provider-result',{...result.body,...result.data,ok,stage:'validation',elapsedMs:1,...extra});
 const release=result=>call('/release',{...result.body,lease_id:result.data.lease_id});
 const binding=async(user=0)=>(await storage.get(assignmentKey('u'+user))).groups.ccf;
 const seedActive=async({sid='active-tv',user=0,provider='a',id='seeded-lease',mediaKey='live|ccf|100|ts',request_id='seeded-request'}={})=>{
  const lease={sid,uid:'u'+user,username:'viewer'+user,version:1,xtream:true,request_id,provider_id:provider,providerServer:'ccf',providerCredentialKey:'generation-'+provider,assignmentSelectedAt:homeAt,validatedAt:clock.now,until:clock.now+90000,mediaKey};
  await leases.put(id,lease);await storage.put('playback:'+sid,{request_id,revision:1,cancelled:{},providerMedia:{ccf:{uid:lease.uid,version:1,provider_id:provider,mediaKey,lastSeenAt:clock.now}}});return lease;
 };
 const advance=async ms=>{clock.now+=ms;await storage.put('pool',{lines,syncedAt:clock.now,attemptedAt:clock.now,sourceBacked:true});};
 return {storage,state,env,lines,leases,clock,homeAt,call,start,report,release,binding,seedActive,advance,dispose(){Date.now=oldNow;}};
}

test('an overdue account rotates only after validation, without reserving an idle assignment',async()=>{
 const f=await fixture();try{assert.equal(await f.leases.count(),0);const offered=await f.start();assert.equal(offered.status,200);assert.equal(offered.data.provider_id,'b');assert.equal((await f.binding()).provider_id,'a');assert.equal((await f.binding()).selectedAt,f.homeAt);assert.equal(await f.leases.count(),1);
  assert.equal((await f.report(offered)).status,200);const committed=await f.binding();assert.equal(committed.provider_id,'b');assert.equal(committed.rotationCount,1);assert.equal(committed.selectedAt,f.clock.now);
  await f.release(offered);assert.equal(await f.leases.count(),0,'durable routing preferences never reserve idle capacity');
 }finally{f.dispose();}
});

test('a missing or future selection clock starts a fresh minimum without changing the healthy home',async()=>{
 for(const selectedAt of [undefined,BASE+100*HOUR]){
  const f=await fixture();try{const binding=await f.binding();await f.storage.put(assignmentKey('u0'),{uid:'u0',groups:{ccf:{...binding,selectedAt}}});
   const start=await f.start();assert.equal(start.status,200);assert.equal(start.data.provider_id,'a');assert.equal((await f.binding()).selectedAt,f.clock.now);assert.equal((await f.binding()).rotationCount,undefined);
  }finally{f.dispose();}
 }
});

test('failed replacement validation cannot reset the old assignment clock',async()=>{
 const f=await fixture();try{const offered=await f.start();assert.equal(offered.data.provider_id,'b');assert.equal((await f.report(offered,false,{confirmedInactive:true})).status,200);await f.release(offered);
  assert.equal((await f.binding()).provider_id,'a');assert.equal((await f.binding()).selectedAt,f.homeAt);assert.equal(await f.leases.count(),0);
  const retry=await f.start({id:2});assert.equal(retry.status,200);assert.equal(retry.data.provider_id,'a');assert.equal((await f.binding()).selectedAt,f.homeAt);
 }finally{f.dispose();}
});

test('two devices share one pending target and positive reports commit its clock exactly once',async()=>{
 const f=await fixture();try{const offered=await Promise.all([f.start({sid:'tv-one'}),f.start({sid:'tv-two',id:2})]);for(const row of offered){assert.equal(row.status,200);assert.equal(row.data.provider_id,'b');}assert.equal((await f.binding()).provider_id,'a');assert.equal(await f.leases.count({provider_id:'b'}),2);
  assert.equal((await f.report(offered[1])).status,200);const committed=await f.binding();assert.equal(committed.provider_id,'b');assert.equal(committed.rotationCount,1);
  assert.equal((await f.report(offered[0])).status,200);assert.deepEqual(await f.binding(),committed);assert.equal((await f.storage.get('provider-rotation-stats')).completed,1);
 }finally{f.dispose();}
});

test('an older successful validation cannot overwrite a newer assignment generation',async()=>{
 const f=await fixture({third:true});try{const offered=await f.start();assert.equal(offered.status,200);assert.notEqual(offered.data.provider_id,'a');const newer={provider_id:'c',provider_key:'physical-c',selectedAt:f.clock.now+1,timeZone:'America/Chicago',rotationCount:4};await f.storage.put(assignmentKey('u0'),{uid:'u0',groups:{ccf:newer}});
  assert.equal((await f.report(offered)).status,200);assert.deepEqual(await f.binding(),newer);
 }finally{f.dispose();}
});

test('simultaneous overdue users cannot exceed the last externally available provider slot',async()=>{
 const f=await fixture();try{f.lines[0].external=3;f.lines[1].external=2;await f.advance(0);const replies=await Promise.all(Array.from({length:8},(_,user)=>f.start({user,sid:'tv-'+user})));
  assert.equal(replies.filter(row=>row.status===200).length,1);assert.equal(replies.filter(row=>row.status===409).length,7);assert.equal(await f.leases.count(),1);assert.equal(await f.leases.count({provider_id:'b'}),1);assert.equal(f.lines[1].external+await f.leases.count({provider_id:'b'}),3);
  for(let user=0;user<8;user++)assert.equal((await f.binding(user)).selectedAt,f.homeAt,'unvalidated or rejected offers do not change durable clocks');
 }finally{f.dispose();}
});

test('another active television delays rotation and three devices retain three separate slots',async()=>{
 const f=await fixture();try{await f.seedActive({sid:'first-tv',id:'first'});await f.seedActive({sid:'second-tv',id:'second',request_id:'second-request'});
  const third=await f.start({sid:'third-tv'});assert.equal(third.status,200);assert.equal(third.data.provider_id,'a');assert.equal(await f.leases.count({uid:'u0'}),3);assert.equal((await f.binding()).selectedAt,f.homeAt);
  const fourth=await f.start({sid:'fourth-tv'});assert.equal(fourth.status,409);assert.equal(fourth.data.error,'user_connection_limit');assert.equal(await f.leases.count({uid:'u0'}),3);
 }finally{f.dispose();}
});

test('heartbeat after forty-eight hours keeps the active lease and provider intact',async()=>{
 const f=await fixture();try{const lease=await f.seedActive();const before=await f.leases.get('seeded-lease');const heartbeat=await f.call('/heartbeat',{sid:lease.sid,lease_id:'seeded-lease',request_id:lease.request_id});assert.equal(heartbeat.status,200);assert.equal((await f.leases.get('seeded-lease')).provider_id,before.provider_id);assert.equal((await f.binding()).selectedAt,f.homeAt);
 }finally{f.dispose();}
});

test('a paused VOD resumes on its provider after lease expiry, including after forty-eight hours',async()=>{
 const f=await fixture();try{const old=await f.binding();await f.storage.put(assignmentKey('u0'),{uid:'u0',groups:{ccf:{...old,selectedAt:f.clock.now}}});
  const movie=await f.start({sid:'movie-tv',id:42,type:'movie',ext:'mp4',range:'range-one'});assert.equal(movie.data.provider_id,'a');await f.release(movie);assert.equal(await f.leases.count(),0);
  await f.advance(49*HOUR);const resumed=await f.start({sid:'movie-tv',id:42,type:'movie',ext:'mp4',range:'range-two'});assert.equal(resumed.status,200);assert.equal(resumed.data.provider_id,'a');assert.equal((await f.binding()).selectedAt,BASE);
  const changed=await f.start({sid:'movie-tv',id:43,type:'movie',ext:'mp4',range:'range-three'});assert.equal(changed.status,200);assert.equal(changed.data.provider_id,'b','a different title is a safe rotation boundary');
 }finally{f.dispose();}
});

test('parallel byte ranges remain on one lease and a late close cannot release the replacement',async()=>{
 const f=await fixture();try{const original=await f.binding();await f.storage.put(assignmentKey('u0'),{uid:'u0',groups:{ccf:{...original,selectedAt:f.clock.now}}});
  const first=await f.start({sid:'range-tv',id:42,type:'movie',ext:'mp4',range:'first'}),second=await f.start({sid:'range-tv',id:42,type:'movie',ext:'mp4',range:'second'});assert.equal(first.data.provider_id,'a');assert.equal(second.data.provider_id,'a');assert.equal(second.data.lease_id,first.data.lease_id);assert.equal(await f.leases.count(),1);
  const closed=await f.release(first);assert.equal(closed.data.retained,true);assert.equal(await f.leases.count(),1);assert.equal((await f.leases.get(second.data.lease_id)).nativeRanges.second,true);
 }finally{f.dispose();}
});

test('a valid ninety-second hint from the old generation cannot undo a committed rotation',async()=>{
 const f=await fixture();try{await f.storage.put('playback:old-tv',{request_id:'old-request',revision:1,cancelled:{},affinities:{ccf:{provider_id:'a',uid:'u0',version:1,request_id:'old-request',credentialKey:'generation-a',validatedAt:f.clock.now,assignmentSelectedAt:f.homeAt,until:f.clock.now+90000}},providerMedia:{ccf:{uid:'u0',version:1,provider_id:'a',mediaKey:'live|ccf|1|ts',lastSeenAt:f.clock.now}}});
  const replacement=await f.start({sid:'new-tv',id:2});assert.equal(replacement.data.provider_id,'b');await f.report(replacement);assert.equal((await f.binding()).provider_id,'b');
  const oldTv=await f.start({sid:'old-tv',id:3});assert.equal(oldTv.status,200);assert.equal(oldTv.data.provider_id,'b');assert.equal((await f.binding()).rotationCount,1);
 }finally{f.dispose();}
});

test('a fresh credential-bound account proof can commit the offered rotation immediately',async()=>{
 const f=await fixture();try{await f.storage.put('provider-health',{'account|b':{at:f.clock.now,ok:true,ms:5,credentialKey:'generation-b',validatedAt:f.clock.now}});
  const offered=await f.start();assert.equal(offered.status,200);assert.equal(offered.data.provider_id,'b');assert.equal(offered.data.validatedRecently,true);assert.equal((await f.binding()).provider_id,'b');assert.equal((await f.binding()).rotationCount,1);
  await f.report(offered);assert.equal((await f.binding()).rotationCount,1,'later reports cannot commit the same rotation twice');
 }finally{f.dispose();}
});

test('a background canary never rotates the real customer assignment',async()=>{
 const f=await fixture();try{f.env.PLAYBACK_CANARY_USERNAME='viewer0';const before=await f.binding(),probe=await f.start({sid:'canary',canary:true});assert.equal(probe.status,200);assert.deepEqual(await f.binding(),before);
  await f.report(probe);assert.deepEqual(await f.binding(),before);assert.equal((await f.storage.get('canary-'+assignmentKey('u0'))).uid,'u0');
  await f.call('/release-session',{sid:'canary'});const viewer=await f.start({sid:'real-tv',id:2});assert.equal(viewer.data.provider_id,'b');await f.report(viewer);assert.equal((await f.binding()).rotationCount,1);
 }finally{f.dispose();}
});

test('the third real device reclaims its own background probe before enforcing three connections',async()=>{
 const f=await fixture();try{f.env.PLAYBACK_CANARY_USERNAME='viewer0';await f.seedActive({sid:'first-tv',id:'first'});await f.seedActive({sid:'second-tv',id:'second',request_id:'second-request'});
  const probe=await f.start({sid:'background-probe',canary:true});assert.equal(probe.status,200);assert.equal(probe.data.provider_id,'b');assert.equal(await f.leases.count({uid:'u0'}),3);
  const third=await f.start({sid:'third-real-tv',id:2});assert.equal(third.status,200);assert.equal(third.data.provider_id,'a');assert.equal(await f.leases.count({uid:'u0'}),3);assert.equal(await f.leases.count({provider_id:'a'}),3);assert.equal(await f.leases.get(probe.data.lease_id),undefined);assert.equal(await f.storage.get('background-canary-lease'),undefined);
  await f.release(probe);assert.equal(await f.leases.count({uid:'u0'}),3,'late background cleanup cannot release any real device');
 }finally{f.dispose();}
});

test('an already watching customer defers channel-boundary rotation to a preferred midnight inside the window',async()=>{
 const f=await fixture();try{await f.advance(8*HOUR);const selectedAt=BASE-18*HOUR;await f.storage.put(assignmentKey('u0'),{uid:'u0',groups:{ccf:{provider_id:'a',provider_key:'physical-a',selectedAt,timeZone:'UTC'}}});
  await f.seedActive({sid:'watching-tv',id:'watching-lease',mediaKey:'live|ccf|1|ts'});
  const beforeMidnight=await f.start({sid:'watching-tv',id:2});assert.equal(beforeMidnight.status,200);assert.equal(beforeMidnight.data.provider_id,'a');assert.equal((await f.binding()).selectedAt,selectedAt,'the 26-hour channel change waits for the upcoming 30-hour midnight');
  await f.advance(4*HOUR);await f.leases.renew(beforeMidnight.data.lease_id,f.clock.now+90000);
  const atMidnight=await f.start({sid:'watching-tv',id:3});assert.equal(atMidnight.status,200);assert.equal(atMidnight.data.provider_id,'b');assert.equal((await f.binding()).provider_id,'a','only successful replacement validation commits the boundary');await f.report(atMidnight);assert.equal((await f.binding()).provider_id,'b');assert.equal((await f.binding()).selectedAt,f.clock.now);
 }finally{f.dispose();}
});

test('an idle restart at twenty-six hours can rotate safely before its preferred midnight',async()=>{
 const f=await fixture();try{await f.advance(8*HOUR);const selectedAt=BASE-18*HOUR;await f.storage.put(assignmentKey('u0'),{uid:'u0',groups:{ccf:{provider_id:'a',provider_key:'physical-a',selectedAt,timeZone:'UTC'}}});assert.equal(await f.leases.count(),0);
  const resumed=await f.start({sid:'idle-restart',id:2});assert.equal(resumed.status,200);assert.equal(resumed.data.provider_id,'b');assert.equal((await f.binding()).selectedAt,selectedAt);await f.report(resumed);assert.equal((await f.binding()).selectedAt,f.clock.now);
 }finally{f.dispose();}
});
