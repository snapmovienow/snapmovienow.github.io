// Advisory health never grants authorization or capacity. Circuit state lives
// beside atomic allocations, so only one request may test a recovering source.
const FRESH_MS=120000,TTL=1800000,COOLDOWN=15000,MAX=512;
export const PROVIDER_CIRCUIT_POLICY=Object.freeze({failureThreshold:3,failureWindowMs:120000,initialCooldownMs:30000,maxCooldownMs:300000,probeMs:20000});
const accountKey=id=>'account|'+id;
const channelKey=(id,key)=>'channel|'+key+'|'+id;
const relevant=(id,mediaKey,{ignoreAccount=false,ignoreMedia=false}={})=>[...(!ignoreAccount?[accountKey(id)]:[]),...(!ignoreMedia?[channelKey(id,mediaKey)]:[])];
const liveRecord=(r,now)=>r&&r.at>now-TTL;
const encoder=new TextEncoder();
const prune=(old,now,room=0)=>{
 const entries=Object.entries(old||{}).filter(([,r])=>liveRecord(r,now)).sort((a,b)=>Number(!!b[1].openUntil)-Number(!!a[1].openUntil)||b[1].at-a[1].at),next={};let bytes=0,count=0;
 // Retain open circuits before advisory ranking hints and stay below the
 // SQLite KV value limit even with long provider/media identifiers.
 for(const [key,row]of entries){const size=encoder.encode(JSON.stringify([key,row])).byteLength;if(count>=MAX-room||bytes+size>86000)continue;next[key]=row;bytes+=size;count++}
 return next;
};
export function providerCircuitState(health,id,mediaKey,now=Date.now(),options={}){
 const rows=relevant(id,mediaKey,options).map(key=>({key,r:health?.[key]})).filter(({r})=>liveRecord(r,now)&&r.openUntil>0);
 const blocked=rows.filter(({r})=>r.openUntil>now||r.probeUntil>now);
 return {blocked:blocked.length>0,trial:rows.some(({r})=>r.openUntil<=now&&!(r.probeUntil>now)),retryAfterMs:blocked.length?Math.max(1,...blocked.map(({r})=>Math.max(r.openUntil||0,r.probeUntil||0)-now)):0};
}
export function claimProviderTrial(old,id,mediaKey,claimId,now=Date.now(),options={}){
 if(providerCircuitState(old,id,mediaKey,now,options).blocked)return null;
 const health=prune(old,now,2);let claimed=false;
 for(const key of relevant(id,mediaKey,options)){
  const r=old?.[key];if(liveRecord(r,now)&&r.openUntil>0&&r.openUntil<=now&&!(r.probeUntil>now)){
   health[key]={...r,at:now,probeUntil:now+PROVIDER_CIRCUIT_POLICY.probeMs,probeId:claimId};claimed=true;
  }
 }
 return {health,claimed};
}
export function recordProviderHealth(old,id,mediaKey,ok,elapsedMs,stage,now=Date.now(),claimId=null,credentialKey=null,httpStatus=null){
 const next=prune(old,now,2),key=stage==='validation'?accountKey(id):channelKey(id,mediaKey),previous=old?.[key];
 const ms=Math.max(0,Math.min(30000,Number(elapsedMs)||0));
 // A late report cannot overtake the request currently testing recovery.
 if(liveRecord(previous,now)&&previous.probeId&&previous.probeUntil>now&&claimId&&previous.probeId!==claimId){next[key]=previous;return next}
 if(ok){
  next[key]={at:now,ok:true,ms:previous?.ok?Math.round(previous.ms*0.75+ms*0.25):ms,failures:0,...(stage==='validation'&&credentialKey?{credentialKey,validatedAt:now}:{})};
  // Successful media is a useful ranking hint, but cannot clear an account
  // validation circuit: that endpoint has its own independent recovery probe.
  if(stage==='signal'){
   const account=next[accountKey(id)];
   if(!liveRecord(account,now)||account.ok===true&&!account.openUntil)next[accountKey(id)]={...account,at:now,ok:true,ms:account?.ms??ms,failures:0,...(credentialKey?{credentialKey,mediaAt:now}:{})};
  }
 }else{
  const fresh=liveRecord(previous,now)&&previous.at>now-PROVIDER_CIRCUIT_POLICY.failureWindowMs;
  const failures=fresh?(previous.failures||0)+1:1;
  const wasOpen=liveRecord(previous,now)&&previous.openUntil>0;
  const reopen=wasOpen||failures>=PROVIDER_CIRCUIT_POLICY.failureThreshold;
  const backoff=reopen?Math.min(PROVIDER_CIRCUIT_POLICY.maxCooldownMs,wasOpen?Math.max(PROVIDER_CIRCUIT_POLICY.initialCooldownMs,previous.backoff||0)*2:PROVIDER_CIRCUIT_POLICY.initialCooldownMs):0;
  next[key]={at:now,ok:false,ms,failures:Math.min(100,failures),...(stage==='signal'&&Number.isInteger(httpStatus)&&httpStatus>=400&&httpStatus<=599?{httpStatus}:{}),...(reopen?{backoff,openUntil:now+backoff}:{})};
 }
 return next;
}
export function rankProviderCandidates(candidates,health,mediaKey,now=Date.now()){
 const score=p=>{const a=health?.[accountKey(p.id)],c=health?.[channelKey(p.id,mediaKey)];
  const fresh=r=>r&&r.at>now-FRESH_MS;
  const cooling=r=>fresh(r)&&!r.ok&&r.at>now-COOLDOWN;
  return {p,cooling:!!(cooling(a)||cooling(c)),known:fresh(c)&&c.ok?2:fresh(a)&&a.ok?1:0,ms:fresh(c)&&c.ok?c.ms:30000};};
 return candidates.map(score).sort((a,b)=>Number(a.cooling)-Number(b.cooling)||b.known-a.known||a.ms-b.ms||a.p.occupied/a.p.maxConnections-b.p.occupied/b.p.maxConnections||(Number(b.p.expiresAt)||0)-(Number(a.p.expiresAt)||0)).map(s=>s.p);
}
export function providerHealthSummary(health,now=Date.now()){
 const groups=new Map();let lastObservedAt=null;
 for(const [key,r]of Object.entries(prune(health,now))){
  lastObservedAt=Math.max(lastObservedAt||0,r.at);if(!r.openUntil)continue;
  const scope=key.startsWith('account|')?'account':'media',type=scope==='account'?'all':key.split('|')[1];
  const state=r.openUntil>now?'open':r.probeUntil>now?'probing':'ready_to_probe',group=scope+':'+type+':'+state;
  const row=groups.get(group)||{scope,type:['live','movie','series','all'].includes(type)?type:'other',state,count:0,retryAfterMs:0};
  row.count++;row.retryAfterMs=Math.max(row.retryAfterMs,Math.max(r.openUntil||0,r.probeUntil||0)-now,0);groups.set(group,row);
 }
 return {policy:PROVIDER_CIRCUIT_POLICY,lastObservedAt,circuits:[...groups.values()],recentMediaFailures:recentMediaFailures(health,now)};
}

