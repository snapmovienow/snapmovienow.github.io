import {boundedTsQuota} from './bounded-ts-route.mjs';
import {saveCatalogReferences,readCatalogReferences} from './catalog-references.mjs';
import {runLocalTvImport,localTvImportStatus,runLocalTvExpansion,localTvExpansionStatus,runRegionalTvImport,regionalTvImportStatus} from './local-tv-import.mjs';
import {localTvXtreamStatus,visibleLocalTv} from './local-tv-xtream.mjs';
import {gatewayRotationStore} from './gateway-rotation-store.mjs';
import {recordProviderHealth,rankProviderCandidates,providerCircuitState,claimProviderTrial,providerHealthSummary,failedLive404Sample} from './provider-health.mjs';
import {recordChannelObservation,readChannelObservations} from './provider-channel-observations.mjs';
import {affinityGroup,providerAffinity,rememberProvider,forgetProvider,recentlyValidated,pruneAffinities} from './provider-affinity.mjs';
import {assignmentKey,usableProvider,assignedProvider,saveAssignment,mediaRecentlyFailed,recentAccountProof} from './provider-assignment.mjs';
import {exclusiveCatalogRoute,exclusiveSnapshot,selectExclusive,visibleExclusive} from './exclusive-catalog.mjs';
import {cleanConnectionClient,recordConnectionLimit,updateConnectionQuality,closeResellerConnection} from './connection-monitor.mjs';
import {resellerPresence,resellerPlaybackSummary,resellerLiveConnections,recordCustomerActivity} from './reseller-presence.mjs';
import {resellerAccounts} from './reseller-accounts.mjs';
import {nativeResellerImport} from './native-reseller-import.mjs';
import {resellerIntegrity} from './reseller-integrity.mjs';
import {readClientHistory,recordClientAccess,safelyRecord,touchPlayback,labelPlayback} from './client-history.mjs';
import {catalogMaintenanceRoute,runCatalogMaintenance} from './catalog-maintenance.mjs';
import {runYagaImport,yagaImportStatus} from './yaga-import.mjs';
import {readServiceMonitor,sampleServiceMonitor} from './service-monitor.mjs';
import {TRUSTED_RESELLERS} from './reseller-trust.mjs';
// Private Durable Object routes. This module is never served as an HTTP endpoint.
import {contentPermissions} from './content-permissions.mjs';
import {catalogCacheRoute} from './catalog-cache.mjs';
import {inspectCatalog} from './catalog-permissions.mjs';
import {providerDashboard} from './provider-dashboard.mjs';
import {openLeaseStore} from './lease-store.mjs';
import {recordLocalStartup} from './local-startup-observations.mjs';
import {cleanPlaybackActivity} from './playback-activity.mjs';
import {securityRoute,checkFactor,writeAudit} from './security.mjs';
import {backupRoute,automaticBackup} from './backups.mjs';
const answer=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const normal=x=>String(x||'').trim().toLowerCase();
const validName=x=>/^[a-z0-9_.@-]{3,80}$/.test(x);
const publicUser=u=>({id:u.id,username:u.username,name:u.name,status:u.status,expiresAt:u.expiresAt,createdAt:u.createdAt,updatedAt:u.updatedAt,permissions:contentPermissions(u.permissions)});
const adminUser=u=>({...publicUser(u),comments:typeof u.comments==='string'?u.comments:''});
const alive=u=>u&&u.status==='active'&&(!u.expiresAt||u.expiresAt>Date.now());
const enc=new TextEncoder();
async function digest(x){return new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(String(x))))}
async function same(a,b){const x=await digest(a),y=await digest(b);let n=0;for(let i=0;i<x.length;i++)n|=x[i]^y[i];return n===0}
export async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations:100000},key,256);return Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('')}
async function withPassword(u,password){if(typeof password!=='string'||password.length<12||password.length>256)throw Error('password_length');const salt=crypto.randomUUID();return {...u,salt,hash:await passwordHash(password,salt)}}
function expiry(value){if(value===null||value===''||value===undefined)return null;const n=Number(value);if(!Number.isFinite(n)||n<=Date.now())throw Error('invalid_expiry');return n}
export async function accountsFetch(state,env,req){
 const p=new URL(req.url).pathname.replace('/accounts','');const b=await req.json();const store=state.storage;
 try{
 if(['/bounded-ts-claim','/bounded-ts-status','/bounded-ts-result'].includes(p))return boundedTsQuota(store,p,b,env);
 if(['/reseller-portal-rotation-status','/reseller-portal-rotation-begin','/reseller-portal-rotation-finish'].includes(p))return gatewayRotationStore(store,p,b);
 const leases=await openLeaseStore(store);
 if(p==='/reseller-service-monitor')return store.transaction(tx=>readServiceMonitor(tx,leases.in(tx),b));
 if(p==='/service-monitor-sample'){await store.transaction(tx=>sampleServiceMonitor(tx,leases.in(tx),TRUSTED_RESELLERS.map(r=>r.accountId)));return answer({ok:true});}
 if(p==='/catalog-maintenance-tick'){
  await runYagaImport(store,leases,env);
  await runLocalTvImport(store,leases,env);
  await runLocalTvExpansion(store,leases,env);
  await runRegionalTvImport(store,leases,env);
  await runCatalogMaintenance(env,{directory:(env,path,body={})=>env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_accounts_v1')).fetch('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)})});return answer({ok:true});
 }
 if(p==='/catalog-maintenance-status'){const response=await catalogMaintenanceRoute(store,leases,p,b);return answer({...await response.json(),exclusiveImport:await yagaImportStatus(store),localTvImport:await localTvImportStatus(store),localTvExpansion:await localTvExpansionStatus(store),regionalTvImport:await regionalTvImportStatus(store),localTvXtream:await localTvXtreamStatus(store)});}
 if(['/catalog-maintenance-status','/catalog-maintenance-start','/catalog-maintenance-probe','/catalog-maintenance-observe'].includes(p))return await catalogMaintenanceRoute(store,leases,p,b);
 if(['/exclusive-read','/exclusive-item-read','/exclusive-save','/exclusive-cover-save','/exclusive-cover-read'].includes(p))return store.transaction(async tx=>{
  const response=await exclusiveCatalogRoute(tx,p,b);
  if(p==='/exclusive-save'&&response.ok){const {item}=await response.clone().json();await leases.in(tx).removeMatching(l=>l.exclusiveParentId===item.id&&(!item.visible||l.playbackRevision!==item.playbackRevision));}
  return response;
 });
 if(p==='/reseller-presence')return store.transaction(tx=>resellerPresence(tx,leases.in(tx),b));
 if(p==='/reseller-playback-summary')return store.transaction(tx=>resellerPlaybackSummary(tx,leases.in(tx),b));
 if(p==='/reseller-connection-close')return store.transaction(tx=>closeResellerConnection(tx,leases.in(tx),b));
 if(p==='/playback-quality')return store.transaction(tx=>updateConnectionQuality(tx,leases.in(tx),b));
 if(p==='/reseller-live-connections')return store.transaction(tx=>resellerLiveConnections(tx,leases.in(tx),b));
 if(p==='/reseller-client-history'){await leases.prune();return store.transaction(tx=>readClientHistory(tx,store.sql,b));}
 if(p==='/customer-logout'){const user=await store.get('user:'+normal(b.username));if(user?.id===b.uid)await safelyRecord(()=>recordClientAccess(store,store.sql,user,'logout',b.connection));return answer({ok:true});}
 if(p==='/reseller-integrity')return resellerIntegrity(store,b);
 if(['/native-list','/native-record','/native-claim','/native-verify','/native-recover'].includes(p))return nativeResellerImport(store,p,b);
 if(p==='/reseller-portal-recipient')return answer(await store.get('reseller-portal-recipient:'+b.accountId)||null);
 if(p==='/reseller-portal-recipient-ensure')return store.transaction(async tx=>{const key='reseller-portal-recipient:'+b.accountId,current=await tx.get(key);if(current)return answer(current);if(!b.accountId||typeof b.encrypted!=='string'||b.encrypted.length>12000)return answer({error:'bridge_input'},400);const value={encrypted:b.encrypted};await tx.put(key,value);return answer(value);});
 if(p==='/reseller-portal-config')return answer(await store.get('reseller-portal:'+b.accountId)||null);
 if(p==='/reseller-portal-configure')return store.transaction(async tx=>{if(!b.accountId||typeof b.encrypted!=='string'||b.encrypted.length>12000||!Number.isSafeInteger(b.revision)||typeof b.payloadHash!=='string')return answer({error:'bridge_input'},400);const key='reseller-portal:'+b.accountId,old=await tx.get(key);if(old?.revision>b.revision)return answer({error:'bridge_stale'},409);if(old?.revision===b.revision&&old.payloadHash!==b.payloadHash)return answer({error:'bridge_version_conflict'},409);await tx.put(key,{encrypted:b.encrypted,revision:b.revision,payloadHash:b.payloadHash});return answer({ok:true,configured:true});});
 if(p==='/reseller-reserve'||p==='/reseller-release'||p==='/reseller-apply')return resellerAccounts(store,p,b,{passwordHash,leases,writeAudit});
 if(p==='/audit-write'){await store.transaction(tx=>writeAudit(tx,b.actor,b.action,b.target));return answer({ok:true})}
 if(p==='/audit')return answer((await store.get('security-audit')||[]).slice(-100).reverse());
 if(p==='/backup-automatic')return answer(await automaticBackup(store,env));
 if(['/backup-preview','/backup-list','/backup-status','/backup-verify'].includes(p))return backupRoute(store,env,p,b,leases);
 if(['/security-status','/admin-password','/mfa-begin','/mfa-replace-begin','/mfa-confirm','/mfa-disable','/mfa-recovery-renew','/backup-export','/backup-restore','/backup-download','/backup-create','/backup-drill'].includes(p)){
  const result=await securityRoute(store,env,p,b,{passwordHash,withPassword,audit:writeAudit});
  if(result)return result;
  return backupRoute(store,env,p,b,leases);
 }
 if(p==='/catalog-references-put')return answer({ok:await saveCatalogReferences(store,b)});
 if(p==='/catalog-references-status')return answer(await store.transaction(tx=>readCatalogReferences(tx,Date.now(),b.references)));
 if(p==='/xtream-cache-inspect')return await inspectCatalog(store,b);
 if(p==='/xtream-cache-get'||p==='/xtream-cache-put')return await catalogCacheRoute(store,p,b);
 if(p==='/xtream-config')return answer(await store.get('xtream-config')||{enabled:true,version:1});
 if(p==='/xtream-save')return store.transaction(async tx=>{if(typeof b.enabled!=='boolean')return answer({error:'invalid_setting'},400);const old=await tx.get('xtream-config')||{enabled:true,version:1};const next={enabled:b.enabled,version:old.version+(old.enabled===b.enabled?0:1)};await tx.put('xtream-config',next);if(!next.enabled)await leases.in(tx).removeFor({xtream:true});return answer(next)});
 if(p==='/xtream-register')return registerXtream(store,b.entries);
 if(p==='/xtream-resolve')return answer(/^\d+$/.test(String(b.id))?await store.get('xtream-id:'+b.id)||null:null);
 if(p==='/xtream-episode'){
  const id=await store.get('xtream-map:episode:'+String(b.server)+':'+String(b.id));
  return answer(id?await store.get('xtream-id:'+id)||null:null);
 }
 if(p==='/xtream-count')return answer({connections:await leases.count({uid:b.uid})});
 if(p==='/xtream-login'){
  const username=normal(b.username),u=await store.get('user:'+username),key='xtream-auth:'+username+':'+b.authKey;
  const cached=await store.get(key);if(cached&&cached.until>Date.now()&&alive(u)&&u.id===cached.uid&&u.version===cached.version){await safelyRecord(()=>recordCustomerActivity(store,u.id,Date.now(),b.connection));return answer({...publicUser(u),version:u.version});}
  const r=await accountsFetch(state,env,new Request('https://private/accounts/login',{method:'POST',body:JSON.stringify(b)}));if(!r.ok)return r;
  const user=await r.json(),current=await store.get('user:'+username);if(!alive(current)||current.version!==user.version)return answer({error:'invalid_credentials'},401);await store.put(key,{uid:user.id,version:user.version,until:Date.now()+15*60000});return answer({...publicUser(current),version:user.version});
 }
 if(p==='/status')return answer({configured:!!(await store.get('admin')),setupAvailable:!!env.ADMIN_SETUP_SECRET});
 if(p==='/setup'){
  if(!env.ADMIN_SETUP_SECRET||env.ADMIN_SETUP_SECRET.length<32||!await same(b.setupSecret,env.ADMIN_SETUP_SECRET))return answer({error:'setup_denied'},403);
  const username=normal(b.username);if(!validName(username))return answer({error:'invalid_username'},400);
  const admin=await withPassword({id:crypto.randomUUID(),username,version:1},b.password);
  return store.transaction(async tx=>{if(await tx.get('admin'))return answer({error:'already_configured'},409);await tx.put('admin',admin);return answer({ok:true})});
 }
 if(p==='/admin-login'||p==='/login'){
  // The administrator is one fixed account: invented submitted names must
  // share its client budget. Customer budgets remain isolated by username.
  const username=normal(b.username),bucket=p==='/admin-login'?'admin-attempt:'+String(b.client||''):'attempt:'+String(b.client||'')+':'+username.slice(0,80),now=Date.now();
  const allowed=await store.transaction(async tx=>{let a=await tx.get(bucket);if(!a||a.until<now)a={count:0,until:now+15*60000};a.count++;await tx.put(bucket,a);return a.count<=10});
  if(!allowed)return answer({error:'try_later'},429);
  const u=await store.get(p==='/admin-login'?'admin':'user:'+username);
  const hash=await passwordHash(String(b.password||'').slice(0,256),u?.salt||'missing-account-salt');
  if(!u||!await same(hash,u.hash)||(p==='/admin-login'&&username!==u.username)||(p==='/login'&&!alive(u))){if(p==='/login')await safelyRecord(()=>recordClientAccess(store,store.sql,u,'login_failed',b.connection,b.authKey?'xtream':'api'));return answer({error:'invalid_credentials'},401);}
  if(p==='/admin-login'){
   const factor=await store.transaction(async tx=>{const current=await tx.get('admin');if(current?.version!==u.version)return {valid:false};const r=await checkFactor(env,current,b.code);if(r.valid&&current.mfa?.enabled)await tx.put('admin',r.admin);return r});
   if(!factor.valid)return answer({error:b.code?'mfa_invalid':'mfa_required'},401);
   await store.transaction(tx=>writeAudit(tx,u.username,'admin_login'));
  }
  if(p==='/login'){await safelyRecord(()=>recordClientAccess(store,store.sql,u,'login',b.connection,b.authKey?'xtream':'api'));await safelyRecord(()=>recordCustomerActivity(store,u.id,Date.now(),b.connection));}
  await store.delete(bucket);return answer({id:u.id,username:u.username,version:u.version,expiresAt:u.expiresAt,permissions:contentPermissions(u.permissions)});
 }
 if(p==='/canary-identity'||p==='/canary-sample'){
  // Scheduled probes may act only as the one explicitly configured customer.
  // This private route cannot enumerate users or mint an administrator session.
  const configured=env.PLAYBACK_CANARY_USERNAME;
  if(typeof configured!=='string'||!configured||b.username!==configured||b.admin||!validName(normal(configured)))return answer({error:'canary_not_configured'},403);
  const u=await store.get('user:'+normal(configured)),admin=await store.get('admin');
  if(!alive(u)||u.admin||u.role==='admin'||u.id===admin?.id)return answer({error:'canary_account_unavailable'},409);
  if(p==='/canary-identity'){
   const pool=await store.get('pool');
   if(pool?.lines?.length&&pool.syncedAt>Date.now()-12*3600000){const counts=await leases.providerCounts();if(!pool.lines.some(line=>Number(line.maxConnections)-Number(line.external||0)-(counts.get(String(line.id))||0)>=2))return answer({error:'ccf_capacity'},409);}
  }
  if(p==='/canary-sample'){
   if(!['live','movie','series'].includes(b.type))return answer({error:'canary_sample_type'},400);
   const now=Date.now(),pool=await store.get('pool'),health=await store.get('provider-health')||{};
   if(!pool?.lines?.length||pool.syncedAt<now-12*3600000)return answer({sample:null});
   const failed404=b.type==='live'?failedLive404Sample(health,pool,now):null;
   for(const [key,row]of Object.entries(health).filter(([,row])=>row?.ok===true&&row.at>now-1800000&&row.at<=now).sort((a,b)=>b[1].at-a[1].at)){
    const [scope,type,server,id,ext,...provider]=key.split('|');
    if(scope!=='channel'||type!==b.type||!/^\d{1,16}$/.test(id||'')||!/^[a-zA-Z0-9_-]{1,80}$/.test(server||'')||!/^[a-zA-Z0-9]{1,8}$/.test(ext||''))continue;
    if(!pool.lines.some(line=>String(line.id)===provider.join('|')&&String(line.server||'ccf')===server))continue;
    return answer({sample:{type,id,server,ext},...(failed404?{failed404}:{})});
   }
   return answer({sample:null,...(failed404?{failed404}:{})});
  }
  return answer({id:u.id,username:u.username,version:u.version,expiresAt:u.expiresAt,permissions:contentPermissions(u.permissions)});
 }
 if(p==='/check'){
  if(b.xtream){const config=await store.get('xtream-config')||{enabled:true,version:1};if(!config.enabled||config.version!==b.xtreamVersion)return answer({ok:false},401)}
  const u=await store.get(b.admin?'admin':'user:'+normal(b.username));return answer({ok:!!(u&&u.id===b.uid&&u.version===b.version&&(b.admin||alive(u)))},u&&u.id===b.uid&&u.version===b.version&&(b.admin||alive(u))?200:401);
 }
 if(p==='/has')return answer({exists:!!(await store.get('user:'+normal(b.username)))});
 if(p==='/users')return answer(Array.from((await store.list({prefix:'user:'})).values()).map(adminUser));
 if(p==='/save'){
  const username=normal(b.username);if(!validName(username))return answer({error:'invalid_username'},400);
  const old=await store.get('user:'+username),reserved=await store.get('reseller-reservation:'+username);if(!old&&reserved?.until>Date.now())return answer({error:'username_reserved'},409);if(b.create&&old)return answer({error:'username_exists'},409);if(!b.create&&!old)return answer({error:'not_found'},404);
  if(old&&b.updatedAt!==undefined&&b.updatedAt!==old.updatedAt)return answer({error:'edit_conflict'},409);
  if(!['active','suspended'].includes(b.status))return answer({error:'invalid_status'},400);
  if(b.comments!==undefined&&(typeof b.comments!=='string'||b.comments.length>2000))return answer({error:'invalid_comments'},400);
  const permissions=b.permissions===undefined?contentPermissions(old?.permissions):{movies:b.permissions?.movies===true,series:b.permissions?.series===true,tv:b.permissions?.tv===true,adults:Object.hasOwn(b.permissions||{},'adults')?b.permissions.adults===true:contentPermissions(old?.permissions).adults};
  const expiresAt=expiry(b.expiresAt),accessChanged=!old||!!b.password||old.status!==b.status||old.expiresAt!==expiresAt||JSON.stringify(contentPermissions(old.permissions))!==JSON.stringify(permissions);
  let u={...old,permissions,id:old?.id||crypto.randomUUID(),username,name:String(b.name||'').slice(0,120),comments:b.comments===undefined?(old?.comments||''):b.comments,status:b.status,expiresAt,createdAt:old?.createdAt||Date.now(),updatedAt:Math.max(Date.now(),(old?.updatedAt||0)+1),version:accessChanged?(old?.version||0)+1:old.version};
  if(b.password)u=await withPassword(u,b.password);else if(!old)return answer({error:'password_required'},400);
  return store.transaction(async tx=>{const latest=await tx.get('user:'+username),held=await tx.get('reseller-reservation:'+username);if(!latest&&held?.until>Date.now())return answer({error:'username_reserved'},409);if((latest?.version||0)!==(old?.version||0)||latest?.updatedAt!==old?.updatedAt)return answer({error:'edit_conflict'},409);await tx.put('user:'+username,u);if(accessChanged)await leases.in(tx).removeFor({uid:u.id});return answer({...adminUser(u),sessionsRevoked:accessChanged})});
 }
 if(p==='/delete')return store.transaction(async tx=>{const key='user:'+normal(b.username),u=await tx.get(key);if(!u)return answer({error:'not_found'},404);if(u.resellerBridge){const receipt=await tx.get('reseller-line:'+u.resellerBridge.accountId+':'+u.resellerBridge.lineId);if(receipt?.revoked!==true)return answer({error:'reseller_archive_required'},409);}await tx.delete(key);await tx.delete(assignmentKey(u.id));await leases.in(tx).removeFor({uid:u.id});return answer({ok:true})});
 if(p==='/provider-save')return store.transaction(async tx=>{await tx.put('provider',{encrypted:b.encrypted,username:b.username,mode:b.mode||"single",maxConnections:Math.min(3,Math.max(1,Number(b.maxConnections)||3))});await leases.in(tx).clear();await tx.delete('pool');return answer({ok:true})});
 if(p==='/providers'){const list=await store.get('providers');const old=await store.get('provider');return answer(list|| (old?[{...old,source:old.mode==='panel'?'panel:'+normal(old.username):'single:'+normal(old.username)}]:[]))}
 if(p==='/provider-add')return store.transaction(async tx=>{
  const old=await tx.get('provider');let providers=await tx.get('providers');
  if(!providers){providers=old?[{...old,source:old.mode==='panel'?'panel:'+normal(old.username):'single:'+normal(old.username)}]:[];const pool=await tx.get('pool');if(old)await tx.put('source-pools',{[providers[0].source]:pool||{lines:[{id:'single:'+normal(old.username),external:0,maxConnections:old.maxConnections,encrypted:old.encrypted}],syncedAt:0}})}
  const source=b.source;const previous=providers.find(x=>x.source===source);providers=providers.filter(x=>x.source!==source);providers.push({source,encrypted:b.encrypted,username:b.username,name:b.name||b.username,url:b.url,origin:b.origin,mode:b.mode,maxConnections:b.maxConnections||3});
  const pools=await tx.get('source-pools')||{};pools[source]={lines:b.lines,inventory:b.inventory,syncedAt:Date.now()};await tx.put('source-pools',pools);await tx.put('providers',providers);await tx.put('provider',{...providers[0],mode:'panel'});await mergePools(tx,pools,leases.in(tx));return answer({ok:true,updated:!!previous,sourceCount:providers.length});
 });
 if(p==='/provider-remove')return store.transaction(async tx=>{const providers=await tx.get('providers')||[],next=providers.filter(x=>x.source!==b.source);if(next.length===providers.length)return answer({error:'not_found'},404);const pools=await tx.get('source-pools')||{};delete pools[b.source];await tx.put('providers',next);await tx.put('source-pools',pools);if(next.length)await tx.put('provider',{...next[0],mode:'panel'});else await tx.delete('provider');await mergePools(tx,pools,leases.in(tx));return answer({ok:true})});
 if(p==='/permissions'){const user=await store.get('user:'+normal(b.username));return answer(contentPermissions(user?.permissions))}
 if(p==='/provider')return answer(await store.get('provider')||{});
 if(p==='/pool')return answer(await store.get('pool')||{lines:[],syncedAt:0});
 if(p==='/provider-dashboard')return store.transaction(async tx=>answer(await providerDashboard(tx,Date.now(),leases.in(tx))));
 if(p==='/pool-sync')return store.transaction(async tx=>{const lines=b.lines;if(b.source){const pools=await tx.get('source-pools')||{};if(b.retain){const old=pools[b.source];pools[b.source]=old&&old.syncedAt>Date.now()-12*3600000?{...old,attemptedAt:Date.now()}:{lines:[],inventory:old?.inventory||[],syncedAt:old?.syncedAt||0,attemptedAt:Date.now()}}else{if(!Array.isArray(lines))return answer({error:'panel_no_active_lines'},503);pools[b.source]={lines,inventory:b.inventory,syncedAt:Date.now()}}await tx.put('source-pools',pools);await mergePools(tx,pools,leases.in(tx));return answer({ok:true})}if(!Array.isArray(lines))return answer({error:'panel_no_active_lines'},503);await tx.put('pool',{lines,syncedAt:Date.now()});const valid=new Set(lines.map(p=>p.id));await leases.in(tx).removeMatching(l=>l.provider_id&&!valid.has(l.provider_id));return answer({ok:true})});
 if(p==='/overview'){const provider=await store.get('provider'),pool=await store.get('pool'),connections=await leases.count();return answer({provider:provider?{username:provider.username,mode:provider.mode||'single',maxConnections:provider.mode==='panel'?(pool?.lines||[]).reduce((n,l)=>n+l.maxConnections,0):provider.maxConnections,activeAccounts:pool?.lines?.length||0,sourceCount:(await store.get('providers'))?.length||1}:null,connections})}
 if(p==='/playback-begin'||p==='/playback-cancel')return store.transaction(async tx=>{
  if(typeof b.request_id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(b.request_id))return answer({error:'invalid_playback_request'},400);
  const key='playback:'+b.sid,old=await tx.get(key)||{revision:0,cancelled:{}};
  for(const [id,until]of Object.entries(old.cancelled||{}))if(until<=Date.now())delete old.cancelled[id];
  old.cancelled??={};
  if(p==='/playback-cancel'){
   const previous=old.request_id,supersedes=Number.isSafeInteger(b.revision)&&b.revision>old.revision;
   old.cancelled[b.request_id]=Date.now()+120000;
   if(old.request_id===b.request_id)old.request_id=null;
   if(supersedes){old.revision=b.revision;old.request_id=null}
   const local=leases.in(tx);for(const [id,l]of await local.active({sid:b.sid}))if(l.request_id===b.request_id||(supersedes&&l.request_id===previous)){if(l.request_id===previous)rememberProvider(old,l);await local.remove(id);}await tx.put(key,pruneAffinities(old));return answer({ok:true});
  }
  if(old.cancelled[b.request_id]||(Number.isSafeInteger(b.revision)&&b.revision<=old.revision&&old.request_id!==b.request_id))return answer({error:'playback_superseded'},410);
  old.request_id=b.request_id;old.revision=Number.isSafeInteger(b.revision)?b.revision:old.revision+1;
  await tx.put(key,pruneAffinities(old));return answer({ok:true});
 });
 if(p==='/exclusive-acquire')return store.transaction(async tx=>{
  if(!b.request_id||(await tx.get('playback:'+b.sid))?.request_id!==b.request_id)return answer({error:'playback_superseded'},410);
  const user=await tx.get('user:'+normal(b.username));if(!alive(user)||user.id!==b.uid||user.version!==b.version)return answer({error:'account_inactive'},401);
  const found=selectExclusive((await exclusiveSnapshot(tx)).items,b.exclusiveId);if(!found||!(b.live===true?visibleLocalTv(found.row,contentPermissions(user.permissions)):visibleExclusive(found.row,contentPermissions(user.permissions)))||found.row.playbackRevision!==b.playbackRevision)return answer({error:'title_not_allowed'},404);
  const local=leases.in(tx);await local.prune();await local.removeFor({sid:b.sid});const used=await local.count({uid:b.uid});
  const mediaKey=found.row.type+'|'+found.row.profileServer+'|'+b.exclusiveId+'|'+(found.media.mode==='gnula'?'m3u8':new URL(found.media.page).pathname.split('.').at(-1));
  if(used>=3){await recordConnectionLimit(tx,user,{...b,mediaKey,activity:{title:found.media===found.row?found.row.name:found.row.name+' · '+found.media.title}},used);return answer({error:'user_connection_limit'},409);}
  const id=crypto.randomUUID();await local.put(id,{sid:b.sid,uid:b.uid,username:user.username,version:user.version,request_id:b.request_id,exclusiveId:b.exclusiveId,exclusiveParentId:found.row.id,playbackRevision:b.playbackRevision,mediaKey,activity:{title:found.media===found.row?found.row.name:found.row.name+' · '+found.media.title},client:cleanConnectionClient(b.client),startedAt:Date.now(),until:Date.now()+90000,...(b.xtream?{xtream:true}:{})});await recordCustomerActivity(tx,user.id,Date.now(),b.client);return answer({lease_id:id});
 });
 if(p==='/provider-health')return answer(providerHealthSummary(await store.get('provider-health')));
 if(p==='/provider-channel-observations')return answer(await store.transaction(tx=>readChannelObservations(tx,Date.now(),{prune:true})));
 if(p==='/provider-result')return store.transaction(async tx=>{
  const local=leases.in(tx),lease=await local.get(b.lease_id);
  if(!lease||lease.sid!==b.sid||lease.request_id!==b.request_id||lease.provider_id!==b.provider_id||!/^(live|movie|series)\|/.test(String(lease.mediaKey||''))||!['signal','validation'].includes(b.stage)||typeof b.ok!=='boolean')return answer({error:'health_scope'},403);
  const key='playback:'+b.sid,state=await tx.get(key);
  if(lease.until<=Date.now()||state?.request_id!==b.request_id)return answer({error:'playback_superseded'},410);
  if(lease.providerReports?.[b.stage]!==undefined)return answer({ok:true,duplicate:true});
  lease.providerReports={...lease.providerReports,[b.stage]:b.ok};
  if(!b.ok){lease.providerFailed=true;forgetProvider(state,lease);}
  else if(b.stage==='validation'&&!b.capacityBusy){lease.validatedAt=Date.now();rememberProvider(state,lease);}else if(b.capacityBusy)lease.validatedAt=0;
  await local.put(b.lease_id,lease);await tx.put(key,pruneAffinities(state));
  const health=recordProviderHealth(await tx.get('provider-health'),lease.provider_id,lease.mediaKey,b.ok,b.elapsedMs,b.stage,Date.now(),b.lease_id,lease.providerCredentialKey,b.httpStatus,b);
  if(b.stage==='validation'&&b.ok&&b.capacityBusy===true){const row=health['account|'+lease.provider_id];row.busyUntil=Date.now()+5000;delete row.credentialKey;delete row.validatedAt;delete row.mediaAt;}
  if(b.stage==='validation'&&!b.ok&&b.confirmedInactive===true){
   const row=health['account|'+lease.provider_id];row.openUntil=Math.max(row.openUntil||0,Date.now()+30000);row.backoff=Math.max(row.backoff||0,30000);
  }
  if(lease.canary&&b.ok&&!b.capacityBusy&&env.PLAYBACK_CANARY_USERNAME&&normal(lease.username)===normal(env.PLAYBACK_CANARY_USERNAME)){
   const pool=await tx.get('pool'),provider=pool?.lines?.find(p=>p.id===lease.provider_id&&p.credentialKey===lease.providerCredentialKey&&usableProvider(p));
   if(provider){const key='canary-'+assignmentKey(lease.uid);await tx.put(key,saveAssignment(await tx.get(key),affinityGroup(lease),lease.uid,provider));}
  }
  await tx.put('provider-health',health);await recordChannelObservation(tx,lease,b,env);return answer({ok:true});
 });
 if(p==='/acquire')return store.transaction(async tx=>{
  const playbackKey='playback:'+b.sid,playback=await tx.get(playbackKey)||{revision:0,cancelled:{}};
  if(b.request_id&&playback.request_id!==b.request_id)return answer({error:'playback_superseded'},410);
  const provider=await tx.get('provider');if(!provider)return answer({error:'provider_not_configured'},503);
  const u=await tx.get('user:'+normal(b.username));if(!alive(u)||u.id!==b.uid||u.version!==b.version)return answer({error:'account_inactive'},401);
  const local=leases.in(tx);await local.prune();
  const canary=b.canary===true&&!!env.PLAYBACK_CANARY_USERNAME&&normal(b.username)===normal(env.PLAYBACK_CANARY_USERNAME);
  const probeId=await tx.get('background-canary-lease'),probe=probeId?await local.get(probeId):null;
  if(probeId&&(!probe||probe.until<=Date.now())){
   if(probe?.canary)await local.remove(probeId,'customer_priority');
   await tx.delete('background-canary-lease');
  }else if(canary&&probe?.canary&&probe.sid!==b.sid)return answer({error:'ccf_capacity'},409);
  const reclaimProbe=async()=>{if(canary||!probe?.canary)return false;await local.remove(probeId,'customer_priority');await tx.delete('background-canary-lease');return true;};
  const sessionLeases=await local.active({sid:b.sid});
  const owned=[...sessionLeases].filter(([,l])=>l.uid===b.uid&&l.version===b.version&&!l.providerFailed);
  // Preserve the active assignment even when it predates this deployment. A
  // different channel/format is a new lease, not a new CCF account or slot.
  for(const [,l]of owned)rememberProvider(playback,l);
  const group=String(b.server||String(b.mediaKey||'').split('|')[1]||'ccf'),hint=providerAffinity(playback,group,b);
  if(b.xtream||u.resellerBridge){const used=await local.count({uid:b.uid})-[...sessionLeases.values()].filter(l=>l.uid===b.uid).length;if(used>=3){await local.removeFor({sid:b.sid});await recordConnectionLimit(tx,u,b,used);return answer({error:'user_connection_limit'},409);}}
  const activity=cleanPlaybackActivity(b.activity,String(b.mediaKey||'').split('|')[0]);
  const extra={startedAt:Date.now(),client:cleanConnectionClient(b.client),...(canary?{canary:true}:{}),...(b.xtream?{xtream:true}:{}),...(b.request_id?{mediaKey:b.mediaKey,request_id:b.request_id}:{}),...(activity?{activity}:{})};
  if(provider.mode==='panel'){
   // Inventory refresh stays off the streaming path. Counts use an index,
   // rather than deserializing all leases once for every provider candidate.
   const pool=await tx.get('pool');if(!pool||pool.syncedAt<Date.now()-12*3600000)return answer({error:'panel_unavailable'},503);
   const counts=await local.providerCounts();
   // Project replacement of this viewer only. Keep a same-media lease ID and
   // its history intact; all other viewers still count towards capacity.
   for(const l of sessionLeases.values()){const key=String(l.provider_id||'');counts.set(key,Math.max(0,(counts.get(key)||0)-1));}
   const eligible=pool.lines.filter(p=>(p.server||'ccf')===group&&usableProvider(p)&&!(b.exclude||[]).includes(p.id));
   const health=await tx.get('provider-health')||{},now=Date.now();
   const profile=await tx.get((canary?'canary-':'')+assignmentKey(u.id)),primary=assignedProvider(profile,group,u.id,pool.lines,now);
   const primaryFailed=primary&&providerCircuitState(health,primary.id,b.mediaKey,now,{ignoreMedia:true}).blocked;
   // Preserve an active viewer's proven assignment. Other viewers' reports
   // cannot evict it; a circuit for a different requested title still applies.
   const options=p=>{const active=owned.find(([,l])=>l.provider_id===p.id&&affinityGroup(l)===group);return {ignoreAccount:!!active,ignoreMedia:!!active&&active[1].mediaKey===b.mediaKey}};
   const permitted=p=>!(health['account|'+p.id]?.busyUntil>now)&&!providerCircuitState(health,p.id,b.mediaKey,now,options(p)).blocked;
   const occupied=p=>p.external+(counts.get(String(p.id))||0);
   // Background video yields only when its slot would unblock this customer
   // or preserve the customer's healthy assigned account. Unrelated starts
   // and channel changes with spare capacity must not invalidate the probe.
   const trialProvider=!canary&&probe?.canary&&eligible.find(p=>p.id===probe.provider_id&&permitted(p)&&occupied(p)>=p.maxConnections&&occupied(p)-1<p.maxConnections);
   if(trialProvider&&((hint?.provider_id===trialProvider.id||primary?.id===trialProvider.id)||!eligible.some(p=>permitted(p)&&occupied(p)<p.maxConnections))&&await reclaimProbe())counts.set(String(trialProvider.id),Math.max(0,(counts.get(String(trialProvider.id))||0)-1));
   const candidates=eligible.map(p=>({...p,occupied:occupied(p)})).filter(p=>p.occupied<p.maxConnections-(canary?1:0)).sort((a,b)=>a.occupied/a.maxConnections-b.occupied/b.maxConnections);
   const available=candidates.filter(permitted);
   const ranked=rankProviderCandidates(available,health,b.mediaKey,now);
   const preferred=hint&&available.find(p=>p.id===hint.provider_id),home=primary&&!primaryFailed&&!mediaRecentlyFailed(health,primary.id,b.mediaKey,now)&&available.find(p=>p.id===primary.id),selected=preferred||home||ranked[0];
   if(!selected){const capacityBusy=candidates.length&&candidates.every(p=>health['account|'+p.id]?.busyUntil>now);const retry=candidates.map(p=>providerCircuitState(health,p.id,b.mediaKey,now).retryAfterMs).filter(Boolean);return answer({error:candidates.length&&!capacityBusy?'provider_temporarily_unavailable':'ccf_capacity',...(retry.length?{retry_after_ms:Math.min(...retry)}:{})},candidates.length&&!capacityBusy?503:409);}
   const previous=b.request_id&&owned.find(([,l])=>l.provider_id===selected.id&&l.providerCredentialKey===selected.credentialKey&&affinityGroup(l)===group&&l.mediaKey===b.mediaKey),sameRequest=previous&&previous[1].request_id===b.request_id;
   const id=previous?previous[0]:crypto.randomUUID(),trial=claimProviderTrial(health,selected.id,b.mediaKey,id,now,options(selected)),proof=!trial.claimed?recentAccountProof(health,selected,pool.syncedAt,now):0,trustedHint=preferred&&hint.credentialKey===selected.credentialKey,validatedAt=trustedHint&&!trial.claimed?hint.validatedAt:0;
   if(trial.claimed)await tx.put('provider-health',trial.health);
   for(const [oldId]of sessionLeases)if(oldId!==id)await local.remove(oldId,'channel_changed');
   const lease={...(sameRequest?previous[1]:{}),sid:b.sid,uid:b.uid,username:b.username,version:b.version,provider_id:selected.id,providerServer:group,providerCredentialKey:selected.credentialKey,validatedAt,until:Date.now()+90000,...extra,startedAt:previous?previous[1].startedAt||extra.startedAt:extra.startedAt};
   await local.put(id,lease);if(canary)await tx.put('background-canary-lease',id);rememberProvider(playback,lease);await tx.put(playbackKey,playback);await recordCustomerActivity(tx,u.id,Date.now(),b.client);
   if(!canary&&(!primary||primaryFailed))await tx.put(assignmentKey(u.id),saveAssignment(profile,group,u.id,selected,now));
   return answer({lease_id:id,provider_id:selected.id,encrypted:selected.encrypted,maxConnections:selected.maxConnections,...(previous?{reused:true,request_id:b.request_id}:{}),...(preferred||home?{affinity:true}:{}),...(!trial.claimed&&(preferred||proof)?{validatedRecently:!!proof||!!trustedHint&&recentlyValidated(hint)}:{})});
  }
  await local.removeFor({sid:b.sid});
  const max=Math.min(provider.maxConnections,Math.max(1,Number(b.upstreamMax)||3));
  if(Math.max(await local.count(),Number(b.upstreamExternal)||0)>=max&&!canary)await reclaimProbe();
  if(Math.max(await local.count(),Number(b.upstreamExternal)||0)>=max-(canary?1:0))return answer({error:'ccf_capacity',maxConnections:max},409);
  const id=crypto.randomUUID();await local.put(id,{sid:b.sid,uid:b.uid,username:b.username,version:b.version,until:Date.now()+90000,...extra});if(canary)await tx.put('background-canary-lease',id);await recordCustomerActivity(tx,u.id,Date.now(),b.client);return answer({lease_id:id});
 });
 if(p==='/playback-activity')return store.transaction(async tx=>{
  const local=leases.in(tx),lease=await local.get(b.lease_id),state=await tx.get('playback:'+b.sid);
  if(!lease||lease.sid!==b.sid||lease.uid!==b.uid||lease.version!==b.version||lease.request_id!==b.request_id||state?.request_id!==b.request_id||lease.mediaKey!==b.mediaKey||lease.until<=Date.now())return answer({error:'playback_superseded'},410);
  const activity=cleanPlaybackActivity(b.activity,String(lease.mediaKey||'').split('|')[0]);
  if(activity){await local.put(b.lease_id,{...lease,activity});await safelyRecord(()=>labelPlayback(tx,store.sql,b.lease_id,activity))}return answer({ok:true});
 });
 if(p==='/lease-check'||p==='/heartbeat'||p==='/release'||p==='/local-startup-observe')return store.transaction(async tx=>{
  const local=leases.in(tx),l=await local.get(b.lease_id);if(!l||l.sid!==b.sid)return answer({error:'playback_expired'},410);
  if(p==='/release'){
   if(b.request_id&&l.request_id!==b.request_id)return answer({ok:true,reused:true});
   const key='playback:'+b.sid,state=await tx.get(key);
   // A delayed close/failure from the previous channel cannot replace the
   // newer binding. A failed source must never be restored by body cleanup.
   if(state&&(!state.request_id||state.request_id===l.request_id)){
    if(b.reason==='upstream_failed'||l.providerFailed)forgetProvider(state,l);else rememberProvider(state,l);
    await tx.put(key,pruneAffinities(state));
   }
   await local.remove(b.lease_id,'player_closed');return answer({ok:true});
  }
  if(b.request_id&&l.request_id!==b.request_id)return answer({error:'playback_superseded'},410);
  if(b.request_id&&(await tx.get('playback:'+b.sid))?.request_id!==b.request_id)return answer({error:'playback_superseded'},410);
  const u=await tx.get('user:'+normal(l.username));if(l.until<=Date.now()||!alive(u)||u.id!==l.uid||u.version!==l.version){await local.remove(b.lease_id);return answer({error:'playback_expired'},410)}
  let localVideoProbe=false,exclusiveScopeChecked=false;
  if((p==='/heartbeat'&&b.exclusiveId)||p==='/local-startup-observe'){
   // Current catalog scope and lease renewal share one transaction/RPC. This
   // replaces a separate item read; no authorization result is cached.
   if(!l.exclusiveId||b.exclusiveId!==l.exclusiveId||b.parentId!==l.exclusiveParentId||b.playbackRevision!==l.playbackRevision)return answer({error:'title_not_allowed'},410);
   const itemResponse=await exclusiveCatalogRoute(tx,'/exclusive-item-read',{id:l.exclusiveParentId});
   const current=itemResponse.ok?selectExclusive([await itemResponse.json()],l.exclusiveId):null;
   if(!current||!current.row.visible||current.row.playbackRevision!==l.playbackRevision)return answer({error:'title_not_allowed'},410);
   if(p==='/heartbeat'&&!visibleLocalTv(current.row,contentPermissions(u.permissions)))return answer({error:'title_not_allowed'},410);
   exclusiveScopeChecked=true;
   if(p==='/local-startup-observe'){
    if(!visibleLocalTv(current.row,contentPermissions(u.permissions)))return answer({error:'title_not_allowed'},410);
    if(!['playlist','firstVideoBytes'].includes(b.stage)||b.stage==='firstVideoBytes'&&!l.localVideoClaimed)return answer({error:'invalid_stage'},400);
    if(!l.localObserved?.[b.stage]&&await recordLocalStartup(tx,l.exclusiveId,b.stage,b.durationMs)){
     l.localObserved={...l.localObserved,[b.stage]:true};await local.put(b.lease_id,l);
    }
    return answer({ok:true});
   }
   if(b.localVideo===true&&!l.localVideoClaimed&&visibleLocalTv(current.row,contentPermissions(u.permissions))){l.localVideoClaimed=true;await local.put(b.lease_id,l);localVideoProbe=true;}
  }
  if(p==='/lease-check')await safelyRecord(()=>touchPlayback(tx,store.sql,b.lease_id,Date.now(),true));
  if(p==='/heartbeat'){await local.renew(b.lease_id,Date.now()+90000);await recordCustomerActivity(tx,u.id);}return answer({ok:true,...(exclusiveScopeChecked?{exclusiveScopeChecked:true}:{}),...(localVideoProbe?{localVideoProbe:true}:{})});
 });
 if(p==='/release-session'){await store.transaction(async tx=>{await leases.in(tx).removeFor({sid:b.sid});await tx.delete('playback:'+b.sid)});return answer({ok:true})}
 return answer({error:'not_found'},404);
 }catch(e){return answer({error:['password_length','invalid_expiry'].includes(e.message)?e.message:'account_operation_failed'},400)}
}


