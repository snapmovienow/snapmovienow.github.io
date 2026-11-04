import assert from 'node:assert/strict';
import {guardXtreamResponse} from '../src/xtream-bridge.mjs';
import {createLiveFlowMonitor,selectLiveFlowDiagnostic} from '../src/live-flow-diagnostics.mjs';

// Synthetic streams only: the observer must describe relay events without
// changing bytes, authorization, timing guards, or reservation cleanup.
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const env={
 LIVE_FLOW_DIAGNOSTIC_USERNAME:'synthetic-user',
 LIVE_FLOW_DIAGNOSTIC_CASE:'11111111-1111-4111-8111-111111111111',
 LIVE_FLOW_DIAGNOSTIC_FROM:'0',
 LIVE_FLOW_DIAGNOSTIC_UNTIL:'86400000'
};
const input={username:'synthetic-user',type:'live',ext:'ts',method:'GET',requestId:'22222222-2222-4222-8222-222222222222',publicId:'123'};
async function controlled(run){
 const saved={now:Date.now,setInterval,clearInterval,setTimeout,clearTimeout};
 let now=1000;const intervals=new Set(),timeouts=new Set(),records=[];
 Date.now=()=>now;
 globalThis.setInterval=(fn,ms)=>{const timer={fn,ms,unref(){}};intervals.add(timer);return timer};
 globalThis.clearInterval=timer=>intervals.delete(timer);
 globalThis.setTimeout=(fn,ms)=>{const timer={fn,ms,unref(){}};timeouts.add(timer);return timer};
 globalThis.clearTimeout=timer=>timeouts.delete(timer);
 const clock={
  records,intervals,timeouts,
  get now(){return now},advance(ms){now+=ms},
  monitor(logger=record=>records.push(record)){return createLiveFlowMonitor(selectLiveFlowDiagnostic(env,input,now),{now:()=>now,logger})},
  async tick(){for(const timer of [...intervals])await timer.fn()},
  async expire(){for(const timer of [...timeouts]){timeouts.delete(timer);await timer.fn()}await flush()},
  ends(){return records.filter(record=>record.event==='live_flow_end')}
 };
 try{return await run(clock)}finally{
  Date.now=saved.now;Object.assign(globalThis,{setInterval:saved.setInterval,clearInterval:saved.clearInterval,setTimeout:saved.setTimeout,clearTimeout:saved.clearTimeout});
 }
}

await controlled(async clock=>{
 let source,releases=0;const background=[];
 const monitor=clock.monitor();monitor.setStatus(200);
 const response=guardXtreamResponse(new Response(new ReadableStream({start(controller){source=controller}}),{headers:{'content-type':'video/mp2t','accept-ranges':'bytes'}}),async()=>true,async()=>{releases++},{waitUntil:p=>background.push(p)},undefined,undefined,{waitForRelease:false,flowMonitor:monitor});
 await flush();clock.advance(40);source.enqueue(new Uint8Array([0x47,1,2]));await flush();
 // Leave the relay's single queued chunk unread so the next pull measures a
 // downstream pause, rather than pretending that bytes reached the device.
 clock.advance(70);const reader=response.body.getReader();
 assert.deepEqual([...(await reader.read()).value],[0x47,1,2]);
 source.close();assert.equal((await reader.read()).done,true);await Promise.all(background);
 assert.equal(response.headers.get('content-type'),'video/mp2t');assert.equal(response.headers.get('accept-ranges'),'bytes');
 assert.equal(releases,1);assert.equal(clock.ends().length,1);
 const end=clock.ends()[0];assert.equal(end.reason,'relay_complete');assert.equal(end.status,200);
 assert.equal(end.relay_bytes,3);assert.equal(end.relay_chunks,1);
 assert.ok(end.relay_read_wait_ms>=40);assert.ok(end.consumer_pause_ms>=70);
 assert.equal(end.scope,'server_relay_not_client');assert.equal(end.origin_observed,false);
 assert.equal(clock.intervals.size,0);assert.equal(clock.timeouts.size,0);
});

