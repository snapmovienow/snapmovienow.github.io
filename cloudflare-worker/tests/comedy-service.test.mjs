import assert from 'node:assert/strict';
import test from 'node:test';
import {createExclusiveService} from '../src/exclusive-service.mjs';
import {inspectCatalogSource} from '../src/catalog-source-check.mjs';
import {COMEDY_GNULA_EPISODES} from '../src/comedy-gnula-source.mjs';

const origin='https://api.snaptvnow.com';
const ts=Uint8Array.from({length:188*12},(_,i)=>i%188===0?0x47:i%251);
function fixture(provider='vidara'){
 const d=COMEDY_GNULA_EPISODES[0];
 const page=provider==='vidara'?d.page:'https://pelisflix200.date/episodio/machos-alfa-zhmk-5x2/';
 const wrapper=provider==='vidara'?d.embed:'https://nupload.my/watch/'+'a'.repeat(46);
 const host=provider==='vidara'?'s14-s1001604.97bf1.com':'sv3.ibra.lat';
 const prefix=provider==='vidara'?'/hls/ABCDEFGHIJKLMNOPQRSTUVWXYZ123456/':'/files/e/e774a00334a/';
 const query=provider==='vidara'?'?token=fixture-token%3A123':'?m='+'a'.repeat(22)+'&e=1795200000';
 const root=provider==='vidara'?'https://'+host+prefix+'master.m3u8?token=fixture-token%3A123':'https://'+host+'/?s='+'a'.repeat(75);
 const variant='https://'+host+prefix+'index_1920x1080.m3u8'+query;
 const segment='https://'+host+prefix+(provider==='vidara'?'seg_1920x1080_000.woff2':'video0.ts')+query;
 const master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000\n'+variant+'\n';
 const media='#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXT-X-DATERANGE:ID="stitched-marker",CLASS="advertisement",START-DATE="2026-11-20T00:00:00Z"\n#EXTINF:4.64,\n'+segment+'\n#EXT-X-ENDLIST\n';
 const session={sid:'fixture-private-session',uid:'fixture-private-user',version:1,exp:Date.now()+600000,permissions:{series:true,movies:false,tv:false,adults:false}};
 const state={capacity:true,access:true,heartbeat:true,visible:true,revision:1,invalidMedia:false,maliciousVariant:false,segmentRedirect:null,range:null};
 const row={id:provider==='vidara'?'comedy-muertos-sl':'comedy-machos-alfa',name:provider==='vidara'?'Muertos S.L.':'Machos alfa',type:'series',mode:'gnula',adult:false,visible:true,playbackRevision:1,profileServer:'exclusive',episodes:[{id:provider==='vidara'?'comedy-muertos-sl-s1e1':'comedy-machos-alfa-s5e2',season:provider==='vidara'?1:5,episode_num:provider==='vidara'?1:2,title:'Episodio 1',page}]};
 const calls=[],privateCalls=[],tickets=new Map();let serial=0;
 const fetcher=async(value,options={})=>{
  const u=new URL(value),headers=new Headers(options.headers);calls.push({url:u.href,method:options.method||'GET',range:headers.get('range')});
  assert.equal(options.redirect,'manual');for(const name of ['authorization','cookie','x-authorization'])assert.equal(headers.has(name),false);
  for(const [,value] of headers)assert.ok(!value.includes(session.sid)&&!value.includes(session.uid));
  if(u.href===page){
   assert.equal(provider,'nupload');return new Response('<h1>Ver Machos alfa Episodio 2 Temporada 5</h1><div data-url="'+btoa(wrapper)+'"><span>CASTELLANO<span>HD • Principal</span></span></div>');
  }
  if(u.href===wrapper){
   assert.equal(headers.get('referer'),page);
   if(provider==='vidara')return new Response('<script>let apiURL="/api/stream";JSON.stringify({filecode:filecode,device:detectDevice(),codecs:cs})</script>');
   const values=Array.from('https://'+host+'/',c=>btoa('abc'+(9029437+c.charCodeAt(0))+'xyz'));
   return new Response('var chars='+JSON.stringify(values)+';var result="";chars.forEach(function decode(value){ result += String.fromCharCode(parseInt(atob(value).replace(/\\D/g,\'\')) - 9029437); });var sesz="'+'a'.repeat(75)+'";player.setup({file:result+"?s="+sesz+"",type:"hls"});');
  }
  if(provider==='vidara'&&u.href===new URL('/api/stream',wrapper).href){
   assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{filecode:new URL(wrapper).pathname.split('/').pop(),device:'web',codecs:[]});
   return Response.json({filecode:new URL(wrapper).pathname.split('/').pop(),title:btoa('Muertos S.L..2024')+'.1x01.CAST',streaming_url:root,vast_ads:''});
  }
  if(u.hostname===host){
   const embedOrigin=new URL(wrapper).origin;
   assert.equal(headers.get('origin'),embedOrigin);assert.equal(headers.get('referer'),provider==='vidara'?embedOrigin+'/':wrapper);
   if(u.href===root)return new Response(provider==='vidara'?master:media,{headers:{'Content-Type':'application/vnd.apple.mpegurl','ETag':'upstream-manifest-identity','Accept-Ranges':'bytes'}});
   if(u.href===variant)return new Response(state.maliciousVariant?media.replace(segment,'https://127.0.0.1/private.ts'):media,{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
   if(u.href===segment){
    if(state.segmentRedirect)return new Response(null,{status:302,headers:{Location:state.segmentRedirect}});
    const payload=state.invalidMedia?new TextEncoder().encode('<html><h1>File deleted by DMCA request</h1></html>'):ts;
    const m=headers.get('range')?.match(/^bytes=(\d+)-(\d+)$/);
    if(m){const from=Number(m[1]),to=Math.min(payload.length-1,Number(m[2]));return new Response(payload.slice(from,to+1),{status:206,headers:{'Content-Type':'font/woff2','Content-Range':'bytes '+from+'-'+to+'/'+payload.length,'Content-Length':String(to-from+1)}});}
    return new Response(payload,{headers:{'Content-Type':provider==='vidara'?'font/woff2':'video/mp2t,text/html','Content-Length':String(payload.length)}});
   }
  }
  throw Error('unexpected upstream '+u.origin+u.pathname);
 };
 const service=createExclusiveService({fetcher,
  directory:async(_,path,body)=>{
   privateCalls.push({path,body});
   if(path==='/exclusive-read')return Response.json({revision:1,items:[{...row,visible:state.visible,playbackRevision:state.revision}]});
   if(path==='/exclusive-item-read')return Response.json({...row,visible:state.visible,playbackRevision:state.revision});
   if(path==='/exclusive-acquire')return Response.json(state.capacity?{lease_id:'fixture-private-lease'}:{error:'exclusive_capacity'},{status:state.capacity?200:409});
   if(path==='/heartbeat')return Response.json({ok:state.heartbeat},{status:state.heartbeat?200:410});
   return Response.json({ok:true});
  },
  sessionCall:async()=>Response.json({ok:state.access},{status:state.access?200:401}),
  ticket:async(_,data)=>{const id='fixture-ticket-'+(++serial);tickets.set(id,structuredClone(data));return id;},
  unticket:async(_,token)=>structuredClone(tickets.get(token)),
  requestConnectionClient:()=>({}),guardXtreamResponse:async response=>response,
  resolveGnula:async()=>{throw Error('legacy resolver must not handle comedy');}
 });
 const prepare=()=>service.prepare(new Request(origin+'/exclusive-play'),{},session,row.episodes[0].id);
 const request=(url,headers={},method='GET')=>service.media(new Request(url,{headers,method}),{},{});
 const ticketOf=url=>tickets.get(new URL(url).searchParams.get('t'));
 return {provider,d,page,wrapper,host,prefix,root,variant,segment,media,state,row,session,calls,privateCalls,tickets,fetcher,service,prepare,request,ticketOf};
}

for(const provider of ['vidara','nupload'])test(provider+' playback mints a private context and rewrites only scoped HLS children',async()=>{
 const f=fixture(provider),prepared=await f.prepare(),minted=f.ticketOf(prepared.url);
 assert.equal(minted.kind,'exclusive-media');assert.equal(minted.comedyPage,f.page);assert.equal(minted.comedyContext.provider,provider);assert.equal(minted.source,f.root);assert.equal(minted.parentId,f.row.id);assert.equal(minted.exclusiveId,f.row.episodes[0].id);
 assert.ok(f.privateCalls.some(x=>x.path==='/exclusive-acquire'));assert.equal(prepared.lease_id,'fixture-private-lease');
 const response=await f.request(prepared.url,{Range:'bytes=0-31'});assert.equal(response.status,200);assert.equal(response.headers.get('etag'),null);assert.equal(response.headers.get('accept-ranges'),null);
 let text=await response.text();assert.ok(!text.includes(f.host)&&!text.includes(f.wrapper));
 let child=text.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?'));assert.ok(child);assert.deepEqual(f.ticketOf(child).comedyContext,minted.comedyContext);
 assert.equal(f.ticketOf(child).source,f.root);
 if(provider==='vidara'){
  assert.equal(f.ticketOf(child).resource,f.variant);const variant=await f.request(child);text=await variant.text();child=text.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?'));assert.ok(child);
 }
 assert.ok(text.includes('#EXT-X-DATERANGE:ID="stitched-marker",CLASS="advertisement"'),'existing source markers remain untouched');assert.equal(f.ticketOf(child).resource,f.segment);
 const segment=await f.request(child);assert.equal(segment.status,200);assert.equal(segment.headers.get('Content-Type'),'video/mp2t');assert.deepEqual(new Uint8Array(await segment.arrayBuffer()),ts,'stream prefix used for validation is not consumed or altered');
 assert.equal(f.privateCalls.filter(x=>x.path==='/exclusive-acquire').length,1,'children reuse the checked lease');
});

test('session revocation, row withdrawal, revision changes and expired leases reject before upstream bytes',async()=>{
 for(const state of [{access:false},{visible:false},{revision:2},{heartbeat:false}]){
  const f=fixture(),prepared=await f.prepare();Object.assign(f.state,state);const before=f.calls.length;
  await assert.rejects(f.request(prepared.url),error=>[401,410].includes(error.status));assert.equal(f.calls.length,before);
 }
});

test('capacity and permission errors never mint an unallocated media capability',async()=>{
 const f=fixture();f.state.capacity=false;await assert.rejects(f.prepare(),error=>error.message==='exclusive_capacity'&&error.status===409);assert.equal(f.tickets.size,0);
 const denied=fixture();denied.session.permissions.series=false;await assert.rejects(denied.prepare(),error=>error.status===404);assert.equal(denied.calls.length,0);assert.equal(denied.tickets.size,0);
 assert.equal(denied.privateCalls.some(x=>x.path==='/playback-begin'),false);
});

test('altered child URLs, contexts and same-host cross-file redirects fail before their destination is fetched',async()=>{
 const f=fixture(),prepared=await f.prepare();const text=await (await f.request(prepared.url)).text(),variant=text.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?'));
 const childText=await (await f.request(variant)).text(),child=childText.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?'));
 const key=new URL(child).searchParams.get('t'),original=structuredClone(f.tickets.get(key));
 for(const changes of [{resource:'https://127.0.0.1/private.ts'},{resource:f.segment.replace(f.prefix,'/hls/ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ/')},{comedyPage:COMEDY_GNULA_EPISODES[1].page},{comedyContext:{...original.comedyContext,token:'different-token'}}]){
  f.tickets.set(key,{...original,...changes});const before=f.calls.length;await assert.rejects(f.request(child),error=>[400,403].includes(error.status));assert.equal(f.calls.length,before);
 }
 f.tickets.set(key,original);f.state.segmentRedirect=f.segment.replace(f.prefix,'/hls/ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ/');await assert.rejects(f.request(child),error=>error.status===403);assert.ok(!f.calls.some(x=>x.url===f.state.segmentRedirect));
 f.state.segmentRedirect=null;f.state.maliciousVariant=true;await assert.rejects(f.request(variant),error=>[400,403].includes(error.status));assert.ok(!f.calls.some(x=>x.url.includes('127.0.0.1')));
});

test('HTML disguised as font/video is rejected during playback and the publication probe',async()=>{
 const f=fixture(),prepared=await f.prepare();let text=await (await f.request(prepared.url)).text(),child=text.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?'));
 text=await (await f.request(child)).text();child=text.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?'));f.state.invalidMedia=true;
 await assert.rejects(f.request(child),/media_not_video/);assert.deepEqual(await inspectCatalogSource({mode:'gnula',page:f.page},{fetcher:f.fetcher}),{ok:false,check:'unavailable'});
 for(const provider of ['vidara','nupload']){
  const valid=fixture(provider);assert.deepEqual(await inspectCatalogSource({mode:'gnula',page:valid.page},{fetcher:valid.fetcher}),{ok:true,check:'playlist_and_segment'});
 }
});

test('closed nonzero and short ranges on comedy segments remain playable',async()=>{
 const f=fixture(),prepared=await f.prepare();let text=await (await f.request(prepared.url)).text(),child=text.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?'));
 text=await (await f.request(child)).text();child=text.split('\n').find(line=>line.startsWith(origin+'/exclusive-media?'));
 for(const range of ['bytes=4-600','bytes=0-31']){
  const response=await f.request(child,{Range:range});assert.ok([200,206].includes(response.status));
  const bytes=new Uint8Array(await response.arrayBuffer());if(response.status===200)assert.deepEqual(bytes,ts);else{const [,a,b]=range.match(/bytes=(\d+)-(\d+)/);assert.deepEqual(bytes,ts.slice(Number(a),Number(b)+1));}
 }
});
