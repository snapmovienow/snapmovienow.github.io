import {playbackStartup,reportLiveResult,deferPlaybackReport} from './live-startup.mjs';
import {startPlaybackActivity,attachPlaybackActivity} from './playback-activity.mjs';
import {preparationFailure} from './playback-diagnostics.mjs';
// One client request owns every attempt. Release a failed allocation before
// choosing another authorised account; a cancelled request cannot restart.
export async function prepareWebPlayback(body,session,requestUrl,env,ctx,deps){
 const type=String(body.type||'movie'),ext=deps.cleanExt(body.ext),server=String(body.server||'ccf');
 const request_id=String(body.request_id||crypto.randomUUID());
 const activityTask=session.managed?startPlaybackActivity(deps.activity&&(()=>deps.activity({type,server,id:body.id,parentId:body.series_id})),ctx):null;
 if(session.managed){
  const begun=await deps.directory(env,'/playback-begin',{sid:session.sid,request_id,revision:body.revision});
  if(!begun.ok)return deps.json(await begun.json(),begun.status);
 }
 const startup=session.managed?playbackStartup(type):null;if(startup)startup.trace=deps.trace;
 const excluded=session.canary&&session.comparison&&Array.isArray(body.diagnosticExclude)?[...new Set(body.diagnosticExclude.filter(x=>typeof x==='string'&&x.length<=160))].slice(0,4):[],attempts=type==='live'&&session.managed?3:1;
 for(let attempt=0;attempt<attempts&&(attempt===0||!startup||startup.available);attempt++){
  let credentials=session,lease_id,provider_id,allocation;
  if(session.managed){
   try{allocation=await deps.managedPlayback(env,{...session,request_id,client:deps.client,mediaKey:type+'|'+server+'|'+body.id+'|'+ext},server,ctx,excluded,startup)}
   catch(error){const failed=preparationFailure(error);return deps.json({error:failed.error},failed.status)}
   if(!allocation.r.ok)return deps.json(await allocation.r.json(),allocation.r.status);
   credentials=allocation.credentials;provider_id=allocation.provider_id;lease_id=(await allocation.r.json()).lease_id;allocation.lease_id=lease_id;
  }
  const data={sid:session.sid,username:credentials.username,password:credentials.password,origin:credentials.origin||deps.origin,lease_id,provider_id,request_id,type,id:String(body.id),ext,exp:session.exp,...(session.canary?{canary:true,...(session.comparison?{comparison:true}:{})}:{})};
  const url=new URL(requestUrl).origin+'/stream?t='+await deps.ticket(env,data);
  if(type==='live'&&ext==='m3u8'){
   const signalAt=Date.now(),mediaSession={...session,request_id};let sourceHttpStatus;
   try{
    const checked=await deps.serverStream(startup?startup.prepare(new Request(url)):new Request(url,{headers:{'X-SMN-Prepare':'1'}}),env,new URL(url),ctx,deps.trace);
    if(!checked.ok){sourceHttpStatus=checked.status;await checked.body?.cancel();throw Error(checked.status===410?'playback_superseded':'live_signal_unavailable')}
    if(!(await checked.text()).startsWith('#EXTM3U'))throw Error('live_signal_unavailable');
    if(startup){const elapsed=Date.now()-signalAt;deferPlaybackReport(ctx,()=>reportLiveResult(deps.directory,env,mediaSession,allocation,true,elapsed));}
   }catch(error){
    if(startup&&!['media_origin_unapproved','playback_superseded'].includes(error.message))await reportLiveResult(deps.directory,env,mediaSession,allocation,false,Date.now()-signalAt,'signal',{httpStatus:sourceHttpStatus});
    if(lease_id)await deps.directory(env,'/release',{sid:session.sid,lease_id,request_id,reason:'upstream_failed'});
    if(error.message==='playback_superseded')return deps.json({error:'playback_superseded'},410);
    if(error.message==='media_origin_unapproved')return deps.json({error:error.message},502);
    if(provider_id&&attempt+1<attempts){excluded.push(provider_id);continue}
    return deps.json({error:'live_signal_unavailable'},502);
   }
  }
  if(lease_id&&!(await deps.directory(env,'/lease-check',{sid:session.sid,lease_id,request_id})).ok)return deps.json({error:'playback_superseded'},410);
  if(lease_id)attachPlaybackActivity(activityTask,{env,ctx,directory:deps.directory,session:{...session,request_id},lease_id,mediaKey:type+'|'+server+'|'+body.id+'|'+ext});
  return deps.json({url,lease_id,request_id});
 }
 return deps.json({error:'live_signal_unavailable'},504);
}
