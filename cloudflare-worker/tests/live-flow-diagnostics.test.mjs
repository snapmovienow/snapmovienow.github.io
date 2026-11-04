import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectLiveFlowDiagnostic,validateLiveFlowDiagnostic,createLiveFlowMonitor} from '../src/live-flow-diagnostics.mjs';

const FROM=1793815200000,CASE='0e586236-3472-4b43-a838-14e95dd39841',FLOW='c6f76c64-1391-48d7-aaf2-1729894256fd';
const env={LIVE_FLOW_DIAGNOSTIC_USERNAME:'fixtureviewer',LIVE_FLOW_DIAGNOSTIC_CASE:CASE,LIVE_FLOW_DIAGNOSTIC_FROM:String(FROM),LIVE_FLOW_DIAGNOSTIC_UNTIL:String(FROM+86400000)};
const input={username:'fixtureviewer',type:'live',ext:'ts',method:'GET',requestId:FLOW,publicId:'1234'};
const select=(changes={},time=FROM)=>selectLiveFlowDiagnostic({...env,...changes},input,time);
function fixture(meta=select(),extra={}){let time=FROM;const records=[];return {records,setTime:n=>{time=n},monitor:createLiveFlowMonitor(meta,{now:()=>time,logger:row=>records.push(row),...extra})}}

test('diagnosis is disabled unless an exact temporary target and GET live TS match',()=>{
 assert.equal(selectLiveFlowDiagnostic({},input,FROM),null);
 for(const change of [{username:'other'},{username:'Fixtureviewer'},{username:'fixtureviewer '},{type:'movie'},{ext:'m3u8'},{method:'HEAD'},{method:'get'},{requestId:'not-a-uuid'},{attempt:0},{attempt:4},{attempt:'1'},{publicId:'https://private/token'}])assert.equal(selectLiveFlowDiagnostic(env,{...input,...change},FROM),null);
 for(const change of [{LIVE_FLOW_DIAGNOSTIC_USERNAME:'FIXTUREVIEWER'},{LIVE_FLOW_DIAGNOSTIC_CASE:'raw-token'},{LIVE_FLOW_DIAGNOSTIC_FROM:'1.1'},{LIVE_FLOW_DIAGNOSTIC_FROM:' '+FROM},{LIVE_FLOW_DIAGNOSTIC_UNTIL:String(FROM)},{LIVE_FLOW_DIAGNOSTIC_UNTIL:String(FROM+86400001)}])assert.equal(select(change),null);
 assert.equal(select({},FROM-1),null);assert.equal(select({},FROM+86400000),null);assert.equal(select({},NaN),null);
 assert.deepEqual(select(),{case_id:CASE,flow_id:FLOW,from:FROM,until:FROM+86400000,attempt:1,public_id:'1234'});
});

test('decrypted metadata must match the current case and dates without identity or extras',()=>{
 const meta=select();assert.deepEqual(validateLiveFlowDiagnostic(env,meta,FROM),meta);
 for(const change of [{case_id:FLOW},{flow_id:'invalid'},{from:FROM+1},{until:FROM+86400000-1},{username:'fixtureviewer'},{url:'https://private'},{public_id:'token=secret'},{attempt:4},{from:String(FROM)}])assert.equal(validateLiveFlowDiagnostic(env,{...meta,...change},FROM),null);
 assert.equal(validateLiveFlowDiagnostic({},meta,FROM),null);assert.equal(validateLiveFlowDiagnostic(env,meta,FROM+86400000),null);
 const throwing={get case_id(){throw Error('private-string')}};assert.doesNotThrow(()=>validateLiveFlowDiagnostic(env,throwing,FROM));assert.equal(validateLiveFlowDiagnostic(env,throwing,FROM),null);
});

test('each attempt has its own validated flow and bounded attempt number',()=>{
 const other='0ec920a3-6604-49b4-9f78-1a23553ff387';
 const second=selectLiveFlowDiagnostic(env,{...input,requestId:other,attempt:2},FROM);
 assert.equal(second.flow_id,other);assert.equal(second.attempt,2);assert.notEqual(second.flow_id,select().flow_id);
 assert.equal(validateLiveFlowDiagnostic(env,second,FROM).attempt,2);
});

