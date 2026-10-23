// Durable preference only: never a lease, an authorization or a reserved slot.
// Local user checks, current inventory, circuits and atomic capacity still win.
export const assignmentKey=uid=>'provider-assignment:'+uid;
export const usableProvider=(p,now=Date.now())=>p&&(!p.status||p.status==='active')&&(!p.expiresAt||p.expiresAt>now);
export function assignedProvider(profile,group,uid,lines,now=Date.now()){
 const binding=profile?.uid===uid?profile.groups?.[group]:null;
 return binding&&lines.find(p=>p.id===binding.provider_id&&(p.key||p.id)===binding.provider_key&&usableProvider(p,now));
}
export function saveAssignment(profile,group,uid,provider,now=Date.now()){
 const groups={...(profile?.uid===uid?profile.groups:{})};
 groups[group]={provider_id:provider.id,provider_key:provider.key||provider.id,selectedAt:now};
 return {uid,groups:Object.fromEntries(Object.entries(groups).sort((a,b)=>b[1].selectedAt-a[1].selectedAt).slice(0,16))};
}
export function mediaRecentlyFailed(health,id,mediaKey,now=Date.now()){
 const row=health?.['channel|'+mediaKey+'|'+id];return row?.ok===false&&row.at>now-120000;
}
export function recentAccountProof(health,provider,poolSyncedAt,now=Date.now()){
 const row=health?.['account|'+provider.id],at=Math.max(row?.validatedAt||0,row?.mediaAt||0);
 return !!provider.credentialKey&&row?.ok===true&&!row.openUntil&&row.credentialKey===provider.credentialKey&&poolSyncedAt>now-120000&&at>now-120000&&at<=now?at:0;
}
