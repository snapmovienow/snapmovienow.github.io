import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
import {LOCAL_TV_CHANNELS as OFFICIAL_CHANNELS} from '../src/official-live.mjs';
const source=`
import {LOCAL_TV_CHANNELS as OFFICIAL_CHANNELS} from '../src/official-live.mjs';
import {inspectCatalogSource} from '../src/catalog-source-check.mjs';
export default {async fetch(){const result=[];for(const c of OFFICIAL_CHANNELS)result.push({id:c.id,...await inspectCatalogSource({mode:'gnula',page:c.page})});return Response.json(result)}};`;
const compiled=await build({stdin:{contents:source,resolveDir:fileURLToPath(new URL('.',import.meta.url))},bundle:true,format:'esm',platform:'browser',write:false});
let reads=0;const reply=data=>Response.json({header:{code:0},data});
const options={name:'official-live-runtime',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-10-03',outboundService:async req=>{
 reads++;const u=new URL(req.url);
 if(['www.kwch.com','www.wibw.com','www.kctv5.com'].includes(u.hostname)&&u.pathname==='/livestream/')return new Response(OFFICIAL_CHANNELS.map(c=>'"id":"'+c.contentId+'"').join(' '));
 if(u.hostname==='www.koamnewsnow.com')return new Response('<source src="https://amg01499-amg01499c3-morganmurphy-us-4207.playouts.now.amagi.tv/playlist/amg01499-morganmurphyfast-koam-morganmurphyus/playlist.m3u8?coppa=0&amp;genre=news">');
 if(u.hostname==='www.kake.com')return new Response(u.pathname==='/video/live/'?'<iframe src="https://www.kake.com/tncms/block/3942264"></iframe>':'<source src="https://townnews.g-mana.live/media/11111111-1111-1111-1111-111111111111/master.m3u8">');
 if(u.pathname.startsWith('/pf/'))return Response.json({access_token:'anonymous-test-token'});
 if(u.hostname==='auth-gw.api.gray.quickplay.com')return reply({token:'anonymous-test-qpat'});
 if(u.hostname==='device-register-service.api.gray.quickplay.com')return reply({secret:btoa('01234567890123456789012345678901')});
 if(u.hostname==='playback-auth-service.api.gray.quickplay.com'){
  const body=await req.json(),c=OFFICIAL_CHANNELS.find(c=>c.contentId===body.contentId);assert.ok(c);assert.equal(body.disableSsai,'false');
  return reply({contentUrl:'https://live-streaming-mcdn.api.graylive.quickplay.com/'+c.input+'/'+c.input+'.isml/index.m3u8',drm:'none',pgmBlackout:false,ssaiEnabled:true,assetKey:'test-asset-identifier',custom:{adParams:{}},heartbeatToken:'test-heartbeat'});
 }
 assert.equal(req.headers.get('Authorization'),null,'no anonymous auth headers are forwarded to media');
 if(u.hostname==='pubads.g.doubleclick.net')return new Response(null,{status:302,headers:{Location:'https://dai.google.com/linear/test/master.m3u8'}});
 if(u.pathname.endsWith('master.m3u8')||u.pathname.endsWith('playlist.m3u8'))return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000\nvariant.m3u8\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
 if(u.pathname.endsWith('variant.m3u8'))return new Response('#EXTM3U\n#EXTINF:3,\nsegment.ts\n',{headers:{'Content-Type':'application/vnd.apple.mpegurl'}});
 return new Response(new Uint8Array(2048).fill(0x47),{headers:{'Content-Type':'video/mp2t'}});
}};
const mf=new Miniflare(convertV4MiniflareOptions(options));
try{await mf.ready;const response=await mf.dispatchFetch('https://local.test/probe'),result=await response.json();assert.ok(result.every(r=>r.ok),JSON.stringify({reads,result}));assert.equal(result.length,8);assert.ok(reads>=20);console.log('PASS: eight official live adapters perform real workerd Requests and validate synthetic HLS media across reviewed station scopes.');}finally{await mf.dispose()}
