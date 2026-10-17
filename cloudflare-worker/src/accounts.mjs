import {exclusiveCatalogRoute,exclusiveSnapshot,selectExclusive,visibleExclusive} from './exclusive-catalog.mjs';
import {cleanConnectionClient,recordConnectionLimit,updateConnectionQuality,closeResellerConnection} from './connection-monitor.mjs';
import {resellerPresence,resellerPlaybackSummary,resellerLiveConnections,recordCustomerActivity} from './reseller-presence.mjs';
import {resellerAccounts} from './reseller-accounts.mjs';
import {nativeResellerImport} from './native-reseller-import.mjs';
import {resellerIntegrity} from './reseller-integrity.mjs';
import {readClientHistory,recordClientAccess,safelyRecord,touchPlayback} from './client-history.mjs';
import {catalogMaintenanceRoute,runCatalogMaintenance} from './catalog-maintenance.mjs';
// Private Durable Object routes. This module is never served as an HTTP endpoint.
import {contentPermissions} from './content-permissions.mjs';
import {catalogCacheRoute} from './catalog-cache.mjs';
import {providerDashboard} from './provider-dashboard.mjs';
import {openLeaseStore} from './lease-store.mjs';
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
 const leases=await openLeaseStore(store);
 if(p==='/catalog-maintenance-tick'){
  await runCatalogMaintenance(env,{directory:(env,path,body={})=>env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_accounts_v1')).fetch('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)})});return answer({ok:true});
 }
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
 if(p==='/delete')return store.transaction(async tx=>{const key='user:'+normal(b.username),u=await tx.get(key);if(!u)return answer({error:'not_found'},404);if(u.resellerBridge){const receipt=await tx.get('reseller-line:'+u.resellerBridge.accountId+':'+u.resellerBridge.lineId);if(receipt?.revoked!==true)return answer({error:'reseller_archive_required'},409);}await tx.delete(key);await leases.in(tx).removeFor({uid:u.id});return answer({ok:true})});
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
   await tx.put(key,old);const local=leases.in(tx);for(const [id,l]of await local.active({sid:b.sid}))if(l.request_id===b.request_id||(supersedes&&l.request_id===previous))await local.remove(id);return answer({ok:true});
  }
  if(old.cancelled[b.request_id]||(Number.isSafeInteger(b.revision)&&b.revision<=old.revision&&old.request_id!==b.request_id))return answer({error:'playback_superseded'},410);
  old.request_id=b.request_id;old.revision=Number.isSafeInteger(b.revision)?b.revision:old.revision+1;
  await tx.put(key,old);return answer({ok:true});
 });
 if(p==='/exclusive-acquire')return store.transaction(async tx=>{
  if(!b.request_id||(await tx.get('playback:'+b.sid))?.request_id!==b.request_id)return answer({error:'playback_superseded'},410);
  const user=await tx.get('user:'+normal(b.username));if(!alive(user)||user.id!==b.uid||user.version!==b.version)return answer({error:'account_inactive'},401);
  const found=selectExclusive((await exclusiveSnapshot(tx)).items,b.exclusiveId);if(!found||!visibleExclusive(found.row,contentPermissions(user.permissions))||found.row.playbackRevision!==b.playbackRevision)return answer({error:'title_not_allowed'},404);
  const local=leases.in(tx);await local.prune();await local.removeFor({sid:b.sid});const used=await local.count({uid:b.uid});
  const mediaKey=found.row.type+'|'+found.row.profileServer+'|'+b.exclusiveId+'|'+(found.media.mode==='gnula'?'m3u8':new URL(found.media.page).pathname.split('.').at(-1));
  if(used>=3){await recordConnectionLimit(tx,user,{...b,mediaKey,activity:{title:found.media===found.row?found.row.name:found.row.name+' · '+found.media.title}},used);return answer({error:'user_connection_limit'},409);}
  const id=crypto.randomUUID();await local.put(id,{sid:b.sid,uid:b.uid,username:user.username,version:user.version,request_id:b.request_id,exclusiveId:b.exclusiveId,exclusiveParentId:found.row.id,playbackRevision:b.playbackRevision,mediaKey,activity:{title:found.media===found.row?found.row.name:found.row.name+' · '+found.media.title},client:cleanConnectionClient(b.client),startedAt:Date.now(),until:Date.now()+90000,...(b.xtream?{xtream:true}:{})});await recordCustomerActivity(tx,user.id,Date.now(),b.client);return answer({lease_id:id});
 });
 if(p==='/acquire')return store.transaction(async tx=>{
  if(b.request_id&&(await tx.get('playback:'+b.sid))?.request_id!==b.request_id)return answer({error:'playback_superseded'},410);
  const provider=await tx.get('provider');if(!provider)return answer({error:'provider_not_configured'},503);
  const u=await tx.get('user:'+normal(b.username));if(!alive(u)||u.id!==b.uid||u.version!==b.version)return answer({error:'account_inactive'},401);
  const local=leases.in(tx);await local.prune();
  const sessionLeases=await local.active({sid:b.sid});
  if(b.request_id){const previous=[...sessionLeases].find(([,l])=>l.mediaKey===b.mediaKey&&!(b.exclude||[]).includes(l.provider_id));if(previous){const [id,l]=previous;l.until=Date.now()+90000;if(l.request_id!==b.request_id){delete l.quality;delete l.qualityReport;delete l.qualityUpdatedAt;}l.request_id=b.request_id;l.client=cleanConnectionClient(b.client);const activity=cleanPlaybackActivity(b.activity,String(b.mediaKey||'').split('|')[0]);if(activity)l.activity=activity;await local.put(id,l);await recordCustomerActivity(tx,u.id,Date.now(),b.client);const pool=await tx.get('pool'),line=pool?.lines?.find(x=>x.id===l.provider_id);return answer({lease_id:id,provider_id:l.provider_id,encrypted:line?.encrypted,maxConnections:line?.maxConnections,reused:true,request_id:b.request_id})}}
  await local.removeFor({sid:b.sid});
  if(b.xtream||u.resellerBridge){const used=await local.count({uid:b.uid});if(used>=3){await recordConnectionLimit(tx,u,b,used);return answer({error:'user_connection_limit'},409);}}
  const activity=cleanPlaybackActivity(b.activity,String(b.mediaKey||'').split('|')[0]);
  const extra={startedAt:Date.now(),client:cleanConnectionClient(b.client),...(b.xtream?{xtream:true}:{}),...(b.request_id?{mediaKey:b.mediaKey,request_id:b.request_id}:{}),...(activity?{activity}:{})};
  if(provider.mode==='panel'){
   // Inventory refresh stays off the streaming path. Counts use an index,
   // rather than deserializing all leases once for every provider candidate.
   const pool=await tx.get('pool');if(!pool||pool.syncedAt<Date.now()-12*3600000)return answer({error:'panel_unavailable'},503);
   const counts=await local.providerCounts();
   const candidates=pool.lines.filter(p=>(!b.server||(p.server||'ccf')===b.server)&&!(b.exclude||[]).includes(p.id)).map(p=>({...p,occupied:p.external+(counts.get(String(p.id))||0)})).filter(p=>p.occupied<p.maxConnections).sort((a,b)=>a.occupied/a.maxConnections-b.occupied/b.maxConnections);
   const selected=candidates[0];if(!selected)return answer({error:'ccf_capacity'},409);
   const id=crypto.randomUUID();await local.put(id,{sid:b.sid,uid:b.uid,username:b.username,version:b.version,provider_id:selected.id,until:Date.now()+90000,...extra});await recordCustomerActivity(tx,u.id,Date.now(),b.client);return answer({lease_id:id,provider_id:selected.id,encrypted:selected.encrypted,maxConnections:selected.maxConnections});
  }
  const max=Math.min(provider.maxConnections,Math.max(1,Number(b.upstreamMax)||3));
  if(Math.max(await local.count(),Number(b.upstreamExternal)||0)>=max)return answer({error:'ccf_capacity',maxConnections:max},409);
  const id=crypto.randomUUID();await local.put(id,{sid:b.sid,uid:b.uid,username:b.username,version:b.version,until:Date.now()+90000,...extra});await recordCustomerActivity(tx,u.id,Date.now(),b.client);return answer({lease_id:id});
 });
 if(p==='/lease-check'||p==='/heartbeat'||p==='/release')return store.transaction(async tx=>{
  const local=leases.in(tx),l=await local.get(b.lease_id);if(!l||l.sid!==b.sid)return answer({error:'playback_expired'},410);
  if(p==='/release'){if(b.request_id&&l.request_id!==b.request_id)return answer({ok:true,reused:true});await local.remove(b.lease_id,'player_closed');return answer({ok:true})}
  if(b.request_id&&l.request_id!==b.request_id)return answer({error:'playback_superseded'},410);
  if(b.request_id&&(await tx.get('playback:'+b.sid))?.request_id!==b.request_id)return answer({error:'playback_superseded'},410);
  const u=await tx.get('user:'+normal(l.username));if(l.until<=Date.now()||!alive(u)||u.id!==l.uid||u.version!==l.version){await local.remove(b.lease_id);return answer({error:'playback_expired'},410)}
  if(p==='/lease-check')await safelyRecord(()=>touchPlayback(tx,store.sql,b.lease_id,Date.now(),true));
  if(p==='/heartbeat'){await local.renew(b.lease_id,Date.now()+90000);await recordCustomerActivity(tx,u.id);}return answer({ok:true});
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
