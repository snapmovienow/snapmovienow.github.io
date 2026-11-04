import test from 'node:test';
import assert from 'node:assert/strict';
import {probeLocalChannel} from '../src/local-channel-probe.mjs';
const url=id=>'https://api.snaptvnow.com/exclusive-media?t='+id;
const playlist=text=>new Response(text,{headers:{'content-type':'application/vnd.apple.mpegurl'}});
const media=()=>new Response(new Uint8Array(1024).fill(71),{headers:{'content-type':'video/MP2T'}});
const config=request=>{let released=0;return {deps:{authenticate:async()=>({sid:'owner-canary-fixture'}),prepare:async()=>({url:url('master')}),request,release:async()=>{released++;}},released:()=>released};};
test('signed playback reads normal live edge, current map and separate audio; always releases canary',async()=>{
 const seen=[],fixture=config(async request=>{
  const id=new URL(request.url).searchParams.get('t');seen.push(id);
  if(id==='master')return playlist('#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="'+url('audio')+'"\n#EXT-X-STREAM-INF:BANDWIDTH=100,AUDIO="a"\n'+url('video'));
  if(id==='video')return playlist('#EXTM3U\n#EXT-X-MAP:URI="'+url('oldmap')+'"\n#EXTINF:6,\n'+url('expired-ad')+'\n#EXT-X-MAP:URI="'+url('currentmap')+'"\n#EXTINF:6,\n'+url('edge')+'\n#EXTINF:6,\n'+url('later1')+'\n#EXTINF:6,\n'+url('later2'));
  if(id==='audio')return playlist('#EXTM3U\n#EXTINF:6,\n'+url('audio-bytes'));
  assert.ok(['currentmap','edge','audio-bytes'].includes(id),'expired window entries must not be requested');assert.equal(request.headers.get('range'),'bytes=0-65535');return media();
 });
 const result=await probeLocalChannel({id:'local-fixture'},{signal:new AbortController().signal},fixture.deps);
 assert.equal(result.ok,true);assert.equal(result.check,'signed_playlist_and_segment');assert.equal(fixture.released(),1);assert.deepEqual(seen,['master','video','currentmap','edge','audio','audio-bytes']);
});
test('a foreign signed-resource destination cannot be fetched',async()=>{
 let calls=0;const fixture=config(async()=>{calls++;return playlist('#EXTM3U\n#EXTINF:6,\nhttps://foreign.invalid/secret');});
 const result=await probeLocalChannel({}, {signal:new AbortController().signal},fixture.deps);assert.equal(result.ok,false);assert.equal(result.reason,'route_scope');assert.equal(calls,1);assert.equal(fixture.released(),1);
});
test('HTTP200 HTML and empty media fail instead of declaring the channel online',async()=>{
 for(const response of [()=>new Response('<html>error</html>',{headers:{'content-type':'text/html'}}),()=>new Response(null,{headers:{'content-type':'video/MP2T'}})]){
  const fixture=config(async()=>response()),result=await probeLocalChannel({}, {signal:new AbortController().signal},fixture.deps);assert.equal(result.ok,false);assert.ok(['media_not_video','media_empty'].includes(result.reason));assert.equal(fixture.released(),1);
 }
});
test('test-account capacity and cancellation are bounded, redacted failures',async()=>{
 const fixture=config(async()=>new Response('PRIVATE fixture-token',{status:409})),result=await probeLocalChannel({}, {signal:new AbortController().signal},fixture.deps);assert.equal(result.reason,'test_account_busy');assert.equal(JSON.stringify(result).includes('PRIVATE'),false);assert.equal(fixture.released(),1);
 const signal=AbortSignal.abort(),cancelled=config(()=>{throw Error('must not fetch');});assert.equal((await probeLocalChannel({}, {signal},cancelled.deps)).reason,'verification_timeout');assert.equal(cancelled.released(),1);
});
