// Temporary, explicitly approved diagnostic. Never send the real gateway secret.
// The durable claim is intentionally not deleted on expiry, failure or removal.
import {PORTAL_ACCOUNT,PORTAL_SOURCE} from './reseller-portal.mjs';
export const SECURITY_CANARY_ID='snap-public-header-canary-20261026-v1';
export const SECURITY_CANARY_OBJECT='__smn_security_log_canary_20261026_v1';
export const SECURITY_CANARY_START=Date.parse('2026-10-26T19:39:33Z');
export const SECURITY_CANARY_EXPIRES=Date.parse('2026-10-27T19:39:33Z');
export const SECURITY_CANARY_OLD='SNAP_PUBLIC_CANARY_20261026_OLD';
export const SECURITY_CANARY_NEW='SNAP_PUBLIC_CANARY_20261026_TOKEN';
const KEY='security-log-canary:20261026:permanent-claim';
const headers={'Cache-Control':'private, no-store, max-age=0','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'};
const reply=(body,status=200)=>Response.json(body,{status,headers});
const finiteTime=value=>Number.isSafeInteger(value)&&value>=SECURITY_CANARY_START&&value<=SECURITY_CANARY_EXPIRES+60000?value:null;
function projection(record,now){
 const consumed=record!==undefined&&record!==null;
 const result={id:SECURITY_CANARY_ID,expiresAt:SECURITY_CANARY_EXPIRES,consumed,state:consumed?'claimed':now>=SECURITY_CANARY_EXPIRES?'expired':now<SECURITY_CANARY_START?'not_started':'ready'};
 if(!consumed)return result;
 if(['complete','uncertain','configuration_unavailable','expired'].includes(record?.state))result.state=record.state;
 for(const name of ['startedAt','finishedAt']){const value=finiteTime(record?.[name]);if(value!==null)result[name]=value;}
 if(Number.isInteger(record?.httpStatus)&&record.httpStatus>=100&&record.httpStatus<=599)result.httpStatus=record.httpStatus;
 if(typeof record?.expectedRejection==='boolean')result.expectedRejection=record.expectedRejection;
 if(typeof record?.cfRay==='string'&&/^[a-f0-9]{16}(?:-[A-Z]{3})?$/.test(record.cfRay))result.cfRay=record.cfRay;
 return result;
}
export async function securityCanaryStatus(storage,now=Date.now()){
 try{return reply(projection(await storage.get(KEY),now));}
 catch{return reply({id:SECURITY_CANARY_ID,state:'storage_unavailable',consumed:true},503);}
}
export async function runSecurityCanary(storage,env,{getConfig,fetcher=fetch,now=Date.now}={}){
 let claim;
 try{
  claim=await storage.transaction(async tx=>{
   const previous=await tx.get(KEY),time=now();
   if(previous!==undefined&&previous!==null)return {allowed:false,record:previous,status:409};
   if(time<SECURITY_CANARY_START||time>=SECURITY_CANARY_EXPIRES)return {allowed:false,status:410};
   const record={state:'claimed',startedAt:time};
   await tx.put(KEY,record);
   return {allowed:true,record};
  });
 }catch{return reply({id:SECURITY_CANARY_ID,state:'storage_unavailable',consumed:true},503);}
 if(!claim?.allowed)return reply(projection(claim?.record,now()),claim?.status||503);
 let result={...claim.record,state:'uncertain'};
 try{
  const cfg=await getConfig(env);
  if(cfg?.accountId!==PORTAL_ACCOUNT||cfg.sourceOrigin!==PORTAL_SOURCE||typeof cfg.siteToken!=='string'||cfg.siteToken.length<20||cfg.siteToken.length>4000||/[\r\n]/.test(cfg.siteToken))result.state='configuration_unavailable';
  else if(now()>=SECURITY_CANARY_EXPIRES)result.state='expired';
  else {
   const response=await fetcher(PORTAL_SOURCE+'/api/portal',{
    method:'POST',redirect:'manual',signal:AbortSignal.timeout(8000),
    headers:{'Content-Type':'application/json','OAI-Sites-Authorization':'Bearer '+cfg.siteToken,
     'X-SNAP-Portal-Gateway':SECURITY_CANARY_OLD,'X-SNAP-Portal-Gateway-Token':SECURITY_CANARY_NEW},body:'{}'
   });
   // Zero response-body bytes are read, stored or logged. Never follow redirects.
   void response.body?.cancel().catch(()=>{});
   result={...result,state:'complete',httpStatus:response.status,expectedRejection:response.status===404};
   const ray=response.headers.get('cf-ray');
   if(typeof ray==='string'&&/^[a-f0-9]{16}(?:-[A-Z]{3})?$/.test(ray))result.cfRay=ray;
  }
 }catch{result.state='uncertain';}
 result.finishedAt=now();
 try{await storage.put(KEY,result);}
 catch{return reply({...projection(claim.record,now()),state:'uncertain'},503);}
 return reply(projection(result,now()));
}
export async function securityCanaryAdmin(request,body,verifiedSession,dispatch){
 // The caller also verifies the live administrator session in the existing DO.
 if(verifiedSession?.kind!=='admin')return reply({error:'admin_required'},401);
 if(request.method!=='POST'||request.headers.get('Origin')!=='https://app.snaptvnow.com'||request.headers.get('Sec-Fetch-Site')==='cross-site')return reply({error:'origin_not_allowed'},403);
 if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')return reply({error:'canary_format'},415);
 const run=body?.action==='security-log-canary-run',status=body?.action==='security-log-canary-status';
 if(!run&&!status)return reply({error:'operation_not_allowed'},403);
 if(!body||Object.keys(body).some(k=>!['action','access_token','browser_cookie',...(run?['confirm']:[])].includes(k))||run&&body.confirm!==SECURITY_CANARY_ID)return reply({error:'canary_input'},400);
 try{return await dispatch(run?'run':'status');}
 catch{return reply({error:'canary_unavailable',consumed:true},503);}
}
