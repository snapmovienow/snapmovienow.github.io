import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runOwnedMediaVerification} from '../src/owned-media-verification.mjs';
import {OWNED_MEDIA_FILES,OWNED_MEDIA_SERIES} from '../src/owned-media-source.mjs';
const bytes=new Uint8Array(16).fill(73),digest=createHash('sha256').update(bytes).digest('hex');
const files=OWNED_MEDIA_FILES.map(file=>({...file,rangeSamples:[0,Math.floor(file.size/2),file.size-16].map(start=>({start,length:16,sha256:digest}))}));
const row={id:OWNED_MEDIA_SERIES,type:'series',mode:'direct',episodes:[1,2,3,4].map(number=>{const primary=files.find(file=>file.episode===number&&file.option===1),alternate=files.find(file=>file.episode===number&&file.option===2);return{id:primary.exclusiveId,season:1,episode_num:number,page:primary.url,alternatives:[{id:alternate.exclusiveId,page:alternate.url}]};})};
class Store{data=new Map();async get(key){return structuredClone(this.data.get(key));}async put(key,value){this.data.set(key,structuredClone(value));}async transaction(fn){return fn(this);}}
const env={ENVIRONMENT:'production',SNAP_OWNED_MEDIA_SITE_TOKEN:'private-fixture-secret',PLAYBACK_CANARY_USERNAME:'owner-fixture'};
test('one bounded verification reads all 24 ranges through scoped public API routes and cleans sessions',async()=>{
 const storage=new Store();let active=0,maximum=0,released=0,requests=0;const events=[],prepared=new Map();
 const deps={read:async()=>({items:[row]}),authenticate:async()=>{active++;maximum=Math.max(maximum,active);return{sid:crypto.randomUUID()};},prepare:async(session,id)=>{await new Promise(resolve=>setImmediate(resolve));const ticket=crypto.randomUUID();prepared.set(ticket,files.find(file=>file.exclusiveId===id));return{url:'https://api.snaptvnow.com/exclusive-media?t='+ticket};},request:async request=>{requests++;const file=prepared.get(new URL(request.url).searchParams.get('t'));assert.ok(file);const range=request.headers.get('range').replace('bytes=','');return new Response(bytes,{status:206,headers:{'content-type':'video/mp4','content-range':'bytes '+range+'/'+file.size}});},release:async()=>{released++;active--;}};
 const result=await runOwnedMediaVerification(storage,env,deps,{files,onResult:value=>events.push(value)});
 assert.equal(result.state,'completed');assert.equal(result.passed,8);assert.equal(result.rangeChecks,24);assert.equal(requests,24);assert.equal(released,8);assert.equal(active,0);assert.ok(maximum<=2);
 assert.equal(events.length,1);assert.equal(JSON.stringify(events).includes('https://'),false);assert.equal(JSON.stringify(events).includes(env.SNAP_OWNED_MEDIA_SITE_TOKEN),false);
 await runOwnedMediaVerification(storage,env,{read:deps.read,authenticate:()=>{throw Error('must not repeat');}},{files,onResult:()=>{throw Error('must not repeat');}});
});
test('corrupt served bytes fail verification and still release every test session',async()=>{
 const storage=new Store();let released=0;
 const result=await runOwnedMediaVerification(storage,env,{read:async()=>({items:[row]}),authenticate:async()=>({}),prepare:async(session,id)=>({url:'https://api.snaptvnow.com/exclusive-media?t='+id}),request:async request=>{const file=files.find(file=>file.exclusiveId===new URL(request.url).searchParams.get('t'));return new Response(new Uint8Array(16),{status:206,headers:{'content-type':'video/mp4','content-range':'bytes '+request.headers.get('range').slice(6)+'/'+file.size}});},release:async()=>{released++;}},{files,onResult:()=>{}});
 assert.equal(result.state,'failed');assert.equal(result.passed,0);assert.ok(result.results.every(item=>item.reason==='checksum_mismatch'));assert.equal(released,8);
});
test('staging, missing credential, expired window and unconnected catalog cannot run',async()=>{
 const deps={read:async()=>({items:[]}),authenticate:()=>{throw Error('must not authenticate');}};
 for(const config of [{...env,ENVIRONMENT:'staging'},{...env,SNAP_OWNED_MEDIA_SITE_TOKEN:''}])assert.equal(await runOwnedMediaVerification(new Store(),config,deps),undefined);
 assert.equal(await runOwnedMediaVerification(new Store(),env,deps,{now:()=>Date.parse('2026-11-06T00:00:00Z')}),undefined);
 assert.equal(await runOwnedMediaVerification(new Store(),env,deps),undefined);
});
