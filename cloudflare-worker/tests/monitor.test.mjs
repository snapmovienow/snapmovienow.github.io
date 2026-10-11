import assert from 'node:assert/strict';
import {OperationsMonitor,applyObservations,observations,MONITOR_CRON} from '../src/monitor.mjs';
import {probeProviders} from '../src/provider-monitor.mjs';
import worker from '../src/index.js';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve()}
 async get(key){return structuredClone(this.data.get(key))}async put(key,value){this.data.set(key,structuredClone(value))}
 transaction(fn){const work=this.queue.then(()=>fn(this));this.queue=work.catch(()=>{});return work}
}
const realNow=Date.now,realFetch=globalThis.fetch;let now=1800000000000;Date.now=()=>now;
const store=new Store(),goodBackup=()=>({status:'success',automaticStatus:'success',lastAutomaticAt:now,recovery:{status:'success'}});
let providers={providers:[{id:'synthetic-source',label:'Proveedor 1',ok:true}]},playback={groups:[]},backups=goodBackup(),reads=0;
const env={ENVIRONMENT:'production',TICKET_SECRET:'synthetic-monitor-secret-never-deployed',PLAYBACK_SESSIONS:{idFromName:name=>name,get:name=>({fetch:async()=>{reads++;return Response.json(name==='__smn_provider_refresh_v1'?providers:name==='__smn_operations_v1'?playback:backups)}})}};
const monitor=new OperationsMonitor({storage:store},env),call=async(path,body={})=>{const response=await monitor.fetch(new Request('https://private'+path,{method:'POST',body:JSON.stringify(body)}));return {status:response.status,data:await response.json()}};
let mailCalls=[];globalThis.fetch=async(url,options)=>{mailCalls.push({url,options});return Response.json({id:'synthetic-email'})};
const next=async()=>{now+=300000;return call('/tick')},open=async()=> (await call('/status')).data.incidents.filter(i=>i.status==='open');
try{
 await call('/tick');assert.equal((await open()).length,0);assert.equal(reads,3);
 providers.providers[0].ok=false;await next();assert.equal((await open()).length,0,'one provider timeout cannot send an alarm');
 const count=reads;await call('/tick');assert.equal(reads,count,'duplicate cron cannot re-probe or amplify a failure');
 await next();assert.equal((await open()).length,1);assert.equal((await call('/status')).data.history.length,1);
 await next();assert.equal((await call('/status')).data.history.length,1,'persistent outage creates one notification');assert.equal(mailCalls.length,0,'default channel never sends to an inferred recipient');
 providers.providers[0].ok=true;await next();assert.equal((await open()).length,1);await next();assert.equal((await open()).length,0);
 assert.equal((await call('/status')).data.history[0].changes[0].kind,'resolved');
 const group={server:'ccf',type:'series',quality:'1080',platform:'android',failedStarts:5,starts:0,reports:5,errors:5,stallPercent:0,startupP95UpperMs:null};
 playback.groups=[group];await next();assert.equal((await open())[0].kind,'playback');playback.groups=[];await next();assert.equal((await open())[0].waitingForSamples,true,'idle clients are not evidence of recovery');
 playback.groups=[{...group,failedStarts:0,starts:5,errors:0,startupP95UpperMs:2000}];await next();assert.equal((await open()).length,0);
 backups={...goodBackup(),automaticStatus:'failed'};await next();assert.ok((await open()).some(i=>i.key==='backup:daily'),'manual success does not hide an automatic failure');
 backups=goodBackup();await next();assert.equal((await open()).length,0);
 const fresh=observations({providers:{providers:[]},playback:{groups:[]},backups:{automaticStatus:'unknown'}},now,now);assert.equal(fresh.find(i=>i.key==='backup:daily').bad,false,'give the first scheduled backup a real opportunity to run');
 const stale=observations({providers:{providers:[]},playback:{groups:[]},backups:{automaticStatus:'unknown'}},now+37*3600000,now);assert.equal(stale.find(i=>i.key==='backup:daily').bad,true);
 assert.equal((await call('/settings',{enabled:true,channel:'email',to:'invalid',from:'owner@example.com'})).status,400);
 assert.equal((await call('/settings',{enabled:true,channel:'email',to:'owner@example.com',from:'alerts@example.com'})).data.error,'alert_key_required');
 const apiKey='re_synthetic_key_only_for_tests';
 let result=await call('/settings',{enabled:true,channel:'email',to:'owner@example.com',from:'alerts@example.com',apiKey});assert.equal(result.status,200);assert.ok(result.data.settings.keyConfigured);
 assert.ok(!JSON.stringify([...store.data.values()]).includes(apiKey),'API key is encrypted at rest');assert.ok(!JSON.stringify(result).includes(apiKey));
 let failOnce=true;globalThis.fetch=async(url,options)=>{mailCalls.push({url,options});if(failOnce){failOnce=false;throw Error('private-credential-error')}return Response.json({id:'synthetic-email'})};
 backups={...goodBackup(),automaticStatus:'failed'};await next();assert.equal(mailCalls.length,1);result=await call('/status');assert.equal(result.data.pendingEmails,1);assert.equal(result.data.delivery.status,'email_unavailable');
 assert.ok(!JSON.stringify(result).includes('private-credential'));
 await next();assert.equal(mailCalls.length,2);assert.equal(mailCalls[0].options.headers['Idempotency-Key'],mailCalls[1].options.headers['Idempotency-Key']);assert.equal(mailCalls[0].options.body,mailCalls[1].options.body,'lost acknowledgement retries the same immutable email');
 assert.equal((await call('/status')).data.pendingEmails,0);await next();assert.equal(mailCalls.length,2,'a continuing backup failure does not spam the owner');
 backups=goodBackup();await next();assert.equal(mailCalls.length,3);assert.match(JSON.parse(mailCalls[2].options.body).text,/RECUPERADO/);
 assert.equal((await call('/test')).data.delivery.status,'accepted');assert.equal((await call('/test')).status,429);
 globalThis.fetch=async(url,options)=>{mailCalls.push({url,options});return Response.json({error:'synthetic-private-error'},{status:429,headers:{'Retry-After':'1200'}})};
 backups={...goodBackup(),automaticStatus:'failed'};await next();assert.equal((await call('/status')).data.delivery.status,'email_rate_limited');const mails=mailCalls.length;await next();assert.equal(mailCalls.length,mails,'honour the service retry deadline');
 result=await call('/settings',{enabled:true,channel:'email',to:'another-owner@example.com',from:'alerts@example.com'});assert.equal(result.data.pendingEmails,0,'recipient edits cannot reroute an old pending email');assert.equal(result.data.history[0].delivery,'cancelled');
 assert.equal((await call('/settings',{enabled:false,channel:'panel'})).status,200);const before=reads;await next();assert.equal(reads,before,'paused monitoring does not probe the provider');
 const stage=new OperationsMonitor({storage:new Store()},{...env,ENVIRONMENT:'staging'});assert.equal((await stage.tick()).skipped,true);assert.equal(reads,before);
 let active=0,max=0;
 const probe=await probeProviders(Array.from({length:7},(_,i)=>({source:'source-'+i,encrypted:'private-provider-password'})),{decrypt:async()=>({kind:'provider',username:'private-user',password:'private-password'}),validateAccount:async()=>{active++;max=Math.max(max,active);await Promise.resolve();active--;throw Error('private-provider-secret')},identifier:async source=>source,readPanel:async()=>{throw Error('must not be used')}});
 assert.equal(probe.providers.length,7);assert.ok(max<=3);assert.ok(probe.providers.every(p=>!p.ok));assert.ok(!JSON.stringify(probe).includes('private'));
 const paths=[],pending=[];const scheduledEnv={ENVIRONMENT:'production',OPERATION_ALERTS:{idFromName:x=>x,get:()=>({fetch:async url=>{paths.push(new URL(url).pathname);return Response.json({ok:true})}})},PLAYBACK_SESSIONS:{idFromName:x=>x,get:()=>({fetch:async url=>{paths.push(new URL(url).pathname);return Response.json({ok:true})}})}};
 worker.scheduled({cron:MONITOR_CRON},scheduledEnv,{waitUntil:p=>pending.push(p)});await Promise.all(pending);assert.deepEqual(paths,['/tick'],'five-minute monitor cannot create 288 daily backups');
 paths.length=0;pending.length=0;worker.scheduled({cron:'17 5 * * *'},scheduledEnv,{waitUntil:p=>pending.push(p)});await Promise.all(pending);assert.deepEqual(paths,['/accounts/backup-automatic','/tick']);
 paths.length=0;worker.scheduled({cron:MONITOR_CRON},{...scheduledEnv,ENVIRONMENT:'staging'},{waitUntil:p=>pending.push(p)});assert.equal(paths.length,0);
 const unauthorised=await worker.fetch(new Request('https://example.test/admin',{method:'POST',body:JSON.stringify({action:'alerts-status'})}),{TICKET_SECRET:env.TICKET_SECRET});assert.equal(unauthorised.status,401);
 console.log('PASS: persistent operational incidents, confirmed recovery, idle-sample uncertainty, encrypted delivery key, idempotent retry, recipient edits, rate limits, staging isolation, metadata probes and separate cron dispatch.');
}finally{Date.now=realNow;globalThis.fetch=realFetch}
