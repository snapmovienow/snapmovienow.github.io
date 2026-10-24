import {encodeCatalog,decodeCatalog} from './catalog-cache.mjs';
import {countSeriesEpisodes} from './xtream-series.mjs';
import {selectCatalogDetail} from './catalog-detail-race.mjs';
import {readProviderJSON} from './provider-request.mjs';
const catalogs = new WeakMap();
const MAX_CACHE_BYTES = 16 * 1024 * 1024;
export const CATALOG_FETCH_MS=8000;
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

const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export function validProviderReply(action,raw){
  if(raw?.user_info&&String(raw.user_info.auth)!=='1'||raw?.error)return false;
  if(action==='get_series_info')return object(raw)&&(raw.info===undefined||object(raw.info)||Array.isArray(raw.info)&&raw.info.length===0)&&(object(raw.episodes)||Array.isArray(raw.episodes));
  if(action==='get_vod_info')return object(raw)&&object(raw.movie_data);
  return true;
}

export function createProviderCatalog(deps, env, ctx,{timeoutMs=CATALOG_FETCH_MS,hedgeMs=750,cacheReadMs=500}={}) {
  // One deadline covers configuration, optional snapshots and source reads.
  // A cached hit may still be returned after that budget; it starts no traffic.
  const budget=Math.min(CATALOG_FETCH_MS,Math.max(1,timeoutMs)),cacheBudget=Math.max(1,Math.min(cacheReadMs,budget/4));
  let deadline,configuration;
  const start=()=>deadline??=Date.now()+budget;
  const readResponse=async(operation,consume,cap=budget)=>{
    start();const remaining=Math.min(cap,deadline-Date.now());if(remaining<=0)throw Error('catalog_timeout');
    const controller=new AbortController();let timer;
    const work=Promise.resolve().then(operation).then(response=>{
      if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw Error('catalog_timeout')}
      // Aborting the consumer also cancels a stalled cache body/decompression.
      const body=response.body?.pipeThrough(new TransformStream(),{signal:controller.signal});
      return consume(new Response(body,{status:response.status,headers:response.headers}));
    });
    try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('catalog_timeout'))},remaining)})])}
    finally{clearTimeout(timer);controller.abort()}
  };
  const scopeForRequest=()=>configuration??=readResponse(()=>deps.directory(env,'/providers'),async response=>{
    if(!response.ok)throw Error('provider_unavailable');
    const providers=await response.json();if(!providers.length)throw Error('provider_not_configured');
    return fingerprint(env.TICKET_SECRET,JSON.stringify(providers.map(p=>[p.source,p.origin,p.url,p.encrypted])));
  });
  const readSaved=(key,detail=false)=>readResponse(()=>deps.registry(env,'/xtream-cache-get',{key,...(detail?{kind:'detail'}:{})}),async response=>{
    if(!response.ok)return null;
    const savedAt=Number(response.headers.get('x-catalog-saved-at')),data=await decodeCatalog(response);
    return {data,savedAt,until:savedAt+(detail?30000:12*3600000)};
  },cacheBudget);
  const catalog=async (action, server, params={}, options={}) => {
      const within=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('catalog_timeout')),Math.max(1,deadline-Date.now()))})])}finally{clearTimeout(timer)}};
      // Read current authorized configuration once per incoming request, shared
      // by parallel category/title checks; never across user requests.
      const scope=await scopeForRequest();
      const key = await fingerprint(env.TICKET_SECRET, JSON.stringify([scope,action,server||'',params]));
      const list = ['get_live_categories','get_live_streams','get_vod_categories','get_vod_streams','get_series_categories','get_series'].includes(action);
      const detail=['get_series_info','get_vod_info'].includes(action),persist=list||detail;
      let cache = catalogs.get(env.PLAYBACK_SESSIONS);
      if (!cache) catalogs.set(env.PLAYBACK_SESSIONS,cache={entries:new Map(),pending:new Map(),bytes:0});
      const remember = (data,savedAt) => {
        const bytes=JSON.stringify(data).length*2;if(bytes>MAX_CACHE_BYTES)return;
        const old=cache.entries.get(key);if(old){cache.entries.delete(key);cache.bytes-=old.bytes}
        while(cache.entries.size&&(cache.entries.size>=64||cache.bytes+bytes>MAX_CACHE_BYTES)){const k=cache.entries.keys().next().value;cache.bytes-=cache.entries.get(k).bytes;cache.entries.delete(k)}
        cache.entries.set(key,{data,bytes,savedAt,until:savedAt+(detail?30000:12*3600000)});cache.bytes+=bytes;
      };
      let saved=cache.entries.get(key);
      if(saved?.until<=Date.now()){cache.entries.delete(key);cache.bytes-=saved.bytes;saved=null}
      // A server-specific permission check can reuse an already verified full
      // snapshot. It must never wait for unrelated providers or fetch it again.
      if(!saved&&server&&list){
        const allKey=await fingerprint(env.TICKET_SECRET,JSON.stringify([scope,action,'',params]));
        let all=cache.entries.get(allKey);
        if(all?.until<=Date.now())all=null;
        if(!all&&!options.memoryOnly)try{all=await readSaved(allKey)}catch{}
        if(all&&all.until>Date.now()&&Array.isArray(all.data)){const data=all.data.filter(row=>String(row._server||'ccf')===String(server));remember(data,all.savedAt);saved={data,savedAt:all.savedAt,until:all.until}}
      }
      if(!saved&&persist&&!options.memoryOnly){
        try{const retained=await readSaved(key,detail);if(retained){remember(retained.data,retained.savedAt);saved=retained}}catch{}
      }
      const freshFor=list?300000:30000;
      if(detail&&saved&&saved.savedAt<=Date.now()-freshFor)saved=null;
      // Activity labels must not trigger provider traffic or delay a stream.
      if(options.cachedOnly)return saved?.data||null;
      if(!options.fresh&&saved&&saved.savedAt>Date.now()-freshFor)return saved.data;
      const refresh=async()=>{
        const credentials=await within(deps.catalogCredentials(env,server,ctx));
        if(!credentials.length)throw Error('server_unavailable');
        const groups=new Map();for(const account of credentials){if(!groups.has(account.server))groups.set(account.server,[]);groups.get(account.server).push(account)}
        let fresh=0;const replies=await Promise.all([...groups].map(async([id,accounts])=>{
          const safe=await selectCatalogDetail(accounts,async(account,signal)=>{
              const url=new URL(account.origin+'/player_api.php');
              url.searchParams.set('username',account.username);url.searchParams.set('password',account.password);url.searchParams.set('action',action);
              for(const [name,value]of Object.entries(params))url.searchParams.set(name,String(value));
              const requestSignal=AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.min(6000,timeoutMs*.75,deadline-Date.now())))]);
              // The existing cache limit is a retention limit, not a provider
              // reply limit. Preserve large catalogs while bounding their
              // whole read by the existing catalog request deadline.
              const raw=await readProviderJSON(url,{signal:requestSignal,timeoutMs:Math.max(1,Math.min(6000,timeoutMs*.75,deadline-Date.now())),directCcfEntry:env.CCF_ENTRY_TRANSPORT==='tcp',maxBytes:Infinity});
              if(list&&!Array.isArray(raw)||!validProviderReply(action,raw))return null;
              const data=publicMetadata(raw,account),scoped=Array.isArray(data)?data.map(item=>({...item,_server:id})):data;
              return {data:scoped,empty:Array.isArray(scoped)?!scoped.length:action==='get_series_info'&&!countSeriesEpisodes(scoped)};
            },{hedgeMs,timeoutMs:Math.max(0,deadline-Date.now()),maxConcurrent:2});
          if(safe!==null){fresh++;return safe}
          const retained=Array.isArray(saved?.data)?saved.data.filter(row=>row._server===id):null;
          return retained?.length?retained:null;
        }));
        const good=replies.filter(x=>x!==null);if(!good.length||!fresh)throw Error('upstream_unavailable');
        const data=good.every(Array.isArray)?good.flat():good[0];
        const savedAt=fresh===groups.size?Date.now():saved?.savedAt||Date.now();remember(data,savedAt);
        if(persist&&fresh===groups.size){const save=async()=>{try{const bytes=await encodeCatalog(data);let content='';for(let i=0;i<bytes.length;i+=24000)content+=String.fromCharCode(...bytes.slice(i,i+24000));await deps.registry(env,'/xtream-cache-put',{key,content:btoa(content),...(detail?{kind:'detail',savedAt}:{})})}catch{}};if(ctx?.waitUntil)ctx.waitUntil(save());else await within(save()).catch(()=>{})}
        return data;
      };
      const run=()=>{start();if(deadline<=Date.now())return Promise.reject(Error('catalog_timeout'));if(!cache.pending.has(key)){const work=refresh().finally(()=>cache.pending.delete(key));cache.pending.set(key,work);return work}return within(cache.pending.get(key))};
      // Old-but-valid snapshots are immediate while refresh runs in the
      // background. Local user permissions were already checked by handleXtream.
      if(!options.fresh&&saved&&list&&ctx?.waitUntil){ctx.waitUntil(run().catch(()=>{}));return saved.data}
      try{return await run()}catch(error){if(saved&&list)return saved.data;throw error}
    };
  catalog.inspect=async(kind,server,id)=>{
    const spec={live:['get_live_streams','get_live_categories','stream_id'],movie:['get_vod_streams','get_vod_categories','stream_id'],series_list:['get_series','get_series_categories','series_id']}[kind];
    if(!spec)return undefined;
    const scope=await scopeForRequest();
    const keys=action=>Promise.all([String(server||'ccf'),''].map(s=>fingerprint(env.TICKET_SECRET,JSON.stringify([scope,action,s,{}]))));
    const [rowKeys,categoryKeys]=await Promise.all([keys(spec[0]),keys(spec[1])]);
    try{return await readResponse(()=>deps.registry(env,'/xtream-cache-inspect',{rowKeys,categoryKeys,idField:spec[2],server:String(server||'ccf'),id:String(id)}),async response=>{if(!response.ok)return undefined;const decision=await response.json();return decision.found?{_adult:decision.adult===true}:null},cacheBudget)}catch{return undefined}
  };
  return catalog;
}
