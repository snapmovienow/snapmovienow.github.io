// Replay the startup ordering in Quality 40217232022 / artifact 12607753505.
// Production transport and the pinned HLS gap controller are real; media,
// buffering, time and network loading are simulated. No browser or provider.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import Hls from 'hls.js';

assert.equal(Hls.version,'1.6.15');
const source=readFileSync(process.env.SMN_TRANSPORT_SOURCE||new URL('../playback-transport.js',import.meta.url),'utf8');
const previousSelf=globalThis.self;
let now=43.7;
globalThis.self={performance:{now:()=>now},setTimeout,clearTimeout,setInterval,clearInterval};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
const ranges=(start,end)=>({length:1,start:()=>start,end:()=>end});

function setup({fakeTimers=false,manifest=true}={}){
 const timers=new Map(),playCalls=[],errors=[],recoveries=[],fatal=[];let nextTimer=0,engine,resolvePlay;
 const video={style:{},currentTime:0,readyState:0,paused:true,ended:false,seeking:false,playbackRate:1,
  buffered:{length:0},canPlayType:()=>'',pause(){this.paused=true},removeAttribute(){},load(){},
  play(){playCalls.push({atMs:now,position:this.currentTime});this.paused=false;engine.gap.onMediaWaiting();return new Promise(resolve=>resolvePlay=resolve)}
 };
 class Engine{
  static Events=Hls.Events;static ErrorTypes=Hls.ErrorTypes;static isSupported=()=>true;
  constructor(){
   engine=this;this.listeners=new Map();this.hasEnoughToStart=false;
   this.real=new Hls({enableWorker:false});this.gap=this.real.gapController;this.gap.media=video;
   this.real.on(Hls.Events.ERROR,(_,data)=>this.emit(Hls.Events.ERROR,data));
  }
  on(event,fn){const list=this.listeners.get(event)||[];list.push(fn);this.listeners.set(event,list)}
  off(event,fn){this.listeners.set(event,(this.listeners.get(event)||[]).filter(listener=>listener!==fn))}
  emit(event,data={}){for(const fn of [...this.listeners.get(event)||[]])fn(event,data)}
  loadSource(){} attachMedia(){if(manifest)this.emit(Hls.Events.MANIFEST_PARSED)}
  destroy(){this.gap.media=null;this.real.destroy()}
 }
 const runtime=vm.createContext({AbortController,
  setTimeout:fakeTimers?(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay});return id}:setTimeout,
  clearTimeout:fakeTimers?id=>timers.delete(id):clearTimeout,
  watchLivePlayback:()=>()=>{},recoverLivePlayback:(video,current,count)=>recoveries.push(count)});
 vm.runInContext(source,runtime);
 const attempt={controller:new AbortController()};
 const transport=runtime.SMNPlaybackTransport.create({moviePlayer:{style:{},pause(){}},hlsPlayer:video,
  assertAttempt(){},loadHls:async()=>Engine,onFatal:type=>fatal.push(type),onDiagnostics:current=>current.on(Hls.Events.ERROR,(_,data)=>errors.push({detail:data.details,fatal:data.fatal,position:video.currentTime,atMs:now}))});
 const pending=transport.start({url:'https://fixture.invalid/generated.m3u8',external:true,type:'live',attempt});
 return {video,transport,pending,attempt,playCalls,errors,recoveries,fatal,timers,get engine(){return engine},
  finishPlayback(){video.readyState=4;video.seeking=false;engine.gap.onMediaPlaying();resolvePlay?.()}};
}

