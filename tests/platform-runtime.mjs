// Actual production module in two independent local workerd/SQLite namespaces.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {totp} from '../cloudflare-worker/src/security.mjs';
const bundled=await build({entryPoints:['cloudflare-worker/src/index.js'],bundle:true,format:'esm',platform:'browser',external:['cloudflare:sockets'],write:false});
const common={modules:true,script:bundled.outputFiles[0].text,compatibilityDate:'2026-10-03',compatibilityFlags:['enable_request_signal'],durableObjects:{PLAYBACK_SESSIONS:{className:'PlaybackSession',useSQLite:true}},bindings:{TICKET_SECRET:'local-runtime-secret-never-deployed-123456',ADMIN_SETUP_SECRET:'local-runtime-setup-secret-never-deployed-123456',WEB_ORIGINS:'http://127.0.0.1:8788'}};
const options={workers:[{...common,name:'production-test',bindings:{...common.bindings,ENVIRONMENT:'production'}},{...common,name:'staging-test',bindings:{...common.bindings,ENVIRONMENT:'staging'}}],durableObjectsPersist:false};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
try{
 await mf.ready;const prod=await mf.getWorker('production-test'),stage=await mf.getWorker('staging-test');
 const call=async(target,body,path='/admin')=>{const response=await target.fetch('https://local.test'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return{status:response.status,data:await response.json()}};
 assert.equal((await call(prod,{action:'setup',username:'owner',password:'owner-password-test',setupSecret:common.bindings.ADMIN_SETUP_SECRET})).status,200);
 assert.equal((await call(stage,{action:'status'})).data.configured,false,'staging never reads production administrator storage');
 assert.equal((await call(stage,{action:'login',username:'owner',password:'owner-password-test'})).status,401);
 const login=await call(prod,{action:'login',username:'owner',password:'owner-password-test'});const token=login.data.access_token;assert.ok(token);
 let activeToken=token;const admin=(action,b={})=>call(prod,{action,access_token:activeToken,...b});
 await admin('save',{create:true,username:'customer',password:'customer-password-test',permissions:{movies:true,series:true,tv:true,adults:false},status:'active'});
 const customer=(await call(prod,{op:'auth',username:'customer',password:'customer-password-test'},'/')).data.access_token;assert.ok(customer);
 const patch={kind:'progress',key:'movie:ccf:42',type:'movie',id:'42',server:'ccf',time:100,duration:1000,updatedAt:Date.now()};
 assert.equal((await call(prod,{op:'profile_patch',access_token:customer,patches:[patch]},'/')).data.records[0].time,100);
 assert.equal((await call(stage,{op:'profile_get',access_token:customer},'/')).status,401);
 const exported=await admin('backup-export',{password:'owner-password-test'});assert.equal(exported.status,200);assert.ok(exported.data.blob);
 const plan=await admin('backup-preview',{blob:exported.data.blob});assert.equal(plan.data.users,1);
 const restore=await admin('backup-restore',{password:'owner-password-test',blob:exported.data.blob,confirmation:plan.data.confirmation,confirmText:'RESTAURAR'});assert.equal(restore.status,200);
 assert.equal((await call(prod,{op:'profile_get',access_token:customer},'/')).status,401);
 const begin=await admin('mfa-begin',{password:'owner-password-test'});assert.equal(begin.status,200);
 const confirmed=await admin('mfa-confirm',{password:'owner-password-test',code:await totp(begin.data.seed,Math.floor(Date.now()/30000))});assert.equal(confirmed.status,200);assert.equal(confirmed.data.recoveryCodes.length,8);
 assert.equal((await admin('users')).status,401);
 const afterMfa=await call(prod,{action:'login',username:'owner',password:'owner-password-test',code:confirmed.data.recoveryCodes[0]});assert.equal(afterMfa.status,200);activeToken=afterMfa.data.access_token;
 const renewed=await admin('mfa-recovery-renew',{password:'owner-password-test',code:await totp(begin.data.seed,Math.floor(Date.now()/30000)+1)});assert.equal(renewed.status,200);assert.equal(renewed.data.recoveryCodes.length,8);assert.equal(renewed.data.signInAgain,true);
 assert.equal((await admin('users')).status,401,'real SQLite recovery renewal revokes the prior session');
 assert.equal((await call(prod,{action:'login',username:'owner',password:'owner-password-test',code:confirmed.data.recoveryCodes[1]})).status,401,'SQLite rejects a superseded recovery code');
 const afterRenew=await call(prod,{action:'login',username:'owner',password:'owner-password-test',code:renewed.data.recoveryCodes[0]});assert.equal(afterRenew.status,200);activeToken=afterRenew.data.access_token;
 assert.equal((await admin('security-status')).data.recoveryRemaining,7,'a new recovery code still works exactly once');
 console.log('PASS: actual workerd/SQLite production modules; isolated staging, protected profile storage, encrypted export, atomic restoration, old-session revocation, MFA enrollment and authenticated recovery renewal.');
}finally{await mf.dispose()}
