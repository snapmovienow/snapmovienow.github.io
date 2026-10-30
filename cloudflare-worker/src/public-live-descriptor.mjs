// Only small, anonymous PUBLIC player descriptors are cached, never Responses,
// customer grants, manifests, segments, Quickplay devices or playback sessions.
const scopes=new WeakMap(),TTL=60000,LIMIT=64;
const validValue=(key,value)=>key.startsWith('gray-page:')?value===true:typeof value==='string'&&value.length<16384;
async function edgeEntry(key,options){
 // Only the default production adapter uses this PUBLIC metadata cache.
 // Injected adapters and all private anonymous-device contexts stay isolated.
 if(options.fetcher||!globalThis.caches?.open)return null;
 try{const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(key))),n=>n.toString(16).padStart(2,'0')).join('');return {cache:await caches.open('smn-public-live-descriptors-v1'),request:new Request('https://api.snaptvnow.com/.well-known/public-live-descriptor/'+hash)};}catch{return null}
}
export async function publicLiveDescriptor(key,load,options={}){
 const scope=options.fetcher||fetch;if(!options.cachePublicPages)return load();
 if(options.signal?.aborted)throw options.signal.reason||Error('playback_superseded');
 let values=scopes.get(scope);if(!values)scopes.set(scope,values=new Map());
 const now=Date.now();for(const [id,value]of values)if(value.until<=now)values.delete(id);
 const cached=values.get(key);if(cached)return cached.value;
 const edge=await edgeEntry(key,options);if(edge){try{const response=await edge.cache.match(edge.request),data=response?await response.json():null;if(data&&data.until>Date.now()&&data.until<=Date.now()+TTL&&validValue(key,data.value)){if(values.size>=LIMIT)values.delete(values.keys().next().value);values.set(key,data);return data.value;}}catch{}}
 const value=await load();if(options.signal?.aborted)throw options.signal.reason||Error('playback_superseded');
 if(values.size>=LIMIT)values.delete(values.keys().next().value);const data={value,until:Date.now()+TTL};values.set(key,data);if(edge&&validValue(key,value))try{await edge.cache.put(edge.request,Response.json(data,{headers:{'Cache-Control':'public, max-age=60'}}))}catch{}return value;
}
export async function forgetPublicLiveDescriptor(key,options={}){scopes.get(options.fetcher||fetch)?.delete(key);const edge=await edgeEntry(key,options);if(edge)try{await edge.cache.delete(edge.request)}catch{}}
export async function readPublicLiveDescriptor(url,parse,{fetcher=fetch,signal,headers={},maxBytes=3000000}={}){
 const response=await fetcher(url,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0',...headers},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(18000)]):AbortSignal.timeout(18000)});
 if(!response.ok){await response.body?.cancel();throw Error('official_live_unavailable');}
 const reader=response.body?.getReader();if(!reader)throw Error('official_live_unavailable');const decoder=new TextDecoder();let tail='',size=0;
 try{for(;;){const {done,value}=await reader.read();if(done){const found=parse(tail+decoder.decode());if(found!==null&&found!==undefined)return found;break;}size+=value.length;if(size>maxBytes)throw Error('official_live_unavailable');
  const text=tail+decoder.decode(value,{stream:true}),found=parse(text);if(found!==null&&found!==undefined)return found;
  // Keep enough overlap for a split JSON/HTML attribute without buffering a page.
  tail=text.slice(-16384);
 }}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 throw Error('official_live_unavailable');
}
