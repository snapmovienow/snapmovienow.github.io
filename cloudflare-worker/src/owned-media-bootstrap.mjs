import {ownedVerificationEnabled} from './owned-media-verification.mjs';

// Deployment of the authorized private connection starts this finite job.
// Requests supply no target, input, credential or operation to the job.
export function createOwnedMediaBootstrap({now=Date.now}={}){
 let queued=false;
 return (env,ctx)=>{
  if(queued||!ctx?.waitUntil||!env.PLAYBACK_SESSIONS||!ownedVerificationEnabled(env,now()))return;
  queued=true;
  ctx.waitUntil((async()=>{
   const response=await env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_owned_media_verification_20261104')).fetch('https://private/owned-media-verification-run',{method:'POST',body:'{}'});
   if(!response.ok)console.error({event:'owned_media_bootstrap',status:response.status});await response.body?.cancel();
  })().catch(()=>console.error({event:'owned_media_bootstrap',reason:'private_job_unavailable'})));
 };
}
