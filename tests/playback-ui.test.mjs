import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const stop=html.slice(html.indexOf('function stopPlayback('),html.indexOf('let hlsLoading;'));
const calls=[];
const movie={style:{},pause(){calls.push('movie-pause');throw Error('player failure')}};
const live={style:{},pause(){calls.push('live-pause');throw Error('player failure')},removeAttribute(){calls.push('remove-source')},load(){calls.push('stop-loading')}};
const ctx=vm.createContext({liveRequest:0,releasePlayback(){calls.push('release')},liveDiagnosticHistory:[],liveDiagnostics:{report(){calls.push('capture');return {reason:'timeline_stall'}},stop(){calls.push('diagnostic-stop');throw Error('observer failure')}},stopLiveWatchdog(){calls.push('watchdog')},hlsEngine:{destroy(){calls.push('destroy');throw Error('engine failure')}},moviePlayer:movie,gnulaPlayer:live});
vm.runInContext(stop,ctx);ctx.stopPlayback();
assert.deepEqual(calls,['release','capture','diagnostic-stop','watchdog','destroy','movie-pause','live-pause','remove-source','stop-loading']);
assert.equal(ctx.liveDiagnostics,null);assert.equal(ctx.liveDiagnosticHistory[0].reason,'timeline_stall');
assert.equal(movie.src,null);assert.equal(ctx.hlsEngine,null);assert.equal(ctx.stopLiveWatchdog,null);
assert.equal(movie.style.display,'none');assert.equal(live.style.display,'none');

// Run the actual async setup while the HLS script is delayed, then close it.
let finishLibrary,valid=true,played=0,engines=0;
const library=new Promise(resolve=>finishLibrary=resolve);
const attempt={controller:new AbortController()};
const video={style:{},canPlayType(){return ''},play(){played++;return Promise.resolve()}};
const setup=vm.createContext({assertPlaybackAttempt(){if(!valid)throw Error('playback_superseded')},authenticated:true,authGeneration:1,currentPlay:{type:'live',item:{}},stopPlayback(){},gnulaPlayer:video,player:null,ensureHls:()=>library,Hls:class{static isSupported(){return true}constructor(){engines++}},setTimeout,clearTimeout});
vm.runInContext(html.slice(html.indexOf('async function startPlayback('),html.indexOf('for(const event of ["loadedmetadata"')),setup);
const pending=setup.startPlayback('https://example.test/live.m3u8',0,'lease',attempt);
valid=false;attempt.controller.abort();finishLibrary();
await assert.rejects(pending,/playback_superseded/);
assert.equal(played,0);assert.equal(engines,0,'a late library load must not recreate the closed player');
console.log('PASS: teardown survives player errors and late HLS setup cannot resume closed playback.');

// A heartbeat belonging to an older channel must not close its replacement.
let tick,rejectHeartbeat,stops=0,logouts=0;
const oldAttempt={},nextAttempt={};
const heartbeat=vm.createContext({authenticated:true,heartbeatBusy:false,playbackLease:'old-lease',creds:{},playbackLifecycle:{current:oldAttempt},setInterval(fn){tick=fn},api:()=>new Promise((_,reject)=>rejectHeartbeat=reject),stopPlayback(){stops++},logout(){logouts++},document:{getElementById:()=>({textContent:''})}});
vm.runInContext(html.slice(html.indexOf('setInterval(async()=>{if(!authenticated||heartbeatBusy)'),html.indexOf('window.addEventListener("pagehide"')),heartbeat);
const checking=tick();heartbeat.playbackLifecycle.current=nextAttempt;heartbeat.playbackLease='new-lease';rejectHeartbeat({status:410});await checking;
assert.equal(stops,0);assert.equal(logouts,0);
heartbeat.playbackLifecycle.current=null;heartbeat.playbackLease=null;heartbeat.api=async()=>{throw {status:401}};
await tick();assert.equal(stops,1);assert.equal(logouts,1,'idle authenticated users still receive access revocation');
console.log('PASS: old heartbeat cannot close a new channel; idle access revocation is preserved.');

// Feature detection preserves playback on devices lacking streaming Fetch APIs.
{
 const code=html.slice(html.indexOf('function supportsProgressiveLive'),html.indexOf('function ensureHls'));
 const modern=vm.createContext({fetch(){},AbortController,ReadableStream,Request});vm.runInContext(code,modern);assert.equal(modern.supportsProgressiveLive(),true);
 const legacy=vm.createContext({fetch(){},AbortController,Request});vm.runInContext(code,legacy);assert.equal(legacy.supportsProgressiveLive(),false);
}
console.log('PASS: progressive live streaming feature detection preserves legacy loading.');
