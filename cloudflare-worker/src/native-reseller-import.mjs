// Private signed migration of existing native users. No passwords are reset and
// no user, session, message, comment or expiry is removed by adoption.
import {contentPermissions} from './content-permissions.mjs';
import {writeAudit} from './security.mjs';
const answer=(value,status=200)=>Response.json(value,{status});
const username=value=>typeof value==='string'&&/^[a-z0-9_.@-]{3,80}$/.test(value);
const id=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(value);
function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);}
export async function nativeFingerprint(value){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),v=>v.toString(16).padStart(2,'0')).join('');}
export async function nativeResellerImport(store,path,b){
 if(!id(b.accountId))return answer({error:'bridge_input'},400);
 if(path==='/native-list'){
  const users=[...(await store.list({prefix:'user:'})).values()];if(users.length>1000)return answer({error:'bridge_import_limit'},409);
  return answer({ok:true,users:users.map(u=>({id:u.id,username:u.username,name:u.name||'',expiresAt:u.expiresAt,status:u.status,permissions:contentPermissions(u.permissions),managedBy:u.resellerBridge?.accountId||null}))});
 }
 if(!username(b.username))return answer({error:'bridge_input'},400);
 const key='native-adoption:'+b.accountId+':'+b.username;
 if(path==='/native-record'){
  const u=await store.get('user:'+b.username),saved=await store.get(key);if(!u)return answer({error:'bridge_import_missing'},404);
  if(u.resellerBridge&&!(saved&&u.resellerBridge.accountId===b.accountId&&u.resellerBridge.lineId===saved.lineId))return answer({error:'bridge_username_conflict'},409);
  const original=saved?.original||u;return answer({ok:true,record:original,sourceHash:saved?.sourceHash||await nativeFingerprint(original)});
 }
 if(!id(b.lineId)||typeof b.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(b.sourceHash))return answer({error:'bridge_input'},400);
 if(path==='/native-recover')return store.transaction(async tx=>{
  const u=await tx.get('user:'+b.username),saved=await tx.get(key),receipt=await tx.get('reseller-line:'+b.accountId+':'+b.lineId);
  if(!saved||saved.lineId!==b.lineId||saved.sourceHash!==b.sourceHash||saved.original?.username!==b.username||await nativeFingerprint(saved.original)!==b.sourceHash||receipt?.username!==b.username||receipt.revoked)return answer({error:'bridge_import_conflict'},409);
  if(u){if(u.resellerBridge?.accountId!==b.accountId||u.resellerBridge.lineId!==b.lineId)return answer({error:'bridge_username_conflict'},409);if(u.id===saved.original.id)return answer({ok:true,lineId:b.lineId,recovered:false});if(u.resellerBridge.native!==true)return answer({error:'bridge_import_conflict'},409);await tx.put('user:'+b.username,{...u,id:saved.original.id,version:Math.max(u.version,saved.original.version)+1,updatedAt:Date.now()});await writeAudit(tx,'reseller:'+b.accountId,'reseller_native_identity_recovered',b.lineId);return answer({ok:true,lineId:b.lineId,recovered:true,identityRestored:true,credentialsPreserved:true});}
  const original=saved.original;if(!/^[a-f0-9]{64}$/.test(original.hash||'')||typeof original.salt!=='string'||!original.salt||!Number.isSafeInteger(original.version))return answer({error:'bridge_import_credentials'},409);
  await tx.put('user:'+b.username,{...original,version:original.version+1,updatedAt:Date.now(),resellerBridge:{accountId:b.accountId,lineId:b.lineId,native:true}});
  await writeAudit(tx,'reseller:'+b.accountId,'reseller_native_recovered',b.lineId);
  return answer({ok:true,lineId:b.lineId,recovered:true,credentialsPreserved:true});
 });
 return store.transaction(async tx=>{
  const u=await tx.get('user:'+b.username),saved=await tx.get(key);if(!u)return answer({error:'bridge_import_missing'},404);
  if(saved){
   if(saved.lineId!==b.lineId||saved.sourceHash!==b.sourceHash||u.resellerBridge?.accountId!==b.accountId||u.resellerBridge?.lineId!==b.lineId)return answer({error:'bridge_import_conflict'},409);
   const {resellerBridge,...current}=u,unchanged=await nativeFingerprint(current)===saved.sourceHash;
   return answer({ok:true,lineId:b.lineId,replayed:true,unchanged,credentialsMatch:u.hash===saved.original.hash&&u.salt===saved.original.salt,sourceHash:saved.sourceHash});
  }
  if(path!=='/native-claim'||u.resellerBridge||await nativeFingerprint(u)!==b.sourceHash||await tx.get('reseller-line:'+b.accountId+':'+b.lineId))return answer({error:'bridge_import_conflict'},409);
  if(typeof u.hash!=='string'||typeof u.salt!=='string')return answer({error:'bridge_import_credentials'},409);
  await tx.put(key,{lineId:b.lineId,sourceHash:b.sourceHash,original:u,adoptedAt:Date.now()});
  await tx.put('user:'+b.username,{...u,resellerBridge:{accountId:b.accountId,lineId:b.lineId,native:true}});
  await tx.put('reseller-line:'+b.accountId+':'+b.lineId,{version:1,payloadHash:'native:'+b.sourceHash,username:b.username,revoked:false,native:true});
  return answer({ok:true,lineId:b.lineId,replayed:false,unchanged:true,credentialsMatch:true,sourceHash:b.sourceHash});
 });
}
