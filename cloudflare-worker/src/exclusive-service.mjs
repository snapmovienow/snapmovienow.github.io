import {isOfficialLivePage,resolveOfficialLive,officialMediaAllowed,officialHeartbeat,forgetOfficialLivePage} from './official-live.mjs';
import {createLocalTvXtream,visibleLocalTv} from './local-tv-xtream.mjs';
import {exclusiveURL,exclusiveId,exclusivePublic,visibleExclusive,selectExclusive} from './exclusive-catalog.mjs';
import {observeFirstChunk} from './local-startup-observations.mjs';
const error=(code,status=400)=>Object.assign(Error(code),{status});
async function mediaFetch(url,{range,head=false,signal,fetcher=fetch,allowed}={}){
 let target=exclusiveURL(url);for(let i=0;i<4;i++){
  if(allowed&&!allowed(target))throw error('exclusive_resource',403);
  const headers=new Headers({'User-Agent':'Mozilla/5.0','Accept-Encoding':'identity'});if(range)headers.set('Range',range);
  const response=await fetcher(target,{method:head?'HEAD':'GET',headers,redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
  if(response.status<300||response.status>=400)return {response,url:target};
  const location=response.headers.get('Location');await response.body?.cancel();if(!location||i===3)throw error('exclusive_redirect',502);target=exclusiveURL(new URL(location,target).href);
 }throw error('exclusive_redirect',502);
}
async function limitedText(response,max=1000000){const reader=response.body?.getReader();if(!reader)throw error('exclusive_media',502);let size=0,text='';const decoder=new TextDecoder();try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max){await reader.cancel();throw error('exclusive_media',502)}text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}finally{reader.releaseLock();}}
export function createExclusiveService(deps){
 const read=async env=>{const r=await deps.directory(env,'/exclusive-read');if(!r.ok)throw error('exclusive_unavailable',503);return r.json();};
 const resolve=async(media,viewer)=>isOfficialLivePage(media.page)?resolveOfficialLive(media.page,{fetcher:deps.fetcher,signal:AbortSignal.timeout(45000),cachePublicPages:true,...(viewer?{viewerKey:viewer.sid,viewerExpiresAt:viewer.exp}:{})}):{url:media.mode==='gnula'?await deps.resolveGnula(media.page,media.preferredEmbed||null,{signal:AbortSignal.timeout(35000)}):exclusiveURL(media.page)};
 const lookup=async(env,id,permissions,options={})=>{const data=await read(env),selected=selectExclusive(data.items,id);if(!selected||!(options.live?visibleLocalTv(selected.row,permissions):visibleExclusive(selected.row,permissions)))throw error('title_not_allowed',404);if(selected.row.type==='series'&&selected.media===selected.row)throw error('exclusive_episode_required');return selected;};
 const catalog=async(env,permissions,origin,options={})=>{const data=await read(env);return {revision:data.revision,items:data.items.filter(row=>visibleExclusive(row,permissions)&&(!options.legacy||row.mode==='gnula'&&!isOfficialLivePage(row.page))).sort((a,b)=>b.createdAt-a.createdAt).map(row=>exclusivePublic(row,origin))};};
 const episodes=async(env,id,permissions,origin)=>{const data=await read(env),row=data.items.find(x=>x.id===id);if(!row||row.type!=='series'||!visibleExclusive(row,permissions))throw error('title_not_allowed',404);const grouped={};for(const ep of row.episodes){(grouped[ep.season]??=[]).push({...ep,page:undefined,exclusive_id:ep.id,container_extension:row.mode==='gnula'?'m3u8':new URL(ep.page).pathname.split('.').at(-1),smn_profile:{type:'series',id:row.id,server:row.profileServer,episodeId:ep.id}});}return {info:{name:row.name,plot:row.plot,year:row.year,cover:exclusivePublic(row,origin).cover},episodes:grouped};};
 const prepare=async(req,env,session,id,options={})=>{
  const localStartedAt=options.localStartedAt||Date.now();
  // Reuse the internal live adapter's fresh snapshot. Acquisition still checks
  // current permission, source identity and revision in the account store.
  const selected=options.live&&options.localRow?selectExclusive([options.localRow],id):null;
  if(selected&&!visibleLocalTv(selected.row,session.permissions))throw error('title_not_allowed',404);
  const {row,media}=selected||await lookup(env,id,session.permissions,options),request_id=options.request_id||crypto.randomUUID();
  const begun=await deps.directory(env,'/playback-begin',{sid:session.sid,request_id,...(Number.isSafeInteger(options.revision)?{revision:options.revision}:{})});if(!begun.ok)throw error('playback_superseded',begun.status);
  let resolved;
  try{resolved=await resolve(media,session);}catch(e){if(!req.signal.aborted)await deps.directory(env,'/channel-startup-failure',{...session,request_id,exclusiveId:id,playbackRevision:row.playbackRevision,live:options.live===true,client:deps.requestConnectionClient(req)}).then(r=>r.body?.cancel()).catch(()=>{});throw e;}
  const source=exclusiveURL(resolved.url);
  const allocated=await deps.directory(env,'/exclusive-acquire',{...session,request_id,exclusiveId:id,playbackRevision:row.playbackRevision,...(options.live?{live:true}:{}),client:deps.requestConnectionClient(req)});if(!allocated.ok){const b=await allocated.json();throw error(b.error||'exclusive_capacity',allocated.status);}
  const {lease_id}=await allocated.json();
  try{
   const monitor=await deps.ticket(env,{kind:'playback-quality',uid:session.uid,version:session.version,sid:session.sid,lease_id,request_id,exp:session.exp});
   const value={kind:'exclusive-media',sid:session.sid,uid:session.uid,version:session.version,exclusiveId:id,parentId:row.id,playbackRevision:row.playbackRevision,lease_id,request_id,source,...(resolved.officialPage?{officialPage:resolved.officialPage,officialHeartbeat:resolved.officialHeartbeat,localStartedAt}:{}),monitor,type:row.type,xtream:!!session.xtream,exp:Math.min(session.exp,Date.now()+3*3600000)};
   const token=await deps.ticket(env,value);return {url:new URL('/exclusive-media?t='+encodeURIComponent(token),req.url).href,lease_id,request_id};
  }catch(e){await deps.directory(env,'/release',{sid:session.sid,lease_id,request_id});throw e;}
 };
 const media=async(req,env,ctx)=>{
  const data=await deps.unticket(env,new URL(req.url).searchParams.get('t')||'');
  if(data?.kind!=='exclusive-media'||!exclusiveId(data.exclusiveId))throw error('session_expired',401);
  const scope={sid:data.sid,lease_id:data.lease_id,request_id:data.request_id,exclusiveId:data.exclusiveId,parentId:data.parentId,playbackRevision:data.playbackRevision};
  let heartbeat;
  if(data.officialPage){
   // Session revocation remains independent. Catalog, account, binding and lease
   // checks now complete together, before any upstream fetch or bytes.
   const [access,checked]=await Promise.all([deps.sessionCall(env,data.sid,'/check'),deps.directory(env,'/heartbeat',{...scope,localVideo:req.method==='GET'&&data.localVideo===true})]);
   if(!access.ok){await checked.body?.cancel();await deps.directory(env,'/release',{sid:data.sid,lease_id:data.lease_id,request_id:data.request_id});throw error('session_expired',401);}
   heartbeat=checked;
  }else{
   const [access,itemResponse]=await Promise.all([deps.sessionCall(env,data.sid,'/check'),deps.directory(env,'/exclusive-item-read',{id:data.parentId})]);
   if(!access.ok){await itemResponse.body?.cancel();throw error('session_expired',401);}
   const current=itemResponse.ok?selectExclusive([await itemResponse.json()],data.exclusiveId):null;if(!current||!current.row.visible||current.row.playbackRevision!==data.playbackRevision)throw error('title_not_allowed',410);
   heartbeat=await deps.directory(env,'/heartbeat',{sid:data.sid,lease_id:data.lease_id,request_id:data.request_id});
  }
  const checked=await heartbeat.json();if(!heartbeat.ok)throw error(checked.error==='title_not_allowed'?'title_not_allowed':'playback_expired',410);
  if(data.officialPage&&checked.exclusiveScopeChecked!==true){
   // An older directory instance may briefly coexist during a rolling deploy.
   // Require its explicit scope acknowledgement or perform the original read.
   const item=await deps.directory(env,'/exclusive-item-read',{id:data.parentId}),current=item.ok?selectExclusive([await item.json()],data.exclusiveId):null;
   if(!current||!current.row.visible||current.row.playbackRevision!==data.playbackRevision)throw error('title_not_allowed',410);
  }
  const report=stage=>{if(!data.officialPage||!Number.isFinite(data.localStartedAt)||!ctx?.waitUntil)return;const durationMs=Date.now()-data.localStartedAt;ctx.waitUntil(deps.directory(env,'/local-startup-observe',{...scope,stage,durationMs}).then(r=>r.body?.cancel()).catch(()=>{}));};
  const usageFailure=code=>deps.directory(env,'/channel-usage-observe',{...scope,kind:'failure',code}).then(r=>r.body?.cancel()).catch(()=>{});
  try{
  const base=new URL(exclusiveURL(data.officialPage?(data.source||data.resource):data.source)),target=new URL(exclusiveURL(data.resource||data.source));const allowed=data.officialPage?url=>officialMediaAllowed(data.officialPage,url):null;if(allowed?!allowed(target):data.resource&&target.origin!==base.origin)throw error('exclusive_resource',403);
  const fetched=await mediaFetch(target.href,{range:req.headers.get('Range')||undefined,head:req.method==='HEAD',signal:req.signal,fetcher:deps.fetcher,allowed});const response=fetched.response;
  if(!response.ok){await response.body?.cancel();if(data.officialPage)await forgetOfficialLivePage(data.officialPage,{fetcher:deps.fetcher});throw error('media_unavailable',response.status===404?404:502);}
  if(allowed?!allowed(fetched.url):data.resource&&new URL(fetched.url).origin!==base.origin){await response.body?.cancel();throw error('exclusive_resource',403);}
  const out=new Headers({'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});for(const key of ['content-type','content-length','content-range','accept-ranges','etag','last-modified'])if(response.headers.has(key))out.set(key,response.headers.get(key));
  if(!data.resource){out.set('X-SNAP-Playback-Quality',data.monitor);if(data.officialPage)out.set('X-SNAP-Local-Startup','2');}
  const playlist=/mpegurl/i.test(response.headers.get('Content-Type')||'')||new URL(fetched.url).pathname.endsWith('.m3u8');
  if(playlist&&req.method!=='HEAD'){
   if(data.officialHeartbeat)await officialHeartbeat(data.officialHeartbeat,{fetcher:deps.fetcher,signal:req.signal});
   const text=await limitedText(response);if(!text.trimStart().startsWith('#EXTM3U'))throw error('invalid_playlist',502);
   const multivariant=/#EXT-X-STREAM-INF:/.test(text),nextBase=new URL(fetched.url),rewritten=new Map(),rewrite=async(value,track=data.localTrack||'video',localVideo=false)=>{const destination=new URL(exclusiveURL(new URL(value,nextBase).href));if(allowed?!allowed(destination):destination.origin!==nextBase.origin)throw error('exclusive_resource',403);
    const key=destination.href+'|'+track+'|'+localVideo;if(!rewritten.has(key))rewritten.set(key,(async()=>{
     const child={...data,source:data.resource?data.source:fetched.url,resource:destination.href};
     if(data.officialPage){
      // Keep access/revision/lease checks and station scope. Do not repeat the
      // master URL or root-only fields in every encrypted resource URL.
      delete child.source;delete child.monitor;delete child.type;delete child.xtream;
      delete child.localTrack;delete child.localVideo;
      if(track!=='video')child.localTrack=track;if(localVideo)child.localVideo=true;
      if(/\.(?:ts|m4s|mp4|aac|mp3|key|vtt|webvtt|jpg|jpeg|png)$/i.test(destination.pathname))delete child.officialHeartbeat;
     }
     const t=await deps.ticket(env,child);return new URL('/exclusive-media?t='+encodeURIComponent(t),req.url).href;
    })());return rewritten.get(key);
   };
   const lines=await Promise.all(text.split(/\r?\n/).map(async line=>{if(!line.trim())return line;if(!line.startsWith('#'))return rewrite(line.trim(),data.localTrack||'video',!multivariant&&(data.localTrack||'video')==='video');const track=line.startsWith('#EXT-X-MEDIA:')&&/TYPE=AUDIO(?:,|$)/.test(line)?'audio':line.startsWith('#EXT-X-MEDIA:')&&/TYPE=SUBTITLES(?:,|$)/.test(line)?'text':data.localTrack||'video';for(const match of [...line.matchAll(/URI="([^"]+)"/g)])line=line.replace(match[0],'URI="'+await rewrite(match[1],track,false)+'"');return line;}));
   out.delete('content-length');out.set('content-type','application/vnd.apple.mpegurl');if(!data.resource)report('playlist');return new Response(lines.join('\n'),{headers:out});
  }
  if(!data.resource&&!playlist&&!/^(?:video\/|audio\/|application\/octet-stream)/i.test(response.headers.get('Content-Type')||'')){await response.body?.cancel();throw error('exclusive_not_video',502);}
  if(req.method==='HEAD'){await response.body?.cancel();if(!data.resource)await deps.directory(env,'/release',{sid:data.sid,lease_id:data.lease_id,request_id:data.request_id});return new Response(null,{status:response.status,headers:out});}
  const result=new Response(checked.localVideoProbe?observeFirstChunk(response.body,()=>report('firstVideoBytes'),code=>{if(!req.signal.aborted&&ctx?.waitUntil)ctx.waitUntil(usageFailure(code==='media_empty'?'media_empty':'body_error'));}):response.body,{status:response.status,headers:out});
  if(data.resource)return result;
  return deps.guardXtreamResponse(result,async()=>(await deps.sessionCall(env,data.sid,'/check')).ok&&(await deps.directory(env,'/heartbeat',{sid:data.sid,lease_id:data.lease_id,request_id:data.request_id})).ok,()=>deps.directory(env,'/release',{sid:data.sid,lease_id:data.lease_id,request_id:data.request_id}),ctx,req.signal,data.exp,{waitForRelease:data.type!=='live'});
  }catch(e){if(!req.signal.aborted&&(e.status===undefined||e.status>=500||e.status===404))await usageFailure(e.message==='invalid_playlist'?'invalid_playlist':e.name==='TimeoutError'?'upstream_timeout':'upstream_http');throw e;}
 };
 const admin=async(req,env,body,actor)=>{
  if(body.action==='exclusive-list')return Response.json(await read(env));
  if(body.action==='exclusive-save'||body.action==='exclusive-cover'){const r=await deps.directory(env,body.action==='exclusive-save'?'/exclusive-save':'/exclusive-cover-save',{...body,actor});return Response.json(await r.json(),{status:r.status});}
  if(body.action==='exclusive-check'){
   const data=await read(env),selection=selectExclusive(data.items,body.id);if(!selection)throw error('title_not_allowed',404);const resolved=await resolve(selection.media),r=await mediaFetch(resolved.url,{range:'bytes=0-2047',fetcher:deps.fetcher}),type=r.response.headers.get('content-type')||'';
   let ok=r.response.ok&&(/^(?:video\/|audio\/|application\/octet-stream)/i.test(type)||/mpegurl/i.test(type));if(ok&&/mpegurl/i.test(type))ok=(await limitedText(r.response)).trimStart().startsWith('#EXTM3U');else await r.response.body?.cancel();
   return Response.json({ok,checkedAt:Date.now(),message:ok?'El enlace respondió como contenido multimedia.':'No se pudo confirmar un video reproducible.'});
  }return null;
 };
 const xtream=async(req,env,ctx,authenticate)=>{
  const url=new URL(req.url),action=url.searchParams.get('action'),play=url.pathname.match(/^\/exclusive\/([^/]+)\/([^/]+)\/([a-z0-9_-]{2,151})\.(?:m3u8|mp4|mkv|webm|m4v|mov)$/);
  if(!url.pathname.startsWith('/exclusive/')&&!['get_exclusive_catalog','get_exclusive_series_info'].includes(action))return null;
  if(req.method!=='GET'&&req.method!=='HEAD')return Response.json({error:'method_not_allowed'},{status:405});
  if(url.pathname.startsWith('/exclusive/')&&!play)throw error('invalid_path');
  const username=play?decodeURIComponent(play[1]):url.searchParams.get('username'),password=play?decodeURIComponent(play[2]):url.searchParams.get('password');if(!username||!password)throw error('credentials_required',401);
  const auth=await authenticate(username,password);if(auth instanceof Response)return auth;
  if(play){const prepared=await prepare(req,env,auth.session,play[3]);try{return await media(new Request(prepared.url,req),env,ctx);}catch(e){await deps.directory(env,'/release',{sid:auth.session.sid,...prepared});throw e;}}
  return Response.json(action==='get_exclusive_catalog'?await catalog(env,auth.session.permissions,url.origin):await episodes(env,url.searchParams.get('series_id'),auth.session.permissions,url.origin));
 };
 const liveXtream=(env,ctx)=>createLocalTvXtream({read,media,prepare:async(...args)=>{const prepared=await prepare(...args);return {...prepared,release:()=>deps.directory(env,'/release',{sid:args[2].sid,lease_id:prepared.lease_id,request_id:prepared.request_id})};}},env,ctx);
 return {catalog,episodes,prepare,media,admin,xtream,liveXtream,read,async cover(env,id){const r=await deps.directory(env,'/exclusive-cover-read',{id});if(!r.ok)return new Response('Not found',{status:404});const value=await r.json();return new Response(Uint8Array.from(atob(value.data),c=>c.charCodeAt(0)),{headers:{'Content-Type':value.type,'Cache-Control':'public, max-age=31536000, immutable','X-Content-Type-Options':'nosniff'}});}};
}
