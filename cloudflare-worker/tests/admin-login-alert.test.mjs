import assert from 'node:assert/strict';
import {accountsFetch} from '../src/accounts.mjs';
import {recordRejectedAdminLogin,readAdminLoginAlert} from '../src/admin-login-alert.mjs';

class Storage{
 entries=new Map();
 queue=Promise.resolve();
 async get(key){return structuredClone(this.entries.get(key));}
 async put(key,value){this.entries.set(key,structuredClone(value));}
 async delete(key){return this.entries.delete(key);}
 async transaction(fn){
  const result=this.queue.then(()=>fn(this));
  this.queue=result.catch(()=>{});
  return result;
 }
}
const storage=new Storage(),env={ADMIN_SETUP_SECRET:'fictional-test-setup-key-for-admin-login',TICKET_SECRET:'b'.repeat(64)};
const start=Math.floor(Date.now()/300000)*300000+1000;
Date.now=()=>start;
const call=(action,body)=>accountsFetch({storage},env,new Request('https://internal/accounts/'+action,{method:'POST',body:JSON.stringify(body||{})}));
const login=(fields={})=>call('admin-login',{username:'owner',password:'wrong',client:'synthetic-held-out',...fields});
const state=async()=> (await (await call('security-status')).json()).loginAlert;
const password='fictional-owner-password';
assert.equal((await call('setup',{username:'owner',password,setupSecret:env.ADMIN_SETUP_SECRET})).status,200);
const admin=await storage.get('admin');
await storage.put('admin',{...admin,mfa:{enabled:true,secret:'unused-opaque-fixture',recovery:[]}});
const missing=await login({password});assert.equal((await missing.json()).error,'mfa_required');
assert.equal(await storage.get('admin-login-alert'),undefined);
for(let i=0;i<8;i++)assert.equal((await login()).status,401);
assert.equal((await login({password,code:'999999'})).status,401);
assert.equal((await state()).last,null);
assert.equal((await login()).status,429);
assert.deepEqual(await state(),{available:true,last:{detectedAt:start,minimumCount:10,windowMinutes:5}});
const first=await storage.get('admin-login-alert');
await Promise.all(Array.from({length:9},()=>recordRejectedAdminLogin(storage,start+100)));
assert.deepEqual(await storage.get('admin-login-alert'),first);
await recordRejectedAdminLogin(storage,start+300000);
assert.equal((await readAdminLoginAlert(storage,start+300001)).last.detectedAt,start);
assert.equal((await readAdminLoginAlert(storage,start+86400001)).last,null);
assert.deepEqual(Object.keys(first).sort(),['alertedAt','count','windowStart']);
console.log('PASS administrative login counter, privacy, threshold and expiry');
