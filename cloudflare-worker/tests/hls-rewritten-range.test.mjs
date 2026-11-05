import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createExclusiveService} from '../src/exclusive-service.mjs';
import {BRANDING_TEST_CHANNEL as channel} from '../src/public-tv-channels.mjs';

// Model the real published fMP4 + byte-range manifests and the Range: bytes=0-
// sent by IJK/FFmpeg clients, without production accounts or upstream traffic.
const assetBase=new URL('.',channel.page).href,appleBase='https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_adv_example_hevc/';
const manifests=new Map(await Promise.all(['master.m3u8','video.m3u8','audio.m3u8','brand.m3u8'].map(async file=>[assetBase+file,await readFile(new URL('../../branding-test/'+file,import.meta.url),'utf8')])));
const binary=Uint8Array.from({length:700000},(_,i)=>i%251),calls=[],tickets=new Map();let sequence=0,mode='complete';
const row={...channel,type:'movie',mode:'direct',visible:true,adult:false,playbackRevision:1};
const root={kind:'exclusive-media',exclusiveId:row.id,parentId:row.id,playbackRevision:1,sid:'range-fixture-session',lease_id:'range-fixture-lease',request_id:'range-fixture-request',source:channel.page,officialPage:channel.page,exp:Date.now()+60000};
tickets.set('fixture-root',root);
const service=createExclusiveService({
 unticket:async(_,ticket)=>tickets.get(ticket),ticket:async(_,data)=>{const key='fixture-child-'+(++sequence);tickets.set(key,data);return key;},
 sessionCall:async()=>Response.json({ok:true}),directory:async()=>Response.json({ok:true,exclusiveScopeChecked:true}),guardXtreamResponse:r=>r,
 fetcher:async(url,options)=>{
  const range=new Headers(options.headers).get('range');calls.push({url,range,method:options.method});
  if(manifests.has(url)){
   const full=new TextEncoder().encode(manifests.get(url));let bytes=full,start=0,end=full.length-1;
   if(mode==='prefix'){end=99;bytes=full.slice(0,100);}else if(mode==='tail'){start=100;bytes=full.slice(start);}else if(mode==='unknown'){end=99;bytes=full.slice(0,100);}
   return new Response(options.method==='HEAD'?null:bytes,{status:206,headers:{'Content-Type':'application/vnd.apple.mpegurl','Content-Length':String(bytes.length),'Content-Range':'bytes '+start+'-'+end+'/'+(mode==='unknown'?'*':full.length),'Accept-Ranges':'bytes',ETag:'"original-manifest"','Last-Modified':'Wed, 04 Nov 2026 10:00:00 GMT'}});
  }
  if(url.startsWith(appleBase)&&url.endsWith('/main.mp4')){
   const match=/^bytes=(\d+)-(\d+)$/.exec(range||'');assert.ok(match,'fMP4 request retains a closed range');const start=Number(match[1]),end=Number(match[2]);
   return new Response(options.method==='HEAD'?null:binary.slice(start,end+1),{status:206,headers:{'Content-Type':'video/mp4','Content-Length':String(end-start+1),'Content-Range':'bytes '+start+'-'+end+'/'+binary.length,'Accept-Ranges':'bytes',ETag:'"original-mp4"'}});
  }
  throw Error('Unexpected isolated fixture request');
 }
});
const request=(url='https://api.snaptvnow.com/exclusive-media?t=fixture-root',range='bytes=0-',method='GET')=>new Request(url,{method,headers:{Range:range}});
const checkHeaders=response=>{assert.equal(response.status,200);for(const header of ['content-length','content-range','accept-ranges','etag','last-modified'])assert.equal(response.headers.has(header),false,'rewritten manifests have no upstream byte identity: '+header);};
const masterResponse=await service.media(request(),{},{});checkHeaders(masterResponse);assert.equal(calls.at(-1).range,null,'the master is fetched whole even when clients send Range');const master=await masterResponse.text();assert.ok(master.length>manifests.get(channel.page).length,'signed URLs change representation size');
const tracks=[...master.matchAll(/URI="([^"]+)"/g)].map(match=>match[1]);tracks.push(master.split('\n').find(line=>line.startsWith('https://')));
for(const url of tracks){const response=await service.media(request(url,'bytes=0-99'),{},{});checkHeaders(response);assert.equal(calls.at(-1).range,null,'variant/audio/subtitle manifests ignore even a short client Range');assert.ok((await response.text()).startsWith('#EXTM3U'));}
const shortMaster=await service.media(request(undefined,'bytes=0-99'),{},{});checkHeaders(shortMaster);assert.equal(calls.at(-1).range,null);assert.ok((await shortMaster.text()).includes('#EXT-X-STREAM-INF:'));
const head=await service.media(request(undefined,'bytes=0-','HEAD'),{},{});checkHeaders(head);assert.equal(await head.text(),'');

// Even without requesting Range, a broken upstream can return a partial 206.
// A prefix can start with #EXTM3U and still be incomplete. Never hand a client a
// successfully rewritten partial master, nor a tail/unknown-length range.
for(const value of ['prefix','tail','unknown']){mode=value;await assert.rejects(service.media(request(undefined,value==='tail'?'bytes=100-':'bytes=0-99'),{},{}),error=>error.message==='invalid_playlist'&&error.status===502,value+' partial manifests are rejected');}
mode='complete';
const videoResponse=await service.media(request(tracks.at(-1)),{},{}),video=await videoResponse.text();
const init=video.match(/#EXT-X-MAP:URI="([^"]+)",BYTERANGE="(\d+)@(\d+)"/),fragment=video.match(/#EXT-X-BYTERANGE:(\d+)@(\d+)\n(https:[^\n]+)/);assert.ok(init&&fragment,'the real fMP4 map and segment ranges survive rewriting');
for(const [url,length,offset]of [[init[1],Number(init[2]),Number(init[3])],[fragment[3],Number(fragment[1]),Number(fragment[2])]]){
 const range='bytes='+offset+'-'+(offset+length-1),response=await service.media(request(url,range),{},{});assert.equal(response.status,206);assert.equal(response.headers.get('Content-Range'),'bytes '+offset+'-'+(offset+length-1)+'/'+binary.length);assert.equal(response.headers.get('Accept-Ranges'),'bytes');assert.equal(response.headers.get('ETag'),'"original-mp4"');assert.deepEqual(new Uint8Array(await response.arrayBuffer()),binary.slice(offset,offset+length));assert.equal(calls.at(-1).range,range);
}
console.log('PASS: real branding HLS manifests normalize rewritten GET/HEAD identity, reject incomplete 206 prefixes/tails and preserve signed fMP4 init/fragment Range responses.');
