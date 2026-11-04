import assert from 'node:assert/strict';
import {test} from 'node:test';
import {CCF_MEDIA_ORIGIN,fetchApprovedMediaIP} from '../src/ip-media.mjs';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
const target='http://89.44.33.22:8080/synthetic.ts';
function wire({length=2*1024*1024,fragment=1397,stall=false,stallAfter=Infinity,prefix=0}={}){
 const state={reads:0,cancels:0,releases:0,closes:0};let headers=true,sent=prefix;
 return {state,connect(){return {opened:Promise.resolve(),closed:Promise.resolve(),
  writable:new WritableStream(),close:async()=>{state.closes++},
  readable:{getReader(){return {
   async read(){state.reads++;if(headers){headers=false;const text=new TextEncoder().encode('HTTP/1.0 200 OK\r\nContent-Length: '+length+'\r\nContent-Type: video/mp2t\r\n\r\n');const bytes=new Uint8Array(text.length+prefix);bytes.set(text);bytes.fill(7,text.length);return {done:false,value:bytes}}
    if(stall||sent>=stallAfter)return new Promise(()=>{});if(sent===length)return {done:true};const size=Math.min(fragment,length-sent);sent+=size;return {done:false,value:new Uint8Array(size).fill(7)};},
   async cancel(){state.cancels++},releaseLock(){state.releases++}
  }}}
 }}};
}
const nativeFactory=()=>new TransformStream();
async function controlledClock(run){
 const original={setTimeout,clearTimeout,now:Date.now};let now=1000,created=0;const active=new Set();
 globalThis.setTimeout=(fn,delay)=>{const timer={fn,delay,unref(){}};created++;active.add(timer);return timer};
 globalThis.clearTimeout=timer=>active.delete(timer);Date.now=()=>now;
 const clock={get created(){return created},get active(){return [...active]},advance(ms){now+=ms},fire(timer){assert.ok(active.delete(timer));timer.fn()}};
 try{return await run(clock)}finally{globalThis.setTimeout=original.setTimeout;globalThis.clearTimeout=original.clearTimeout;Date.now=original.now}
}

test('fragmented multi-megabyte native body uses bounded timers and abort subscriptions',async()=>controlledClock(async clock=>{
 const fixture=wire(),abort=new AbortController(),signal=abort.signal;
 const add=signal.addEventListener.bind(signal),remove=signal.removeEventListener.bind(signal);let adds=0,removes=0;
 signal.addEventListener=(...args)=>{adds++;return add(...args)};signal.removeEventListener=(...args)=>{removes++;return remove(...args)};
 let observedBytes=0;const endings=[];
 const response=await fetchApprovedMediaIP(target,new Headers(),fixture.connect,nativeFactory,CCF_MEDIA_ORIGIN,null,8000,signal,{originBytes:n=>observedBytes+=n,originReadWait(){},originWriteWait(){},originEnd:reason=>endings.push(reason)});
 const bytes=new Uint8Array(await response.arrayBuffer());
 assert.equal(bytes.length,2*1024*1024);assert.ok(bytes.every(byte=>byte===7));assert.ok(fixture.state.reads>1000);
 assert.ok(clock.created<=8,'one body watchdog replaces per-packet timeout creation');
 assert.ok(adds<=8,'body packets must not add request abort listeners');assert.equal(adds,removes);
 assert.equal(clock.active.length,0);assert.equal(fixture.state.closes,1);assert.equal(fixture.state.cancels,1);
 assert.equal(observedBytes,2*1024*1024);assert.deepEqual(endings,['origin_complete']);
 console.log(JSON.stringify({transport:'fragmented-2MiB',reads:fixture.state.reads,timers:clock.created,abortSubscriptions:adds}));
}));

for(const mode of ['idle','request-abort','downstream-cancel'])test('native pending read closes exactly once: '+mode,async()=>controlledClock(async clock=>{
 const fixture=wire({length:100,stall:true}),abort=new AbortController();
 const endings=[];
 const response=await fetchApprovedMediaIP(target,new Headers(),fixture.connect,nativeFactory,CCF_MEDIA_ORIGIN,null,8000,abort.signal,{originEnd:reason=>endings.push(reason)});
 const reader=response.body.getReader(),reading=reader.read();
 const rejected=mode==='downstream-cancel'?null:assert.rejects(reading,mode==='idle'?/media_timeout/:/viewer closed/);
 await tick();assert.equal(clock.active.length,1);
 if(mode==='idle'){clock.advance(20000);clock.fire(clock.active[0])}
 else if(mode==='request-abort')abort.abort(Error('viewer closed'));
 else {await reader.cancel('viewer closed');assert.equal((await reading).done,true)}
 await rejected;await tick();
 assert.equal(clock.active.length,0);assert.equal(fixture.state.closes,1);assert.equal(fixture.state.cancels,1);assert.equal(fixture.state.releases,2);
 assert.deepEqual(endings,mode==='idle'?['origin_silence']:[]);
}));

test('watchdog does not treat downstream backpressure as upstream silence',async()=>controlledClock(async clock=>{
 const fixture=wire({length:100,fragment:1}),abort=new AbortController();
 const response=await fetchApprovedMediaIP(target,new Headers(),fixture.connect,nativeFactory,CCF_MEDIA_ORIGIN,null,8000,abort.signal);
 await tick();assert.equal(clock.active.length,1,'a completed body read may leave the reusable timer scheduled');
 clock.advance(20000);clock.fire(clock.active[0]);await tick();
 assert.equal(fixture.state.closes,0,'a backpressured writer has no upstream idle deadline');
 await response.body.cancel('viewer closed');await tick();assert.equal(fixture.state.closes,1);assert.equal(clock.active.length,0);
}));

test('a reused watchdog observes the newest pending read deadline',async()=>controlledClock(async clock=>{
 const fixture=wire({length:10,fragment:1,stallAfter:2}),response=await fetchApprovedMediaIP(target,new Headers(),fixture.connect,nativeFactory,CCF_MEDIA_ORIGIN),reader=response.body.getReader();
 await tick();const originalTimer=clock.active[0];assert.ok(originalTimer);
 clock.advance(19000);assert.equal((await reader.read()).value.length,1);assert.equal((await reader.read()).value.length,1);
 const pending=reader.read(),rejected=assert.rejects(pending,/media_timeout/);await tick();
 // The old timer is due a second later, but the next packet was only requested
 // at t=20s. It must rearm for that read rather than apply its stale deadline.
 clock.advance(1000);clock.fire(originalTimer);await tick();
 assert.equal(fixture.state.closes,0);assert.equal(clock.active.length,1);assert.equal(clock.active[0].delay,19000);
 clock.advance(19000);clock.fire(clock.active[0]);await rejected;await tick();assert.equal(fixture.state.closes,1);assert.equal(clock.active.length,0);
}));
