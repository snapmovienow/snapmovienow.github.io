import {Client} from 'tunnelfetch';
import {diagnosePlayerMetadata} from '../metadata-diagnostics.mjs';
import {verifyPrivateLiveMedia} from './private-media-proof.mjs';
const targets={country:'https://www.cloudflare.com/cdn-cgi/trace',metadata:'https://www.dailymotion.com/player/metadata/video/x9sxu9y'};
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store, private'}});

// Private experiment only; production always uses the bundled public trust store.
export async function verifiedOriginProof(mode,credentials,{connect,trust={mode:'system'},timeoutMs=8000}){
  if(!Object.hasOwn(targets,mode)&&mode!=='media')return json({error:'origin_proof_failed'},400);
  const sockets=new Set();let client,timer;
  try{
    client=new Client({connect:(address,options)=>{const socket=connect(address,options);sockets.add(socket);return socket},
      proxy:{protocol:'https',hostname:'ve-car.prod.surfshark.com',port:443,username:credentials.username,password:credentials.password},
      trust,tls:{alpn:['http/1.1']},forceTunnel:true,keepAlive:false,maxBodyBytes:mode==='media'?8388608:131072,maxRedirects:0,
      timeouts:{connectMs:timeoutMs,handshakeMs:timeoutMs,headersMs:timeoutMs,idleMs:timeoutMs,totalMs:timeoutMs}});
    const operation=async()=>{
      const response=await client.fetch(targets[mode==='media'?'metadata':mode],{redirect:'manual',headers:{Accept:mode==='country'?'text/plain':'application/json','Accept-Encoding':'identity'}});
      const text=await response.text();
      if(mode==='country'){
        const country=/^loc=([A-Z]{2})$/m.exec(text)?.[1]||null;
        return {proof:mode,completed:response.status===200&&!!country,originHttpStatus:response.status,observedCountry:country,countryVerified:response.status===200&&country==='VE',liveMediaVerified:false};
      }
      const data=JSON.parse(text),diagnostic=diagnosePlayerMetadata(data,response.status);
      if(mode==='media'&&diagnostic.completed&&diagnostic.hlsQualitiesFound>0){
        const media=await verifyPrivateLiveMedia(data,(url,options)=>client.fetch(url,{...options,redirect:'manual'}),{signal:AbortSignal.timeout(timeoutMs)});
        return {proof:mode,originHttpStatus:response.status,...diagnostic,...media};
      }
      return {proof:mode,originHttpStatus:response.status,...diagnostic};
    };
    const result=await Promise.race([operation(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('proof_deadline')),timeoutMs)})]);
    return json(result);
  }catch(error){
    // Proxy errors may name the account; only fixed classifications are returned.
    const code=typeof error?.code==='string'?error.code:'';
    const failure=/^CERT_|^OCSP_/.test(code)?'certificate_rejected':/TIMEOUT|DEADLINE/.test(code)||error?.message==='proof_deadline'?'deadline':/^TLS_/.test(code)?'tls_interop':'origin_failed';
    return json({error:'origin_proof_failed',phase:'origin_tls',proofFailure:failure,liveMediaVerified:false},502);
  }finally{
    clearTimeout(timer);
    await Promise.allSettled([...sockets].map(socket=>socket.close()));
    try{await client?.close()}catch{}
  }
}
