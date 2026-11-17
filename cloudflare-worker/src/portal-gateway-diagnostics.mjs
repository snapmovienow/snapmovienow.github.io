// Failure-only, allowlisted metadata. Never log requests, URLs, query values,
// mutation IDs, accounts, cookies, credentials, arbitrary messages or bodies.
const phases=new Set(['configuration','input','fetch','body','scope','response','support']);
const actions=new Set(['read','write','login','logout','enter','enter-security','client-support-read','client-support-check','client-support-incident-save']);
const codes=new Set(['support_initializing','support_invalid_response','support_unavailable','support_scope','support_conflict','support_not_found','invalid_support_note','invalid_support_input','owner_entry_required']);
const labels={abort:'transporte interrumpido; causa sin determinar',timeout:'límite de espera entre servidores',network:'transporte entre servidores',invalid_response:'formato de respuesta',scope:'comprobación de ámbito',configuration:'obtención o comprobación de configuración',input:'lectura de solicitud',upstream_http:'respuesta HTTP del servicio',unknown:'resultado sin determinar'};
const references=new WeakMap(),failures=new WeakMap();
export function setGatewayReference(req,id){references.set(req,id)}
export function takeGatewayFailure(req){const value=failures.get(req);failures.delete(req);references.delete(req);return value}
export function gatewayDiagnostic(route,req,{now=Date.now}={}){
 route=route==='owner'?'owner':'reseller';const reference=references.get(req)||crypto.randomUUID(),started=now();let phase='configuration',action='unknown',operation='unknown',upstreamStatus,reported;
 const ray=req.headers.get('CF-Ray'),platformRay=/^[a-f0-9]{16}-[A-Z]{3}$/.test(ray||'')?ray.split('-')[0]:undefined;
 function report(error,status=503,kind,code){
  if(reported)return reported;
  if(!Object.hasOwn(labels,kind))kind=phase==='configuration'?'configuration':phase==='input'?'input':phase==='scope'?'scope':error?.name==='TimeoutError'?'timeout':error?.name==='AbortError'?'abort':['fetch','body'].includes(phase)&&error instanceof TypeError?'network':phase==='body'?'invalid_response':'unknown';
  reported={event:'portal_gateway_failure',reference,route,action,operation,phase,kind,status,elapsedMs:Math.max(0,now()-started),clientDisconnected:req.signal.aborted,...(upstreamStatus?{upstreamStatus}:{}),...(platformRay?{platformRay}:{}),...(codes.has(code)?{errorCode:code}:{})};
  failures.set(req,reported);return reported;
 }
 return {
  phase(value){if(phases.has(value))phase=value;},
  action(body){action=actions.has(body?.action)?body.action:'unknown';const q=body?.query||{};operation=action==='read'?(q.requestId?'pending_status':q.lineId?'detail':q.choices?'choices':q.source?'source':q.connectionLine?'connections':'list_or_overview'):action;},
  status(value){if(value===null)upstreamStatus=undefined;else if(Number.isInteger(value)&&value>=100&&value<=599)upstreamStatus=value;},
  failure(value,status=503,error,kind,code){const record=report(error,status,kind,code);return {...value,message:(typeof value?.message==='string'?value.message:'No se pudo comprobar el resultado.')+' Detalle técnico: '+labels[record.kind]+'. Referencia: '+reference+'.',diagnostic:record};}
 };
}
