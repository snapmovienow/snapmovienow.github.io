// Pipe through native streams so an open response can be aborted at its signed
// deadline without running a JavaScript callback for every video packet.
export function guardPlaybackExpiry(response, expiresAt, signal, onExpire, ctx) {
 if(!response.body||!Number.isFinite(expiresAt))return response;
 const abort=new AbortController();let timer,finished=false,expired=false;
 const cleanup=()=>{if(finished)return;finished=true;clearTimeout(timer);signal?.removeEventListener('abort',disconnected)};
 const disconnected=()=>abort.abort(Error('client_disconnected'));
 const expire=()=>{
  if(finished||expired)return;expired=true;abort.abort(Error('access_expired'));
  const task=Promise.resolve().then(onExpire).catch(()=>{});ctx?.waitUntil?.(task);
 };
 const schedule=()=>{const remaining=expiresAt-Date.now();if(remaining<=0)expire();else {timer=setTimeout(schedule,Math.min(remaining,2147483647));timer?.unref?.()}};
 const length=Number(response.headers.get('content-length'));
 const stream=typeof FixedLengthStream==='function'&&response.headers.has('content-length')&&Number.isSafeInteger(length)&&length>=0?new FixedLengthStream(length):typeof IdentityTransformStream==='function'?new IdentityTransformStream():new TransformStream();
 signal?.addEventListener('abort',disconnected,{once:true});
 const piping=response.body.pipeTo(stream.writable,{signal:abort.signal});piping.catch(()=>{}).finally(cleanup);
 if(signal?.aborted)disconnected();else schedule();
 return new Response(stream.readable,{status:response.status,statusText:response.statusText,headers:response.headers});
}
