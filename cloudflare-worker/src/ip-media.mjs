import {LIVE_STARTUP_MS,VOD_STARTUP_MS,startupTimeout} from './live-startup.mjs';
export const CCF_MEDIA_ORIGIN='http://ccf.center:8444';
// The configured CCF entry is a single explicit hostname/port, not a grant to
// connect to arbitrary DNS names or to caller-supplied destinations.
export const isCcfMediaEntry=(url,sourceOrigin)=>sourceOrigin===CCF_MEDIA_ORIGIN&&url.origin===CCF_MEDIA_ORIGIN&&!url.username&&!url.password;

// Only globally routable IPv4 destinations can be handed out by the configured
// CCF origin. Reject private, loopback, metadata, shared, documentation,
// benchmarking, multicast and reserved address space before opening a socket.
export function isPublicMediaIPv4(host){
 const parts=host.split('.');if(parts.length!==4||parts.some(x=>!/^\d{1,3}$/.test(x)||Number(x)>255))return false;
 const [a,b,c]=parts.map(Number);
 return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||
  a===169&&b===254||a===172&&b>=16&&b<=31||
  a===192&&(b===168||b===0&&(c===0||c===2)||b===88&&c===99)||
  a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
}

// Legacy destinations remain explicit. Rotating destinations require the CCF
// provenance from an authenticated entry point or its encrypted HLS resource
// ticket, never a client-provided URL, header or query parameter.
export function isApprovedMediaIP(u,sourceOrigin){
 if(u.protocol!=='http:'||u.username||u.password)return false;
 if(['192.101.68.144','23.153.217.88','194.147.150.141'].includes(u.hostname)&&(!u.port||u.port==='80'))return true;
 return sourceOrigin===CCF_MEDIA_ORIGIN&&u.port!=='25'&&isPublicMediaIPv4(u.hostname);
}
export async function fetchApprovedMediaIP(value,headers,connectSocket,nativeStreamFactory,sourceOrigin,deadline=null,startupBudget=LIVE_STARTUP_MS,signal,observer){
 const url=new URL(value);if(!isApprovedMediaIP(url,sourceOrigin)&&!isCcfMediaEntry(url,sourceOrigin))throw Error('invalid_media_origin');
 const cancelledReason=()=>signal?.reason ?? new DOMException('Aborted','AbortError');
 if(signal?.aborted)throw cancelledReason();
 const connect=connectSocket||(await import('cloudflare:sockets')).connect;
 if(signal?.aborted)throw cancelledReason();
 const socket=connect({hostname:url.hostname,port:Number(url.port||80)},{secureTransport:'off'});
 socket.closed.catch(()=>{});
 let reader,nativeReader,socketWriter,bodyWriter,bodyError,rejectBodyOperation,bodyIdleTimer,bodyIdleDeadline=0,socketClosed=false,bodyAborted=false,headersComplete=false,observingBody=false,originEnded=false,downstreamCancelled=false;
 // Optional diagnostics reuse these existing reads/writes. They never retain
 // packets, add a reader/timer, or allow an observer failure to affect media.
 const observe=(method,value)=>{if(observer)try{observer[method]?.(value)}catch{}};
 const originEnd=reason=>{if(originEnded||!observingBody||downstreamCancelled||signal?.aborted)return;originEnded=true;observe('originEnd',reason)};
 const originFailure=error=>{
  if(signal?.aborted||downstreamCancelled)return;
  const reason=error?.message==='media_timeout'?'origin_silence':error?.message==='truncated_http_body'?'origin_truncated':'origin_error';
  if(observingBody)originEnd(reason);else if(!headersComplete&&!originEnded){originEnded=true;observe('originEnd',reason)}
 };
 const disposed=new WeakSet();
 const disposeReader=(r,reason)=>{if(!r||disposed.has(r))return;disposed.add(r);void r.cancel(reason).catch(()=>{});try{r.releaseLock()}catch{}};
 const closeSocket=(reason)=>{if(socketClosed)return;socketClosed=true;clearTimeout(bodyIdleTimer);bodyIdleDeadline=0;if(reason)rejectBodyOperation?.(reason);signal?.removeEventListener('abort',onAbort);disposeReader(nativeReader||reader,reason);try{socketWriter?.releaseLock()}catch{};void socket.close().catch(()=>{})};
 const abortBody=reason=>{if(bodyWriter&&!bodyAborted){bodyAborted=true;void bodyWriter.abort(reason).catch(()=>{})}};
 const onAbort=()=>{const reason=cancelledReason();bodyError?.(reason);abortBody(reason);closeSocket(reason)};
 signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)onAbort();
 const abortable=async promise=>{
  if(!signal)return promise;
  if(signal.aborted){void Promise.resolve(promise).catch(()=>{});throw cancelledReason()}
  let listener;
  try{const result=await Promise.race([promise,new Promise((_,reject)=>{listener=()=>reject(cancelledReason());signal.addEventListener('abort',listener,{once:true})})]);if(signal.aborted)throw cancelledReason();return result}
  finally{signal.removeEventListener('abort',listener)}
 };
 const maximum=startupBudget===VOD_STARTUP_MS?VOD_STARTUP_MS:LIVE_STARTUP_MS;
 const timed=async promise=>{let timer;try{return await abortable(Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('media_timeout')),headersComplete?20000:startupTimeout(deadline,deadline===null?20000:maximum))})]))}finally{clearTimeout(timer)}};
 try{
 await timed(socket.opened);
 if(signal?.aborted)throw cancelledReason();
 const writer=socketWriter=socket.writable.getWriter();
 const lines=['GET '+url.pathname+url.search+' HTTP/1.0','Host: '+url.host,'User-Agent: SnapMovieNow/1.0','Accept: */*','Accept-Encoding: identity','Connection: close'];
 for(const name of ['range','if-range'])if(headers.has(name)){const value=headers.get(name);if(/[\r\n]/.test(value))throw Error('invalid_header');lines.push(name+': '+value)}
 await timed(writer.write(new TextEncoder().encode(lines.join('\r\n')+'\r\n\r\n')));writer.releaseLock();socketWriter=null;
 reader=socket.readable.getReader();let buffer=new Uint8Array(0),ended=false;
 async function more(){const at=observer&&observingBody?Date.now():null;let r;try{r=await timed(reader.read())}finally{if(at!==null)observe('originReadWait',Math.max(0,Date.now()-at))}if(r.done){ended=true;return false}const b=new Uint8Array(buffer.length+r.value.length);b.set(buffer);b.set(r.value,buffer.length);buffer=b;return true}
 async function line(){for(;;){for(let i=0;i+1<buffer.length;i++)if(buffer[i]===13&&buffer[i+1]===10){const result=new TextDecoder().decode(buffer.subarray(0,i));buffer=buffer.subarray(i+2);return result}if(buffer.length>65536||ended)throw Error('invalid_http_response');await more()}}
 // Informational replies do not replace the final media response. Match the
 // independent control's bounded header-block count without extending the
 // startup deadline or total header-size limit; protocol upgrades stay denied.
 let status,responseHeaders,headerBytes=0;
 for(let interim=0;interim<4;interim++){
  const statusLine=await line(),match=statusLine.match(/^HTTP\/1\.[01] (\d{3})\b/);if(!match)throw Error('invalid_http_response');
  status=Number(match[1]);if(status<100||status>599||status===101)throw Error('invalid_http_response');
  responseHeaders=new Headers();
  for(;;){const text=await line();if(!text)break;headerBytes+=text.length;if(headerBytes>65536)throw Error('invalid_http_response');const colon=text.indexOf(':');if(colon<1)throw Error('invalid_http_response');responseHeaders.append(text.slice(0,colon),text.slice(colon+1).trim())}
  if(status>=200)break;
 }
 if(status<200)throw Error('invalid_http_response');
 headersComplete=true;observingBody=status>=200&&status<300;
 const chunked=/\bchunked\b/i.test(responseHeaders.get('transfer-encoding')||'');let remaining=responseHeaders.has('content-length')?Number(responseHeaders.get('content-length')):null;
 if(remaining!==null&&(!Number.isSafeInteger(remaining)||remaining<0))throw Error('invalid_http_response');
 responseHeaders.delete('transfer-encoding');responseHeaders.delete('connection');
 // HTTP/1.0 avoids chunk framing. Transfer the video in the runtime's native
 // stream machinery instead of copying and scheduling every TCP packet in JS.
 const factory=nativeStreamFactory||(typeof globalThis.FixedLengthStream==='function'&&typeof globalThis.IdentityTransformStream==='function'?length=>length===null?new IdentityTransformStream():new FixedLengthStream(length):null);
 if(!chunked&&factory){
  const range=responseHeaders.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+)$/);
  const length=remaining??(range?Number(range[2])-Number(range[1])+1:null);
  if(length!==null&&(!Number.isSafeInteger(length)||length<0||buffer.length>length))throw Error('invalid_http_response');
  if([204,205,304].includes(status)||length===0){originEnd('origin_complete');closeSocket();return new Response(length===0&&![204,205,304].includes(status)?'':null,{status,headers:responseHeaders})}
  const stream=factory(length),prefix=buffer;reader.releaseLock();reader=null;
  // Read native byte streams in larger blocks, but finish finite HTTP bodies
  // at Content-Length. Waiting for socket EOF can hang a complete playlist or
  // segment when the upstream keeps the TCP connection open.
  let readBlock;
  try{nativeReader=socket.readable.getReader({mode:'byob'});readBlock=size=>typeof nativeReader.readAtLeast==='function'?nativeReader.readAtLeast(size,new Uint8Array(size)):nativeReader.read(new Uint8Array(size))}
  catch{nativeReader=socket.readable.getReader();readBlock=()=>nativeReader.read()}
  const writer=bodyWriter=stream.writable.getWriter();
  writer.closed.catch(error=>{if(!bodyAborted)downstreamCancelled=true;closeSocket(error)});
  // One watchdog and the existing request-abort listener cover the whole
  // transfer. Recreating a timer, Promise.race and abort subscription per TCP
  // block needlessly spends CPU during long-running video responses.
  const watchBodyIdle=()=>{
   bodyIdleTimer=undefined;if(!bodyIdleDeadline||socketClosed)return;
   const remaining=bodyIdleDeadline-Date.now();
   if(remaining>0){bodyIdleTimer=setTimeout(watchBodyIdle,remaining);bodyIdleTimer?.unref?.();return}
   const error=Error('media_timeout');originFailure(error);rejectBodyOperation?.(error);abortBody(error);closeSocket(error);
  };
  const bodyOperation=(operation,reading=false)=>new Promise((resolve,reject)=>{
   let settled=false;const at=observer&&observingBody?Date.now():null;
   const finish=(done,value)=>{if(settled)return;settled=true;if(rejectBodyOperation===fail)rejectBodyOperation=undefined;if(reading)bodyIdleDeadline=0;if(at!==null)observe(reading?'originReadWait':'originWriteWait',Math.max(0,Date.now()-at));done(value)};
   const fail=error=>finish(reject,error);rejectBodyOperation=fail;
   if(signal?.aborted){fail(cancelledReason());return}
   if(socketClosed){fail(Error('client_disconnected'));return}
   if(reading){bodyIdleDeadline=Date.now()+20000;if(bodyIdleTimer===undefined){bodyIdleTimer=setTimeout(watchBodyIdle,20000);bodyIdleTimer?.unref?.()}}
   try{Promise.resolve(operation()).then(value=>finish(resolve,value),fail)}catch(error){fail(error)}
  });
  (async()=>{try{
   let received=prefix.length,initial=prefix.length===0;if(prefix.length){if(observingBody)observe('originBytes',prefix.length);await bodyOperation(()=>writer.write(prefix))}
   while(length===null||received<length){
    const size=length===null?65536:Math.min(65536,length-received);let chunk;
    try{chunk=await bodyOperation(()=>readBlock(initial?1:size),true)}catch(error){originFailure(error);throw error}initial=false;
    if(chunk.done){if(length!==null&&received<length){const error=Error('truncated_http_body');originFailure(error);throw error}originEnd('origin_eof');break}
    const bytes=length===null?chunk.value:chunk.value.subarray(0,length-received);
    received+=bytes.length;if(observingBody)observe('originBytes',bytes.length);await bodyOperation(()=>writer.write(bytes));
   }
   if(length!==null&&received>=length)originEnd('origin_complete');closeSocket();await writer.close();
  }catch(error){abortBody(error)}
  finally{closeSocket();try{writer.releaseLock()}catch{}}})();
  return new Response(stream.readable,{status,headers:responseHeaders});
 }
 let chunkRemaining=0,chunkCRLF=false,finished=false;
 const close=reason=>{finished=true;closeSocket(reason)};
 if([204,205,304].includes(status)){originEnd('origin_complete');close();return new Response(null,{status,headers:responseHeaders})}
 const body=new ReadableStream({
 start(controller){bodyError=reason=>{if(!finished){close(reason);controller.error(reason)}};if(signal?.aborted)bodyError(cancelledReason())},
 async pull(controller){try{
 if(finished){controller.close();return}
 if(chunked){
 if(chunkCRLF){if(await line()!=='')throw Error('invalid_http_chunk');chunkCRLF=false}
 if(!chunkRemaining){const size=(await line()).split(';')[0];if(!/^[0-9a-f]+$/i.test(size))throw Error('invalid_http_chunk');chunkRemaining=parseInt(size,16);if(!Number.isSafeInteger(chunkRemaining))throw Error('invalid_http_chunk');if(!chunkRemaining){originEnd('origin_complete');close();controller.close();return}}
 if(!buffer.length&&!await more())throw Error('truncated_http_body');
 const n=Math.min(buffer.length,chunkRemaining);if(observingBody)observe('originBytes',n);controller.enqueue(buffer.slice(0,n));buffer=buffer.subarray(n);chunkRemaining-=n;if(!chunkRemaining)chunkCRLF=true;return;
 }
 if(remaining===0){originEnd('origin_complete');close();controller.close();return}
 if(!buffer.length&&!await more()){if(remaining!==null&&remaining>0)throw Error('truncated_http_body');originEnd('origin_eof');close();controller.close();return}
 const n=remaining===null?buffer.length:Math.min(buffer.length,remaining);if(observingBody)observe('originBytes',n);controller.enqueue(buffer.slice(0,n));buffer=buffer.subarray(n);if(remaining!==null)remaining-=n;
 }catch(e){if(!finished){originFailure(e);close(e);controller.error(e)}}},
 cancel(reason){downstreamCancelled=true;close(reason)}
 });
 return new Response(body,{status,headers:responseHeaders});
 }catch(e){originFailure(e);closeSocket(e);throw e}
}

