import {PROVIDER_VALIDATION_MS,VALIDATION_TOTAL_MS} from './provider-validation.mjs';
// One budget is shared by account validation and signal retries for one channel.
export const LIVE_STARTUP_MS=8000;
export const VOD_STARTUP_MS=12000;
export class LiveStartup {
 constructor(signal,now=Date.now,budget=LIVE_STARTUP_MS){this.signal=signal;this.now=now;this.deadline=now()+budget;this.attempts=0;this.validationMs=0;}
 remaining(){if(this.signal?.aborted)throw Error('playback_superseded');return Math.max(0,this.deadline-this.now());}
 timeout(cap){const left=this.remaining();if(!left)throw Error('live_startup_timeout');return Math.min(cap,left);}
 claim(){if(this.attempts>=3||!this.remaining())return false;this.attempts++;return true;}
 get available(){return this.attempts<3&&this.remaining()>0;}
 validationRemaining(){return Math.max(0,Math.min(VALIDATION_TOTAL_MS-this.validationMs,this.remaining()));}
 validationTimeout(){const left=this.validationRemaining();if(!left)throw Error('provider_validation_timeout');return Math.min(PROVIDER_VALIDATION_MS,left);}
 recordValidation(ms){this.validationMs+=Math.max(0,ms);}
 prepare(request){const headers=new Headers(request.headers);headers.set('X-SMN-Prepare','1');headers.set('X-SMN-Startup-Deadline',String(this.deadline));return new Request(request,{headers});}
}
export function startupDeadline(request,now=Date.now(),maximum=LIVE_STARTUP_MS){
 if(request.headers.get('X-SMN-Prepare')!=='1')return null;
 const value=Number(request.headers.get('X-SMN-Startup-Deadline'));
 return Number.isFinite(value)&&value>0?Math.min(value,now+maximum):now+maximum;
}
export const playbackStartup=(type,signal)=>new LiveStartup(signal,Date.now,type==='live'?LIVE_STARTUP_MS:VOD_STARTUP_MS);
// A 200 header with a silent body is not a working source. Keep the same
// startup deadline until its first payload, then relay without that deadline.
export async function readInitialMedia(response,deadline){
 const reader=response.body?.getReader();if(!reader)throw Error('media_empty');let timer,first;
 try{const timeout=startupTimeout(deadline,VOD_STARTUP_MS);first=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('live_startup_timeout')),timeout)})]);if(first.done||!first.value?.byteLength)throw Error('media_empty')}
 catch(error){void reader.cancel(error).catch(()=>{});throw error}
 finally{clearTimeout(timer)}
 let prefix=first.value;
 const body=new ReadableStream({async pull(controller){try{if(prefix){controller.enqueue(prefix);prefix=null;return}const next=await reader.read();if(next.done)controller.close();else controller.enqueue(next.value)}catch(error){controller.error(error)}},cancel:reason=>reader.cancel(reason)});
 return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}
export function startupTimeout(deadline,cap,now=Date.now()){
 if(deadline===null||deadline===undefined)return cap;
 const left=deadline-now;if(left<=0)throw Error('live_startup_timeout');return Math.min(cap,left);
}
export async function readLivePlaylist(response,deadline){
 const reader=response.body?.getReader();if(!reader)throw Error('invalid_playlist');let text='',size=0;const decoder=new TextDecoder();
 try{for(;;){let timer;const next=await Promise.race([reader.read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('live_startup_timeout')),startupTimeout(deadline,12000));})]).finally(()=>clearTimeout(timer));
  if(next.done)return text+decoder.decode();size+=next.value.length;if(size>262144)throw Error('invalid_playlist');text+=decoder.decode(next.value,{stream:true});
 }}finally{void reader.cancel().catch(()=>{});}
}
export async function reportLiveResult(directory,env,session,allocation,ok,elapsedMs,stage='signal',detail={}){
 if(!allocation.provider_id)return;
 try{const r=await directory(env,'/provider-result',{sid:session.sid,lease_id:allocation.lease_id,request_id:session.request_id,provider_id:allocation.provider_id,ok,elapsedMs,stage,...(stage==='signal'&&!ok&&Number.isInteger(detail.httpStatus)&&detail.httpStatus>=400&&detail.httpStatus<=599?{httpStatus:detail.httpStatus}:{}),...(stage==='validation'&&detail.confirmedInactive?{confirmedInactive:true}:{}),...(stage==='validation'&&detail.capacityBusy?{capacityBusy:true}:{})});await r.body?.cancel();}catch{} // Health is advisory, never a grant of access.
}
export function deferPlaybackReport(ctx,report){
 const work=Promise.resolve().then(report).catch(()=>{});ctx?.waitUntil?.(work);return work;
}
