// Final privacy boundary for private diagnostic storage and logs. Never spread
// an input record: even already-private snapshots may contain subscriber data.
import {playbackErrorCode} from './playback-outcomes.mjs';
import {playbackRequestDiagnostic} from './playback-diagnostics.mjs';

const SCHEMA='SNAP-private-diagnostic-v1',WINDOW_MS=15*60000;
const TYPES=['live','movie','series'],KINDS=['live','movie','series_list','episode'];
const STAGES=['total','auth','catalog','allocation','validation','origin','first_byte'];
const READS=['observed','partial','unknown','not_observed','disabled','not_configured','not_run'];
const SELF_CODES=['initial_payload_failed','range_recovery_failed','stream_guard_failed','self_check_timeout','self_check_unavailable'];
const SELF_CHECKS=['initialPayload','rangeRecovery','streamGuard'];
const isRecord=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
// Do not evaluate arbitrary getters, including inherited getters.
const own=(value,key)=>isRecord(value)?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
const choice=(value,values,fallback=null)=>values.includes(value)?value:fallback;
const integer=(value,max=1e9)=>Number.isSafeInteger(value)&&value>=0&&value<=max?value:null;
const number=(value,max=300000)=>typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=max?value:null;
const boolean=value=>typeof value==='boolean'?value:null;
const numericId=value=>typeof value==='string'&&/^\d{1,16}$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&String(value).length<=16?String(value):null;
const version=value=>typeof value==='string'&&/^\d{1,4}(?:[.-]\d{1,4}){0,3}$/.test(value)?value:Number.isSafeInteger(value)&&value>=0&&value<=9999?String(value):null;
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).byteLength;

