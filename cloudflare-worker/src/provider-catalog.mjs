import {encodeCatalog,decodeCatalog} from './catalog-cache.mjs';
const catalogs = new WeakMap();
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
const encoder = new TextEncoder();
export async function fingerprint(secret, value) {
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

export function createProviderCatalog(deps, env, ctx) {
  return async (action, server, params={}) => {
      const providers = await (await deps.directory(env,'/providers')).json();
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
}
