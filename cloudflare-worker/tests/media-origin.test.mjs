import assert from 'node:assert/strict';
import {CCF_MEDIA_ORIGIN} from '../src/ip-media.mjs';
import {fetchValidatedMedia,validatedMediaTarget} from '../src/media-origin.mjs';

const start=CCF_MEDIA_ORIGIN+'/live/fixture/fixture/9516.m3u8';
const initial=Date.now();let now=initial;
const hosts=['89.44.33.22','11.22.33.44','45.90.28.10'];
let redirectsClosed=0;const requests=[];
const redirect=location=>new Response(new ReadableStream({cancel(){redirectsClosed++}}),{status:302,headers:{location}});
const mock={
 async fetchHost(url,options,timeout){
  assert.equal(url,start);assert.equal(options.redirect,'manual');assert.equal(timeout,12000);
  const host=hosts[Math.floor((now-initial)/43200000)];
  return redirect('http://'+host+':8080/signed/master.m3u8');
 },
 async fetchIP(url,headers,_connect,_stream,source){
  assert.equal(source,CCF_MEDIA_ORIGIN);
  requests.push({url,range:headers.get('range'),validator:headers.get('if-range')});
  if(url.endsWith('master.m3u8'))return new Response('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:6,\nsegment.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
  return new Response('fixture-bytes');
 }
};
// Provider media nodes can rotate independently of the authenticated account.
// Advance a controlled clock; this is a regression, not a real 24-hour soak.
for(const hours of [0,12,24]){
 now=initial+hours*3600000;
 const fetched=await fetchValidatedMedia(start,new Headers(),'live',CCF_MEDIA_ORIGIN,mock);
 const expected=hosts[hours/12];assert.equal(new URL(fetched.url).hostname,expected);
 assert.match(await fetched.response.text(),/^#EXTM3U/);
 for(const resource of ['segment.ts','key']){
  const target=validatedMediaTarget(new URL(resource,fetched.url),CCF_MEDIA_ORIGIN);
  const headers=new Headers({range:'bytes=16-29','if-range':'"fixture-etag"'});
  const result=await fetchValidatedMedia(target.href,headers,'live',CCF_MEDIA_ORIGIN,mock);
  assert.equal(await result.response.text(),'fixture-bytes');
  assert.equal(requests.at(-1).range,'bytes=16-29');assert.equal(requests.at(-1).validator,'"fixture-etag"');
 }
}
assert.equal(redirectsClosed,3);

// A client header/query must not grant a different provider CCF provenance.
let opened=0;
const rejectMock={fetchHost:async()=>redirect('http://89.44.33.22/segment.ts'),fetchIP:async()=>{opened++;throw Error('unexpected_socket')}};
await assert.rejects(fetchValidatedMedia('https://other.example/live.m3u8?sourceOrigin='+encodeURIComponent(CCF_MEDIA_ORIGIN),new Headers({'X-Source-Origin':CCF_MEDIA_ORIGIN}),'live','https://other.example',rejectMock),/media_origin_unapproved/);
assert.equal(opened,0);

const denied=['127.0.0.1','2130706433','0x7f000001','0177.0.0.1','10.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','100.64.0.1','192.0.2.1','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','255.255.255.255','[::1]','[::ffff:127.0.0.1]'];
for(const host of denied){
 await assert.rejects(fetchValidatedMedia(start,new Headers(),'live',CCF_MEDIA_ORIGIN,{...rejectMock,fetchHost:async()=>redirect('http://'+host+'/segment.ts')}),/media_origin_unapproved/);
 assert.throws(()=>validatedMediaTarget('http://'+host+'/key',CCF_MEDIA_ORIGIN),/media_origin_unapproved/);
}
for(const target of ['http://user:password@89.44.33.22/','http://89.44.33.22:25/','https://89.44.33.22/'])assert.throws(()=>validatedMediaTarget(target,CCF_MEDIA_ORIGIN),/media_origin_unapproved/);
assert.equal(opened,0);

// Validate subsequent hops too, and close redirected bodies before rejecting.
let intermediateClosed=0;
await assert.rejects(fetchValidatedMedia(start,new Headers(),'live',CCF_MEDIA_ORIGIN,{
 fetchHost:async()=>redirect('http://89.44.33.22/first'),
 fetchIP:async()=>new Response(new ReadableStream({cancel(){intermediateClosed++}}),{status:302,headers:{location:'http://10.0.0.1/blocked'}})
}),/media_origin_unapproved/);
assert.equal(intermediateClosed,1);
let loops=0;
await assert.rejects(fetchValidatedMedia(start,new Headers(),'live',CCF_MEDIA_ORIGIN,{fetchHost:async()=>{loops++;return redirect(start)}}),/invalid_redirect/);
assert.equal(loops,6);
assert.equal(validatedMediaTarget('http://194.76.0.119:8080/stream',CCF_MEDIA_ORIGIN).hostname,'media.snaptvnow.com');
assert.throws(()=>validatedMediaTarget('http://194.76.0.119:8080/stream','https://other.example'),/media_origin_unapproved/);
console.log('PASS: trusted provider rotation at 0/12/24 hours, HLS segments/keys, Range provenance, all-hop private IP rejection, forged provenance rejection and redirect cleanup.');
