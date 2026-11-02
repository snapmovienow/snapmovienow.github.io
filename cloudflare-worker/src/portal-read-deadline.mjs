// Only ordinary panel GET/read operations follow caller cancellation.
// Mutation, entry, logout and security routes retain their existing semantics.
export function portalReadDeadline(request,path,action,milliseconds=16000) {
 if(request.method!=='GET'||path!=='/api/panel'||action!=='read')return {signal:AbortSignal.timeout(milliseconds),cleanup(){}};
 const controller=new AbortController(),caller=request.signal;let timer,cleaned=false;
 const cleanup=()=>{if(cleaned)return;cleaned=true;clearTimeout(timer);caller.removeEventListener('abort',onAbort)};
 const onAbort=()=>{controller.abort(caller.reason);cleanup()};
 if(caller.aborted)onAbort();
 else {caller.addEventListener('abort',onAbort,{once:true});timer=setTimeout(()=>{controller.abort(new DOMException('The operation was aborted due to timeout','TimeoutError'));cleanup()},milliseconds)}
 return {signal:controller.signal,cleanup};
}
