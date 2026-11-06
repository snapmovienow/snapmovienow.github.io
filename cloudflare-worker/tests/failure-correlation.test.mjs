import assert from 'node:assert/strict';import {test} from 'node:test';
import {traceRequest} from '../src/request-diagnostics.mjs';
import {createXtreamBridge} from '../src/xtream-bridge.mjs';
import {playbackErrorHeaders} from '../src/playback-outcomes.mjs';
import * as correlation from '../src/failure-correlation.mjs';
const m={traceRequest,createXtreamBridge,...correlation};
globalThis.fetch=()=>{throw Error('NETWORK FORBIDDEN')};
const json=(b,s=200)=>Response.json(b,{status:s,headers:playbackErrorHeaders(b,s)});
async function run({status=502,slow=false,kind='movie',method='GET',range='bytes=100-199',ifRange=true,missing=false,deny=false,throwing=false,api=m}={}){
 let tick=0,calls=0;const logs=[],reports=[],timings=[];
 const deps={json,directory:async(e,p,b)=>{if(p==='/xtream-config')return json({enabled:true,version:1});if(p==='/xtream-login')return json({id:'PRIVATE-ACCOUNT',username:'PRIVATE-USER',version:1,permissions:{movies:!deny,tv:!deny,series:!deny,adults:true}});if(p==='/provider-result')reports.push(b);if(['/playback-begin','/provider-result','/release'].includes(p))return json({ok:true});throw Error('unexpected '+p)},sessionCall:async()=>json({exp:Date.now()+60000}),registry:async()=>json(missing?null:{kind:kind==='series'?'episode':kind,server:'PRIVATE-SERVER',upstreamId:'999',ext:'mp4',activity:{title:'PRIVATE-TITLE'}}),managedPlayback:async()=>({r:json({lease_id:'PRIVATE-LEASE'}),...(status===410?{provider_id:'PRIVATE-PROVIDER'}:{}),credentials:{username:'PRIVATE-UPUSER',password:'PRIVATE-UPPASS',origin:'https://synthetic.invalid'}}),ticket:async()=>'PRIVATE-TICKET',serverStream:async()=>{calls++;if(slow)tick=3000;if(throwing)throw Error('synthetic');return new Response(status===200?'ok':null,{status,headers:{'content-range':'bytes */100','X-SMN-Error-Code':status===410?'playback_superseded':'live_signal_unavailable'}})}};
 const req=new Request(`https://synthetic.invalid/${kind}/PRIVATE-USER/PRIVATE-PASS/123.mp4?secret=PRIVATE-QUERY`,{method,headers:{range,...(ifRange?{'if-range':'PRIVATE-VALIDATOR'}:{}),'x-smn-request-id':'FORGED-ID','CF-Connecting-IP':'192.0.2.42','user-agent':'PRIVATE-UA'}});
 const res=await api.traceRequest(req,t=>api.createXtreamBridge(deps)(req,{TICKET_SECRET:'fixture-only',PLAYBACK_SESSIONS:{}},{},t),{now:()=>tick,logger:x=>logs.push(x),onTiming:x=>timings.push(x)});
 return {res,logs,calls,reports,timings};
}
test('existing 502 gains exact response request ID + validated PUBLIC id, not provider id',async()=>{const x=await run();assert.equal(x.logs.length,1);assert.equal(x.calls,1);assert.equal(x.res.status,502);assert.equal(x.logs[0].request_id,x.res.headers.get('X-SMN-Request-ID'));assert.deepEqual(x.logs[0].media_failure,{type:'movie',content_public_id:'123',phase:'initial'});assert.equal(await x.res.text(),'{"error":"upstream_unavailable"}')});
test('existing movie 504 includes only the resolved public id and the response request ID',async()=>{
 const x=await run({status:504});
 assert.equal(x.res.status,504);
 assert.equal(x.calls,1);
 assert.equal(x.logs.length,1);
 assert.equal(x.logs[0].request_id,x.res.headers.get('X-SMN-Request-ID'));
 assert.deepEqual(x.logs[0].media_failure,{type:'movie',content_public_id:'123',phase:'initial'});
 assert.ok(!JSON.stringify(x.logs).includes('PRIVATE'));
 assert.ok(x.timings.every(t=>!Object.hasOwn(t,'content_public_id')));
});
test('slow 416 gains numeric initial Range with same response and one request',async()=>{const x=await run({status:416,slow:true});assert.equal(x.logs.length,1);assert.equal(x.calls,1);const f=x.logs[0].media_failure;assert.equal(f.phase,'initial');assert.deepEqual(f.rangeEvidence.incomingRange,{kind:'bytes',start:100,end:199});assert.equal(f.rangeEvidence.reportedTotal,100);assert.equal(x.res.headers.get('content-range'),'bytes */100');assert.equal(x.reports.length,0)});
test('fast 416 is intentionally not a new event',async()=>{const x=await run({status:416});assert.equal(x.logs.length,0);assert.equal(x.calls,1);assert.equal(x.res.status,416)});
test('only a confirmed out-of-bounds movie GET changes the private timing code',async()=>{
 for(const [overrides,code] of [[{},'range_out_of_bounds'],[{range:'bytes=99-'},'upstream_unavailable'],[{ifRange:true},'upstream_unavailable'],[{method:'HEAD'},'upstream_unavailable'],[{range:'bytes=100-,0-1'},'upstream_unavailable']]){
  const x=await run({status:416,slow:true,range:'bytes=100-',ifRange:false,...overrides});
  assert.equal(x.res.status,416);assert.equal(x.res.headers.get('content-range'),'bytes */100');assert.equal(x.calls,1);
  assert.equal(x.timings[0].errorCode,code);assert.equal(x.logs[0].playback.errorCode,code);
 }
});
test('private strings, URLs, IDs, address and forged reference do not enter logs/timings',async()=>{const x=await run({status:416,slow:true});const text=JSON.stringify([...x.logs,...x.timings]);for(const s of ['PRIVATE','192.0.2.42','FORGED-ID','https:','999'])assert.ok(!text.includes(s),s);assert.ok(!JSON.stringify(x.timings).includes('content_public_id'))});
test('cancel410 has no provider penalty, extra calls or failure correlation',async()=>{const x=await run({status:410,slow:true});assert.equal(x.res.status,410);assert.equal(x.reports.length,0);assert.equal(x.calls,1);assert.equal(x.logs.length,1);assert.equal(x.logs[0].media_failure,undefined)});
test('permission denied and missing record never obtain content correlation',async()=>{for(const opt of [{deny:true},{missing:true}]){const x=await run(opt);assert.equal(x.calls,0);assert.ok(x.logs.every(l=>!l.media_failure));}});
test('exceptions have unknown phase rather than invented origin response',async()=>{const x=await run({throwing:true});assert.equal(x.logs[0].media_failure.phase,'unknown');assert.equal(x.calls,1)});
test('HEAD retains probe Range and empty body',async()=>{const x=await run({status:416,slow:true,method:'HEAD'});assert.deepEqual(x.logs[0].media_failure.rangeEvidence.outgoingRange,{kind:'bytes',start:0,end:0});assert.equal(await x.res.text(),'')});
test('success does not create failure event',async()=>{const x=await run({status:200});assert.equal(x.logs.length,0);assert.equal(await x.res.text(),'ok')});
test('invalid raw Range sanitized without leaking text',async()=>{const x=await run({status:416,slow:true,range:'SECRET-RANGE'});assert.deepEqual(x.logs[0].media_failure.rangeEvidence.incomingRange,{kind:'invalid'});assert.ok(!JSON.stringify(x.logs).includes('SECRET-RANGE'))});
{
 test('helper rejects malicious/oversize metadata and does not invoke coercion',()=>{for(const id of ['1'.repeat(10000),'https://private','9007199254740992',{toString(){throw Error('coercion')}}]){const t={};m.setResolvedMedia(t,'movie',id);assert.equal(m.takeFailureCorrelation(t,502),null)}const t={};m.setResolvedMedia(t,'movie','1');m.setResolvedMedia(t,'secret','2');assert.equal(m.takeFailureCorrelation(t,502),null)});
 test('bounded four-part range, no body reads, one context consumed exactly once',()=>{const t={};m.setResolvedMedia(t,'series','123');m.recordInitialMediaResponse(t,new Request('https://synthetic.invalid',{headers:{range:'bytes=0-1,2-3,4-5,6-7'}}),new Response(null,{status:416,headers:{'content-range':'bytes */10'}}));const r=m.takeFailureCorrelation(t,416);assert.ok(JSON.stringify(r).length<=1024);assert.equal(r.rangeEvidence.incomingRange.ranges.length,4);assert.equal(m.takeFailureCorrelation(t,416),null)});
 test('retry boundary discards previous phase/range without logging extra events',()=>{const t={};m.setResolvedMedia(t,'movie','123');m.recordInitialMediaResponse(t,new Request('https://synthetic.invalid'),new Response(null,{status:416}));m.resetMediaPhase(t);assert.deepEqual(m.takeFailureCorrelation(t,502),{type:'movie',content_public_id:'123',phase:'unknown'})});
}

