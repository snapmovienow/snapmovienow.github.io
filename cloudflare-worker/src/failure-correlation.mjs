import {initialRangeEvidence,cleanInitialRangeEvidence} from './initial-range-evidence.mjs';
// Request-local only. Call after registry resolution AND content permissions.
// Public catalog IDs are NOT provider IDs; never derive them from raw URLs here.
const contexts=new WeakMap();
const validTrace=trace=>trace!==null&&(typeof trace==='object'||typeof trace==='function');
export function setResolvedMedia(trace,type,id){
 try{if(!validTrace(trace))return;contexts.delete(trace);
  if(!['live','movie','series'].includes(type)||typeof id!=='string'||!/^\d{1,16}$/.test(id)||!Number.isSafeInteger(Number(id)))return;
  contexts.set(trace,{type,content_public_id:id,phase:'unknown'});
 }catch{} // Optional diagnostics must not affect playback.
}
export function resetMediaPhase(trace){
 const value=validTrace(trace)?contexts.get(trace):null;if(value){value.phase='unknown';delete value.rangeEvidence;}
}
export function recordInitialMediaResponse(trace,request,response){
 try{const value=validTrace(trace)?contexts.get(trace):null;if(!value)return;
  value.phase='initial';delete value.rangeEvidence;
  if(response.status===416){const range=initialRangeEvidence(request,response);if(range)value.rangeEvidence=range;}
 }catch{}
}
export function takeFailureCorrelation(trace,status){
 try{const value=validTrace(trace)?contexts.get(trace):null;contexts.delete(trace);
  if(!value||![416,502].includes(status))return null;
  const range=status===416&&value.phase==='initial'?cleanInitialRangeEvidence(value.rangeEvidence):null;
  const result={type:value.type,content_public_id:value.content_public_id,phase:value.phase,...(range?{rangeEvidence:range}:{})};
  // Hard maximum in UTF-8 bytes: all permitted output is ASCII.
  return JSON.stringify(result).length<=1024?result:null;
 }catch{return null;}
}
