import {verifyResellerPacket} from './reseller-bridge.mjs';
const verified=new WeakSet();
// A signed check grants no access. Normal passwords, expiry, sessions and
// three-device capacity still apply; only customer location/history is omitted.
export async function markServiceVerification(request,trust){
 const raw=request.headers.get('X-SNAP-Service-Check');if(!raw||raw.length>4000)return false;
 try{const signed=await verifyResellerPacket(JSON.parse(raw),trust);if(signed.action!=='probe'||signed.body.purpose!=='access-verification'||!/^[a-z0-9_.@!-]{3,80}$/.test(signed.body.username||'')||!/^[A-Za-z0-9_.:-]{1,80}$/.test(signed.body.lineId||''))return false;
  const url=new URL(request.url);if(request.method==='GET'){if(url.pathname!=='/player_api.php'||url.searchParams.get('username')?.toLowerCase()!==signed.body.username)return false;}
  else if(request.method==='POST'&&url.pathname==='/'){const body=await request.clone().json();if(body.op==='auth'&&String(body.username||'').toLowerCase()!==signed.body.username)return false;}
  else return false;verified.add(request);return true;
 }catch{return false;}
}
export const isServiceVerification=request=>verified.has(request);
