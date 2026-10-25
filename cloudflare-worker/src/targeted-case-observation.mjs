import {sanitizeObservation,MAX_BYTES,classifyObservation} from './range-observation.mjs';
import {fingerprint} from './provider-catalog.mjs';
import {comparisonError} from './playback-comparison.mjs';
export const CASE_OBSERVATION_HEADER='X-SMN-Case-Observation';
const SOURCE_HEADER='X-SMN-Case-Source',VALIDATOR_HEADER='X-SMN-Case-Validator';
const integer=value=>Number.isSafeInteger(value)&&value>=0&&value<=MAX_BYTES;
const hash=value=>/^[a-f0-9]{64}$/.test(value||'')?value:null;
function rangeText(value){
 if(value?.kind==='absent')return undefined;
 if(value?.kind==='bytes'&&integer(value.start)&&(value.end===null||integer(value.end)))return `bytes=${value.start}-${value.end===null?'':value.end}`;
 if(value?.kind==='suffix'&&integer(value.length))return `bytes=-${value.length}`;
 if(value?.kind==='multiple'&&Array.isArray(value.ranges)&&value.ranges.length>=2&&value.ranges.length<=4){const parts=value.ranges.map(rangeText);if(parts.every(x=>typeof x==='string'&&x.startsWith('bytes=')))return 'bytes='+parts.map(x=>x.slice(6)).join(',');}
 return 'invalid';
}
function contentRangeText(value){
 if(value?.kind==='absent')return undefined;
 if(value?.kind==='unsatisfied'&&integer(value.total))return `bytes */${value.total}`;
 if(value?.kind==='satisfied'&&integer(value.start)&&integer(value.end)&&(value.total===null||integer(value.total)))return `bytes ${value.start}-${value.end}/${value.total===null?'*':value.total}`;
 return 'invalid';
}
export function observationInput(value={}){
 return {caseKey:value?.caseKey,method:value?.method,outgoingMethod:value?.outgoingMethod,phase:value?.phase,transport:value?.transport,
 incomingRange:rangeText(value?.incomingRange),outgoingRange:rangeText(value?.outgoingRange),status:value?.status,contentRange:contentRangeText(value?.contentRange),
 contentLength:value?.contentLength?.kind==='absent'?undefined:value?.contentLength?.kind==='bytes'?value.contentLength.bytes:'invalid',acceptRanges:value?.acceptRanges==='absent'?undefined:value?.acceptRanges,
 ifRangePresent:value?.ifRangePresent,validatedBody:value?.validatedBody,resumeStart:value?.resumeStart,resumeLength:value?.resumeLength,resumeReceived:value?.resumeReceived,originalTotal:value?.originalTotal};
}
export const cleanObservation=value=>sanitizeObservation(observationInput(value));
export async function attachCaseObservation(response,{caseKey,method='GET',incomingRange,outgoingRange,ifRangePresent=false,transport,sourceURL,secret}){
 const observation=sanitizeObservation({caseKey,method,outgoingMethod:'GET',phase:'initial',transport,incomingRange,outgoingRange,ifRangePresent,status:response.status,
 contentRange:response.headers.get('content-range'),contentLength:response.headers.get('content-length'),acceptRanges:response.headers.get('accept-ranges')});
 const headers=new Headers(response.headers);headers.set(CASE_OBSERVATION_HEADER,JSON.stringify(observation));
 // Opaque equality witnesses exist only inside this one comparison. Never
 // persist them, show them in the UI, or return them in diagnostic JSON.
 headers.set(SOURCE_HEADER,await fingerprint(secret,caseKey+'|source|'+sourceURL));
 headers.delete(VALIDATOR_HEADER);const etag=response.headers.get('etag');
 if(etag&&etag.length<=256&&/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag))headers.set(VALIDATOR_HEADER,await fingerprint(secret,caseKey+'|etag|'+etag));
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
export function caseEvidence(response,caseKey){
 let observation=sanitizeObservation({caseKey,status:response?.status});
 const raw=response?.headers.get(CASE_OBSERVATION_HEADER);
 if(raw&&raw.length<=3000)try{const decoded=JSON.parse(raw);if(decoded.caseKey===caseKey)observation=cleanObservation(decoded)}catch{}
 return {observation,source:hash(response?.headers.get(SOURCE_HEADER)),validator:hash(response?.headers.get(VALIDATOR_HEADER))};
}
const reasons=new Set(['ok','timeout','http_error','invalid_media','empty_media','preempted','origin_policy','http_parser','socket_error','invocation_context','internal_error','prepare_failed']);
const validMedia=sample=>sample.length>=4&&(sample[0]===0x47&&(sample[3]&0x30)!==0||['ftyp','styp','moov','moof','mdat','sidx'].includes(String.fromCharCode(...sample.subarray(4,8)))||sample[0]===0x1a&&sample[1]===0x45&&sample[2]===0xdf&&sample[3]===0xa3);
async function measure(open,caseKey,parentSignal,deadline){
 const at=Date.now(),controller=new AbortController(),signal=AbortSignal.any([parentSignal,controller.signal]);let timer,response,reader,bytes=0;
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('comparison_timeout'))},Math.max(1,Math.min(8000,deadline-Date.now())))});
 const within=operation=>Promise.race([operation,timeout,new Promise((_,reject)=>{if(signal.aborted)reject(Error('comparison_timeout'));else signal.addEventListener('abort',()=>reject(Error('comparison_timeout')),{once:true})})]);
 const outcome=(ok,reason)=>({ok,reason:reasons.has(reason)?reason:'internal_error',httpStatus:response?.status||null,ms:Math.min(30000,Math.max(0,Date.now()-at)),bytes,...caseEvidence(response,caseKey)});
 try{
  if(signal.aborted||Date.now()>=deadline)throw Error('comparison_timeout');
  const opening=Promise.resolve().then(()=>open({signal,deadline:Math.min(deadline,at+8000)}));opening.then(r=>{if(signal.aborted)void r.body?.cancel().catch(()=>{})},()=>{});
  response=await within(opening);if(!response.ok)return outcome(false,[409,410,429].includes(response.status)?'preempted':'http_error');
  reader=response.body?.getReader();if(!reader)return outcome(false,'empty_media');const chunks=[];
  while(bytes<16){const next=await within(reader.read());if(next.done)break;if(next.value?.byteLength){const part=next.value.subarray(0,65536-bytes);chunks.push(part);bytes+=part.length}}
  const sample=new Uint8Array(bytes);let offset=0;for(const part of chunks){sample.set(part,offset);offset+=part.length}
  const result=outcome(validMedia(sample),validMedia(sample)?'ok':bytes?'invalid_media':'empty_media');result.observation.validatedBody=result.ok;return result;
 }catch(error){return outcome(false,signal.aborted?'timeout':comparisonError(error))}
 finally{clearTimeout(timer);controller.abort();void (reader?reader.cancel():response?.body?.cancel())?.catch(()=>{})}
}
const total=o=>['satisfied','unsatisfied'].includes(o?.contentRange?.kind)?o.contentRange.total:o?.status===200&&o?.contentLength?.kind==='bytes'?o.contentLength.bytes:null;
export async function compareTargetedCase(adapter,control,item,{signal,deadline}){
 let session,target;
 try{
  const check=()=>{if(signal.aborted||Date.now()>=deadline)throw Error('comparison_timeout')};check();
  session=await adapter.authenticate({username:'dieguito2026',type:item.type,diagnostic:true,targetedCase:item.key,targetedDeadline:deadline},{signal});check();
  target=await adapter.select(session,{username:'dieguito2026',type:item.type,targetedCase:item.key},{signal});check();
  const origin=await measure(options=>control(session,target,options),item.key,signal,deadline);check();
  const relay=await measure(options=>adapter.open(session,target,options),item.key,signal,deadline);
  const sameSource=!!origin.source&&origin.source===relay.source;
  const sameRepresentation=sameSource&&!!origin.validator&&origin.validator===relay.validator&&total(origin.observation)!==null&&total(origin.observation)===total(relay.observation);
  const comparison={sameResource:sameSource,sameRepresentation,independentControl:true};
  let classification='insufficient_evidence',reason='representation_unconfirmed';
  if(relay.observation.status===416){const analysis=classifyObservation(observationInput(relay.observation),observationInput(origin.observation),comparison);classification=analysis.classification;reason=analysis.reason}
  else if(origin.ok&&relay.ok){classification='hypothesis';reason='sample_did_not_reproduce'}
  else if(sameRepresentation&&origin.observation.status===relay.observation.status){classification='hypothesis';reason='same_failure_on_both_paths'}
  else if(sameRepresentation&&origin.ok&&!relay.ok){classification='hypothesis';reason='control_passed_relay_failed'}
  return cleanCaseResult({classification,reason,definitiveCause:false,type:item.type,ext:target.ext,origin,relay,comparison});
 }catch(error){return cleanCaseResult({classification:'insufficient_evidence',reason:signal.aborted?'timeout':'preparation_unconfirmed',phase:'preparation',type:item.type})}
 finally{if(session)await adapter.release(session).catch(()=>{})}
}
const resultReasons=new Set(['representation_unconfirmed','sample_did_not_reproduce','same_failure_on_both_paths','control_passed_relay_failed','preparation_unconfirmed','timeout','cancelled','unexpected_method','invalid_resume_context','unexpected_resume_range','unexpected_head_probe','unexpected_get_range','forwarding_evidence_incomplete','no_initial_416_observed','representation_size_changed','rejection_reproduced_in_independent_control','relay_path_disagrees_with_control','missing_valid_416_representation_size','missing_usable_requested_range','rejection_despite_satisfiable_reported_bounds','request_unsatisfiable_for_reported_size']);
export function cleanCaseResult(value){
 const leg=value=>({ok:value?.ok===true,reason:reasons.has(value?.reason)?value.reason:'internal_error',httpStatus:Number.isInteger(value?.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599?value.httpStatus:null,ms:integer(value?.ms)?Math.min(value.ms,30000):0,bytes:integer(value?.bytes)?Math.min(value.bytes,65536):0,observation:cleanObservation(value?.observation)});
 return {classification:['hypothesis','internal_inconsistency','insufficient_evidence'].includes(value?.classification)?value.classification:'insufficient_evidence',reason:resultReasons.has(value?.reason)?value.reason:'preparation_unconfirmed',definitiveCause:false,
 type:['movie','live'].includes(value?.type)?value.type:null,ext:['mp4','mkv','webm','avi','mov','m4v','ts'].includes(value?.ext)?value.ext:null,
 phase:value?.origin&&value?.relay?'comparison':'preparation',...(value?.origin&&value?.relay?{origin:leg(value.origin),relay:leg(value.relay),comparison:{sameResource:value.comparison?.sameResource===true,sameRepresentation:value.comparison?.sameRepresentation===true,independentControl:value.comparison?.independentControl===true}}:{})};
}
