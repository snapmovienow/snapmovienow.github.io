import {ALL_TV_CHANNELS} from './official-live.mjs';

export const LOCAL_AUDIT_KEY='local-tv-audit:20261104-v1';
const REQUEST='local-tv-owner-20261104-v1',UNTIL=Date.parse('2026-11-06T00:00:00Z');
const FOLDERS=[{key:'kansas',name:'LOCAL KANSAS'},{key:'new-york',name:'LOCAL NEW YORK'},{key:'new-jersey',name:'LOCAL NEW JERSEY'},{key:'california',name:'LOCAL CALIFORNIA'}];
const folderKeys=new Set(FOLDERS.map(folder=>folder.key));
const definitions=ALL_TV_CHANNELS.filter(channel=>channel.id.startsWith('local-')&&(channel.categories||['kansas']).some(key=>folderKeys.has(key)));
const definitionFor=id=>definitions.find(channel=>channel.id===id);
const terminal=new Set(['online','offline','needs_review']);
const checks=new Set(['playlist_and_segment','media_bytes','signed_playlist_and_segment','signed_media_bytes','video_and_audio','app_and_dns','playback_bytes']);
const reasons=new Set(['test_account_busy','transient','verification_timeout','media_unavailable','invalid_playlist','media_not_video','media_empty','source_unavailable','permission_denied','catalog_changed','source_requires_review','unknown_local_channel','verification_failed','route_scope','upstream_http','media_type','body_size']);
const retryable=new Set(['test_account_busy','transient','verification_timeout']);
export const localAuditEnabled=(env,now=Date.now())=>env.ENVIRONMENT==='production'&&Boolean(env.PLAYBACK_CANARY_USERNAME)&&now<UNTIL;
const expected=row=>({id:row.id,page:row.page,type:row.type,mode:row.mode,visible:row.visible,revision:row.revision,playbackRevision:row.playbackRevision});
const same=(row,snapshot)=>Boolean(row&&JSON.stringify(expected(row))===JSON.stringify(snapshot));
const permitted=(row,channel)=>row&&channel&&row.id===channel.id&&row.page===channel.page&&row.type==='movie'&&row.mode===(channel.adapter==='public-hls'?'direct':'gnula');
const safeReason=value=>reasons.has(value)?value:'verification_failed';
function publicStatus(job){
 const channels=(job?.channels||[]).map(channel=>({id:channel.id,name:channel.name,categories:channel.categories,status:channel.status,attempts:channel.attempts,...(channel.checkedAt?{checkedAt:channel.checkedAt}:{}),...(channel.check?{check:channel.check}:{}),...(channel.reason?{reason:channel.reason}:{}),...(channel.httpStatus?{httpStatus:channel.httpStatus}:{})}));
 const count=status=>channels.filter(channel=>channel.status===status).length;
 const categories=FOLDERS.filter(folder=>channels.some(channel=>channel.categories.includes(folder.key))).map(folder=>{
  const items=channels.filter(channel=>channel.categories.includes(folder.key));
  return {...folder,total:items.length,online:items.filter(channel=>channel.status==='online').length,offline:items.filter(channel=>channel.status==='offline').length,needsReview:items.filter(channel=>channel.status==='needs_review').length,channels:items.map(channel=>channel.id)};
 });
 return {requestId:REQUEST,state:job?.state||'pending',total:channels.length,checked:channels.filter(channel=>terminal.has(channel.status)).length,online:count('online'),offline:count('offline'),needsReview:count('needs_review'),pending:channels.filter(channel=>!terminal.has(channel.status)).length,...(job?.startedAt?{startedAt:job.startedAt}:{}),...(job?.finishedAt?{finishedAt:job.finishedAt}:{}),categories,channels};
}

