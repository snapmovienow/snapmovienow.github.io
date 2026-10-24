// A canary uses an explicitly configured owner account and the same permission,
// allocation and stream paths as a viewer. It observes bytes, not decoder frames.
import {comparisonError} from './playback-comparison.mjs';
import {playbackRequestDiagnostic} from './playback-diagnostics.mjs';
export const CANARY_TIMEOUT_MS=15000;
const MAX_BYTES=65536,MAX_HOPS=4;
const TYPES=new Set(['live','movie','series']);
const username=value=>typeof value==='string'&&/^[a-zA-Z0-9_.@-]{3,80}$/.test(value)?value.toLowerCase():null;
export function cleanCanarySettings(body,allowedUsername){
 const allowed=username(allowedUsername);
 if(typeof body?.enabled!=='boolean')return {error:'invalid_canary_settings'};
 if(body.enabled&&!allowed)return {error:'canary_account_not_configured'};
 const types=body.types===undefined?['live','series']:body.types;
 if(!Array.isArray(types)||!types.length||types.length>3||types.some(x=>!TYPES.has(x))||new Set(types).size!==types.length)return {error:'invalid_canary_types'};
 if(body.username!==undefined&&username(body.username)!==allowed)return {error:'canary_account_not_allowed'};
 return {enabled:body.enabled,username:allowed,types:[...types]};
}
export function defaultCanarySettings(env){
 const allowed=username(env.PLAYBACK_CANARY_USERNAME);
 return {enabled:!!allowed&&env.PLAYBACK_CANARY_ENABLED!=='false',username:allowed,types:['live','series']};
}
const safeReason=(status,phase)=>status===401||status===403?'account_unavailable':status===409||status===410||status===429?'capacity_busy':status===404?'sample_unavailable':phase==='first_media_byte'?'media_not_arriving':'playback_unavailable';
export function cleanCanaryResult(value,type,at=Date.now()){
 const statuses=['healthy','failed','busy','skipped'],reasons=['ok','timeout','account_unavailable','capacity_busy','sample_unavailable','media_not_arriving','playback_unavailable','invalid_playlist','invalid_media','sample_not_configured'];
 const number=value=>Number.isFinite(value)&&value>=0?Math.min(300000,Math.round(value)):null;
 const stages={};for(const key of ['authenticationMs','catalogPrepareMs','mediaHeadersMs','firstMediaByteMs'])if(number(value?.stages?.[key])!==null)stages[key]=number(value.stages[key]);
 const failure=value?.failure,phases=['authentication','catalog_prepare','media_headers','first_media_byte'],codes=['timeout','http_error','origin_policy','http_parser','socket_error','invocation_context','internal_error','preempted'];
 const detail=failure&&phases.includes(failure.phase)?{phase:failure.phase,code:codes.includes(failure.code)?failure.code:'internal_error',httpStatus:Number.isInteger(failure.httpStatus)&&failure.httpStatus>=100&&failure.httpStatus<=599?failure.httpStatus:null,...playbackRequestDiagnostic(failure)}:null;
 return {ok:value?.ok===true,status:statuses.includes(value?.status)?value.status:'failed',reason:reasons.includes(value?.reason)?value.reason:'playback_unavailable',type:TYPES.has(type)?type:'live',at,totalMs:number(value?.totalMs),firstMediaByteMs:number(value?.firstMediaByteMs),bytes:Math.min(MAX_BYTES,number(value?.bytes)||0),stages,...(detail?{failure:detail}:{})};
}

