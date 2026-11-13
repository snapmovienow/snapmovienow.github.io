import test from 'node:test';
import assert from 'node:assert/strict';
import {accountsFetch} from '../src/accounts.mjs';
import {TRUSTED_RESELLERS} from '../src/reseller-trust.mjs';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve();}
 async get(key){return structuredClone(this.data.get(key));}
 async put(key,value){this.data.set(key,structuredClone(value));}
 async delete(key){this.data.delete(key);}
 async setAlarm(){}
 async list({prefix}){return new Map([...this.data].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key,structuredClone(value)]));}
 transaction(fn){const work=this.queue.then(()=>fn(this));this.queue=work.catch(()=>{});return work;}
}
const fixture=()=>{const store=new Store(),call=(path,body={})=>accountsFetch({storage:store},{},new Request('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)}));const okay=async response=>{const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return data;};return {store,call,okay};};
test('main administrator stores original spelling and returns it from saves, lists and login',async()=>{
 const f=fixture(),password='Synthetic-password-123',expiresAt=Date.now()+86400000;
 for(const username of ['JuAnPeRez2026','mArIaCase123','MIXEDlower42']){
  const created=await f.okay(await f.call('/save',{create:true,username,password,status:'active',expiresAt}));assert.equal(created.username,username);
  const stored=await f.store.get('user:'+username.toLowerCase());assert.equal(stored.displayUsername,username);
  const listed=await f.okay(await f.call('/users'));assert.equal(listed.find(row=>row.id===created.id).username,username);
  for(const input of [username,username.toLowerCase(),username.toUpperCase()])assert.equal((await f.okay(await f.call('/login',{username:input,password,client:'synthetic-case'}))).username,username);
  assert.equal((await f.call('/save',{create:true,username:username.toUpperCase(),password,status:'active',expiresAt})).status,409);
  const edited=await f.okay(await f.call('/save',{create:false,username:username.toLowerCase(),name:'Updated label',status:'active',expiresAt,updatedAt:stored.updatedAt}));assert.equal(edited.username,username);assert.equal(edited.id,created.id);
 }
 assert.equal((await f.okay(await f.call('/users'))).length,3);
});
test('every reseller scope retains mixed spelling and permits its own case-only edit without another account',async()=>{
 const f=fixture(),password='Synthetic-reseller-password-123';
 for(const [i,scope] of TRUSTED_RESELLERS.entries()){
  const accountId=scope.accountId,lineId='case-line-'+i,username='ClIeNtECase'+i,expiresAt=Date.now()+3600000;
  const reserve={accountId,lineId,username,operationKey:'a'.repeat(43),payloadHash:'b'.repeat(64)};
  await f.okay(await f.call('/reseller-reserve',reserve));
  const body={accountId,lineId,username,version:1,revoke:false,password,name:'Fictitious client',comments:'',status:'active',expiresAt,createdAt:Date.now(),connections:3,permissions:{movies:true,series:true,tv:true,adults:false}};
  await f.okay(await f.call('/reseller-apply',body));
  const login=await f.okay(await f.call('/login',{username,password,client:'scope-case'}));assert.equal(login.username,username);
  const stored=await f.store.get('user:'+username.toLowerCase()),corrected='cLiEnTeCaSe'+i;
  await f.okay(await f.call('/reseller-reserve',{...reserve,username:corrected,previousUsername:username,operationKey:'c'.repeat(43),payloadHash:'d'.repeat(64)}));
  const changed=await f.okay(await f.call('/reseller-apply',{...body,username:corrected,previousUsername:username,version:2}));assert.equal(changed.sessionsRevoked,false);
  const after=await f.store.get('user:'+username.toLowerCase());assert.equal(after.id,stored.id);assert.equal(after.version,stored.version);assert.equal(after.hash,stored.hash);assert.equal(after.displayUsername,corrected);
  assert.equal((await f.okay(await f.call('/login',{username:corrected,password,client:'case-edited'}))).username,corrected);
  assert.equal((await f.call('/reseller-reserve',{...reserve,accountId:'foreign-scope',lineId:'foreign-line'})).status,409);
 }
 assert.equal((await f.store.list({prefix:'user:'})).size,TRUSTED_RESELLERS.length);
});
