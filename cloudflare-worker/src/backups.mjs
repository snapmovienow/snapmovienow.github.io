import {seal,unseal,hashSecret,writeAudit} from './security.mjs';
const format='SNAP-encrypted-backup-v1';
const keys=['provider','providers','source-pools','pool','xtream-config'];
const validUser=u=>u&&/^[a-z0-9_.@-]{3,80}$/.test(u.username)&&typeof u.hash==='string'&&/^[a-f0-9]{64}$/.test(u.hash)&&typeof u.salt==='string'&&['active','suspended'].includes(u.status)&&Number.isSafeInteger(u.version);
async function exportSnapshot(store,env){
 const snapshot=await store.transaction(async tx=>{
  const users=[...(await tx.list({prefix:'user:'})).values()],settings={};
  for(const key of keys){const value=await tx.get(key);if(value!==undefined)settings[key]=value}
  return {format,environment:env.ENVIRONMENT||'production',createdAt:Date.now(),users,settings};
 });
 if(JSON.stringify(snapshot).length>2000000||snapshot.users.length>10000)return null;
 return {format,createdAt:snapshot.createdAt,blob:await seal(env,snapshot)};
}
export async function automaticBackup(store,env){
 if(env.ENVIRONMENT==='staging'||!await store.get('admin'))return {skipped:true};
 const exported=await exportSnapshot(store,env);if(!exported)return {error:'backup_too_large'};
 const id=new Date(exported.createdAt).toISOString().slice(0,10),prefix='auto-backup:'+id+':';
 await store.transaction(async tx=>{
  // Small chunks fit the Durable Object KV per-value limit.
  const parts=Math.ceil(exported.blob.length/16000);
  for(let i=0;i<parts;i++)await tx.put(prefix+i,exported.blob.slice(i*16000,(i+1)*16000));
  await tx.put('auto-backup-index:'+id,{id,format,createdAt:exported.createdAt,parts});
  const saved=[...(await tx.list({prefix:'auto-backup-index:'})).values()].sort((a,b)=>b.createdAt-a.createdAt);
  for(const old of saved.slice(3)){for(let i=0;i<old.parts;i++)await tx.delete('auto-backup:'+old.id+':'+i);await tx.delete('auto-backup-index:'+old.id)}
  await writeAudit(tx,'system','backup_automatic');
 });return {ok:true,id};
}
export async function backupRoute(store,env,path,b,leases){
 const answer=(data,status=200)=>Response.json(data,{status});
 if(path==='/backup-export'){
  const exported=await exportSnapshot(store,env);if(!exported)return answer({error:'backup_too_large'},413);
  await store.transaction(tx=>writeAudit(tx,b.actor,'backup_exported'));return answer(exported);
 }
 if(path==='/backup-list')return answer([...(await store.list({prefix:'auto-backup-index:'})).values()].map(({id,createdAt})=>({id,createdAt})).sort((a,b)=>b.createdAt-a.createdAt));
 if(path==='/backup-download'){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(b.id||''))return answer({error:'not_found'},404);
  const saved=await store.get('auto-backup-index:'+b.id);if(!saved)return answer({error:'not_found'},404);
  let blob='';for(let i=0;i<saved.parts;i++){const chunk=await store.get('auto-backup:'+saved.id+':'+i);if(typeof chunk!=='string')return answer({error:'invalid_backup'},400);blob+=chunk}
  await store.transaction(tx=>writeAudit(tx,b.actor,'backup_downloaded'));return answer({format,createdAt:saved.createdAt,blob});
 }
 const snapshot=await unseal(env,b.blob);
 if(snapshot?.format!==format||snapshot.environment!==(env.ENVIRONMENT||'production')||!Array.isArray(snapshot.users)||snapshot.users.length>10000||!snapshot.users.every(validUser)||new Set(snapshot.users.map(u=>u.username)).size!==snapshot.users.length||!snapshot.settings||typeof snapshot.settings!=='object'||Object.keys(snapshot.settings).some(k=>!keys.includes(k)))return answer({error:'invalid_backup'},400);
 if(snapshot.createdAt>Date.now()+60000||!Number.isSafeInteger(snapshot.createdAt))return answer({error:'invalid_backup'},400);
 const confirmation=await hashSecret(b.blob);
 const plan={users:snapshot.users.length,providers:snapshot.settings.providers?.length||(snapshot.settings.provider?1:0),createdAt:snapshot.createdAt,confirmation};
 if(path==='/backup-preview')return answer(plan);
 if(b.confirmation!==confirmation||b.confirmText!=='RESTAURAR')return answer({error:'restore_confirmation_required'},409);
 return store.transaction(async tx=>{
  // New user identities revoke every pre-restore web/Xtream session and ticket.
  const old=await tx.list({prefix:'user:'});for(const name of old.keys())await tx.delete(name);
  for(const user of snapshot.users)await tx.put('user:'+user.username,{...user,id:crypto.randomUUID(),version:user.version+1,updatedAt:Date.now()});
  for(const key of keys){if(Object.hasOwn(snapshot.settings,key))await tx.put(key,snapshot.settings[key]);else await tx.delete(key)}
  await leases.in(tx).clear();await writeAudit(tx,b.actor,'backup_restored');
  return answer({ok:true,users:plan.users,providers:plan.providers,customersMustSignInAgain:true});
 });
}
