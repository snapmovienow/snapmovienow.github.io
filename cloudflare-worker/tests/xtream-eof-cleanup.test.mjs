import assert from 'node:assert/strict';
import {guardXtreamResponse} from '../src/xtream-bridge.mjs';

// The player must receive EOF when a live source ends, even while the separate
// capacity release is delayed or unavailable. No accounts or networks are used.
for (const failRelease of [false, true]) {
  let finishRelease, rejectRelease, releaseCalls=0, timer;
  const release=new Promise((resolve,reject)=>{finishRelease=resolve;rejectRelease=reject;});
  const background=[];
  const source=new Response(new ReadableStream({start(controller){
    controller.enqueue(new Uint8Array([0x47,0x00,0x10,0x00]));
    controller.close();
  }}));
  const response=guardXtreamResponse(source,async()=>true,()=>{
    releaseCalls++;
    return release;
  },{waitUntil(task){background.push(task);}},undefined,undefined,{waitForRelease:false});
  const reader=response.body.getReader();
  assert.deepEqual([...(await reader.read()).value],[0x47,0x00,0x10,0x00]);
  const end=reader.read();
  try {
    const result=await Promise.race([
      end,
      new Promise(resolve=>{timer=setTimeout(()=>resolve('release_blocked_eof'),250);})
    ]);
    assert.notEqual(result,'release_blocked_eof','source EOF must reach the player before capacity release completes');
    assert.equal(result.done,true);
    assert.equal(releaseCalls,1,'EOF still starts the exact reservation release once');
    assert.equal(background.length,1,'the runtime retains the pending capacity cleanup');
  } finally {
    clearTimeout(timer);
    if(failRelease)rejectRelease(Error('release_unavailable'));else finishRelease();
    await Promise.allSettled([...background,end]);
  }
  assert.equal(releaseCalls,1);
}

console.log('PASS: native EOF reaches the player without waiting for delayed or failed capacity release; cleanup remains scheduled once.');
