import assert from 'node:assert/strict';
import {targetedCase,targetedTicket,targetedSession,targetedWindow,CASE_EXPIRES_AT} from '../src/targeted-case-policy.mjs';
import {runTargetedCase,targetedCasesStatus} from '../src/targeted-case-runner.mjs';
import {targetedCasePresentation} from '../../admin-targeted-cases.js';
const key='live_225341_20261026',approved=Date.parse('2026-10-26T17:40:30Z'),expires=approved+86400000;
const env={ENVIRONMENT:'production',PLAYBACK_CANARY_USERNAME:'dieguito2026'};
class Store{data=new Map();queue=Promise.resolve();async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p}}
const realNow=Date.now;let now=approved+1;Date.now=()=>now;
try{
 const item=targetedCase(key);assert.ok(item,'new exact case is configured');assert.equal(item.type,'live');assert.equal(item.server,'ccf');assert.equal(item.id,'225341');assert.equal(item.ext,'ts');assert.equal(item.expected,502);assert.equal(item.approvedAt,approved);assert.equal(item.expiresAt,expires);assert.ok(CASE_EXPIRES_AT<approved,'historical expiry must remain unchanged');
 const store=new Store(),prefix='owner-targeted-cases-20261025-v1:';
 const old={state:'complete',attempts:1,result:{classification:'hypothesis',reason:'sample_did_not_reproduce',type:'movie',ext:'mkv'}};
 await store.put(prefix+'movie_231252',old);
 const status=await targetedCasesStatus(store,env),row=status.cases.find(x=>x.caseKey===key);assert.equal(row.state,'ready');assert.equal(row.expiresAt,expires);assert.equal(targetedCasePresentation(status).find(x=>x.key===key).ready,true);
 assert.equal(status.cases.find(x=>x.caseKey==='movie_223085').state,'expired');assert.equal(status.cases.find(x=>x.caseKey==='live_8471').state,'expired');
 for(const oldKey of ['movie_223085','movie_231252','live_8471'])assert.equal((await runTargetedCase(store,env,oldKey,()=>assert.fail('old window reopened'))).status,410);
 const ticket={targetedCase:key,canary:true,comparison:true,type:'live',id:'225341',ext:'ts'};
 assert.equal(targetedTicket(ticket,env).key,key);assert.equal(targetedSession({...ticket,username:'dieguito2026'},env).key,key);
 for(const patch of [{id:'8471'},{ext:'m3u8'},{type:'movie'},{canary:false},{comparison:false},{resource:'https://private.invalid'},{targetedCase:'live_225342_20261026'}])assert.equal(targetedTicket({...ticket,...patch},env),null);
 for(const patch of [{username:'other'},{canary:false},{comparison:false}])assert.equal(targetedSession({...ticket,username:'dieguito2026',...patch},env),null);
 for(const [e,t] of [[env,approved-1],[env,expires],[{...env,ENVIRONMENT:'staging'},approved+1],[{...env,PLAYBACK_CANARY_USERNAME:'other'},approved+1]]){now=t;assert.equal((await runTargetedCase(new Store(),e,key,()=>assert.fail('unauthorized execution'))).status,410);assert.equal(targetedWindow(e,now,key),false)}now=approved+1;
 let enter,finish,calls=0;const entered=new Promise(r=>enter=r);
 const first=runTargetedCase(store,env,key,async(exact,{deadline})=>{calls++;assert.equal(exact.id,'225341');assert.equal(deadline,now+30000);enter();return new Promise(r=>finish=r)});await entered;
 assert.equal((await runTargetedCase(store,env,key,()=>assert.fail('duplicate run'))).status,409);
 finish({classification:'insufficient_evidence',reason:'representation_unconfirmed',type:'live',ext:'ts',password:'secret-not-retained'});assert.equal((await first).status,200);assert.equal(calls,1);assert.deepEqual(await store.get(prefix+'movie_231252'),old);assert.ok(await store.get(prefix+key));assert.ok(!JSON.stringify([...store.data]).includes('secret-not-retained'));
 const recreated=new Store();recreated.data=new Map(structuredClone([...store.data]));assert.equal((await runTargetedCase(recreated,env,key,()=>assert.fail('redeploy cannot retry'))).status,409);
 now=expires;assert.equal((await targetedCasesStatus(new Store(),env)).cases.find(x=>x.caseKey===key).state,'expired');assert.equal(targetedTicket(ticket,env),null);
 console.log('PASS: exact 225341 TS one-time case, isolated 24h window, old claims/windows unchanged, stage/account/resource gates, redaction, UI allowlist and durable no-retry.');
}finally{Date.now=realNow}