test('response contracts stay unchanged across final error and success paths',async()=>{
 for(const [opts,status,body] of [[{status:200},200,'ok'],[{status:502},502,'{"error":"upstream_unavailable"}'],[{status:416},416,'{"error":"upstream_unavailable"}'],[{status:410},410,'{"error":"playback_superseded"}'],[{throwing:true},502,'{"error":"xtream_unavailable"}'],[{deny:true},403,'{"error":"content_disabled"}'],[{missing:true},404,'{"error":"not_found"}']]){
  const x=await run(opts);assert.equal(x.res.status,status);assert.equal(await x.res.text(),body);assert.ok(x.timings.every(v=>!Object.hasOwn(v,'media_failure')));
 }
});

test('actual native bridge fast404 and416 correlate only with explicit budget',async()=>{
 for(const status of[404,416]){
  const api={...m,traceRequest:(req,handler,options)=>m.traceRequest(req,handler,{...options,fastMediaFailureBudget:{take:()=>true}})};
  const x=await run({status,api});assert.equal(x.logs.length,1);assert.equal(x.calls,1);assert.equal(x.res.status,status);assert.equal(x.logs[0].request_id,x.res.headers.get('X-SMN-Request-ID'));assert.equal(x.logs[0].media_failure.content_public_id,'123');assert.ok(!JSON.stringify(x.logs).includes('PRIVATE'));
 }
});
test('actual unresolved404 never spends fast budget',async()=>{
 let n=0;const api={...m,traceRequest:(req,handler,options)=>m.traceRequest(req,handler,{...options,fastMediaFailureBudget:{take(){n++;return true}}})};
 const x=await run({missing:true,status:404,api});assert.equal(x.calls,0);assert.equal(x.logs.length,0);assert.equal(n,0);
});
