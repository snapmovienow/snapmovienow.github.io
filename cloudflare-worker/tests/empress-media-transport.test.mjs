import assert from 'node:assert/strict';
import {createExclusiveService} from '../src/exclusive-service.mjs';
import {EMPRESS_SERIES_META,EMPRESS_EPISODES} from '../src/empress-catalog.mjs';
const page=EMPRESS_EPISODES[0].page,host='sv2.ibra.lat',root='https://'+host+'/aa/bb/abcdef123456.m3u8';
const row={...EMPRESS_SERIES_META,type:'series',mode:'gnula',visible:true,adult:false,playbackRevision:1,episodes:structuredClone(EMPRESS_EPISODES)};
const data={kind:'exclusive-media',exclusiveId:EMPRESS_EPISODES[0].id,parentId:row.id,playbackRevision:1,sid:'private-fixture-session',uid:'private-fixture-user',lease_id:'private-fixture-lease',request_id:'private-fixture-request',source:root,monitor:'private-fixture-monitor',type:'series',exp:Date.now()+60000,empressPage:page,empressContext:{provider:'nupload',episode:1,host,wrapper:'https://nupload.my/watch/'+'A'.repeat(44),prefix:'/files/7/abcdef123456/',masterPath:new URL(root).pathname}};
const calls=[],logs=[];
let fail=false;
const service=createExclusiveService({
 unticket:async()=>structuredClone(data),ticket:async()=> 'fixture-child-ticket',
 directory:async(_,path)=>Response.json(path==='/exclusive-item-read'?row:{ok:true}),
 sessionCall:async()=>Response.json({ok:true}),guardXtreamResponse:async r=>r,
 onEmpressFailure:value=>logs.push(value),
 fetcher:async(url,options)=>{
  const headers=new Headers(options.headers);calls.push({url,range:headers.get('Range')});
  if(fail)return new Response('fixture denied',{status:403});
  const text=headers.has('Range')?'partial invalid manifest':'#EXTM3U\n#EXT-X-TARGETDURATION:7\n#EXTINF:7,\nhttps://'+host+'/files/7/abcdef123456/video0.ts\n#EXT-X-ENDLIST\n';
  return new Response(options.method==='HEAD'?null:text,{status:206,headers:{'content-type':'application/vnd.apple.mpegurl','content-length':String(text.length),'content-range':'bytes 0-31/999','accept-ranges':'bytes',etag:'upstream-identity','last-modified':'Wed, 04 Nov 2026 10:00:00 GMT'}});
 }
});
const request=(headers={},method='GET')=>new Request('https://api.snaptvnow.com/exclusive-media?t=fixture',{method,headers});
for(const resource of [undefined,'https://'+host+'/files/7/abcdef123456/video.m3u8']){
 data.resource=resource;
 const response=await service.media(request({Range:'bytes=0-31'}),{},{});
 assert.equal(response.status,200);assert.match(await response.text(),/#EXTM3U/);assert.equal(calls.at(-1).range,null,'manifest upstream GET must be complete');
 for(const header of ['content-length','content-range','accept-ranges','etag','last-modified'])assert.equal(response.headers.has(header),false,'rewritten manifest must not retain upstream byte identity');
}
const head=await service.media(request({Range:'bytes=0-31'},'HEAD'),{},{});assert.equal(calls.at(-1).range,null);for(const header of ['content-length','content-range','accept-ranges','etag','last-modified'])assert.equal(head.headers.has(header),false);
data.resource='https://'+host+'/files/7/abcdef123456/video0.ts';fail=true;
await assert.rejects(service.media(request({Range:'bytes=0-2047'}),{},{}),error=>error.message==='media_unavailable'&&error.status===502);
assert.equal(calls.at(-1).range,'bytes=0-2047','binary ranges retain their existing semantics');
assert.deepEqual(logs,[{event:'empress_media_failure',provider:'nupload',episode:1,stage:'upstream',resource:'media',upstream_status:403,range:'closed',code:'media_unavailable'}]);
const log=JSON.stringify(logs);for(const secret of ['private-fixture','https://','sv2','nupload.my','abcdef123456'])assert.equal(log.includes(secret),false,'diagnostic excludes identities, tickets and upstream URLs');
console.log('PASS: complete Empress manifest GETs, root/child/HEAD byte identity removal, unchanged binary ranges and bounded credential-free upstream failure diagnostics.');
