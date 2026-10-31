import {playbackStartup,reportLiveResult,deferPlaybackReport} from './live-startup.mjs';
import {initialMediaEvidence} from './initial-media-evidence.mjs';
import {responseMediaFailure} from './media-failure-cause.mjs';
import {initialRangeEvidence} from './initial-range-evidence.mjs';
import {timed} from './playback-timings.mjs';
import {playbackMonitorClient,attachPlaybackQuality} from './native-playback-quality.mjs';
import {requestConnectionClient} from './connection-monitor.mjs';
import {handleXtream} from './xtream.mjs';

import {createProviderCatalog,fingerprint} from './provider-catalog.mjs';
import {createAdultPolicy} from './content-permissions.mjs';
import {cleanPlaybackActivity,cachedPlaybackActivity,startPlaybackActivity,attachPlaybackActivity} from './playback-activity.mjs';
export {publicMetadata} from './provider-catalog.mjs';
// CCF can return gateway-specific 52x errors as well as ordinary 5xx. They
// belong to the selected source, not to the subscriber or their bookmark.
const retryableSourceStatus=status=>[401,403,404,408,429].includes(status)||status>=500&&status<=599;

export function createXtreamBridge(deps) {
  return async function xtreamRequest(req, env, ctx,trace) {
    const privateCall = (path, body) => deps.directory(env, path, body);
    const client = req.headers.get('CF-Connecting-IP') || 'unknown';
    const authenticate = async (username, password) => timed(trace,'auth',async()=>{
      const settings = await (await privateCall('/xtream-config')).json();
      if (!settings.enabled) return deps.json({user_info:{auth:0},error:'xtream_disabled'},403);
      const authKey = await fingerprint(env.TICKET_SECRET, JSON.stringify([username.toLowerCase(),password,client,req.headers.get('user-agent')||'',...(playbackMonitorClient(req)?[playbackMonitorClient(req)]:[])]));
      const checked = await privateCall('/xtream-login',{username,password,client,authKey,connection:requestConnectionClient(req)});
      if (!checked.ok) return deps.json({user_info:{auth:0},...await checked.json()},checked.status);
      const user = await checked.json();
      const sid = 'xtream:'+await fingerprint(env.TICKET_SECRET,JSON.stringify([authKey,user.version,settings.version]));
      const identity = {uid:user.id,username:user.username,version:user.version,admin:false,xtream:true,xtreamVersion:settings.version};
      const exp = Math.min(Date.now()+12*3600000,user.expiresAt||Infinity);
      const ensured = await deps.sessionCall(env,sid,'/ensure',{exp,identity});
      if (!ensured.ok) return deps.json({error:'session_unavailable'},503);
      const session = {kind:'session',managed:true,sid,exp:(await ensured.json()).exp,permissions:user.permissions,...identity};
      const url=new URL(req.url),needsCount=url.pathname==='/player_api.php'&&!url.searchParams.get('action');
      const count = needsCount?await (await privateCall('/xtream-count',{uid:user.id})).json():{connections:0};
      return {user,session,username:user.username,connections:count.connections};
    });
    const catalogCost=new URL(req.url).searchParams.get('action')==='get_vod_info'?trace?.movieCatalog('vod_info'):null;
    const rawCatalog = createProviderCatalog(deps, env, ctx,{catalogCost}),catalog=(...args)=>{if(args[0]==='get_series_info')trace?.identify('series',playbackMonitorClient(req)?'android':'other');if(args[0]==='get_vod_info')trace?.identify('movie',playbackMonitorClient(req)?'android':'other');return timed(trace,'catalog',()=>rawCatalog(...args))};
    const register = async entries => {
      const ids=[];
      for(let offset=0;offset<entries.length;offset+=5000){
        const response = await deps.registry(env,'/xtream-register',{entries:entries.slice(offset,offset+5000)});
        if (!response.ok) throw Error('catalog_registration_failed');
        ids.push(...await response.json());
      }
      return ids;
    };
    const resolve = async id => (await deps.registry(env,'/xtream-resolve',{id})).json();
    const play = async (request, session, item) => {
      let activity=cleanPlaybackActivity(item.activity,item.type);
      const activityTask=!activity?startPlaybackActivity(()=>cachedPlaybackActivity(rawCatalog,{type:item.type,server:item.server,id:item.upstreamId,parentId:item.parentId}),ctx):null;
      const request_id=crypto.randomUUID();
      const begun=await privateCall('/playback-begin',{sid:session.sid,request_id});if(!begun.ok)return deps.json(await begun.json(),begun.status);
      trace?.identify(item.type,playbackMonitorClient(request)?'android':'other');
      const startup=playbackStartup(item.type,request.signal);startup.trace=trace;
      const excluded=[];let lastFailure=null,lastServiceError=null;
      for(let attempt=0;attempt<3&&(attempt===0||!startup||startup.available);attempt++){
      const mediaSession={...session,request_id,client:requestConnectionClient(request),mediaKey:item.type+'|'+item.server+'|'+item.upstreamId+'|'+item.ext,...(activity?{activity}:{})};
      const allocation=await deps.managedPlayback(env,mediaSession,item.server,ctx,excluded,startup);
      if(!allocation.r.ok){if(lastFailure&&allocation.r.status===409)return deps.json({error:lastServiceError||'upstream_unavailable'},lastFailure);return deps.json(await allocation.r.json(),allocation.r.status)}
      const {lease_id}=await allocation.r.json(),credentials=allocation.credentials;allocation.lease_id=lease_id;const signalAt=Date.now();
      const monitored=response=>attachPlaybackQuality(response,request,session,{lease_id,request_id},value=>deps.ticket(env,value));
      const encrypted=await deps.ticket(env,{sid:session.sid,username:credentials.username,password:credentials.password,origin:credentials.origin,lease_id,request_id,xtream:true,type:item.type,id:item.upstreamId,ext:item.ext,exp:session.exp});
      const target=new URL('/stream',request.url);target.searchParams.set('t',encrypted);
      try{
        const prepared=startup?startup.prepare(request):new Request(request);
        const response=await deps.serverStream(prepared,env,target,ctx,trace);
        if(!response.ok){
          lastFailure=response.status;
          const cause=responseMediaFailure(response);lastServiceError=cause.serviceError||null;
          if(startup&&response.status!==410)await reportLiveResult(deps.directory,env,mediaSession,allocation,false,Date.now()-signalAt,'signal',{httpStatus:response.status,...cause,...(response.status===416?{rangeEvidence:initialRangeEvidence(request,response)}:{})});
          await privateCall('/release',{sid:session.sid,lease_id,request_id,reason:'upstream_failed'});await response.body?.cancel();
          const code=response.headers.get('X-SMN-Error-Code');
          if(response.status===410&&['playback_superseded','playback_expired','session_expired'].includes(code))return deps.json({error:code},410);
          if(retryableSourceStatus(response.status)&&allocation.provider_id&&attempt<2){excluded.push(allocation.provider_id);continue}
          const failed=deps.json({error:lastServiceError||'upstream_unavailable'},response.status);
          if(response.status===416){
            // Retain only bounded range metadata, never provider error bodies,
            // cookies, redirects or the length of the replaced upstream body.
            const range=response.headers.get('content-range'),accept=response.headers.get('accept-ranges');
            if(/^bytes \*\/\d{1,20}$/i.test(range||''))failed.headers.set('content-range',range);
            if(/^(bytes|none)$/i.test(accept||''))failed.headers.set('accept-ranges',accept);
            if(request.method==='HEAD'){await failed.body?.cancel();return new Response(null,{status:416,headers:failed.headers})}
          }
          return failed;
        }
        if(startup){const elapsed=Date.now()-signalAt;deferPlaybackReport(ctx,()=>reportLiveResult(deps.directory,env,mediaSession,allocation,true,elapsed,'signal',{evidence:initialMediaEvidence(response)}));}
        attachPlaybackActivity(activityTask,{env,ctx,directory:deps.directory,session:mediaSession,lease_id,mediaKey:mediaSession.mediaKey});
        // Native clients load this master once, then refresh the signed media
        // playlist directly. Refreshing /live on every segment used to repeat
        // account allocation and retry logic, interrupting a healthy session.
        if(item.type==='live'&&item.ext==='m3u8'){
          await response.body?.cancel();
          return monitored(new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=8000000\n'+target.href+'\n',{headers:{'content-type':'application/vnd.apple.mpegurl','cache-control':'no-store'}}));
        }
        return monitored(response);
      }catch(error){lastFailure=502;lastServiceError=null;const cancelled=request.signal.aborted||['playback_superseded','playback_expired'].includes(error.message);if(startup&&!cancelled&&error.message!=='media_origin_unapproved')await reportLiveResult(deps.directory,env,mediaSession,allocation,false,Date.now()-signalAt);await privateCall('/release',{sid:session.sid,lease_id,request_id,reason:'upstream_failed'});if(cancelled)throw Error('playback_superseded');if(error.message!=='media_origin_unapproved'&&allocation.provider_id&&attempt<2){excluded.push(allocation.provider_id);continue}throw error}
      }
      return deps.json({error:lastServiceError||'live_signal_unavailable'},lastFailure||504);
    };
    try { const special=deps.exclusives?await deps.exclusives.xtream(req,env,ctx,authenticate):null;return special||await handleXtream(req,{authenticate,catalog,register,resolve,play,localLive:deps.exclusives?.liveXtream?.(env,ctx),adultPolicy:createAdultPolicy(catalog,rawCatalog.inspect),json:deps.json}); }
    catch(error) { if(req.signal.aborted||['playback_superseded','playback_expired'].includes(error.message))return deps.json({error:'playback_superseded'},410);if(error.status)return deps.json({error:error.message},error.status);return deps.json({error:['media_origin_unapproved','provider_unavailable','provider_inactive','panel_unavailable'].includes(error.message)?error.message:'xtream_unavailable'},502); }
  };
}

// Native players do not send the web player's heartbeat. Keep an open media
// response authorised and release its reservation when the client disconnects.
export function guardXtreamResponse(response, check, release, ctx, signal, expiresAt, {waitForRelease=true}={}) {
  if (!response.body) return response;
  const reader=response.body.getReader();let closed=false,checking=false,controller,timer,expiryTimer,cleanupTask,lastDemand=Date.now();
  const cleanup=()=>{
    if(cleanupTask)return cleanupTask;
    clearInterval(timer);clearTimeout(expiryTimer);signal?.removeEventListener('abort',onAbort);
    cleanupTask=Promise.resolve().then(release).catch(()=>{});ctx?.waitUntil?.(cleanupTask);return cleanupTask;
  };
  const stop=async(reason)=>{
    if(closed)return;closed=true;
    try{controller.error(reason instanceof Error?reason:Error('client_disconnected'))}catch{}
    // Release independently: upstream cancellation must not delay capacity cleanup.
    await Promise.allSettled([reader.cancel(reason),cleanup()]);
  };
  const onAbort=()=>{const task=stop(Error('client_disconnected'));ctx?.waitUntil?.(task)};
  const body=new ReadableStream({
    start(c){controller=c;
      if(signal?.aborted){onAbort();return}
      signal?.addEventListener('abort',onAbort,{once:true});
      if(Number.isFinite(expiresAt)){const remaining=expiresAt-Date.now();if(remaining<=0){void stop(Error('access_expired'));return}expiryTimer=setTimeout(()=>{const task=stop(Error('access_expired'));ctx?.waitUntil?.(task)},Math.min(remaining,2147483647));expiryTimer?.unref?.()}
      timer=setInterval(async()=>{
        if(closed||checking)return;
        if(Date.now()-lastDemand>45000){await stop(Error('stream_idle'));return}
        checking=true;
        try{if(!await check())await stop(Error('access_revoked'))}
        catch{await stop(Error('access_unavailable'))}
        finally{checking=false}
      },25000);
    },
    async pull(c){if(closed)return;lastDemand=Date.now();try{
      const next=await reader.read();if(closed)return;
      // A live source ending must reach the player even if capacity release stalls.
      // cleanup still clears timers and retains the exact release with waitUntil.
      if(next.done){closed=true;const released=cleanup();if(waitForRelease)await released;c.close()}else c.enqueue(next.value);
    }catch(error){await stop(error)}},
    async cancel(reason){if(closed)return;closed=true;await Promise.allSettled([reader.cancel(reason),cleanup()])}
  });
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}
