import assert from 'node:assert/strict';
import {REGIONAL_CHANNELS,resolveRegionalLive,forgetRegionalLive,regionalMediaAllowed} from '../src/regional-live.mjs';
const channel=REGIONAL_CHANNELS.find(c=>c.id==='local-telemundo-noreste');
const primary='https://d2kowtvrzzi7ps.cloudfront.net/11602/'+channel.streamId+'/hls/master.m3u8?ads.xumo_channelId='+channel.streamId+'a';
const alternate='https://d368vp0qqzvkid.cloudfront.net/11603/'+channel.streamId+'/hls/master.m3u8?ads.xumo_channelId='+channel.streamId+'a';
const manifest='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=600000\nvariant.m3u8\n';
const descriptor=(p=primary,a=alternate)=>JSON.stringify({m3u8_url:p,national_m3u8_url:a}).replaceAll('"','&quot;');
const calls=[];
function makeFetcher({primaryResponse=()=>new Response(manifest),alternateResponse=()=>new Response(manifest),page=()=>new Response(descriptor()),onPrimary}={}){
 return async(value,options={})=>{
  const url=String(value);calls.push(url);
  assert.equal(options.redirect,'manual');const headers=new Headers(options.headers);
  for(const key of ['Range','Authorization','Cookie'])assert.equal(headers.has(key),false,'anonymous master probes must not send '+key);
  if(url===channel.page)return page();
  if(url===primary){onPrimary?.();return primaryResponse();}
  if(url===alternate)return alternateResponse();
  assert.fail('unreviewed destination: '+url);
 };
}
for(const primaryResponse of [()=>new Response('offline',{status:503}),()=>new Response('<html>not video</html>'),()=>new Response(null,{status:302,headers:{Location:'https://foreign.invalid/master.m3u8'}})]){
 calls.length=0;const result=await resolveRegionalLive(channel,{fetcher:makeFetcher({primaryResponse})});
 assert.equal(result.url,alternate);assert.deepEqual(calls,[channel.page,primary,alternate]);
}
// The public JSON fields can straddle transport chunks; neither route is lost.
calls.length=0;
const split=descriptor().indexOf('national_m3u8_url')-6,text=descriptor();
const page=()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(text.slice(0,split)));controller.enqueue(new TextEncoder().encode(text.slice(split)));controller.close();}}));
assert.equal((await resolveRegionalLive(channel,{fetcher:makeFetcher({primaryResponse:()=>new Response(null,{status:503}),page})})).url,alternate);
// Earlier public station pages with only a primary descriptor stay compatible.
assert.equal((await resolveRegionalLive(channel,{fetcher:makeFetcher({page:()=>new Response(JSON.stringify({m3u8_url:primary}))})})).url,primary);
for(const value of ['https://foreign.invalid/master.m3u8',primary.replace('https:','http:'),primary.replace(channel.streamId,'88889709'),primary.replace('https://','https://user:password@'),primary+'&token=private-session',primary+'#fragment']){
 calls.length=0;await assert.rejects(()=>resolveRegionalLive(channel,{fetcher:makeFetcher({page:()=>new Response(descriptor(value,value))})}),/official_live_unavailable/);
 assert.deepEqual(calls,[channel.page],'foreign/session-bearing sources must never be fetched or cached');
}
calls.length=0;const bothBad=makeFetcher({primaryResponse:()=>new Response('unavailable',{status:503}),alternateResponse:()=>new Response('<html>not video</html>')});
for(let n=0;n<2;n++)await assert.rejects(()=>resolveRegionalLive(channel,{fetcher:bothBad,cachePublicPages:true}),/official_live_unavailable/);
assert.equal(calls.length,6,'failed candidates are not cached as a usable source');
calls.length=0;const controller=new AbortController();
await assert.rejects(()=>resolveRegionalLive(channel,{signal:controller.signal,fetcher:makeFetcher({onPrimary:()=>controller.abort(Error('viewer stopped')),primaryResponse:()=>new Response(null,{status:503})})}));
assert.deepEqual(calls,[channel.page,primary],'viewer cancellation must not start a fallback request');
// Cache only the selected public master, not bodies, session manifests or bytes.
const realNow=Date.now;let clock=Date.parse('2026-11-04T22:00:00Z'),healthy=false;Date.now=()=>clock;
try{
 calls.length=0;const fetcher=makeFetcher({primaryResponse:()=>new Response(healthy?manifest:'offline',{status:healthy?200:503})}),options={fetcher,cachePublicPages:true};
 assert.equal((await resolveRegionalLive(channel,options)).url,alternate);const before=calls.length;healthy=true;
 assert.equal((await resolveRegionalLive(channel,options)).url,alternate);assert.equal(calls.length,before,'60s metadata reuse avoids more startup requests');
 clock+=60001;assert.equal((await resolveRegionalLive(channel,options)).url,primary);assert.equal(calls.length,before+2);
 healthy=false;await forgetRegionalLive(channel,options);assert.equal((await resolveRegionalLive(channel,options)).url,alternate);
}finally{Date.now=realNow;}
const account='3fec3e5cac39a52b2132f9c66c83dae043dc17d4',session='11111111-1111-1111-1111-111111111111';
for(const [host,root,playout] of [['d2kowtvrzzi7ps.cloudfront.net','11602','prod_default_nbc'],['d368vp0qqzvkid.cloudfront.net','11603','prod_default_nbc-direct']]){
 const base='https://'+host;
 for(const path of ['/'+root+'/'+channel.streamId+'/hls/master.m3u8','/manifest/'+account+'/'+playout+'/'+session+'/0.m3u8','/segment/'+account+'/'+playout+'/ad.ts'])assert.equal(regionalMediaAllowed(channel,new URL(base+path)),true);
 for(const value of [base+'/'+root+'/88889709/hls/master.m3u8',base+'/manifest/'+'0'.repeat(40)+'/'+playout+'/'+session+'/0.m3u8',base.replace('https:','http:')+'/'+root+'/'+channel.streamId+'/hls/master.m3u8',base+':444/'+root+'/'+channel.streamId+'/hls/master.m3u8',base+'/'+root+'/'+channel.streamId+'/hls/master.m3u8#fragment',base.replace('https://','https://u:p@')+'/'+root+'/'+channel.streamId+'/hls/master.m3u8',base+'/'+root+'/'+channel.streamId+'/hls/%2fprivate'])assert.equal(regionalMediaAllowed(channel,new URL(value)),false,value);
}
console.log('PASS: exact NBCU primary/alternate masters, 503/HTML/redirect fallback, split descriptors, cancellation, 60s cache/recovery, failed-probe isolation and CDN/channel/session boundaries.');
