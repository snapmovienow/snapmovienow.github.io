// Private experiment only. Fixed public destinations; no signed URLs or account values leave this function.
const TARGETS={country:new URL('https://www.cloudflare.com/cdn-cgi/trace'),metadata:new URL('https://www.dailymotion.com/player/metadata/video/x9sxu9y')};
const LIMIT=131072;
const encoder=new TextEncoder(),decoder=new TextDecoder();
function decodedBody(raw){
  const split=raw.indexOf('\r\n\r\n');if(split<0||split>8192)throw Error('invalid_http');
  const head=raw.slice(0,split),status=Number(/^HTTP\/1\.[01] (\d{3})\b/.exec(head)?.[1]);
  if(!status)throw Error('invalid_http');
  const encoding=/\r\ncontent-encoding:\s*([^\r\n]+)/i.exec(head)?.[1].trim().toLowerCase();
  if(encoding&&encoding!=='identity')throw Error('encoding');
  let body=raw.slice(split+4);
  if(/\r\ntransfer-encoding:\s*chunked\b/i.test(head)){
    let cursor=0,result='';
    while(cursor<body.length){
      const end=body.indexOf('\r\n',cursor);if(end<0)throw Error('invalid_http');
      const size=body.slice(cursor,end).split(';')[0];if(!/^[a-f0-9]{1,8}$/i.test(size))throw Error('invalid_http');
      const length=parseInt(size,16);cursor=end+2;
      if(length===0)return {status,body:result};
      if(cursor+length+2>body.length||body.slice(cursor+length,cursor+length+2)!=='\r\n')throw Error('invalid_http');
      result+=body.slice(cursor,cursor+length);cursor+=length+2;
    }
    throw Error('invalid_http');
  }
  return {status,body};
}

export async function privateOriginProof(mode,credentials,{connect,upgradeTls,timeoutMs=8000}){
  const target=TARGETS[mode];if(!target)return Response.json({error:'origin_proof_failed'},{status:400});
  let raw,inner,reader,timer,phase='origin_proxy_tls';
  try{
    const operation=async()=>{
      raw=connect({hostname:'ve-car.prod.surfshark.com',port:443},{secureTransport:'on'});
      await raw.opened;phase='origin_proxy_connect';
      const auth=encoder.encode(credentials.username+':'+credentials.password);let binary='';for(const byte of auth)binary+=String.fromCharCode(byte);
      const writer=raw.writable.getWriter();
      try{await writer.write(encoder.encode(`CONNECT ${target.hostname}:443 HTTP/1.1\r\nHost: ${target.hostname}:443\r\nProxy-Authorization: Basic ${btoa(binary)}\r\n\r\n`))}finally{writer.releaseLock()}
      reader=raw.readable.getReader();let head='';
      while(!head.includes('\r\n\r\n')&&head.length<8192){const chunk=await reader.read();if(chunk.done)break;head+=decoder.decode(chunk.value)}
      if(head.length>8192)throw Error('response_limit');
      reader.releaseLock();reader=null;
      if(!/^HTTP\/1\.[01] 200\b/.test(head)||!head.endsWith('\r\n\r\n'))throw Error('proxy_connect');
      phase='origin_tls';inner=upgradeTls(raw,target.hostname);await inner.opened;
      phase='origin_http';const output=inner.writable.getWriter();
      try{await output.write(encoder.encode(`GET ${target.pathname+target.search} HTTP/1.1\r\nHost: ${target.hostname}\r\nAccept: ${mode==='metadata'?'application/json':'text/plain'}\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n`))}finally{output.releaseLock()}
      reader=inner.readable.getReader();const chunks=[];let size=0;
      for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;if(size>LIMIT)throw Error('response_limit');chunks.push(chunk.value)}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}
      // Decode as Latin-1 before HTTP framing, so byte lengths are independent of UTF-8 JSON text.
      let wire='';for(const byte of bytes)wire+=String.fromCharCode(byte);
      const parsed=decodedBody(wire),body=decoder.decode(Uint8Array.from(parsed.body,c=>c.charCodeAt(0)));
      if(mode==='country'){
        const country=/^loc=([A-Z]{2})$/m.exec(body)?.[1]||null;
        return {proof:mode,completed:parsed.status===200&&!!country,originHttpStatus:parsed.status,observedCountry:country,countryVerified:parsed.status===200&&country==='VE',liveMediaVerified:false};
      }
      const data=JSON.parse(body),qualities=data?.qualities;
      const variants=qualities&&typeof qualities==='object'?Object.values(qualities).flat().filter(item=>item&&typeof item==='object'&&typeof item.url==='string'&&/mpegurl/i.test(String(item.type))):[];
      return {proof:mode,completed:parsed.status===200,originHttpStatus:parsed.status,geoBlocked:data?.error?.code==='DM007',hlsQualitiesFound:variants.length,liveMediaVerified:false};
    };
    const result=await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('deadline')),timeoutMs)})]);
    return Response.json(result,{headers:{'Cache-Control':'no-store, private'}});
  }catch(error){
    const message=error instanceof Error?error.message:'';
    const failure=/certificate|root|trust|signature|key usage|name.*match/i.test(message)?'certificate_rejected':/deadline/i.test(message)?'deadline':/TLS|cipher|handshake/i.test(message)?'tls_interop':'origin_failed';
    return Response.json({error:'origin_proof_failed',phase,proofFailure:failure,liveMediaVerified:false},{status:502,headers:{'Cache-Control':'no-store, private'}});
  }finally{
    clearTimeout(timer);try{reader?.releaseLock()}catch{}
    try{await raw?.close()}catch{}
  }
}
