import assert from 'node:assert/strict';
import {automaticBackup,backupRoute,runBackupDrill} from '../src/backups.mjs';
import {BackupRecovery} from '../src/backup-recovery.mjs';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve();this.failCleanup=false;this.alarm=null}
 async get(key){return structuredClone(this.data.get(key))}
 async put(key,value){this.data.set(key,structuredClone(value))}
 async delete(key){this.data.delete(key)}
 async list({prefix='',limit=Infinity}={}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).slice(0,limit).map(([k,v])=>[k,structuredClone(v)]))}
 async setAlarm(value){this.alarm=value}
 async deleteAll(){if(this.failCleanup)throw Error('synthetic-private-provider-password');this.data.clear();this.alarm=null}
 transaction(fn){const promise=this.queue.then(async()=>{const tx=new Store();tx.data=structuredClone(this.data);const result=await fn(tx);this.data=tx.data;return result});this.queue=promise.catch(()=>{});return promise}
}
const env={ENVIRONMENT:'production',TICKET_SECRET:'synthetic-recovery-test-secret-never-deployed'},source=new Store(),objects=[];
const user={id:'original-user',username:'alice',hash:'a'.repeat(64),salt:'synthetic-salt',version:3,status:'suspended',expiresAt:Date.now()-1000,permissions:{movies:true,series:false,tv:true,adults:false}};
const admin={id:'original-admin',mfa:{enabled:true,secret:'synthetic-admin-secret'}};
await source.put('admin',admin);await source.put('user:alice',user);await source.put('provider',{encrypted:'synthetic-private-provider',username:'synthetic-provider'});
const first=await automaticBackup(source,env,{manual:true});assert.ok(first.ok);
const original=structuredClone(source.data);
let failCleanup=false,pause=null,entered=null;
const binding={newUniqueId:()=>crypto.randomUUID(),get(id){assert.match(id,/^[0-9a-f-]{36}$/);const storage=new Store();storage.failCleanup=failCleanup;const instance=new BackupRecovery({storage},env);objects.push({instance,storage});return{async fetch(url,options){entered?.();if(pause)await pause;return instance.fetch(new Request(url,options))}}}};
const withRecovery={...env,BACKUP_RECOVERY:binding};
const firstDrill=await runBackupDrill(source,withRecovery,{id:first.id,actor:'synthetic-admin'});
assert.equal(firstDrill.ok,true);assert.equal(firstDrill.cleaned,true);assert.ok(Object.values(firstDrill.checks).every(Boolean));
for(const key of ['admin','user:alice','provider'])assert.deepEqual(await source.get(key),original.get(key),'live data remains unchanged');
assert.equal(objects[0].storage.data.size,0);assert.equal(objects[0].storage.alarm,null);
const route=async(path,b={})=>(await backupRoute(source,withRecovery,path,{actor:'synthetic-admin',...b},{})).json();
const download=await route('/backup-download',{id:first.id});assert.equal((await route('/backup-status')).recovery.lastFileCheckAt,null,'preparing a download cannot certify external storage');
const fileDrill=await runBackupDrill(source,withRecovery,{blob:download.blob,actor:'synthetic-admin'});assert.equal(fileDrill.ok,true);assert.ok((await route('/backup-status')).recovery.lastFileCheckAt);
const priorObjects=objects.length;assert.equal((await runBackupDrill(source,withRecovery,{blob:'invalid'})).error,'invalid_backup');assert.equal(objects.length,priorObjects);
failCleanup=true;const cleanupFailure=await runBackupDrill(source,withRecovery,{id:first.id});assert.equal(cleanupFailure.error,'recovery_failed');assert.equal((await route('/backup-status')).recovery.status,'failed');
assert.ok(objects.at(-1).storage.alarm,'a failed cleanup retains the alarm safety net');
assert.ok(!JSON.stringify(await route('/backup-status')).includes('private-provider'));
objects.at(-1).storage.failCleanup=false;await objects.at(-1).instance.alarm();assert.equal(objects.at(-1).storage.data.size,0);failCleanup=false;
let resume,started;pause=new Promise(r=>resume=r);const ready=new Promise(r=>started=r);entered=started;
const outstanding=runBackupDrill(source,withRecovery,{id:first.id});await ready;
assert.equal((await runBackupDrill(source,withRecovery,{id:first.id})).error,'recovery_in_progress');
await source.put('user:alice',{...user,version:4});await automaticBackup(source,env,{manual:true});resume();
assert.equal((await outstanding).error,'backup_changed','a drill on an overwritten copy cannot certify its replacement');
assert.equal((await route('/backup-list'))[0].restoredAt,null);assert.equal((await route('/backup-status')).recovery.reason,'backup_changed');
pause=null;entered=null;
const auto=await automaticBackup(source,withRecovery);assert.equal(auto.ok,true);assert.equal(auto.recovery.ok,true);assert.equal((await route('/backup-status')).automaticStatus,'success');
assert.ok(objects.every(({storage})=>storage.data.size===0));
console.log('PASS: isolated backup restoration, live-data preservation, cleanup alarm, failed-cleanup rejection, private failure reasons, actual-file evidence, concurrent drills and overwritten-copy protection.');
