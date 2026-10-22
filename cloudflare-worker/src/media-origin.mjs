import {LIVE_STARTUP_MS,startupTimeout} from './live-startup.mjs';
import {CCF_MEDIA_ORIGIN,isApprovedMediaIP,fetchApprovedMediaIP} from './ip-media.mjs';
import {validateServerUrl} from './reseller.mjs';
import {fetchMedia} from './media-fetch.mjs';

export function validatedMediaTarget(value,sourceOrigin){
 const target=new URL(value);
 if(target.username||target.password)throw Error('media_origin_unapproved');
 if(sourceOrigin===CCF_MEDIA_ORIGIN&&target.hostname==='194.76.0.119'&&target.port==='8080'&&target.protocol==='http:')target.hostname='media.snaptvnow.com';
 if(!isApprovedMediaIP(target,sourceOrigin)){
  if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(target.hostname)||target.hostname.startsWith('['))throw Error('media_origin_unapproved');
  validateServerUrl(target.origin);
 }
 return target;
}

// Preserve the authorised source across redirects and Range retries. HLS
// playlists use the same target check before issuing encrypted resource URLs.
export async function fetchValidatedMedia(start,headers,type,sourceOrigin,{fetchIP=fetchApprovedMediaIP,fetchHost=fetchMedia,onOrigin,deadline=null}={}){
 let next=start;
 for(let redirects=0;redirects<6;redirects++){
  const target=validatedMediaTarget(next,sourceOrigin);next=target.href;
  // Private diagnostics may observe origins, never credential-bearing paths.
  if(onOrigin)onOrigin(target.origin);
  // Spend the shared startup budget rather than cutting a responding source at
  // a second, unrelated four-second deadline. Every redirect keeps that budget.
  const response=isApprovedMediaIP(target,sourceOrigin)?
   await fetchIP(next,headers,undefined,undefined,sourceOrigin,deadline):
   await fetchHost(next,{headers,redirect:'manual'},deadline===null?(type==='live'?12000:25000):startupTimeout(deadline,LIVE_STARTUP_MS));
  if(![301,302,303,307,308].includes(response.status))return {response,url:next};
  const location=response.headers.get('location');await response.body?.cancel();
  if(!location||redirects===5)throw Error('invalid_redirect');
  next=new URL(location,next).href;
 }
}