try{
 // The manifest exists long before the first fragment is appended and HLS
 // seeks from zero into its live window. Calling play in that gap reports a
 // false startup stall; waiting for the engine's initial seek avoids it.
 const f=setup();
 try{
  await flush();
  now=428.9;f.video.readyState=1;f.video.buffered=ranges(30.016,35.233333);
  f.engine.gap.buffered={audio:f.video.buffered,video:f.video.buffered};
  f.engine.gap.poll(0,0);
  // An unrelated fragment event alone must not release the startup barrier.
  f.engine.emit(Hls.Events.FRAG_BUFFERED);await flush();
  now=433.4;f.video.currentTime=30.016;f.video.seeking=true;f.video.buffered=ranges(30.016,40);
  f.engine.hasEnoughToStart=true;f.engine.emit(Hls.Events.FRAG_BUFFERED);await flush();
  now=437.3;f.finishPlayback();await f.pending;
  console.log(JSON.stringify({case:'instrumented-startup-replay',errors:f.errors,playCalls:f.playCalls}));
  assert.deepEqual(f.errors,[],'no HLS errors during the observed first-fragment startup ordering');
  assert.equal(f.playCalls.length,1);assert.equal(f.playCalls[0].position,30.016,'play starts at the HLS-selected live position, not zero');
  assert.equal(f.engine.listeners.get(Hls.Events.FRAG_BUFFERED)?.length||0,0);
 }finally{f.transport.stop()}

 // Cancellation while waiting for buffered media must not start stale playback.
 const canceled=setup();await flush();const rejected=assert.rejects(canceled.pending,/playback_superseded/);
 canceled.attempt.controller.abort();await rejected;
 canceled.engine.hasEnoughToStart=true;canceled.engine.emit(Hls.Events.FRAG_BUFFERED);await flush();
 assert.equal(canceled.playCalls.length,0);assert.equal(canceled.engine.listeners.get(Hls.Events.FRAG_BUFFERED)?.length||0,0);
 canceled.transport.stop();

 // The existing 20-second post-manifest timeout covers buffering AND play;
 // it must not be extended or leave a listener that can play after timeout.
 const timeout=setup({fakeTimers:true});await flush();
 assert.equal(timeout.timers.size,1);const timer=[...timeout.timers.values()][0];assert.equal(timer.delay,20000);
 const timedOut=assert.rejects(timeout.pending,/load_timeout/);timer.fn();await timedOut;
 timeout.engine.hasEnoughToStart=true;timeout.engine.emit(Hls.Events.FRAG_BUFFERED);await flush();
 assert.equal(timeout.playCalls.length,0);assert.equal(timeout.timers.size,0);
 assert.equal(timeout.engine.listeners.get(Hls.Events.FRAG_BUFFERED)?.length||0,0);timeout.transport.stop();

 // Existing fatal-manifest rejection and post-manifest recovery keep their
 // semantics: the barrier must neither hide errors nor bypass recovery.
 const failed=setup({manifest:false});await flush();
 const manifestFailed=assert.rejects(failed.pending,/stream_failed/);
 failed.engine.emit(Hls.Events.ERROR,{fatal:true,type:Hls.ErrorTypes.NETWORK_ERROR,details:'manifestLoadError'});
 await manifestFailed;assert.equal(failed.playCalls.length,0);assert.deepEqual(failed.recoveries,[]);
 assert.equal(failed.engine.listeners.get(Hls.Events.MANIFEST_PARSED)?.length||0,0);failed.transport.stop();
 const recovering=setup();await flush();
 recovering.engine.emit(Hls.Events.ERROR,{fatal:true,type:Hls.ErrorTypes.NETWORK_ERROR,details:'fragLoadError'});
 assert.deepEqual(recovering.recoveries,[1]);assert.equal(recovering.errors.length,1,'errors remain observable while buffering');
 assert.equal(recovering.playCalls.length,0);assert.deepEqual(recovering.fatal,[]);
 recovering.video.currentTime=30.016;recovering.video.seeking=true;
 recovering.engine.hasEnoughToStart=true;recovering.engine.emit(Hls.Events.FRAG_BUFFERED);await flush();
 recovering.finishPlayback();await recovering.pending;assert.equal(recovering.playCalls.length,1);recovering.transport.stop();
 console.log('PASS: live initial-seek ordering, strict HLS error check, irrelevant buffer events, cancellation, unchanged startup deadline, fatal/recovery semantics and observer cleanup.');
}finally{if(previousSelf===undefined)delete globalThis.self;else globalThis.self=previousSelf}
