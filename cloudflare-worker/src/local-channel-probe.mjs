const ORIGIN='https://api.snaptvnow.com';
const fail=(reason,status)=>Object.assign(Error(reason),Number.isInteger(status)?{status}:{});
const safeURL=value=>{const u=new URL(value);if(u.origin!==ORIGIN||u.pathname!=='/exclusive-media'||!u.searchParams.get('t')||u.username||u.password||u.hash)throw fail('route_scope');return u.href;};
async function small(response,limit){
 const reader=response.body?.getReader();if(!reader)throw fail('empty_media');let size=0;const chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;const chunk=value.subarray(0,limit-size);chunks.push(chunk);size+=chunk.length;if(size>=limit)break;}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return bytes;
}
// This test uses a fresh short-lived owner canary session and the same signed
// HLS handler as customer playback. It never consumes a customer's connection.
export async function probeLocalChannel(row,{signal},deps){
 let session,requests=0;
 try{
  session=await deps.authenticate(signal);
  const prepared=await deps.prepare(session,row,signal);
  const open=async(value,range)=>{
   if(signal.aborted)throw new DOMException('Timeout','AbortError');if(++requests>10)throw fail('playlist_depth');
   const response=await deps.request(new Request(safeURL(value),{headers:{'User-Agent':'SNAPTVNOW-Local-Audit/1',...(range?{Range:'bytes=0-65535'}:{})},signal}));
   if(!response.ok){const status=response.status;await response.body?.cancel();throw fail(status===409?'test_account_busy':'media_unavailable',status);}
   return response;
  };
  const branch=async(value,depth=0,inspectAudio=true)=>{
   if(depth>3)throw fail('playlist_depth');const response=await open(value,false),type=response.headers.get('content-type')||'';
   if(!/mpegurl/i.test(type)){
    if(!/^(?:video\/|audio\/|application\/octet-stream)/i.test(type)){await response.body?.cancel();throw fail('media_not_video');}
    if((await small(response,65536)).length<188)throw fail('empty_media');return;
   }
   const bytes=await small(response,262144),text=new TextDecoder().decode(bytes);if(bytes.length===262144||!text.trimStart().startsWith('#EXTM3U'))throw fail('invalid_playlist');
   const lines=text.split(/\r?\n/).map(line=>line.trim()),uris=lines.filter(line=>line&&!line.startsWith('#'));
   // Match a normal live player's three-segment synchronization distance. The
   // oldest entry in a rolling window may expire before its URL is requested.
   const uri=text.includes('#EXT-X-STREAM-INF')||text.includes('#EXT-X-ENDLIST')?uris[0]:uris[Math.max(0,uris.length-3)];if(!uri)throw fail('empty_media');
   const target=safeURL(new URL(uri,value).href);
   if(text.includes('#EXT-X-STREAM-INF')){
    await branch(target,depth+1,false);
    const audio=inspectAudio&&lines.find(line=>line.startsWith('#EXT-X-MEDIA:')&&/TYPE=AUDIO(?:,|$)/.test(line))?.match(/URI="([^"]+)"/)?.[1];
    if(audio)await branch(safeURL(new URL(audio,value).href),depth+1,false);
    return;
   }
   const preceding=lines.slice(0,lines.indexOf(uri)).join('\n'),resources=new Map();
   for(const line of preceding.split('\n')){if(line.startsWith('#EXT-X-KEY:')&&/METHOD=NONE(?:,|$)/.test(line))resources.delete('KEY');const match=line.match(/#EXT-X-(KEY|MAP):[^\n]*URI="([^"]+)"/);if(match)resources.set(match[1],match[2]);}
   for(const resource of resources.values()){
    const extra=await open(new URL(resource,value).href,true);if(/text\/html/i.test(extra.headers.get('content-type')||'')){await extra.body?.cancel();throw fail('media_not_video');}if((await small(extra,65536)).length<16)throw fail('empty_media');
   }
   const segment=await open(target,true),segmentType=segment.headers.get('content-type')||'';
   if(!/^(?:video\/|audio\/|application\/octet-stream)/i.test(segmentType)){await segment.body?.cancel();throw fail('media_not_video');}
   if((await small(segment,65536)).length<188)throw fail('empty_media');
  };
  await branch(safeURL(prepared.url));return {ok:true,check:'signed_playlist_and_segment',requests};
 }catch(error){
  const reason=signal.aborted||['TimeoutError','AbortError'].includes(error?.name)?'verification_timeout':error?.status===409?'test_account_busy':error?.message==='empty_media'?'media_empty':['route_scope','media_not_video','invalid_playlist','media_unavailable'].includes(error?.message)?error.message:'verification_failed';
  return {ok:false,reason,...(Number.isInteger(error?.status)?{httpStatus:error.status}:{})};
 }finally{if(session)await deps.release(session).catch(()=>{});}
}
