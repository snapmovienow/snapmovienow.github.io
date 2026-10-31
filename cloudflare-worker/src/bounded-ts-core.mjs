// LOCAL CANDIDATE ONLY. No production route is registered by this module.
export const LIMITS = Object.freeze({ms:15000, bytes:4000000});
const id = v => typeof v === 'string' && /^\d{1,14}$/.test(v);
const alias = v => typeof v === 'string' && /^[a-z0-9_-]{1,32}$/.test(v);
const contentType = h => ['video/mp2t','application/octet-stream'].includes((h||'').split(';')[0].trim().toLowerCase()) ? h.split(';')[0].trim().toLowerCase() : 'other';
const quiet = fn => {try {return Promise.resolve(fn()).catch(()=>false)} catch {return Promise.resolve(false)}};

// Adapters MUST preserve signal, use the existing session/auth/catalog/adult/
// capacity checks, open ONE selected source with redirect:error and no fallback,
// and expose a byte reader. Never adapt the ordinary retrying playback route.
export async function runBoundedTs({session, selection, enabled=false, signal}, deps) {
 const clock=deps.clock||{now:()=>performance.now(),setTimeout,clearTimeout};
 const started=clock.now(), abort=new AbortController();
 let lease, reader, ended=false, timer, bytes=0, status=null, mime=null, mapping=null;
 let stopReason='unavailable', readerCancelled=false, leaseReleased=false;
 let resolveStop;
 const stopped=new Promise(resolve=>resolveStop=resolve);
 const pending=[], cleanedReaders=new WeakSet(), cleanedLeases=new Set();
 const finish=reason=>{if(ended)return;ended=true;stopReason=reason;abort.abort(reason);resolveStop({stopped:true});};
 const onAbort=()=>finish('cancelled');
 const cleanReader=r=>{if(cleanedReaders.has(r))return;cleanedReaders.add(r);const p=quiet(async()=>{await r.cancel();return true}).then(ok=>{readerCancelled=ok===true});pending.push(p);deps.retainCleanup?.(p);};
 const cleanLease=l=>{if(cleanedLeases.has(l))return;cleanedLeases.add(l);const p=quiet(()=>deps.release(l)).then(ok=>{leaseReleased=ok===true});pending.push(p);deps.retainCleanup?.(p);};
 const check=()=>{if(clock.now()-started>=LIMITS.ms)finish('deadline');return !ended;};
 const step=async(fn,late)=>{
  if(!check())return null;
  const p=Promise.resolve().then(()=>{if(!check())return {stopped:true};return fn(abort.signal)});
  p.then(v=>{if(ended && v && !v.stopped)late?.(v)},()=>{});
  const result=await Promise.race([p,stopped]);
  if(result?.stopped)return null;
  if(!check()){late?.(result);return null;}
  return result;
 };
 try {
  if(!enabled || session?.username!=='dieguito2026' || !id(selection?.channelId) || !alias(selection?.server)) {finish('not_enabled');throw Error('stopped')}
  timer=clock.setTimeout(()=>finish('deadline'),LIMITS.ms);
  signal?.addEventListener('abort',onAbort,{once:true});
  if(signal?.aborted)finish('cancelled');
  if(!await step(s=>deps.authorize(session,s))) {if(!ended)finish('unauthorized');throw Error('stopped')}
  const channel=await step(s=>deps.resolveAuthorizedChannel(session,selection,s));
  if(!channel)throw Error('stopped');
  // Only authoritative catalog resolution may produce this mapping, not names.
  if(channel.channelId!==selection.channelId || channel.server!==selection.server || !id(channel.publicId)) {finish('mapping_unverified');throw Error('stopped')}
  mapping={channelId:channel.channelId,publicId:channel.publicId,server:channel.server};
  lease=await step(s=>deps.allocateOnce(session,channel,s),cleanLease);
  if(!lease)throw Error('stopped');
  const response=await step(s=>deps.openTsOnce(lease,channel,{signal:s,redirect:'error',maxBytes:LIMITS.bytes}),r=>{if(r.body)cleanReader(r.body)});
  if(!response)throw Error('stopped');
  status=response.status;mime=contentType(response.headers.get('content-type'));
  if(!response.ok){if(response.body)cleanReader(response.body);finish('http_error');throw Error('stopped')}
  if(mime==='other'){if(response.body)cleanReader(response.body);finish('unexpected_content_type');throw Error('stopped')}
  try {reader=response.body.getReader({mode:'byob'})} catch {if(response.body)cleanReader(response.body);finish('byte_reader_required');throw Error('stopped')}
  while(check()) {
   const n=await step(()=>reader.read(new Uint8Array(Math.min(65536,LIMITS.bytes-bytes))));
   if(!n)break;
   if(n.value)bytes+=n.value.byteLength;
   if(bytes>=LIMITS.bytes){finish('byte_limit');break}
   if(n.done){finish('eof');break}
  }
 } catch {finish('operation_failed')}
 finally {
  if(!ended)finish(stopReason);
  clock.clearTimeout(timer);signal?.removeEventListener('abort',onAbort);
  if(reader)cleanReader(reader);
  if(lease)cleanLease(lease);
  // Cleanup never extends media activity or blocks result forever. Host must
  // retain this finite cleanup task (waitUntil). Slow release is not success.
  deps.retainCleanup?.(Promise.allSettled(pending));
 }
 return result();
 function result(){return {kind:'ts-bounded-diagnostic',mapping,httpStatus:status,contentType:mime,bytesRead:bytes,elapsedMs:Math.max(0,clock.now()-started),stopReason,abortRequested:abort.signal.aborted,readerCancelRequested:!!reader,leaseReleaseRequested:!!lease,readerCancelled,leaseReleased,source:'unverified_adapter',videoValidated:false,audioValidated:false}}
}

