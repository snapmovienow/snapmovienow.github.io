import assert from 'node:assert/strict';
import {guardXtreamResponse} from '../src/xtream-bridge.mjs';
const saved={setInterval,clearInterval,now:Date.now};
for(const result of ['allow','deny','reject']){
 let clock=0,tick,resolveCheck,rejectCheck,released=0,canceled=0,checks=0;
 Date.now=()=>clock;globalThis.setInterval=fn=>(tick=fn,1);globalThis.clearInterval=()=>{};
 try{
  const response=guardXtreamResponse(new Response(new ReadableStream({cancel(){canceled++}})),()=>{checks++;return new Promise((r,j)=>{resolveCheck=r;rejectCheck=j})},async()=>{released++});
  const reader=response.body.getReader();let state='pending';const read=reader.read().then(()=>state='ended',()=>state='errored');
  await new Promise(r=>setTimeout(r,0));clock=25000;const pendingCheck=tick();
  clock=40000;await tick();assert.equal(state,'pending');assert.equal(checks,1);
  clock=50000;await tick();await read;assert.equal(state,'errored');assert.equal(released,1);assert.equal(canceled,1);
  if(result==='reject')rejectCheck(Error('late'));else resolveCheck(result==='allow');
  await pendingCheck;await tick();assert.equal(checks,1);assert.equal(released,1);assert.equal(canceled,1);
 }finally{Object.assign(globalThis,{setInterval:saved.setInterval,clearInterval:saved.clearInterval});Date.now=saved.now}
}
{
 let clock=0,tick,resolveCheck,source,released=0,checks=0;
 Date.now=()=>clock;globalThis.setInterval=fn=>(tick=fn,1);globalThis.clearInterval=()=>{};
 try{
  const response=guardXtreamResponse(new Response(new ReadableStream({start(c){source=c}})),()=>{checks++;return new Promise(r=>resolveCheck=r)},async()=>{released++});
  const reader=response.body.getReader();let read=reader.read();await new Promise(r=>setTimeout(r,0));clock=25000;const check=tick();
  clock=40000;source.enqueue(new Uint8Array([1]));assert.equal((await read).done,false);read=reader.read();await new Promise(r=>setTimeout(r,0));
  clock=75000;await tick();assert.equal(released,0);assert.equal(checks,1);
  resolveCheck(true);await check;await reader.cancel();await read;assert.equal(released,1);
 }finally{Object.assign(globalThis,{setInterval:saved.setInterval,clearInterval:saved.clearInterval});Date.now=saved.now}
}
console.log('PASS: pending check cannot bypass existing idle guard; late allow/deny/reject clean once; ongoing stream and no overlapping checks preserved.');