async function mergePools(tx,pools,leases){
 const unique=new Map(),keys=new Map();for(const pool of Object.values(pools))for(const line of pool.lines){const id=keys.get(line.key)||line.id,previous=unique.get(id);const next=previous?{...line,id:previous.id,maxConnections:Math.min(previous.maxConnections,line.maxConnections),external:Math.max(previous.external,line.external)}:line;unique.set(id,next);if(line.key)keys.set(line.key,id)}
 const lines=[...unique.values()];await tx.put('pool',{lines,syncedAt:Object.keys(pools).length?Math.min(...Object.values(pools).map(p=>p.attemptedAt||p.syncedAt)):Date.now()});await leases.removeMatching(l=>l.provider_id&&!unique.has(l.provider_id));
}

async function registerXtream(store,entries){
 if(!Array.isArray(entries)||entries.length>50000)return answer({error:'invalid_catalog'},400);
 const kinds=new Set(['live','movie','series_list','episode','live_category','movie_category','series_category']);
 if(entries.some(e=>!kinds.has(e.kind)||typeof e.server!=='string'||e.server.length>100||!/^\d{1,16}$/.test(String(e.upstreamId))))return answer({error:'invalid_catalog'},400);
 return store.transaction(async tx=>{
  let next=await tx.get('xtream-next-id')||1;const result=[];
  for(let offset=0;offset<entries.length;offset+=60){const chunk=entries.slice(offset,offset+60),keys=chunk.map(e=>'xtream-map:'+e.kind+':'+e.server+':'+e.upstreamId),existing=await tx.get(keys),writes={};
   const knownIds=[...new Set([...existing.values()])],known=knownIds.length?await tx.get(knownIds.map(id=>'xtream-id:'+id)):new Map();
   for(let i=0;i<chunk.length;i++){const key=keys[i],e=chunk[i],activity=cleanPlaybackActivity(e.activity,e.kind==='episode'||e.kind==='series_list'?'series':e.kind);let id=existing.get(key)||writes[key];const isNew=!id;if(isNew){if(next>2147483647)throw Error('catalog_id_limit');id=next++;writes[key]=id;}
    const previous=writes['xtream-id:'+id]||known.get('xtream-id:'+id),record={kind:e.kind,server:e.server,upstreamId:String(e.upstreamId),...(e.ext?{ext:e.ext}:{}),...(e.parentId?{parentId:String(e.parentId)}:{}),...(activity?{activity}:previous?.activity?{activity:previous.activity}:{}),id};
    if(isNew||JSON.stringify(previous)!==JSON.stringify(record))writes['xtream-id:'+id]=record;result.push(id)}
   if(Object.keys(writes).length)await tx.put(writes);
  }
  await tx.put('xtream-next-id',next);return answer(result);
 });
}

