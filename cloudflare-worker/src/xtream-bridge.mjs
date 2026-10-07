import {handleXtream} from './xtream.mjs';
import {encodeCatalog,decodeCatalog} from './catalog-cache.mjs';

const catalogs = new WeakMap();
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();
async function fingerprint(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))), x=>x.toString(16).padStart(2,'0')).join('');
}

// Responses from the provider can contain credentials and direct playback URLs.
export function publicMetadata(value, credentials) {
  if (Array.isArray(value)) return value.map(item=>publicMetadata(item, credentials));
  if (value && typeof value === 'object') {
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (['direct_source','stream_url','stream_source','source','url','username','password','user_info','server_info','custom_sid','_server'].includes(key)) continue;
      output[key] = publicMetadata(item, credentials);
    }
    return output;
  }
  if (typeof value === 'string' && /^(?:https?:)?\/\//i.test(value)) {
    let url; try {url = new URL(value, credentials.origin)} catch {return ''}
    if (url.origin === credentials.origin || url.username || url.password || /(?:username|password)=/i.test(url.search) || /\/(?:movie|live|series)\//.test(url.pathname)) return '';
    for (const secret of [credentials.username, credentials.password]) if (secret && (value.includes(secret) || value.includes(encodeURIComponent(secret)))) return '';
  }
  return value;
}

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
    const catalog = async (action, server, params={}) => {
      const providers = await (await privateCall('/providers')).json();
      if (!providers.length) throw Error('provider_not_configured');
      // Changing or removing a connection changes this scope. A cached catalog
      // never survives removal of its authorised provider configuration.
      const scope = await fingerprint(env.TICKET_SECRET, JSON.stringify(providers.map(p=>[p.source,p.origin,p.url,p.encrypted])));
      const key = await fingerprint(env.TICKET_SECRET, JSON.stringify([scope,action,server||'',params]));
      const persist = ['get_live_categories','get_live_streams','get_vod_categories','get_vod_streams','get_series_categories','get_series'].includes(action);
      let cache = catalogs.get(env.PLAYBACK_SESSIONS);
      if (!cache) catalogs.set(env.PLAYBACK_SESSIONS,cache={entries:new Map(),pending:new Map(),bytes:0});
      const remember = (data,savedAt) => {
        const bytes=JSON.stringify(data).length*2;if(bytes>MAX_CACHE_BYTES)return;
        const old=cache.entries.get(key);if(old){cache.entries.delete(key);cache.bytes-=old.bytes}
        while(cache.entries.size&&(cache.entries.size>=64||cache.bytes+bytes>MAX_CACHE_BYTES)){const k=cache.entries.keys().next().value;cache.bytes-=cache.entries.get(k).bytes;cache.entries.delete(k)}
        cache.entries.set(key,{data,bytes,savedAt,until:savedAt+12*3600000});cache.bytes+=bytes;
      };
      let saved=cache.entries.get(key);
      if(saved?.until<=Date.now()){cache.entries.delete(key);cache.bytes-=saved.bytes;saved=null}
      if(!saved&&persist){
        try{const response=await deps.registry(env,'/xtream-cache-get',{key});if(response.ok){const savedAt=Number(response.headers.get('x-catalog-saved-at'));const data=await decodeCatalog(response);remember(data,savedAt);saved={data,savedAt,until:savedAt+12*3600000}}}catch{}
      }
      const freshFor=persist?300000:30000;
      if(saved&&saved.savedAt>Date.now()-freshFor)return saved.data;
      const refresh=async()=>{
        const credentials=await deps.catalogCredentials(env,server,ctx);
        if(!credentials.length)throw Error('server_unavailable');
        const groups=new Map();for(const account of credentials){if(!groups.has(account.server))groups.set(account.server,[]);groups.get(account.server).push(account)}
        let fresh=0;const replies=await Promise.all([...groups].map(async([id,accounts])=>{
          for(const account of accounts){
            const url=new URL(account.origin+'/player_api.php');
            url.searchParams.set('username',account.username);url.searchParams.set('password',account.password);url.searchParams.set('action',action);
            for(const [name,value]of Object.entries(params))url.searchParams.set(name,String(value));
            try{
              const response=await fetch(url,{headers:{'User-Agent':'SnapMovieNow/1.0'},signal:AbortSignal.timeout(12000)});
              if(!response.ok){await response.body?.cancel();continue}
              const raw=await response.json();
              // Authentication/error objects are never mistaken for lists.
              if(persist&&!Array.isArray(raw))continue;
              const safe=publicMetadata(raw,account);fresh++;
              return Array.isArray(safe)?safe.map(item=>({...item,_server:id})):safe;
            }catch{}
          }
          const retained=Array.isArray(saved?.data)?saved.data.filter(row=>row._server===id):null;
          return retained?.length?retained:null;
        }));
        const good=replies.filter(x=>x!==null);if(!good.length||!fresh)throw Error('upstream_unavailable');
        const data=good.every(Array.isArray)?good.flat():good[0];
        remember(data,fresh===groups.size?Date.now():saved?.savedAt||Date.now());
        if(persist&&fresh===groups.size){try{const bytes=await encodeCatalog(data);let content='';for(let i=0;i<bytes.length;i+=24000)content+=String.fromCharCode(...bytes.slice(i,i+24000));await deps.registry(env,'/xtream-cache-put',{key,content:btoa(content)})}catch{}}
        return data;
      };
      const run=()=>{if(!cache.pending.has(key)){const work=refresh().finally(()=>cache.pending.delete(key));cache.pending.set(key,work)}return cache.pending.get(key)};
      // Old-but-valid snapshots are immediate while refresh runs in the
      // background. Local user permissions were already checked by handleXtream.
      if(saved&&ctx?.waitUntil){ctx.waitUntil(run().catch(()=>{}));return saved.data}
      try{return await run()}catch(error){if(saved&&persist)return saved.data;throw error}
    };
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
      const excluded=[];let lastFailure=null;
      for(let attempt=0;attempt<3;attempt++){
      const request_id=crypto.randomUUID();
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
    try { return await handleXtream(req,{authenticate,catalog,register,resolve,play,json:deps.json}); }
    catch(error) { return deps.json({error:['media_origin_unapproved','provider_unavailable','provider_inactive','panel_unavailable'].includes(error.message)?error.message:'xtream_unavailable'},502); }
  };
}

// Native players do not send the web player's heartbeat. Keep an open media
// response authorised and release its reservation when the client disconnects.
export function guardXtreamResponse(response, check, release, ctx) {
  if (!response.body) return response;
  const reader=response.body.getReader();let closed=false,checking=false,controller,timer;
  const cleanup=async()=>{clearInterval(timer);const task=Promise.resolve(release()).catch(()=>{});ctx?.waitUntil?.(task);await task};
  const body=new ReadableStream({
    start(c){controller=c;timer=setInterval(async()=>{
      if(closed||checking)return;checking=true;
      try{if(!await check()){closed=true;controller.error(Error('access_revoked'));await reader.cancel();await cleanup()}}
      catch{if(!closed){closed=true;controller.error(Error('access_unavailable'));await reader.cancel().catch(()=>{});await cleanup()}}
      finally{checking=false}
    },25000)},
    async pull(c){if(closed)return;try{const next=await reader.read();if(closed)return;if(next.done){closed=true;await cleanup();c.close()}else c.enqueue(next.value)}catch(error){if(!closed){closed=true;await cleanup();c.error(error)}}},
    async cancel(reason){if(closed)return;closed=true;await reader.cancel(reason).catch(()=>{});await cleanup()}
  });
  return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
}
