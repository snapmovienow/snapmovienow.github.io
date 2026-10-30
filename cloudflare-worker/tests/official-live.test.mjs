import assert from 'node:assert/strict';
import {OFFICIAL_CHANNELS,EXTRA_OFFICIAL_CHANNELS,isOfficialLivePage,resolveOfficialLive,officialMediaAllowed,officialHeartbeat} from '../src/official-live.mjs';
import {inspectCatalogSource} from '../src/catalog-source-check.mjs';
import {createExclusiveService} from '../src/exclusive-service.mjs';
import {exclusiveCatalogRoute,exclusivePublic,visibleExclusive,exportExclusives,validExclusiveBackup} from '../src/exclusive-catalog.mjs';
const kwch=OFFICIAL_CHANNELS[0],kake=OFFICIAL_CHANNELS[3],calls=[];
const asset='test-asset-identifier',master='https://dai.google.com/linear/hls/pa/event/'+asset+'/master.m3u8',variant='https://dai.google.com/linear/hls/pa/event/'+asset+'/variant.m3u8',segment='https://live-streaming-mcdn.api.graylive.quickplay.com/'+kwch.input+'/'+kwch.input+'.isml/segment.ts';
let denied=false,adRedirect=false,redirectAttack=false,blackout=false,htmlSegment=false,drm=false,heartbeatCalls=0;
const reply=data=>Response.json({header:{code:0},data});
const fetcher=async(value,options={})=>{
 assert.equal(options.redirect,'manual','use a Workers-supported redirect mode and reject 3xx responses explicitly');
 const u=new URL(value),headers=new Headers(options.headers),body=options.body?JSON.parse(options.body):null;calls.push({url:u.href,headers,body});
 if(denied)return new Response('Forbidden',{status:403});
 if(u.hostname==='www.kwch.com'&&u.pathname==='/livestream/')return new Response('"id":"'+kwch.contentId+'"');
 if(u.hostname==='www.kake.com'&&u.pathname==='/video/live/')return new Response('<iframe src="https://www.kake.com/tncms/block/3942264"></iframe>');
 if(u.hostname==='www.kake.com'&&u.pathname==='/tncms/block/3942264/')return new Response('<source src="https://townnews.g-mana.live/media/11111111-1111-1111-1111-111111111111/master.m3u8">');
 if(u.hostname==='www.kwch.com'&&u.pathname.startsWith('/pf/'))return Response.json({access_token:'anonymous-test-token'});
 if(u.hostname==='auth-gw.api.gray.quickplay.com')return reply({token:'anonymous-test-qpat'});
 if(u.hostname==='device-register-service.api.gray.quickplay.com')return reply({secret:btoa('01234567890123456789012345678901')});
 if(u.hostname==='playback-auth-service.api.gray.quickplay.com'){
  assert.equal(body.disableSsai,'false');assert.equal(body.drm,'none');assert.equal(body.contentId,kwch.contentId);assert.ok(headers.get('X-device-id'));
  assert.equal(body.urlParameters['ads.npa'],'1');assert.equal(body.urlParameters['ads.ltd'],'1');
  return reply({contentUrl:segment.replace('segment.ts','index.m3u8'),drm:drm?'widevine':'none',pgmBlackout:blackout,assetKey:asset,ssaiEnabled:true,custom:{adParams:{'ads.npa':'1'}},heartbeatToken:'anonymous-test-heartbeat'});
 }
 if(u.hostname==='heartbeat-service.api.gray.quickplay.com'){heartbeatCalls++;assert.equal(body.contentId??body.itemId,kwch.contentId);return reply({heartbeatToken:'anonymous-test-heartbeat-next'});}
 // No SNAP credentials or Quickplay authorization may reach a media server.
 assert.equal(headers.get('Authorization'),null);assert.equal(headers.get('X-Authorization'),null);
 if(u.hostname==='pubads.g.doubleclick.net')return new Response(null,{status:302,headers:{location:redirectAttack?'https://127.0.0.1/private':master}});
 if(u.href===master)return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\n'+variant+'\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
 if(u.href===variant)return new Response('#EXTM3U\n#EXTINF:3,\n'+segment+'\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
 if(u.href===segment&&adRedirect)return new Response(null,{status:302,headers:{location:'https://rr1---sn-test.googlevideo.com/videoplayback/ad.ts'}});
 if(u.hostname==='rr1---sn-test.googlevideo.com')return new Response(new Uint8Array(2048).fill(0x47),{headers:{'Content-Type':'video/mp2t'}});
 if(u.href===segment)return new Response(htmlSegment?'<html>login</html>':new Uint8Array(2048).fill(0x47),{headers:{'Content-Type':htmlSegment?'text/html':'video/mp2t'}});
 if(u.hostname==='townnews.g-mana.live')return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nplaylist_0.m3u8\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
 throw Error('unexpected fixture request');
};
for(const c of OFFICIAL_CHANNELS)assert.ok(isOfficialLivePage(c.page));
for(const c of EXTRA_OFFICIAL_CHANNELS)assert.ok(isOfficialLivePage(c.page));
const kctv=EXTRA_OFFICIAL_CHANNELS[1],koam=EXTRA_OFFICIAL_CHANNELS[3],amagi='https://amg01499-amg01499c3-morganmurphy-us-4207.playouts.now.amagi.tv';
assert.equal(officialMediaAllowed(kctv.page,'https://live-streaming-mcdn.api.graylive.quickplay.com/kctv-xos1-input-1/kctv-xos1-input-1-v4.isml/segment.ts'),true);
assert.equal(officialMediaAllowed(kctv.page,'https://live-streaming-mcdn.api.graylive.quickplay.com/kctv-xos1-input-2/kctv-xos1-input-2-v4.isml/segment.ts'),false);
assert.equal(officialMediaAllowed(koam.page,amagi+'/ts-us-e2-n2/playlist/amg01499-morganmurphyfast-koam-morganmurphyus/segment.ts'),true);
assert.equal(officialMediaAllowed(koam.page,amagi+'/playlist720p_202055.ts'),true);
for(const value of [amagi+'/playlist/other-station/segment.ts',amagi+'/unrelated/segment.ts',amagi.replace('.tv','.tv.evil.org')+'/playlist/amg01499-morganmurphyfast-koam-morganmurphyus/a.ts'])assert.equal(officialMediaAllowed(koam.page,value),false);
assert.equal(officialMediaAllowed(kwch.page,amagi+'/playlist/amg01499-morganmurphyfast-koam-morganmurphyus/a.ts'),false);
for(const u of ['http://www.kwch.com/livestream/','https://www.kwch.com/livestream/?url=https://127.0.0.1/','https://www.kwch.com.evil.org/livestream/','https://user:pass@www.kwch.com/livestream/','https://www.kwch.com:444/livestream/','https://www.kwch.com/news/'])assert.equal(isOfficialLivePage(u),false);
for(const u of ['https://127.0.0.1/video.ts','https://ssai1.field59.com.evil.org/kake1/a.ts','https://ssai1.field59.com/other/a.ts','https://live-streaming-mcdn.api.graylive.quickplay.com/wibw-xos1-input-1/a.ts'])assert.equal(officialMediaAllowed(kwch.page,u),false);
assert.ok(officialMediaAllowed(kake.page,'https://ssai1.field59.com/kake1/a.ts'));
const kakeSlate='https://evrideo.g-mana.online/gmana-assets/slates/8a1b14d7-36b9-4901-b333-e62abebbb973/slate.ts';
assert.equal(officialMediaAllowed(kake.page,kakeSlate),true,'retain the public TownNews player gap/ad slate');
for(const u of [kakeSlate.replace('8a1b14d7','00000000'),kakeSlate.replace('evrideo.g-mana.online','evrideo.g-mana.online.evil.org'),kakeSlate.replace('/gmana-assets/slates/','/unrelated/')])assert.equal(officialMediaAllowed(kake.page,u),false);
assert.equal(officialMediaAllowed(kwch.page,kakeSlate),false);
assert.equal(officialMediaAllowed(kake.page,variant),false);assert.equal(officialMediaAllowed(kwch.page,'https://user:pass@dai.google.com/linear/a.ts'),false);
let resolved=await resolveOfficialLive(kwch.page,{fetcher});assert.ok(resolved.url.startsWith('https://pubads.g.doubleclick.net/ssai/event/'));assert.ok(resolved.officialHeartbeat);assert.equal(new URL(resolved.url).searchParams.get('ads.npa'),'1');
assert.deepEqual(await inspectCatalogSource({mode:'gnula',page:kwch.page},{fetcher}),{ok:true,check:'playlist_and_segment'});
adRedirect=true;assert.equal((await inspectCatalogSource({mode:'gnula',page:kwch.page},{fetcher})).ok,true,'official Google SSAI ad redirects must remain playable');adRedirect=false;
for(const u of ['https://rr1---sn-test.googlevideo.com.evil.org/videoplayback/ad.ts','https://rr1---sn-test.googlevideo.com/other/ad.ts'])assert.equal(officialMediaAllowed(kwch.page,u),false);
redirectAttack=true;assert.equal((await inspectCatalogSource({mode:'gnula',page:kwch.page},{fetcher})).ok,false);assert.ok(!calls.some(c=>new URL(c.url).hostname==='127.0.0.1'));redirectAttack=false;
htmlSegment=true;assert.equal((await inspectCatalogSource({mode:'gnula',page:kwch.page},{fetcher})).ok,false);htmlSegment=false;
for(const flag of ['blackout','drm','denied']){
 if(flag==='blackout')blackout=true;if(flag==='drm')drm=true;if(flag==='denied')denied=true;
 await assert.rejects(()=>resolveOfficialLive(kwch.page,{fetcher}));blackout=drm=denied=false;
}
resolved=await resolveOfficialLive(kake.page,{fetcher});assert.equal(resolved.officialPage,kake.page);
const clock=Date.now;let now=clock();Date.now=()=>now;
try{
 const state=(await resolveOfficialLive(kwch.page,{fetcher})).officialHeartbeat;await officialHeartbeat(state,{fetcher});assert.equal(heartbeatCalls,0);now+=60000;
 await Promise.all([officialHeartbeat(state,{fetcher}),officialHeartbeat(state,{fetcher})]);assert.equal(heartbeatCalls,1);now+=60000;await officialHeartbeat(state,{fetcher});assert.equal(heartbeatCalls,2);
}finally{Date.now=clock;}
// Existing authenticated native route, signed playlists and cross-origin media.
const row={...kwch,type:'movie',source:'TV LOCAL OFICIAL',mode:'gnula',year:null,adult:false,visible:true,profileServer:'exclusive',playbackRevision:1,createdAt:1,episodes:[]},permissions={tv:true,movies:true,series:true,adults:false},tickets=new Map();let seq=0;
const service=createExclusiveService({fetcher,resolveGnula(){throw Error('wrong resolver')},directory:async(env,path,body)=>path==='/exclusive-read'?Response.json({revision:1,items:[row]}):path==='/exclusive-item-read'?Response.json(row):Response.json({lease_id:'test-lease'}),sessionCall:async()=>new Response('ok'),ticket:async(env,data)=>{const t='test-ticket-'+(++seq);tickets.set(t,data);return t;},unticket:async(env,t)=>tickets.get(t),requestConnectionClient:()=>({}),guardXtreamResponse:r=>r});
const session={sid:'test-session',uid:'test-customer',permissions,exp:Date.now()+3600000};
const request=new Request('https://api.snaptvnow.com/exclusive/test/user/local-kwch-news.m3u8');
let response=await service.xtream(request,{},null,async()=>({session}));assert.equal(response.status,200);let text=await response.text();assert.ok(!text.includes('quickplay.com'));assert.ok(!text.includes('dai.google.com'));
let child=text.split('\n').find(l=>l.startsWith('https://'));response=await service.media(new Request(child),{});assert.equal(response.status,200);text=await response.text();child=text.split('\n').find(l=>l.startsWith('https://'));response=await service.media(new Request(child),{});assert.equal(response.status,200);assert.equal((await response.arrayBuffer()).byteLength,2048);
assert.equal(exclusivePublic(row).type,'movie');assert.equal(visibleExclusive(row,{...permissions,tv:false}),false);
assert.equal((await service.catalog({},permissions,'',{legacy:true})).items.length,0);
const store={data:new Map([['exclusive:index',{revision:1,ids:[],updatedAt:1}]]),async get(k){return this.data.get(k)},async put(k,v){this.data.set(k,v)},async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)))}};
response=await exclusiveCatalogRoute(store,'/exclusive-save',{item:row,revision:0,actor:'test-owner'});assert.equal(response.status,200);assert.ok(validExclusiveBackup(await exportExclusives(store)));
console.log('PASS: official public player authorization, ads preservation, blackouts/DRM/403 rejection, scoped redirects/resources, video-byte checks, heartbeat coalescing, unchanged native playback, permissions and backups.');
