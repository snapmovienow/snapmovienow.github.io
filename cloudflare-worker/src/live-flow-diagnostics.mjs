// Temporary, exact-target relay observations. No identity, URL, credential,
// network address or player data is ever copied into a diagnostic record.
const DAY=86400000,PROGRESS_INTERVAL=60000,MAX_PROGRESS=60,MAX_BYTES=2**40,MAX_CHUNKS=10000000,MAX_TIMESTAMP=8640000000000000;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const USERNAME=/^[a-z0-9_.@!-]{3,80}$/;
const ORIGIN_REASONS=new Set(['origin_eof','origin_complete','origin_silence','origin_error','origin_truncated']);
const TERMINAL_REASONS=new Set([...ORIGIN_REASONS,'relay_complete','playlist_response','client_abort','client_cancel','stream_idle','access_expired','session_expired','playback_expired','session_denied','lease_denied','access_unavailable','playback_superseded','startup_failed','relay_error','observation_window_ended']);
const META_KEYS=new Set(['case_id','flow_id','from','until','public_id','attempt']);
const NOOP=Object.freeze({start:()=>false,checkpoint:()=>false,finish:()=>false,originBytes(){},originReadWait(){},originWriteWait(){},originEnd(){},relayChunk(){},relayReadWait(){},consumerPause(){},setStatus(){}});
const uuid=value=>typeof value==='string'&&UUID.test(value)?value.toLowerCase():null;
const timestamp=value=>Number.isSafeInteger(value)&&value>=0&&value<=MAX_TIMESTAMP;
const epoch=value=>typeof value==='string'&&/^(?:0|[1-9]\d{0,15})$/.test(value)?Number(value):typeof value==='number'?value:NaN;
const publicId=value=>typeof value==='string'&&/^\d{1,16}$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):null;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function config(env){
 try{
  const username=env?.LIVE_FLOW_DIAGNOSTIC_USERNAME,case_id=uuid(env?.LIVE_FLOW_DIAGNOSTIC_CASE),from=epoch(env?.LIVE_FLOW_DIAGNOSTIC_FROM),until=epoch(env?.LIVE_FLOW_DIAGNOSTIC_UNTIL);
  return typeof username==='string'&&USERNAME.test(username)&&case_id&&timestamp(from)&&timestamp(until)&&until>from&&until-from<=DAY?{username,case_id,from,until}:null;
 }catch{return null}
}
function metadata(value){
 try{
  if(!plain(value)||Object.keys(value).some(key=>!META_KEYS.has(key))||!['case_id','flow_id','from','until'].every(key=>Object.hasOwn(value,key)))return null;
  const case_id=uuid(value.case_id),flow_id=uuid(value.flow_id),from=value.from,until=value.until,attempt=value.attempt===undefined?1:value.attempt;
  if(!case_id||!flow_id||!timestamp(from)||!timestamp(until)||until<=from||until-from>DAY||!Number.isInteger(attempt)||attempt<1||attempt>3)return null;
  const out={case_id,flow_id,from,until,attempt};
  if(Object.hasOwn(value,'public_id')){const id=publicId(value.public_id);if(id===null)return null;out.public_id=id;}
  return out;
 }catch{return null}
}
export function selectLiveFlowDiagnostic(env,input,now=Date.now()){
 try{
  const active=config(env);if(!active||!timestamp(now)||now<active.from||now>=active.until||!plain(input)||input.username!==active.username||input.type!=='live'||input.ext!=='ts'||input.method!=='GET')return null;
  const out={case_id:active.case_id,flow_id:input.requestId,from:active.from,until:active.until,attempt:input.attempt===undefined?1:input.attempt};
  if(input.publicId!==undefined)out.public_id=input.publicId;
  return metadata(out);
 }catch{return null}
}
export function validateLiveFlowDiagnostic(env,value,now=Date.now()){
 try{
  const active=config(env),clean=metadata(value);
  return active&&clean&&timestamp(now)&&now>=active.from&&now<active.until&&clean.case_id===active.case_id&&clean.from===active.from&&clean.until===active.until?clean:null;
 }catch{return null}
}
const STARTUP_PHASES=new Set(['allocation','preparation','relay','confirmation']);
const RECOVERY_TYPES=new Set(['original','same_channel_retry','alternate_variant','next_channel']);
const MAX_STARTUP_ATTEMPTS=16;

// This reports selection and startup at the Worker. A relay response does not
// establish that a player rendered the selected signal.
export function createLiveStartupObserver(env,input,{now=Date.now,logger=console.log}={}){
 if(env?.LIVE_FLOW_DIAGNOSTIC_USERNAME!==input?.username)return null;
 const scope=selectLiveFlowDiagnostic(env,input,now());
 const requestedId=publicId(input?.upstreamId);
 if(!scope?.public_id||requestedId===null)return null;

 let sequence=0;
 return (selectedId,recovery)=>{
  const start=now(),selected=publicId(selectedId);
  if(sequence>=MAX_STARTUP_ATTEMPTS||!timestamp(start)||start<scope.from||start>=scope.until||selected===null||!RECOVERY_TYPES.has(recovery))return null;
  const attempt=++sequence;
  let finished=false;
  return (phase,status)=>{
   if(finished)return;
   finished=true;
   const end=now();
   if(!timestamp(end)||end<start||end>=scope.until||!STARTUP_PHASES.has(phase)||!Number.isInteger(status)||status<200||status>599)return;
   try{
    logger({event:'live_flow_attempt',scope:'server_startup',case_id:scope.case_id,request_id:scope.flow_id,public_id:scope.public_id,
     attempt,requested_origin_id:requestedId,selected_origin_id:selected,recovery,phase,status,elapsed_ms:Math.min(end-start,300000)});
   }catch{} // Observation cannot change the media response.
  };
 };
}

