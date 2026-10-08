import {guardXtreamResponse} from '../src/xtream-bridge.mjs';
import assert from 'node:assert/strict';
import {guardPlaybackExpiry} from '../src/playback-expiry.mjs';
// Test the exact deadline with a controlled server clock, not a delayed poll.
const originalNow=Date.now,originalSet=setTimeout,originalClear=clearTimeout;
let clock=1000,tick,delay,canceled=0,released=0;
Date.now=()=>clock;globalThis.setTimeout=(fn,ms)=>{tick=fn;delay=ms;return 1};globalThis.clearTimeout=()=>{};
try {
 const response=guardPlaybackExpiry(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]))},cancel(){canceled++}}),{status:206,headers:{'content-range':'bytes 0-2/10','content-length':'3'}}),1100,undefined,()=>{released++});
 assert.equal(delay,100);assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-2/10');
 const reader=response.body.getReader();assert.deepEqual([...((await reader.read()).value)],[1,2,3]);
 const pending=reader.read();const rejected=assert.rejects(pending,/access_expired/);
 clock=1100;tick();await rejected;await new Promise(r=>originalSet(r,0));
 assert.equal(canceled,1);assert.equal(released,1);
 tick();await Promise.resolve();assert.equal(released,1,'expiry cleanup is idempotent');
} finally{Date.now=originalNow;globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear}
// Normal EOF and closing a prefetched segment must not revoke the whole lease.
let expired=0;
const ordinary=guardPlaybackExpiry(new Response('whole-segment'),Date.now()+10000,undefined,()=>expired++);
assert.equal(await ordinary.text(),'whole-segment');assert.equal(expired,0);
const controller=new AbortController();let canceledOnDisconnect=0;
const disconnected=guardPlaybackExpiry(new Response(new ReadableStream({cancel(){canceledOnDisconnect++}})),Date.now()+10000,controller.signal,()=>expired++);
const pending=disconnected.body.getReader().read();const rejected=assert.rejects(pending,/client_disconnected/);controller.abort();await rejected;
assert.equal(canceledOnDisconnect,1);assert.equal(expired,0);
console.log('PASS: exact streaming deadline, upstream cancellation, capacity cleanup, byte range preservation, EOF and ordinary segment cancellation isolation.');
{
// Test the exact deadline with a controlled server clock, not a delayed poll.
const originalNow=Date.now,originalSet=setTimeout,originalClear=clearTimeout;
let clock=1000,tick,delay,canceled=0,released=0;
Date.now=()=>clock;globalThis.setTimeout=(fn,ms)=>{tick=fn;delay=ms;return 1};globalThis.clearTimeout=()=>{};
try {
 const response=guardXtreamResponse(new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]))},cancel(){canceled++}}),{status:206,headers:{'content-range':'bytes 0-2/10','content-length':'3'}}),async()=>true,()=>{released++},undefined,undefined,1100);
 assert.equal(delay,100);assert.equal(response.status,206);assert.equal(response.headers.get('content-range'),'bytes 0-2/10');
 const reader=response.body.getReader();assert.deepEqual([...((await reader.read()).value)],[1,2,3]);
 const pending=reader.read();const rejected=assert.rejects(pending,/access_expired/);
 clock=1100;tick();await rejected;await new Promise(r=>originalSet(r,0));
 assert.equal(canceled,1);assert.equal(released,1);
 tick();await Promise.resolve();assert.equal(released,1,'expiry cleanup is idempotent');
} finally{Date.now=originalNow;globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear}

console.log('PASS: continuous native streams use the existing single guard and abort at the exact signed deadline.');

}
