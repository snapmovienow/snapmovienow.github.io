// Share only an in-flight status check for identical encrypted credentials.
// Results are not cached; every viewer still owns a separately checked lease.
export const PROVIDER_VALIDATION_MS=2500;
export const VALIDATION_TOTAL_MS=5000;
const scopes=new WeakMap();
export function sharedProviderValidation(scope,key,read,{timeoutMs=PROVIDER_VALIDATION_MS,signal}={}){
 if(signal?.aborted)return Promise.reject(Error('playback_superseded'));
 let pending=scopes.get(scope);if(!pending)scopes.set(scope,pending=new Map());
 let entry=pending.get(key);
 if(!entry){
  const controller=new AbortController();entry={controller,waiters:0};
  // A waiter with a nearly exhausted startup budget must not shorten a second
  // viewer's valid request. Each waiter has its own timeout below.
  entry.work=Promise.resolve().then(()=>read(controller.signal,PROVIDER_VALIDATION_MS));
  entry.work.then(()=>{if(pending.get(key)===entry)pending.delete(key)},()=>{if(pending.get(key)===entry)pending.delete(key)});
  if(pending.size<64)pending.set(key,entry);
 }
 entry.waiters++;
 return new Promise((resolve,reject)=>{
  let done=false,timer;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);entry.waiters--;if(!entry.waiters){if(pending.get(key)===entry)pending.delete(key);entry.controller.abort()}if(error)reject(error);else resolve(value)};
  const abort=()=>finish(Error('playback_superseded'));
  signal?.addEventListener('abort',abort,{once:true});
  timer=setTimeout(()=>finish(Error('provider_validation_timeout')),Math.max(1,Math.min(PROVIDER_VALIDATION_MS,timeoutMs)));
  entry.work.then(value=>finish(null,value),error=>finish(error));
 });
}
