import assert from 'node:assert/strict';
import {createProviderCatalog} from '../src/provider-catalog.mjs';
import {selectCatalogDetail} from '../src/catalog-detail-race.mjs';

// Exercise the real metadata selector/cache with synthetic authorized sources.
// No customer accounts, network requests or playback operations are used.
const realFetch=globalThis.fetch,realNow=Date.now;
let offset=0,mode='full',revision='fixture-config';
Date.now=()=>realNow()+offset;
const accounts=[0,1].map(i=>({server:'fixture',origin:'https://fixture.invalid',username:'fixture-'+i,password:'synthetic-only'}));
const movies=[{stream_id:7,name:'Synthetic movie',category_id:'4'}];
const env={PLAYBACK_SESSIONS:{},TICKET_SECRET:'synthetic-empty-confirmation'};
const pending=[];
const deps={
 directory:async()=>Response.json([{source:'fixture',encrypted:revision}]),
 catalogCredentials:async()=>accounts,
 registry:async(_env,path)=>new Response(null,{status:path==='/xtream-cache-get'?404:200})
};
const make=(binding=env)=>createProviderCatalog(deps,binding,{waitUntil:p=>pending.push(p)},{timeoutMs:1000,hedgeMs:5});
const flush=async()=>{while(pending.length)await Promise.all(pending.splice(0));};
try{
 globalThis.fetch=async url=>{
  const first=new URL(url).searchParams.get('username')==='fixture-0';
  if(mode==='full')return Response.json(movies);
  if(mode==='empty')return Response.json([]);
  if(mode==='empty-and-full')return Response.json(first?[]:movies);
  return first?Response.json([]):mode==='empty-and-rejected'?Response.json({user_info:{auth:0}}):new Response(null,{status:503});
 };
 const initial=await make()('get_vod_streams');await flush();
 assert.equal(initial.length,1);
 const original=(await make()('get_vod_streams',undefined,{}, {cachedOnly:true,withMetadata:true})).savedAt;
 offset=300010;mode='empty-and-failed';
 assert.deepEqual(await make()('get_vod_streams'),initial);await flush();
 const retained=await make()('get_vod_streams',undefined,{}, {cachedOnly:true,withMetadata:true});
 assert.deepEqual(retained.data,initial,'an empty reply plus an account failure must not replace a valid movie catalogue');
 assert.equal(retained.savedAt,original,'an inconclusive refresh must not renew the old catalogue timestamp');

 for(const failedMode of ['empty-and-failed','empty-and-rejected']){
  mode=failedMode;
  const cold={...env,PLAYBACK_SESSIONS:{}};
  await assert.rejects(make(cold)('get_vod_streams'),/upstream_unavailable/,'a cold mixed failure must not publish HTTP200 with an empty catalogue');await flush();
 }

 mode='empty-and-full';
 assert.equal((await make()('get_vod_streams',undefined,{}, {fresh:true})).length,1,'a nonempty authorized backup still wins');await flush();
 mode='empty';
 assert.deepEqual(await make()('get_vod_streams',undefined,{}, {fresh:true}),[],'complete valid empty replies still remove a genuinely empty catalogue');await flush();

 // A changed authorized configuration cannot reuse the previous scope.
 mode='full';await make()('get_vod_streams',undefined,{}, {fresh:true});await flush();
 revision='new-authorized-config';mode='empty-and-failed';
 await assert.rejects(make()('get_vod_streams'),/upstream_unavailable/);await flush();
 revision='fixture-config';offset=13*3600000;
 await assert.rejects(make()('get_vod_streams'),/upstream_unavailable/,'the original retention deadline remains enforced');await flush();

 // A deadline cannot turn an empty reply plus an unfinished source into a
 // confirmed empty result. Existing callers retain their previous semantics.
 const read=(account,signal)=>account===0?Promise.resolve({data:[],empty:true}):new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled'))));
 assert.equal(await selectCatalogDetail([0,1],read,{timeoutMs:60,hedgeMs:5,maxConcurrent:2,requireAllEmpty:true}),null);
 assert.deepEqual(await selectCatalogDetail([0,1],read,{timeoutMs:60,hedgeMs:5,maxConcurrent:2}),[]);
 assert.deepEqual(await selectCatalogDetail([0,1],async()=>({data:[],empty:true}),{timeoutMs:1000,hedgeMs:5,requireAllEmpty:true}),[]);
 console.log('PASS: VOD partial-empty failures, rejected accounts, retention age/scope, genuine empty catalogues, nonempty fallback and bounded selector cancellation.');
}finally{globalThis.fetch=realFetch;Date.now=realNow;}
