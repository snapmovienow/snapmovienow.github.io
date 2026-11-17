import {playbackErrorCode,expectedPlaybackOutcome} from './playback-outcomes.mjs';

// Metadata only, after the authenticated operation. Never inspect a stream or
// retain request URLs, credentials, cookies, headers, payloads or error text.
export function createClientSupportObservation({ctx,write,method='GET',access='api',serviceCheck=false,now=Date.now}={}){
 const startedAt=now();let selected=null,reply=null,finished=false;
 return {
  start(identity,input){
   if(serviceCheck||method==='HEAD'||!ctx?.waitUntil||typeof write!=='function'||!identity||!['catalog','playback'].includes(input?.kind)||!['live','movie','series'].includes(input?.type))return;
   const uid=identity.uid||identity.id;
   if(typeof uid!=='string'||typeof identity.username!=='string'||!Number.isSafeInteger(identity.version))return;
   selected={username:identity.username,uid,version:identity.version,kind:input.kind,type:input.type,access:access==='xtream'?'xtream':'api',selection:['all','category','source'].includes(input.selection)?input.selection:'all',...(typeof input.publicId==='string'&&/^\d{1,16}$/.test(input.publicId)?{publicId:input.publicId}:{}),...(playbackErrorCode(input.code)?{code:input.code}:{})};
  },
  reply(data,status=200){if(selected)reply={httpStatus:status,itemCount:Array.isArray(data)?data.length:null,...(playbackErrorCode(data?.error)?{code:data.error}:{})};},
  finish(response){
   if(finished||!selected||!response)return response;finished=true;
   const code=playbackErrorCode(response.headers.get('X-SMN-Error-Code'))||reply?.code||selected.code;
   if(selected.kind==='playback'&&(response.status<400||expectedPlaybackOutcome(response.status,code)))return response;
   const body={...selected,requestId:crypto.randomUUID(),at:startedAt,respondedAt:now(),httpStatus:response.status,...(reply?.itemCount!==null&&reply?.itemCount!==undefined?{itemCount:reply.itemCount}:{}),...(code?{code}:{})};
   try{ctx.waitUntil(Promise.resolve().then(()=>write(body)).catch(()=>{}));}catch{}
   return response;
  }
 };
}
