import {TRUSTED_RESELLER} from './reseller-trust.mjs';
const dec=new TextDecoder(),enc=new TextEncoder();
const unb64=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export async function verifyResellerPacket(packet,trust=TRUSTED_RESELLER,now=Date.now()){
 if(!trust.publicKey||!trust.keyId||typeof packet?.payload!=='string'||typeof packet?.signature!=='string'||packet.payload.length>22000||!/^[A-Za-z0-9_-]+$/.test(packet.payload)||!/^[A-Za-z0-9_-]{86}$/.test(packet.signature))throw Error('bridge_denied');
 const raw=unb64(packet.payload),key=await crypto.subtle.importKey('raw',unb64(trust.publicKey),'Ed25519',false,['verify']);if(!await crypto.subtle.verify('Ed25519',key,unb64(packet.signature),raw))throw Error('bridge_denied');
 const value=JSON.parse(dec.decode(raw));if(value.v!==1||value.accountId!==trust.accountId||value.keyId!==trust.keyId||!Number.isSafeInteger(value.issuedAt)||Math.abs(now-value.issuedAt)>45000||typeof value.nonce!=='string'||!/^[A-Za-z0-9_-]{16,80}$/.test(value.nonce)||!value.body||typeof value.body!=='object'||Array.isArray(value.body)||!['probe','reserve','apply'].includes(value.action))throw Error('bridge_denied');return value;
}
export function createResellerBridge(directory,trust=TRUSTED_RESELLER){return async(req,env)=>{
 if(req.method!=='POST')return json({error:'bridge_method'},405);if(req.headers.get('content-type')?.split(';')[0]!=='application/json')return json({error:'bridge_format'},415);
 try{const reader=req.body?.getReader();if(!reader)throw Error('bridge_denied');const chunks=[];let size=0;const deadline=AbortSignal.timeout(5000);try{while(true){deadline.throwIfAborted();const next=await new Promise((resolve,reject)=>{const abort=()=>{void reader.cancel();reject(Error('bridge_denied'));};deadline.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>deadline.removeEventListener('abort',abort));});if(next.done)break;size+=next.value.length;if(size>24000){await reader.cancel();throw Error('bridge_denied');}chunks.push(next.value);}}finally{reader.releaseLock();}const raw=new Uint8Array(size);let at=0;for(const chunk of chunks){raw.set(chunk,at);at+=chunk.length;}
  const signed=await verifyResellerPacket(JSON.parse(dec.decode(raw)),trust),body={...signed.body,accountId:trust.accountId};
  if(signed.action==='probe')return json({ok:true,accountId:trust.accountId,protocol:1});
  const r=await directory(env,signed.action==='reserve'?'/reseller-reserve':'/reseller-apply',body);return json({...await r.json(),accountId:trust.accountId},r.status);
 }catch{return json({error:'bridge_denied'},403);}
};}
