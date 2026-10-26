import {parseRange,parseContentRange} from './range-observation.mjs';
const own=(value,key)=>{const d=value&&typeof value==='object'&&!Array.isArray(value)?Object.getOwnPropertyDescriptor(value,key):null;return d&&'value'in d?d.value:undefined};
const integer=value=>Number.isSafeInteger(value)&&value>=0;
function cleanRange(value,multiple=true){
 const kind=own(value,'kind');
 if(['absent','invalid'].includes(kind))return {kind};
 if(kind==='bytes'){const start=own(value,'start'),end=own(value,'end');if(integer(start)&&(end===null||integer(end)&&end>=start))return {kind,start,end};}
 if(kind==='suffix'){const length=own(value,'length');if(integer(length))return {kind,length};}
 if(kind==='multiple'&&multiple){const parts=own(value,'ranges');if(Array.isArray(parts)&&parts.length>=2&&parts.length<=4){const ranges=[];for(let i=0;i<parts.length;i++){const d=Object.getOwnPropertyDescriptor(parts,String(i));ranges.push(cleanRange(d&&'value'in d?d.value:null,false));}if(ranges.every(part=>['bytes','suffix'].includes(part.kind)))return {kind,ranges};}}
 return {kind:'unknown'};
}
export function cleanInitialRangeEvidence(value){
 const method=own(value,'method');if(own(value,'phase')!=='initial'||!['GET','HEAD'].includes(method))return null;
 const total=own(value,'reportedTotal'),ifRange=own(value,'ifRangePresent');
 const incomingRange=cleanRange(own(value,'incomingRange')),outgoingRange=cleanRange(own(value,'outgoingRange'));
 if(method==='GET'&&JSON.stringify(incomingRange)!==JSON.stringify(outgoingRange)||method==='HEAD'&&!(outgoingRange.kind==='bytes'&&outgoingRange.start===0&&outgoingRange.end===0))return null;
 return {phase:'initial',method,incomingRange,outgoingRange,reportedTotal:integer(total)?total:null,ifRangePresent:typeof ifRange==='boolean'?ifRange:null};
}
// Only the native initial relay response, after the upstream header whitelist.
// HEAD's fixed GET probe matches serverStreamDirect; never retain If-Range's
// value, error-body Content-Length, raw headers, URLs or identity.
export function initialRangeEvidence(request,response){
 if(response?.status!==416||!['GET','HEAD'].includes(request?.method))return null;
 const incomingRange=parseRange(request.headers.get('range')),size=parseContentRange(response.headers.get('content-range'));
 return cleanInitialRangeEvidence({phase:'initial',method:request.method,incomingRange,outgoingRange:request.method==='HEAD'?{kind:'bytes',start:0,end:0}:incomingRange,reportedTotal:size.kind==='unsatisfied'?size.total:null,ifRangePresent:request.headers.has('if-range')});
}
export function rangeFailureDetail(status,detail){
 const evidence=status===416?cleanInitialRangeEvidence(own(detail,'rangeEvidence')):null;
 return evidence?{rangeEvidence:evidence}:{};
}
