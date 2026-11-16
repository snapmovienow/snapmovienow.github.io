// Candidate for an owner-authorized private test. Not wired to any HTTP route.
// Credentials are runtime secrets; neither endpoint nor target comes from the caller.
export async function privateConnectionProbe(request, env, connect) {
  const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
  const secret=env.MERIDIANO_PROBE_TOKEN;
  const supplied=request.headers.get('Authorization')||'';
  if(typeof secret!=='string'||secret.length<32||supplied.length>512)return json({error:'unauthorized'},403);
  const encode=new TextEncoder();
  const [expected,provided]=await Promise.all([secret,supplied].map((value,index)=>
    crypto.subtle.digest('SHA-256',encode.encode(index===0?'Bearer '+value:value))));
  const left=new Uint8Array(expected),right=new Uint8Array(provided);
  let different=0;for(let i=0;i<left.length;i++)different|=left[i]^right[i];
  if(different)return json({error:'unauthorized'},403);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  const username=env.SURFSHARK_SERVICE_USERNAME,password=env.SURFSHARK_SERVICE_PASSWORD;
  if(!!username!==!!password)return json({error:'incomplete_service_credentials'},503);
  let socket,reader,timer;
  try{
    const operation=async()=>{
      socket=connect({hostname:'ve-car.prod.surfshark.com',port:443},{secureTransport:'on'});
      await socket.opened;
      const lines=['CONNECT www.dailymotion.com:443 HTTP/1.1','Host: www.dailymotion.com:443'];
      if(username&&password){
        const bytes=encode.encode(username+':'+password);
        let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
        lines.push('Proxy-Authorization: Basic '+btoa(binary));
      }
      const writer=socket.writable.getWriter();
      try{await writer.write(encode.encode(lines.join('\r\n')+'\r\n\r\n'))}finally{writer.releaseLock()}
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
  }catch{return json({error:'private_probe_failed'},502)}
  finally{
    clearTimeout(timer);try{reader?.releaseLock()}catch{}
    try{await socket?.close()}catch{}
  }
}
