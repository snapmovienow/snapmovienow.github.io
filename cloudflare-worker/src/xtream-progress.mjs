export const watchProgressCapability={
  version:1,read:'get_watch_progress',write:'set_watch_progress',unit:'seconds'
};
const contentType=type=>type==='movie'?'movies':'series';
const streamId=value=>typeof value==='string'&&/^\d{1,10}$/.test(value)&&Number(value)>0;
const number=value=>value!==null&&value.trim()!==''?Number(value):NaN;
const within=(value,max)=>Number.isFinite(value)&&value>=0&&value<=max;

async function streamReference(id,auth,deps){
  if(!streamId(id))return deps.json({error:'invalid_stream'},400);
  const record=await deps.resolve(id);
  if(!record||!['movie','episode'].includes(record.kind))return deps.json({error:'not_found'},404);
  const type=record.kind==='movie'?'movie':'series';
  if(!auth.user.permissions[contentType(type)])return deps.json({error:'content_disabled'},403);
  if(deps.localSeries?.matches(record)){
    return await deps.localSeries.progressReference(record,auth)||deps.json({error:'not_found'},404);
  }
  if(auth.user.permissions.adults===false&&!await deps.adultPolicy.allowed(record))return deps.json({error:'adult_content_disabled'},403);
  if(type==='movie')return {type,id:record.upstreamId,server:record.server};
  if(!record.parentId)return deps.json({error:'series_reference_required'},409);
  return {type,id:record.parentId,server:record.server,episodeId:record.upstreamId};
}

export async function watchProgress(req,action,params,auth,deps){
  if(!auth.session?.managed)return deps.json({error:'managed_profile_required'},403);
  const write=action===watchProgressCapability.write,id=params.get('stream_id');
  if(write&&req.method!=='POST')return deps.json({error:'method_not_allowed'},405);
  let reference,key;
  if(write||id!==null){
    reference=await streamReference(id,auth,deps);
    if(reference instanceof Response)return reference;
    key=reference.type+':'+reference.server+':'+reference.id;
  }
  let patches;
  if(write){
    const completion=params.get('completed')??'false';
    if(!['true','false','1','0'].includes(completion))return deps.json({error:'invalid_progress'},400);
    const completed=completion==='true'||completion==='1';
    const time=number(params.get('position_seconds')),duration=number(params.get('duration_seconds')??'0');
    const updatedAt=number(params.get('updated_at')??String(Date.now()));
    if(!completed&&(!within(time,172800)||!within(duration,172800)))return deps.json({error:'invalid_progress'},400);
    if(!Number.isSafeInteger(updatedAt)||updatedAt<0)return deps.json({error:'invalid_progress'},400);
    patches=[{...reference,kind:'progress',key,updatedAt,...(completed?{completed:true,deleted:true}:{time,duration})}];
  }
  const response=await deps.profile(auth.session,write?'patch':'get',patches);
  const data=await response.json();
  if(!response.ok)return deps.json(data,response.status);
  // Reuse the native account's history, omitting favorites and account preferences.
  return deps.json({revision:data.revision,records:data.records.filter(row=>row.kind==='progress'&&
    ['movie','series'].includes(row.type)&&auth.user.permissions[contentType(row.type)]&&(!key||row.key===key))});
}
