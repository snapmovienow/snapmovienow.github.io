import assert from 'node:assert/strict';
import {runTargetedComparison,targetedComparisonStatus} from '../src/targeted-playback-comparison.mjs';
class Store{
 data=new Map();queue=Promise.resolve();
 async get(key){return structuredClone(this.data.get(key))}
 async put(key,value){this.data.set(key,structuredClone(value))}
 transaction(fn){const task=this.queue.then(()=>fn(this));this.queue=task.catch(()=>{});return task}
}
const clock=Date.now,approved=Date.parse('2026-10-24T22:21:06Z');let now=approved;Date.now=()=>now;
const env={ENVIRONMENT:'production',PLAYBACK_CANARY_USERNAME:'dieguito2026'},config={username:'dieguito2026',type:'live'};
try{
 const store=new Store();let calls=0,finish,started;
 const entered=new Promise(resolve=>{started=resolve});
 const first=runTargetedComparison(store,env,config,async sample=>{calls++;assert.deepEqual(sample,{type:'live',server:'ccf',id:'217967',ext:'ts'});started();return new Promise(resolve=>{finish=resolve})});
 await entered;
 await Promise.all(Array.from({length:10},()=>runTargetedComparison(store,env,config,()=>assert.fail('concurrent duplicate'))));
 assert.equal((await targetedComparisonStatus(store)).state,'running');
 finish({verdict:'origin_not_found',username:config.username,id:'217967',url:'https://private/secret',origin:{ok:false,reason:'http_error',httpStatus:404,ms:12,bytes:0,secret:'password'},relay:{ok:false,reason:'http_error',httpStatus:404,ms:15,bytes:0}});await first;
 await runTargetedComparison(store,env,config,()=>assert.fail('completed claim reused'));
 const recreated=new Store();recreated.data=new Map(structuredClone([...store.data]));await runTargetedComparison(recreated,env,config,()=>assert.fail('redeploy duplicate'));
 assert.equal(calls,1);const result=await targetedComparisonStatus(store);assert.equal(result.state,'complete');assert.equal(result.result.verdict,'origin_not_found');assert.equal(result.attempts,1);
 assert.ok(!/dieguito|217967|https|secret|password/.test(JSON.stringify([...store.data])),'durable result must contain only allowlisted values');
 for(const [e,c,t]of [
  [{...env,ENVIRONMENT:'staging'},config,approved],[{...env,ENVIRONMENT:'development'},config,approved],[{PLAYBACK_CANARY_USERNAME:config.username},config,approved],
  [{...env,PLAYBACK_CANARY_USERNAME:'another'},config,approved],[env,{...config,username:'another'},approved],[env,{...config,username:'Dieguito2026'},approved],
  [env,{...config,type:'series'},approved],[env,{...config,type:'movie'},approved],[env,config,approved-1],[env,config,approved+86400000]
 ]){now=t;const blocked=new Store();await runTargetedComparison(blocked,e,c,()=>assert.fail('authorization guard'));assert.equal(blocked.data.size,0)}
 now=approved+86400000-1;const finalMoment=new Store();await runTargetedComparison(finalMoment,env,config,async()=>({verdict:'deferred',phase:'preparation',httpStatus:409,reason:'preempted'}));assert.equal((await targetedComparisonStatus(finalMoment)).result.verdict,'deferred');
 now=approved;await runTargetedComparison(finalMoment,env,config,()=>assert.fail('busy is terminal'));
 const broken=new Store();await runTargetedComparison(broken,env,config,async()=>{throw Error('https://private/217967/dieguito2026/password')});assert.equal((await targetedComparisonStatus(broken)).result.reason,'internal_error');assert.ok(!/private|password|217967|dieguito/.test(JSON.stringify([...broken.data])));await runTargetedComparison(broken,env,config,()=>assert.fail('failure is terminal'));
 const failedWrite=new Store(),put=failedWrite.put.bind(failedWrite);failedWrite.put=async(key,value)=>{if(value.state==='complete')throw Error('storage unavailable');await put(key,value)};
 await runTargetedComparison(failedWrite,env,config,async()=>({verdict:'inconclusive'}));assert.equal((await targetedComparisonStatus(failedWrite)).state,'running');await runTargetedComparison(failedWrite,env,config,()=>assert.fail('uncertain final write must not retry'));
 const failedClaim=new Store();failedClaim.transaction=async()=>{throw Error('storage unavailable')};await runTargetedComparison(failedClaim,env,config,()=>assert.fail('no claim, no traffic'));
 const delayed=new Store(),delayedPut=delayed.put.bind(delayed);delayed.put=async(key,value)=>{await delayedPut(key,value);now=approved+86400000};await runTargetedComparison(delayed,env,config,()=>assert.fail('expiry after claim must not start traffic'));assert.equal((await targetedComparisonStatus(delayed)).state,'running');
 console.log('PASS: targeted comparison has one durable concurrent/redeploy-safe claim, exact account/environment/type/24h guards, no retry after busy/failure/storage uncertainty, and allowlisted persistence.');
}finally{Date.now=clock}
