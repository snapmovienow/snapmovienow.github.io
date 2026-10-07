function playbackRequestId(){if(typeof crypto.randomUUID==='function')return crypto.randomUUID();return Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('')}
async function sendPlaybackCancellation(url,attempt,lease,fetcher=fetch){
 if(!attempt.session?.access_token)return;
 // Retry only the idempotent cancellation, never create another playback.
 for(let retry=0;retry<2;retry++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);
  try{
   const response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},keepalive:true,signal:controller.signal,body:JSON.stringify({op:'playback_cancel',access_token:attempt.session.access_token,request_id:attempt.id,revision:attempt.revision,lease_id:lease})});
   if(response.status===401||response.status===410)return;
   if(response.ok&&(await response.json()).ok===true)return;
  }catch{}finally{clearTimeout(timer)}
 }
 throw Error('playback_cancel_unavailable');
}
// Each preparation owns its cancellation and reservation, including late replies.
function createPlaybackLifecycle(options){
 let current=null,revision=0;
 const notify=(attempt,lease)=>{try{return Promise.resolve(options.cancel(attempt,lease)).catch(()=>{})}catch{return Promise.resolve()}};
 function cancel(){
  const attempt=current;current=null;
  if(!attempt)return Promise.resolve();
  attempt.controller.abort();return notify(attempt,attempt.lease);
 }
 return {
  begin(identity){cancel();revision=Math.max(revision+1,(options.now||Date.now)()*1000);const attempt={...identity,id:(options.uuid||playbackRequestId)(),revision,lease:null,controller:new AbortController()};current=attempt;return attempt},
  valid:attempt=>current===attempt&&!attempt.controller.signal.aborted,
  adopt(attempt,lease){if(current!==attempt||attempt.controller.signal.aborted){notify(attempt,lease);return false}attempt.lease=lease||null;return true},
  cancel,
  get current(){return current}
 };
}