export function buildPrivateDiagnosticReport(input,{now=Date.now(),maxBytes=12000}={}){
 const at=Number.isSafeInteger(now)&&now>0?now:Date.now();
 const limit=Number.isSafeInteger(maxBytes)?Math.min(12000,Math.max(512,maxBytes)):12000;
 const timestamp=value=>Number.isSafeInteger(value)&&value>0&&value<=at?value:null;
 const fresh=value=>timestamp(value)!==null&&value>=at-WINDOW_MS;
 let invalidFields=0;
 const omitted={timingGroups:0,canaryResults:0,mediaFailures:0,mappingReferences:0,circuits:0,findings:0,details:0};
 const bounded=(value,max,section)=>{
  if(!Array.isArray(value)){if(value!==undefined&&value!==null)invalidFields++;return [];}
  omitted[section]+=Math.max(0,value.length-max);
  const result=[];for(let index=0;index<Math.min(value.length,max);index++){const descriptor=Object.getOwnPropertyDescriptor(value,String(index));if(descriptor&&Object.hasOwn(descriptor,'value'))result.push(descriptor.value);else invalidFields++;}return result;
 };
 const counts=(value,keys)=>Object.fromEntries(keys.map(key=>[key,integer(own(value,key))]));
 const readValue=value=>choice(value,READS,['available','ok'].includes(value)?'observed':['unavailable','failed','timeout','error'].includes(value)?'unknown':'unknown');
 const rawReads=own(input,'readStatuses');
 const readStatuses=Object.fromEntries(['snapshot','timings','canary','mapping'].map(key=>[key,readValue(own(rawReads,key))]));
 const sourceNames=new Map();
 const source=value=>{
  if(typeof value!=='string'||!value||value.length>200)return null;
  if(!sourceNames.has(value))sourceNames.set(value,'source-'+(sourceNames.size+1));
  return sourceNames.get(value);
 };
 const snapshot=own(input,'snapshot'),inventory=own(snapshot,'inventory'),leases=own(snapshot,'leases'),rotation=own(snapshot,'rotation'),health=own(snapshot,'health');
 const policy=own(rotation,'policy');
 const inventoryReport={state:choice(own(inventory,'state'),['available','partial','unavailable'],'unavailable'),...counts(inventory,['configuredSources','observedSources','freshSources','missingSources','staleSources','retainedAfterFailedRefresh','physicalAccounts','eligibleAccounts','totalCapacity','reported','reserved','available','unknownMembership','unmatchedProviderReservations']),syncedAt:timestamp(own(inventory,'syncedAt')),attemptedAt:timestamp(own(inventory,'attemptedAt')),freshnessVerified:boolean(own(inventory,'freshnessVerified')),accounting:'conservative'};
 const leaseReport={status:choice(own(leases,'status'),['available','unknown'],'unknown'),...counts(leases,['reserved','orphanedReservations','unmatchedProviderReservations'])};
 const rotationReport={statsStatus:choice(own(rotation,'statsStatus'),['available','not_recorded','unavailable'],'unavailable'),completed:integer(own(rotation,'completed')),lastCompletedAt:timestamp(own(rotation,'lastCompletedAt')),policy:{enabled:boolean(own(policy,'enabled')),...counts(policy,['minHours','targetHours','overdueHours','minimumMonths','preferredMonths','scheduledOffersPerRequest']),midnightPreference:boolean(own(policy,'midnightPreference')),healthBeforeBalance:boolean(own(policy,'healthBeforeBalance')),activePlayback:choice(own(policy,'activePlayback'),['preserve']),confirmation:choice(own(policy,'confirmation'),['account-and-media'])}};
 const mapInput=own(input,'mapping')||own(snapshot,'mapping');
 const mappingReport={status:choice(own(mapInput,'status'),['available','not_requested','invalid_queries','unavailable'],readStatuses.mapping==='not_observed'?'not_requested':'unavailable'),...counts(mapInput,['checked','registered','inconsistent','notRegistered']),catalogCurrentVerified:false,mediaHealthVerified:false};
 if(readStatuses.mapping==='not_observed'&&mappingReport.status==='not_requested')for(const key of ['checked','registered','inconsistent','notRegistered'])if(mappingReport[key]===null)mappingReport[key]=0;
 const mappingReferences=[];
 const rawSamples=own(mapInput,'samples')??own(mapInput,'references');
 for(const row of bounded(rawSamples,10,'mappingReferences')){
  const query=own(row,'query'),reference=own(row,'reference');
  const state=choice(own(row,'state'),['registered','not_registered','registry_inconsistent']);
  const kind=choice(own(row,'kind')??own(reference,'kind')??own(query,'kind'),KINDS);
  const publicId=numericId(own(row,'publicId')??own(reference,'publicId')??own(query,'publicId'));
  const upstreamId=numericId(own(row,'upstreamId')??own(reference,'upstreamId')??own(query,'upstreamId'));
  if(!state||(!publicId&&(!kind||!upstreamId))){invalidFields++;continue;}
  const sample={queryIndex:integer(own(row,'queryIndex'),9)??mappingReferences.length,state,...(kind?{kind}:{}),...(publicId?{publicId,publicIdScope:'public_catalog'}:{}),...(upstreamId&&kind?{upstreamId,upstreamIdScope:'upstream_content'}:{})};
  const pseudonym=source(own(reference,'server')??own(query,'server'));if(pseudonym)sample.source=pseudonym;
  mappingReferences.push(sample);
 }
 const timingsInput=own(input,'timings'),groups=[];
 for(const row of bounded(own(timingsInput,'groups'),12,'timingGroups')){
  const type=choice(own(row,'type'),TYPES),platform=choice(own(row,'platform'),['android','web','other','canary']);
  if(!type||!platform){invalidFields++;continue;}
  const stages={},rawStages=own(row,'stages');
  for(const name of STAGES){const span=own(rawStages,name);if(isRecord(span))stages[name]={samples:integer(own(span,'samples')),avgMs:number(own(span,'avgMs')),p95UpperMs:number(own(span,'p95UpperMs'))};}
  const statusCounts={},rawStatus=own(row,'statusCounts'),errorCounts={},rawErrors=own(row,'errorCounts');
  // Fixed status domain and allowlisted codes prevent arbitrary object keys.
  for(let code=100;code<=599;code++){const count=integer(own(rawStatus,String(code)));if(count!==null)statusCounts[code]=count;}
  if(isRecord(rawErrors))for(const key of Object.keys(rawErrors).slice(0,100)){const count=integer(own(rawErrors,key));if(playbackErrorCode(key)&&count!==null)errorCounts[key]=count;}
  groups.push({type,platform,...counts(row,['requests','measuredRequests','failures','rawErrors','legacyFailures','accessRejected','cancelled','clientCapacity']),stages,statusCounts,errorCounts});
 }
 const canaryInput=own(input,'canary'),canaryResults=[];
 for(const row of bounded(own(canaryInput,'results'),3,'canaryResults')){
  const type=choice(own(row,'type'),TYPES);if(!type){invalidFields++;continue;}
  const stages={},raw=own(row,'stages');for(const key of ['authenticationMs','catalogPrepareMs','mediaHeadersMs','firstMediaByteMs']){const ms=number(own(raw,key));if(ms!==null)stages[key]=ms;}
  const failure=own(row,'failure'),phase=choice(own(failure,'phase'),['authentication','catalog_prepare','media_headers','first_media_byte']);
  canaryResults.push({type,status:choice(own(row,'status'),['healthy','failed','busy','skipped'],'unknown'),reason:choice(own(row,'reason'),['ok','timeout','account_unavailable','capacity_busy','sample_unavailable','media_not_arriving','playback_unavailable','invalid_playlist','invalid_media','sample_not_configured'],'unknown'),at:timestamp(own(row,'at')),fresh:fresh(own(row,'at')),totalMs:number(own(row,'totalMs')),firstMediaByteMs:number(own(row,'firstMediaByteMs')),bytes:integer(own(row,'bytes'),65536),stages,...(phase?{failure:{phase,code:choice(own(failure,'code'),['timeout','http_error','invalid_reply','origin_policy','http_parser','socket_error','invocation_context','internal_error','preempted'],'unknown'),httpStatus:integer(own(failure,'httpStatus'),599)>=100?own(failure,'httpStatus'):null,...playbackRequestDiagnostic({operation:own(failure,'operation'),serviceError:own(failure,'serviceError')})}}:{})});
 }
 const selfInput=own(input,'selfCheck'),checksInput=own(selfInput,'checks');
 const validSelf=own(selfInput,'version')===1&&own(selfInput,'scope')==='controlled_bytes_only';
 const selfCheck={version:validSelf?1:null,scope:'controlled_bytes_only',checkedAt:timestamp(own(selfInput,'checkedAt')),status:validSelf?choice(own(selfInput,'status'),['passed','failed','not_run'],'unknown'):'unknown',checks:Object.fromEntries(SELF_CHECKS.map(key=>[key,validSelf?choice(own(checksInput,key),['passed','failed','not_run'],'not_run'):'not_run'])),failureCode:validSelf?choice(own(selfInput,'failureCode'),SELF_CODES):null,elapsedMs:number(own(selfInput,'elapsedMs')),publicDnsVerified:false,devicePlaybackVerified:false};
 const mediaFailures=[];
 for(const row of bounded(own(health,'recentMediaFailures'),10,'mediaFailures')){
  const type=choice(own(row,'type'),TYPES),id=numericId(own(row,'id'));
  if(!type||!id){invalidFields++;continue;}
  const allStatuses=[...new Set(bounded(own(row,'httpStatuses'),16,'details').filter(value=>Number.isInteger(value)&&value>=400&&value<=599))];
  const httpStatuses=allStatuses.slice(0,6);omitted.details+=Math.max(0,allStatuses.length-6);
  const failureCauses=[];
  for(const cause of bounded(own(row,'failureCauses'),3,'details')){
   if(own(cause,'httpStatus')!==504)continue;
   const origin=own(cause,'errorOrigin'),code=own(cause,'serviceError');
   failureCauses.push({httpStatus:504,errorOrigin:origin==='upstream_response'&&code==='upstream_unavailable'?'upstream_response':origin==='local_deadline'&&code==='live_startup_timeout'?'local_deadline':'unknown',serviceError:origin==='upstream_response'&&code==='upstream_unavailable'?'upstream_unavailable':origin==='local_deadline'&&code==='live_startup_timeout'?'live_startup_timeout':null});
  }
  const pseudonym=source(own(row,'server'));
  mediaFailures.push({type,id,idScope:'upstream_content',source:pseudonym,format:choice(own(row,'ext'),['ts','m3u8','mp4','mkv','avi','m4v','webm'],'other'),lastObservedAt:timestamp(own(row,'lastObservedAt')),fresh:fresh(own(row,'lastObservedAt')),sourcesObserved:integer(own(row,'sourcesObserved')),httpStatuses,failureCauses});
 }
 const circuits=[];
 for(const row of bounded(own(health,'circuits'),12,'circuits')){
  const scope=choice(own(row,'scope'),['account','media']),type=choice(own(row,'type'),[...TYPES,'all','other']),state=choice(own(row,'state'),['open','probing','ready_to_probe']);
  if(!scope||!type||!state){invalidFields++;continue;}
  circuits.push({scope,type,state,count:integer(own(row,'count')),retryAfterMs:number(own(row,'retryAfterMs'))});
 }
 const findings=[],find=(component,classification,evidence,count)=>findings.push({component,classification,evidence,count});
 const failureCheck={initial_payload_failed:'initialPayload',range_recovery_failed:'rangeRecovery',stream_guard_failed:'streamGuard'}[selfCheck.failureCode];
 const selfFailed=validSelf&&selfCheck.status==='failed'&&fresh(selfCheck.checkedAt)&&failureCheck&&selfCheck.checks[failureCheck]==='failed';
 if(selfFailed)find('self_check','local_fault','controlled_check_failed',SELF_CHECKS.filter(key=>selfCheck.checks[key]==='failed').length);
 const mappingCountsValid=['checked','registered','inconsistent','notRegistered'].every(key=>mappingReport[key]!==null)&&mappingReport.checked===mappingReport.registered+mappingReport.inconsistent+mappingReport.notRegistered;
 if(readStatuses.mapping==='observed'&&mappingReport.status==='available'&&mappingCountsValid&&mappingReport.inconsistent>0&&mappingReferences.some(row=>row.state==='registry_inconsistent'))find('mapping','local_fault','stored_registry_inconsistent',mappingReport.inconsistent);
 let policyCount=0,failureCount=0;for(const group of groups){policyCount+=(group.accessRejected||0)+(group.cancelled||0)+(group.clientCapacity||0);failureCount+=Math.max(group.failures||0,group.legacyFailures||0);}
 if(readStatuses.timings==='observed'&&policyCount>0)find('admission','local_policy','classified_expected_outcome',policyCount);
 const upstreamCount=mediaFailures.filter(row=>row.fresh&&row.httpStatuses.includes(504)&&row.failureCauses.some(cause=>cause.errorOrigin==='upstream_response')).length;
 const unknownMedia=mediaFailures.filter(row=>row.fresh&&!(row.httpStatuses.length===1&&row.httpStatuses[0]===504&&row.failureCauses.length&&row.failureCauses.every(cause=>cause.errorOrigin==='upstream_response'))).length;
 if(readStatuses.snapshot==='observed'&&upstreamCount)find('origin','upstream_response','server_recorded_response_origin',upstreamCount);
 if(failureCount||unknownMedia||canaryResults.some(row=>row.fresh&&row.status==='failed'))find('playback','unknown','cause_unconfirmed',failureCount+unknownMedia+canaryResults.filter(row=>row.fresh&&row.status==='failed').length);
 let classification=findings.some(row=>row.classification==='local_fault')?'local_fault':findings.length&&new Set(findings.map(row=>row.classification)).size===1?findings[0].classification:'unknown';
 const timingComplete=groups.every(group=>['requests','measuredRequests','failures','rawErrors','legacyFailures','accessRejected','cancelled','clientCapacity'].every(key=>group[key]!==null)&&group.measuredRequests<=group.requests&&group.failures<=group.measuredRequests&&Object.values(group.stages).every(stage=>Object.values(stage).every(value=>value!==null)));
 const mappingComplete=readStatuses.mapping==='not_observed'?mappingReport.checked===0:mappingReport.status==='available'&&mappingCountsValid;
 const canaryComplete=['disabled','not_configured'].includes(readStatuses.canary)||boolean(own(canaryInput,'configured'))!==null&&boolean(own(canaryInput,'enabled'))!==null;
 const complete=readStatuses.snapshot==='observed'&&readStatuses.timings==='observed'&&['observed','disabled','not_configured'].includes(readStatuses.canary)&&['observed','not_observed'].includes(readStatuses.mapping)&&inventoryReport.state==='available'&&['configuredSources','observedSources','freshSources','physicalAccounts','eligibleAccounts','totalCapacity','reported','reserved','available','unknownMembership'].every(key=>inventoryReport[key]!==null)&&leaseReport.status==='available'&&leaseReport.reserved!==null&&['available','unobserved'].includes(own(health,'status'))&&['available','not_recorded'].includes(rotationReport.statsStatus)&&mappingComplete&&timingComplete&&canaryComplete&&own(timingsInput,'windowMinutes')===15&&fresh(own(input,'generatedAt'))&&version(own(input,'version'))!==null&&validSelf&&selfCheck.status==='passed'&&SELF_CHECKS.every(key=>selfCheck.checks[key]==='passed')&&fresh(selfCheck.checkedAt)&&!invalidFields;
 const report={schema:SCHEMA,generatedAt:timestamp(own(input,'generatedAt'))??at,version:version(own(input,'version')),window:{minutes:integer(own(timingsInput,'windowMinutes'),60),from:at-WINDOW_MS,to:at},readStatuses,classification,complete,snapshot:{inventory:inventoryReport,leases:leaseReport,rotation:rotationReport,mapping:mappingReport,health:{status:choice(own(health,'status'),['available','unavailable','unobserved'],'unavailable'),lastObservedAt:timestamp(own(health,'lastObservedAt')),circuits}},timings:{groups},canary:{configured:boolean(own(canaryInput,'configured')),enabled:boolean(own(canaryInput,'enabled')),status:choice(own(canaryInput,'status'),['healthy','failed','busy','skipped','not_configured','disabled','waiting'],'unknown'),running:boolean(own(canaryInput,'running')),lastCheckedAt:timestamp(own(canaryInput,'lastCheckedAt')),fresh:fresh(own(canaryInput,'lastCheckedAt')),results:canaryResults},selfCheck,mappingReferences,mediaFailures,findings,limitations:{providerRequestsPerformed:false,providerInventoryVerified:false,playbackValidated:false,telemetryExhaustive:false,sourcePseudonymsScope:'this_report',upstreamResponseDoesNotProveResponsibility:true},truncated:Object.values(omitted).some(Boolean),omitted,invalidFields};
 const sections=[[report.mediaFailures,'mediaFailures'],[report.mappingReferences,'mappingReferences'],[report.timings.groups,'timingGroups'],[report.canary.results,'canaryResults'],[report.snapshot.health.circuits,'circuits']];
 while(bytes(report)>limit){
  const available=sections.filter(([rows])=>rows.length).sort((a,b)=>bytes(b[0])-bytes(a[0]));
  if(!available.length)break;
  const [rows,key]=available[0];rows.pop();omitted[key]++;report.truncated=true;report.complete=false;report.classification='unknown';omitted.findings+=report.findings.length;report.findings=[];
 }
 if(report.truncated)report.complete=false;
 if(bytes(report)>limit)return {schema:SCHEMA,generatedAt:report.generatedAt,version:report.version,classification:'unknown',complete:false,truncated:true,byteLimit:limit,omitted:{sections:8,entries:Object.values(omitted).reduce((sum,value)=>sum+value,0)+findings.length},invalidFields};
 return report;
}
