import assert from 'node:assert/strict';
import test from 'node:test';
import {COMEDY_GNULA_EPISODES,isComedyGnulaPage,resolveComedyGnula,comedyGnulaMediaAllowed,comedyGnulaMediaHeaders} from '../src/comedy-gnula-source.mjs';
const host='s14-s1001604.97bf1.com',prefix='/hls/ABCDEFGHIJKLMNOPQRSTUVWXYZ123456/',token='test-token:123';
const root=`https://${host}${prefix}`,media=file=>root+file+'?'+new URLSearchParams({token});
const html='<script>let apiURL="/api/stream";JSON.stringify({filecode:filecode,device:detectDevice(),codecs:cs})</script>';
function payload(d,overrides={}) {return {filecode:new URL(d.embed).pathname.split('/').pop(),title:btoa('Muertos S.L..2024')+`.${d.season}x${String(d.episode).padStart(2,'0')}.CAST`,streaming_url:media('master.m3u8'),vast_ads:'',...overrides};}
function fixture(d,{data=payload(d),embedResponse,apiResponse,master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=5000000\nindex_1920x1080.m3u8?'+new URLSearchParams({token})+'\n'}={}) {
 const calls=[];
 const fetcher=async(url,options)=>{
  calls.push({url,options});assert.equal(options.redirect,'manual');
  assert.equal(options.headers['X-Gn-Scr'],undefined);assert.equal(options.headers['X-Gn-Dev'],undefined);
  if(url===d.embed)return embedResponse?embedResponse():new Response(html);
  if(url===new URL('/api/stream',d.embed).href){assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{filecode:new URL(d.embed).pathname.split('/').pop(),device:'web',codecs:[]});return apiResponse?apiResponse():Response.json(data);}
  if(url===data.streaming_url)return new Response(master,{headers:{'content-type':'application/vnd.apple.mpegurl'}});
  throw Error('unexpected fetch '+url);
 };
 return {fetcher,calls};
}
test('finite catalogue contains 26 reviewed pages in all four seasons',()=>{
 assert.equal(COMEDY_GNULA_EPISODES.length,26);
 assert.deepEqual([1,2,3,4].map(s=>COMEDY_GNULA_EPISODES.filter(d=>d.season===s).length),[8,6,6,6]);
 for(const d of COMEDY_GNULA_EPISODES){assert.equal(isComedyGnulaPage(d.page),true);assert.equal(isComedyGnulaPage(new URL(d.page)),true);assert.equal(Object.isFrozen(d),true);}
 for(const u of ['https://ww3.gnulahd.nu/muertos-s-l-1x09/','https://ww3.gnulahd.nu/muertos-s-l-5x01/','https://ww3.gnulahd.nu/machos-alfa-1x01/','https://ww3.gnulahd.nu/muertos-s-l-1x01/?foo=bar','https://ww3.gnulahd.nu/muertos-s-l-1x01/#fragment','http://ww3.gnulahd.nu/muertos-s-l-1x01/','https://ww3.gnulahd.nu.evil.test/muertos-s-l-1x01/','https://user:pass@ww3.gnulahd.nu/muertos-s-l-1x01/','https://ww3.gnulahd.nu/%2e%2e/muertos-s-l-1x01/'])assert.equal(isComedyGnulaPage(u),false,u);
});
test('every reviewed binding resolves with the ordinary baseline player request',async()=>{
 for(const d of COMEDY_GNULA_EPISODES){
  const {fetcher,calls}=fixture(d);const result=await resolveComedyGnula(d.page,{fetcher});
  assert.equal(result.url,media('master.m3u8'));assert.equal(calls.length,3);
  assert.equal(comedyGnulaMediaAllowed(d.page,result.url,result.context),true);
  assert.deepEqual(comedyGnulaMediaHeaders(d.page,result.context),{Referer:new URL(d.embed).origin+'/',Origin:new URL(d.embed).origin});
 }
});
test('resource capabilities bind one episode, host, directory and signature',async()=>{
 const d=COMEDY_GNULA_EPISODES[0],{fetcher}=fixture(d),{context}=await resolveComedyGnula(d.page,{fetcher});
 for(const file of ['master.m3u8','index_1920x1080.m3u8','seg_1920x1080_000.woff2','seg_1920x1080_999.woff2','seg_1920x1080_000.woff','seg_1920x1080_000.js','seg_1920x1080_000.css'])assert.equal(comedyGnulaMediaAllowed(d.page,media(file),context),true);
 for(const url of [root+'seg_1920x1080_000.woff2',media('master.m3u8')+'&token=second',media('master.m3u8')+'&url=https://evil.test/',media('master.m3u8').replace('test-token','other-token'),media('master.m3u8').replace(host,'127.0.0.1'),media('master.m3u8').replace(host,host+'.evil.test'),media('master.m3u8').replace(prefix,prefix+'../'),media('%2e%2e/private.woff2'),media('%2fprivate.woff2'),media('private.html'),media('folder/../master.m3u8'),media('seg_1920x1080_000.woff2')+'#fragment',media('master.m3u8').replace('https:','http:'),media('master.m3u8').replace(host,'user:pass@'+host)])assert.equal(comedyGnulaMediaAllowed(d.page,url,context),false,url);
 assert.equal(comedyGnulaMediaAllowed(COMEDY_GNULA_EPISODES[1].page,media('master.m3u8'),context),false);
 for(const changed of [{host:'evil.test'},{prefix:'/'},{token:''},{episode:2},{embed:COMEDY_GNULA_EPISODES[1].embed}])assert.equal(comedyGnulaMediaAllowed(d.page,media('master.m3u8'),{...context,...changed}),false);
});
test('wrong title, audio, episode, file, advertising and unreviewed media fail closed',async()=>{
 const d=COMEDY_GNULA_EPISODES[0];
 for(const changed of [{title:btoa('Another Series.2024')+'.1x01.CAST'},{title:btoa('Muertos S.L..2024')+'.1x01.ENG'},{title:btoa('Muertos S.L..2024')+'.1x02.CAST'},{filecode:'otherPublicFile'},{vast_ads:'https://ads.example.test/vast.xml'},{drm:{type:'widevine'}},{streaming_url:'https://127.0.0.1/hls/ABCDEFGHIJKLMNOPQRSTUVWXYZ123456/master.m3u8?token=test'},{streaming_url:media('master.m3u8').replace(host,'s99-s999.97bf1.com')},{streaming_url:root+'master.m3u8?token=ok&url=https://evil.test/'}]){
  const {fetcher}=fixture(d,{data:payload(d,changed)});await assert.rejects(resolveComedyGnula(d.page,{fetcher}),/comedy_source_unavailable/);
 }
});
test('HLS must be a media manifest whose children stay inside the episode capability',async()=>{
 const d=COMEDY_GNULA_EPISODES[0];
 for(const master of ['<html>Login</html>','#EXTM3U\n','#EXTM3U\nhttps://evil.test/video.ts\n','#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key.key"\nindex_1920x1080.m3u8?token='+token+'\n','#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,URI="https://evil.test/audio.m3u8"\nindex_1920x1080.m3u8?token='+token+'\n']){
  const {fetcher}=fixture(d,{master});await assert.rejects(resolveComedyGnula(d.page,{fetcher}),/comedy_source_unavailable/);
 }
});
test('access errors, changed protocol, redirects and large responses do not trigger bypasses',async()=>{
 const d=COMEDY_GNULA_EPISODES[0];
 for(const embedResponse of [()=>new Response('forbidden',{status:403}),()=>new Response('challenge'),()=>new Response('',{status:302,headers:{location:'https://127.0.0.1/private'}}),()=>new Response(html,{headers:{'content-length':'1000001'}})]){
  const {fetcher,calls}=fixture(d,{embedResponse});await assert.rejects(resolveComedyGnula(d.page,{fetcher}),/comedy_source_unavailable/);assert.equal(calls.length,1);
 }
 for(const apiResponse of [()=>new Response('forbidden',{status:403}),()=>new Response('',{status:307,headers:{location:new URL('/api/other',d.embed).href}}),()=>new Response('{bad json')]){
  const {fetcher,calls}=fixture(d,{apiResponse});await assert.rejects(resolveComedyGnula(d.page,{fetcher}),/comedy_source_unavailable/);assert.equal(calls.length,2);
 }
 const {fetcher,calls}=fixture(d);const controller=new AbortController();controller.abort(Error('cancelled'));
 await assert.rejects(resolveComedyGnula(d.page,{fetcher,signal:controller.signal}),/cancelled/);assert.equal(calls.length,0);
});

test('only the three observed CDN hosts are admitted by fresh player config',async()=>{
 const d=COMEDY_GNULA_EPISODES[0];
 for(const cdn of ['s14-s1001604.97bf1.com','s13-s501740.s1q2105.com','s7-5042yyg.s1q2105.com']){
  const data=payload(d,{streaming_url:media('master.m3u8').replace(host,cdn)});
  const {fetcher}=fixture(d,{data});const r=await resolveComedyGnula(d.page,{fetcher});
  assert.equal(r.context.host,cdn);assert.equal(comedyGnulaMediaAllowed(d.page,r.url,r.context),true);
 }
});
