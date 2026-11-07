import {readLivePlaylist} from './live-startup.mjs';

// Inspect a small prefix without losing or reordering the viewer's bytes.
// Cancelling the clone leaves the original stream and its lease intact.
export async function confirmNextLiveBytes(response,deadline){
 if(/text\/|json|html/i.test(response.headers.get('content-type')||''))throw Error('invalid_media');
 const reader=response.clone().body?.getReader();if(!reader)throw Error('media_empty');
 let timer,bytes=0;const chunks=[];
 try{
  const expired=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('live_startup_timeout')),Math.max(1,deadline-Date.now()));});
  while(bytes<16){const next=await Promise.race([reader.read(),expired]);if(next.done)break;const part=next.value.subarray(0,64-bytes);chunks.push(part);bytes+=part.length;}
  if(bytes<16)throw Error('media_empty');
  const sample=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){sample.set(chunk,offset);offset+=chunk.length;}
  const box=String.fromCharCode(...sample.subarray(4,8));
  if(!(sample[0]===0x47&&(sample[3]&0x30)!==0||['ftyp','styp','moov','moof','mdat','sidx'].includes(box)||sample[0]===0x1a&&sample[1]===0x45&&sample[2]===0xdf&&sample[3]===0xa3))throw Error('invalid_media');
 }finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
}

// Verify an HLS candidate using only URLs rewritten and signed by our relay.
// Cancel probes without releasing the viewer's still-current playback lease.
export async function confirmNextLiveSignal(response,{request,origin,deadline,open}){
 const controller=new AbortController(),signal=AbortSignal.any([request.signal,controller.signal]);
 const timer=setTimeout(()=>controller.abort(),Math.max(1,deadline-Date.now()));
 const target=value=>{const url=new URL(value,origin);if(url.origin!==origin||url.pathname!=='/stream'||!url.searchParams.has('t'))throw Error('invalid_playlist');return url;};
 const readBytes=async(url,kind='media')=>{
  if(signal.aborted)throw Error('playback_superseded');
  const probe=await open(new Request(request,{method:'GET',headers:{Range:'bytes=0-2047'},signal}),url);
  let reader,bytes=0,timer;
  try{
   if(!probe.ok)throw Object.assign(Error('live_signal_unavailable'),{status:probe.status});
   if(kind!=='key'&&/html|json/i.test(probe.headers.get('content-type')||''))throw Error('invalid_media');
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
   for(const [kind,line] of active){const uri=line.slice(line.indexOf(':')+1).match(/(?:^|,)\s*URI="([^"]+)"/);if(!uri)throw Error('invalid_playlist');await readBytes(target(uri[1]),kind);}
   await readBytes(target(selected.line));return;
  }
  throw Error('playlist_depth');
 }finally{clearTimeout(timer);controller.abort();}
}
