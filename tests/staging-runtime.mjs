import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
const built=spawnSync(process.execPath,['scripts/build-staging.mjs'],{stdio:'inherit'});
assert.equal(built.status,0);
const config=JSON.parse(readFileSync('cloudflare-worker/wrangler.jsonc','utf8'));
assert.equal(config.main,'src/index.js');assert.equal(config.assets,undefined);
assert.equal(config.env.staging.main,'src/staging.mjs');
assert.deepEqual(config.env.staging.routes,[]);assert.deepEqual(config.env.staging.triggers.crons,[]);
assert.ok(config.env.staging.durable_objects.bindings.every(binding=>!binding.script_name),'no staging binding references another script');
const bundle=await build({entryPoints:['cloudflare-worker/src/staging.mjs'],bundle:true,format:'esm',platform:'browser',external:['cloudflare:sockets'],write:false});
let outbound=0;
const options={modules:true,script:bundle.outputFiles[0].text,compatibilityDate:config.compatibility_date,compatibilityFlags:config.compatibility_flags,
 bindings:{ENVIRONMENT:'staging',TICKET_SECRET:'synthetic-staging-ticket-secret-not-deployed',ADMIN_SETUP_SECRET:'synthetic-staging-setup-secret-not-deployed'},
 durableObjects:{PLAYBACK_SESSIONS:{className:'PlaybackSession',useSQLite:true},BACKUP_RECOVERY:{className:'BackupRecovery',useSQLite:true},OPERATION_ALERTS:{className:'OperationsMonitor',useSQLite:true}},durableObjectsPersist:false,
 assets:{directory:'artifacts/staging-web',binding:'STAGING_ASSETS',run_worker_first:true,routerConfig:{has_user_worker:true},assetConfig:{html_handling:'none',not_found_handling:'none'}},
 outboundService:()=>{outbound++;throw Error('Staging must not contact any real provider or email service in this test');}};
const mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
try{
 await mf.ready;
 const origin='https://snapmovienow-edge-staging.synthetic.workers.dev';
 const fetch=(path,init)=>mf.dispatchFetch(origin+path,init);
 for(const path of ['/','/index.html','/admin.html']){
  const response=await fetch(path);assert.equal(response.status,200,await response.clone().text());
  assert.equal(response.headers.get('X-SMN-Environment'),'staging');
  assert.equal(response.headers.get('X-Robots-Tag'),'noindex, nofollow');
  assert.match(response.headers.get('Content-Security-Policy'),/connect-src 'self'/);
  assert.ok(!response.headers.get('Content-Security-Policy').includes('api.snaptvnow.com'));
  assert.match(await response.text(),/ENTORNO DE PRUEBAS/);
 }
 const frontend=await(await fetch('/app-config.js?api=https://api.snaptvnow.com')).text();
 assert.match(frontend,/location.origin\+'\/api'/);assert.ok(!frontend.includes('api.snaptvnow.com'));
 assert.equal((await fetch('/api/health')).status,200);
 let cookie;
 const call=async(body,{path='/api/admin',source=origin,session=cookie}={})=>{
  const headers={'Content-Type':'application/json',Origin:source};if(session)headers.Cookie=session;
  const response=await fetch(path,{method:'POST',headers,body:JSON.stringify(body)});
  return{response,status:response.status,data:await response.json()};
 };
 assert.equal((await call({action:'status'})).data.configured,false);
 assert.equal((await call({action:'users'})).status,401);
 assert.equal((await call({op:'auth',username:'real-provider-user',password:'never-forward-this'},{path:'/api'})).status,401);
 assert.equal(outbound,0,'unknown credentials cannot reach the production provider');
 assert.equal((await call({action:'setup',username:'syntheticowner',password:'synthetic-owner-password',setupSecret:options.bindings.ADMIN_SETUP_SECRET})).status,200);
 const login=await call({action:'login',username:'syntheticowner',password:'synthetic-owner-password',browser_cookie:true});
 assert.equal(login.status,200);assert.equal(login.data.access_token,null);
 assert.match(login.response.headers.get('Set-Cookie'),/Secure; HttpOnly; SameSite=Strict/);
 cookie=login.response.headers.get('Set-Cookie').split(';')[0];
 assert.equal((await call({action:'users'},{source:'https://app.snaptvnow.com'})).status,403,'production frontend cannot use the test cookie');
 assert.equal((await call({action:'save',create:true,username:'syntheticcustomer',password:'synthetic-customer-password',status:'active',permissions:{movies:true,series:true,tv:true,adults:false}})).status,200);
 const customer=await call({op:'auth',username:'syntheticcustomer',password:'synthetic-customer-password',browser_cookie:true},{path:'/api'});
 assert.equal(customer.status,200);assert.equal(customer.data.access_token,null);
 const customerCookie=customer.response.headers.get('Set-Cookie').split(';')[0];
 assert.equal((await call({op:'session_info'},{path:'/api',session:customerCookie})).status,200);
 assert.equal((await call({action:'alerts-check'})).data.lastCheckedAt,null);
 assert.equal((await call({action:'alerts-settings',enabled:true,channel:'email',to:'test@example.com',from:'test@example.com',apiKey:'re_synthetic_staging_key_only'})).status,200);
 assert.equal((await call({action:'alerts-test'})).status,200);
 assert.equal(outbound,0,'even an explicit test cannot send staging email');
 const backup=await call({action:'backup-create',password:'synthetic-owner-password'});
 assert.equal(backup.status,200);assert.equal(backup.data.recovery.ok,true);
 const saved=await call({action:'backup-status'});assert.equal(saved.data.lastAutomaticAt,null);
 assert.equal(outbound,0);
 console.log('PASS: real staging assets/API routing, same-origin HttpOnly cookies, cross-origin rejection, synthetic accounts, isolated restoration, no provider fallback and no emails.');
}finally{await mf.dispose()}
