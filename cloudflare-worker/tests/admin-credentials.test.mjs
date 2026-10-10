import assert from 'node:assert/strict';
import {accountsFetch} from '../src/accounts.mjs';
import {totp,unseal} from '../src/security.mjs';
class Store{data=new Map();async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){this.data.delete(k)}async list({prefix='' }={}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))}async transaction(fn){const before=structuredClone(this.data);try{return await fn(this)}catch(e){this.data=before;throw e}}}
const store=new Store(),env={TICKET_SECRET:'synthetic-rotation-secret-at-least-32',ADMIN_SETUP_SECRET:'synthetic-setup-secret-at-least-32'},state={storage:store};const realNow=Date.now;let now=realNow();Date.now=()=>now;
const call=async(path,extra={})=>{const r=await accountsFetch(state,env,new Request('https://private/accounts/'+path,{method:'POST',body:JSON.stringify({actor:'owner',...extra})}));return {status:r.status,data:await r.json()}};
let password='synthetic-owner-password';const code=seed=>totp(seed,Math.floor(now/30000));
try{
 assert.equal((await call('setup',{setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password})).status,200);
 const begin=(await call('mfa-begin',{password})).data;const confirmed=(await call('mfa-confirm',{password,code:await code(begin.seed)})).data;const oldVersion=(await store.get('admin')).version;
 now+=30000;
 assert.equal((await call('mfa-replace-begin',{password,code:confirmed.recoveryCodes[0]})).status,401,'recovery codes cannot replace the authenticator');
 const replacement=await call('mfa-replace-begin',{password,code:await code(begin.seed)});assert.equal(replacement.status,200);assert.notEqual(replacement.data.seed,begin.seed);assert.equal((await store.get('admin')).mfa.enabled,true);assert.equal((await store.get('admin')).version,oldVersion,'starting replacement keeps the old protection/session');
 assert.equal((await call('mfa-confirm',{password,code:'invalid'})).status,401);assert.equal((await unseal(env,(await store.get('admin')).mfa.secret)).seed,begin.seed);
 const replaced=await call('mfa-confirm',{password,code:await code(replacement.data.seed)});assert.equal(replaced.status,200);assert.equal(replaced.data.replaced,true);assert.equal(replaced.data.recoveryCodes.length,8);assert.equal((await store.get('admin')).version,oldVersion+1);assert.equal((await unseal(env,(await store.get('admin')).mfa.secret)).seed,replacement.data.seed);
 now+=30000;assert.equal((await call('admin-login',{username:'owner',password,code:await code(begin.seed)})).status,401);assert.equal((await call('admin-login',{username:'owner',password,code:confirmed.recoveryCodes[1]})).status,401);
 assert.equal((await call('admin-password',{password:'wrong',newPassword:'synthetic-new-password',code:await code(replacement.data.seed)})).status,401);assert.equal((await call('admin-password',{password,newPassword:'short',code:await code(replacement.data.seed)})).status,400);assert.equal((await call('admin-password',{password,newPassword:password,code:await code(replacement.data.seed)})).status,400);
 const changed=await call('admin-password',{password,newPassword:'synthetic-new-password',code:await code(replacement.data.seed)});assert.equal(changed.status,200);assert.equal(changed.data.signInAgain,true);assert.equal((await store.get('admin')).version,oldVersion+2);assert.equal((await store.get('admin')).mfa.enabled,true);
 now+=30000;assert.equal((await call('admin-login',{username:'owner',password,code:await code(replacement.data.seed)})).status,401);password='synthetic-new-password';assert.equal((await call('admin-login',{username:'owner',password,code:await code(replacement.data.seed)})).status,200);
 now+=30000;await call('mfa-replace-begin',{password,code:await code(replacement.data.seed)});now+=11*60000;assert.equal((await call('mfa-confirm',{password,code:'123456'})).status,409);assert.equal((await unseal(env,(await store.get('admin')).mfa.secret)).seed,replacement.data.seed,'expired replacement preserves current authenticator');
 const audit=JSON.stringify(await store.get('security-audit'));assert.ok(audit.includes('admin_password_changed'));assert.ok(audit.includes('mfa_replaced'));for(const secret of [password,begin.seed,replacement.data.seed,confirmed.recoveryCodes[1]])assert.ok(!audit.includes(secret));
 console.log('PASS: protected password rotation, fresh authenticator replacement without disabling current MFA, old seed/recovery rejection, expiry safety and private audit.');
}finally{Date.now=realNow}