for(const [label,result,reason]of [
 ['boolean denial',false,'session_denied'],
 ['session denial',{ok:false,reason:'session_denied'},'session_denied'],
 ['session expiry',{ok:false,reason:'session_expired'},'session_expired'],
 ['lease denial',{ok:false,reason:'lease_denied'},'lease_denied'],
 ['lease expiry',{ok:false,reason:'playback_expired'},'playback_expired'],
 ['lease replacement',{ok:false,reason:'playback_superseded'},'playback_superseded'],
 ['control exception',null,'access_unavailable']
])await controlled(async clock=>{
 let checks=0,cancels=0,releases=0;const monitor=clock.monitor();
 const response=guardXtreamResponse(new Response(new ReadableStream({cancel(){cancels++}})),async()=>{checks++;if(label==='control exception')throw Error('https://example.invalid/?password=private');return result},async()=>{releases++},undefined,undefined,undefined,{flowMonitor:monitor});
 const reader=response.body.getReader();const failed=assert.rejects(reader.read(),label==='control exception'?/access_unavailable/:/access_revoked/);
 await flush();clock.advance(25000);await clock.tick();await failed;await clock.tick();
 assert.equal(checks,1,label);assert.equal(cancels,1,label);assert.equal(releases,1,label);
 assert.equal(clock.ends().length,1,label);assert.equal(clock.ends()[0].reason,reason,label);
 assert.equal(JSON.stringify(clock.records).includes('private'),false);
 assert.equal(clock.intervals.size,0);
});

for(const result of [true,{ok:true}])await controlled(async clock=>{
 let releases=0;const response=guardXtreamResponse(new Response(new ReadableStream()),async()=>result,async()=>{releases++},undefined,undefined,undefined,{flowMonitor:clock.monitor()});
 const reader=response.body.getReader(),pending=reader.read();await flush();clock.advance(25000);await clock.tick();
 assert.equal(clock.ends().length,0,'successful control check keeps the relay open');assert.equal(releases,0);
 await reader.cancel('local test');await pending;assert.equal(clock.ends()[0].reason,'client_cancel');assert.equal(releases,1);
});

await controlled(async clock=>{
 let releases=0;
 const response=guardXtreamResponse(new Response(new ReadableStream()),async()=>true,async()=>{releases++},undefined,undefined,undefined,{flowMonitor:clock.monitor()});
 const failed=assert.rejects(response.body.getReader().read(),/stream_idle/);await flush();
 assert.equal(clock.intervals.size,1);assert.equal(clock.timeouts.size,0,'observations add no new timer');
 clock.advance(60000);await clock.tick();await failed;
 assert.equal(clock.records.filter(r=>r.event==='live_flow_progress').length,1,'existing control interval drives the bounded checkpoint');
 assert.equal(clock.ends().length,1);assert.equal(clock.ends()[0].reason,'stream_idle');assert.equal(releases,1);
});

await controlled(async clock=>{
 let source,releases=0;
 const selected=selectLiveFlowDiagnostic({...env,LIVE_FLOW_DIAGNOSTIC_UNTIL:'2000'},input,clock.now);
 const monitor=createLiveFlowMonitor(selected,{now:()=>clock.now,logger:r=>clock.records.push(r)});
 const response=guardXtreamResponse(new Response(new ReadableStream({start(controller){source=controller}})),async()=>true,async()=>{releases++},undefined,undefined,undefined,{flowMonitor:monitor});
 const reader=response.body.getReader(),pending=reader.read();await flush();clock.advance(25000);await clock.tick();
 assert.equal(clock.ends()[0].reason,'observation_window_ended');assert.equal(releases,0,'ending observations does not stop playback');
 source.enqueue(new Uint8Array([0x47]));assert.deepEqual([...(await pending).value],[0x47]);source.close();assert.equal((await reader.read()).done,true);
 assert.equal(clock.ends().length,1);assert.equal(releases,1);
});

await controlled(async clock=>{
 let cancelCalls=0,releases=0;const abort=new AbortController();const background=[];
 const response=guardXtreamResponse(new Response(new ReadableStream({cancel(){cancelCalls++}})),async()=>true,async()=>{releases++},{waitUntil:p=>background.push(p)},abort.signal,undefined,{flowMonitor:clock.monitor()});
 const reader=response.body.getReader(),failed=assert.rejects(reader.read(),/client_disconnected/);await flush();
 abort.abort(Error('private diagnostic detail'));await failed;await reader.cancel().catch(()=>{});await Promise.allSettled(background);await clock.tick();
 assert.equal(clock.ends().length,1);assert.equal(clock.ends()[0].reason,'client_abort');assert.equal(cancelCalls,1);assert.equal(releases,1);
 assert.equal(JSON.stringify(clock.records).includes('private diagnostic detail'),false);
});

await controlled(async clock=>{
 const abort=new AbortController();abort.abort();let releases=0;
 const response=guardXtreamResponse(new Response(new ReadableStream()),async()=>true,async()=>{releases++},undefined,abort.signal,undefined,{flowMonitor:clock.monitor()});
 await assert.rejects(response.body.getReader().read(),/client_disconnected/);await flush();
 assert.equal(clock.ends().length,1);assert.equal(clock.ends()[0].reason,'client_abort');assert.equal(releases,1);assert.equal(clock.intervals.size,0);
});

