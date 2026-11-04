import manifest from './owned-media-manifest.json' with {type:'json'};

// Only these verified copies may receive private Site credentials.
export const OWNED_MEDIA_ORIGIN='https://snaptvnow-media-temporal.juancanta89.chatgpt.site';
export const OWNED_MEDIA_SERIES='the-remarried-empress-2026';
export const OWNED_MEDIA_RELEASE='empress-owned-20261104-v1';
export const OWNED_MEDIA_UNTIL=Date.parse('2026-12-30T00:00:00Z');
const failure=(code,status=503)=>Object.assign(new Error(code),{status});
export const OWNED_MEDIA_FILES=Object.freeze(manifest.map(item=>Object.freeze({...item,url:OWNED_MEDIA_ORIGIN+'/api/media/'+item.id+'.mp4'})));
const byUrl=new Map(OWNED_MEDIA_FILES.map(item=>[item.url,item]));
export function ownedMediaDescriptor(value){
 if(typeof value!=='string')return null;
 return byUrl.get(value)||null;
}
export const ownedMediaForEpisode=id=>OWNED_MEDIA_FILES.find(item=>item.exclusiveId===id)||null;
export function isOwnedMediaSeries(row){
 return row?.id===OWNED_MEDIA_SERIES&&row.type==='series'&&row.mode==='direct'&&row.episodes?.length===4&&row.episodes.every(episode=>{
  const primary=ownedMediaForEpisode(episode.id),alternate=episode.alternatives?.[0],secondary=alternate&&ownedMediaForEpisode(alternate.id);
  return primary?.option===1&&primary.episode===episode.episode_num&&episode.season===1&&episode.page===primary.url&&episode.alternatives.length===1&&secondary?.option===2&&secondary.episode===primary.episode&&alternate.page===secondary.url;
 })&&new Set(row.episodes.map(episode=>episode.episode_num)).size===4;
}
function siteSecret(env){
 const secret=env.SNAP_OWNED_MEDIA_SITE_TOKEN;
 if(typeof secret!=='string'||secret.length<30||secret.length>14000||/[\r\n]/.test(secret))throw failure('owned_media_not_connected');
 return secret;
}
export function assertOwnedMediaConnected(env){
 if(Date.now()>=OWNED_MEDIA_UNTIL)throw failure('owned_media_review_required',410);
 siteSecret(env);
}
export function ownedMediaHeaders(target,env,playbackTicket){
 if(!ownedMediaDescriptor(target))throw failure('exclusive_resource',403);
 const secret=siteSecret(env);
 if(typeof playbackTicket!=='string'||!/^[A-Za-z0-9_.-]{30,14000}$/.test(playbackTicket))throw failure('session_expired',401);
 return {'OAI-Sites-Authorization':'Bearer '+secret,'Authorization':'Bearer '+playbackTicket};
}
async function privateFetch(target,init,fetcher){
 // Workers rejects redirect:"error" before any I/O. Its manual mode lets us
 // reject every redirect without sending the credential to another host.
 const response=await fetcher(target,{...init,redirect:'manual'});
 if(response.status>=300&&response.status<400){await response.body?.cancel();throw failure('owned_media_redirect');}
 return response;
}
export async function fetchOwnedMedia(target,env,playbackTicket,{range,head=false,signal,fetcher=fetch}={}){
 const headers=new Headers(ownedMediaHeaders(target,env,playbackTicket));
 if(range)headers.set('Range',range);
 const response=await privateFetch(target,{method:head?'HEAD':'GET',headers,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)},fetcher);
 return response;
}
export async function probeOwnedMedia(env,{fetcher=fetch}={}){
 const headers={'OAI-Sites-Authorization':'Bearer '+siteSecret(env)};
 let response;try{response=await privateFetch(OWNED_MEDIA_ORIGIN+'/api/ready',{headers,signal:AbortSignal.timeout(20000)},fetcher);}catch(error){if(error?.message==='owned_media_redirect')throw error;throw failure(/1042/.test(String(error?.message))?'owned_media_fetch_1042':error?.name==='TimeoutError'?'owned_media_timeout':'owned_media_network');}
 if(!response.ok){const status=response.status;await response.body?.cancel();throw failure('owned_media_http_'+status);}
 const value=await readBoundedJson(response,20000);
 if(value?.release!==OWNED_MEDIA_RELEASE||value.ready!==true||value.items?.length!==8||!OWNED_MEDIA_FILES.every(file=>value.items.some(item=>item.id===file.id&&item.ready===true&&item.sha256===file.sha256&&item.size===file.size)))throw failure('owned_media_integrity');
 return {ready:true,count:8,size:OWNED_MEDIA_FILES.reduce((sum,file)=>sum+file.size,0)};
}
export async function fetchOwnedPreview(target,env,{fetcher=fetch}={}){
 const item=ownedMediaDescriptor(target);if(!item)throw failure('exclusive_resource',403);
 return privateFetch(OWNED_MEDIA_ORIGIN+'/api/preview/'+item.id,{headers:{'OAI-Sites-Authorization':'Bearer '+siteSecret(env),Range:'bytes=0-2047'},signal:AbortSignal.timeout(20000)},fetcher);
}
export async function readBoundedJson(request,limit=20000){
 const length=request.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>limit))throw failure('body_too_large',413);
 const reader=request.body?.getReader();if(!reader)throw failure('invalid_json',400);let size=0,text='';const decoder=new TextDecoder();
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw failure('body_too_large',413)}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}finally{reader.releaseLock();}
 try{return JSON.parse(text)}catch{throw failure('invalid_json',400)}
}
