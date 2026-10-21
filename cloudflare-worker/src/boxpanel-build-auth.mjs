import {BOX_BUILD_REPO} from './boxpanel-delivery.mjs';
const ISSUER='https://token.actions.githubusercontent.com';
export const BOX_BUILD_AUDIENCE='snaptvnow-boxpanel-build';
const bytes=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const decode=s=>JSON.parse(new TextDecoder().decode(bytes(s)));
const invalid=()=>{throw Object.assign(Error('box_build_auth'),{status:401});};
export function createBoxBuildVerifier({fetcher=fetch,now=()=>Date.now()}={}){
 let keys=[],expires=0;
 return async token=>{
  try{
   if(typeof token!=='string'||token.length>16000)invalid();const parts=token.split('.');if(parts.length!==3)invalid();
   const header=decode(parts[0]),claim=decode(parts[1]),time=Math.floor(now()/1000);
   if(header.alg!=='RS256'||typeof header.kid!=='string'||claim.iss!==ISSUER||claim.aud!==BOX_BUILD_AUDIENCE||claim.repository!==BOX_BUILD_REPO||claim.repository_id!=='1388310940'||claim.repository_owner_id!=='301551773'||claim.ref!=='refs/heads/main'||claim.environment!=='production'||claim.workflow_ref!==BOX_BUILD_REPO+'/.github/workflows/boxpanel-build.yml@refs/heads/main'||!['schedule','workflow_dispatch'].includes(claim.event_name)||claim.runner_environment!=='github-hosted'||!Number.isSafeInteger(claim.exp)||!Number.isSafeInteger(claim.iat)||!Number.isSafeInteger(claim.nbf)||claim.exp<=time||claim.iat>time+30||claim.nbf>time+30||claim.exp-claim.iat>600||!/^\d+$/.test(claim.run_id||'')||!/^\d+$/.test(claim.run_attempt||'')||!/^[a-f0-9]{40}$/.test(claim.sha||''))invalid();
   if(expires<now()){
    const response=await fetcher(ISSUER+'/.well-known/jwks',{headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)});if(!response.ok)invalid();const text=await response.text();if(text.length>65536)invalid();const jwks=JSON.parse(text);if(!Array.isArray(jwks.keys)||jwks.keys.length>20)invalid();keys=jwks.keys;expires=now()+600000;
   }
   const jwk=keys.find(k=>k.kid===header.kid&&k.kty==='RSA'&&k.use==='sig'&&k.alg==='RS256');if(!jwk)invalid();
   const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
   if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,bytes(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))invalid();
   return {role:'builder',runId:claim.run_id,runAttempt:Number(claim.run_attempt),sha:claim.sha};
  }catch{invalid();}
 };
}
