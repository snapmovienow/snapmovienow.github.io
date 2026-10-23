import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {fileURLToPath} from 'node:url';
const source=`
import {sharedProviderValidation} from '../src/provider-validation.mjs';
const scope={};let first;
export default {async fetch(request,env,ctx){
 const initial=new URL(request.url).searchParams.has('first'),controller=new AbortController();
 if(initial)first=controller;
 const work=sharedProviderValidation(scope,'fixture-encrypted-credential',async signal=>{
  const response=await fetch('https://fixture.example/status',{signal});
  return response.json();
 },{signal:controller.signal,ctx});
 if(!initial)first?.abort();
 try{return Response.json(await work)}catch(error){return Response.json({error:error.message},{status:499})}
}};`;
const compiled=await build({stdin:{contents:source,resolveDir:fileURLToPath(new URL('.',import.meta.url))},bundle:true,format:'esm',platform:'browser',write:false});
let reads=0,started,release;
const upstreamStarted=new Promise(r=>{started=r}),upstreamGate=new Promise(r=>{release=r});
const options={name:'validation-runtime',modules:true,script:compiled.outputFiles[0].text,compatibilityDate:'2026-10-03',outboundService:async()=>{reads++;started();await upstreamGate;return Response.json({auth:1})}};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
try{
 await mf.ready;
 const first=mf.dispatchFetch('https://local.example/validate?first');await upstreamStarted;
 const second=mf.dispatchFetch('https://local.example/validate');
 assert.equal((await first).status,499,'the originating viewer leaves before the provider replies');
 release();const response=await second;
 assert.equal(response.status,200);assert.deepEqual(await response.json(),{auth:1});assert.equal(reads,1);
 assert.equal((await mf.dispatchFetch('https://local.example/validate')).status,200);assert.equal(reads,2,'later invocations do not reuse a completed validation');
 console.log('PASS: real workerd keeps a shared provider fetch alive after its originating viewer leaves, shares parsed data only and performs a fresh later validation.');
}finally{release();await mf.dispose()}
