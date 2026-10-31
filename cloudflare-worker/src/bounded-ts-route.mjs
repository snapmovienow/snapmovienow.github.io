import {runBoundedTs} from './bounded-ts-core.mjs';
import {contentPermissions,createAdultPolicy} from './content-permissions.mjs';
export const TS_CASE='movistar8461-v1';
const result=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const safeId=x=>/^\d{1,14}$/.test(String(x));
// Private account-DO storage, not an externally reachable route. The fixed key
// intentionally survives new browser sessions and reloads; no automatic reset.
export async function boundedTsQuota(store,path,b,env){
 if(env.BOUNDED_TS_CASE!==TS_CASE||b.username!=='dieguito2026'||!b.uid||!b.sid)return result({error:'diagnostic_disabled'},403);
 return store.transaction(async tx=>{
  const u=await tx.get('user:dieguito2026');
  if(u?.id!==b.uid||u.version!==b.version||u.status!=='active'||u.expiresAt&&u.expiresAt<=Date.now())return result({error:'session_required'},401);
  const key='bounded-ts:'+TS_CASE,old=await tx.get(key);
  if(path==='/bounded-ts-status')return result({state:old?.state||'ready',requestId:old?.requestId||null,result:old?.result||null});
  if(path==='/bounded-ts-claim'){
   if(old)return result({error:'diagnostic_consumed',state:old.state,requestId:old.requestId},409);
   if(!/^[a-f0-9-]{36}$/.test(b.requestId||''))return result({error:'invalid_request'},400);
   await tx.put(key,{state:'consumed',requestId:b.requestId,at:Date.now()});return result({ok:true});
  }
  if(path==='/bounded-ts-result'&&old?.requestId===b.requestId){
   // Caller is the private route, but still store only a schema-controlled report.
   const x=b.result||{},m=x.mapping;
   const report={httpStatus:Number.isInteger(x.httpStatus)?x.httpStatus:null,contentType:['video/mp2t','application/octet-stream','other'].includes(x.contentType)?x.contentType:null,bytesRead:Math.max(0,Math.min(4000000,Number(x.bytesRead)||0)),elapsedMs:Math.max(0,Number(x.elapsedMs)||0),stopReason:['deadline','cancelled','not_enabled','unauthorized','mapping_unverified','http_error','unexpected_content_type','byte_reader_required','byte_limit','eof','operation_failed','unavailable'].includes(x.stopReason)?x.stopReason:'unavailable',mapping:m&&safeId(m.channelId)&&m.publicId==='8461'&&/^[a-z0-9_-]{1,32}$/.test(m.server)?{publicId:'8461',channelId:m.channelId,server:m.server}:null,source:'requested_resource_selected_provider',originalOrAlternative:'unknown',fallbackAttempted:false,videoValidated:false,audioValidated:false,leaseReleaseRequested:x.leaseReleaseRequested===true,readerCancelRequested:x.readerCancelRequested===true,leaseReleased:x.leaseReleased===true};
   await tx.put(key,{...old,state:'complete',result:report});return result({ok:true});
  }
  return result({error:'diagnostic_request_mismatch'},409);
 });
}

