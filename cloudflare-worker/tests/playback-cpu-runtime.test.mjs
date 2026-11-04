// Real workerd TCP sockets exercise the production media pump, startup probe,
// Range recovery and Xtream guards without contacting a provider or account.
import assert from 'node:assert/strict';
import net from 'node:net';
import {once} from 'node:events';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';

const size=4*1024*1024+137,cases=new Map(),sockets=new Set();
const server=net.createServer(socket=>{
 sockets.add(socket);socket.on('error',()=>{});
 let request='',active;
 socket.on('close',()=>{sockets.delete(socket);if(active)active.closed=true});
 socket.on('data',async bytes=>{
  if(active)return;request+=bytes.toString('latin1');if(!request.includes('\r\n\r\n'))return;
  const path=request.split(' ')[1]||'',match=path.match(/^\/([a-z]+)-(\d+)\.ts$/);
  if(!match){socket.destroy();return}
  const [,kind,fragmentText]=match,fragment=Number(fragmentText);let resume;
  active={closed:false,resume:()=>resume?.()};cases.set(path,active);
  const gate=new Promise(resolve=>resume=resolve),finite=kind==='vod';
  const headers=['HTTP/1.0 '+(finite?'206 Partial Content':'200 OK'),'Content-Type: video/mp2t'];
  if(finite)headers.push('Content-Length: '+size,'Content-Range: bytes 77-'+(size+76)+'/'+(size+1000));
  const chunk=(offset,count)=>{const b=Buffer.alloc(count);for(let i=0;i<count;i++)b[i]=(offset+i)%251;return b};
  const write=async bytes=>{if(!socket.write(bytes))await once(socket,'drain')};
  try{
   await write(Buffer.concat([Buffer.from(headers.join('\r\n')+'\r\n\r\n'),chunk(0,1024)]));
   await gate;
   for(let offset=1024;offset<size&&!socket.destroyed;offset+=fragment)await write(chunk(offset,Math.min(fragment,size-offset)));
   if(!socket.destroyed)socket.end();
  }catch{socket.destroy()}
 });
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const fixture=String.raw`
import {connect} from 'cloudflare:sockets';
import {fetchApprovedMediaIP} from './cloudflare-worker/src/ip-media.mjs';
import {readInitialMedia} from './cloudflare-worker/src/live-startup.mjs';
import {recoverMedia} from './cloudflare-worker/src/media-fetch.mjs';
import {guardXtreamResponse} from './cloudflare-worker/src/xtream-bridge.mjs';
import {selectLiveFlowDiagnostic,createLiveFlowMonitor} from './cloudflare-worker/src/live-flow-diagnostics.mjs';
const ensure=(ok,message)=>{if(!ok)throw Error(message)};
const deadline=async(promise,message)=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error(message)),1000))])}finally{clearTimeout(timer)}};
async function run(env,kind,fragment,mode='transfer',diagnosticEnabled=false){
 const path='/'+kind+'-'+fragment+'.ts',signal=new AbortController();
 const records=[],at=Date.now(),diagnosticConfig={LIVE_FLOW_DIAGNOSTIC_USERNAME:'runtime-fixture',LIVE_FLOW_DIAGNOSTIC_CASE:'11111111-1111-4111-8111-111111111111',LIVE_FLOW_DIAGNOSTIC_FROM:at-1000,LIVE_FLOW_DIAGNOSTIC_UNTIL:at+3600000};
 const selected=diagnosticEnabled?selectLiveFlowDiagnostic(diagnosticConfig,{username:'runtime-fixture',type:'live',ext:'ts',method:'GET',requestId:crypto.randomUUID(),publicId:'1'},at):null;
 if(diagnosticEnabled)ensure(selected!==null,'diagnostic fixture was not selected');
 const flowMonitor=selected?createLiveFlowMonitor(selected,{logger:record=>records.push(record)}):undefined;
 let bodyTimers=0,abortListeners=0,releases=0,resumes=0,tick;
 const realTimeout=globalThis.setTimeout,realInterval=globalThis.setInterval,add=signal.signal.addEventListener.bind(signal.signal);
 globalThis.setTimeout=(fn,ms,...args)=>{if(ms===20000)bodyTimers++;return realTimeout(fn,ms,...args)};
 signal.signal.addEventListener=(type,...args)=>{if(type==='abort')abortListeners++;return add(type,...args)};
 try{
  const raw=await fetchApprovedMediaIP('http://192.101.68.144'+path,new Headers(),()=>connect({hostname:'127.0.0.1',port:PORT}),undefined,undefined,null,8000,signal.signal,flowMonitor);
  flowMonitor?.setStatus(raw.status);
  let response=await readInitialMedia(raw,Date.now()+500);
  if(kind==='vod')response=recoverMedia(response,()=>{resumes++;throw Error('unexpected resume')},async()=>true);
  const background=[];
  globalThis.setInterval=(fn,ms)=>{tick=fn;return realInterval(()=>{},ms)};
  let guarded;
  try{guarded=guardXtreamResponse(response,async()=>false,async()=>{releases++},{waitUntil:p=>background.push(p)},signal.signal,mode==='expiry'?Date.now()+20:undefined,{flowMonitor})}finally{globalThis.setInterval=realInterval}
  ensure(guarded.status===(kind==='vod'?206:200),'HTTP status changed');
  if(kind==='vod')ensure(guarded.headers.get('content-range')==='bytes 77-'+(SIZE+76)+'/'+(SIZE+1000),'Range changed');
  const reader=guarded.body.getReader();let received=0,playerChunks=0;
  const check=chunk=>{for(let i=0;i<chunk.length;i++)ensure(chunk[i]===(received+i)%251,'media byte changed');received+=chunk.length;playerChunks++};
  // The server is held at 1KiB until this read completes. A batching minimum
  // that delays the first payload would deadlock rather than appear faster.
  const first=await deadline(reader.read(),'first payload waited for another TCP block');ensure(!first.done&&first.value.length>0,'first payload missing');check(first.value);
  if(mode==='transfer'){
   await env.CONTROL.fetch('https://control/resume?path='+encodeURIComponent(path));
   for(;;){const next=await deadline(reader.read(),'media stalled at '+received);if(next.done)break;check(next.value)}
   ensure(received===SIZE,'media length changed');ensure(resumes===0,'healthy media triggered resume');
   ensure(bodyTimers<=(kind==='vod'?Math.ceil(SIZE/65536)+12:8),kind+' media pipeline allocated too many idle timers: '+bodyTimers);
   ensure(abortListeners<=8,'media pump still allocates per-block abort listeners: '+abortListeners);
  }else{
   let failure;const pending=reader.read().catch(error=>failure=error.message);
   if(mode==='cancel')await deadline(reader.cancel('viewer closed'),'cancel blocked');
   else if(mode==='abort')signal.abort();
   else if(mode==='revoke')await tick();
   await deadline(pending,'stop did not reach player');
   if(mode==='expiry')ensure(failure==='access_expired','expiry guard changed');
   if(mode==='revoke')ensure(failure==='access_revoked','revocation guard changed');
   if(mode==='abort')ensure(failure==='client_disconnected','abort guard changed');
   // A body-only cancellation is observed by a native writable on its next
   // write; a real request abort must also close a completely silent source.
   if(mode!=='abort')await env.CONTROL.fetch('https://control/resume?path='+encodeURIComponent(path));
   const status=await (await env.CONTROL.fetch('https://control/closed?path='+encodeURIComponent(path))).json();
   ensure(status.closed,'upstream TCP socket remained open after '+mode);
  }
  await deadline(Promise.all(background),'capacity cleanup blocked');ensure(releases===1,'reservation was not released exactly once');
  let diagnostic;
  if(diagnosticEnabled){
   const starts=records.filter(record=>record.event==='live_flow_start'),ends=records.filter(record=>record.event==='live_flow_end');
   ensure(starts.length===1&&ends.length===1,'flow lifecycle was not recorded exactly once');
   const ended=ends[0];ensure(ended.scope==='server_relay_not_client','measurement scope changed');
   ensure(ended.relay_bytes===received,'relay diagnostic byte count changed');
   ensure(bodyTimers<=8,'enabled diagnostics added idle timers: '+bodyTimers);ensure(abortListeners<=8,'enabled diagnostics added abort listeners: '+abortListeners);
   if(mode==='transfer'){
    ensure(ended.origin_observed===true&&ended.origin_bytes===SIZE,'origin diagnostic byte count changed');
    ensure(ended.origin_reason==='origin_eof','real socket EOF was not distinguished');
    ensure(ended.reason==='relay_complete','relay completion was not distinguished');
   }else{
    const expected=mode==='cancel'?'client_cancel':mode==='abort'?'client_abort':mode==='expiry'?'access_expired':'session_denied';
    ensure(ended.reason===expected,'downstream stop diagnostic changed: '+ended.reason);
    ensure(ended.origin_reason!=='origin_error'&&ended.origin_reason!=='origin_silence','downstream stop was attributed to the origin');
   }
   const serialized=JSON.stringify(records);ensure(!serialized.includes('runtime-fixture')&&!serialized.includes('http:')&&!serialized.includes('192.101.68.144'),'diagnostic record leaked fixture identity or URL');
   diagnostic={events:records.length,ends:ends.length,originBytes:ended.origin_bytes,relayBytes:ended.relay_bytes,originReason:ended.origin_reason,reason:ended.reason};
  }else ensure(records.length===0,'disabled diagnostics recorded events');
  return {kind,fragmentBytes:fragment,mode,bytes:received,playerChunks,bodyTimers,abortListeners,releases,...(diagnostic?{diagnostic}: {})};
 }finally{globalThis.setTimeout=realTimeout;globalThis.setInterval=realInterval}
}
export default {async fetch(request,env){try{
 const transfers=[];for(const kind of ['live','vod'])for(const fragment of [1024,65536])transfers.push(await run(env,kind,fragment));
 const stops=[];for(const mode of ['cancel','abort','expiry','revoke'])stops.push(await run(env,mode,1024,mode));
 const diagnosticTransfers=[];for(const fragment of [1024,65536])diagnosticTransfers.push(await run(env,'live',fragment,'transfer',true));
 const diagnosticStops=[];for(const mode of ['cancel','abort'])diagnosticStops.push(await run(env,mode,1024,mode,true));
 return Response.json({ok:true,transfers,stops,diagnosticTransfers,diagnosticStops});
}catch(error){return Response.json({ok:false,error:error.message,stack:error.stack},{status:500})}}};
`;
const bundled=await build({stdin:{contents:fixture.replaceAll('PORT',String(port)).replaceAll('SIZE',String(size)),resolveDir:process.cwd(),sourcefile:'playback-cpu-fixture.mjs'},bundle:true,format:'esm',platform:'browser',external:['cloudflare:sockets'],write:false});
const control=async request=>{
 const u=new URL(request.url),entry=cases.get(u.searchParams.get('path'));
 if(u.pathname==='/resume')entry?.resume();
 if(u.pathname==='/closed')for(let i=0;entry&&!entry.closed&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,5));
 return Response.json({closed:entry?.closed===true});
};
const options={modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-03',compatibilityFlags:['enable_request_signal'],serviceBindings:{CONTROL:control},outboundService:()=>{throw Error('Only the local TCP fixture and control binding are allowed')}};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);let timer;
try{
 const response=await Promise.race([mf.dispatchFetch('https://synthetic.invalid/stream-regressions'),new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('TCP stream regression exceeded 20 seconds')),20000))]);
 const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));assert.equal(result.ok,true,JSON.stringify(result));
 console.log(JSON.stringify(result,null,2));
 console.log('PASS: real workerd TCP live/VOD bytes, first payload, Range, bounded timers/listeners, cancellation, expiry and revocation, with enabled flow observation on real EOF/cancel/abort.');
}finally{
 clearTimeout(timer);for(const entry of cases.values())entry.resume();for(const socket of sockets)socket.destroy();
 await mf.dispose();await new Promise(resolve=>server.close(resolve));
}
