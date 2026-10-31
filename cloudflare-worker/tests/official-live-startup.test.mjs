import assert from 'node:assert/strict';
import {publicLiveDescriptor,readPublicLiveDescriptor,forgetPublicLiveDescriptor} from '../src/public-live-descriptor.mjs';
import {OFFICIAL_CHANNELS,resolveOfficialLive,officialHeartbeat} from '../src/official-live.mjs';
import {createExclusiveService} from '../src/exclusive-service.mjs';
import {LOCAL_TV_SERVER} from '../src/local-tv-xtream.mjs';
let clock=Date.now(),loads=0;const realNow=Date.now;Date.now=()=>clock;
try{
 const fetcher=async()=>new Response('unused'),opts={fetcher,cachePublicPages:true},read=async()=>{loads++;return 'public-descriptor-'+loads;};
 assert.equal(await publicLiveDescriptor('station',read,opts),'public-descriptor-1');assert.equal(await publicLiveDescriptor('station',read,opts),'public-descriptor-1');assert.equal(loads,1);
 clock+=60001;assert.equal(await publicLiveDescriptor('station',read,opts),'public-descriptor-2');
 forgetPublicLiveDescriptor('station',opts);assert.equal(await publicLiveDescriptor('station',read,opts),'public-descriptor-3');
 await publicLiveDescriptor('station',read,{...opts,fetcher:async()=>new Response('another scope')});assert.equal(loads,4,'separate outbound adapters never reuse descriptors');
 await assert.rejects(()=>publicLiveDescriptor('bad',async()=>{throw Error('failure')},opts));await assert.rejects(()=>publicLiveDescriptor('bad',async()=>{throw Error('failure')},opts));
 const abort=new AbortController();abort.abort();await assert.rejects(()=>publicLiveDescriptor('station',read,{...opts,signal:abort.signal}));
 let cancelled=false,pulled=0;const descriptor=await readPublicLiveDescriptor('https://official.example.test/',text=>text.includes('public-source')?'found':null,{fetcher:async()=>new Response(new ReadableStream({pull(controller){pulled++;controller.enqueue(new TextEncoder().encode(pulled===1?'public-source':'unneeded-page-tail'));},cancel(){cancelled=true;}},{highWaterMark:0}))});
 assert.equal(descriptor,'found');assert.equal(cancelled,true);assert.equal(pulled,1,'stop downloading a page once its approved public descriptor is found');
 await assert.rejects(()=>readPublicLiveDescriptor('https://official.example.test/',()=>null,{maxBytes:5,fetcher:async()=>new Response('a much larger document')}));
 await assert.rejects(()=>readPublicLiveDescriptor('https://official.example.test/',()=>true,{fetcher:async()=>new Response('Forbidden',{status:403})}));
}finally{Date.now=realNow;}
const c=OFFICIAL_CHANNELS[0],calls=[],devices=new Set();let pageReads=0,pageStarted=false,authStarted=false,blocked=false,sourceFailed=false;
const reply=data=>Response.json({header:{code:0},data});
const fetcher=async(value,options={})=>{
 const u=new URL(value),body=options.body?JSON.parse(options.body):null;calls.push(u.hostname);assert.equal(options.redirect,'manual');
 if(u.hostname==='www.kwch.com'&&u.pathname==='/livestream/'){pageReads++;pageStarted=true;await Promise.resolve();assert.equal(authStarted,true,'anonymous platform setup starts while the public page is loading');return new Response('"id":"'+c.contentId+'"');}
 if(u.hostname==='www.kwch.com'&&u.pathname.startsWith('/pf/')){authStarted=true;return Response.json({access_token:'test-anonymous-access'});}
 if(u.hostname==='auth-gw.api.gray.quickplay.com'){devices.add(body.deviceId);return reply({token:'test-platform-token'});}
 if(u.hostname==='device-register-service.api.gray.quickplay.com')return reply({secret:btoa('01234567890123456789012345678901')});
 if(u.hostname==='heartbeat-service.api.gray.quickplay.com')return reply({heartbeatToken:'new-test-heartbeat'});
 if(u.hostname==='playback-auth-service.api.gray.quickplay.com')return reply({contentUrl:'https://live-streaming-mcdn.api.graylive.quickplay.com/'+c.input+'/'+c.input+'.isml/master.m3u8',drm:'none',pgmBlackout:blocked,ssaiEnabled:true,assetKey:'test-channel-asset',heartbeatToken:'test-heartbeat-'.repeat(200)});
 if(u.hostname==='pubads.g.doubleclick.net')return sourceFailed?new Response('not found',{status:404}):new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=600000\nhttps://dai.google.com/linear/test-channel-asset/variant.m3u8\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
 if(u.hostname==='dai.google.com')return new Response('#EXTM3U\n#EXT-X-MAP:URI="https://live-streaming-mcdn.api.graylive.quickplay.com/'+c.input+'/'+c.input+'.isml/init.mp4"\n#EXTINF:4,\nhttps://live-streaming-mcdn.api.graylive.quickplay.com/'+c.input+'/'+c.input+'.isml/video.ts\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
 if(u.hostname==='live-streaming-mcdn.api.graylive.quickplay.com')return new Response(new Uint8Array(2048).fill(0x47),{headers:{'Content-Type':'video/mp2t'}});
 throw Error('unexpected fixture host');
};
const options={fetcher,cachePublicPages:true};
const first=await resolveOfficialLive(c.page,options),second=await resolveOfficialLive(c.page,options);assert.equal(pageReads,1);assert.equal(devices.size,2);assert.notEqual(first.officialHeartbeat.deviceId,second.officialHeartbeat.deviceId,'public metadata reuse never shares devices or playback authorization');
blocked=true;await assert.rejects(()=>resolveOfficialLive(c.page,options));blocked=false;
const row={...c,type:'movie',source:'TV LOCAL OFICIAL',mode:'gnula',year:null,adult:false,visible:true,profileServer:'exclusive',playbackRevision:1,createdAt:1,episodes:[]},tickets=new Map(),paths=[];let sequence=0,revoked=false;
const permissions={tv:true,movies:false,series:false,adults:false},session={sid:'fixture-session',uid:'fixture-user',version:1,permissions,exp:Date.now()+3600000,xtream:true},auth={user:{permissions},session,username:'fixture',password:'fixture'};
const service=createExclusiveService({fetcher,resolveGnula(){throw Error('wrong adapter')},directory:async(env,path,body)=>{paths.push(path);if(path==='/heartbeat'&&(!row.visible||row.playbackRevision!==body.playbackRevision))return Response.json({error:'title_not_allowed'},{status:410});return path==='/exclusive-read'?Response.json({items:[row]}):path==='/exclusive-item-read'?Response.json(row):Response.json({lease_id:'fixture-lease'});},sessionCall:async()=>new Response('check',{status:revoked?401:200}),ticket:async(env,data)=>{const key='test-ticket-'+(++sequence);tickets.set(key,data);return key;},unticket:async(env,key)=>tickets.get(key),requestConnectionClient:()=>({}),guardXtreamResponse:r=>r});
const start=new Request('https://api.snaptvnow.com/live/fixture/fixture/1.m3u8');
let response=await service.liveXtream({},null).play(start,auth,{kind:'live',server:LOCAL_TV_SERVER,upstreamId:'1',ext:'m3u8'});assert.equal(response.status,200);assert.equal(paths.filter(p=>p==='/exclusive-read').length,1,'one catalog read per live start');assert.equal(paths.includes('/exclusive-item-read'),false,'scoped heartbeat replaces the separate item read');assert.equal(response.headers.get('X-SNAP-Local-Startup'),'2');
let text=await response.text(),child=text.split('\n').find(l=>l.startsWith('https://')),data=tickets.get(new URL(child).searchParams.get('t'));
assert.ok(data.officialHeartbeat,'playlist tickets retain the per-viewer player heartbeat');assert.equal(data.source,undefined);assert.equal(data.monitor,undefined);
response=await service.media(new Request(child),{});text=await response.text();child=text.split('\n').find(l=>l.startsWith('https://'));data=tickets.get(new URL(child).searchParams.get('t'));
for(const key of ['source','monitor','officialHeartbeat','type','xtream'])assert.equal(data[key],undefined);
for(const key of ['sid','uid','version','exclusiveId','parentId','playbackRevision','lease_id','request_id','exp','officialPage','resource'])assert.ok(data[key]!==undefined,'retain access scope: '+key);
assert.ok(JSON.stringify(data).length<JSON.stringify({...data,source:first.url,monitor:'monitor'.repeat(40),officialHeartbeat:first.officialHeartbeat}).length/3,'compact binary tickets materially reduce playlist payload');
response=await service.media(new Request(child),{});assert.equal((await response.arrayBuffer()).byteLength,2048);
revoked=true;await assert.rejects(()=>service.media(new Request(child),{}),/session_expired/);revoked=false;row.visible=false;await assert.rejects(()=>service.media(new Request(child),{}),/title_not_allowed/);row.visible=true;row.playbackRevision++;await assert.rejects(()=>service.media(new Request(child),{}),/title_not_allowed/);row.playbackRevision--;
sourceFailed=true;await assert.rejects(()=>service.liveXtream({},null).play(start,auth,{kind:'live',server:LOCAL_TV_SERVER,upstreamId:'1',ext:'m3u8'}),/media_unavailable/);sourceFailed=false;
const prior=pageReads;await resolveOfficialLive(c.page,options);assert.equal(pageReads,prior+1,'upstream failure invalidates public descriptor cache');
console.log('PASS: early page cancellation, bounded positive metadata TTL, adapter isolation, fresh per-viewer authorization/blackouts, one catalog read, compact signed scopes, heartbeat preservation, revocation and failure invalidation.');

// A returning viewer may reuse anonymous device setup, never content grants.
const sameViewer={...options,viewerKey:'dedicated-viewer-cache-fixture',viewerExpiresAt:Date.now()+3600000};
const setupBefore=devices.size,authorizationsBefore=calls.filter(host=>host==='playback-auth-service.api.gray.quickplay.com').length;
const a=await resolveOfficialLive(c.page,sameViewer),b=await resolveOfficialLive(c.page,sameViewer);
assert.equal(devices.size,setupBefore+1);assert.equal(a.officialHeartbeat.deviceId,b.officialHeartbeat.deviceId);assert.notEqual(a.officialHeartbeat.beatId,b.officialHeartbeat.beatId);
assert.equal(calls.filter(host=>host==='playback-auth-service.api.gray.quickplay.com').length,authorizationsBefore+2);
const different=await resolveOfficialLive(c.page,{...sameViewer,viewerKey:'another-viewer-cache-fixture'});assert.notEqual(different.officialHeartbeat.deviceId,a.officialHeartbeat.deviceId);
const heartbeatBefore=calls.filter(host=>host==='heartbeat-service.api.gray.quickplay.com').length;
Date.now=()=>realNow()+61000;
try{await Promise.all([officialHeartbeat(a.officialHeartbeat,{fetcher}),officialHeartbeat(b.officialHeartbeat,{fetcher})]);assert.equal(calls.filter(host=>host==='heartbeat-service.api.gray.quickplay.com').length,heartbeatBefore+2,'each new playback keeps its own heartbeat even with the same anonymous device');const expired=await resolveOfficialLive(c.page,sameViewer);assert.notEqual(expired.officialHeartbeat.deviceId,a.officialHeartbeat.deviceId);}finally{Date.now=realNow;}
console.log('PASS: per-viewer bounded anonymous device reuse, fresh authorization per start, separate playback heartbeats, expiry and cross-viewer isolation.');

const concurrent=await Promise.all([resolveOfficialLive(c.page,{...sameViewer,viewerKey:'concurrent-first-fixture'}),resolveOfficialLive(c.page,{...sameViewer,viewerKey:'concurrent-first-fixture'})]);assert.notEqual(concurrent[0].officialHeartbeat.deviceId,concurrent[1].officialHeartbeat.deviceId,'overlapping starts never share an in-use anonymous device');
console.log('PASS: overlapping channel starts retain separate anonymous device identities.');
// Public edge-cache entries may survive a different outbound-function isolate;
// injected adapters and private device contexts never use this cache.
const realFetch=globalThis.fetch,realCaches=globalThis.caches,edgeData=new Map();let edgeLoads=0;
globalThis.caches={async open(name){assert.equal(name,'smn-public-live-descriptors-v1');return {async match(request){return edgeData.get(request.url)?.clone()},async put(request,response){assert.equal(response.headers.get('Cache-Control'),'public, max-age=60');edgeData.set(request.url,response.clone());},async delete(request){return edgeData.delete(request.url)}}}};
try{
 globalThis.fetch=async()=>new Response('isolate one');const key='gray-page:edge-cache-fixture',load=async()=>{edgeLoads++;return true;};
 assert.equal(await publicLiveDescriptor(key,load,{cachePublicPages:true}),true);assert.equal(edgeData.size,1);
 globalThis.fetch=async()=>new Response('isolate two');assert.equal(await publicLiveDescriptor(key,load,{cachePublicPages:true}),true);assert.equal(edgeLoads,1);
 await forgetPublicLiveDescriptor(key);assert.equal(edgeData.size,0);
 assert.equal(await publicLiveDescriptor(key,load,{cachePublicPages:true}),true);assert.equal(edgeLoads,2);
}finally{globalThis.fetch=realFetch;if(realCaches===undefined)delete globalThis.caches;else globalThis.caches=realCaches;}
console.log('PASS: anonymous public edge metadata reuse, fixed TTL and explicit invalidation across isolate-like scopes.');