// One owner-authorized finite snapshot. Alarms process one channel per request;
// no customer session, editable URL or public write input enters this module.
export function createLocalTvAudit(storage,env,deps,{now=Date.now,onResult=value=>console.log(value),probeTimeoutMs=20000}={}){
 const deadlineMs=Math.min(20000,Math.max(1,probeTimeoutMs));
 const status=async()=>publicStatus(await storage.get(LOCAL_AUDIT_KEY));
 async function schedule(job){
  if(job?.state!=='running'||!localAuditEnabled(env,now()))return;
  const at=Math.max(now()+1000,job.claimUntil||0),old=await storage.getAlarm?.();
  if(Number.isFinite(old)&&old<=at)return;
  await storage.setAlarm(at);
 }
 async function start(){
  if(!localAuditEnabled(env,now()))return status();
  const old=await storage.get(LOCAL_AUDIT_KEY);if(old){await schedule(old);return publicStatus(old);}
  const inventory=await deps.inventory(),rows=Array.isArray(inventory?.items)?inventory.items:[];
  const channels=rows.filter(row=>typeof row?.id==='string'&&/^local-[a-z0-9_-]{1,144}$/.test(row.id)).map(row=>{
   const channel=definitionFor(row.id),allowed=permitted(row,channel);
   return {id:row.id,name:channel?.name||'Canal local sin definición',categories:(channel?.categories|| (channel?['kansas']:[])).filter(key=>folderKeys.has(key)),expected:allowed?expected(row):null,status:allowed?'pending':'needs_review',attempts:0,...(!allowed?{reason:channel?'source_requires_review':'unknown_local_channel',checkedAt:now()}: {})};
  });
  const saved=await storage.transaction(async tx=>{
   const old=await tx.get(LOCAL_AUDIT_KEY);if(old)return old;
   const job={requestId:REQUEST,state:channels.some(channel=>channel.status==='pending')?'running':'completed',startedAt:now(),channels,claimUntil:0,...(!channels.some(channel=>channel.status==='pending')?{finishedAt:now()}: {})};
   await tx.put(LOCAL_AUDIT_KEY,job);return job;
  });
  await schedule(saved);return publicStatus(saved);
 }
 async function step(){
  if(!localAuditEnabled(env,now())){
   await storage.transaction(async tx=>{const job=await tx.get(LOCAL_AUDIT_KEY);if(job?.state==='running')await tx.put(LOCAL_AUDIT_KEY,{...job,state:'expired',claimUntil:0,finishedAt:now()});});return status();
  }
  if(!await storage.get(LOCAL_AUDIT_KEY))await start();
  const claim=await storage.transaction(async tx=>{
   const job=await tx.get(LOCAL_AUDIT_KEY);if(job?.state!=='running'||job.claimUntil>now())return null;
   // A terminated invocation consumes its attempt. It can retry once, but can
   // never make alarms run indefinitely after an interrupted provider request.
   for(const channel of job.channels)if(channel.status==='checking'){channel.status=channel.attempts<2?'retry':'offline';channel.reason='verification_timeout';channel.checkedAt=now();}
   const channel=job.channels.find(channel=>['pending','retry'].includes(channel.status));
   if(!channel){job.state='completed';job.finishedAt=now();job.claimUntil=0;await tx.put(LOCAL_AUDIT_KEY,job);return null;}
   channel.status='checking';channel.attempts++;job.claim=crypto.randomUUID();job.claimUntil=now()+30000;await tx.put(LOCAL_AUDIT_KEY,job);return {token:job.claim,channel:structuredClone(channel)};
  });
  if(!claim){await schedule(await storage.get(LOCAL_AUDIT_KEY));return status();}
  await storage.setAlarm(now()+30000);
  const controller=new AbortController();let timeout;
  const expired=new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new DOMException('Timeout','TimeoutError'));},deadlineMs);});
  const bounded=promise=>Promise.race([promise,expired]);
  let result;
  try{
   const before=await bounded(deps.inventory({signal:controller.signal})),row=before?.items?.find(row=>row.id===claim.channel.id);
   if(!same(row,claim.channel.expected))result={status:'needs_review',reason:'catalog_changed'};
   else{
    const probe=await bounded(deps.probe(row,{signal:controller.signal}));
    const after=await bounded(deps.inventory({signal:controller.signal})),current=after?.items?.find(row=>row.id===claim.channel.id);
    if(!same(current,claim.channel.expected))result={status:'needs_review',reason:'catalog_changed'};
    else result=probe?.ok===true?{status:'online',check:checks.has(probe.check)?probe.check:'playback_bytes'}:{status:'offline',reason:safeReason(probe?.reason),...(Number.isInteger(probe?.httpStatus)&&probe.httpStatus>=100&&probe.httpStatus<=599?{httpStatus:probe.httpStatus}:{})};
   }
  }catch(error){result={status:'offline',reason:error?.status===409?'test_account_busy':['TimeoutError','AbortError'].includes(error?.name)?'verification_timeout':safeReason(error?.message)};}
  finally{clearTimeout(timeout);controller.abort();}
  const job=await storage.transaction(async tx=>{
   const current=await tx.get(LOCAL_AUDIT_KEY);if(current?.claim!==claim.token)return current;
   const channel=current.channels.find(channel=>channel.id===claim.channel.id);
   Object.assign(channel,result,{checkedAt:now()});
   if(result.status==='offline'&&retryable.has(result.reason)&&channel.attempts<2)channel.status='retry';
   current.claimUntil=0;delete current.claim;
   if(current.channels.every(channel=>terminal.has(channel.status))){current.state='completed';current.finishedAt=now();}
   await tx.put(LOCAL_AUDIT_KEY,current);return current;
  });
  await schedule(job);const report=publicStatus(job);if(job?.state==='completed')onResult({event:'local_tv_audit',...report});return report;
 }
 return {start,step,status};
}
