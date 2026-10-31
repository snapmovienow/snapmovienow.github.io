// /health reports API reachability and retained evidence, never a new probe.
// HTTP 200/ok:true remain liveness for existing connection diagnostics.
// Completeness is explicit and independent of stored playback success/failure.
export const HEALTH_COMPONENT_MS=1000,HEALTH_TOTAL_MS=1500;
const MAX_BYTES=256*1024;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
async function boundedRead(read,project,fallback,deadline,{timeoutMs,now}){
 const started=now(),controller=new AbortController();let timer,expired=false;
 const work=Promise.resolve().then(async()=>{
  const response=await read(controller.signal);
  if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw Error('timeout')}
  if(!response.ok){void response.body?.cancel().catch(()=>{});throw Error('read_error')}
  const stream=response.body?.pipeThrough(new TransformStream(),{signal:controller.signal}),reader=stream?.getReader();
  if(!reader)throw Error('invalid_response');
  let text='',bytes=0;const decoder=new TextDecoder();
  try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES)throw Error('invalid_response');text+=decoder.decode(value,{stream:true})}text+=decoder.decode();}
  finally{void reader.cancel().catch(()=>{});reader.releaseLock()}
  let value;try{value=JSON.parse(text)}catch{throw Error('invalid_response')}
  if(!object(value)||value.error)throw Error('invalid_response');
  return project(value);
 });
 try{
  const value=await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();reject(Error('timeout'))},Math.max(1,Math.min(timeoutMs,deadline-now())));})]);
  return {value,check:{state:'observed',checkedAt:started,elapsedMs:Math.max(0,now()-started)}};
 }catch(error){return {value:{...fallback,readStatus:'unknown'},check:{state:'unknown',reason:expired?'timeout':error?.message==='invalid_response'?'invalid_response':'read_error',checkedAt:started,elapsedMs:Math.max(0,now()-started)}}}
 finally{clearTimeout(timer);controller.abort()}
}
export async function publicHealthSnapshot(env,{timeoutMs=HEALTH_COMPONENT_MS,totalMs=HEALTH_TOTAL_MS,now=Date.now}={}){
 const started=now(),deadline=started+Math.max(1,Math.min(HEALTH_TOTAL_MS,totalMs)),options={timeoutMs:Math.max(1,Math.min(HEALTH_COMPONENT_MS,timeoutMs)),now};
 const fetchState=(binding,id,path,signal,post=false)=>{if(!binding)throw Error('read_error');return binding.get(binding.idFromName(id)).fetch('https://private'+path,{...(post?{method:'POST',body:'{}'}:{}),signal})};
 const disabled=value=>Promise.resolve({value,check:{state:'not_configured'}});
 const [catalog,canary,comparison]=await Promise.all([
  env.CATALOG_MAINTENANCE_ENABLED!=='true'?disabled({enabled:false}):boundedRead(signal=>fetchState(env.PLAYBACK_SESSIONS,'__smn_accounts_v1','/accounts/catalog-maintenance-status',signal,true),v=>{if(!['beerus','movies'].every(k=>Object.hasOwn(v,k)&&(v[k]===null||object(v[k]))))throw Error('invalid_response');return {enabled:true,...v}},{enabled:true,status:'unknown'},deadline,options),
  !env.PLAYBACK_CANARY_USERNAME?disabled({configured:false}):boundedRead(signal=>fetchState(env.OPERATION_ALERTS,'system-monitor-v1','/status',signal,true),v=>{
   const c=v.canary;if(!object(c)||!Array.isArray(c.results))throw Error('invalid_response');
   return {configured:!!c.configured,enabled:!!c.enabled,lastCheckedAt:c.lastCheckedAt||null,status:c.status||'waiting',results:c.results.map(({type,status,at,totalMs,reason,stages,failure})=>({type,status,at,totalMs,reason,stages,...(failure?{failure}:{})}))};
  },{configured:true,status:'unknown',lastCheckedAt:null,results:[]},deadline,options),
  !env.PLAYBACK_CANARY_USERNAME?disabled({state:'disabled'}):boundedRead(signal=>fetchState(env.PLAYBACK_SESSIONS,'__smn_canary_v1','/canary-comparison-status',signal),v=>{if(typeof v.state!=='string')throw Error('invalid_response');return v},{state:'unknown'},deadline,options)
 ]);
 const components={catalog:catalog.check,canary:canary.check,comparison:comparison.check},diagnosticsComplete=Object.values(components).every(c=>c.state!=='unknown');
 return {apiStatus:'reachable',status:diagnosticsComplete?'diagnostics_complete':'degraded',diagnosticsComplete,playbackValidated:false,components,catalog_maintenance:catalog.value,playback_canary:canary.value,playback_comparison:comparison.value};
}
