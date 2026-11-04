import assert from 'node:assert/strict';
import {isEmpressPage,resolveEmpressSource,empressMediaAllowed,empressMediaHeaders} from '../src/empress-source.mjs';
const ids=['qbx1bmzqqoxm','zhbsadlqzyhb','hcmxykc2a6yu','ifq0dewv8v1u'];
const peli=n=>'https://pelisflix200.rest/episodio/la-emperatriz-divorciada-1x'+n+'/';
const tudu=n=>'https://tudorama.com/ver/the-remarried-empress-s1x'+n+'/';
const wrapper='https://nupload.my/watch/'+'A'.repeat(44),cdn='ugc-cdn-caching-fixture.cloudwindow-route.com';
const button=(url,label='CASTELLANO')=>'<div data-url="'+btoa(url)+'"><span>'+label+'</span></div>';
const root='https://sv2.ibra.lat/';
const player=session=>{
 const offset=1406836,array=Array.from(root,c=>btoa('Ab'+(c.charCodeAt(0)+offset)+'Cd'));
 return 'var encoded='+JSON.stringify(array)+'; var source="";encoded.forEach(function abc(value) { source += String.fromCharCode(parseInt(atob(value).replace(/\\D/g,\'\')) - '+offset+'); });var sesz="'+session+'";';
};
const rot13=s=>s.replace(/[a-zA-Z]/g,c=>String.fromCharCode(c.charCodeAt(0)+(c.toLowerCase()<='m'?13:-13)));
const voePlayer=payload=>'<script type="application/json">'+JSON.stringify([rot13(btoa(Array.from(btoa(JSON.stringify(payload))).reverse().map(c=>String.fromCharCode(c.charCodeAt(0)+3)).join('')))])+'</script>';
let generation=0,mode='',pageNumber=1,redirect='';const calls=[];
const fetcher=async(url,options)=>{
 calls.push(url);assert.equal(options.redirect,'manual');assert.ok(options.signal instanceof AbortSignal);
 const headers=new Headers(options.headers);for(const key of ['cookie','authorization','x-authorization'])assert.equal(headers.has(key),false);
 if(url===peli(pageNumber)){
  if(mode==='page-redirect')return new Response(null,{status:302,headers:{location:redirect}});
  const title=mode==='wrong-heading'?pageNumber+1:pageNumber;
  return new Response('<h1>Ver La emperatriz divorciada Episodio '+title+' Temporada 1</h1>'+button(mode==='private-wrapper'?'https://127.0.0.1/private':wrapper,mode==='wrong-dub'?'SUBTITULADO':'CASTELLANO'));
 }
 if(url===wrapper){
  assert.equal(headers.get('Referer'),peli(pageNumber));assert.equal(headers.has('Origin'),false);generation++;
  if(mode==='wrapper-redirect')return new Response(null,{status:302,headers:{location:redirect}});
  return new Response(player('AnonymousPublicPlayerSession'+String(generation).padStart(8,'0')));
 }
 if(url.startsWith(root)){
  assert.equal(headers.get('Referer'),wrapper);assert.equal(headers.get('Origin'),'https://nupload.my');
  if(mode==='forbidden')return new Response('Forbidden',{status:403});
  if(mode==='not-hls')return new Response('<h1>video not available</h1>');
  if(mode==='master-redirect'&&new URL(url).pathname==='/')return new Response(null,{status:301,headers:{location:'/e1/17/abcdef123456.m3u8'}});
  const child=mode==='foreign-resource'?'https://127.0.0.1/secret':'https://sv2.ibra.lat/files/7/abcdef123456/video0.ts?m=fixture';
  return new Response('#EXTM3U\n#EXT-X-TARGETDURATION:7\n#EXTINF:7,\n'+child+'\n#EXT-X-ENDLIST');
 }
 if(url===tudu(pageNumber))return new Response('<h1>La emperatriz divorciada</h1><a href="https://cdn.tudorama.com/sub/download-6.php?id='+ids[pageNumber-1]+'">VOE</a>');
 if(url==='https://voe.sx/'+ids[pageNumber-1])return new Response('window.location.href="'+(redirect||'https://shannoncoldalready.com/'+ids[pageNumber-1])+'";');
 if(url==='https://shannoncoldalready.com/'+ids[pageNumber-1]){
  generation++;const n=mode==='wrong-episode'?pageNumber%4+1:pageNumber;
  const source='https://'+cdn+'/engine/hls2-c/01/18734/'+ids[pageNumber-1]+'_,n,.urlset/master.m3u8?signature='+generation;
  return new Response(voePlayer({source,title:'LED 0'+n+' SubEsp [Fixture].mp4',default_captions_language:mode==='wrong-captions'?'en':'es',audio_languages:[{countryCode:mode==='wrong-audio'?'es':'ko',language:mode==='wrong-audio'?'Spanish':'Korean'}],drm:mode==='drm'}));
 }
 if(new URL(url).hostname===cdn){if(mode==='forbidden')return new Response('Forbidden',{status:403});return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nindex-v1-a1.m3u8\n');}
 throw Error('unreviewed destination');
};
for(const n of [1,2,3,4]){
 pageNumber=n;mode='';redirect='';assert.equal(isEmpressPage(peli(n)),true);assert.equal(isEmpressPage(new URL(tudu(n))),true);
 for(const page of [peli(n),tudu(n)]){
  const a=await resolveEmpressSource(page,{fetcher}),b=await resolveEmpressSource(page,{fetcher});
  assert.notEqual(a.url,b.url,'every playback receives a fresh public-player signature/session');assert.equal(a.empressPage,page);
  assert.equal(empressMediaAllowed(page,a.url,a.empressContext),true);
  const prefix='https://'+a.empressContext.host+a.empressContext.prefix;
  for(const file of ['index.m3u8','video1.ts','init.mp4','audio.aac','key.key','captions.vtt'])assert.equal(empressMediaAllowed(page,prefix+file,a.empressContext),true);
  assert.equal(empressMediaAllowed(page,'https://127.0.0.1/private',a.empressContext),false);
  assert.equal(empressMediaAllowed(page,'https://'+a.empressContext.host+'/unrelated/segment.ts',a.empressContext),false);
  assert.equal(empressMediaAllowed(page,prefix+'%2e%2e/private.ts',a.empressContext),false);
  assert.equal(empressMediaAllowed(page,prefix+'file.html',a.empressContext),false);
  assert.equal(empressMediaAllowed(page,a.url,{...a.empressContext,episode:n%4+1}),false);
  assert.equal(empressMediaAllowed(page,a.url,{...a.empressContext,host:'127.0.0.1'}),false);
  assert.deepEqual(empressMediaHeaders(page,a.empressContext),page===peli(n)?{Referer:wrapper,Origin:'https://nupload.my'}:{});
 }
}
for(const page of [peli(5),tudu(0),peli(1)+'?',peli(1)+'?redirect=private',tudu(1)+'#',tudu(1)+'#other',peli(1).replace('https:','http:'),peli(1).replace('pelisflix200.rest','pelisflix200.city'),peli(1).replace('https://','https://user:password@'),peli(1).replace('/episodio/','/%2e%2e/episodio/'),'https://pelisflix200.rest/serie/la-emperatriz-divorciada/']){
 assert.equal(isEmpressPage(page),false);await assert.rejects(resolveEmpressSource(page,{fetcher}),/empress_source_unavailable/);
}
pageNumber=1;
mode='master-redirect';redirect='';const redirected=await resolveEmpressSource(peli(1),{fetcher});assert.equal(redirected.url,root+'e1/17/abcdef123456.m3u8');assert.equal(empressMediaAllowed(peli(1),redirected.url,redirected.empressContext),true);assert.equal(empressMediaAllowed(peli(1),root+'e1/17/abcdef987654.m3u8',redirected.empressContext),false,'a sibling file master cannot reuse this episode scope');
for(const failure of ['wrong-heading','wrong-dub','private-wrapper','foreign-resource','not-hls','forbidden']){mode=failure;await assert.rejects(resolveEmpressSource(peli(1),{fetcher}),/empress_source_unavailable/);}
for(const failure of ['wrong-episode','wrong-captions','wrong-audio','drm','forbidden']){mode=failure;redirect='';await assert.rejects(resolveEmpressSource(tudu(1),{fetcher}),/empress_source_unavailable/);}
for(const destination of ['https://127.0.0.1/private','https://shannoncoldalready.com/'+ids[1],'https://shannoncoldalready.com/'+ids[0]+'?session=foreign','https://unreviewed.example.com/'+ids[0]]){
 redirect=destination;mode='';const count=calls.length;await assert.rejects(resolveEmpressSource(tudu(1),{fetcher}),/empress_source_unavailable/);assert.ok(!calls.slice(count).includes(destination));
}
mode='wrapper-redirect';redirect='https://127.0.0.1/private';let count=calls.length;await assert.rejects(resolveEmpressSource(peli(1),{fetcher}));assert.ok(!calls.slice(count).includes(redirect));
mode='page-redirect';redirect='https://other.example.com/episode';count=calls.length;await assert.rejects(resolveEmpressSource(peli(1),{fetcher}));assert.ok(!calls.slice(count).includes(redirect));
const controller=new AbortController();controller.abort(Error('test_cancel'));count=calls.length;await assert.rejects(resolveEmpressSource(peli(1),{fetcher,signal:controller.signal}),/test_cancel/);assert.equal(calls.length,count);
assert.throws(()=>empressMediaHeaders(peli(1),{provider:'nupload',episode:1,wrapper:'https://127.0.0.1/private',host:'sv2.ibra.lat',prefix:'/files/7/abcdef123456/'}));
console.log('PASS: eight reviewed Empress pages, fresh anonymous sessions/signatures, Spanish/SubEsp separation, episode identity, same-file HLS scopes, safe public headers, SSRF/redirect/DRM/403 rejection and cancellation.');
