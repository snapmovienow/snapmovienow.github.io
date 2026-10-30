import assert from 'node:assert/strict';
import {createProviderCatalog} from '../src/provider-catalog.mjs';
const realFetch=globalThis.fetch;
async function run({empty=false,partial=false,filtered=false,detail=false,writeFails=false}={}){
 const writes=[],tasks=[];let requests=0;
 const deps={directory:async()=>Response.json([{source:'one',origin:'https://catalog.test'}]),
 registry:async(e,p,b)=>{if(p==='/catalog-references-put'){writes.push(b);if(writeFails)throw Error('storage');return Response.json({ok:true})}return new Response(null,{status:p.endsWith('-get')?404:200})},
 catalogCredentials:async()=>['a','b'].map(server=>({server,origin:'https://catalog.test',username:server,password:'synthetic-secret'}))};
 globalThis.fetch=async url=>{requests++;const u=new URL(url);if(partial&&u.searchParams.get('username')==='b')throw Error('offline');return Response.json(empty?[]:[{stream_id:2,direct_source:'https://secret.test/username/password'},{stream_id:1}])};
 const env={PLAYBACK_SESSIONS:{},TICKET_SECRET:'synthetic-test'},ctx={waitUntil:p=>tasks.push(p)};
 const catalog=createProviderCatalog(deps,env,ctx);
 const result=await catalog(detail?'get_vod_streams':'get_live_streams',null,filtered?{category_id:'1'}:{});
 await Promise.all(tasks);return {writes,requests,result,catalog};
}
try{
 let r=await run();assert.equal(r.requests,2);assert.equal(r.writes.length,1);assert.equal(r.writes[0].samples.length,2);
 assert.ok(!JSON.stringify(r.writes).includes('synthetic-secret'));assert.ok(!JSON.stringify(r.writes).includes('https://'));assert.deepEqual(r.writes[0].samples[0].ids,['1','2']);
 for(const options of [{empty:true},{partial:true},{filtered:true},{detail:true}]){r=await run(options);assert.equal(r.writes.length,0,JSON.stringify(options));assert.equal(r.requests,2)}
 r=await run({writeFails:true});assert.equal(r.result.length,4,'observation failure cannot break catalog delivery');
 console.log('PASS integration: only complete nonempty unfiltered live replies, no extra provider fetch, secrets absent, failure isolated');
}finally{globalThis.fetch=realFetch}
