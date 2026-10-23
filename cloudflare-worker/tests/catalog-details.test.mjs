import assert from 'node:assert/strict';
import {createProviderCatalog} from '../src/provider-catalog.mjs';

let mode='authentication-error', calls=0;
const now=Date.now;let elapsed=0;Date.now=()=>now()+elapsed;
const series={info:{name:'Test series'},seasons:[],episodes:{'1':[{id:'880',title:'Episode one',episode_num:1}]}};
const deps={
  directory:async()=>Response.json([{source:'test',encrypted:'test-only'}]),
  catalogCredentials:async()=>[0,1].map(i=>({server:'test',origin:'https://provider.example.test',username:'provider-'+i,password:'test-only'})),
  registry:async(env,path)=>path==='/xtream-cache-get'?new Response(null,{status:404}):Response.json({ok:true})
};
globalThis.fetch=async target=>{
  calls++;const url=new URL(target),first=url.searchParams.get('username')==='provider-0';
  assert.equal(url.searchParams.get('series_id'),'220');
  if(mode==='outage')return Response.json({user_info:{auth:0}});
  if(first)return Response.json(mode==='empty'?{info:{name:'Test series'},episodes:{}}:mode==='malformed'?{error:'not_found'}:{user_info:{auth:0}});
  return Response.json(series);
};
const make=(ctx,env={TICKET_SECRET:'test-secret',PLAYBACK_SESSIONS:{}})=>createProviderCatalog(deps,env,ctx);
try{
  let catalog=make();
  assert.deepEqual(await catalog('get_series_info','test',{series_id:'220'}),series,'HTTP 200 authentication errors must fall back to another authorised account');
  assert.equal(calls,2);
  for(const value of ['empty','malformed']){
    mode=value;catalog=make();calls=0;
    assert.deepEqual(await catalog('get_series_info','test',{series_id:'220'}),series,'a blank or malformed response must not hide episodes available on another account');
    assert.equal(calls,2);
  }
  mode='authentication-error';const background=[],ctx={waitUntil:p=>background.push(p)},detailEnv={TICKET_SECRET:'test-secret',PLAYBACK_SESSIONS:{}};catalog=make(ctx,detailEnv);
  await catalog('get_series_info','test',{series_id:'220'});
  elapsed=31000;mode='outage';catalog=make(ctx,detailEnv); // A new request shares the same scoped cache.
  await assert.rejects(()=>catalog('get_series_info','test',{series_id:'220'}),/upstream_unavailable/,'expired detail responses must not be served as a twelve-hour background snapshot');
  assert.equal(background.length,1,'only the successful fresh detail is saved off the playback path');await Promise.all(background);
  mode='empty';globalThis.fetch=async()=>Response.json({info:{name:'Actually empty'},episodes:{}});
  assert.deepEqual(await make()('get_series_info','test',{series_id:'220'}),{info:{name:'Actually empty'},episodes:{}},'a genuinely empty series remains empty');
}finally{Date.now=now}
console.log('PASS: series detail account fallback, invalid HTTP 200 responses, blank first account, detail freshness and genuine empty series.');
