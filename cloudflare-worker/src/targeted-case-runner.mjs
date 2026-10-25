import {TARGETED_CASES,targetedCase,targetedWindow,CASE_EXPIRES_AT,CASE_TIMEOUT_MS} from './targeted-case-policy.mjs';
import {cleanCaseResult} from './targeted-case-observation.mjs';
const PREFIX='owner-targeted-cases-20261025-v1:';
export async function targetedCasesStatus(storage,env){
 const rows=[];for(const item of TARGETED_CASES){const value=await storage.get(PREFIX+item.key);rows.push({caseKey:item.key,type:item.type,id:item.id,ext:item.ext,expected:item.expected,state:value?(value.state==='complete'?'complete':'consumed'):!targetedWindow(env)?'expired':item.ext?'ready':'blocked_extension',attempts:value?1:0,...(value?.state==='complete'?{result:cleanCaseResult(value.result)}:{})})}
 return {expiresAt:CASE_EXPIRES_AT,cases:rows};
}
export async function runTargetedCase(storage,env,caseKey,run,{signal}={}){
 const item=targetedCase(caseKey);if(!item)return {status:400,error:'invalid_diagnostic_case'};
 if(!targetedWindow(env))return {status:410,error:'diagnostic_window_closed'};
 if(!item.ext)return {status:422,error:'diagnostic_extension_unconfirmed'};
 if(signal?.aborted)return {status:409,error:'diagnostic_cancelled'};
 let claim;
 try{claim=await storage.transaction(async tx=>{
  if(!targetedWindow(env))return 'expired';if(await tx.get(PREFIX+item.key))return 'consumed';
  for(const other of TARGETED_CASES){const value=await tx.get(PREFIX+other.key);if(value?.state==='running'&&value.until>Date.now())return 'busy'}
  const until=Math.min(Date.now()+CASE_TIMEOUT_MS,CASE_EXPIRES_AT);await tx.put(PREFIX+item.key,{state:'running',at:Date.now(),until,attempts:1});return until;
 })}catch{return {status:503,error:'diagnostic_claim_unavailable'}}
 if(typeof claim!=='number')return {status:claim==='expired'?410:409,error:claim==='busy'?'diagnostic_busy':'diagnostic_consumed'};
 if(!targetedWindow(env)||Date.now()>=claim)return {status:410,error:'diagnostic_window_closed'};
 const controller=new AbortController();let timer,result,cancel;
 const cancelled=new Promise(resolve=>{cancel=()=>{controller.abort();resolve({classification:'insufficient_evidence',reason:'cancelled',type:item.type})};if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true})});
 try{result=await Promise.race([cancelled,Promise.resolve().then(()=>run(item,{signal:controller.signal,deadline:claim})),new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve({classification:'insufficient_evidence',reason:'timeout',type:item.type})},Math.max(1,claim-Date.now()))})])}
 catch{result={classification:'insufficient_evidence',reason:'preparation_unconfirmed',type:item.type}}
 finally{clearTimeout(timer);controller.abort();signal?.removeEventListener('abort',cancel)}
 try{await storage.put(PREFIX+item.key,{state:'complete',at:Date.now(),attempts:1,result:cleanCaseResult(result)})}catch{return {status:503,error:'diagnostic_result_uncertain'}}
 return {status:200,data:await targetedCasesStatus(storage,env)};
}
