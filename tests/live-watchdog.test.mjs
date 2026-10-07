import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context={};vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../live-watchdog.js',import.meta.url),'utf8'),context);
let clock=0,tick,cleared=0,recoveries=[],fallbacks=0,active=true,hidden=false;
const video={currentTime:0,paused:false};
const start=()=>context.watchLivePlayback(video,{now:()=>clock,schedule:fn=>(tick=fn,1),unschedule:()=>cleared++,active:()=>active,hidden:()=>hidden,recover:attempt=>recoveries.push(attempt),fallback:()=>fallbacks++});
let stop=start();
for(let i=0;i<120;i++){clock+=1000;video.currentTime++;tick()}
assert.deepEqual(recoveries,[],'normal long playback does not reconnect');
clock+=8000;tick();assert.deepEqual(recoveries,[1]);
clock+=8000;tick();assert.deepEqual(recoveries,[1,2]);
clock+=8000;tick();assert.equal(fallbacks,1);assert.equal(cleared,1);
clock+=8000;tick();assert.equal(fallbacks,1,'a failed channel cannot enter an endless reconnect loop');
recoveries=[];start();video.paused=true;clock+=60000;tick();video.paused=false;tick();assert.deepEqual(recoveries,[]);
hidden=true;clock+=60000;tick();hidden=false;tick();assert.deepEqual(recoveries,[],'background and intentional pause do not trigger recovery');
active=false;clock+=9000;tick();assert.deepEqual(recoveries,[],'an obsolete channel or logged-out user cannot restart');
active=true;recoveries=[];stop=start();clock+=8000;tick();assert.deepEqual(recoveries,[1]);
for(let i=0;i<31;i++){clock+=1000;video.currentTime++;tick()}
clock+=8000;tick();assert.deepEqual(recoveries,[1,1],'sustained recovery resets the retry budget');
stop();const before=cleared;stop();assert.equal(cleared,before);
console.log('PASS: frozen live timeline recovery, bounded fallback, sustained playback reset, pause/background, obsolete playback and timer cleanup.');

let started=[],mediaRecovered=0,plays=0;
const recovering={currentTime:98,play:async()=>{plays++}};
const engine={currentLevel:0,liveSyncPosition:95,levels:[{details:{fragments:[{start:80},{start:90},{start:100}]}}],startLoad:position=>started.push(position),recoverMediaError:()=>mediaRecovered++};
context.recoverLivePlayback(recovering,engine,1);
assert.equal(recovering.currentTime,90,'recovery uses the segment boundary, not an arbitrary position in the newest fragment');
assert.deepEqual(started,[90]);assert.equal(mediaRecovered,0);
context.recoverLivePlayback(recovering,engine,2);assert.equal(mediaRecovered,1);assert.equal(plays,2);
const noDetails={currentLevel:-1,loadLevel:-1,liveSyncPosition:undefined,startLoad:p=>started.push(p),recoverMediaError:()=>{}};
recovering.currentTime=77;context.recoverLivePlayback(recovering,noDetails,1);
assert.equal(recovering.currentTime,77,'missing playlist details do not force an unbuffered seek');assert.equal(started.at(-1),-1);
let loaded=0;const native={currentTime:0,buffered:{length:0},load:()=>loaded++,play:async()=>{}};
context.recoverLivePlayback(native,null,1);assert.equal(loaded,0);
context.recoverLivePlayback(native,null,2);assert.equal(loaded,1,'native recovery reloads only after a second failed recovery');
native.buffered={length:2,start:i=>i===1?50:0,end:i=>i===1?60:10};
context.recoverLivePlayback(native,null,1);assert.equal(native.currentTime,56,'a native seek stays in the latest buffered range');
console.log('PASS: segment-aligned recovery, bounded decoder reset, missing metadata, native buffered seek and reload.');
