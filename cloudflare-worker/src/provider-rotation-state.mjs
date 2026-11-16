import {assignmentKey,saveAssignment} from './provider-assignment.mjs';

// Operator-controlled only. No customer/reseller request can alter this policy.
export const rotationEnabled=env=>env.PROVIDER_ROTATION_ENABLED!=='false';
export const ROTATION_POLICY=Object.freeze({enabled:true,minHours:24,targetHours:36,overdueHours:48,preferredMonths:3,minimumMonths:2,midnightPreference:true,activePlayback:'preserve'});

export function rememberProviderMedia(playback,group,lease,now=Date.now()){
 const entries={...playback.providerMedia,[group]:{uid:lease.uid,version:lease.version,provider_id:lease.provider_id,mediaKey:lease.mediaKey,lastSeenAt:now}};
 playback.providerMedia=Object.fromEntries(Object.entries(entries).sort((a,b)=>b[1].lastSeenAt-a[1].lastSeenAt).slice(0,16));
}

// The candidate is not a new durable home until its account validation succeeds.
// Compare the offered generation under the same directory transaction: late
// reports, parallel devices and canaries cannot overwrite a newer assignment.
export async function commitProviderRotation(store,lease,provider,now=Date.now()){
 const proposal=lease.rotation;if(!proposal||lease.canary||lease.providerFailed)return false;
 const key=assignmentKey(lease.uid),profile=await store.get(key),old=profile?.uid===lease.uid?profile.groups?.[proposal.group]:null;
 if(!old||old.provider_id!==proposal.previousProviderId||old.provider_key!==proposal.previousProviderKey||old.selectedAt!==proposal.previousSelectedAt||provider.id===old.provider_id||(provider.key||provider.id)===old.provider_key)return false;
 const selectedAt=Math.max(now,old.selectedAt+1),next=saveAssignment(profile,proposal.group,lease.uid,provider,selectedAt,{timeZone:proposal.timeZone,rotationCount:(old.rotationCount||0)+1});
 await store.put(key,next);
 const stats=await store.get('provider-rotation-stats')||{};
 await store.put('provider-rotation-stats',{completed:(stats.completed||0)+1,lastCompletedAt:now});
 return true;
}
