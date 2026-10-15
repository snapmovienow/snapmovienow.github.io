import {exclusiveURL} from './exclusive-catalog.mjs';
import {resolveGnula} from './gnula-source.mjs';

// Check the same-origin HLS resources the player actually needs, without
// downloading a complete film or reserving a customer's playback connection.
async function request(url,origin,options,range){
 let target=new URL(exclusiveURL(url));
 for(let hop=0;hop<4;hop++){
  if(target.origin!==origin)throw Error('media_origin_changed');
  const response=await options.fetcher(target.href,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0',...(range?{Range:range}:{})},signal:options.signal});
  if(response.status<300||response.status>=400){if(!response.ok){await response.body?.cancel();throw Error('media_unavailable');}return response;}
  const location=response.headers.get('location');await response.body?.cancel();if(!location)throw Error('media_redirect');target=new URL(exclusiveURL(new URL(location,target).href));
 }throw Error('media_redirect');
}
async function readSmall(response,max){
 const reader=response.body?.getReader();if(!reader)throw Error('media_empty');const chunks=[];let length=0;
 try{while(length<max){const {value,done}=await reader.read();if(done)break;const part=value.subarray(0,max-length);chunks.push(part);length+=part.length;}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const result=new Uint8Array(length);let at=0;for(const chunk of chunks){result.set(chunk,at);at+=chunk.length;}return result;
}
export async function inspectCatalogSource(media,{fetcher=fetch,resolver=resolveGnula,signal=AbortSignal.timeout(40000)}={}){
 try{
  let source=media.mode==='gnula'?await resolver(media.page,media.preferredEmbed||null,{fetcher,signal:AbortSignal.any([signal,AbortSignal.timeout(35000)])}):exclusiveURL(media.page);
  const origin=new URL(source).origin,options={fetcher,signal};
  for(let depth=0;depth<4;depth++){
   const response=await request(source,origin,options,'bytes=0-1048575'),type=response.headers.get('content-type')||'';
   if(!/mpegurl/i.test(type)&&!new URL(source).pathname.endsWith('.m3u8')){
    if(!/^(?:video\/|audio\/|application\/octet-stream)/i.test(type)){await response.body?.cancel();throw Error('media_not_video');}
    if((await readSmall(response,2048)).length<16)throw Error('media_empty');
    return {ok:true,check:'media_bytes'};
   }
   const text=new TextDecoder().decode(await readSmall(response,1000000));if(!text.trimStart().startsWith('#EXTM3U'))throw Error('invalid_playlist');
   const lines=text.split(/\r?\n/).map(line=>line.trim()),first=lines.findIndex(line=>line&&!line.startsWith('#')),child=lines[first];if(!child)throw Error('media_empty');
   const destination=new URL(exclusiveURL(new URL(child.trim(),source).href));if(destination.origin!==origin)throw Error('media_origin_changed');
   if(text.includes('#EXT-X-STREAM-INF')){source=destination.href;continue;}
   for(const match of lines.slice(0,first).join('\n').matchAll(/#EXT-X-(?:KEY|MAP):[^\n]*URI="([^"]+)"/g)){
    const resource=new URL(exclusiveURL(new URL(match[1],source).href));const extra=await request(resource.href,origin,options,'bytes=0-2047');
    if(/text\/html/i.test(extra.headers.get('content-type')||'')){await extra.body?.cancel();throw Error('media_not_video');}
    if((await readSmall(extra,2048)).length<16)throw Error('media_empty');
   }
   const segment=await request(destination.href,origin,options,'bytes=0-2047'),segmentType=segment.headers.get('content-type')||'';
   if(!/^(?:video\/|audio\/|application\/octet-stream)/i.test(segmentType)){await segment.body?.cancel();throw Error('media_not_video');}
   if((await readSmall(segment,2048)).length<16)throw Error('media_empty');
   return {ok:true,check:'playlist_and_segment'};
  }throw Error('playlist_depth');
 }catch{return {ok:false,check:'unavailable'};}
}