test('records expose only aggregate relay counters, explicit scope and safe origin reason',()=>{
 const f=fixture(),m=f.monitor;assert.equal(f.records.length,1);assert.equal(f.records[0].event,'live_flow_start');assert.equal(f.records[0].origin_observed,false);assert.equal(f.records[0].origin_reason,null);
 m.originBytes(300);m.originBytes(200);m.originReadWait(1.2);m.originReadWait(14.6);m.originWriteWait(20);m.originWriteWait(3);m.relayChunk(200);m.relayChunk(300);m.relayReadWait(5);m.relayReadWait(3);m.consumerPause(700);m.consumerPause(2);m.originEnd('origin_complete');
 assert.equal(f.records.length,1,'byte counters and origin end never generate packet logs or end the relay');
 f.setTime(FROM+65000);assert.equal(m.checkpoint(),true);assert.equal(m.finish('relay_complete',{status:200}),true);
 const row=f.records.at(-1);assert.equal(row.origin_observed,true);assert.equal(row.origin_reason,'origin_complete');assert.equal(row.reason,'relay_complete');assert.equal(row.scope,'server_relay_not_client');assert.equal(row.origin_bytes,500);assert.equal(row.relay_bytes,500);assert.equal(row.relay_chunks,2);assert.equal(row.origin_read_wait_ms,16);assert.equal(row.origin_read_wait_max_ms,15);assert.equal(row.origin_write_wait_ms,23);assert.equal(row.origin_write_wait_max_ms,20);assert.equal(row.relay_read_wait_max_ms,5);assert.equal(row.consumer_pause_ms,702);assert.equal(row.consumer_pause_max_ms,700);assert.equal(row.status,200);assert.equal(row.progress_count,1);
 const keys=['event','time','case_id','flow_id','attempt','public_id','scope','elapsed_ms','status','origin_observed','origin_bytes','origin_last_byte_ms','origin_read_wait_ms','origin_read_wait_max_ms','origin_write_wait_ms','origin_write_wait_max_ms','origin_reason','relay_bytes','relay_last_byte_ms','relay_chunks','relay_read_wait_ms','relay_read_wait_max_ms','consumer_pause_ms','consumer_pause_max_ms','progress_count','reason'];
 assert.deepEqual(Object.keys(row).sort(),keys.sort());assert.ok(JSON.stringify(row).length<1500);
});

test('last-byte timestamps start null and advance only for positive bytes',()=>{
 const f=fixture(),m=f.monitor;assert.equal(f.records[0].origin_last_byte_ms,null);assert.equal(f.records[0].relay_last_byte_ms,null);
 m.originBytes(0);m.relayChunk(0);f.setTime(FROM+60000);m.checkpoint();assert.equal(f.records.at(-1).origin_last_byte_ms,null);assert.equal(f.records.at(-1).relay_last_byte_ms,null);
 f.setTime(FROM+61000);m.originBytes(100);f.setTime(FROM+62000);m.relayChunk(80);
 f.setTime(FROM+70000);m.originBytes(0);m.relayChunk(0);m.originBytes(-1);m.relayChunk('100');
 f.setTime(FROM+60000);m.originBytes(1);m.relayChunk(1); // A clock correction cannot move a last-byte observation backwards.
 m.finish('relay_complete');const row=f.records.at(-1);assert.equal(row.origin_last_byte_ms,62000);assert.equal(row.relay_last_byte_ms,62000);
 assert.ok(row.origin_last_byte_ms>=0&&row.origin_last_byte_ms<=86400000);assert.ok(!JSON.stringify(row).includes('fixtureviewer'));
});

test('a failed byte-observation clock safely disables the monitor',()=>{
 let calls=0;const records=[],m=createLiveFlowMonitor(select(),{now:()=>{if(++calls>2)throw Error('private clock');return FROM},logger:row=>records.push(row)});
 assert.equal(records.length,1);assert.doesNotThrow(()=>m.originBytes(100));assert.doesNotThrow(()=>m.relayChunk(100));assert.equal(m.finish('relay_error'),false);assert.equal(records.length,1);
});

test('malicious counter inputs, raw errors and statuses never leak or overflow',()=>{
 const f=fixture(),m=f.monitor,privateText='https://secret.test?password=never-log';
 const hostile={toString(){throw Error(privateText)},valueOf(){throw Error(privateText)}};
 for(const n of [NaN,Infinity,-1,'123',privateText,hostile]){m.originBytes(n);m.originReadWait(n);m.originWriteWait(n);m.relayChunk(n);m.relayReadWait(n);m.consumerPause(n);m.setStatus(n)}
 m.originEnd(privateText);assert.equal(m.finish(privateText),false);
 m.originBytes(Number.MAX_SAFE_INTEGER);m.originBytes(Number.MAX_SAFE_INTEGER);m.relayChunk(Number.MAX_SAFE_INTEGER);m.consumerPause(Number.MAX_SAFE_INTEGER);m.consumerPause(Number.MAX_SAFE_INTEGER);m.originReadWait(Number.MAX_SAFE_INTEGER);m.originWriteWait(Number.MAX_SAFE_INTEGER);m.relayReadWait(Number.MAX_SAFE_INTEGER);m.setStatus(999);m.setStatus(200.5);
 assert.equal(m.finish('relay_error',{get status(){throw Error(privateText)}}),true);
 const row=f.records.at(-1);assert.equal(row.origin_bytes,2**40);assert.equal(row.relay_bytes,2**40);assert.equal(row.consumer_pause_ms,86400000);assert.equal(row.origin_read_wait_max_ms,86400000);assert.equal(row.origin_reason,null);assert.equal(row.status,undefined);assert.ok(!JSON.stringify(f.records).includes('secret'));assert.ok(!JSON.stringify(f.records).includes('fixtureviewer'));
});

