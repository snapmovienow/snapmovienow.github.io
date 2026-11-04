import test from 'node:test';
import assert from 'node:assert/strict';
import {OWNED_MEDIA_FILES,OWNED_MEDIA_ORIGIN,OWNED_MEDIA_SERIES,ownedMediaDescriptor,ownedMediaForEpisode,isOwnedMediaSeries,ownedMediaHeaders,fetchOwnedMedia,probeOwnedMedia} from '../src/owned-media-source.mjs';
import {exclusiveURL} from '../src/exclusive-catalog.mjs';

test('exact eight verified copies preserve episode and language identity',()=>{
 assert.equal(OWNED_MEDIA_FILES.length,8);assert.equal(OWNED_MEDIA_FILES.reduce((sum,item)=>sum+item.size,0),3596587551);
 assert.equal(new Set(OWNED_MEDIA_FILES.map(item=>item.sha256)).size,8);
 for(let number=1;number<=4;number++)for(const suffix of ['es','subes']){
  const file=ownedMediaForEpisode('empress-2026-s1e'+number+'-'+suffix);
  assert.equal(file.episode,number);assert.equal(file.option,suffix==='es'?1:2);assert.equal(ownedMediaDescriptor(file.url),file);
 }
});
test('readiness failures expose bounded diagnostic codes without response bodies or network messages',async()=>{
 const env={SNAP_OWNED_MEDIA_SITE_TOKEN:'test-only-site-secret-0123456789012345'};
 for(const [fetcher,code] of [[async()=>new Response('PRIVATE',{status:403}),'owned_media_http_403'],[async()=>{throw new Error('1042 PRIVATE URL');},'owned_media_fetch_1042'],[async()=>{throw new Error('PRIVATE URL');},'owned_media_network']])await assert.rejects(()=>probeOwnedMedia(env,{fetcher}),error=>error.message===code);
});
test('Sites exception cannot target other projects, routes, query strings or files',()=>{
 const source=OWNED_MEDIA_FILES[0].url;
 for(const value of [source+'?other=1',source+'#fragment',source.replace('https:','http:'),source.replace('/api/media/','/api/preview/'),source.replace('empress-s1e1-es','foreign'),source.replace('snaptvnow-media-temporal','another-project'),source.replace('juancanta89','another-user'),OWNED_MEDIA_ORIGIN+'/api/status',source.replace('https://','https://user:password@')])assert.equal(ownedMediaDescriptor(value),null,value);
 assert.equal(exclusiveURL(source),source);
 for(const value of [source+'?other=1',source.replace('/api/media/','/api/preview/'),source.replace('snaptvnow-media-temporal','another-project'),OWNED_MEDIA_ORIGIN+'/api/status'])assert.throws(()=>exclusiveURL(value),error=>error.message==='exclusive_url');
});
test('series recognition requires exactly four episodes and both exact sources',()=>{
 const row={id:OWNED_MEDIA_SERIES,type:'series',mode:'direct',episodes:[1,2,3,4].map(number=>{
  const primary=ownedMediaForEpisode('empress-2026-s1e'+number+'-es'),alternate=ownedMediaForEpisode('empress-2026-s1e'+number+'-subes');
  return {id:primary.exclusiveId,season:1,episode_num:number,page:primary.url,alternatives:[{id:alternate.exclusiveId,page:alternate.url}]};
 })};
 assert.equal(isOwnedMediaSeries(row),true);
 assert.equal(isOwnedMediaSeries({...row,episodes:row.episodes.slice(0,3)}),false);
 const changed=structuredClone(row);changed.episodes[1].alternatives[0].page=OWNED_MEDIA_FILES[0].url;assert.equal(isOwnedMediaSeries(changed),false);
 assert.equal(isOwnedMediaSeries({...row,id:'another-series'}),false);
});
test('access headers are withheld unless exact destination, server secret and playback ticket are present',()=>{
 const target=OWNED_MEDIA_FILES[0].url,env={SNAP_OWNED_MEDIA_SITE_TOKEN:'test-only-site-secret-0123456789012345'},ticket='test-playback-ticket-01234567890123456789012345';
 assert.throws(()=>ownedMediaHeaders(OWNED_MEDIA_ORIGIN+'/api/status',env,ticket),error=>error.status===403);
 assert.throws(()=>ownedMediaHeaders(target,{},ticket),error=>error.message==='owned_media_not_connected');
 assert.throws(()=>ownedMediaHeaders(target,env,''),error=>error.status===401);
 const headers=ownedMediaHeaders(target,env,ticket);assert.equal(headers['Authorization'],'Bearer '+ticket);assert.equal(headers['OAI-Sites-Authorization'],'Bearer '+env.SNAP_OWNED_MEDIA_SITE_TOKEN);
});
test('seeking is preserved and redirects cannot disclose credentials',async()=>{
 const file=OWNED_MEDIA_FILES[0],env={SNAP_OWNED_MEDIA_SITE_TOKEN:'test-only-site-secret-0123456789012345'},ticket='test-playback-ticket-01234567890123456789012345';let calls=0;
 const response=await fetchOwnedMedia(file.url,env,ticket,{range:'bytes=100-199',fetcher:async(target,init)=>{calls++;assert.equal(target,file.url);assert.equal(init.redirect,'manual');assert.equal(init.headers.get('Range'),'bytes=100-199');return new Response(new Uint8Array(100),{status:206,headers:{'content-range':'bytes 100-199/'+file.size}});}});
 assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,100);assert.equal(calls,1);
 await assert.rejects(()=>fetchOwnedMedia('https://other.chatgpt.site/video.mp4',env,ticket,{fetcher:()=>{throw new Error('must_not_fetch');}}),error=>error.status===403);
});