export function createLiveFlowMonitor(value,options={}){
 try{
  const clean=metadata(value);if(!clean||!plain(options))return NOOP;
  const now=options.now===undefined?Date.now:options.now,logger=options.logger===undefined?console.log:options.logger;
  if(typeof now!=='function'||typeof logger!=='function')return NOOP;
  let startedAt;try{startedAt=now()}catch{return NOOP}
  if(!timestamp(startedAt)||startedAt<clean.from||startedAt>=clean.until)return NOOP;
  let closed=false,started=false,lastProgress=startedAt,lastTime=startedAt,progress=0,status;
  const counts={origin_observed:false,origin_bytes:0,origin_last_byte_ms:null,origin_read_wait_ms:0,origin_read_wait_max_ms:0,origin_write_wait_ms:0,origin_write_wait_max_ms:0,origin_reason:null,relay_bytes:0,relay_last_byte_ms:null,relay_chunks:0,relay_read_wait_ms:0,relay_read_wait_max_ms:0,consumer_pause_ms:0,consumer_pause_max_ms:0};
  const clock=()=>{try{const time=now();if(!timestamp(time)){closed=true;return null}lastTime=Math.max(lastTime,time);return lastTime}catch{closed=true;return null}};
  const emit=(event,time,reason)=>{
   const record={event,time,case_id:clean.case_id,flow_id:clean.flow_id,attempt:clean.attempt,...(clean.public_id===undefined?{}:{public_id:clean.public_id}),scope:'server_relay_not_client',elapsed_ms:Math.min(DAY,Math.max(0,time-startedAt)),...(status===undefined?{}:{status}),...counts,progress_count:progress,...(reason===undefined?{}:{reason})};
   try{const pending=logger(record);if(pending&&typeof pending.then==='function')void Promise.resolve(pending).catch(()=>{})}catch{} // Observability must never affect playback.
  };
  const end=(reason,time)=>{if(closed)return false;closed=true;emit('live_flow_end',time,reason);return true};
  const activeTime=()=>{if(closed)return null;const time=clock();if(time===null)return null;if(time>=clean.until){end('observation_window_ended',time);return null}return time};
  const bytes=n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0?Math.min(MAX_BYTES,n):null;
  const milliseconds=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=Number.MAX_SAFE_INTEGER?Math.min(DAY,Math.round(n)):null;
  const add=(key,amount,limit)=>{counts[key]=Math.min(limit,counts[key]+amount)};
  const wait=(total,max,value,origin=false)=>{if(closed)return;const ms=milliseconds(value);if(ms===null)return;if(origin)counts.origin_observed=true;add(total,ms,DAY);counts[max]=Math.max(counts[max],ms)};
  const monitor={
   start(){if(started||closed)return false;const time=activeTime();if(time===null)return false;started=true;emit('live_flow_start',time);return true},
   checkpoint(){const time=activeTime();if(time===null||progress>=MAX_PROGRESS||time-lastProgress<PROGRESS_INTERVAL)return false;lastProgress=time;progress++;emit('live_flow_progress',time);return true},
   finish(reason,detail={}){if(closed)return false;const time=activeTime();if(time===null)return false;if(typeof reason!=='string'||!TERMINAL_REASONS.has(reason))return false;try{if(plain(detail))monitor.setStatus(detail.status)}catch{}return end(reason,time)},
   originBytes(n){if(closed)return;const count=bytes(n);if(count===null)return;const time=count>0?clock():null;if(count>0&&time===null)return;counts.origin_observed=true;add('origin_bytes',count,MAX_BYTES);if(count>0)counts.origin_last_byte_ms=Math.min(DAY,Math.max(0,time-startedAt))},
   originReadWait(ms){wait('origin_read_wait_ms','origin_read_wait_max_ms',ms,true)},
   originWriteWait(ms){wait('origin_write_wait_ms','origin_write_wait_max_ms',ms,true)},
   originEnd(reason){if(!closed&&typeof reason==='string'&&ORIGIN_REASONS.has(reason)){counts.origin_observed=true;if(counts.origin_reason===null)counts.origin_reason=reason}},
   relayChunk(n){if(closed)return;const count=bytes(n);if(count===null||count===0)return;const time=clock();if(time===null)return;add('relay_bytes',count,MAX_BYTES);counts.relay_last_byte_ms=Math.min(DAY,Math.max(0,time-startedAt));add('relay_chunks',1,MAX_CHUNKS)},
   relayReadWait(ms){wait('relay_read_wait_ms','relay_read_wait_max_ms',ms)},
   consumerPause(ms){wait('consumer_pause_ms','consumer_pause_max_ms',ms)},
   setStatus(value){if(!closed&&Number.isInteger(value)&&value>=100&&value<=599)status=value}
  };
  monitor.start();return Object.freeze(monitor);
 }catch{return NOOP}
}
