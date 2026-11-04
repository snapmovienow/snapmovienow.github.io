import assert from 'node:assert/strict';
import worker from '../src/index.js';
import {diagnosticEnabled,denialReason,probeEmpressOrigin,diagnosticResource,runEmpressOriginDiagnostic,EMPRESS_DIAGNOSTIC_KEY,EMPRESS_DIAGNOSTIC_END} from '../src/empress-origin-diagnostic.mjs';
const now=Date.now,fixtureNow=Date.parse('2026-11-04T18:00:00Z');Date.now=()=>fixtureNow;
const env={ENVIRONMENT:'production',PLAYBACK_CANARY_ENABLED:'true'};
const page='https://tudorama.com/ver/the-remarried-empress-s1x2/',host='ugc-cdn-caching-fixture.cloudwindow-route.com',prefix='/engine/hls2-c/01/18734/zhbsadlqzyhb_,n,.urlset/';
const value={page,url:'https://'+host+prefix+'master.m3u8?i=private-ip&asn=private-asn&t=private-signature',context:{provider:'voe',episode:2,host,prefix}};
try{
 assert.equal(diagnosticEnabled(env),true);assert.equal(diagnosticEnabled({...env,ENVIRONMENT:'staging'}),false);assert.equal(diagnosticEnabled(env,EMPRESS_DIAGNOSTIC_END),false);
 assert.equal(await denialReason(new Response('403 Forbidden nginx',{status:403})),'forbidden_without_reason');
 assert.equal(await denialReason(new Response('Client IP mismatch private-session',{status:403})),'ip_restriction');
 assert.equal(await denialReason(new Response('Signature expired private-token',{status:403})),'expired_capability');
 assert.equal(await denialReason(new Response('Invalid signature secret',{status:403})),'invalid_signature');
 assert.equal(await denialReason(new Response('Referer not allowed',{status:403})),'origin_restriction');
 assert.equal(await denialReason(new Response('anything',{status:403,headers:{'cf-mitigated':'challenge'}})),'browser_challenge');
 let calls=0;
 const fetcher=async(url,opts)=>{calls++;assert.equal(opts.redirect,'manual');assert.equal(new Headers(opts.headers).get('Range'),null);assert.equal(new Headers(opts.headers).get('Cookie'),null);return url.includes('master')?new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nindex.m3u8?t=private-signature\n'):url.includes('index')?new Response('#EXTM3U\n#EXTINF:4,\nsegment.ts?t=private-signature\n'):new Response(new Uint8Array(2048),{headers:{server:'nginx'}})};
 const result=await probeEmpressOrigin(value,{fetcher});assert.equal(calls,3);assert.equal(result.reports.at(-1).status,200);assert.ok(result.next.url.includes('private-signature'));
 assert.ok(!JSON.stringify(result.reports).includes('private-'),'reports contain no capabilities, signed URLs or addresses');
 calls=0;await assert.rejects(probeEmpressOrigin({...value,url:'https://127.0.0.1/private'},{fetcher}));assert.equal(calls,0);
 await assert.rejects(probeEmpressOrigin({...value,page:'https://tudorama.com/unreviewed'},{fetcher}));assert.equal(calls,0);
 const capability={kind:'empress-origin-diagnostic',...value,exp:fixtureNow+90000};
 assert.equal((await diagnosticResource(env,{capability:'encrypted'},{unticket:async()=>capability,fetcher})).status,200);
 assert.equal((await diagnosticResource(env,{capability:'encrypted'},{unticket:async()=>({...capability,exp:fixtureNow-1}),fetcher})).status,403);
 assert.equal((await diagnosticResource(env,{capability:'encrypted'},{unticket:async()=>({...capability,kind:'exclusive-media'}),fetcher})).status,403);
 assert.equal((await diagnosticResource({...env,ENVIRONMENT:'staging'},{capability:'encrypted'},{unticket:async()=>{throw Error('must not decrypt')}})).status,403);
 const data=new Map(),store={get:async k=>data.get(k),put:async(k,v)=>data.set(k,v),transaction:async fn=>fn(store)},logs=[];
 const deps={resolve:async p=>{if(p!==page)throw Error('fixture unavailable');return {url:value.url,empressContext:value.context}},fetcher,ticket:async(_,payload)=>{assert.equal(payload.kind,'empress-origin-diagnostic');assert.ok(payload.exp<=fixtureNow+120000);return 'private-encrypted-capability'},delegate:async body=>{assert.deepEqual(body,{capability:'private-encrypted-capability'});return Response.json({reports:[{level:0,status:403,reason:'ip_restriction'}]})},log:v=>logs.push(v)};
 await runEmpressOriginDiagnostic(store,env,deps);assert.equal(data.get(EMPRESS_DIAGNOSTIC_KEY).state,'complete');assert.equal(logs.length,2);
 const before=calls;await runEmpressOriginDiagnostic(store,env,deps);assert.equal(calls,before,'job never repeats');
 const summary=JSON.stringify({saved:[...data],logs});for(const secret of ['private-','https://',host,'zhbsadlqzyhb'])assert.equal(summary.includes(secret),false,'stored results and logs exclude signed resources and identities');
 for(const path of ['/empress-origin-diagnostic-run','/empress-origin-diagnostic-resource']){
  const response=await worker.fetch(new Request('https://example.test'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({capability:'private-encrypted-capability'})}),env,{waitUntil:()=>{}});
  assert.equal(response.status,403,'diagnostic DO operations are not public routes');await response.body?.cancel();
 }
 console.log('PASS: bounded private one-time Empress origin diagnostic, approved source/resource scopes, expired/wrong capability rejection, safe denial classification and no persisted signed URLs.');
}finally{Date.now=now;}
