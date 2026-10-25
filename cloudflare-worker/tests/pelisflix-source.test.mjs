import assert from 'node:assert/strict';
import {resolveGnula,supportedSourcePage,GNULA_PAGE_HOSTS} from '../src/gnula-source.mjs';
import {pelisflixEmbeds} from '../src/pelisflix-source.mjs';
const page='https://pelisflix200.city/episodio/yaga-1x1/',embed='https://voe.sx/e/episode1';
const button=(url,label='CASTELLANO')=>'<div data-url="'+btoa(url)+'" class="Button sgty"><span>01</span><span>'+label+'<span>HD • Voe</span></span></div>';
const wrapped=target=>'https://nupload.my/iframe/?url='+encodeURIComponent(target);
const html=button('https://nupload.my/watch/unsupported')+button(wrapped(embed));
assert.deepEqual(pelisflixEmbeds(html),[embed]);
assert.deepEqual(pelisflixEmbeds(html+button(wrapped('https://voe.sx/e/latin'),'LATINO')),[ 'https://voe.sx/e/latin' ]);
assert.deepEqual(pelisflixEmbeds(button(wrapped(embed),'SUBTITULADO')),[embed]);
for(const target of ['https://127.0.0.1/e/private','https://voe.sx.evil.test/e/episode1','http://voe.sx/e/episode1','https://user:pass@voe.sx/e/episode1','https://voe.sx/e/episode1?secret=1','https://voe.sx/e/episode1#fragment'])assert.deepEqual(pelisflixEmbeds(button(wrapped(target))),[]);
for(const url of ['https://user:pass@nupload.my/iframe/?url='+encodeURIComponent(embed),'https://nupload.my/iframe/?url='+encodeURIComponent(embed)+'&url=other','https://nupload.my.evil.test/iframe/?url='+encodeURIComponent(embed)])assert.deepEqual(pelisflixEmbeds(button(url)),[]);
assert.deepEqual(pelisflixEmbeds('<script>data-url="'+btoa(wrapped(embed))+'"</script>'+button(wrapped(embed),'Publicidad')),[]);
assert.ok(supportedSourcePage(new URL(page)));
assert.ok(!GNULA_PAGE_HOSTS.has('pelisflix200.city'),'movie/Beerus automation allowlists remain unchanged');
for(const url of ['https://pelisflix201.city/episodio/yaga-1x1/','https://pelisflix200.city/wp-admin/','https://pelisflix200.city/episodio/yaga-1x1/?redirect=evil'])assert.ok(!supportedSourcePage(new URL(url)));
const cdn='https://ugc-cdn-caching-test.cloudwindow-route.com/episode/master.m3u8';
const rot13=s=>s.replace(/[a-zA-Z]/g,c=>String.fromCharCode(c.charCodeAt(0)+(c.toLowerCase()<='m'?13:-13)));
const player=source=>'<script type="application/json">'+JSON.stringify([rot13(btoa(Array.from(btoa(JSON.stringify({source}))).reverse().map(c=>String.fromCharCode(c.charCodeAt(0)+3)).join('')))])+'</script>';
let generation=0,redirect='https://jamespatterncamera.com/e/episode1',pageRedirect,deny=false;const calls=[];
const fetcher=async(url,options)=>{
 calls.push(url);assert.equal(options.redirect,'manual');assert.ok(!new Headers(options.headers).has('authorization'));
 if(url===page){generation++;return pageRedirect?new Response(null,{status:302,headers:{location:pageRedirect}}):new Response(html);}
 if(url===embed)return new Response('window.location.href="'+redirect+'"');
 if(url==='https://jamespatterncamera.com/e/episode1')return new Response(player(cdn+'?signature='+generation));
 if(url.startsWith(cdn))return deny?new Response('Forbidden',{status:403}):new Response('#EXTM3U\nvideo.m3u8');
 throw Error('Unexpected destination');
};
assert.equal(await resolveGnula(page,null,{fetcher}),cdn+'?signature=1');
assert.equal(await resolveGnula(page,'https://voe.sx/e/unrelated',{fetcher}),cdn+'?signature=2','every playback refreshes the URL and stale preferred embeds cannot override page language/content');
for(const target of ['https://jamespatterncamera.com/e/another','https://127.0.0.1/e/episode1','https://unreviewed.test/e/episode1']){
 redirect=target;const start=calls.length;await assert.rejects(resolveGnula(page,null,{fetcher}),/media_missing/);assert.ok(!calls.slice(start).includes(target));
}
redirect='https://jamespatterncamera.com/e/episode1';deny=true;
await assert.rejects(resolveGnula(page,null,{fetcher}),/media_missing/,'403 is reported rather than bypassed');deny=false;
pageRedirect='https://unreviewed.test/episodio/yaga-1x1/';
await assert.rejects(resolveGnula(page,null,{fetcher}),/source_not_allowed/);assert.ok(!calls.includes(pageRedirect));
console.log('PASS: Pelisflix reviewed pages, wrapper extraction, Spanish preference, fresh VOE signatures, same-episode redirects, SSRF boundaries and 403 handling.');
