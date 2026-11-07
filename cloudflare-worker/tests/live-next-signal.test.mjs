import assert from 'node:assert/strict';
import {confirmNextLiveSignal} from '../src/live-next-signal.mjs';
const origin='https://api.snaptvnow.com',request=new Request(origin+'/live/viewer/password/1.m3u8');
const url=id=>origin+'/stream?t='+id;
const playlist=body=>new Response(body,{headers:{'content-type':'application/vnd.apple.mpegurl'}});
const media=()=>new Response(new Uint8Array(188).fill(71));
let opened=[];
await confirmNextLiveSignal(playlist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800\n'+url('variant')),{request,origin,deadline:Date.now()+500,open:async(req,target)=>{
 opened.push(target.searchParams.get('t'));
 if(target.searchParams.get('t')==='variant')return playlist('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="'+url('key')+'"\n#EXT-X-MAP:URI="'+url('map')+'"\n#EXTINF:4,\n'+url('segment'));
 assert.equal(req.headers.get('range'),'bytes=0-2047');return media();
}});
assert.deepEqual(opened,['variant','key','map','segment']);
for(const kind of ['missing','empty','silent']){
 let cancelled=false;const deadline=Date.now()+30;
 await assert.rejects(confirmNextLiveSignal(playlist('#EXTM3U\n#EXTINF:4,\n'+url('dead')),{request,origin,deadline,open:async()=>kind==='missing'?new Response(null,{status:404}):kind==='empty'?new Response(new Uint8Array(4)):new Response(new ReadableStream({cancel(){cancelled=true}}))}),kind==='missing'?error=>error.status===404:kind==='empty'?/media_empty/:/live_startup_timeout/);
 if(kind==='silent')assert.equal(cancelled,true);
}
let unsafeOpened=false;
await assert.rejects(confirmNextLiveSignal(playlist('#EXTM3U\n#EXTINF:4,\nhttps://untrusted.invalid/segment'),{request,origin,deadline:Date.now()+100,open:async()=>{unsafeOpened=true;return media();}}),/invalid_playlist/);assert.equal(unsafeOpened,false);
const abort=new AbortController();abort.abort();await assert.rejects(confirmNextLiveSignal(playlist('#EXTM3U'),{request:new Request(request,{signal:abort.signal}),origin,deadline:Date.now()+100,open:async()=>media()}),/playback_superseded/);
console.log('PASS: candidate HLS requires segment/key/map bytes; 404, short/silent bodies, foreign URLs and cancellation fail closed.');