// Administrator-only diagnostic projection of existing observations. Never
// return storage keys, provider account IDs, credentials, leases or media URLs.
// Absence from this bounded, expiring snapshot is not proof of recovery.
export function recentMediaFailures(health,now=Date.now()){
 const groups=new Map();
 for(const [key,row]of Object.entries(prune(health,now))){
  if(row.ok!==false||!Number.isFinite(row.at)||row.at>now||!Number.isInteger(row.httpStatus)||row.httpStatus<400||row.httpStatus>599)continue;
  const [scope,type,server,id,ext,...account]=key.split('|');
  if(scope!=='channel'||!['live','movie','series'].includes(type)||!/^[a-zA-Z0-9_-]{1,80}$/.test(server||'')||!/^\d{1,16}$/.test(id||'')||!/^[a-zA-Z0-9]{1,10}$/.test(ext||'')||!account.join('|'))continue;
  const groupKey=[type,server,id,ext].join('|');
  const group=groups.get(groupKey)||{type,server,id,ext,lastObservedAt:row.at,httpStatuses:[],sourcesObserved:0};
  group.lastObservedAt=Math.max(group.lastObservedAt,row.at);group.sourcesObserved++;
  if(!group.httpStatuses.includes(row.httpStatus))group.httpStatuses.push(row.httpStatus);
  groups.set(groupKey,group);
 }
 return [...groups.values()].sort((a,b)=>b.lastObservedAt-a.lastObservedAt).slice(0,30).map(row=>({...row,httpStatuses:row.httpStatuses.sort((a,b)=>a-b)}));
}

// A private diagnostic hint comes only from an observed, lease-scoped 404.
// This comparison driver supports TS bytes; never silently change HLS format.
export function failedLive404Sample(health,pool,now=Date.now()){
 if(!pool?.lines?.length||pool.syncedAt<now-12*3600000)return null;
 for(const [key,row]of Object.entries(health||{}).filter(([,r])=>r?.ok===false&&r.httpStatus===404&&r.at>now-15*60000&&r.at<=now).sort((a,b)=>b[1].at-a[1].at)){
  const [scope,type,server,id,ext,...provider]=key.split('|');
  if(scope!=='channel'||type!=='live'||ext!=='ts'||!/^\d{1,16}$/.test(id||'')||!/^[a-zA-Z0-9_-]{1,80}$/.test(server||''))continue;
  if(pool.lines.some(p=>String(p.id)===provider.join('|')&&String(p.server||'ccf')===server))return {type,id,server,ext};
 }
 return null;
}
