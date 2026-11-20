import assert from 'node:assert/strict';
import {isComedyPelisflixPage,resolveComedyPelisflix,comedyPelisflixMediaAllowed,comedyPelisflixMediaHeaders} from '../src/comedy-pelisflix-source.mjs';

const page='https://pelisflix200.date/episodio/machos-alfa-zhmk-5x2/';
const wrapper='https://nupload.my/watch/'+'a'.repeat(46),base='https://sv3.ibra.lat/',prefix='/files/e/e774a00334a/';
const token='a'.repeat(75),expires='1795200000',signature='a'.repeat(22);
const root=base+'?s='+token,segment=n=>base+prefix.slice(1)+'video'+n+'.ts?m='+signature+'&e='+expires;
function config(source=base){
 const values=Array.from(source,c=>btoa('abc'+(9029437+c.charCodeAt(0))+'xyz'));
 return 'var chars='+JSON.stringify(values)+';var result="";chars.forEach(function decode(value){ result += String.fromCharCode(parseInt(atob(value).replace(/\\D/g,\'\')) - 9029437); });var sesz="'+token+'";player.setup({file:result+"?s="+sesz+"",type:"hls"});';
}
function pageHtml(heading='Ver Machos alfa Episodio 2 Temporada 5',value=wrapper,language='CASTELLANO'){
 return '<h1 class="Title">'+heading+'</h1><div data-url="'+btoa(value)+'"><span>01</span><span>'+language+'<span>HD • Principal</span></span></div>';
}
const playlist='#EXTM3U\n#EXT-X-TARGETDURATION:10\n#EXTINF:4.64,\n'+segment(0)+'\n#EXTINF:8.6,\n'+segment(1)+'\n#EXT-X-ENDLIST\n';
const ts=new Uint8Array(188*7);for(let n=0;n<7;n++)ts[n*188]=0x47;
let html=pageHtml(),player=config(),manifest=playlist,media=ts,pageRedirect,playerRedirect,mediaRedirect,masterRedirect,large=false;const calls=[];
const fetcher=async(value,options={})=>{
 const u=new URL(value);calls.push(u.href);assert.equal(options.redirect,'manual');
 if(u.href===page)return pageRedirect?new Response(null,{status:302,headers:{location:pageRedirect}}):new Response(large?'x'.repeat(1000001):html);
 if(u.href===wrapper){assert.equal(options.headers.Referer,page);return playerRedirect?new Response(null,{status:302,headers:{location:playerRedirect}}):new Response(player);}
 if(u.href===root||u.href===base+'ab/cd/1234567890.m3u8'){
  assert.equal(options.headers.Referer,wrapper);assert.equal(options.headers.Origin,'https://nupload.my');
  return masterRedirect&&u.href===root?new Response(null,{status:302,headers:{location:masterRedirect}}):new Response(manifest);
 }
 if(u.href===segment(0)){
  assert.equal(options.headers.Range,'bytes=0-1315');assert.equal(options.headers.Referer,wrapper);
  return mediaRedirect?new Response(null,{status:302,headers:{location:mediaRedirect}}):new Response(media,{headers:{'Content-Type':'video/mp2t,text/html'}});
 }
 throw Error('unexpected request '+u.origin+u.pathname);
};
for(let season=1;season<=5;season++)for(let episode=1;episode<=[10,10,10,6,6][season-1];episode++)assert.ok(isComedyPelisflixPage('https://pelisflix200.date/episodio/machos-alfa-zhmk-'+season+'x'+episode+'/'));
for(const value of ['https://pelisflix200.date/episodio/machos-alfa-zhmk-4x7/','https://pelisflix200.date/episodio/machos-alfa-zhmk-1x11/','https://pelisflix200.date/episodio/other-5x2/','https://pelisflix200.date.evil.invalid/episodio/machos-alfa-zhmk-5x2/',page+'?episode=other','http://pelisflix200.date/episodio/machos-alfa-zhmk-5x2/'])assert.equal(isComedyPelisflixPage(value),false);
const resolved=await resolveComedyPelisflix(page,{fetcher});assert.equal(resolved.url,root);
assert.deepEqual(comedyPelisflixMediaHeaders(page,resolved.context),{Referer:wrapper,Origin:'https://nupload.my'});
assert.ok(comedyPelisflixMediaAllowed(page,root,resolved.context));assert.ok(comedyPelisflixMediaAllowed(page,segment(1),resolved.context));
for(const value of [base+'?s='+'b'.repeat(75),segment(2),segment(0).replace(expires,'1795300000'),segment(0)+'&extra=1',segment(0).replace('/e774a00334a/','/otherfile/'),segment(0).replace('sv3.ibra.lat','sv3.ibra.lat.evil.invalid'),segment(0).replace('https:','http:'),segment(0)+'#fragment',segment(0).replace('/video0.ts','/%2fvideo0.ts'),segment(0).replace('/video0.ts','/../private.ts')])assert.equal(comedyPelisflixMediaAllowed(page,value,resolved.context),false,value);
assert.equal(comedyPelisflixMediaAllowed(page.replace('5x2','5x1'),segment(0),resolved.context),false,'context is tied to the precise episode');
assert.equal(comedyPelisflixMediaAllowed(page,segment(0),{...resolved.context,host:'localhost'}),false);

