// Exercise the real workerd Request/fetch implementation, not Node's fetch.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {OWNED_MEDIA_FILES,OWNED_MEDIA_ORIGIN,OWNED_MEDIA_RELEASE} from '../cloudflare-worker/src/owned-media-source.mjs';
const secret='runtime-fixture-site-secret-0123456789012345',ticket='runtime-fixture-playback-ticket-0123456789012345';
const bundled=await build({stdin:{contents:`
 import {probeOwnedMedia,fetchOwnedMedia,fetchOwnedPreview,OWNED_MEDIA_FILES} from './cloudflare-worker/src/owned-media-source.mjs';
 export default {async fetch(request,env){try{
  const kind=new URL(request.url).pathname,file=OWNED_MEDIA_FILES[0];
  if(kind==='/ready')return Response.json(await probeOwnedMedia(env));
  if(kind==='/preview')return await fetchOwnedPreview(file.url,env);
  return await fetchOwnedMedia(file.url,env,${JSON.stringify(ticket)},{range:'bytes=100-115',head:request.method==='HEAD',signal:request.signal});
 }catch(error){return Response.json({error:error.message},{status:503})}}};
`,resolveDir:process.cwd(),sourcefile:'owned-media-runtime-entry.mjs'},bundle:true,format:'esm',platform:'browser',write:false});
let redirect=false;const calls=[];
const outboundService=async request=>{
 calls.push({url:request.url,method:request.method,range:request.headers.get('range')});
 assert.equal(request.headers.get('OAI-Sites-Authorization'),'Bearer '+secret);
 assert.equal(new URL(request.url).origin,OWNED_MEDIA_ORIGIN,'credentials only reach the owner private Site');
 if(redirect)return new Response(null,{status:307,headers:{Location:'https://foreign.invalid/must-not-receive-credentials'}});
 if(request.url.endsWith('/api/ready'))return Response.json({release:OWNED_MEDIA_RELEASE,ready:true,items:OWNED_MEDIA_FILES.map(file=>({...file,ready:true}))});
 assert.equal(request.headers.get('Authorization'),request.url.includes('/api/media/')?'Bearer '+ticket:null);
 const preview=request.url.includes('/api/preview/'),length=preview?2048:16,start=preview?0:100;
 assert.equal(request.headers.get('range'),preview?'bytes=0-2047':'bytes=100-115');
 return new Response(request.method==='HEAD'?null:new Uint8Array(length),{status:request.method==='HEAD'?200:206,headers:{'content-type':'video/mp4','content-length':String(request.method==='HEAD'?OWNED_MEDIA_FILES[0].size:length),'content-range':`bytes ${start}-${start+length-1}/${OWNED_MEDIA_FILES[0].size}`}});
};
const options={modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-03',compatibilityFlags:['enable_request_signal'],bindings:{SNAP_OWNED_MEDIA_SITE_TOKEN:secret},outboundService};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
try{
 const ready=await mf.dispatchFetch('http://local.test/ready');assert.equal(ready.status,200);assert.equal((await ready.json()).count,8);
 for(const route of ['/media','/preview']){const response=await mf.dispatchFetch('http://local.test'+route);assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,route==='/media'?16:2048);}
 const head=await mf.dispatchFetch('http://local.test/media',{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(OWNED_MEDIA_FILES[0].size));assert.equal((await head.arrayBuffer()).byteLength,0);
 redirect=true;
 for(const route of ['/ready','/media','/preview']){
  const before=calls.length,response=await mf.dispatchFetch('http://local.test'+route);
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'owned_media_redirect'});
  assert.equal(calls.length,before+1,'a rejected redirect must never issue a second request');
 }
 console.log('PASS: real workerd private readiness, MP4 Range/HEAD/preview requests and credential isolation on all rejected redirects.');
}finally{await mf.dispose();}
