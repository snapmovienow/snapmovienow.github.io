const kinds=new Set(['favorite','progress','preference']);
const safeId=value=>typeof value==='string'&&/^[a-zA-Z0-9_.:-]{1,180}$/.test(value);
function cleanPatch(p,now){
 if(!p||!kinds.has(p.kind)||!safeId(p.key)||!Number.isSafeInteger(p.updatedAt)||p.updatedAt<0||p.updatedAt>now+5*60000)return null;
 const result={kind:p.kind,key:p.key,updatedAt:Math.min(p.updatedAt,now)};
 // Native clients before 1.0.32 also sent the content reference when finishing.
 const completed=p.kind==='progress'&&p.deleted===true&&(p.completed===true||p.type==='movie'&&safeId(p.id)||p.type==='series'&&safeId(p.episodeId));
 if(p.kind==='preference'&&!['audio','subtitle'].includes(p.key))return null;
 if(p.deleted===true&&!completed)return {...result,deleted:true};
 if(p.kind==='preference'){
  if(!['audio','subtitle'].includes(p.key)||!['off','default'].includes(p.value)&&!/^[a-z]{2,3}$/.test(p.value||''))return null;
  return {...result,value:p.value};
 }
 if(!['movie','series','live'].includes(p.type)||!safeId(p.id)||!safeId(p.server||'ccf'))return null;
 Object.assign(result,{type:p.type,id:p.id,server:p.server||'ccf'});
 if(p.kind==='progress'){
  if(completed){
   if(p.key!==result.type+':'+result.server+':'+result.id||p.type==='live'||p.type==='series'&&!safeId(p.episodeId))return null;
   return {...result,deleted:true,completed:true,...(p.type==='series'?{episodeId:p.episodeId}:{})};
  }
  if(p.type==='live'||!Number.isFinite(p.time)||p.time<0||p.time>172800||!Number.isFinite(p.duration)||p.duration<0||p.duration>172800||p.episodeId&&!safeId(p.episodeId))return null;
  Object.assign(result,{time:Math.floor(p.time),duration:Math.floor(p.duration),...(p.episodeId?{episodeId:p.episodeId}:{})});
 }
 return result;
}
export function accountProfile(env,session,operation,patches){
 const id=env.PLAYBACK_SESSIONS.idFromName('profile:'+session.uid);
 return env.PLAYBACK_SESSIONS.get(id).fetch('https://private/profile/'+operation,{method:'POST',body:JSON.stringify({patches})});
}
export async function profileRoute(store,req){
 const b=await req.json(),now=Date.now();const answer=(d,s=200)=>Response.json(d,{status:s});
 if(req.url.endsWith('/get'))return answer(await store.get('profile')||{revision:0,records:[]});
 if(!Array.isArray(b.patches)||b.patches.length>160)return answer({error:'invalid_profile'},400);
 const patches=b.patches.map(p=>cleanPatch(p,now));if(patches.some(p=>!p))return answer({error:'invalid_profile'},400);
 return store.transaction(async tx=>{
  const old=await tx.get('profile')||{revision:0,records:[]},records=new Map(old.records.map(p=>[p.kind+':'+p.key,p]));
  for(const p of patches){const key=p.kind+':'+p.key,prior=records.get(key);if(!prior||p.updatedAt>prior.updatedAt||(p.updatedAt===prior.updatedAt&&p.deleted&&!prior.deleted))records.set(key,p)}
  const current=[...records.values()].filter(p=>!p.deleted||p.updatedAt>now-30*86400000).sort((a,b)=>b.updatedAt-a.updatedAt);
  const next={revision:old.revision+1,records:current.filter(p=>p.kind==='preference').concat(current.filter(p=>p.kind==='favorite').slice(0,100),current.filter(p=>p.kind==='progress').slice(0,50))};
  await tx.put('profile',next);return answer(next);
 });
}
