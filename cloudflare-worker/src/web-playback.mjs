// One client request owns every attempt. Release a failed allocation before
// choosing another authorised account; a cancelled request cannot restart.
export async function prepareWebPlayback(body,session,requestUrl,env,ctx,deps){
 const type=String(body.type||'movie'),ext=deps.cleanExt(body.ext),server=String(body.server||'ccf');
 const request_id=String(body.request_id||crypto.randomUUID());
 if(session.managed){
  const begun=await deps.directory(env,'/playback-begin',{sid:session.sid,request_id,revision:body.revision});
  if(!begun.ok)return deps.json(await begun.json(),begun.status);
 }
 const excluded=[],attempts=type==='live'&&session.managed?3:1;
 for(let attempt=0;attempt<attempts;attempt++){
  let credentials=session,lease_id,provider_id;
  if(session.managed){
   let allocation;
   try{allocation=await deps.managedPlayback(env,{...session,request_id,mediaKey:type+'|'+server+'|'+body.id+'|'+ext},server,ctx,excluded)}
   catch(error){return deps.json({error:error.message.startsWith('panel_')?error.message:'provider_not_configured'},503)}
   if(!allocation.r.ok)return deps.json(await allocation.r.json(),allocation.r.status);
   credentials=allocation.credentials;provider_id=allocation.provider_id;lease_id=(await allocation.r.json()).lease_id;
  }
  const data={sid:session.sid,username:credentials.username,password:credentials.password,origin:credentials.origin||deps.origin,lease_id,request_id,type,id:String(body.id),ext,exp:session.exp};
  const url=new URL(requestUrl).origin+'/stream?t='+await deps.ticket(env,data);
  if(type==='live'){
   try{
    const checked=await deps.serverStream(new Request(url,{headers:{'X-SMN-Prepare':'1'}}),env,new URL(url),ctx);
    if(!checked.ok){await checked.body?.cancel();throw Error(checked.status===410?'playback_superseded':'live_signal_unavailable')}
    if(!(await checked.text()).startsWith('#EXTM3U'))throw Error('live_signal_unavailable');
   }catch(error){
    if(lease_id)await deps.directory(env,'/release',{sid:session.sid,lease_id,request_id});
    if(error.message==='playback_superseded')return deps.json({error:'playback_superseded'},410);
    if(error.message==='media_origin_unapproved')return deps.json({error:error.message},502);
    if(provider_id&&attempt+1<attempts){excluded.push(provider_id);continue}
    return deps.json({error:'live_signal_unavailable'},502);
   }
  }
  if(lease_id&&!(await deps.directory(env,'/lease-check',{sid:session.sid,lease_id,request_id})).ok)return deps.json({error:'playback_superseded'},410);
  return deps.json({url,lease_id,request_id});
 }
}
