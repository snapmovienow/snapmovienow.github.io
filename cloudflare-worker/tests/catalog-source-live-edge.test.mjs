import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCatalogSource} from '../src/catalog-source-check.mjs';

const origin='https://media.snapcdn.net',media={mode:'direct',page:origin+'/master.m3u8'};
const segment=name=>'#EXTINF:6,\n'+name+'.ts\n';
const sixSegments=['expired-ad','one','two','current-ad','four','five'].map(segment).join('');
function fixture(playlist,{html=[]}={}){
 const requests=[];
 const fetcher=async(raw,options)=>{
  const url=new URL(raw);assert.equal(url.origin,origin);assert.equal(options.redirect,'manual');requests.push(url.pathname);
  if(url.pathname==='/master.m3u8')return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nfirst.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2\nunused.m3u8\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
  if(url.pathname==='/first.m3u8')return new Response(playlist,{headers:{'content-type':'application/vnd.apple.mpegurl'}});
  assert.notEqual(url.pathname,'/unused.m3u8','master selection keeps the first rendition');
  return new Response(html.includes(url.pathname)?'<html>expired</html>':new Uint8Array(64),{headers:{'content-type':html.includes(url.pathname)?'text/html':'application/octet-stream'}});
 };
 return {fetcher,requests};
}
test('live inspection uses the normal edge even when the first advertisement has expired',async()=>{
 const value=fixture('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:100\n'+sixSegments,{html:['/expired-ad.ts']});
 assert.deepEqual(await inspectCatalogSource(media,value),{ok:true,check:'playlist_and_segment'});
 assert.deepEqual(value.requests,['/master.m3u8','/first.m3u8','/current-ad.ts'],'the selected live advertisement is fetched; advertisements are not filtered');
});
test('an HTML response at the selected live edge still fails without trying another segment',async()=>{
 const value=fixture('#EXTM3U\n'+sixSegments,{html:['/current-ad.ts']});
 assert.deepEqual(await inspectCatalogSource(media,value),{ok:false,check:'unavailable'});
 assert.deepEqual(value.requests,['/master.m3u8','/first.m3u8','/current-ad.ts']);
});
test('ENDLIST keeps the first segment, including a failing first advertisement',async()=>{
 const value=fixture('#EXTM3U\n'+sixSegments+'#EXT-X-ENDLIST\n',{html:['/expired-ad.ts']});
 assert.equal((await inspectCatalogSource(media,value)).ok,false);
 assert.deepEqual(value.requests,['/master.m3u8','/first.m3u8','/expired-ad.ts']);
 const working=fixture('#EXTM3U\n'+sixSegments+'#EXT-X-ENDLIST\n',{html:['/current-ad.ts']});
 assert.equal((await inspectCatalogSource(media,working)).ok,true);
 assert.deepEqual(working.requests,['/master.m3u8','/first.m3u8','/expired-ad.ts']);
});
test('only the KEY and MAP active before the selected segment are inspected',async()=>{
 const playlist='#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="old-key.bin"\n#EXT-X-MAP:URI="old-init.mp4"\n'+segment('zero')+segment('one')+segment('two')+'#EXT-X-KEY:METHOD=AES-128,URI="current-key.bin"\n#EXT-X-MAP:URI="current-init.mp4"\n'+segment('selected')+'#EXT-X-KEY:METHOD=AES-128,URI="future-key.bin"\n#EXT-X-MAP:URI="future-init.mp4"\n'+segment('four')+segment('five');
 const value=fixture(playlist,{html:['/old-key.bin','/old-init.mp4','/future-key.bin','/future-init.mp4']});
 assert.equal((await inspectCatalogSource(media,value)).ok,true);
 assert.deepEqual(value.requests,['/master.m3u8','/first.m3u8','/current-key.bin','/current-init.mp4','/selected.ts']);
 for(const target of ['/current-key.bin','/current-init.mp4']){
  const invalid=fixture(playlist,{html:[target]});assert.equal((await inspectCatalogSource(media,invalid)).ok,false,'active resources must still be playable');
 }
});
test('METHOD=NONE clears the previous KEY while the most recent MAP remains active',async()=>{
 const playlist='#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="old-key.bin"\n#EXT-X-MAP:URI="old-init.mp4"\n'+segment('zero')+segment('one')+segment('two')+'#EXT-X-KEY:METHOD=NONE\n'+segment('selected')+'#EXT-X-KEY:METHOD=AES-128,URI="future-key.bin"\n'+segment('four')+segment('five');
 const value=fixture(playlist,{html:['/old-key.bin','/future-key.bin']});
 assert.equal((await inspectCatalogSource(media,value)).ok,true);
 assert.deepEqual(value.requests,['/master.m3u8','/first.m3u8','/old-init.mp4','/selected.ts']);
});
