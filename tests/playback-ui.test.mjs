import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=(readFileSync(new URL('../index.html',import.meta.url),'utf8')+'\n'+readFileSync(new URL('../app.js',import.meta.url),'utf8'));
const calls=[];
const movie={style:{},pause(){calls.push('movie-pause');throw Error('player failure')}};
const live={style:{},pause(){calls.push('live-pause');throw Error('player failure')},removeAttribute(){calls.push('remove-source')},load(){calls.push('stop-loading')},canPlayType(){return ''},play(){calls.push('play');return Promise.resolve()}};
const runtime=vm.createContext({AbortController,setTimeout,clearTimeout,watchLivePlayback(){return()=>calls.push('watchdog')},recoverLivePlayback(){}});
vm.runInContext(readFileSync(new URL('../playback-transport.js',import.meta.url),'utf8'),runtime);
const create=runtime.SMNPlaybackTransport.create;
const Events={FRAG_LOADED:'fragment',ERROR:'error',MANIFEST_PARSED:'ready',AUDIO_TRACKS_UPDATED:'audio',SUBTITLE_TRACKS_UPDATED:'subtitle'};
let latest;
class Engine {
 static Events=Events;static ErrorTypes={NETWORK_ERROR:'network',MEDIA_ERROR:'media'};static isSupported(){return true}
 constructor(options){this.options=options;this.listeners=new Map();latest=this}
 on(event,fn){const list=this.listeners.get(event)||[];list.push(fn);this.listeners.set(event,list)}
 off(event,fn){this.listeners.set(event,(this.listeners.get(event)||[]).filter(x=>x!==fn))}
 emit(event,data={}){for(const fn of [...this.listeners.get(event)||[]])fn(event,data)}
 loadSource(url){this.url=url}
 attachMedia(){this.emit(Events.MANIFEST_PARSED)}
 destroy(){calls.push('destroy');throw Error('engine failure')}
}
const transport=create({moviePlayer:movie,hlsPlayer:live,assertAttempt(){},loadHls:async()=>Engine});
await transport.start({url:'https://example.test/live.m3u8',external:true,type:'live',attempt:{controller:new AbortController()}});calls.length=0;
const ctx=vm.createContext({playbackMetrics:null,liveRequest:0,releasePlayback(){calls.push('release')},liveDiagnosticHistory:[],liveDiagnostics:{report(){calls.push('capture');return {reason:'timeline_stall'}},stop(){calls.push('diagnostic-stop');throw Error('observer failure')}},mediaTransport:transport});
vm.runInContext(html.slice(html.indexOf('function stopPlayback('),html.indexOf('function retryLivePlayback(')),ctx);ctx.stopPlayback();
assert.deepEqual(calls,['release','capture','diagnostic-stop','watchdog','destroy','movie-pause','live-pause','remove-source','stop-loading']);
assert.equal(ctx.liveDiagnostics,null);assert.equal(ctx.liveDiagnosticHistory[0].reason,'timeline_stall');
assert.equal(movie.src,null);assert.equal(transport.engine,null);
assert.equal(movie.style.display,'none');assert.equal(live.style.display,'none');

// Closing playback while a media library loads must not recreate the player.
for(const external of [true,false]){
 let finishLibrary,played=0,engines=0;
 const library=new Promise(resolve=>finishLibrary=resolve);
 const video={style:{},pause(){},removeAttribute(){},load(){},canPlayType(){return ''},setAttribute(){},play(){played++;return Promise.resolve()}};
 class LateEngine extends Engine{constructor(config){super(config);engines++}}
 const delayed=create({moviePlayer:video,hlsPlayer:video,assertAttempt(){},loadHls:()=>library,loadMoviePlayer:()=>library,whenMovieDefined:async()=>{}});
 const pending=delayed.start({url:'https://example.test/video',external,type:'movie',attempt:{controller:new AbortController()}});
 delayed.stop();finishLibrary(LateEngine);
 await assert.rejects(pending,/playback_superseded/);assert.equal(played,0);assert.equal(engines,0);
}
// Cancellation during manifest loading settles immediately and removes only
// the temporary ready/error handlers, leaving the engine's recovery observers.
{
 let constructed;const ready=new Promise(resolve=>constructed=resolve);
 class WaitingEngine extends Engine{constructor(config){super(config);constructed(this)}attachMedia(){}}
 const controller=new AbortController();
 const waiting=create({moviePlayer:movie,hlsPlayer:live,assertAttempt(){},loadHls:async()=>WaitingEngine});
 const pending=waiting.start({url:'https://example.test/wait.m3u8',external:true,type:'live',attempt:{controller}});
 const engine=await ready;assert.ok(engine);
 waiting.stop();await assert.rejects(pending,/playback_superseded/);
 assert.equal(engine.listeners.get(Events.MANIFEST_PARSED).length,0);
 assert.equal(engine.listeners.get(Events.ERROR).length,2);
}
// Resume metadata reaches the movie engine and native HLS stays available on
// devices without Media Source Extensions. Neither path creates an HLS engine.
{
 const attrs={},video={style:{},setAttribute:(key,value)=>attrs[key]=value,play:async()=>{},canPlayType:()=> 'maybe'};
 const native=create({moviePlayer:video,hlsPlayer:video,assertAttempt(){},loadMoviePlayer:async()=>{},whenMovieDefined:async()=>{},loadHls:async()=>({isSupported:()=>false})});
 await native.start({url:'https://example.test/movie.mp4',resumeAt:47,type:'movie',attempt:{controller:new AbortController()}});
 assert.equal(attrs.startat,'47');assert.equal(video.src,'https://example.test/movie.mp4');
 await native.start({url:'https://example.test/native.m3u8',external:true,type:'movie',attempt:{controller:new AbortController()}});
 assert.equal(video.src,'https://example.test/native.m3u8');assert.equal(native.engine,null);
}
console.log('PASS: actual media transport teardown, delayed HLS/movie setup cancellation, manifest observer cleanup, resume and native HLS.');

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

// The audio regression uses these exact production options, from the module.
for(const type of ['live','movie']){
 const options=runtime.SMNPlaybackTransport.hlsOptions(type);
 assert.equal(options.progressive,false);assert.equal(options.fragLoadPolicy.default.maxLoadTimeMs,type==='live'?90000:15000);
}
console.log('PASS: complete-segment HLS parsing preserves live and VOD load deadlines.');
