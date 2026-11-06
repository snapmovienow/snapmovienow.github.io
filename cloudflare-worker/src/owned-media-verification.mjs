import {OWNED_MEDIA_FILES,isOwnedMediaSeries,OWNED_MEDIA_SERIES} from './owned-media-source.mjs';
export const OWNED_VERIFICATION_KEY='owned-media-verification:20261106-v3';
export const OWNED_VERIFICATION_OBJECT='__smn_owned_media_verification_20261106';
const UNTIL=Date.parse('2026-11-08T00:00:00Z');
const code=error=>error?.status===409?'test_account_busy':error?.name==='TimeoutError'||error?.name==='AbortError'?'verification_timeout':['catalog_not_ready','range_mismatch','checksum_mismatch','media_type','body_size','route_scope'].includes(error?.message)?error.message:'verification_failed';
const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
async function sampleBytes(response,limit){
 const reader=response.body?.getReader();if(!reader)throw Error('body_size');const chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('body_size')}chunks.push(value);}}finally{reader.releaseLock();}
 if(size!==limit)throw Error('body_size');const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
export const ownedVerificationEnabled=(env,now=Date.now())=>env.ENVIRONMENT==='production'&&Boolean(env.SNAP_OWNED_MEDIA_SITE_TOKEN)&&Boolean(env.PLAYBACK_CANARY_USERNAME)&&now<UNTIL;
export async function runOwnedMediaVerification(storage,env,deps,{now=Date.now,onResult=value=>console.log(value),files=OWNED_MEDIA_FILES}={}){
 if(!ownedVerificationEnabled(env,now()))return;
 const row=(await deps.read()).items.find(row=>row.id===OWNED_MEDIA_SERIES);if(!isOwnedMediaSeries(row))return;
 const claim=await storage.transaction(async tx=>{const old=await tx.get(OWNED_VERIFICATION_KEY);if(['completed','failed'].includes(old?.state)||old?.claimUntil>now())return null;const value={state:'running',claim:crypto.randomUUID(),claimUntil:now()+150000,startedAt:now()};await tx.put(OWNED_VERIFICATION_KEY,value);return value;});
 if(!claim)return;
 const queue=[...files],results=[];
 async function verify(file){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);let session;
  try{
   session=await deps.authenticate(controller.signal);
   const prepared=await deps.prepare(session,file.exclusiveId,controller.signal),url=new URL(prepared.url);
   if(url.origin!=='https://api.snaptvnow.com'||url.pathname!=='/exclusive-media'||!url.searchParams.get('t'))throw Error('route_scope');
   for(const sample of file.rangeSamples){
    if(controller.signal.aborted)throw new DOMException('Timeout','AbortError');
    const end=sample.start+sample.length-1,response=await deps.request(new Request(url,{headers:{Range:'bytes='+sample.start+'-'+end,'User-Agent':'SNAPTVNOW-Owned-Media-Verification/1'},signal:controller.signal}));
    if(response.status!==206||response.headers.get('content-range')!=='bytes '+sample.start+'-'+end+'/'+file.size){await response.body?.cancel();throw Object.assign(Error('range_mismatch'),{status:response.status});}
    if(!/^video\/mp4(?:;|$)/i.test(response.headers.get('content-type')||'')){await response.body?.cancel();throw Error('media_type');}
    if(await sha(await sampleBytes(response,sample.length))!==sample.sha256)throw Error('checksum_mismatch');
   }
   results.push({id:file.id,episode:file.episode,option:file.option,status:'passed',rangeChecks:file.rangeSamples.length});
  }catch(error){results.push({id:file.id,episode:file.episode,option:file.option,status:'failed',reason:code(error),httpStatus:Number.isInteger(error?.status)?error.status:null});}
  finally{clearTimeout(timer);controller.abort();if(session)await deps.release(session).catch(()=>{});}
 }
 async function task(){while(queue.length)await verify(queue.shift());}
 await Promise.all([task(),task()]);
 const passed=results.filter(item=>item.status==='passed').length,result={state:passed===8?'completed':'failed',startedAt:claim.startedAt,finishedAt:now(),count:results.length,passed,rangeChecks:results.reduce((sum,item)=>sum+(item.rangeChecks||0),0),results};
 await storage.transaction(async tx=>{if((await tx.get(OWNED_VERIFICATION_KEY))?.claim===claim.claim)await tx.put(OWNED_VERIFICATION_KEY,result);});
 onResult({event:'owned_media_verification',...result});return result;
}
