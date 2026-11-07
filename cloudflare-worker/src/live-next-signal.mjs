import {readLivePlaylist} from './live-startup.mjs';

// Verify an HLS candidate using only URLs rewritten and signed by our relay.
// Cancel probes without releasing the viewer's still-current playback lease.
export async function confirmNextLiveSignal(response,{request,origin,deadline,open}){
 const controller=new AbortController(),signal=AbortSignal.any([request.signal,controller.signal]);
 const timer=setTimeout(()=>controller.abort(),Math.max(1,deadline-Date.now()));
 const target=value=>{const url=new URL(value,origin);if(url.origin!==origin||url.pathname!=='/stream'||!url.searchParams.has('t'))throw Error('invalid_playlist');return url;};
 const readBytes=async url=>{
  if(signal.aborted)throw Error('playback_superseded');
  const probe=await open(new Request(request,{method:'GET',headers:{Range:'bytes=0-2047'},signal}),url);
  let reader,bytes=0,timer;
  try{
   if(!probe.ok)throw Object.assign(Error('live_signal_unavailable'),{status:probe.status});
   reader=probe.body?.getReader();if(!reader)throw Error('media_empty');
   const expired=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('live_startup_timeout')),Math.max(1,deadline-Date.now()));});
   while(bytes<16){const next=await Promise.race([reader.read(),expired]);if(next.done)break;bytes+=next.value.byteLength;}
   if(bytes<16)throw Error('media_empty');
  }finally{clearTimeout(timer);if(reader)void reader.cancel().catch(()=>{});else void probe.body?.cancel().catch(()=>{});}
 };
 try{
  let playlist=response.clone();
  for(let depth=0;depth<4;depth++){
   if(signal.aborted)throw Error('playback_superseded');
   const text=await readLivePlaylist(playlist,deadline);if(!text.trimStart().startsWith('#EXTM3U'))throw Error('invalid_playlist');
   const lines=text.split(/\r?\n/).map(line=>line.trim()),entries=lines.flatMap((line,index)=>line&&!line.startsWith('#')?[{line,index}]:[]);
   const master=text.includes('#EXT-X-STREAM-INF'),selected=entries[master||lines.includes('#EXT-X-ENDLIST')?0:Math.max(0,entries.length-3)];
   if(!selected)throw Error('media_empty');
   if(master){playlist=await open(new Request(request,{method:'GET',signal}),target(selected.line));if(!playlist.ok){await playlist.body?.cancel();throw Object.assign(Error('live_signal_unavailable'),{status:playlist.status});}continue;}
   const active=new Map();
   for(const line of lines.slice(0,selected.index)){
    if(line.startsWith('#EXT-X-KEY:')){if(/(?:^|,)\s*METHOD=NONE\s*(?:,|$)/.test(line.slice(11)))active.delete('key');else active.set('key',line);}
    if(line.startsWith('#EXT-X-MAP:'))active.set('map',line);
   }
   for(const line of active.values()){const uri=line.slice(line.indexOf(':')+1).match(/(?:^|,)\s*URI="([^"]+)"/);if(!uri)throw Error('invalid_playlist');await readBytes(target(uri[1]));}
   await readBytes(target(selected.line));return;
  }
  throw Error('playlist_depth');
 }finally{clearTimeout(timer);controller.abort();}
}
