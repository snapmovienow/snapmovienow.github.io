import {isApprovedMediaIP} from './ip-media.mjs';
// Independent, prefix-only HTTP control for the owner's diagnostic. It does
// not use the relay's body parser, buffering, native transforms or recovery.
export async function fetchControlMediaIP(value,headers,connectSocket,unused,sourceOrigin,deadline){
 const url=new URL(value);if(!isApprovedMediaIP(url,sourceOrigin))throw Error('invalid_media_origin');
 const connect=connectSocket||(await import('cloudflare:sockets')).connect,socket=connect({hostname:url.hostname,port:Number(url.port||80)},{secureTransport:'off'});socket.closed.catch(()=>{});
 let reader,timer;const expired=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('control_timeout')),Math.max(1,Math.min(8000,(deadline||Date.now()+8000)-Date.now())))}),within=p=>Promise.race([p,expired]);
 try{
  await within(socket.opened);const writer=socket.writable.getWriter(),lines=['GET '+url.pathname+url.search+' HTTP/1.0','Host: '+url.host,'User-Agent: SnapMovieNow/1.0','Accept: */*','Accept-Encoding: identity','Connection: close'];
  for(const key of ['range','if-range'])if(headers.has(key)){const item=headers.get(key);if(/[\r\n]/.test(item))throw Error('invalid_http_header');lines.push(key+': '+item)}
  await within(writer.write(new TextEncoder().encode(lines.join('\r\n')+'\r\n\r\n')));writer.releaseLock();reader=socket.readable.getReader();let buffer=new Uint8Array(),ended=false;
  const more=async()=>{const next=await within(reader.read());if(next.done){ended=true;return false}const joined=new Uint8Array(buffer.length+next.value.length);joined.set(buffer);joined.set(next.value,buffer.length);buffer=joined;return true};
  const line=async()=>{for(;;){for(let i=0;i+1<buffer.length;i++)if(buffer[i]===13&&buffer[i+1]===10){const text=new TextDecoder().decode(buffer.subarray(0,i));buffer=buffer.subarray(i+2);return text}if(buffer.length>65536||ended)throw Error('invalid_http_control');await more()}};
  let status,head;for(let interim=0;interim<4;interim++){
   const match=(await line()).match(/^HTTP\/1\.[01] (\d{3})\b/);if(!match)throw Error('invalid_http_control');status=Number(match[1]);head=new Headers();let size=0;
   for(;;){const text=await line();if(!text)break;size+=text.length;if(size>65536)throw Error('invalid_http_control');const at=text.indexOf(':');if(at<1)throw Error('invalid_http_control');head.append(text.slice(0,at),text.slice(at+1).trim())}
   if(status>=200)break;
  }
  if(status<200||status>599)throw Error('invalid_http_control');
  const out=new Headers();for(const key of ['content-type','location'])if(head.has(key))out.set(key,head.get(key));
  if(status>=300||[204,205].includes(status))return new Response(null,{status,headers:out});
  let prefix;
  if(/\bchunked\b/i.test(head.get('transfer-encoding')||'')){
   const parts=[];let size=0;while(size<16){const raw=(await line()).split(';')[0];if(!/^[0-9a-f]+$/i.test(raw))throw Error('invalid_http_control');let left=Number.parseInt(raw,16);if(!Number.isSafeInteger(left))throw Error('invalid_http_control');if(!left)break;
    while(left&&size<16){if(!buffer.length&&!await more())throw Error('truncated_http_control');const take=Math.min(left,buffer.length,65536-size);parts.push(buffer.slice(0,take));buffer=buffer.subarray(take);left-=take;size+=take}
    if(size<16&&await line()!=='')throw Error('invalid_http_control');
   }
   prefix=new Uint8Array(size);let at=0;for(const part of parts){prefix.set(part,at);at+=part.length}
  }else{const length=head.has('content-length')?Number(head.get('content-length')):Infinity;if(length<0||Number.isNaN(length))throw Error('invalid_http_control');while(buffer.length<Math.min(16,length)&&await more()){}prefix=buffer.slice(0,Math.min(length,65536));}
  return new Response(prefix,{status,headers:out});
 }finally{clearTimeout(timer);void reader?.cancel().catch(()=>{});void socket.close().catch(()=>{})}
}
