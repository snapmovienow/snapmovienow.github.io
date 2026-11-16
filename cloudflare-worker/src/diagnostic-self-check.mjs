// Internal synthetic control only: no provider, network, subscriber or lease.
// This verifies code paths, not public DNS, device decoding or service uptime.
import {readInitialMedia} from './live-startup.mjs';
import {recoverMedia} from './media-fetch.mjs';
import {guardXtreamResponse} from './xtream-bridge.mjs';

const MAX_BYTES=256,VALIDATOR='"diagnostic-control-v1"';
const equal=(first,second)=>first.length===second.length&&first.every((value,index)=>value===second[index]);
const elapsed=start=>Math.max(0,Math.round((performance.now()-start)*1000)/1000);
const ensure=condition=>{if(!condition)throw Error('controlled_check_failed');};

function bounded(work,signal){
 const pending=Promise.resolve(work);
 if(signal.aborted){void pending.catch(()=>{});return Promise.reject(Error('self_check_timeout'));}
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(Error('self_check_timeout'));
  signal.addEventListener('abort',abort,{once:true});
  pending.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}

async function controlledBytes(response,signal){
 ensure(response?.body);const reader=response.body.getReader(),parts=[];let size=0;
 try{
  for(let reads=0;reads<=MAX_BYTES;reads++){
   const next=await bounded(reader.read(),signal);
   if(next.done){const result=new Uint8Array(size);let offset=0;for(const part of parts){result.set(part,offset);offset+=part.byteLength;}return result;}
   size+=next.value.byteLength;ensure(size<=MAX_BYTES);parts.push(next.value);
  }
  throw Error('controlled_read_limit');
 }finally{void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{}}
}

export async function runDiagnosticSelfCheck({now=Date.now,budgetMs=100}={}){
 const start=performance.now(),checks={initialPayload:'not_run',rangeRecovery:'not_run',streamGuard:'not_run'};
 let checkedAt=Date.now(),stage=null,timer;const controller=new AbortController(),bodies=[];
 const result=(status,failureCode=null)=>({version:1,scope:'controlled_bytes_only',checkedAt,status,elapsedMs:elapsed(start),checks:{...checks},failureCode});
 const response=(bytes,options)=>{const value=new Response(bytes,options);if(value.body)bodies.push(value.body);return value;};
 try{
  const timestamp=typeof now==='function'?now():now;
  ensure(Number.isSafeInteger(timestamp)&&timestamp>0);checkedAt=timestamp;
  const budget=typeof budgetMs==='number'&&Number.isFinite(budgetMs)?Math.min(100,Math.max(10,budgetMs)):100;
  timer=setTimeout(()=>controller.abort(Error('self_check_timeout')),budget);

  stage='initialPayload';
  const initial=Uint8Array.from({length:16},(_,index)=>(index*13+7)%251);
  const prepared=await bounded(readInitialMedia(response(initial,{headers:{'content-type':'video/mp2t','content-length':String(initial.length)}}),Date.now()+budget),controller.signal);
  ensure(equal(await controlledBytes(prepared,controller.signal),initial));checks.initialPayload='passed';

  stage='rangeRecovery';let resumes=0,authorizations=0;
  const bytes=Uint8Array.from({length:16},(_,index)=>(index*17+3)%251),headers={'content-type':'video/mp4','content-length':'16','content-range':'bytes 100-115/512',etag:VALIDATOR};
  const recovered=recoverMedia(response(bytes.slice(0,5),{status:206,headers}),async(range,validator)=>{
   resumes++;ensure(resumes===1&&range==='bytes=105-115'&&validator===VALIDATOR);
   return response(bytes.slice(5),{status:206,headers:{'content-range':'bytes 105-115/512',etag:VALIDATOR}});
  },async()=>{authorizations++;return true;},1,budget);
  ensure(recovered.status===206&&recovered.headers.get('content-range')==='bytes 100-115/512');
  ensure(equal(await controlledBytes(recovered,controller.signal),bytes)&&resumes===1&&authorizations===1);checks.rangeRecovery='passed';

  stage='streamGuard';let releases=0,remoteChecks=0;const background=[];
  const guardedBytes=Uint8Array.from({length:12},(_,index)=>(index*19+5)%251);
  const guarded=guardXtreamResponse(response(guardedBytes,{status:206,headers:{'content-length':'12','content-range':'bytes 20-31/100'}}),async()=>{remoteChecks++;return true;},async()=>{releases++;},{waitUntil:work=>background.push(work)},controller.signal);
  ensure(guarded.status===206&&guarded.headers.get('content-range')==='bytes 20-31/100');
  ensure(equal(await controlledBytes(guarded,controller.signal),guardedBytes));
  await bounded(Promise.all(background),controller.signal);ensure(releases===1&&remoteChecks===0);checks.streamGuard='passed';
  return result('passed');
 }catch{
  if(stage)checks[stage]='failed';
  const code=controller.signal.aborted?'self_check_timeout':stage==='initialPayload'?'initial_payload_failed':stage==='rangeRecovery'?'range_recovery_failed':stage==='streamGuard'?'stream_guard_failed':'self_check_unavailable';
  return result('failed',code);
 }finally{
  clearTimeout(timer);controller.abort(Error('controlled_check_finished'));
  for(const body of bodies)if(!body.locked)void body.cancel().catch(()=>{});
 }
}
