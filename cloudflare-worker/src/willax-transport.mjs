import {fetchWillaxMediaIP} from './ip-media.mjs';
import {isWillaxMediaURL} from './willax-live.mjs';

// Only the station-specific caller uses this adapter, after session, catalog
// and media-scope authorization. It never follows redirects on the caller's
// behalf: the normal HLS path validates every next URL before calling again.
export function willaxMediaFetcher(fetcher=fetch,{connectSocket,nativeStreamFactory,fetchIP=fetchWillaxMediaIP}={}){
 return async(value,options={})=>{
  const method=String(options.method||'GET').toUpperCase();
  if(!['GET','HEAD'].includes(method)||options.body!==undefined&&options.body!==null)throw Error('invalid_media_method');
  const target=new URL(value);
  if(target.protocol==='https:')return fetcher(value,{...options,method,redirect:'manual'});
  if(!isWillaxMediaURL(value))throw Error('invalid_media_origin');
  const response=await fetchIP(value,new Headers(options.headers),connectSocket,nativeStreamFactory,null,undefined,options.signal);
  if(method!=='HEAD')return response;
  await response.body?.cancel();
  return new Response(null,{status:response.status,statusText:response.statusText,headers:response.headers});
 };
}
