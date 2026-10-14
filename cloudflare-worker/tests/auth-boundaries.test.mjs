import test from 'node:test';
import assert from 'node:assert/strict';
import {accountsFetch} from '../src/accounts.mjs';

class Store {
 data=new Map(); queue=Promise.resolve();
 async get(key){return structuredClone(this.data.get(key))}
 async put(key,value){this.data.set(key,structuredClone(value))}
 async delete(key){this.data.delete(key)}
 async list({prefix='' }={}){return new Map([...this.data].filter(([key])=>key.startsWith(prefix)).map(([key,value])=>[key,structuredClone(value)]))}
 transaction(fn){const result=this.queue.then(()=>fn(this));this.queue=result.catch(()=>{});return result}
}
async function fixture(){
 const state={storage:new Store()},env={ADMIN_SETUP_SECRET:'synthetic-setup-secret-never-deployed'},password='synthetic-owner-password';
 const call=async(path,body={})=>{const response=await accountsFetch(state,env,new Request('https://private/accounts/'+path,{method:'POST',body:JSON.stringify(body)}));return {status:response.status,data:await response.json()}};
 assert.equal((await call('setup',{setupSecret:env.ADMIN_SETUP_SECRET,username:'owner',password})).status,200);
 return {state,call,password};
}
test('administrator login requires its configured username as well as its password',async()=>{
 const f=await fixture();
 const wrong=await f.call('admin-login',{username:'different-admin',password:f.password,client:'client-a'});
 assert.equal(wrong.status,401);
 assert.equal(wrong.data.error,'invalid_credentials');
 assert.equal((await f.call('admin-login',{username:' OWNER ',password:f.password,client:'client-a'})).status,200);
});
test('rotating submitted administrator names cannot reset the per-client attempt limit',async()=>{
 const f=await fixture();
 for(let i=0;i<10;i++)assert.equal((await f.call('admin-login',{username:'invented-'+i,password:'wrong-password',client:'client-a'})).status,401);
 const blocked=await f.call('admin-login',{username:'owner',password:f.password,client:'client-a'});
 assert.equal(blocked.status,429);
 assert.equal(blocked.data.error,'try_later');
 assert.equal((await f.call('admin-login',{username:'owner',password:f.password,client:'client-b'})).status,200,'a blocked client does not lock out another network');
 const attempts=[...f.state.storage.data.keys()].filter(key=>key.startsWith('admin-attempt:'));
 assert.equal(attempts.length,1,'invented admin names cannot grow a counter per name');
});
