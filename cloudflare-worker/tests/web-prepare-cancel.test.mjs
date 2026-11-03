import {test} from 'node:test';import assert from 'node:assert/strict';
import {prepareWebPlayback} from '../src/web-playback.mjs';
import {prepareWebPlayback as original} from './web-prepare-original.fixture.mjs';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
async function execute({stage=null,live=false,managed=true,releaseFailure=false,manifestFailure=false,fn=(process.env.BASELINE?original:prepareWebPlayback)}={}){
 const ac=new AbortController(),calls=[],data=[],signals=[];let cancels=0;
 const abort=where=>{if(stage===where)ac.abort(Error('fixture-cancel'))};
 const deps={signal:ac.signal,json:(v,status=200)=>Response.json(v,{status}),cleanExt:x=>x,origin:'https://fixture.invalid',permissions:{tv:true,movies:true},catalog:async()=>[],
 directory:async(_e,path,body)=>{calls.push({path,body});abort(path);if(path==='/release'&&releaseFailure)throw Error('release failed');return Response.json({ok:true})},
 managedPlayback:async(_e,_s,_server,_ctx,_excluded,startup)=>{signals.push(startup.signal);abort('allocation');return {r:Response.json({lease_id:'old-lease'}),credentials:{username:'fixture',password:'synthetic-not-secret',origin:'https://fixture.invalid'},provider_id:'provider'}},
 ticket:async(_e,payload)=>{calls.push({path:'ticket'});data.push(payload);abort('ticket');return 'fixture-ticket'},
 serverStream:async req=>{signals.push(req.signal);calls.push({path:'manifest'});abort('manifest');if(manifestFailure)throw Error('fixture-origin-failure');return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('#EXTM3U\n'));},pull(c){c.close()},cancel(){cancels++}}))}
 };
 abort('before');const response=await fn({id:'1',type:live?'live':'movie',ext:live?'m3u8':'mp4',request_id:'old-request'},{sid:'fixture-session',managed,username:'fixture',password:'synthetic-not-secret',exp:12345},'https://fixture.invalid/api',{}, {waitUntil:p=>p.catch(()=>{})},deps);
 for(const c of calls)if(c.body&&'elapsedMs' in c.body)c.body.elapsedMs='<timing>';
 return {status:response.status,body:await response.json(),calls,data,signals,cancels,ac};
}
for(const stage of ['before','/playback-begin','allocation','ticket','/lease-check'])test(`cancel at ${stage}: 410, no later operation, captured lease released at most once`,async()=>{
 const r=await execute({stage});assert.equal(r.status,410);assert.equal(r.body.error,'playback_superseded');const releases=r.calls.filter(c=>c.path==='/release');assert.equal(releases.length,['allocation','ticket','/lease-check'].includes(stage)?1:0);
 if(releases.length)assert.deepEqual(releases[0].body,{sid:'fixture-session',lease_id:'old-lease',request_id:'old-request'});
 assert.equal(r.calls.filter(c=>c.path==='manifest').length,0);assert.equal(r.calls.filter(c=>c.path==='/provider-result').length,0);
 if(['before','/playback-begin','allocation'].includes(stage))assert.equal(r.data.length,0);
});
for(const manifestFailure of [false,true])test(`late manifest ${manifestFailure?'reject':'response'} after cancel does not report failure/retry`,async()=>{
 const r=await execute({stage:'manifest',live:true,manifestFailure});assert.equal(r.status,410);assert.equal(r.calls.filter(c=>c.path==='manifest').length,1);assert.equal(r.calls.filter(c=>c.path==='/release').length,1);assert.equal(r.calls.filter(c=>!['/playback-begin','ticket','manifest','/release'].includes(c.path)).length,0);if(!manifestFailure)assert.equal(r.cancels,1);assert.equal(r.signals[0].aborted,true);assert.equal(r.signals[1].aborted,true);
});
test('release rejection does not turn cancellation into origin failure or retry',async()=>{const r=await execute({stage:'allocation',releaseFailure:true});assert.equal(r.status,410);assert.equal(r.calls.filter(c=>c.path==='/release').length,1);assert.equal(r.data.length,0)});
for(const managed of [false,true])for(const live of [false,true])test(`normal ${managed?'managed':'unmanaged'} ${live?'live':'movie'} keeps exact token payload and response`,async()=>{
 const a=await execute({managed,live}),b=await execute({managed,live,fn:original});assert.equal(a.status,200);assert.deepEqual(a.body,b.body);assert.deepEqual(a.data,b.data);assert.deepEqual(a.calls,b.calls);
});
test('unmanaged cancellation during token creation discards result without lease release',async()=>{const r=await execute({managed:false,stage:'ticket'});assert.equal(r.status,410);assert.equal(r.calls.length,1)});
test('normal manifest failure retains original classification/release path',async()=>{const a=await execute({live:true,manifestFailure:true}),b=await execute({live:true,manifestFailure:true,fn:original});assert.equal(a.status,b.status);assert.deepEqual(a.body,b.body);assert.deepEqual(a.calls,b.calls)});
test('targeted case access mismatch remains 410 before allocation/token',async()=>{
 for(const fn of [original,prepareWebPlayback]){let calls=0;const r=await fn({id:'1',type:'movie',ext:'mp4'},{managed:true,targetedCase:'unrecognized'},'https://fixture.invalid',{}, {},{cleanExt:x=>x,json:(v,status=200)=>Response.json(v,{status}),managedPlayback:()=>{calls++},ticket:()=>{calls++}});assert.equal(r.status,410);assert.equal((await r.json()).error,'playback_expired');assert.equal(calls,0)}
});
test('entry forwards signal; security payload fields are unchanged',async()=>{
 const {readFileSync}=await import('node:fs');const index=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');assert.ok(index.includes('prepareWebPlayback(b,session,req.url,env,ctx,{signal:req.signal,trace,directory'));
 const a=readFileSync(new URL('./web-prepare-original.fixture.mjs',import.meta.url),'utf8'),b=readFileSync(new URL('../src/web-playback.mjs',import.meta.url),'utf8');for(const prefix of ['  const data=','  const url=',' const diagnostic=',' if(session.targetedCase'])assert.equal(b.split('\n').find(l=>l.startsWith(prefix)),a.split('\n').find(l=>l.startsWith(prefix)));
});
test('late allocation rejection after request cancel remains cancellation, no provider report',async()=>{
 const ac=new AbortController();let reports=0;const r=await (process.env.BASELINE?original:prepareWebPlayback)({id:'1',type:'movie',ext:'mp4',request_id:'fixture'},{managed:true},'https://fixture.invalid',{}, {},{signal:ac.signal,cleanExt:x=>x,json:(v,status=200)=>Response.json(v,{status}),directory:async(_e,path)=>{if(path==='/provider-result')reports++;return Response.json({ok:true})},managedPlayback:async()=>{ac.abort();throw Error('provider_unavailable')}});assert.equal(r.status,410);assert.equal(reports,0)
});
test('cancel while manifest body is pending discards late content without provider penalty',async()=>{
 const ac=new AbortController(),entered=deferred(),body=deferred(),calls=[];const fn=process.env.BASELINE?original:prepareWebPlayback;
 const p=fn({id:'1',type:'live',ext:'m3u8',request_id:'old-request'},{managed:true,sid:'old-session'},'https://fixture.invalid',{}, {waitUntil:p=>p.catch(()=>{})},{signal:ac.signal,json:(v,status=200)=>Response.json(v,{status}),cleanExt:x=>x,catalog:async()=>[],directory:async(_e,path,b)=>{calls.push({path,b});return Response.json({ok:true})},managedPlayback:async()=>({r:Response.json({lease_id:'old-lease'}),credentials:{},provider_id:'fixture'}),ticket:async()=> 'fixture',serverStream:async()=>({ok:true,text:async()=>{entered.resolve();return await body.promise}})});
 await entered.promise;ac.abort();body.resolve('#EXTM3U\n');const r=await p;assert.equal(r.status,410);assert.deepEqual(calls.map(c=>c.path),['/playback-begin','/release']);assert.equal(calls[1].b.request_id,'old-request');
});
test('allocation layer already released cancelled lease: preparation does not release twice',async()=>{
 const ac=new AbortController();let releases=0,tickets=0;const directory=async(_e,path)=>{if(path==='/release')releases++;return Response.json({ok:true})};
 const r=await prepareWebPlayback({id:'1',type:'movie',ext:'mp4',request_id:'fixture'},{managed:true},'https://fixture.invalid',{}, {},{signal:ac.signal,cleanExt:x=>x,json:(v,status=200)=>Response.json(v,{status}),directory,managedPlayback:async()=>{ac.abort();await directory({},'/release');throw Error('playback_superseded')},ticket:()=>{tickets++}});assert.equal(r.status,410);assert.equal(releases,1);assert.equal(tickets,0);
});
