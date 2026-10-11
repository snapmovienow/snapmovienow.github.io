import assert from 'node:assert/strict';
import {operationsRoute} from '../src/operations.mjs';
class Store{constructor(){this.data=new Map()}async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}async list({prefix=''}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)))}async transaction(fn){return fn(this)}}
const store=new Store(),realNow=Date.now;let clock=realNow();Date.now=()=>clock;
const ingest=async(metric,uid='synthetic-user')=>{const r=await operationsRoute(store,new Request('https://private/operations/ingest',{method:'POST',body:JSON.stringify({uid,metric})}));return{status:r.status,data:await r.json()}};
const report=async()=>await(await operationsRoute(store,new Request('https://private/operations/report',{method:'POST',body:'{}'}))).json();
const metric={report_id:'synthetic-report-0001',platform:'web',type:'live',quality:'1080',server:'ccf',attempted:true,started:true,failedStart:false,startupMs:2000,watchMs:30000,stallMs:3000,stalls:1,errors:0,decoded:600,dropped:1,bytes:1234};
try{
assert.equal((await ingest(metric)).status,200);clock+=16000;assert.equal((await ingest(metric)).data.duplicate,true);
let health=await report();assert.equal(health.groups[0].starts,1);assert.equal(health.groups[0].attempts,1);assert.equal(health.groups[0].bytes,1234,'a response lost in transit cannot double-count an accepted report');
assert.equal((await ingest({...metric,report_id:'synthetic-report-0002'})).status,200);assert.equal((await ingest({...metric,report_id:'synthetic-report-0003'})).data.limited,true);
clock+=16000;assert.equal((await ingest({...metric,report_id:'synthetic-report-0003'})).data.limited,undefined,'a limited sample can be retried later');
for(let i=0;i<5;i++){clock+=16000;assert.equal((await ingest({...metric,platform:'android',report_id:'synthetic-failed-'+i,started:false,failedStart:true,startupMs:null,watchMs:0,stallMs:0,stalls:0,errors:1,decoded:0,dropped:0,bytes:null})).status,200)}
health=await report();assert.equal(health.groups.length,2);const native=health.groups.find(g=>g.platform==='android');assert.equal(native.starts,0);assert.equal(native.failedStarts,5);assert.equal(health.alerts.some(a=>a.platform==='android'),true,'failed-start groups alert even when no video ever starts');
assert.ok(!JSON.stringify(health).includes('synthetic-user'));assert.equal((await ingest({...metric,platform:'invalid'})).status,400);assert.equal((await ingest({...metric,report_id:'private-url?password=bad'})).status,400);
const recent=async()=>await(await operationsRoute(store,new Request('https://private/operations/monitor',{method:'POST',body:'{}'}))).json();
assert.equal((await recent()).groups.find(g=>g.platform==='android').failedStarts,5);clock+=20*60000;
assert.equal((await recent()).groups.length,0,'old errors leave the operational window without erasing the 24-hour report');assert.ok((await report()).groups.length);
console.log('PASS: idempotent metric retry, throttled retry, web/native separation, startup-failure alerts and private aggregates.');
}finally{Date.now=realNow}
