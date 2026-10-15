import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const ctx=vm.createContext({performance,AbortSignal});vm.runInContext(readFileSync(new URL('../session-client.js',import.meta.url),'utf8'),ctx);const client=ctx.SMNSessionClient;
const data=new Map(),storage={getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
for(const bad of ['not JSON',JSON.stringify({username:'alice',password:'old-plaintext',access_token:'legacy'}),JSON.stringify({username:'alice',access_token:'legacy'})]){storage.setItem('smn_session',bad);assert.equal(client.read(storage,{cookieMode:true}),null);assert.equal(storage.getItem('smn_session'),null)}
client.write(storage,{username:'alice',password:'never-save',access_token:'secret-token'},{cookieMode:true});assert.deepEqual(JSON.parse(storage.getItem('smn_session')),{username:'alice',access_token:'cookie'});
let session=client.read(storage,{cookieMode:true}),generation=1,release,last;
const api=client.transport({url:'https://api.snaptvnow.com',cookieMode:true,getSession:()=>session,getGeneration:()=>generation,request:async(u,o)=>{last=o;return new Promise(r=>release=r)}});
const old=api('profile_get',{username:'bob',password:'bad',access_token:'bad',op:'logout'});assert.equal(JSON.parse(last.body).username,'alice');assert.equal(JSON.parse(last.body).op,'profile_get');assert.equal(JSON.parse(last.body).access_token,undefined);assert.equal(last.credentials,'include');session={username:'bob',access_token:'cookie'};release({records:[]});await assert.rejects(old,/session_changed/);
const pending=api('profile_get');generation++;release({records:[]});await assert.rejects(pending,/session_changed/);
session=null;await assert.rejects(api('vod'),/session_required/);
const timed=vm.createContext({performance,AbortSignal:{timeout:ms=>({deadline:ms})}});vm.runInContext(readFileSync(new URL('../session-client.js',import.meta.url),'utf8'),timed);
const current={username:'alice',access_token:'cookie'};let responseTime=25000;
const timedApi=timed.SMNSessionClient.transport({url:'https://api.snaptvnow.com',cookieMode:true,getSession:()=>current,getGeneration:()=>1,request:async(_url,{signal})=>{if(responseTime>signal.deadline)throw Error('connection_timeout');return {url:'prepared-video'};}});
assert.equal((await timedApi('gnula_token')).url,'prepared-video','a source that resolves after 25 seconds can finish inside the server budget');
await assert.rejects(timedApi('vod'),/connection_timeout/,'catalog requests retain the shorter timeout');
responseTime=60000;await assert.rejects(timedApi('gnula_token'),/connection_timeout/,'source preparation still has a finite deadline');
console.log('PASS: password-free persistence, own-domain cookie sentinel, captured credentials and stale account/generation rejection.');