// Signatures are resolved afresh; no persistent media URL is used on a new start.
const before=calls.filter(x=>x===wrapper).length;await resolveComedyPelisflix(page,{fetcher});assert.equal(calls.filter(x=>x===wrapper).length,before+1);
masterRedirect=base+'ab/cd/1234567890.m3u8';assert.equal((await resolveComedyPelisflix(page,{fetcher})).url,masterRedirect);masterRedirect=null;
for(const target of ['https://127.0.0.1/private','https://unknown.invalid/player',wrapper+'?next=1','https://nupload.my/watch/'+'b'.repeat(46)]){
 playerRedirect=target;const start=calls.length;await assert.rejects(resolveComedyPelisflix(page,{fetcher}),/comedy_source_unavailable/);assert.ok(!calls.slice(start).includes(target));
}playerRedirect=null;
for(const target of ['https://127.0.0.1/private.m3u8','https://sv3.ibra.lat/unreviewed/master.m3u8','https://sv2.ibra.lat/ab/cd/1234567890.m3u8']){
 masterRedirect=target;const start=calls.length;await assert.rejects(resolveComedyPelisflix(page,{fetcher}),/comedy_source_unavailable/);assert.ok(!calls.slice(start).includes(target));
}masterRedirect=null;
mediaRedirect='https://127.0.0.1/private.ts';await assert.rejects(resolveComedyPelisflix(page,{fetcher}),/comedy_source_unavailable/);assert.ok(!calls.includes(mediaRedirect));mediaRedirect=null;
pageRedirect=page.replace('.date','.invalid');await assert.rejects(resolveComedyPelisflix(page,{fetcher}),/comedy_source_unavailable/);assert.ok(!calls.includes(pageRedirect));pageRedirect=null;
for(const replacement of ['https://127.0.0.1/', 'https://sv3.ibra.lat.evil.invalid/', 'http://sv3.ibra.lat/']){player=config(replacement);await assert.rejects(resolveComedyPelisflix(page,{fetcher}),/comedy_source_unavailable/);}player=config();
player=player.replace('file:result','file:another');await assert.rejects(resolveComedyPelisflix(page,{fetcher}),/comedy_source_unavailable/);player=config();
for(const bad of [playlist.replace('video1.ts','video3.ts'),playlist.replace('sv3.ibra.lat/files','unknown.invalid/files'),playlist.replace('#EXT-X-ENDLIST',''),playlist.replace('#EXT-X-TARGETDURATION:10','#EXT-X-KEY:METHOD=SAMPLE-AES,URI="https://unknown.invalid/key"')]){manifest=bad;await assert.rejects(resolveComedyPelisflix(page,{fetcher}),/comedy_source_unavailable/);}manifest=playlist;
media='<html><body><h1>File deleted by DMCA request</h1></body></html>';await assert.rejects(resolveComedyPelisflix(page,{fetcher}),/comedy_media_removed/);
media='<html>200 without media</html>';await assert.rejects(resolveComedyPelisflix(page,{fetcher}),/comedy_media_missing/);media=ts;
html=pageHtml('Ver Machos alfa Episodio 1 Temporada 5');await assert.rejects(resolveComedyPelisflix(page,{fetcher}),/comedy_source_unavailable/);
html=pageHtml(undefined,wrapper,'LATINO');await assert.rejects(resolveComedyPelisflix(page,{fetcher}),/comedy_source_unavailable/);html=pageHtml();
large=true;await assert.rejects(resolveComedyPelisflix(page,{fetcher}),/comedy_source_unavailable/);large=false;
const controller=new AbortController();controller.abort(Error('test-aborted'));await assert.rejects(resolveComedyPelisflix(page,{fetcher,signal:controller.signal}),/test-aborted/);
console.log('PASS: 42 finite Machos alfa pages, CASTELLANO player, public config decoding, manifest/file scoping, real TS bytes, fail-closed removal detection, safe redirects and bounded requests.');
