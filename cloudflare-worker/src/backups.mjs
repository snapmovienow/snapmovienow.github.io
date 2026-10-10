import {seal,unseal,hashSecret,writeAudit} from './security.mjs';
const format='SNAP-encrypted-backup-v1';
const keys=['provider','providers','source-pools','pool','xtream-config'];
const statusKey='backup-status',chunkSize=16000;
const drillKey='backup-drill-status',freshness=36*3600000;
export const backupSettingKeys=Object.freeze([...keys]);
const validUser=u=>u&&/^[a-z0-9_.@-]{3,80}$/.test(u.username)&&typeof u.hash==='string'&&/^[a-f0-9]{64}$/.test(u.hash)&&typeof u.salt==='string'&&u.salt.length>0&&['active','suspended'].includes(u.status)&&Number.isSafeInteger(u.version)&&u.version>=1&&u.version<Number.MAX_SAFE_INTEGER&&(u.expiresAt==null||Number.isFinite(u.expiresAt)&&u.expiresAt>0)&&(u.permissions===undefined||u.permissions&&typeof u.permissions==='object'&&['movies','series','tv','adults'].every(k=>u.permissions[k]===undefined||typeof u.permissions[k]==='boolean'));
function validSnapshot(snapshot,env){
 return snapshot?.format===format&&snapshot.environment===(env.ENVIRONMENT||'production')&&Array.isArray(snapshot.users)&&snapshot.users.length<=10000&&snapshot.users.every(validUser)&&new Set(snapshot.users.map(u=>u.username)).size===snapshot.users.length&&snapshot.settings&&typeof snapshot.settings==='object'&&!Array.isArray(snapshot.settings)&&Object.keys(snapshot.settings).every(k=>keys.includes(k))&&Number.isSafeInteger(snapshot.createdAt)&&snapshot.createdAt>0&&snapshot.createdAt<=Date.now()+60000;
}
const planFor=snapshot=>({users:snapshot.users.length,providers:snapshot.settings.providers?.length||(snapshot.settings.provider?1:0),createdAt:snapshot.createdAt});
export async function readBackup(env,blob){
 if(typeof blob!=='string'||blob.length>4000000)return null;
 const snapshot=await unseal(env,blob);return validSnapshot(snapshot,env)?snapshot:null;
}
async function exportSnapshot(store,env){
 const snapshot=await store.transaction(async tx=>{
  const users=[...(await tx.list({prefix:'user:'})).values()],settings={};
  for(const key of keys){const value=await tx.get(key);if(value!==undefined)settings[key]=value}
  return {format,environment:env.ENVIRONMENT||'production',createdAt:Date.now(),users,settings};
 });
 if(JSON.stringify(snapshot).length>2000000||snapshot.users.length>10000)return null;
 return {format,createdAt:snapshot.createdAt,blob:await seal(env,snapshot)};
}
async function deleteChunks(tx,id){for(const key of (await tx.list({prefix:'auto-backup:'+id+':'})).keys())await tx.delete(key)}
export async function automaticBackup(store,env,{manual=false,actor='system'}={}){
 if((!manual&&env.ENVIRONMENT==='staging')||!await store.get('admin'))return {skipped:true};
 const runId=crypto.randomUUID(),attemptAt=Date.now();
 const claimed=await store.transaction(async tx=>{
  const old=await tx.get(statusKey)||{};
  if(old.status==='running'&&old.attemptAt>attemptAt-10*60000)return false;
  await tx.put(statusKey,{...old,status:'running',runId,attemptAt,reason:null,...(!manual?{automaticStatus:'running',automaticAttemptAt:attemptAt,automaticReason:null}:{})});return true;
 });
 if(!claimed)return {error:'backup_in_progress'};
 try{
  const exported=await exportSnapshot(store,env);
  if(!exported)throw Error('backup_too_large');
  const id=new Date(exported.createdAt).toISOString().slice(0,10),checksum=await hashSecret(exported.blob);
  const result=await store.transaction(async tx=>{
   const status=await tx.get(statusKey);if(status?.runId!==runId)return {error:'backup_in_progress'};
   // Replace every chunk atomically, including leftovers from older, larger copies.
   await deleteChunks(tx,id);
   const parts=Math.ceil(exported.blob.length/chunkSize);
   for(let i=0;i<parts;i++)await tx.put('auto-backup:'+id+':'+i,exported.blob.slice(i*chunkSize,(i+1)*chunkSize));
   await tx.put('auto-backup-index:'+id,{id,format,createdAt:exported.createdAt,parts,checksum,source:manual?'manual':'automatic'});
   const saved=[...(await tx.list({prefix:'auto-backup-index:'})).values()].sort((a,b)=>b.createdAt-a.createdAt);
   for(const old of saved.slice(3)){await deleteChunks(tx,old.id);await tx.delete('auto-backup-index:'+old.id)}
   const {runId:unused,...previous}=status,completedAt=Date.now();
   await tx.put(statusKey,{...previous,status:'success',attemptAt,completedAt,lastSuccessAt:exported.createdAt,lastSuccessId:id,reason:null,...(!manual?{automaticStatus:'success',automaticCompletedAt:completedAt,lastAutomaticAt:exported.createdAt,automaticReason:null}:{})});
   await writeAudit(tx,actor,manual?'backup_created':'backup_automatic');return {ok:true,id,createdAt:exported.createdAt};
  });
  // A recovery failure must never discard an otherwise valid backup.
  if(result.ok&&env.BACKUP_RECOVERY)result.recovery=await runBackupDrill(store,env,{id:result.id,actor}).catch(()=>({error:'recovery_failed'}));
  return result;
 }catch(error){
  const reason=error.message==='backup_too_large'?'backup_too_large':'backup_failed';
  // Persist only an allowlisted reason; provider credentials and exception text stay private.
  await store.transaction(async tx=>{const current=await tx.get(statusKey);if(current?.runId===runId){const {runId:unused,...status}=current;await tx.put(statusKey,{...status,status:'failed',completedAt:Date.now(),reason,...(!manual?{automaticStatus:'failed',automaticCompletedAt:Date.now(),automaticReason:reason}:{})});await writeAudit(tx,actor,'backup_failed')}});
  return {error:reason};
 }
}
async function savedCopy(store,id){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(id||''))return {error:'not_found'};
 return store.transaction(async tx=>{
  const saved=await tx.get('auto-backup-index:'+id);if(!saved)return {error:'not_found'};
  if(saved.id!==id||saved.format!==format||!Number.isSafeInteger(saved.parts)||saved.parts<1||saved.parts>250)return {error:'invalid_backup'};
  let blob='';for(let i=0;i<saved.parts;i++){const chunk=await tx.get('auto-backup:'+id+':'+i);if(typeof chunk!=='string'||chunk.length>chunkSize)return {error:'invalid_backup'};blob+=chunk}
  if(saved.checksum&&await hashSecret(blob)!==saved.checksum)return {error:'invalid_backup'};
  return {...saved,blob};
 });
}
async function matchingCopy(tx,id,createdAt,checksum){
 const current=await tx.get('auto-backup-index:'+id);
 if(!current||current.createdAt!==createdAt)return null;
 let actual=current.checksum;
 if(!actual){let blob='';for(let i=0;i<current.parts;i++){const part=await tx.get('auto-backup:'+id+':'+i);if(typeof part!=='string')return null;blob+=part}actual=await hashSecret(blob)}
 return actual===checksum?current:null;
}
export async function runBackupDrill(store,env,b){
 if(!env.BACKUP_RECOVERY)return {error:'recovery_unavailable'};
 const fromFile=typeof b.blob==='string',saved=fromFile?null:await savedCopy(store,b.id);
 if(saved?.error)return saved;
 const blob=fromFile?b.blob:saved.blob,snapshot=await readBackup(env,blob);
 if(!snapshot||saved&&saved.createdAt!==snapshot.createdAt)return {error:'invalid_backup'};
 const checksum=await hashSecret(blob),runId=crypto.randomUUID(),attemptAt=Date.now();
 const claimed=await store.transaction(async tx=>{
  const previous=await tx.get(drillKey)||{};
  if(previous.status==='running'&&previous.attemptAt>attemptAt-10*60000)return false;
  await tx.put(drillKey,{...previous,status:'running',runId,attemptAt,reason:null});return true;
 });
 if(!claimed)return {error:'recovery_in_progress'};
 try{
  // This binding has a different SQLite class/namespace; never forward a directory ID.
  const target=env.BACKUP_RECOVERY.get(env.BACKUP_RECOVERY.newUniqueId());
  const response=await target.fetch('https://private/restore-drill',{method:'POST',body:JSON.stringify({blob,checksum})});
  const result=await response.json();
  if(!response.ok||result.ok!==true||result.cleaned!==true||result.checksum!==checksum)throw Error('recovery_failed');
  const completedAt=Date.now(),id=new Date(snapshot.createdAt).toISOString().slice(0,10);
  const proof={status:'success',attemptAt,completedAt,backupCreatedAt:snapshot.createdAt,checksum,source:fromFile?'file':'server',...planFor(snapshot),checks:result.checks,cleaned:true,reason:null};
  const recorded=await store.transaction(async tx=>{
   const current=await tx.get(drillKey);if(current?.runId!==runId)return false;
   const index=await matchingCopy(tx,id,snapshot.createdAt,checksum);
   if(!fromFile&&!index)return false;
   if(index)await tx.put('auto-backup-index:'+id,{...index,checksum,verifiedAt:completedAt,restoredAt:completedAt,restoredChecksum:checksum,...(fromFile?{fileCheckedAt:completedAt}:{})});
   await tx.put(drillKey,{...proof,lastSuccessAt:completedAt,lastFileCheckAt:fromFile?completedAt:current.lastFileCheckAt||null,lastFileChecksum:fromFile?checksum:current.lastFileChecksum||null});
   await writeAudit(tx,b.actor,'backup_drill_verified');return true;
  });
  if(!recorded)throw Error('backup_changed');
  return {ok:true,...proof};
 }catch(error){
  const reason=error.message==='backup_changed'?'backup_changed':'recovery_failed';
  await store.transaction(async tx=>{const current=await tx.get(drillKey);if(current?.runId===runId){const {runId:unused,...status}=current;await tx.put(drillKey,{...status,status:'failed',completedAt:Date.now(),reason});await writeAudit(tx,b.actor,'backup_drill_failed')}});
  return {error:reason};
 }
}
export async function backupRoute(store,env,path,b,leases){
 const answer=(data,status=200)=>Response.json(data,{status});
 if(path==='/backup-create'){const result=await automaticBackup(store,env,{manual:true,actor:b.actor});return answer(result,result.error?(result.error==='backup_in_progress'?409:500):200)}
 if(path==='/backup-drill'){const result=await runBackupDrill(store,env,b);return answer(result,result.error?(['recovery_in_progress','backup_changed'].includes(result.error)?409:result.error==='not_found'?404:result.error==='invalid_backup'?400:503):200)}
 if(path==='/backup-export'){
  const exported=await exportSnapshot(store,env);if(!exported)return answer({error:'backup_too_large'},413);
  await store.transaction(tx=>writeAudit(tx,b.actor,'backup_exported'));return answer(exported);
 }
 if(path==='/backup-list')return answer([...(await store.list({prefix:'auto-backup-index:'})).values()].map(({id,createdAt,verifiedAt,restoredAt,fileCheckedAt,source})=>({id,createdAt,verifiedAt:verifiedAt||null,restoredAt:restoredAt||null,fileCheckedAt:fileCheckedAt||null,source:source||'unknown'})).sort((a,b)=>b.createdAt-a.createdAt));
 if(path==='/backup-status')return store.transaction(async tx=>{
  const latest=[...(await tx.list({prefix:'auto-backup-index:'})).values()].sort((a,b)=>b.createdAt-a.createdAt)[0],stored=await tx.get(statusKey)||{};
  const lastSuccessAt=stored.lastSuccessAt||latest?.createdAt||null;
  const {runId:unused,...recovery}=await tx.get(drillKey)||{};
  return answer({status:stored.status||'unknown',attemptAt:stored.attemptAt||null,completedAt:stored.completedAt||null,reason:stored.reason||null,lastSuccessAt,lastSuccessId:stored.lastSuccessId||latest?.id||null,latestVerifiedAt:latest?.verifiedAt||null,stale:!lastSuccessAt||Date.now()-lastSuccessAt>freshness,automaticStatus:stored.automaticStatus||'unknown',automaticAttemptAt:stored.automaticAttemptAt||null,automaticReason:stored.automaticReason||null,lastAutomaticAt:stored.lastAutomaticAt||null,automaticStale:!stored.lastAutomaticAt||Date.now()-stored.lastAutomaticAt>freshness,recovery:sanitizeProof(recovery),latestRestoredAt:latest?.restoredChecksum===latest?.checksum?latest?.restoredAt||null:null,latestFileCheckedAt:latest?.fileCheckedAt||null,scheduleUTC:'05:17',retainedCopies:3});
 });
 if(path==='/backup-download'||path==='/backup-verify'){
  const saved=await savedCopy(store,b.id);if(saved.error)return answer(saved,saved.error==='not_found'?404:400);
  const snapshot=await unseal(env,saved.blob);if(!validSnapshot(snapshot,env)||snapshot.createdAt!==saved.createdAt)return answer({error:'invalid_backup'},400);
  if(path==='/backup-download'){await store.transaction(async tx=>{await tx.put('backup-download-status',{preparedAt:Date.now(),createdAt:saved.createdAt,checksum:await hashSecret(saved.blob)});await writeAudit(tx,b.actor,'backup_downloaded')});return answer({format,createdAt:saved.createdAt,blob:saved.blob})}
  const verifiedAt=Date.now(),checksum=await hashSecret(saved.blob);
  const current=await store.transaction(async tx=>{
   const index=await tx.get('auto-backup-index:'+b.id);
   // Verification of an overwritten copy must not certify the replacement.
   if(!index||index.createdAt!==saved.createdAt||index.checksum&&index.checksum!==checksum)return false;
   await tx.put('auto-backup-index:'+b.id,{...index,checksum,verifiedAt});await writeAudit(tx,b.actor,'backup_verified');return true;
  });
  if(!current)return answer({error:'backup_changed'},409);
  return answer({...planFor(snapshot),verified:true,verifiedAt});
 }
 const snapshot=await unseal(env,b.blob);
 if(!validSnapshot(snapshot,env))return answer({error:'invalid_backup'},400);
 const confirmation=await hashSecret(b.blob),plan={...planFor(snapshot),confirmation};
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
function sanitizeProof(proof){
 if(!proof.status)return {status:'unknown'};
 const names=['status','attemptAt','completedAt','reason','backupCreatedAt','checksum','source','users','providers','checks','cleaned','lastSuccessAt','lastFileCheckAt','lastFileChecksum'];
 return Object.fromEntries(names.filter(name=>Object.hasOwn(proof,name)).map(name=>[name,proof[name]]));
}
