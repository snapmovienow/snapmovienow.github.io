import assert from 'node:assert/strict';import {test} from 'node:test';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../playback-transport.js',import.meta.url),'utf8');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const drain=async()=>{for(let i=0;i<20;i++)await Promise.resolve()};
function setup(mode){
 const pending=deferred(),calls={play:0,defined:0,loaded:0},timers=new Set(),listeners=[];
 class TrackedController extends AbortController{constructor(){super();const active=new Set(),add=this.signal.addEventListener.bind(this.signal),remove=this.signal.removeEventListener.bind(this.signal);listeners.push(active);this.signal.addEventListener=(n,f,o)=>{if(n==='abort')active.add(f);return add(n,f,o)};this.signal.removeEventListener=(n,f)=>{if(n==='abort')active.delete(f);return remove(n,f)}}}
 const video=()=>({style:{},pause(){},load(){},removeAttribute(){},setAttribute(){},play(){calls.play++;return Promise.resolve()},canPlayType(){return true}});
 const ctx=vm.createContext({AbortController:TrackedController,Promise,Error,setTimeout:f=>{timers.add(f);return f},clearTimeout:f=>timers.delete(f)});vm.runInContext(source,ctx);
 const hls=video(),movie=video(),attempt={controller:new TrackedController()};
 const options={moviePlayer:movie,hlsPlayer:hls,assertAttempt:a=>{if(a.controller.signal.aborted)throw Error('playback_superseded')},loadHls:()=>pending.promise,loadMoviePlayer:()=>{calls.loaded++;return mode==='movie'?pending.promise:Promise.resolve()},whenMovieDefined:()=>{calls.defined++;return mode==='defined'?pending.promise:Promise.resolve()}};
 const transport=ctx.SMNPlaybackTransport.create(options);let state='pending',error;
 const start=transport.start({url:'https://fixture.invalid/media',external:mode==='hls',type:'movie',attempt}).then(()=>{state='resolved'},e=>{state='rejected';error=e});
 return {pending,calls,timers,listeners,transport,attempt,start,get state(){return state},get error(){return error}};
}
for(const mode of ['hls','movie','defined'])for(const action of ['stop','abort'])test(`${mode} pending initialization rejects promptly on ${action}`,async()=>{const x=setup(mode);await drain();action==='stop'?x.transport.stop():x.attempt.controller.abort();await drain();assert.equal(x.state,'rejected');assert.equal(x.error.message,'playback_superseded');assert.equal(x.calls.play,0);assert.equal(x.timers.size,0);assert.ok(x.listeners.every(s=>s.size===0));x.pending.resolve({isSupported:()=>false});await drain();assert.equal(x.calls.play,0);if(mode==='movie')assert.equal(x.calls.defined,0)});
for(const mode of ['hls','movie','defined'])test(`${mode} late loader rejection after cancellation is handled`,async()=>{const x=setup(mode);await drain();x.transport.stop();await drain();assert.equal(x.state,'rejected');x.pending.reject(Error('late-loader-error'));await drain();assert.equal(x.error.message,'playback_superseded');assert.equal(x.calls.play,0)});
for(const mode of ['hls','movie','defined'])test(`${mode} ordinary initialization and failure preserve behavior`,async()=>{const x=setup(mode);await drain();x.pending.resolve({isSupported:()=>false});await drain();assert.equal(x.state,'resolved');assert.equal(x.calls.play,1);assert.equal(x.timers.size,0);x.transport.stop();const y=setup(mode);await drain();y.pending.reject(Error('loader-failed'));await drain();assert.equal(y.error.message,'loader-failed');assert.equal(y.calls.play,0)});

test('shared late HLS load serves replacement only, old waiter cannot play',async()=>{
 const x=setup('hls');await drain();x.transport.stop();await drain();assert.equal(x.state,'rejected');
 const next={controller:new AbortController()};const running=x.transport.start({url:'https://fixture.invalid/new',external:true,type:'movie',attempt:next});
 x.pending.resolve({isSupported:()=>false});await running;assert.equal(x.calls.play,1);assert.equal(x.state,'rejected');assert.ok(x.listeners.every(s=>s.size===0));x.transport.stop();
});
test('falsy loader rejection is not transformed into success',async()=>{const x=setup('movie');x.pending.reject(null);await drain();assert.equal(x.state,'rejected');assert.equal(x.error,null);assert.equal(x.calls.defined,0);assert.ok(x.listeners.every(s=>s.size===0))});
test('synchronous cancellation inside loader cannot miss abort registration',async()=>{
 const attempt={controller:new AbortController()},ctx=vm.createContext({AbortController,Promise,Error,setTimeout,clearTimeout});vm.runInContext(source,ctx);let defined=0;
 const video={style:{},pause(){},removeAttribute(){},load(){}};
 const player=ctx.SMNPlaybackTransport.create({moviePlayer:video,hlsPlayer:video,assertAttempt(){},loadMoviePlayer(){attempt.controller.abort();return new Promise(()=>{})},whenMovieDefined(){defined++;return Promise.resolve()}});
 let state='pending';player.start({url:'https://fixture.invalid/media',type:'movie',attempt}).then(()=>state='resolved',e=>state=e.message);await drain();assert.equal(state,'playback_superseded');assert.equal(defined,0);player.stop();
});
for(const mode of ['movie','defined'])test(`${mode} cancelled waiter cannot mutate replacement on shared late resolution`,async()=>{const x=setup(mode);await drain();x.transport.stop();await drain();assert.equal(x.state,'rejected');const next={controller:new AbortController()};const running=x.transport.start({url:'https://fixture.invalid/new',type:'movie',attempt:next});x.pending.resolve();await running;assert.equal(x.calls.play,1);assert.ok(x.listeners.every(s=>s.size===0));x.transport.stop()});
test('synchronous loader failure and already-cancelled attempt do not leak listeners or start next stage',async()=>{
 for(const cancelled of [false,true]){
 const ctx=vm.createContext({AbortController,Promise,Error,setTimeout,clearTimeout});vm.runInContext(source,ctx);const attempt={controller:new AbortController()},listeners=new Set(),add=attempt.controller.signal.addEventListener.bind(attempt.controller.signal),remove=attempt.controller.signal.removeEventListener.bind(attempt.controller.signal);attempt.controller.signal.addEventListener=(n,f,o)=>{listeners.add(f);return add(n,f,o)};attempt.controller.signal.removeEventListener=(n,f)=>{listeners.delete(f);return remove(n,f)};if(cancelled)attempt.controller.abort();let calls=0,defined=0;const video={style:{},pause(){},removeAttribute(){},load(){}};
 const player=ctx.SMNPlaybackTransport.create({moviePlayer:video,hlsPlayer:video,assertAttempt(){},loadMoviePlayer(){calls++;throw Error('sync-loader-failed')},whenMovieDefined(){defined++;return Promise.resolve()}});
 await assert.rejects(player.start({url:'https://fixture.invalid/media',type:'movie',attempt}),new RegExp(cancelled?'playback_superseded':'sync-loader-failed'));assert.equal(calls,cancelled?0:1);assert.equal(defined,0);assert.equal(listeners.size,0);player.stop();
 }
});
