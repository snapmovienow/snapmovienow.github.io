import assert from 'node:assert/strict';
import {WILLAX_CHANNEL as channel,WILLAX_MEDIA_ROOT as root,isWillaxMediaURL,willaxMediaReferenceURL} from '../src/willax-live.mjs';
import {isOfficialLivePage,officialMediaAllowed,resolveOfficialLive} from '../src/official-live.mjs';
import {exclusiveURL,exclusiveCatalogRoute} from '../src/exclusive-catalog.mjs';
import {inspectCatalogSource} from '../src/catalog-source-check.mjs';
import {createExclusiveService} from '../src/exclusive-service.mjs';

const child='http://190.93.224.42/WILLAX/tracks-v1a1/mono.ts.m3u8',segment=new URL('2026/11/17/00/40/17-07200.ts',child).href;
const bytes=new Uint8Array(188*12);for(let n=0;n<bytes.length;n+=188)bytes[n]=0x47;
let redirect=null,malicious=null,requests=[];
const fixture=async(value,headers)=>{
 assert.equal(isWillaxMediaURL(value),true);assert.equal(headers.has('Authorization'),false);assert.equal(headers.has('Cookie'),false);requests.push(value);
 if(redirect)return new Response(null,{status:302,headers:{Location:redirect}});
 if(value===root)return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=3000000\n'+(malicious||'tracks-v1a1/mono.ts.m3u8')+'\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
 if(value===child)return new Response('#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:5\n#EXT-X-PROGRAM-DATE-TIME:'+new Date().toISOString()+'\n#EXTINF:7.2,\n2026/11/17/00/40/17-07200.ts\n',{headers:{'content-type':'application/vnd.apple.mpegurl'}});
 return new Response(bytes,{headers:{'content-type':'video/mp2t'}});
};
const willaxTransportOptions={fetchIP:fixture};
assert.equal(isOfficialLivePage(channel.page),true);assert.deepEqual(await resolveOfficialLive(channel.page),{url:root,officialPage:channel.page});
for(const value of [root,child,segment]){assert.equal(isWillaxMediaURL(value),true);assert.equal(officialMediaAllowed(channel.page,value),true);assert.throws(()=>exclusiveURL(value));}
for(const value of [root+'?',root+'#',root+'?a=1',root.replace('http:','https:'),root.replace('190.93.224.42','127.0.0.1'),root.replace('190.93.224.42','3193823274'),root.replace('/WILLAX/','/OTHER/'),root.replace('42/','42:80/'),root.replace('42/','42:8000/'),'http://user:pass@190.93.224.42/WILLAX/index.m3u8',root.replace('/WILLAX/','/WILLAX/../WILLAX/'),root.replace('/WILLAX/','/WILLAX/%2e%2e/WILLAX/')])assert.equal(isWillaxMediaURL(value),false,value);
for(const reference of ['../WILLAX/index.m3u8','./tracks-v1a1/mono.ts.m3u8','//evil.example/x.ts','tracks-v1a1/%2e%2e/index.m3u8','tracks-v1a1/mono.ts.m3u8?x=1'])assert.equal(willaxMediaReferenceURL(reference,root),null);
assert.equal(officialMediaAllowed('https://www.kwch.com/livestream/',root),false);
assert.equal((await inspectCatalogSource({mode:'gnula',page:channel.page},{willaxTransportOptions})).ok,true);assert.equal(requests.length,3);
for(const bad of ['http://127.0.0.1/private','http://190.93.224.42/OTHER/index.m3u8']){redirect=bad;requests=[];assert.equal((await inspectCatalogSource({mode:'gnula',page:channel.page},{willaxTransportOptions})).ok,false);assert.equal(requests.length,1,'redirect target rejected before transport');}redirect=null;

const row={...channel,type:'movie',mode:'gnula',source:'WILLAX · señal alternativa',usageKind:'channel',year:null,visible:true,adult:false,episodes:[],revision:1,playbackRevision:1},session={sid:'willax-fixture-session',uid:'owner-fixture',version:1,exp:Date.now()+3600000,permissions:{tv:true,movies:false,series:false,adults:false}};
let active=true,visible=true,tokenIndex=0;const tickets=new Map();
const service=createExclusiveService({willaxTransportOptions,requestConnectionClient:()=>({}),ticket:async(_env,value)=>{const token='fixture-'+(++tokenIndex);tickets.set(token,structuredClone(value));return token;},unticket:async(_env,token)=>tickets.get(token),sessionCall:async()=>Response.json({}, {status:active?200:401}),directory:async(_env,path)=>{
 if(path==='/heartbeat')return Response.json(visible?{exclusiveScopeChecked:true,localVideoProbe:true}:{error:'title_not_allowed'},{status:visible?200:410});
 if(path==='/exclusive-acquire')return Response.json({lease_id:'willax-fixture-lease'});
 return Response.json({});
}});
const own='https://api.snaptvnow.com',start=()=>service.prepare(new Request(own+'/live/fixture/fixture/23.m3u8'),{},session,channel.id,{live:true,localRow:row}),media=url=>service.media(new Request(url),{},{waitUntil:p=>p.catch(()=>{})});
requests=[];const prepared=await start(),master=await(await media(prepared.url)).text();assert.ok(master.startsWith('#EXTM3U'));assert.ok(!master.includes('190.93.224.42'));const video=master.split('\n').find(line=>line.startsWith(own));assert.ok(video);
const playlist=await(await media(video)).text(),resource=playlist.split('\n').find(line=>line.startsWith(own));assert.ok(resource);assert.ok(!playlist.includes('http://'));assert.deepEqual(new Uint8Array(await(await media(resource)).arrayBuffer()),bytes);assert.equal(requests.length,3);
const calls=requests.length;active=false;await assert.rejects(media(resource),/session_expired/);assert.equal(requests.length,calls);active=true;visible=false;await assert.rejects(media(resource),/title_not_allowed/);assert.equal(requests.length,calls);visible=true;
await assert.rejects(service.prepare(new Request(own+'/live/fixture'),{},{...session,permissions:{...session.permissions,tv:false}},channel.id,{live:true,localRow:row}),/title_not_allowed/);assert.equal(requests.length,calls);
const data=tickets.get(new URL(resource).searchParams.get('t'));tickets.set('wrong-channel',{...data,officialPage:'https://www.kwch.com/livestream/'});await assert.rejects(media(own+'/exclusive-media?t=wrong-channel'),/exclusive_url/);assert.equal(requests.length,calls);
malicious='http://127.0.0.1/private';await assert.rejects(media(prepared.url),/media_origin_changed/);assert.equal(requests.length,calls+1);malicious=null;

// The media-only exception must never admit an HTTP catalog row or poster.
const store={data:new Map([['exclusive:index',{revision:1,ids:[],updatedAt:1}]]),async get(k){return this.data.get(k);},async put(k,v){this.data.set(k,v);},async list(){return new Map();}};
for(const item of [{...row,mode:'direct',page:root},{...row,poster:root}])assert.equal((await exclusiveCatalogRoute(store,'/exclusive-save',{item,revision:0,actor:'fixture-owner'})).status,400);
console.log('PASS: Willax HTTP stays inside its signed TV context; HLS is rewritten to HTTPS, media is delivered, and other channels, catalog/posters, redirects, traversal, revoked sessions and hidden rows cannot reach transport.');
