// A diagnostic source is not fault attribution. A local deadline may expire
// while waiting for a remote service; an HTTP response may come from a gateway.
// Only these two server-generated 504 combinations carry affirmative evidence.
export function mediaFailureCause(status,value){
 if(status!==504)return {};
 if(value?.errorOrigin==='local_deadline'&&value.serviceError==='live_startup_timeout')return {errorOrigin:'local_deadline',serviceError:'live_startup_timeout'};
 if(value?.errorOrigin==='upstream_response'&&value.serviceError==='upstream_unavailable')return {errorOrigin:'upstream_response',serviceError:'upstream_unavailable'};
 return {errorOrigin:'unknown'};
}
// Use only on our media relay's response, after its upstream-header whitelist.
// Absence of a code is unknown, never evidence that an upstream returned 504.
export function responseMediaFailure(response){
 const code=response?.headers.get('X-SMN-Error-Code');
 return mediaFailureCause(response?.status,{serviceError:code,errorOrigin:code==='live_startup_timeout'?'local_deadline':code==='upstream_unavailable'?'upstream_response':'unknown'});
}
