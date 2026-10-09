import assert from 'node:assert/strict';
import {automaticBackup} from '../src/backups.mjs';
import {totp,unseal,seal} from '../src/security.mjs';
import worker,{PlaybackSession} from '../src/index.js';
class Store {
 constructor(){this.data=new Map();this.queue=Promise.resolve()}
 async get(k){return structuredClone(this.data.get(k))}async put(k,v){this.data.set(k,structuredClone(v))}async delete(k){return this.data.delete(k)}async deleteAll(){this.data.clear()}async setAlarm(){}
 async list({prefix=''}){return new Map([...this.data].filter(([k])=>k.startsWith(prefix)).map(([k,v])=>[k,structuredClone(v)]))}
 transaction(fn){const r=this.queue.then(async()=>{const tx=new Store();tx.data=structuredClone(this.data);const result=await fn(tx);this.data=tx.data;return result});this.queue=r.catch(()=>{});return r}
}
const secret='GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
for(const [time,expected]of [[59,'94287082'],[1111111109,'07081804'],[1111111111,'14050471'],[1234567890,'89005924'],[2000000000,'69279037'],[20000000000,'65353130']])assert.equal(await totp(secret,Math.floor(time/30),8),expected,'RFC 6238 SHA-1 vector');
const env={TICKET_SECRET:'isolated-platform-test-secret-never-deployed',ADMIN_SETUP_SECRET:'isolated-setup-test-secret-never-deployed-123456789',ENVIRONMENT:'production',WEB_ORIGINS:'https://snapmovienow.github.io,https://panel.snaptvnow.com,https://app.snaptvnow.com'};
const objects=new Map();env.PLAYBACK_SESSIONS={idFromName:x=>x,get(id){if(!objects.has(id))objects.set(id,new PlaybackSession({storage:new Store()},env));return{fetch:(url,options)=>objects.get(id).fetch(new Request(url,options))}}};
const realNow=Date.now;let clock=realNow();Date.now=()=>clock;
const upstream=globalThis.fetch;globalThis.fetch=async url=>{const action=new URL(url).searchParams.get('action');return Response.json(action==='get_live_streams'?[{stream_id:123,name:'Canal de prueba'},{stream_id:999,name:'Adultos XXX',is_adult:1}]:action==='get_live_categories'?[]:action==='get_short_epg'?{epg_listings:[{title:'UHJ1ZWJh',start_timestamp:'1791570000'}]}:{user_info:{auth:1,status:'Active',max_connections:3}})};
const call=async(body,{path='/admin',origin='https://panel.snaptvnow.com',cookie,host='https://api.snaptvnow.com'}={})=>{
 const headers={'Content-Type':'application/json','CF-Connecting-IP':'platform-test'};if(origin)headers.Origin=origin;if(cookie)headers.Cookie=cookie;
 const response=await worker.fetch(new Request(host+path,{method:'POST',headers,body:JSON.stringify(body)}),env);return{response,status:response.status,data:await response.json()};
};
try{
 assert.equal((await call({action:'setup',username:'owner',password:'owner-password-test',setupSecret:env.ADMIN_SETUP_SECRET})).status,200);
 const logged=await call({action:'login',username:'owner',password:'owner-password-test',browser_cookie:true});assert.equal(logged.status,200);assert.equal(logged.data.access_token,null);
 let cookie=logged.response.headers.get('Set-Cookie').split(';')[0];assert.match(logged.response.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Strict/);assert.equal(logged.response.headers.get('Access-Control-Allow-Credentials'),'true');
 const admin=(action,b={})=>call({action,...b},{cookie});
 assert.equal((await call({action:'users'},{cookie,origin:'https://evil.example'})).status,403);
 assert.equal((await call({action:'users'},{cookie,origin:null})).status,403,'cookie authentication needs a trusted origin');
 assert.equal((await admin('users')).status,200);
 assert.equal((await call({action:'login',username:'owner',password:'owner-password-test'},{origin:'https://snapmovienow.github.io'})).response.headers.get('Set-Cookie'),null,'GitHub Pages keeps legacy token compatibility');
 const native=await call({action:'login',username:'owner',password:'owner-password-test'},{origin:null});assert.ok(native.data.access_token);
 assert.equal((await call({action:'users',access_token:native.data.access_token},{origin:null})).status,200);
 assert.equal((await admin('save',{create:true,username:'alice',password:'customer-password-test',status:'active',permissions:{movies:true,series:true,tv:true,adults:false}})).status,200);
 assert.equal((await admin('save',{create:true,username:'bob',password:'customer-password-test',status:'active'})).status,200);
 const customer=await call({op:'auth',username:'alice',password:'customer-password-test',browser_cookie:true},{path:'/',origin:'https://app.snaptvnow.com'});assert.equal(customer.status,200);assert.equal(customer.data.access_token,null);const aliceCookie=customer.response.headers.get('Set-Cookie').split(';')[0];
 const alice=(op,b={})=>call({op,...b},{path:'/',cookie:aliceCookie,origin:'https://app.snaptvnow.com'});
 const patch={kind:'favorite',key:'movie:ccf:123',type:'movie',id:'123',server:'ccf',updatedAt:clock};
 assert.equal((await alice('profile_patch',{patches:[{...patch,url:'secret-media-url',password:'secret-password'}]})).status,200);
 const profile=await alice('profile_get');assert.equal(profile.data.records.length,1);assert.ok(!JSON.stringify(profile.data).includes('secret-'));
 const bLogin=await call({op:'auth',username:'bob',password:'customer-password-test'},{path:'/',origin:null});
 assert.equal((await call({op:'profile_get',access_token:bLogin.data.access_token},{path:'/',origin:null})).data.records.length,0,'separate user identities own separate profiles');
 assert.equal((await alice('profile_patch',{patches:[{...patch,deleted:true,updatedAt:clock+1}]})).status,200);clock++;
 assert.equal((await alice('profile_patch',{patches:[patch]})).data.records[0].deleted,true,'stale devices cannot revive a deleted favorite');
 assert.equal((await alice('profile_patch',{patches:[{...patch,updatedAt:clock+99999999}]})).status,400);
 assert.equal((await admin('provider-save',{username:'service-test',password:'service-password'})).status,200);
 assert.equal((await alice('live_epg',{stream_id:123})).data.epg_listings[0].title,'UHJ1ZWJh');assert.equal((await alice('live_epg',{stream_id:999})).status,403,'adult guide is protected by the same catalog policy');
 const metric={type:'live',quality:'1080',server:'ccf',started:true,startupMs:2200,watchMs:30000,stallMs:3000,stalls:1,errors:0,decoded:600,dropped:2};
 for(let i=0;i<5;i++){clock+=30000;assert.equal((await alice('playback_metric',{metric})).status,200)}
 const health=(await admin('playback-health')).data;assert.equal(health.groups[0].starts,5);assert.equal(health.groups[0].stallPercent,10);assert.equal(health.groups[0].startupP95UpperMs,5000);assert.equal(health.alerts.length,1);assert.ok(!JSON.stringify(health).includes('alice'));
 assert.equal((await alice('playback_metric',{metric:{...metric,server:'unknown'}})).status,400);
 const begin=await admin('mfa-begin',{password:'owner-password-test'});assert.equal(begin.status,200);assert.equal(begin.data.seed.length,32);assert.match(begin.data.uri,/otpauth:\/\/totp/);
 assert.equal((await admin('mfa-confirm',{password:'owner-password-test',code:'bad'})).status,401);assert.equal((await admin('users')).status,200,'a bad reauthentication code does not revoke the valid session');
 const code=await totp(begin.data.seed,Math.floor(clock/30000));const confirm=await admin('mfa-confirm',{password:'owner-password-test',code});assert.equal(confirm.status,200);assert.equal(confirm.data.recoveryCodes.length,8);
 assert.equal((await admin('users')).status,401,'enabling MFA revokes previous administrator sessions');
 assert.equal((await call({action:'login',username:'owner',password:'owner-password-test'})).status,401);
 assert.equal((await call({action:'login',username:'owner',password:'owner-password-test',code})).status,401,'the enrollment code cannot be replayed');
 clock+=30000;const newLogin=await call({action:'login',username:'owner',password:'owner-password-test',code:await totp(begin.data.seed,Math.floor(clock/30000)),browser_cookie:true});assert.equal(newLogin.status,200);cookie=newLogin.response.headers.get('Set-Cookie').split(';')[0];
 const state=objects.get('__smn_accounts_v1').state.storage;assert.ok(!JSON.stringify(await state.get('admin')).includes(begin.data.seed),'stored authenticator seed is encrypted');
 const recovery=confirm.data.recoveryCodes;
 const exported=await admin('backup-export',{password:'owner-password-test',code:recovery[0]});assert.equal(exported.status,200);assert.ok(!JSON.stringify(exported.data).includes('customer-password-test'));assert.ok(!JSON.stringify(exported.data).includes('alice'));
 assert.equal((await admin('backup-export',{password:'owner-password-test',code:recovery[0]})).status,401,'recovery codes are one-time');
 const plain=await unseal(env,exported.data.blob);assert.equal(plain.users.length,2);assert.equal(plain.admin,undefined);assert.equal(plain.users[0].permissions.adults,false);
 assert.equal(await unseal({...env,TICKET_SECRET:'wrong-secret'},exported.data.blob),null);
 const damaged=exported.data.blob.slice(0,100)+(exported.data.blob[100]==='A'?'B':'A')+exported.data.blob.slice(101);
 assert.equal((await admin('backup-preview',{blob:damaged})).status,400);
 const foreign=await seal(env,{...plain,environment:'staging'});assert.equal((await admin('backup-preview',{blob:foreign})).status,400,'isolated environments cannot restore each other');
 const preview=await admin('backup-preview',{blob:exported.data.blob});assert.equal(preview.status,200);assert.equal(preview.data.users,2);
 assert.equal((await admin('backup-restore',{blob:exported.data.blob,password:'owner-password-test',code:recovery[1],confirmation:preview.data.confirmation,confirmText:'NO'})).status,409);
 assert.equal((await admin('delete',{username:'bob'})).status,200);
 const priorId=(await state.get('user:alice')).id;
 const restored=await admin('backup-restore',{blob:exported.data.blob,password:'owner-password-test',code:recovery[2],confirmation:preview.data.confirmation,confirmText:'RESTAURAR'});assert.equal(restored.status,200);assert.equal((await admin('users')).data.length,2);assert.notEqual((await state.get('user:alice')).id,priorId);assert.equal((await alice('session_info')).status,401,'restore invalidates prior customer identities');assert.equal((await admin('security-status')).data.mfaEnabled,true,'restore preserves administrator MFA');
 const audit=(await admin('audit')).data;assert.ok(audit.some(e=>e.action==='backup_restored'));assert.ok(audit.some(e=>e.action==='user_deleted'));assert.ok(!JSON.stringify(audit).includes('password'));
 const big={payload:'x'.repeat(500000)};assert.deepEqual(await unseal(env,await seal(env,big)),big,'large backups do not overflow the JavaScript argument stack');
 const automatic=new Store();await automatic.put('admin',{username:'owner'});for(const u of plain.users)await automatic.put('user:'+u.username,u);
 for(let i=0;i<4;i++){clock+=86400000;assert.equal((await automaticBackup(automatic,env)).ok,true)}
 assert.equal((await automatic.list({prefix:'auto-backup-index:'})).size,3);assert.ok([...(await automatic.list({prefix:'auto-backup:'})).values()].every(chunk=>chunk.length<=16000));assert.equal((await automaticBackup(automatic,{...env,ENVIRONMENT:'staging'})).skipped,true);
 const oversized=await worker.fetch(new Request('https://api.snaptvnow.com/admin',{method:'POST',headers:{'Content-Length':'4000001'},body:'{}'}),env);assert.equal(oversized.status,413);
 console.log('PASS: RFC TOTP, trusted HttpOnly cookies, legacy/native compatibility, per-user synchronization, stale deletes, aggregate health, encrypted MFA, replay protection, one-time recovery, tampered/foreign backups, confirmed restoration and session revocation.');
}finally{Date.now=realNow;globalThis.fetch=upstream}