// Dedicated route only. Existing browser cookie and origin checks are retained
// at dispatch; no access token export, login, or provider credentials in output.
export async function boundedTsRoute(req,env,ctx,deps){
 if(env.BOUNDED_TS_CASE!==TS_CASE)return result({error:'diagnostic_disabled'},403);
 const timing=deps.timing||{now:()=>performance.now(),setTimeout,clearTimeout};
 const started=timing.now(),abort=new AbortController(),requestId=crypto.randomUUID();
 let timer,expired=false,session,claimed=false,report,releaseConfirmed=false;const cleanups=[];
 const deadline=new Promise(resolve=>{timer=timing.setTimeout(()=>{expired=true;abort.abort('deadline');resolve(null)},15000)});
 const cancel=()=>{expired=true;abort.abort('cancelled')};
 req.signal?.addEventListener('abort',cancel,{once:true});if(req.signal?.aborted)cancel();
 const retain=p=>{ctx?.waitUntil?.(p.catch(()=>{}));return p};
 const stage=async fn=>{if(expired)throw Error('deadline');let stop;const cancelled=new Promise(resolve=>{stop=()=>resolve(null);abort.signal.addEventListener('abort',stop,{once:true})});try{const pending=Promise.resolve().then(()=>{if(expired)throw Error('deadline');return fn()});const x=await Promise.race([pending,deadline,cancelled]);if(expired)throw Error('deadline');return x}finally{abort.signal.removeEventListener('abort',stop)}};
 try{
  // Small fixed control input, never media or credentials.
  const body=await stage(async()=>{const reader=req.body?.getReader();if(!reader)throw Error('input');let total=0,parts='';const decoder=new TextDecoder();const stop=()=>void reader.cancel().catch(()=>{});abort.signal.addEventListener('abort',stop,{once:true});try{for(;;){const n=await reader.read();if(n.done)break;total+=n.value.byteLength;if(total>2048)throw Error('input');parts+=decoder.decode(n.value,{stream:true})}return JSON.parse(parts+decoder.decode())}finally{abort.signal.removeEventListener('abort',stop);void reader.cancel().catch(()=>{})}});
  if(!body||!['run','status'].includes(body.mode)||Object.keys(body).some(k=>!['mode'].includes(k)))return result({error:'invalid_diagnostic_input'},400);
  session=await stage(()=>deps.unticket(env,deps.cookieToken(req,env,'session')));
  if(session?.kind!=='session'||!session.managed||session.username!=='dieguito2026')return result({error:'session_required'},401);
  if(!(await stage(()=>deps.sessionCall(env,session.sid,'/check'))).ok)return result({error:'session_required'},401);
  const identity={uid:session.uid,username:session.username,version:session.version,sid:session.sid};
  if(body.mode==='status')return await stage(()=>deps.directory(env,'/bounded-ts-status',identity));
  const claim=await stage(()=>deps.directory(env,'/bounded-ts-claim',{...identity,requestId}));if(!claim.ok)return claim;claimed=true;
  const permissions=contentPermissions(await (await stage(()=>deps.directory(env,'/permissions',{username:session.username}))).json());
  if(!permissions.tv)throw Error('content_disabled');
  const record=await (await stage(()=>deps.registry(env,'/xtream-resolve',{id:'8461'}))).json();
  if(record?.kind!=='live'||!safeId(record.upstreamId)||!/^[a-z0-9_-]{1,32}$/.test(record.server||''))throw Error('mapping');
  const catalog=deps.catalog(env,ctx),rows=await stage(()=>catalog('get_live_streams',record.server));
  const allowed=permissions.adults?rows:await stage(()=>createAdultPolicy(catalog).filter('get_live_streams',rows));
  if(!allowed.some(x=>String(x.stream_id)===String(record.upstreamId)&&String(x._server||'ccf')===record.server))throw Error('mapping');
  const selection={channelId:String(record.upstreamId),server:record.server};
  report=await runBoundedTs({session,selection,enabled:true,signal:abort.signal},{
   authorize:async()=>!expired,
   resolveAuthorizedChannel:async()=>({...selection,publicId:'8461'}),
   allocateOnce:async(_s,_channel,signal)=>{
    if(signal.aborted)throw Error('cancelled');
    const begun=await deps.directory(env,'/playback-begin',{sid:session.sid,request_id:requestId});if(!begun.ok||signal.aborted)throw Error('cancelled');
    const response=await deps.directory(env,'/acquire',{...identity,server:selection.server,request_id:requestId,mediaKey:'live|'+selection.server+'|'+selection.channelId+'|ts'});
    if(!response.ok)throw Error('allocation');const allocation=await response.json();
    // Return the lease before further awaited work so core can always release it,
    // including when acquire resolves after cancellation.
    return allocation;
   },
   openTsOnce:async(allocation,channel,{signal})=>{
    if(signal.aborted)throw Error('cancelled');
    // Do not run validation probes or rotate providers. Fail closed if existing
    // normal allocation cannot supply a previously validated credential.
    if(!allocation.encrypted||!(allocation.reused||allocation.validatedRecently))throw Error('provider_validation_required');
    const credential=await deps.unticket(env,allocation.encrypted);if(signal.aborted)throw Error('cancelled');
    if(!credential?.username||!credential.password||!credential.origin)throw Error('provider');
    const target=deps.validatedMediaTarget(credential.origin+'/live/'+encodeURIComponent(credential.username)+'/'+encodeURIComponent(credential.password)+'/'+channel.channelId+'.ts',credential.origin);
    // Exactly one origin request; redirects are returned, not followed. Existing
    // general playback helpers are intentionally not changed or invoked.
    if(signal.aborted)throw Error('cancelled');
    return (deps.fetchOnce||fetch)(target.href,{method:'GET',headers:{'User-Agent':'SnapMovieNow/diagnostic','Accept-Encoding':'identity'},redirect:'manual',signal});
   },
   release:async allocation=>{if(!allocation.lease_id)return false;const r=await deps.directory(env,'/release',{sid:session.sid,request_id:requestId,lease_id:allocation.lease_id});releaseConfirmed=r.ok;return r.ok},
   retainCleanup:p=>{cleanups.push(p);retain(p)}
  });
  report={...report,...(expired?{stopReason:req.signal?.aborted?'cancelled':'deadline'}:{}),elapsedMs:timing.now()-started,source:'requested_resource_selected_provider',originalOrAlternative:'unknown',fallbackAttempted:false};
  return result({requestId,...report});
 }catch{return result({requestId,error:expired?(req.signal?.aborted?'cancelled':'deadline'):'diagnostic_unavailable',outcome:claimed?'consumed':'unknown'},expired?504:409)}
 finally{
  timing.clearTimeout(timer);abort.abort('finished');req.signal?.removeEventListener('abort',cancel);
  if(session&&claimed)retain(Promise.allSettled(cleanups).then(()=>deps.directory(env,'/bounded-ts-result',{uid:session.uid,username:session.username,version:session.version,sid:session.sid,requestId,result:{...(report||{stopReason:expired?'deadline':'operation_failed',elapsedMs:timing.now()-started}),leaseReleased:releaseConfirmed}})));
 }
}
