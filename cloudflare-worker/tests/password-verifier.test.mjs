import assert from 'node:assert/strict';
import {accountsFetch,passwordHash} from '../src/accounts.mjs';
import {nativeFingerprint,nativeResellerImport} from '../src/native-reseller-import.mjs';
import {backupRoute,readBackup} from '../src/backups.mjs';
import {seal,unseal} from '../src/security.mjs';
import {newVerifier} from '../src/password-verifier.mjs';

class Store {
 data=new Map();
 queue=Promise.resolve();
 async get(k){return structuredClone(this.data.get(k));}
 async put(k,v){this.data.set(k,structuredClone(v));}
 async delete(k){this.data.delete(k);}
 async setAlarm(){}
 async list({prefix}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)));}
 transaction(fn){const p=this.queue.then(()=>fn(this));this.queue=p.catch(()=>{});return p;}
}
const storage=new Store(),state={storage},env={TICKET_SECRET:'synthetic-test-key-only-for-unit-test-123456',PASSWORD_UPGRADE_ENABLED:'true'};
const password='Synthetic-before-migration',salt='legacy-salt',username='nativecustomer';
const original={username,id:'user-native',version:1,status:'active',expiresAt:Date.now()+86400000,salt,hash:await passwordHash(password,salt)};
await storage.put('user:'+username,original);
const claim={accountId:'reseller',lineId:'native-line',username,sourceHash:await nativeFingerprint(original)};
assert.equal((await nativeResellerImport(storage,'/native-claim',claim)).status,200);
const call=(path,body,config=env)=>accountsFetch(state,config,new Request('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)}));
assert.equal((await call('/login',{username,password:'wrong'})).status,401);
assert.equal((await storage.get('user:'+username)).salt,salt);
for(const response of await Promise.all([call('/login',{username,password}),call('/login',{username,password})]))assert.equal(response.status,200);
const protectedUser=await storage.get('user:'+username);
assert.match(protectedUser.salt,/^snap-pw-v1\$/);assert.notEqual(protectedUser.hash,original.hash);
assert.equal(protectedUser.version,original.version);
assert.equal((await call('/login',{username,password},{})).status,503);
assert.equal((await call('/login',{username,password},{...env,PASSWORD_UPGRADE_ENABLED:'false'})).status,200);
const replay=await(await nativeResellerImport(storage,'/native-verify',claim,env)).json();
assert.ok(replay.unchanged&&replay.credentialsMatch);
assert.match((await newVerifier(password,env)).salt,/^snap-pw-v1\$/);
const exported=await(await backupRoute(storage,env,'/backup-export',{actor:'synthetic'},{})).json();
const snapshot=await readBackup(env,exported.blob);
assert.equal(snapshot.users[0].hash,protectedUser.hash);
assert.ok(!JSON.stringify(await unseal(env,exported.blob)).includes(env.TICKET_SECRET));
const wrong={...env,TICKET_SECRET:'different-test-key-that-is-long-enough'};
assert.equal(await readBackup(wrong,exported.blob),null);
const incompatible=await seal(wrong,snapshot);
await assert.rejects(readBackup(wrong,incompatible),/password_key_unavailable/);
assert.equal((await call('/backup-preview',{blob:incompatible},wrong)).status,503);
console.log('PASS: keyed password migration, concurrent login, compatible rollback, native records and backup recovery');
// Import captured a native user before its first successful migrated login.
const second={...original,username:'secondnative',id:'user-second'};
await storage.put('user:'+second.username,second);
const secondClaim={...claim,lineId:'second-line',username:second.username,sourceHash:await nativeFingerprint(second),originalVerifier:{salt:second.salt,hash:second.hash}};
assert.equal((await call('/login',{username:second.username,password})).status,200);
const bad={...secondClaim,originalVerifier:{...secondClaim.originalVerifier,hash:'f'.repeat(64)}};
assert.equal((await nativeResellerImport(storage,'/native-claim',bad,env)).status,409);
assert.equal((await nativeResellerImport(storage,'/native-claim',secondClaim,env)).status,200);
assert.equal((await(await nativeResellerImport(storage,'/native-verify',secondClaim,env)).json()).credentialsMatch,true);
