// A hint never reserves capacity or grants access. Recheck the local account,
// allowed provider inventory and atomic lease counts on every channel change.
// Legacy Xtream clients close TS before opening the next channel; bridge that
// short gap without retaining a connection slot or joining different viewers.
const GAP_MS=90000,VALIDATION_MS=30000,MAX_GROUPS=16;
export const affinityGroup=lease=>String(lease.providerServer||String(lease.mediaKey||'').split('|')[1]||'ccf');
export function pruneAffinities(state,now=Date.now()){
 state.affinities=Object.fromEntries(Object.entries(state.affinities||{}).filter(([,a])=>a?.until>now).sort((a,b)=>b[1].until-a[1].until).slice(0,MAX_GROUPS));
 return state;
}
export function providerAffinity(state,group,user,now=Date.now()){
 const a=pruneAffinities(state,now).affinities[group];
 return a?.uid===user.uid&&a.version===user.version?a:null;
}
export function rememberProvider(state,lease,now=Date.now()){
 pruneAffinities(state,now);
 if(lease.provider_id===undefined||lease.providerFailed||lease.until<=now)return state;
 state.affinities[affinityGroup(lease)]={provider_id:lease.provider_id,uid:lease.uid,version:lease.version,request_id:lease.request_id,credentialKey:lease.providerCredentialKey,validatedAt:lease.validatedAt||0,until:now+GAP_MS};
 return pruneAffinities(state,now);
}
export function forgetProvider(state,lease){
 const group=affinityGroup(lease),a=state.affinities?.[group];
 if(a?.provider_id===lease.provider_id&&a.request_id===lease.request_id)delete state.affinities[group];
 return state;
}
export const recentlyValidated=(lease,now=Date.now())=>lease?.validatedAt>now-VALIDATION_MS&&lease.validatedAt<=now;
