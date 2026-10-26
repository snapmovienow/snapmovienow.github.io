// Synthetic transport only: all fetches are intercepted; no live credentials or accounts.
import assert from 'node:assert/strict';
import {createResellerPortal,PORTAL_HOST,PORTAL_ACCOUNT,PORTAL_SOURCE} from '../src/reseller-portal.mjs';
import {createOwnerPortal} from '../src/owner-portal.mjs';
import {createTelegramTick} from '../src/telegram-tick.mjs';
const OLD='X-SNAP-Portal-Gateway',NEW='X-SNAP-Portal-Gateway-Token';
const gatewaySecret='2'.repeat(64),siteToken='SYNTHETIC_ONLY_SITE_TOKEN';
const getConfig=async()=>({accountId:PORTAL_ACCOUNT,sourceOrigin:PORTAL_SOURCE,gatewaySecret,siteToken});
const originalFetch=globalThis.fetch;
let unexpected=0;
globalThis.fetch=async()=>{unexpected++;throw Error('EXTERNAL_NETWORK_FORBIDDEN');};
try{
 for(const responseStatus of [409,403]){
  const seen=[];
  const fetcher=async(url,options)=>{
   const h=new Headers(options.headers),body=JSON.parse(options.body);
   assert.equal(h.has(OLD),false);assert.equal(h.get(NEW),gatewaySecret);
   assert.equal(h.get('OAI-Sites-Authorization'),'Bearer '+siteToken);
   assert.equal(options.redirect,'manual');assert.equal(body.accountId,PORTAL_ACCOUNT);
   assert.equal(new URL(url).origin,PORTAL_SOURCE);
   seen.push({path:new URL(url).pathname,action:body.action});
   return Response.json({error:'synthetic_denial'},{status:responseStatus});
  };
  const portal=createResellerPortal({getConfig,fetcher});
  for(const path of ['/api/portal/login','/api/sms-device']){
   const origin='https://'+PORTAL_HOST;
   const r=await portal(new Request(origin+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body:'{}'}),{});
   assert.equal(r.status,responseStatus);
  }
  const owner=createOwnerPortal({getConfig,fetcher});
  const r=await owner(new Request('https://api.snaptvnow.com/owner-panel/api/panel',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://api.snaptvnow.com',Cookie:'__Host-SNAP_Owner_Portal='+'s'.repeat(64)},body:'{}'}),{});
  assert.equal(r.status,responseStatus);
  await assert.rejects(createTelegramTick({getConfig,fetcher})({}),/telegram_tick/);
  assert.deepEqual(seen,[{path:'/api/portal',action:'login'},{path:'/api/portal',action:'sms-device'},{path:'/api/owner-portal',action:'write'},{path:'/api/owner-portal',action:'telegram-tick'}]);
  // Exactly one attempt per path, including denial: never retry with the old header.
  assert.equal(seen.length,4);
 }
 assert.equal(unexpected,0);
 console.log('PASS: all four sends use only the new header, unchanged synthetic secrets; no fallback after denial or external requests.');
}finally{globalThis.fetch=originalFetch;}
