// Only reachable through BACKUP_RECOVERY. No account, playback or public recovery routes.
import {backupRoute,readBackup,backupSettingKeys} from './backups.mjs';
import {hashSecret} from './security.mjs';
import {openLeaseStore} from './lease-store.mjs';
const same=(a,b)=>canonical(a)===canonical(b);
function canonical(value){
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export class BackupRecovery{
 constructor(state,env){this.state=state;this.env=env;this.running=false}
 async alarm(){await this.state.storage.deleteAll()}
 async fetch(req){
  if(req.method!=='POST'||new URL(req.url).pathname!=='/restore-drill')return Response.json({error:'not_found'},{status:404});
  if(this.running)return Response.json({error:'recovery_in_progress'},{status:409});
  this.running=true;let proof=null,failed=false;
  try{
   const body=await req.json(),snapshot=await readBackup(this.env,body.blob);
   if(!snapshot||await hashSecret(body.blob)!==body.checksum)throw Error('invalid_backup');
   const store=this.state.storage;
   if((await store.list({limit:1})).size)throw Error('nonempty_drill_target');
   // Cleanup still runs if the request/isolate stops before the finally block.
   await store.setAlarm(Date.now()+5*60000);
   const control='drill-'+crypto.randomUUID(),admin={id:'drill-admin',version:7,mfa:{enabled:true,secret:'synthetic-control'}},leases=await openLeaseStore(store);
   await store.put('admin',admin);await store.put('user:'+control,{username:control});
   for(const key of backupSettingKeys)await store.put(key,{synthetic:'obsolete-setting'});
   await store.transaction(tx=>leases.in(tx).put('drill-lease',{sid:'obsolete',uid:'obsolete',provider_id:'obsolete',until:Date.now()+60000}));
   const response=await backupRoute(store,this.env,'/backup-restore',{blob:body.blob,confirmation:body.checksum,confirmText:'RESTAURAR',actor:'recovery-drill'},leases);
   if(!response.ok)throw Error('restore_failed');
   const users=await store.list({prefix:'user:'});
   let identities=true,records=users.size===snapshot.users.length;
   for(const before of snapshot.users){
    const after=users.get('user:'+before.username);
    if(!after){records=false;identities=false;continue}
    const {id,version,updatedAt,...rest}=after,{id:oldId,version:oldVersion,updatedAt:oldTime,...expected}=before;
    records=records&&same(rest,expected);identities=identities&&typeof id==='string'&&id!==oldId&&version===oldVersion+1&&Number.isSafeInteger(updatedAt);
   }
   let settings=true;
   for(const key of backupSettingKeys)settings=settings&&same(await store.get(key),snapshot.settings[key]);
   const checks={userData:records,identitiesRotated:identities,settings,oldUsersRemoved:!await store.get('user:'+control),leasesCleared:(await leases.count())===0,administratorPreserved:same(await store.get('admin'),admin)};
   if(!Object.values(checks).every(value=>value===true))throw Error('restore_mismatch');
   proof={ok:true,checksum:body.checksum,checks};
  }catch{failed=true}
  finally{
   try{await this.state.storage.deleteAll();if((await this.state.storage.list({limit:1})).size)failed=true;if(this.state.storage.sql&&this.state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='smn_playback_leases'").toArray().length)failed=true}catch{failed=true}
   this.running=false;
  }
  return failed?Response.json({error:'recovery_failed'},{status:503}):Response.json({...proof,cleaned:true});
 }
}
