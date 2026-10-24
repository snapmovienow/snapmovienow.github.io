// Bounded, owner-only comparison. Never store URLs, media IDs, credentials,
// exception text, response bodies or arbitrary upstream headers.
import {safeValidationFailure} from './playback-diagnostics.mjs';
const reasons=new Set(['ok','timeout','http_error','invalid_reply','invalid_media','empty_media','preempted','origin_policy','http_parser','socket_error','invocation_context','internal_error','prepare_failed']);
export function comparisonError(error){
 const message=String(error?.message||'');
 if([409,410,429].includes(error?.status))return 'preempted';
 const code=safeValidationFailure(error?.failureCode);if(code)return code;
 if(/different request|I\/O context|request context/i.test(message))return 'invocation_context';
 if(/media_origin_unapproved|invalid_media_origin/.test(message))return 'origin_policy';
 if(/invalid_http|truncated_http/.test(message))return 'http_parser';
 if(/timeout|abort/i.test(message))return 'timeout';
 if(/socket|connect|proxy request failed/i.test(message))return 'socket_error';
 return 'internal_error';
}
export function comparisonVerdict(origin,relay){
 if(origin.reason==='preempted'||relay.reason==='preempted')return 'deferred';
 if(origin.ok&&relay.ok)return 'not_reproduced';
 if(origin.ok&&!relay.ok)return 'gateway_path';
 if(origin.reason==='origin_policy'||relay.reason==='origin_policy')return 'gateway_origin_policy';
 if(!origin.ok&&!relay.ok&&origin.httpStatus>=500)return 'origin_http_error';
 if(!origin.ok&&!relay.ok&&[401,403].includes(origin.httpStatus))return 'origin_rejected';
 if(!origin.ok&&!relay.ok&&origin.httpStatus===404)return 'origin_not_found';
 return 'inconclusive';
}
export async function measureComparison(open,{timeoutMs=8000,trustedRelay=false}={}){
 const started=Date.now(),controller=new AbortController();let response,reader,timer,bytes=0;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('comparison_timeout'))},timeoutMs)});
 const within=promise=>Promise.race([promise,timeout]);
 const outcome=(ok,reason)=>({ok,reason:reasons.has(reason)?reason:'internal_error',httpStatus:response?.status||null,ms:Date.now()-started,bytes});
 try{
  const work=Promise.resolve().then(()=>open({signal:controller.signal,deadline:started+timeoutMs}));
  work.then(r=>{if(controller.signal.aborted)void r.body?.cancel().catch(()=>{})},()=>{});
  response=await within(work);
  if(!response.ok){const detail=trustedRelay?response.headers.get('x-smn-canary-failure'):null;return outcome(false,[409,410,429].includes(response.status)?'preempted':reasons.has(detail)?detail:'http_error')}
  reader=response.body?.getReader();if(!reader)return outcome(false,'empty_media');
  const chunks=[];while(bytes<16){const next=await within(reader.read());if(next.done)break;if(!next.value?.byteLength)continue;const chunk=next.value.subarray(0,65536-bytes);chunks.push(chunk);bytes+=chunk.byteLength;if(bytes>=65536)break}
  if(bytes<4)return outcome(false,'empty_media');
  const sample=new Uint8Array(bytes);let at=0;for(const chunk of chunks){sample.set(chunk,at);at+=chunk.byteLength}
  const ascii=(a,b)=>String.fromCharCode(...sample.subarray(a,b)),prefix=ascii(0,Math.min(64,bytes)).trimStart();
  const signature=sample[0]===0x47&&(sample[3]&0x30)!==0||['ftyp','styp','moov','moof','mdat','sidx'].includes(ascii(4,8))||sample[0]===0x1a&&sample[1]===0x45&&sample[2]===0xdf&&sample[3]===0xa3;
  const valid=signature&&!/^(?:<|\{|\[|error|unauthorized|access denied)/i.test(prefix);return outcome(valid,valid?'ok':'invalid_media');
 }catch(error){return outcome(false,comparisonError(error))}
 finally{clearTimeout(timer);controller.abort();let cleanup;try{const cancel=reader?reader.cancel():response?.body?.cancel();if(cancel)await Promise.race([cancel.catch(()=>{}),new Promise(r=>{cleanup=setTimeout(r,200)})])}finally{clearTimeout(cleanup)}}
}
export async function compareOwnPlayback(adapter,control,{username,type='live',directCcfEntry=false}={}){
 const controller=new AbortController(),deadline=Date.now()+30000,timer=setTimeout(()=>controller.abort(),30000);let session,target,phase='authentication';
 const within=promise=>new Promise((resolve,reject)=>{const abort=()=>reject(Error('comparison_timeout'));if(controller.signal.aborted)return abort();controller.signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(resolve,reject).finally(()=>controller.signal.removeEventListener('abort',abort))});
 try{
  session=await within(adapter.authenticate({username,type,diagnostic:true},{signal:controller.signal}).then(value=>{if(controller.signal.aborted)void adapter.release(value).catch(()=>{});return value}));phase='preparation';
  target=await within(adapter.select(session,{username,type,transport:type==='live'?'ts':'auto'},{signal:controller.signal}));
  if(controller.signal.aborted)throw Error('comparison_timeout');
  const origin=await measureComparison(options=>control(session,target,options),{timeoutMs:Math.max(1,Math.min(8000,deadline-Date.now()))});
  if(controller.signal.aborted)throw Error('comparison_timeout');
  const relay=await measureComparison(options=>adapter.open(session,target,options),{trustedRelay:true,timeoutMs:Math.max(1,Math.min(8000,deadline-Date.now()))});
  return {at:Date.now(),type,transport:type==='live'?'ts':'range',control:directCcfEntry?'independent_tcp_entry_v3':'independent_origin_v2',verdict:comparisonVerdict(origin,relay),origin,relay};
 }catch(error){return {at:Date.now(),type,verdict:[409,410,429].includes(error?.status)?'deferred':'preparation_unconfirmed',phase,httpStatus:Number.isInteger(error?.status)?error.status:null,reason:comparisonError(error)}}
 finally{clearTimeout(timer);controller.abort();if(session){let cleanup;await Promise.race([Promise.resolve().then(()=>adapter.release(session)).catch(()=>{}),new Promise(r=>{cleanup=setTimeout(r,1000)})]);clearTimeout(cleanup)}}
}
