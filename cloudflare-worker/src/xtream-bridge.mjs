import {handleXtream} from './xtream.mjs';

import {createProviderCatalog,fingerprint} from './provider-catalog.mjs';
import {createAdultPolicy} from './content-permissions.mjs';
export {publicMetadata} from './provider-catalog.mjs';

export function createXtreamBridge(deps) {
  return async function xtreamRequest(req, env, ctx) {
    const privateCall = (path, body) => deps.directory(env, path, body);
    const client = req.headers.get('CF-Connecting-IP') || 'unknown';
    const authenticate = async (username, password) => {
      const settings = await (await privateCall('/xtream-config')).json();
      if (!settings.enabled) return deps.json({user_info:{auth:0},error:'xtream_disabled'},403);
      const authKey = await fingerprint(env.TICKET_SECRET, JSON.stringify([username.toLowerCase(),password,client,req.headers.get('user-agent')||'']));
      const checked = await privateCall('/xtream-login',{username,password,client,authKey});
      if (!checked.ok) return deps.json({user_info:{auth:0},...await checked.json()},checked.status);
      const user = await checked.json();
      const sid = 'xtream:'+await fingerprint(env.TICKET_SECRET,JSON.stringify([authKey,user.version,settings.version]));
      const identity = {uid:user.id,username:user.username,version:user.version,admin:false,xtream:true,xtreamVersion:settings.version};
      const exp = Math.min(Date.now()+12*3600000,user.expiresAt||Infinity);
      const ensured = await deps.sessionCall(env,sid,'/ensure',{exp,identity});
      if (!ensured.ok) return deps.json({error:'session_unavailable'},503);
      const session = {kind:'session',managed:true,sid,exp:(await ensured.json()).exp,permissions:user.permissions,...identity};
      const count = await (await privateCall('/xtream-count',{uid:user.id})).json();
      return {user,session,username:user.username,connections:count.connections};
    };
    const catalog = createProviderCatalog(deps, env, ctx);
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
      const request_id=crypto.randomUUID();
      const begun=await privateCall('/playback-begin',{sid:session.sid,request_id});if(!begun.ok)return deps.json(await begun.json(),begun.status);
      const excluded=[];let lastFailure=null;
      for(let attempt=0;attempt<3;attempt++){
      const mediaSession={...session,request_id,mediaKey:item.type+'|'+item.server+'|'+item.upstreamId+'|'+item.ext};
      const allocation=await deps.managedPlayback(env,mediaSession,item.server,ctx,excluded);
      if(!allocation.r.ok){if(lastFailure&&allocation.r.status===409)return deps.json({error:'upstream_unavailable'},lastFailure);return deps.json(await allocation.r.json(),allocation.r.status)}
      const {lease_id}=await allocation.r.json(),credentials=allocation.credentials;
      const encrypted=await deps.ticket(env,{sid:session.sid,username:credentials.username,password:credentials.password,origin:credentials.origin,lease_id,request_id,xtream:true,type:item.type,id:item.upstreamId,ext:item.ext,exp:session.exp});
      const target=new URL('/stream',request.url);target.searchParams.set('t',encrypted);
      try{
        const prepared=new Request(request);if(item.type==='live'&&item.ext==='m3u8')prepared.headers.set('X-SMN-Prepare','1');
        const response=await deps.serverStream(prepared,env,target,ctx);
        if(!response.ok){lastFailure=response.status;await response.body?.cancel();await privateCall('/release',{sid:session.sid,lease_id,request_id});if([401,403,404,408,429,502,503,504].includes(response.status)&&allocation.provider_id&&attempt<2){excluded.push(allocation.provider_id);continue}return deps.json({error:'upstream_unavailable'},response.status)}
        // Native clients load this master once, then refresh the signed media
        // playlist directly. Refreshing /live on every segment used to repeat
        // account allocation and retry logic, interrupting a healthy session.
        if(item.type==='live'&&item.ext==='m3u8'){
          await response.body?.cancel();
          return new Response('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=8000000\n'+target.href+'\n',{headers:{'content-type':'application/vnd.apple.mpegurl','cache-control':'no-store'}});
        }
        return response;
      }catch(error){lastFailure=502;await privateCall('/release',{sid:session.sid,lease_id,request_id});if(error.message!=='media_origin_unapproved'&&allocation.provider_id&&attempt<2){excluded.push(allocation.provider_id);continue}throw error}
      }
    };
    try { return await handleXtream(req,{authenticate,catalog,register,resolve,play,adultPolicy:createAdultPolicy(catalog),json:deps.json}); }
    catch(error) { return deps.json({error:['media_origin_unapproved','provider_unavailable','provider_inactive','panel_unavailable'].includes(error.message)?error.message:'xtream_unavailable'},502); }
  };
}

// Native players do not send the web player's heartbeat. Keep an open media
// response authorised and release its reservation when the client disconnects.
export function guardXtreamResponse(response, check, release, ctx, signal, expiresAt) {
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
      if(next.done){closed=true;await cleanup();c.close()}else c.enqueue(next.value);
    }catch(error){await stop(error)}},
    async cancel(reason){if(closed)return;closed=true;await Promise.allSettled([reader.cancel(reason),cleanup()])}
  });
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}
