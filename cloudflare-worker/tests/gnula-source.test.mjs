import assert from 'node:assert/strict';
import {resolveGnula} from '../src/gnula-source.mjs';
const page='https://ww3.gnulahd.nu/dragon-ball-super-beerus-1x01/',embed='https://voe.sx/e/episode123';
const cdn='https://ugc-cdn-caching-test.cloudwindow-route.com/path/master.m3u8';
const rot13=s=>s.replace(/[a-zA-Z]/g,c=>String.fromCharCode(c.charCodeAt(0)+(c.toLowerCase()<='m'?13:-13)));
function player(source){const config=btoa(JSON.stringify({source}));return '<script type="application/json">'+JSON.stringify([rot13(btoa(Array.from(config).reverse().map(c=>String.fromCharCode(c.charCodeAt(0)+3)).join('')))])+'</script>';}
const key='public-page-key',html='window.GNRD={pid:123,tok:"public.page-token",k:"'+btoa(key)+'"};';
const data={t:'Capítulo español',langs:[{label:'Subtitulado',servers:[{src:'https://voe.sx/e/wrongdub'}]},{label:'Latino',servers:[{src:'https://vidaraa.cc/e/unsupported'},{src:'https://127.0.0.1/private'},{src:embed}]}]};
const encoded=btoa(Array.from(new TextEncoder().encode(JSON.stringify(data)),(byte,i)=>String.fromCharCode(byte^key.charCodeAt(i%key.length))).join(''));
let generation=0,sourceOverride,redirectOverride,cdnRedirect,large=false;const calls=[];
const fetcher=async(value,options={})=>{
 const u=new URL(value);calls.push(u.href);assert.equal(options.redirect,'manual');
 if(u.href===page){generation++;return new Response(large?'x'.repeat(1000001):html);}
 if(u.origin==='https://ww3.gnulahd.nu'&&u.pathname==='/wp-json/gnrd/v1/player'){
  assert.equal(u.searchParams.get('id'),'123');assert.equal(u.searchParams.get('t'),'public.page-token');
  assert.equal(options.headers['X-Requested-With'],'gnrd');assert.equal(options.headers.Referer,page);return Response.json({p:encoded});
 }
 if(u.href===embed)return new Response('window.location.href = "'+(redirectOverride||'https://megankiddifference.com/e/episode123')+'";');
 if(u.href==='https://megankiddifference.com/e/episode123')return new Response(player(sourceOverride||cdn+'?signed='+generation));
 if(u.origin===new URL(cdn).origin){if(cdnRedirect)return new Response(null,{status:302,headers:{location:cdnRedirect}});return new Response('#EXTM3U\nvideo/index.m3u8\n');}
 throw Error('Unexpected network request: '+u.origin+u.pathname);
};
assert.equal(await resolveGnula(page,null,{fetcher}),cdn+'?signed=1');
assert.equal(await resolveGnula(page,null,{fetcher}),cdn+'?signed=2','every playback obtains a new signature from the saved page');
const moviePage='https://ww3.gnulahd.nu/ver/test-film/';
assert.equal(await resolveGnula(moviePage,null,{fetcher:async(url,options)=>url===moviePage?new Response(html.replace('};',',firstEp:0,lastEp:0};')):fetcher(url,{...options,headers:{...options.headers,Referer:page}})}),cdn+'?signed=2','movie player configuration with firstEp/lastEp uses the same validated resolver');
assert.ok(!calls.some(url=>url.includes('wrongdub')||url.includes('127.0.0.1')||url.includes('vidaraa.cc')),'unsupported hosts and other dubs are never fetched');
assert.ok(calls.some(url=>url.startsWith('https://megankiddifference.com/')),'the current verified VOE redirect is supported');
for(const destination of ['https://127.0.0.1/private','https://untrusted.invalid/e/episode123','https://user:pass@megankiddifference.com/e/episode123','https://megankiddifference.com/e/differentepisode']){
 redirectOverride=destination;const before=calls.length;await assert.rejects(resolveGnula(page,null,{fetcher}),/media_missing/);assert.ok(!calls.slice(before).includes(destination));
}redirectOverride=null;
for(const destination of ['https://127.0.0.1/private.m3u8','https://untrusted.invalid/private.m3u8','http://ugc-cdn-caching-test.cloudwindow-route.com/private.m3u8']){
 sourceOverride=destination;const before=calls.length;await assert.rejects(resolveGnula(page,null,{fetcher}),/media_missing/);assert.ok(!calls.slice(before).includes(destination));
}sourceOverride=null;
cdnRedirect='https://127.0.0.1/private.m3u8';await assert.rejects(resolveGnula(page,null,{fetcher}),/media_missing/);assert.ok(!calls.includes(cdnRedirect));cdnRedirect=null;
large=true;await assert.rejects(resolveGnula(page,null,{fetcher}),/source_too_large/);large=false;
await assert.rejects(resolveGnula('https://127.0.0.1/private',null,{fetcher}),/source_not_allowed/);
const oldPage='https://www2.gnula.one/movie/existing/';
assert.equal(await resolveGnula(oldPage,'https://127.0.0.1/private',{fetcher:async(url,options)=>url===oldPage?new Response('<div data-iframe="'+btoa('<iframe src="'+embed+'"></iframe>')+'">'):fetcher(url,options)}),cdn+'?signed='+generation,'existing encoded Gnula pages remain supported and arbitrary preferred embeds are ignored');
const uq='https://uqload.vc/embed-abc123.html',uqSource='https://strm1.uqload.vc/test/video.m3u8';
assert.equal(await resolveGnula(oldPage,null,{fetcher:async url=>new Response(url===oldPage?uq:url===uq?'file: "'+uqSource+'"':'#EXTM3U\nchunk.ts\n')}),uqSource);
console.log('PASS: current GnulaHD episode API, Latino selection, fresh signatures, VOE redirect, legacy Gnula/Uqload and bounded allowlisted fetches.');