for(const expiredAlready of [false,true])await controlled(async clock=>{
 let releases=0;const background=[];
 const response=guardXtreamResponse(new Response(new ReadableStream()),async()=>true,async()=>{releases++},{waitUntil:p=>background.push(p)},undefined,expiredAlready?clock.now:clock.now+10000,{flowMonitor:clock.monitor()});
 const failed=assert.rejects(response.body.getReader().read(),/access_expired/);await flush();
 if(!expiredAlready){assert.equal(clock.timeouts.size,1);clock.advance(10000);await clock.expire()}
 await failed;await Promise.allSettled(background);
 assert.equal(clock.ends().length,1);assert.equal(clock.ends()[0].reason,'access_expired');assert.equal(releases,1);
 assert.equal(clock.intervals.size,0);assert.equal(clock.timeouts.size,0);
});

for(const [message,reason]of [['media_timeout','origin_silence'],['truncated_http_body','origin_truncated'],['untrusted private error','relay_error']])await controlled(async clock=>{
 let source,releases=0;
 const response=guardXtreamResponse(new Response(new ReadableStream({start(controller){source=controller}})),async()=>true,async()=>{releases++},undefined,undefined,undefined,{flowMonitor:clock.monitor()});
 const failed=assert.rejects(response.body.getReader().read());await flush();source.error(Error(message));await failed;
 assert.equal(clock.ends().length,1);assert.equal(clock.ends()[0].reason,reason);assert.equal(releases,1);
 assert.equal(JSON.stringify(clock.records).includes('untrusted private error'),false);
});

// An in-flight check resolving after a downstream abort cannot add a second
// terminal record, cancel the source again, or release the reservation twice.
for(const lateResult of [true,false,'reject'])await controlled(async clock=>{
 let resolveCheck,rejectCheck,releases=0,cancels=0;const abort=new AbortController(),background=[];
 const response=guardXtreamResponse(new Response(new ReadableStream({cancel(){cancels++}})),()=>new Promise((resolve,reject)=>{resolveCheck=resolve;rejectCheck=reject}),async()=>{releases++},{waitUntil:p=>background.push(p)},abort.signal,undefined,{flowMonitor:clock.monitor()});
 const failed=assert.rejects(response.body.getReader().read(),/client_disconnected/);await flush();clock.advance(25000);const checking=clock.tick();await flush();
 abort.abort();await failed;if(lateResult==='reject')rejectCheck(Error('late'));else resolveCheck(lateResult);
 await checking;await Promise.allSettled(background);assert.equal(clock.ends().length,1);assert.equal(clock.ends()[0].reason,'client_abort');assert.equal(cancels,1);assert.equal(releases,1);
});

for(const observerMode of ['logger throws','observer throws','disabled'])await controlled(async clock=>{
 let releases=0;
 const monitor=observerMode==='logger throws'?clock.monitor(record=>{clock.records.push(record);throw Error('logger unavailable')}):observerMode==='observer throws'?new Proxy({},{get(){throw Error('observer unavailable')}}):undefined;
 if(observerMode==='disabled')assert.equal(selectLiveFlowDiagnostic(env,{...input,username:'someone-else'},clock.now),null);
 const bytes=new Uint8Array([0x47,3,4,5]);
 const response=guardXtreamResponse(new Response(bytes,{status:206,headers:{'content-range':'bytes 0-3/4','content-length':'4','accept-ranges':'bytes'}}),async()=>true,async()=>{releases++},undefined,undefined,undefined,{flowMonitor:monitor,waitForRelease:false});
 assert.deepEqual(new Uint8Array(await response.arrayBuffer()),bytes,observerMode);
 assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-3/4');assert.equal(response.headers.get('content-length'),'4');assert.equal(releases,1);
 assert.equal(clock.intervals.size,0);if(observerMode==='logger throws')assert.equal(clock.ends().length,1);else assert.equal(clock.records.length,0);
});

// Non-target callers retain the old truthy-control contract. Detailed result
// objects are interpreted only when the optional diagnostic path is selected.
await controlled(async clock=>{
 const response=guardXtreamResponse(new Response(new ReadableStream()),async()=>({ok:false}),async()=>{});
 const reader=response.body.getReader(),pending=reader.read();await flush();clock.advance(25000);await clock.tick();
 assert.equal(clock.intervals.size,1);await reader.cancel();await pending;assert.equal(clock.records.length,0);
});

console.log('PASS: optional TS flow observations preserve bytes and Range, label terminal causes once, measure relay continuity, and cannot break playback or cleanup.');
