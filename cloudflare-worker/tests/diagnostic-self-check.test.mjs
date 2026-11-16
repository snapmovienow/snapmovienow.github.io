import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {runDiagnosticSelfCheck} from '../src/diagnostic-self-check.mjs';

test('the synthetic control verifies production media helpers without network or live timers',async()=>{
 const real={fetch:globalThis.fetch,setTimeout,clearTimeout,setInterval,clearInterval},timers=new Set(),intervals=new Set();let requests=0;
 globalThis.fetch=()=>{requests++;throw Error('No external request is permitted');};
 globalThis.setTimeout=(callback,ms,...args)=>{let id;id=real.setTimeout(()=>{timers.delete(id);callback(...args);},ms);timers.add(id);return id;};
 globalThis.clearTimeout=id=>{timers.delete(id);return real.clearTimeout(id);};
 globalThis.setInterval=(callback,ms,...args)=>{const id=real.setInterval(callback,ms,...args);intervals.add(id);return id;};
 globalThis.clearInterval=id=>{intervals.delete(id);return real.clearInterval(id);};
 try{
  const checkedAt=Date.UTC(2026,10,16),result=await runDiagnosticSelfCheck({now:checkedAt});
  assert.deepEqual({...result,elapsedMs:0},{version:1,scope:'controlled_bytes_only',checkedAt,status:'passed',elapsedMs:0,checks:{initialPayload:'passed',rangeRecovery:'passed',streamGuard:'passed'},failureCode:null});
  assert.ok(Number.isFinite(result.elapsedMs)&&result.elapsedMs>=0);assert.equal(requests,0);assert.equal(timers.size,0);assert.equal(intervals.size,0,'the production guard interval must be cleared at synthetic EOF');
 }finally{
  for(const timer of timers)real.clearTimeout(timer);for(const interval of intervals)real.clearInterval(interval);Object.assign(globalThis,real);
 }
});

async function mutant(dependency,contents){
 const result=await build({entryPoints:['cloudflare-worker/src/diagnostic-self-check.mjs'],bundle:true,format:'esm',platform:'browser',write:false,external:['cloudflare:sockets'],plugins:[{name:'synthetic-helper-failure',setup(b){
  b.onResolve({filter:new RegExp('^\\./'+dependency.replaceAll('.','\\.')+'$')},args=>args.importer.endsWith('/diagnostic-self-check.mjs')?{path:dependency,namespace:'failure-fixture'}:undefined);
  b.onLoad({filter:/.*/,namespace:'failure-fixture'},()=>({loader:'js',contents}));
 }}]});
 return (await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'))).runDiagnosticSelfCheck;
}

test('a failed production helper is reported as a bounded check failure, without its exception text',async()=>{
 const check=await mutant('live-startup.mjs','export async function readInitialMedia(){throw Error("synthetic-private-error-must-not-be-returned");}');
 const result=await check();assert.equal(result.status,'failed');assert.equal(result.failureCode,'initial_payload_failed');assert.deepEqual(result.checks,{initialPayload:'failed',rangeRecovery:'not_run',streamGuard:'not_run'});assert.ok(!JSON.stringify(result).includes('synthetic-private-error'));
});

test('the control detects missing Range recovery rather than accepting a truncated body',async()=>{
 const check=await mutant('media-fetch.mjs','export function recoverMedia(response){return response;}');
 const result=await check();assert.equal(result.status,'failed');assert.equal(result.failureCode,'range_recovery_failed');assert.equal(result.checks.initialPayload,'passed');assert.equal(result.checks.rangeRecovery,'failed');assert.equal(result.checks.streamGuard,'not_run');
});

test('the control detects a corrupted guarded body',async()=>{
 const check=await mutant('xtream-bridge.mjs','export function guardXtreamResponse(response){return new Response(new Uint8Array([1,2,3]),{status:response.status,headers:response.headers});}');
 const result=await check();assert.equal(result.status,'failed');assert.equal(result.failureCode,'stream_guard_failed');assert.equal(result.checks.initialPayload,'passed');assert.equal(result.checks.rangeRecovery,'passed');assert.equal(result.checks.streamGuard,'failed');
});

test('a stalled helper cannot keep the report waiting indefinitely',async()=>{
 const check=await mutant('live-startup.mjs','export function readInitialMedia(){return new Promise(()=>{});}'),start=performance.now();
 const result=await check({budgetMs:10});assert.equal(result.status,'failed');assert.equal(result.failureCode,'self_check_timeout');assert.equal(result.checks.initialPayload,'failed');assert.ok(performance.now()-start<2000,'the control must return after its small timeout, even when a helper never settles');
});

test('an unavailable check clock fails without returning its exception',async()=>{
 const result=await runDiagnosticSelfCheck({now:()=>{throw Error('synthetic-clock-detail');}});assert.equal(result.status,'failed');assert.equal(result.failureCode,'self_check_unavailable');assert.deepEqual(Object.values(result.checks),['not_run','not_run','not_run']);assert.ok(!JSON.stringify(result).includes('synthetic-clock-detail'));
});

test('the control runs under real workerd using only generated local bytes',async()=>{
 const built=await build({stdin:{contents:"import {runDiagnosticSelfCheck} from './cloudflare-worker/src/diagnostic-self-check.mjs';export default{async fetch(){return Response.json(await runDiagnosticSelfCheck({budgetMs:100}));}};",resolveDir:process.cwd(),sourcefile:'diagnostic-control-runtime.mjs'},bundle:true,format:'esm',platform:'browser',external:['cloudflare:sockets'],write:false});
 let outboundRequests=0;
 const options={modules:true,script:built.outputFiles[0].text,compatibilityDate:'2026-10-03',compatibilityFlags:['enable_request_signal'],outboundService:()=>{outboundRequests++;throw Error('The synthetic control must not contact any external service');}};
 const runtime=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
 try{
  for(let index=0;index<3;index++){
   const response=await runtime.dispatchFetch('https://synthetic.invalid/private-control'),result=await response.json();assert.equal(response.status,200);assert.equal(result.status,'passed',JSON.stringify(result));assert.equal(result.scope,'controlled_bytes_only');assert.deepEqual(Object.values(result.checks),['passed','passed','passed']);assert.equal(result.failureCode,null);
  }
  assert.equal(outboundRequests,0);
 }finally{await runtime.dispose();}
});
