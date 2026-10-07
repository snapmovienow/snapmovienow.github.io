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
