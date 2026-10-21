// Advisory performance metadata. Account/session authorization and capacity are
// still checked atomically for every allocation; no credentials are cached here.
const TTL=120000,COOLDOWN=15000,MAX=512;
const accountKey=id=>'account|'+id;
const channelKey=(id,key)=>'channel|'+key+'|'+id;
export function recordProviderHealth(old,id,mediaKey,ok,elapsedMs,stage,now=Date.now()){
 const entries=Object.entries(old||{}).filter(([,r])=>r?.at>now-TTL).sort((a,b)=>b[1].at-a[1].at).slice(0,MAX-2);
 const next=Object.fromEntries(entries),key=stage==='validation'?accountKey(id):channelKey(id,mediaKey);
 const previous=next[key],ms=Math.max(0,Math.min(30000,Number(elapsedMs)||0));
 next[key]={at:now,ok:ok===true,ms:ok&&previous?.ok?Math.round(previous.ms*0.75+ms*0.25):ms};
 if(ok&&stage==='signal')next[accountKey(id)]={at:now,ok:true,ms};
 return next;
}
export function rankProviderCandidates(candidates,health,mediaKey,now=Date.now()){
 const score=p=>{const a=health?.[accountKey(p.id)],c=health?.[channelKey(p.id,mediaKey)];
  const fresh=r=>r&&r.at>now-TTL;
  const cooling=r=>fresh(r)&&!r.ok&&r.at>now-COOLDOWN;
  return {p,cooling:!!(cooling(a)||cooling(c)),known:fresh(c)&&c.ok?2:fresh(a)&&a.ok?1:0,ms:fresh(c)&&c.ok?c.ms:30000};};
 return candidates.map(score).sort((a,b)=>Number(a.cooling)-Number(b.cooling)||b.known-a.known||a.ms-b.ms||a.p.occupied/a.p.maxConnections-b.p.occupied/b.p.maxConnections).map(s=>s.p);
}
