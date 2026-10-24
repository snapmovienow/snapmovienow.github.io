// Explicit one-off authorization, not a new monitor or a public execution API.
// A durable claim is never reset, even after failure, interruption or redeploy.
const KEY='owner-targeted-case-20261024-v1';
const ACCOUNT='dieguito2026',APPROVED_AT=Date.parse('2026-10-24T22:21:06Z'),EXPIRES_AT=APPROVED_AT+86400000;
const SAMPLE=Object.freeze({type:'live',server:'ccf',id:'217967',ext:'ts'});
const verdicts=new Set(['deferred','not_reproduced','gateway_path','gateway_origin_policy','origin_http_error','origin_rejected','origin_not_found','inconclusive','preparation_unconfirmed']);
const reasons=new Set(['ok','timeout','http_error','invalid_reply','invalid_media','empty_media','preempted','origin_policy','http_parser','socket_error','invocation_context','internal_error','prepare_failed']);
const bounded=(value,max)=>Number.isFinite(value)?Math.max(0,Math.min(max,Math.round(value))):0;
const status=value=>Number.isInteger(value)&&value>=100&&value<=599?value:null;
const measurement=value=>({ok:value?.ok===true,reason:reasons.has(value?.reason)?value.reason:'internal_error',httpStatus:status(value?.httpStatus),ms:bounded(value?.ms,30000),bytes:bounded(value?.bytes,65536)});
function safeResult(value){
 const result={type:'live',verdict:verdicts.has(value?.verdict)?value.verdict:'preparation_unconfirmed'};
 if(value?.origin&&value?.relay){result.transport='ts';result.origin=measurement(value.origin);result.relay=measurement(value.relay)}
 else{result.phase=['authentication','preparation'].includes(value?.phase)?value.phase:'preparation';result.httpStatus=status(value?.httpStatus);result.reason=reasons.has(value?.reason)?value.reason:'internal_error'}
 return result;
}
function permitted(env,config,now){return env?.ENVIRONMENT==='production'&&env.PLAYBACK_CANARY_USERNAME===ACCOUNT&&config?.username===ACCOUNT&&config.type==='live'&&now>=APPROVED_AT&&now<EXPIRES_AT}
export async function targetedComparisonStatus(storage){
 const value=await storage.get(KEY);if(!value)return null;
 return {state:value.state==='complete'?'complete':'running',attempts:1,at:bounded(value.at,Number.MAX_SAFE_INTEGER),...(value.state==='complete'?{result:safeResult(value.result)}:{})};
}
export async function runTargetedComparison(storage,env,config,compare){
 if(!permitted(env,config,Date.now()))return;
 let claimed;
 try{claimed=await storage.transaction(async tx=>{if(!permitted(env,config,Date.now())||await tx.get(KEY))return false;await tx.put(KEY,{state:'running',attempts:1,at:Date.now()});return true})}catch{return}
 if(!claimed||!permitted(env,config,Date.now()))return;
 let result;try{result=safeResult(await compare({...SAMPLE}))}catch{result=safeResult(null)}
 // A failed final write leaves the running claim in place: never retry traffic.
 try{await storage.put(KEY,{state:'complete',attempts:1,at:Date.now(),result})}catch{}
}
