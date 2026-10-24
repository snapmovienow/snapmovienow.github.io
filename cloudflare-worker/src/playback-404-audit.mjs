// One incident-triggered pair, using the owner's test account and exact sample.
// Results are redacted by compareOwnPlayback; never persist the selected sample.
export async function auditLive404(storage,result,sample,compare){
 if(result?.type!=='live'||result.status!=='failed'||result.failure?.phase!=='media_headers'||result.failure.httpStatus!==404||sample?.type!=='live'||sample.ext!=='ts')return;
 const key='owner-live404-audit-v1',claimed=await storage.transaction(async tx=>{if(await tx.get(key))return false;await tx.put(key,{state:'running',attempts:1,at:Date.now(),trigger:result.source==='observed_request'?'observed_request_404':'own_probe_404'});return true});if(!claimed)return;
 let paired;try{paired=await compare(sample)}catch{paired={verdict:'preparation_unconfirmed',reason:'internal_error'}}
 await storage.put(key,{state:'complete',attempts:1,at:Date.now(),trigger:result.source==='observed_request'?'observed_request_404':'own_probe_404',result:paired});
}
