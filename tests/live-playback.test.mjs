import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function liveFamily'),html.indexOf('document.getElementById("playBtn").addEventListener'));
const original={stream_id:1,name:'DEPORTES - Espn 1 CHI (TV)(1080)',_server:'one'},low={stream_id:2,name:'DEPORTES - Espn 1 CHI (e)(720)',_server:'one'};
const requested=[],played=[],status={textContent:''};let released=0;
const context={allLive:[original,low,{stream_id:3,name:'DEPORTES - Espn 1 ARG (TV)(720)',_server:'one'},{stream_id:4,name:low.name,_server:'two'},{stream_id:5,name:'DEPORTES - Espn 2 CHI (720)',_server:'one'}],currentPlay:{type:'live',item:original},detail:{classList:{contains:()=>true}},document:{getElementById:()=>status},favKey:x=>x._server+':'+x.stream_id,sourceName:()=> 'CCF',releasePlayback:async()=>{released++},stopPlayback:()=>{},api:async(op,b)=>{requested.push(b.id);return{url:String(b.id),lease_id:String(b.id)}},startPlayback:async(url)=>{played.push(url);if(url==='1')throw Error('load_timeout')},Date,Error};
vm.createContext(context);vm.runInContext(source,context);
assert.deepEqual(Array.from(context.liveAlternatives(original),x=>x.stream_id),[1,2]);
await context.playLiveSelection(original);
assert.deepEqual(requested,[1,2]);assert.deepEqual(played,['1','2']);assert.equal(context.currentPlay.liveActual,low);assert.ok(released>=3);
// A new selection while an API call is pending must release the old lease,
// without starting the obsolete video.
context.api=async()=>{context.currentPlay={type:'live',item:low};return{url:'obsolete',lease_id:'old'}};
context.currentPlay={type:'live',item:low};const before=played.length;
await context.playLiveSelection(low);assert.equal(played.length,before);
assert.ok(html.includes('!Hls.isSupported()&&player.canPlayType'));
console.log('PASS: same-channel quality fallback, country/server isolation, lease release, obsolete request cancellation, HLS-first selection.');
