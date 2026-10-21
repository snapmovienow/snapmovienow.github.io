// One budget is shared by account validation and signal retries for one channel.
export const LIVE_STARTUP_MS=8000;
export class LiveStartup {
 constructor(signal,now=Date.now){this.signal=signal;this.now=now;this.deadline=now()+LIVE_STARTUP_MS;this.attempts=0;}
 remaining(){if(this.signal?.aborted)throw Error('playback_superseded');return Math.max(0,this.deadline-this.now());}
 timeout(cap){const left=this.remaining();if(!left)throw Error('live_startup_timeout');return Math.min(cap,left);}
 claim(){if(this.attempts>=3||!this.remaining())return false;this.attempts++;return true;}
 get available(){return this.attempts<3&&this.remaining()>0;}
 prepare(request){const headers=new Headers(request.headers);headers.set('X-SMN-Prepare','1');headers.set('X-SMN-Startup-Deadline',String(this.deadline));return new Request(request,{headers});}
}
export function startupDeadline(request,now=Date.now()){
 if(request.headers.get('X-SMN-Prepare')!=='1')return null;
 const value=Number(request.headers.get('X-SMN-Startup-Deadline'));
 return Number.isFinite(value)&&value>0?Math.min(value,now+LIVE_STARTUP_MS):now+LIVE_STARTUP_MS;
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
export async function reportLiveResult(directory,env,session,allocation,ok,elapsedMs,stage='signal'){
 if(!allocation.provider_id)return;
 try{const r=await directory(env,'/provider-result',{sid:session.sid,lease_id:allocation.lease_id,request_id:session.request_id,provider_id:allocation.provider_id,ok,elapsedMs,stage});await r.body?.cancel();}catch{} // Health is advisory, never a grant of access.
}
