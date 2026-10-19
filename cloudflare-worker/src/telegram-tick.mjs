import {PORTAL_ACCOUNT,PORTAL_SOURCE} from './reseller-portal.mjs';
// Uses the existing private gateway only to deliver already approved alerts.
// No recipient, credential, or transaction can be supplied by this timer.
export function createTelegramTick({getConfig,fetcher=fetch}){return async env=>{
 const c=await getConfig(env);if(!c)return {ok:true,sent:0};
 if(c.accountId!==PORTAL_ACCOUNT||c.sourceOrigin!==PORTAL_SOURCE||!/^[a-f0-9]{64}$/.test(c.gatewaySecret||'')||typeof c.siteToken!=='string')throw Error('telegram_config');
 const r=await fetcher(PORTAL_SOURCE+'/api/owner-portal',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','OAI-Sites-Authorization':'Bearer '+c.siteToken,'X-SNAP-Portal-Gateway':c.gatewaySecret},body:JSON.stringify({action:'telegram-tick',accountId:PORTAL_ACCOUNT}),signal:AbortSignal.timeout(25000)}),raw=await r.text();
 if(!r.ok||raw.length>2000)throw Error('telegram_tick');const result=JSON.parse(raw);if(result.ok!==true||!Number.isSafeInteger(result.sent)||result.sent<0||result.sent>10)throw Error('telegram_tick');return {ok:true,sent:result.sent};
};}
