function playbackRequestId(){if(typeof crypto.randomUUID==='function')return crypto.randomUUID();return Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('')}
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
