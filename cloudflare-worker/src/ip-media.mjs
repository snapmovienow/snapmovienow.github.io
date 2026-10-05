// Dedicated transport for the explicitly authorized CCF live origin.
// Never accepts arbitrary IP destinations or user supplied resource URLs.
export function isApprovedMediaIP(u){
 return u.protocol==='http:'&&['192.101.68.144','23.153.217.88','194.147.150.141'].includes(u.hostname)&&(!u.port||u.port==='80')&&!u.username&&!u.password;
}
export async function fetchApprovedMediaIP(value,headers,connectSocket){
 const url=new URL(value);if(!isApprovedMediaIP(url))throw Error('invalid_media_origin');
 const connect=connectSocket||(await import('cloudflare:sockets')).connect;
 const socket=connect({hostname:url.hostname,port:80},{secureTransport:'off'});
 socket.closed.catch(()=>{});
 const timed=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('media_timeout')),20000)})])}finally{clearTimeout(timer)}};
 let reader;
 try{
 await timed(socket.opened);
 const writer=socket.writable.getWriter();
 const lines=['GET '+url.pathname+url.search+' HTTP/1.1','Host: '+url.hostname,'User-Agent: SnapMovieNow/1.0','Accept: */*','Accept-Encoding: identity','Connection: close'];
 for(const name of ['range','if-range'])if(headers.has(name)){const value=headers.get(name);if(/[\r\n]/.test(value))throw Error('invalid_header');lines.push(name+': '+value)}
 await timed(writer.write(new TextEncoder().encode(lines.join('\r\n')+'\r\n\r\n')));writer.releaseLock();
 reader=socket.readable.getReader();let buffer=new Uint8Array(0),ended=false;
 async function more(){const r=await timed(reader.read());if(r.done){ended=true;return false}const b=new Uint8Array(buffer.length+r.value.length);b.set(buffer);b.set(r.value,buffer.length);buffer=b;return true}
 async function line(){for(;;){for(let i=0;i+1<buffer.length;i++)if(buffer[i]===13&&buffer[i+1]===10){const result=new TextDecoder().decode(buffer.subarray(0,i));buffer=buffer.subarray(i+2);return result}if(buffer.length>65536||ended)throw Error('invalid_http_response');await more()}}
 const statusLine=await line(),match=statusLine.match(/^HTTP\/1\.[01] (\d{3})/);if(!match)throw Error('invalid_http_response');
 const status=Number(match[1]);if(status<200||status>599)throw Error('invalid_http_response');
 const responseHeaders=new Headers();let headerBytes=0;
 for(;;){const text=await line();if(!text)break;headerBytes+=text.length;if(headerBytes>65536)throw Error('invalid_http_response');const colon=text.indexOf(':');if(colon<1)throw Error('invalid_http_response');responseHeaders.append(text.slice(0,colon),text.slice(colon+1).trim())}
 const chunked=/\bchunked\b/i.test(responseHeaders.get('transfer-encoding')||'');let remaining=responseHeaders.has('content-length')?Number(responseHeaders.get('content-length')):null;
 if(remaining!==null&&(!Number.isSafeInteger(remaining)||remaining<0))throw Error('invalid_http_response');
 responseHeaders.delete('transfer-encoding');responseHeaders.delete('connection');
 let chunkRemaining=0,chunkCRLF=false,finished=false;
 const close=()=>{finished=true;socket.close().catch(()=>{})};
 if([204,205,304].includes(status)){close();return new Response(null,{status,headers:responseHeaders})}
 const body=new ReadableStream({
 async pull(controller){try{
 if(finished){controller.close();return}
 if(chunked){
 if(chunkCRLF){if(await line()!=='')throw Error('invalid_http_chunk');chunkCRLF=false}
 if(!chunkRemaining){const size=(await line()).split(';')[0];if(!/^[0-9a-f]+$/i.test(size))throw Error('invalid_http_chunk');chunkRemaining=parseInt(size,16);if(!Number.isSafeInteger(chunkRemaining))throw Error('invalid_http_chunk');if(!chunkRemaining){close();controller.close();return}}
 if(!buffer.length&&!await more())throw Error('truncated_http_body');
 const n=Math.min(buffer.length,chunkRemaining);controller.enqueue(buffer.slice(0,n));buffer=buffer.subarray(n);chunkRemaining-=n;if(!chunkRemaining)chunkCRLF=true;return;
 }
 if(remaining===0){close();controller.close();return}
 if(!buffer.length&&!await more()){if(remaining!==null&&remaining>0)throw Error('truncated_http_body');close();controller.close();return}
 const n=remaining===null?buffer.length:Math.min(buffer.length,remaining);controller.enqueue(buffer.slice(0,n));buffer=buffer.subarray(n);if(remaining!==null)remaining-=n;
 }catch(e){close();controller.error(e)}},
 cancel(){close()}
 });
 return new Response(body,{status,headers:responseHeaders});
 }catch(e){socket.close().catch(()=>{});throw e}
}

