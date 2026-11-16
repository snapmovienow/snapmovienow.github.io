import test from 'node:test';
import assert from 'node:assert/strict';
import {privateMediaAllowed,verifyPrivateLiveMedia} from './private-media-proof.mjs';
const base='https://fixture.dmcdn.net/live/',metadata={qualities:{auto:[{type:'application/x-mpegURL',url:base+'master.m3u8?sig=a%2Fb'}]}};
const ts=()=>{const bytes=new Uint8Array(188*4);for(let i=0;i<bytes.length;i+=188)bytes[i]=71;return bytes};
const playlist=(extra='')=>'#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:42\n'+extra+'#EXTINF:6,\na.ts?sig=a%2Fb\n#EXTINF:6,\nb.ts\n';
const fixture=(text=playlist())=>async(url,options)=>{
  assert.equal(options.redirect,'manual');assert.equal(new Headers(options.headers).get('authorization'),null);
  return new URL(url).pathname.endsWith('.m3u8')?new Response(text):new Response(ts());
};
test('private scope preserves signed queries but rejects foreign hosts, credentials, ports, fragments and raw traversal',()=>{
  assert.equal(privateMediaAllowed(base+'master.m3u8?sig=a%2Fb%2E%5C'),true);
  for(const url of ['https://dmcdn.net.evil.test/a.m3u8','http://fixture.dmcdn.net/a','https://u:p@fixture.dmcdn.net/a','https://fixture.dmcdn.net:444/a',base+'a#x',base+'../a',base+'%2e%2e/a',base+'%252f/a'])assert.equal(privateMediaAllowed(url),false,url);
});
test('live proof chooses lowest bandwidth, reads two TS segments and leaks no URL or signature',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push(url);assert.equal(options.redirect,'manual');
    if(new URL(url).pathname.endsWith('master.m3u8'))return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=2000000\nhigh.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=300000\nlow.m3u8?sig=a%2Fb\n');
    if(new URL(url).pathname.endsWith('.m3u8'))return new Response(playlist());
    assert.equal(new Headers(options.headers).get('range'),'bytes=0-32767');return new Response(ts());
  };
  const result=await verifyPrivateLiveMedia(metadata,fetcher);
  assert.equal(result.liveMediaVerified,true);assert.equal(result.mediaSequence,42);assert.equal(result.targetDuration,6);
  assert.equal(result.segmentsChecked,2);assert.equal(result.segmentFormat,'mpegts');assert.equal(result.videoBytesVerified,1504);
  assert.ok(calls.some(url=>url.includes('low.m3u8?sig=a%2Fb'))&&!calls.some(url=>url.includes('high.m3u8')));
  assert.ok(!JSON.stringify(result).includes('dmcdn')&&!JSON.stringify(result).includes('sig='));
});
test('ended playlists and HTML segment bodies never produce a verified live signal',async()=>{
  const ended=await verifyPrivateLiveMedia(metadata,fixture(playlist('#EXT-X-ENDLIST\n')));
  assert.equal(ended.liveMediaVerified,false);assert.equal(ended.ended,true);assert.equal(ended.errorCode,'STREAM_ENDED');
  const html=await verifyPrivateLiveMedia(metadata,async url=>new URL(url).pathname.endsWith('.m3u8')?new Response(playlist()):new Response('<html>not media</html>'));
  assert.equal(html.liveMediaVerified,false);assert.equal(html.errorCode,'INVALID_MEDIA');
});
test('foreign redirects and relative traversal stop before fetching the invalid destination',async()=>{
  let calls=0;
  const redirected=await verifyPrivateLiveMedia(metadata,async()=>{calls++;return new Response(null,{status:302,headers:{Location:'https://other.test/a'}})});
  assert.equal(redirected.errorCode,'SOURCE_SCOPE');assert.equal(calls,1);
  const escaped=await verifyPrivateLiveMedia(metadata,fixture(playlist().replace('a.ts?sig=a%2Fb','../a.ts')));
  assert.equal(escaped.errorCode,'SOURCE_SCOPE');assert.equal(escaped.segmentsChecked,0);
});
test('allowed redirects are followed at most twice and keep scope',async()=>{
  let calls=0;const result=await verifyPrivateLiveMedia(metadata,async()=>{calls++;return new Response(null,{status:302,headers:{Location:'/live/next.m3u8'}})});
  assert.equal(result.errorCode,'REDIRECT_LIMIT');assert.equal(calls,3);
});
test('AES128 identity keys are checked only for 16 bytes without decrypting or fetching encrypted segments',async()=>{
  const calls=[];const encrypted=playlist('#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n');
  const result=await verifyPrivateLiveMedia(metadata,async url=>{calls.push(url);return new URL(url).pathname.endsWith('.m3u8')?new Response(encrypted):new Response(new Uint8Array(16))});
  assert.equal(result.unsupportedEncryption,true);assert.equal(result.keyBytesVerified,16);assert.equal(result.liveMediaVerified,false);
  assert.equal(result.errorCode,'UNSUPPORTED_ENCRYPTION');assert.equal(result.segmentsChecked,0);assert.equal(calls.length,2);
  const drm=await verifyPrivateLiveMedia(metadata,fixture(playlist('#EXT-X-KEY:METHOD=SAMPLE-AES,KEYFORMAT="com.example.drm",URI="key.bin"\n')));
  assert.equal(drm.keyBytesVerified,0);assert.equal(drm.errorCode,'UNSUPPORTED_ENCRYPTION');
});
test('master session keys are not dropped when resolving a child playlist',async()=>{
  const calls=[];const result=await verifyPrivateLiveMedia(metadata,async url=>{
    calls.push(url);
    if(new URL(url).pathname.endsWith('master.m3u8'))return new Response('#EXTM3U\n#EXT-X-SESSION-KEY:METHOD=AES-128,URI="root.key"\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nchild/media.m3u8\n');
    return new URL(url).pathname.endsWith('.m3u8')?new Response(playlist()):new Response(new Uint8Array(16));
  });
  assert.equal(result.errorCode,'UNSUPPORTED_ENCRYPTION');assert.equal(result.keyBytesVerified,16);
  assert.equal(calls.at(-1),base+'root.key');
});
test('fMP4 init and segment prefixes are sampled and streaming bodies cancelled at 32 KiB',async()=>{
  let cancelled=0;const bytes=new Uint8Array(50000);bytes.set(new TextEncoder().encode('ftyp'),4);
  const result=await verifyPrivateLiveMedia(metadata,async url=>{
    if(new URL(url).pathname.endsWith('.m3u8'))return new Response(playlist('#EXT-X-MAP:URI="init.mp4"\n'));
    let sent=false;return new Response(new ReadableStream({pull(controller){if(!sent){controller.enqueue(bytes);sent=true}},cancel(){cancelled++}}));
  });
  assert.equal(result.liveMediaVerified,true);assert.equal(result.segmentFormat,'fmp4');
  assert.equal(result.initBytesVerified,32768);assert.equal(result.videoBytesVerified,65536);assert.equal(cancelled,3);
});
test('upstream messages are suppressed and caller abort ends a stalled stream',async()=>{
  const failed=await verifyPrivateLiveMedia(metadata,async()=>{throw Error('private-account-password')});
  assert.equal(failed.errorCode,'UPSTREAM_FAILED');assert.ok(!JSON.stringify(failed).includes('password'));
  const forged=await verifyPrivateLiveMedia(metadata,async()=>{throw {proofCode:'private-account-password'}});
  assert.equal(forged.errorCode,'UPSTREAM_FAILED');assert.ok(!JSON.stringify(forged).includes('password'));
  let cancelled=false;const controller=new AbortController();
  const pending=verifyPrivateLiveMedia(metadata,async()=>new Response(new ReadableStream({cancel(){cancelled=true}})),{signal:controller.signal});
  setTimeout(()=>controller.abort(),5);const result=await pending;
  assert.equal(result.errorCode,'ABORTED');assert.equal(cancelled,true);
  let opened=false;const aborted=new AbortController();aborted.abort();
  const stopped=await verifyPrivateLiveMedia(metadata,async()=>{opened=true},{signal:aborted.signal});
  assert.equal(stopped.errorCode,'ABORTED');assert.equal(opened,false);
});
