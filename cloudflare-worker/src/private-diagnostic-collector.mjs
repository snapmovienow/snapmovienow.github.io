import {buildPrivateDiagnosticReport} from './private-diagnostic-report.mjs';
import {runDiagnosticSelfCheck} from './diagnostic-self-check.mjs';

export const PRIVATE_DIAGNOSTIC_EVENT='private_diagnostic_report_v1';
export const PRIVATE_DIAGNOSTIC_INTERVAL_MS=300000;
export const PRIVATE_DIAGNOSTIC_OBJECT='__smn_private_diagnostic_v1';
export const privateDiagnosticEnabled=env=>env.ENVIRONMENT==='production'&&env.PRIVATE_DIAGNOSTIC_REPORTS_ENABLED==='true';
const controlKey='private-diagnostic-control-v1',reportKey='private-diagnostic-report-v1';
const MAX_READ_BYTES=131072;

// All reads target existing internal projections, not media/provider endpoints.
// Cancel slow/late bodies and never retain a failed response or exception text.
export async function boundedDiagnosticRead(read,{timeoutMs=2000,deadline=Date.now()+5000,clock=Date.now}={}){
 const controller=new AbortController();let timer,reader;
 const work=Promise.resolve().then(async()=>{
  const response=await read(controller.signal);
  if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw Error('timeout');}
  if(!response.ok){void response.body?.cancel().catch(()=>{});throw Error('read_failed');}
  reader=response.body?.getReader();if(!reader)throw Error('invalid_response');
  let text='',bytes=0;const decoder=new TextDecoder();
  for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.byteLength;if(bytes>MAX_READ_BYTES)throw Error('invalid_response');text+=decoder.decode(next.value,{stream:true});}
  text+=decoder.decode();let value;try{value=JSON.parse(text);}catch{throw Error('invalid_response');}
  if(!value||typeof value!=='object'||Array.isArray(value)||value.error)throw Error('invalid_response');
  return value;
 });
 try{
  const value=await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('timeout'));},Math.max(1,Math.min(timeoutMs,deadline-clock())));})]);
  return {status:'observed',value};
 }catch(error){return {status:'unknown',reason:['timeout','invalid_response'].includes(error?.message)?error.message:'read_failed',value:null};}
 finally{clearTimeout(timer);controller.abort();if(reader){void reader.cancel().catch(()=>{});}}
}

function mappingQueries(snapshot){
 const queries=[],seen=new Set();
 for(const row of snapshot?.health?.recentMediaFailures||[]){
  const kind={live:'live',movie:'movie',series:'episode'}[row?.type];
  if(!kind||!/^\d{1,16}$/.test(String(row.id||''))||!/^[a-zA-Z0-9_-]{1,100}$/.test(row.server||''))continue;
  const key=kind+'|'+row.server+'|'+row.id;if(seen.has(key))continue;seen.add(key);
  queries.push({kind,server:row.server,upstreamId:String(row.id)});if(queries.length===10)break;
 }
 return queries;
}

export async function privateDiagnosticReportRoute(storage,env,path,{
 readSnapshot,readTimings,readCanary,selfCheck=runDiagnosticSelfCheck,
 now=Date.now,clock=Date.now,componentMs=2000,totalMs=5000,version='43',logger=console.log
}={}){
 if(path!=='/private-diagnostic/run'&&path!=='/private-diagnostic/status')return Response.json({error:'not_found'},{status:404});
 if(!privateDiagnosticEnabled(env))return Response.json({enabled:false,readStatus:'disabled'});
 const at=now();
 if(path==='/private-diagnostic/status'){
  const report=await storage.get(reportKey),control=await storage.get(controlKey);
  return Response.json({enabled:true,intervalMinutes:5,readStatus:report?'observed':'not_observed',lastAttemptAt:control?.attemptedAt||null,stale:!report||at-report.generatedAt>3*PRIVATE_DIAGNOSTIC_INTERVAL_MS,report:report||null});
 }
 const claim=await storage.transaction(async tx=>{
  const old=await tx.get(controlKey);
  if(old?.nextAt>at)return null;
  const id=crypto.randomUUID();await tx.put(controlKey,{id,attemptedAt:at,nextAt:at+PRIVATE_DIAGNOSTIC_INTERVAL_MS,state:'running'});return id;
 });
 if(!claim)return Response.json({ok:true,skipped:true});
 try{
  const deadline=clock()+Math.max(50,Math.min(totalMs,10000));
  const options={timeoutMs:Math.max(1,Math.min(componentMs,3000)),deadline,clock};
  const [snapshot,timings,canary,controlled]=await Promise.all([
   boundedDiagnosticRead(signal=>readSnapshot([],signal),options),
   boundedDiagnosticRead(signal=>readTimings(signal),options),
   boundedDiagnosticRead(signal=>readCanary(signal),options),
   Promise.resolve().then(()=>selfCheck({now:at,budgetMs:100})).catch(()=>({version:1,scope:'controlled_bytes_only',checkedAt:at,status:'failed',checks:{initialPayload:'not_run',rangeRecovery:'not_run',streamGuard:'not_run'},failureCode:'self_check_unavailable'}))
  ]);
  const queries=mappingQueries(snapshot.value);
  // Only exact references from already observed failures are inspected.
  const mapped=snapshot.status==='observed'&&queries.length&&clock()<deadline
   ?await boundedDiagnosticRead(signal=>readSnapshot(queries,signal),options):null;
  const input={generatedAt:at,version,readStatuses:{snapshot:snapshot.status,timings:timings.status,canary:canary.status,mapping:mapped?.status||(snapshot.status==='observed'&&!queries.length?'not_observed':'unknown')},snapshot:{...snapshot.value,...(mapped?.status==='observed'?{mapping:mapped.value.mapping}:{})},timings:timings.value,canary:canary.value?.canary||canary.value,selfCheck:controlled,mapping:mapped?.value?.mapping};
  const report=buildPrivateDiagnosticReport(input,{now:at,maxBytes:12000});
  const saved=await storage.transaction(async tx=>{
   const control=await tx.get(controlKey);if(control?.id!==claim)return false;
   // Persist only the final allowlisted report in this dedicated object.
   await tx.put(reportKey,report);await tx.put(controlKey,{...control,state:'completed',completedAt:now()});return true;
  });
  if(saved)try{logger({event:PRIVATE_DIAGNOSTIC_EVENT,report});}catch{} // Logging cannot affect playback.
  return Response.json({ok:true,generatedAt:report.generatedAt,complete:report.complete});
 }catch{
  await storage.transaction(async tx=>{const control=await tx.get(controlKey);if(control?.id===claim)await tx.put(controlKey,{...control,state:'failed'});});
  try{logger({event:'private_diagnostic_report_failed',at,reason:'collection_failed'});}catch{}
  return Response.json({error:'diagnostic_unavailable'},{status:503});
 }
}

export function schedulePrivateDiagnosticReport(env,ctx){
 if(!privateDiagnosticEnabled(env)||!env.PLAYBACK_SESSIONS||!ctx?.waitUntil)return false;
 ctx.waitUntil(env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName(PRIVATE_DIAGNOSTIC_OBJECT)).fetch('https://private/private-diagnostic/run',{method:'POST',body:'{}'}).then(r=>r.body?.cancel()).catch(()=>{}));
 return true;
}
