export const MONITOR_REQUEST_HEADER='X-SNAP-Playback-Monitor';
export const MONITOR_RESPONSE_HEADER='X-SNAP-Playback-Quality';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
// A random value per foreground viewer separates identical devices behind one
// router. Keep it stable across channel/decoder changes within that viewer.
export function playbackMonitorClient(request){const value=request.headers.get(MONITOR_REQUEST_HEADER);return uuid.test(value||'')?value.toLowerCase():null;}
export async function attachPlaybackQuality(response,request,session,lease,encode){
 if(!response.ok||!playbackMonitorClient(request))return response;
 try{
  const value=await encode({kind:'playback-quality',uid:session.uid,version:session.version,sid:session.sid,lease_id:lease.lease_id,request_id:lease.request_id,exp:session.exp});
  const headers=new Headers(response.headers);headers.set(MONITOR_RESPONSE_HEADER,value);headers.set('Cache-Control','no-store');
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 }catch{return response;} // Optional monitoring must never prevent playback.
}
export async function playbackQualityContext(session,body,decode,now=Date.now()){
 if(!session.managed)return null;
 if(body.quality_ticket!==undefined){
  if(typeof body.quality_ticket!=='string'||! /^[A-Za-z0-9_-]{40,4096}$/.test(body.quality_ticket))return null;
  const value=await decode(body.quality_ticket);
  if(value?.kind!=='playback-quality'||value.exp<=now||value.uid!==session.uid||value.version!==session.version||!/^xtream:[A-Za-z0-9_-]{20,100}$/.test(value.sid||'')||!uuid.test(value.lease_id||'')||!uuid.test(value.request_id||''))return null;
  const age=body.observation?.ageMs;
  if(!Number.isSafeInteger(age)||age<0||age>45000)return null;
  return {...value,metric:body.metric,observation:body.observation};
 }
 if(!body.lease_id||!body.request_id)return null;
 return {uid:session.uid,version:session.version,sid:session.sid,lease_id:body.lease_id,request_id:body.request_id,metric:body.metric,observation:body.observation};
}
