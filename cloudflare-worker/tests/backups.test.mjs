import assert from 'node:assert/strict';
import {automaticBackup,backupRoute} from '../src/backups.mjs';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve();this.failChunk=false;this.failRead=false}
 async get(k){return structuredClone(this.data.get(k))}
 async put(k,v){if(this.failChunk&&k.startsWith('auto-backup:'))throw Error('private-provider-password-must-not-be-logged');this.data.set(k,structuredClone(v))}
 async delete(k){return this.data.delete(k)}
 async list({prefix=''}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))}
 transaction(fn){const r=this.queue.then(async()=>{const tx=new Store();tx.data=structuredClone(this.data);tx.failChunk=this.failChunk;const value=await fn(tx);this.data=tx.data;return value});this.queue=r.catch(()=>{});return r}
}
const env={TICKET_SECRET:'synthetic-backup-test-secret-never-deployed',ENVIRONMENT:'production'},store=new Store();
await store.put('admin',{id:'test-admin',mfa:{enabled:true}});
await store.put('user:alice',{id:'old-id',username:'alice',hash:'a'.repeat(64),salt:'test-salt',version:1,status:'active',permissions:{movies:true,series:false,tv:true,adults:false},expiresAt:Date.now()+86400000});
await store.put('provider',{encrypted:'private-provider-data',username:'synthetic-provider',maxConnections:3});
const route=async(path,b={})=>{const r=await backupRoute(store,env,path,{actor:'test-admin',...b},{in(){return{clear:async()=>{}}}});return{status:r.status,data:await r.json()}};
assert.equal((await route('/backup-status')).data.stale,true);
await store.put('pool',{padding:'x'.repeat(100000)});
const first=await automaticBackup(store,env);assert.equal(first.ok,true);const prefix='auto-backup:'+first.id+':';assert.ok((await store.list({prefix})).size>1);
await store.put(prefix+'900','legacy-orphan');await store.delete('pool');
const smaller=await automaticBackup(store,env);assert.equal(smaller.ok,true);assert.equal(smaller.id,first.id);assert.equal((await store.list({prefix})).size,1,'same-day shrinking replaces every old chunk, including orphaned fragments');
const before=await store.get('auto-backup-index:'+first.id);
const originalGet=store.get;store.get=async key=>{if(key.startsWith('auto-backup'))throw Error('non-transactional backup read');return originalGet.call(store,key)};
const verified=await route('/backup-verify',{id:first.id});assert.equal(verified.status,200);assert.equal(verified.data.verified,true);assert.equal(verified.data.users,1);assert.equal(verified.data.providers,1);assert.ok(!JSON.stringify(verified.data).includes('private-provider'));
store.get=originalGet;
assert.ok((await store.get('auto-backup-index:'+first.id)).verifiedAt);
const download=await route('/backup-download',{id:first.id});assert.equal(download.status,200);assert.ok(download.data.blob);
store.failChunk=true;const failed=await automaticBackup(store,env);assert.equal(failed.error,'backup_failed');store.failChunk=false;
const status=(await route('/backup-status')).data;assert.equal(status.status,'failed');assert.equal(status.lastSuccessAt,before.createdAt);assert.equal(status.reason,'backup_failed');assert.ok(!JSON.stringify(await store.list({prefix:'backup-status'})).includes('private-provider-password'));
assert.equal((await route('/backup-download',{id:first.id})).data.blob,download.data.blob,'a failed replacement rolls back to the previous valid copy');
const chunk=await store.get(prefix+'0');await store.put(prefix+'0','A'+chunk.slice(1));assert.equal((await route('/backup-verify',{id:first.id})).status,400,'checksum and authenticated encryption reject damaged chunks');
await store.put(prefix+'0',chunk);await store.delete(prefix+'0');assert.equal((await route('/backup-download',{id:first.id})).status,400,'missing chunks cannot be exported as a usable copy');await store.put(prefix+'0',chunk);
const legacy=await store.get('auto-backup-index:'+first.id);delete legacy.checksum;delete legacy.verifiedAt;await store.put('auto-backup-index:'+first.id,legacy);assert.equal((await route('/backup-verify',{id:first.id})).data.verified,true,'existing v1 copies remain verifiable and gain checksum metadata');
const concurrent=await Promise.all([automaticBackup(store,env),automaticBackup(store,env)]);assert.equal(concurrent.filter(r=>r.ok).length,1);assert.equal(concurrent.filter(r=>r.error==='backup_in_progress').length,1);
assert.equal((await automaticBackup(store,{...env,ENVIRONMENT:'staging'})).skipped,true);
assert.equal((await route('/backup-verify',{id:'../admin'})).status,404);
assert.equal((await route('/backup-status')).data.status,'success');
console.log('PASS: atomic backup reads/replacement, same-day orphan cleanup, rollback, private failure status, integrity verification, legacy copies and concurrent creation.');