test('progress is no more than once per minute and sixty times per flow',()=>{
 const f=fixture(),m=f.monitor;m.start();
 for(let i=0;i<7200;i++){f.setTime(FROM+i*1000);m.checkpoint();m.originBytes(1)}
 const progress=f.records.filter(row=>row.event==='live_flow_progress');assert.equal(progress.length,60);
 assert.ok(progress.every((row,i)=>row.time-(i?progress[i-1].time:FROM)>=60000));
 assert.equal(m.finish('origin_eof'),true);assert.equal(f.records.length,62);
});

test('an expired observation ends once without throwing or canceling playback',()=>{
 const f=fixture(),m=f.monitor;m.originBytes(5);f.setTime(FROM+86400000);assert.equal(m.checkpoint(),false);
 assert.equal(f.records.at(-1).reason,'observation_window_ended');const before=JSON.stringify(f.records);
 m.originBytes(50);m.originEnd('origin_error');m.relayChunk(100);m.setStatus(500);m.start();m.checkpoint();m.finish('client_cancel');assert.equal(JSON.stringify(f.records),before);
});

test('finish is idempotent; unobserved origin stays explicit',()=>{
 const f=fixture(),m=f.monitor;m.relayChunk(30);m.finish('session_denied',{status:410});m.finish('origin_error');m.checkpoint();
 assert.equal(f.records.length,2);assert.equal(f.records[1].origin_observed,false);assert.equal(f.records[1].origin_bytes,0);assert.equal(f.records[1].origin_reason,null);
 const playlist=fixture();assert.equal(playlist.monitor.finish('playlist_response'),true);assert.equal(playlist.records.at(-1).reason,'playlist_response');
});

test('origin termination keeps its first valid reason and does not end the relay',()=>{
 const f=fixture();f.monitor.originEnd('https://private');f.monitor.originEnd('origin_error');f.monitor.originEnd('origin_eof');
 assert.equal(f.records.length,1);f.monitor.finish('relay_error');assert.equal(f.records.at(-1).origin_reason,'origin_error');
});

test('invalid/disabled metadata and bad clocks return nonthrowing no-op monitors',()=>{
 for(const meta of [null,{},[],{...select(),username:'fixtureviewer'},{...select(),until:FROM},Object.create({case_id:CASE})]){
  const f=fixture(meta),m=f.monitor;assert.equal(m.start(),false);assert.equal(m.checkpoint(),false);assert.equal(m.finish('relay_error'),false);
  for(const method of ['originBytes','originReadWait','originWriteWait','originEnd','relayChunk','relayReadWait','consumerPause','setStatus'])assert.doesNotThrow(()=>m[method]({get value(){throw Error('private')}}));assert.equal(f.records.length,0);
 }
 for(const options of [{now:()=>NaN},{now:()=>{throw Error('clock')}},{now:0},{logger:0}])assert.doesNotThrow(()=>createLiveFlowMonitor(select(),options).finish('relay_error'));
});

test('logger failure never interrupts start, counters, progress or termination',()=>{
 let time=FROM,calls=0;const m=createLiveFlowMonitor(select(),{now:()=>time,logger(){calls++;throw Error('logger unavailable')}});
 m.originBytes(3);time+=60000;assert.doesNotThrow(()=>m.checkpoint());assert.equal(m.finish('session_expired'),true);assert.equal(m.finish('playback_expired'),false);assert.equal(calls,3);
});

test('a rejected asynchronous logger is contained too',async()=>{
 const m=createLiveFlowMonitor(select(),{now:()=>FROM,logger:()=>Promise.reject(Error('private logging transport'))});
 assert.equal(m.finish('relay_complete'),true);await new Promise(resolve=>setImmediate(resolve));
});

test('diagnostics never create timers or log individual packet samples',()=>{
 const timeout=globalThis.setTimeout,interval=globalThis.setInterval;
 globalThis.setTimeout=globalThis.setInterval=()=>{throw Error('diagnostic timer forbidden')};
 try{const f=fixture();for(let i=0;i<1000;i++){f.monitor.originBytes(1397);f.monitor.originReadWait(0.1);f.monitor.relayChunk(1397);f.monitor.consumerPause(0.2)}assert.equal(f.records.length,1);f.monitor.finish('origin_truncated');assert.equal(f.records.length,2);assert.ok(f.records.every(row=>Object.values(row).every(value=>value===null||typeof value!=='object')))}
 finally{globalThis.setTimeout=timeout;globalThis.setInterval=interval}
});