// Adapters retain opaque sessions/URLs locally. No error message, credential,
// target URL or account name enters the result or operational incident history.
export async function runPlaybackCanary(config,adapter,{timeoutMs=CANARY_TIMEOUT_MS,now=Date.now}={}){
 const start=now(),controller=new AbortController(),signal=controller.signal;
 const timer=setTimeout(()=>controller.abort(),Math.max(1,Math.min(CANARY_TIMEOUT_MS,timeoutMs)));
 const stages={},bodies=new Set();let session,target,phase='authentication',bytes=0,firstMediaByteMs=null;
 const within=promise=>new Promise((resolve,reject)=>{
  if(signal.aborted){reject(Error('canary_timeout'));return}
  const abort=()=>reject(Error('canary_timeout'));signal.addEventListener('abort',abort,{once:true});
  Promise.resolve(promise).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
 const stage=async(name,fn)=>{const at=now();try{if(signal.aborted)throw Error('canary_timeout');return await within(Promise.resolve().then(fn))}finally{stages[name]=Math.max(0,now()-at)}};
 const lateRelease=(value,item)=>{if(value&&adapter.release)void Promise.resolve().then(()=>adapter.release(value,item)).catch(()=>{})};
 const opened=async promise=>{const response=await promise;if(signal.aborted){void response?.body?.cancel().catch(()=>{});throw Error('canary_timeout')}return response};
 const check=response=>{if(!(response instanceof Response))throw Error('playback_unavailable');if(response.body)bodies.add(response.body);if(!response.ok){const error=Error('canary_http');error.status=response.status;error.failureCode=response.headers.get('x-smn-canary-failure');throw error}return response};
 const isMedia=(data,content)=>{
  const ascii=(from,to)=>String.fromCharCode(...data.subarray(from,to)),sample=ascii(0,Math.min(data.length,64)).trimStart();
  if(/^(?:<|\{|\[|error\b|access denied\b|unauthorized\b|not found\b|bad gateway\b|service unavailable\b)/i.test(sample)||/^(?:text\/|application\/(?:json|problem\+json|xml))/i.test(content))return false;
  const signature=data[0]===0x47&&(data[1]&0x80)===0&&(data[3]&0x30)!==0&&(data.length<189||data[188]===0x47)||['ftyp','styp','moov','moof','mdat','sidx'].includes(ascii(4,8))||data[0]===0x1a&&data[1]===0x45&&data[2]===0xdf&&data[3]===0xa3||data[0]===0xff&&(data[1]&0xe0)===0xe0||ascii(0,3)==='ID3'||ascii(0,4)==='OggS'||data[0]===0&&data[1]===0&&data[2]===1&&[0xba,0xb3].includes(data[3]);
  const clearlyTyped=/^(?:video\/|audio\/)/i.test(content),plain=[...data.subarray(0,Math.min(64,data.length))].every(n=>n===9||n===10||n===13||n>=32&&n<=126);
  return !plain&&(signature||clearlyTyped);
 };
 const read=async(response,text=false)=>{
  const reader=response.body?.getReader();if(!reader)throw Error('media_not_arriving');let size=0,chunks=[];
  try{for(;;){const next=await within(reader.read());if(next.done){if(!size)throw Error('media_not_arriving');break}if(!next.value?.byteLength)continue;
    if(text&&size+next.value.byteLength>MAX_BYTES)throw Error('invalid_playlist');
    const chunk=text?next.value:next.value.subarray(0,MAX_BYTES-size);size+=chunk.byteLength;chunks.push(chunk);
    if(!text&&size>=16)break;
  }}finally{void reader.cancel().catch(()=>{});bodies.delete(response.body)}
  const combined=new Uint8Array(size);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.byteLength}
  if(!text){if(size<4||!isMedia(combined,response.headers.get('content-type')||''))throw Error('invalid_media');bytes=size;return}
  return new TextDecoder().decode(combined);
 };
 try{
  session=await stage('authenticationMs',async()=>{const value=await adapter.authenticate(config,{signal,clientId:config.clientId});if(signal.aborted)lateRelease(value);return value});
  phase='catalog_prepare';target=await stage('catalogPrepareMs',async()=>{const value=await adapter.select(session,config,{signal});if(signal.aborted)lateRelease(session,value);return value});
  if(!target){const error=Error('sample_not_configured');throw error}
  phase='media_headers';let response=check(await stage('mediaHeadersMs',()=>opened(adapter.open(session,target,{signal}))));
  phase='first_media_byte';const at=now();
  for(let hop=0;;hop++){
   const content=response.headers.get('content-type')||'';
   if(!/mpegurl/i.test(content)){await read(response);break}
   if(hop>=MAX_HOPS||typeof adapter.openResource!=='function')throw Error('invalid_playlist');
   const text=await read(response,true);if(!text.trimStart().startsWith('#EXTM3U'))throw Error('invalid_playlist');
   const resource=text.split(/\r?\n/).map(x=>x.trim()).find(x=>x&&!x.startsWith('#'));
   if(!resource)throw Error('invalid_playlist');
   // The adapter resolves relative links and restricts them to signed same-site
   // media paths. A provider URL may never be fetched by this generic driver.
   response=check(await within(opened(adapter.openResource(session,resource,{signal,target,response}))));
  }
  stages.firstMediaByteMs=Math.max(0,now()-at);firstMediaByteMs=Math.max(0,now()-start);
  return cleanCanaryResult({ok:true,status:'healthy',reason:'ok',totalMs:now()-start,firstMediaByteMs,bytes,stages},config.type,now());
 }catch(error){
  const reason=signal.aborted||error?.message==='canary_timeout'?'timeout':['invalid_playlist','invalid_media','media_not_arriving','sample_not_configured'].includes(error?.message)?error.message:safeReason(error?.status,phase);
  const failureCode=signal.aborted?'timeout':error?.failureCode||(Number.isInteger(error?.status)?'http_error':comparisonError(error));
  return cleanCanaryResult({ok:false,status:reason==='capacity_busy'?'busy':reason==='sample_not_configured'?'skipped':'failed',reason,totalMs:now()-start,firstMediaByteMs,bytes,stages,failure:{phase,httpStatus:error?.status,code:failureCode,...playbackRequestDiagnostic(error)}},config.type,now());
 }finally{
  clearTimeout(timer);controller.abort();for(const body of bodies)void body.cancel().catch(()=>{});
  // Releasing the unique test session is independent of an uncooperative
  // upstream stream cancellation and cannot hold the scheduler indefinitely.
  if(session&&adapter.release){let cleanupTimer;await Promise.race([Promise.resolve().then(()=>adapter.release(session,target)).catch(()=>{}),new Promise(resolve=>{cleanupTimer=setTimeout(resolve,1000)})]);clearTimeout(cleanupTimer)}
 }
}
