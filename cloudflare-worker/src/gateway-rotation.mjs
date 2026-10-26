import {PORTAL_ACCOUNT,PORTAL_SOURCE} from './reseller-portal.mjs';
const json=(v,status=200)=>Response.json(v,{status,headers:{'Cache-Control':'no-store'}});
const hash=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v))),b=>b.toString(16).padStart(2,'0')).join('');
function untilAbort(promise,signal){return new Promise((resolve,reject)=>{const abort=()=>reject(Error('deadline'));if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});});}
async function boundedJson(response,signal){
 const reader=response.body?.getReader();if(!reader)throw Error('empty');let size=0,parts=[];
 try{while(true){const n=await untilAbort(reader.read(),signal);if(n.done)break;size+=n.value.length;if(size>1024)throw Error('limit');parts.push(n.value);}const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}return JSON.parse(new TextDecoder().decode(bytes));}finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
}
export function createGatewayRotation({directory,openConfig,sealConfig,fetcher=fetch,now=Date.now}){
 return async(env,accountId,value)=>{
  if(accountId!==PORTAL_ACCOUNT||!value||Object.keys(value).sort().join(',')!=='expectedRevision,expiresAt,gatewaySecret,revision,rotationId'||!/^[a-f0-9-]{36}$/.test(value.rotationId||'')||!/^[a-f0-9]{64}$/.test(value.gatewaySecret||'')||!Number.isSafeInteger(value.expectedRevision)||!Number.isSafeInteger(value.revision)||value.revision<=value.expectedRevision)return json({error:'bridge_rotation_input'},400);
  const {rotationId,revision,expectedRevision,expiresAt,gatewaySecret}=value,fingerprint=await hash(JSON.stringify({rotationId,revision,expectedRevision,expiresAt,gatewaySecret}));
  const prior=await directory(env,'/reseller-portal-rotation-status',{accountId,rotationId});if(!prior.ok)return prior;const status=await prior.json();
  // An uncertain or completed previous attempt is status-only; never re-probe or rewrite.
  if(status.operation)return directory(env,'/reseller-portal-rotation-begin',{accountId,rotationId,fingerprint});
  if(!Number.isSafeInteger(expiresAt)||expiresAt<=now()||expiresAt>now()+86400000)return json({error:'bridge_rotation_expired'},409);
  const storedResponse=await directory(env,'/reseller-portal-config',{accountId});if(!storedResponse.ok)return json({error:'bridge_rotation_storage'},503);const stored=await storedResponse.json();
  if(!stored||stored.revision!==expectedRevision)return json({error:'bridge_rotation_stale'},409);
  const existing=await openConfig(env,stored.encrypted);
  if(!existing||Array.isArray(existing)||existing.accountId!==PORTAL_ACCOUNT||existing.sourceOrigin!==PORTAL_SOURCE||typeof existing.siteToken!=='string'||existing.siteToken.length<20||existing.siteToken.length>4000||/[\r\n]/.test(existing.siteToken)||!/^[a-f0-9]{64}$/.test(existing.gatewaySecret||''))return json({error:'bridge_rotation_config'},503);
  if(existing.gatewaySecret===gatewaySecret)return json({error:'bridge_rotation_same_key'},409);
  const next={...existing,gatewaySecret},encrypted=await sealConfig(env,next),payloadHash=await hash(JSON.stringify(next));
  const claim=await directory(env,'/reseller-portal-rotation-begin',{accountId,rotationId,revision,expectedRevision,expectedPayloadHash:stored.payloadHash,expiresAt,fingerprint});
  if(!claim.ok)return claim;const applied=await claim.json();if(applied.claimed!==true)return json(applied);
  const checks=[];
  for(const path of ['/api/portal','/api/owner-portal']){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),1200);let status=0,ok=false;
   try{const r=await untilAbort(fetcher(PORTAL_SOURCE+path,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json','OAI-Sites-Authorization':'Bearer '+existing.siteToken,'X-SNAP-Portal-Gateway-Token':gatewaySecret},body:JSON.stringify({accountId,action:'gateway-auth-check',challenge:rotationId}),signal:controller.signal}),controller.signal);status=r.status;if(r.ok){const v=await boundedJson(r,controller.signal);ok=v.ok===true&&v.challenge===rotationId&&Object.keys(v).sort().join(',')==='challenge,ok';}else void r.body?.cancel().catch(()=>{});}catch{}finally{clearTimeout(timer);}checks.push({path,ok,status});
  }
  // A failure before this atomic finish leaves the OLD config intact and the claim consumed.
  return directory(env,'/reseller-portal-rotation-finish',{accountId,rotationId,revision,fingerprint,encrypted,payloadHash,checks});
 };
}
