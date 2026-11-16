import {privateProbeAuthorized,privateConnectionProbe} from './private-connection-probe.mjs';
export const CARACAS_PROFILE_ID='dc95e90b-c5b9-4925-ad01-a1cee5f21d9d';
const json=(value,status)=>Response.json(value,{status,headers:{'Cache-Control':'no-store, private'}});

export async function handlePrivatePilot(request,env,connect,originProof){
  if(!await privateProbeAuthorized(request,env))return json({error:'unauthorized'},403);
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  if(request.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')return json({error:'invalid_request'},415);
  if(Number(request.headers.get('content-length')||0)>2048)return json({error:'invalid_request'},413);
  let body;
  try{
    const raw=await request.text();if(raw.length>2048)return json({error:'invalid_request'},413);
    body=JSON.parse(raw);
    if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['profileId','username','password','mode'].includes(k))||
      body.profileId!==CARACAS_PROFILE_ID)return json({error:'invalid_request'},400);
  }catch{return json({error:'invalid_request'},400)}
  if(body.mode!==undefined&&body.mode!=='connection'){
    if(!['country','metadata'].includes(body.mode)||typeof originProof!=='function')return json({error:'invalid_request'},400);
    if(typeof body.username!=='string'||typeof body.password!=='string'||!body.username||!body.password||
      body.username.length>200||body.password.length>200||/[\r\n\0:]/.test(body.username)||/[\r\n\0]/.test(body.password))return json({error:'incomplete_service_credentials'},503);
    return originProof(body.mode,{username:body.username,password:body.password});
  }
  return privateConnectionProbe(request,{...env,SURFSHARK_SERVICE_USERNAME:body.username,SURFSHARK_SERVICE_PASSWORD:body.password},connect);
}
