import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=(fs.readFileSync(new URL('../index.html',import.meta.url),'utf8')+'\n'+fs.readFileSync(new URL('../app.js',import.meta.url),'utf8'));
const source=html.slice(html.indexOf('function liveFamily'),html.indexOf('document.getElementById("playBtn").addEventListener'));
const original={stream_id:1,name:'DEPORTES - Espn 1 CHI (TV)(1080)',_server:'one'},low={stream_id:2,name:'DEPORTES - Espn 1 CHI (e)(720)',_server:'one'};
const requested=[],played=[],status={textContent:''};let released=0;
const context={allLive:[original,low,{stream_id:3,name:'DEPORTES - Espn 1 ARG (TV)(720)',_server:'one'},{stream_id:4,name:low.name,_server:'two'},{stream_id:5,name:'DEPORTES - Espn 2 CHI (720)',_server:'one'}],currentPlay:{type:'live',item:original},detail:{classList:{contains:()=>true}},document:{getElementById:()=>status},favKey:x=>x._server+':'+x.stream_id,sourceName:()=> 'CCF',releasePlayback:async()=>{released++},stopPlayback:()=>{},api:async(op,b)=>{requested.push(b.id);return{url:String(b.id),lease_id:String(b.id)}},startPlayback:async(url)=>{played.push(url);if(url==='1')throw Error('load_timeout')},Date,Error};
context.AbortController=AbortController;context.crypto=crypto;context.creds={access_token:'test-only'};
vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('../playback-lifecycle.js',import.meta.url),'utf8'),context);context.playbackLifecycle=context.createPlaybackLifecycle({cancel:async()=>{released++}});vm.runInContext(source,context);
assert.deepEqual(Array.from(context.liveAlternatives(original),x=>x.stream_id),[1,2]);
await context.playLiveSelection(original);
assert.deepEqual(requested,[1,2]);assert.deepEqual(played,['1','2']);assert.equal(context.currentPlay.liveActual,low);assert.ok(released>=3);
// A new selection while an API call is pending must release the old lease,
// without starting the obsolete video.
context.api=async()=>{context.currentPlay={type:'live',item:low};return{url:'obsolete',lease_id:'old'}};
context.currentPlay={type:'live',item:low};const before=played.length;
await context.playLiveSelection(low);assert.equal(played.length,before);
assert.ok(fs.readFileSync(new URL('../playback-transport.js',import.meta.url),'utf8').includes("!Hls.isSupported()&&video.canPlayType"));
console.log('PASS: same-channel quality fallback, country/server isolation, lease release, obsolete request cancellation, HLS-first selection.');

// A terminal404 on one quality must not suppress the independent fallback.
for(const allMissing of [false,true]){
 const attempts=[];const fixture={...context,currentPlay:{type:'live',item:original},api:async(op,b)=>{attempts.push(b.id);return{url:String(b.id),lease_id:String(b.id)}},startPlayback:async(url)=>{if(url==='1'||allMissing)throw Object.assign(Error('media_not_found'),{status:404})}};
 vm.createContext(fixture);vm.runInContext(fs.readFileSync(new URL('../playback-lifecycle.js',import.meta.url),'utf8'),fixture);fixture.playbackLifecycle=fixture.createPlaybackLifecycle({cancel:async()=>{}});vm.runInContext(source,fixture);
 if(allMissing)await assert.rejects(fixture.playLiveSelection(original),e=>e.status===404&&e.message==='media_not_found');else await fixture.playLiveSelection(original);
 assert.deepEqual(attempts,[1,2]);if(!allMissing)assert.equal(fixture.currentPlay.liveActual,low);
}
console.log('PASS:404 alternative succeeds; all404 preserves status; each candidate attempted once.');
