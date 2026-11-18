// Short-lived owner-authorized test. The Worker stores only an owner-key fingerprint.
// Service credentials are transient per-call values and are never returned or logged.
export async function privateProbeAuthorized(request, env) {
  const fingerprint=env.MERIDIANO_PROBE_TOKEN_HASH;
  const deadline=Number(env.MERIDIANO_PROBE_EXPIRES_AT);
  const supplied=request.headers.get('Authorization')||'';
  if(typeof fingerprint!=='string'||! /^[a-f0-9]{64}$/.test(fingerprint)||
    !Number.isFinite(deadline)||deadline<=Date.now()||deadline>Date.now()+3600000||
    !supplied.startsWith('Bearer ')||supplied.length<39||supplied.length>512)return false;
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(supplied)));
  let different=0;for(let i=0;i<hash.length;i++)different|=hash[i]^parseInt(fingerprint.slice(i*2,i*2+2),16);
  return different===0;
}

export async function privateConnectionProbe(request, env, connect) {
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
  if(!await privateProbeAuthorized(request,env))return json({error:'unauthorized'},403);
  const encode=new TextEncoder();
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  const username=env.SURFSHARK_SERVICE_USERNAME,password=env.SURFSHARK_SERVICE_PASSWORD;
  if(typeof username!=='string'||typeof password!=='string'||!username||!password||
    username.length>200||password.length>200||/[\r\n\0:]/.test(username)||/[\r\n\0]/.test(password))
    return json({error:'incomplete_service_credentials'},503);
  let socket,reader,timer,phase='opening_tls',tlsConnected=false;
  try{
    const operation=async()=>{
      socket=connect({hostname:'ve-car.prod.surfshark.com',port:443},{secureTransport:'on'});
      await socket.opened;
      tlsConnected=true;phase='sending_connect';
      const lines=['CONNECT www.dailymotion.com:443 HTTP/1.1','Host: www.dailymotion.com:443'];
      if(username&&password){
        const bytes=encode.encode(username+':'+password);
        let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
        lines.push('Proxy-Authorization: Basic '+btoa(binary));
      }
      const writer=socket.writable.getWriter();
      try{await writer.write(encode.encode(lines.join('\r\n')+'\r\n\r\n'))}finally{writer.releaseLock()}
      phase='reading_proxy_header';
      reader=socket.readable.getReader();let head='';
      while(head.length<8192&&!head.includes('\r\n\r\n')){
        const {value,done}=await reader.read();if(done)break;
        head+=new TextDecoder().decode(value);
      }
      const match=/^HTTP\/1\.[01] ([0-9]{3})\b/.exec(head);
      if(!match)return json({error:'invalid_proxy_reply'},502);
      const status=Number(match[1]);
      return json({tlsConnected:true,proxyStatus:status,proxyAccepted:status>=200&&status<300,
        countryVerified:false,liveMediaVerified:false});
    };
    return await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('timeout')),8000)})]);
  }catch{return json({error:'private_probe_failed',phase,tlsConnected},502)}
  finally{
    clearTimeout(timer);try{reader?.releaseLock()}catch{}
    try{await socket?.close()}catch{}
  }
}
