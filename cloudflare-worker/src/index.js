import {startupDeadline,readLivePlaylist,readInitialMedia,VOD_STARTUP_MS,reportLiveResult,deferPlaybackReport} from './live-startup.mjs';
import {boxpanelFetch} from './boxpanel.mjs';
import {createBoxClient} from './boxpanel-client.mjs';
import {TRUSTED_RESELLERS} from './reseller-trust.mjs';
import {createTelegramTick} from './telegram-tick.mjs';
import {markServiceVerification} from './service-verification.mjs';
import {createAllOriginConnections,readOriginSnapshot,originSnapshotResponse,originProviderKey,originMonitorProviders} from './origin-connections.mjs';
import {createOwnerPortal,matchesOwnerPortal} from './owner-portal.mjs';
import {createCcfExporter} from './ccf-record.mjs';
import {createOwnerAdminAccess,ownerAccessState} from './owner-admin-access.mjs';
import {selectExclusive,visibleExclusive} from './exclusive-catalog.mjs';
import {createExclusiveService} from './exclusive-service.mjs';
import {GNULA_CATALOG} from './exclusive-seed.mjs';
import {resolveGnula,allowedGnula} from './gnula-source.mjs';
import {catalogMaintenanceStatus} from './catalog-maintenance.mjs';
import {playbackQualityContext} from './native-playback-quality.mjs';
import {requestConnectionClient} from './connection-monitor.mjs';
import {createResellerPortal,matchesResellerPortal,PORTAL_ACCOUNT} from './reseller-portal.mjs';
import {createResellerBridge} from './reseller-bridge.mjs';
import {probeResellerMedia} from './reseller-media-probe.mjs';
import {profileRoute} from './profiles.mjs';
import {operationsRoute} from './operations.mjs';
import {MONITOR_CRON,monitorCall} from './monitor.mjs';
import {probeProviders} from './provider-monitor.mjs';
export {OperationsMonitor} from './monitor.mjs';
import {allowedOrigins,canUseCookie,cookieToken,withSessionCookie,browserResponse} from './browser-sessions.mjs';
import {traceRequest, SERVICE_VERSION} from './request-diagnostics.mjs';
import {playbackErrorHeaders} from './playback-outcomes.mjs';
import {PlaybackTimings,timed,playbackTimingsRoute} from './playback-timings.mjs';
import {runPlaybackCanary} from './playback-canary.mjs';
import {compareOwnPlayback,comparisonError} from './playback-comparison.mjs';
import {auditLive404} from './playback-404-audit.mjs';
import {fetchControlMedia} from './playback-control-ip.mjs';
import {readProviderJSON} from './provider-request.mjs';
import {sharedProviderValidation,PROVIDER_VALIDATION_MS} from './provider-validation.mjs';
import {ownPlaybackCanaryAdapter} from './own-playback-canary.mjs';
import {CCF_MEDIA_ORIGIN} from './ip-media.mjs';
import {fetchValidatedMedia,validatedMediaTarget} from './media-origin.mjs';
import {readPanel,readPanelRecord,validateServerUrl} from "./reseller.mjs";
import {accountsFetch} from "./accounts.mjs";
export {BackupRecovery} from './backup-recovery.mjs';
import {matchesXtream} from './xtream.mjs';
import {contentPermissions,createAdultPolicy,isAdult} from './content-permissions.mjs';
import {createProviderCatalog} from './provider-catalog.mjs';
import {diagnoseSeries} from './series-diagnostic.mjs';
import {createXtreamBridge,guardXtreamResponse} from './xtream-bridge.mjs';
import {recoverMedia} from './media-fetch.mjs';
import {guardPlaybackExpiry} from './playback-expiry.mjs';
import {prepareWebPlayback} from './web-playback.mjs';
import {cachedPlaybackActivity,episodeActivity} from './playback-activity.mjs';
const liveStarts=new Map();
function rememberLiveStart(url,body){const now=Date.now();for(const [key,value] of liveStarts)if(value.until<now)liveStarts.delete(key);if(liveStarts.size>=128)liveStarts.delete(liveStarts.keys().next().value);liveStarts.set(url,{body,until:now+10000})}
const ORIGIN=CCF_MEDIA_ORIGIN;
const SITE="https://snapmovienow.github.io";
const actions={live:"get_live_streams",live_epg:"get_short_epg",live_categories:"get_live_categories",vod_categories:"get_vod_categories",vod:"get_vod_streams",series_categories:"get_series_categories",series:"get_series",series_info:"get_series_info",vod_info:"get_vod_info"};
const cors={"Access-Control-Allow-Origin":SITE,"Access-Control-Allow-Methods":"GET, HEAD, POST, OPTIONS","Access-Control-Allow-Headers":"content-type, range, if-range","Access-Control-Expose-Headers":"Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified","Cache-Control":"no-store"};
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,"content-type":"application/json",...playbackErrorHeaders(x,s),...(s===503&&Number(x?.retry_after_ms)>0?{"Retry-After":String(Math.ceil(Math.min(300000,x.retry_after_ms)/1000))}:{})}});
const cleanExt=x=>String(x||"mp4").replace(/[^a-zA-Z0-9]/g,"")||"mp4";
const aesKeys=new Map();
async function aesKey(secret){if(!aesKeys.has(secret)){if(aesKeys.size>=2)aesKeys.delete(aesKeys.keys().next().value);aesKeys.set(secret,crypto.subtle.digest("SHA-256",new TextEncoder().encode(secret)).then(digest=>crypto.subtle.importKey("raw",digest,{name:"AES-GCM"},false,["encrypt","decrypt"])))}return aesKeys.get(secret)}
const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
const unb64=s=>Uint8Array.from(atob(s.replace(/-/g,"+").replace(/_/g,"/")+"=".repeat((4-s.length%4)%4)),c=>c.charCodeAt(0));
async function ticket(env,data){if(!env.TICKET_SECRET)throw new Error("TICKET_SECRET missing");const iv=crypto.getRandomValues(new Uint8Array(12));const ct=await crypto.subtle.encrypt({name:"AES-GCM",iv},await aesKey(env.TICKET_SECRET),new TextEncoder().encode(JSON.stringify(data)));const out=new Uint8Array(iv.length+ct.byteLength);out.set(iv);out.set(new Uint8Array(ct),iv.length);return b64(out)}
async function unticket(env,t){try{if(!env.TICKET_SECRET)return null;const raw=unb64(t);if(raw.length<29)return null;const iv=raw.slice(0,12),ct=raw.slice(12);const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv},await aesKey(env.TICKET_SECRET),ct);const d=JSON.parse(new TextDecoder().decode(plain));return d.exp>Date.now()?d:null}catch{return null}}

export class PlaybackSession {
 constructor(state,env){this.state=state;this.env=env}
 async fetch(req){const path=new URL(req.url).pathname;
 if(path==='/boxpanel/private')return boxpanelFetch(this.state,req);
 if(path==='/ccf-origin-snapshot')return originSnapshotResponse(this,async()=>{const body=await req.json();let p,credential;if(body.monitor){p=(await originMonitorProviders([body.monitor]))[0];if(p.source!==body.source)throw Error('panel_origin_source');credential=p.credential;}else{const providers=await (await directory(this.env,'/providers')).json();p=providers.find(p=>p.mode==='panel'&&p.source===body.source);if(!p)throw Error('panel_origin_source');credential=await unticket(this.env,p.encrypted);}if(await originProviderKey(p)!==body.key)throw Error('panel_origin_source');if(credential?.kind!=='reseller')throw Error('panel_invalid');return readOriginSnapshot({username:credential.username,password:credential.password,base:p.url||'http://ccf.center:8444/NYzkggyG/'});});
 if(path==='/stream'&&['GET','HEAD'].includes(req.method)){const trace=new PlaybackTimings();try{return trace.response(await observedWebStream(this,req,{waitUntil:promise=>this.state.waitUntil?.(promise)},trace))}catch(error){const owned=await unticket(this.env,new URL(req.url).searchParams.get('t')||'');if(error.message==='media_origin_unapproved'&&!owned?.canary)throw error;const response=json({error:['media_origin_unapproved','live_startup_timeout','media_empty'].includes(error.message)?error.message:'stream_unavailable'},error.message==='live_startup_timeout'?504:502);if(owned?.canary)response.headers.set('X-SMN-Canary-Failure',comparisonError(error));return trace.response(response)}}
 if(path==='/refresh-pool'){const force=req.method==='POST'&&(await req.json()).force===true;if(!this.refreshing)this.refreshing=refreshProviderPool(this.env,force).finally(()=>{this.refreshing=null});try{const lines=await this.refreshing;return Response.json({ok:true,single:lines===null})}catch(e){return Response.json({error:e.message},{status:503})}}
 if(path==='/canary-comparison-status')return Response.json({...await this.state.storage.get('owner-comparison-20261024-tcp-relay-v1')||{state:'waiting'},failure404:await this.state.storage.get('owner-live404-audit-v1')||null});
 if(path==='/canary-run'){const config=await req.json();if(!envCanaryAllowed(this.env,config))return Response.json({error:'canary_account_not_allowed'},{status:403});const accountKey='owner-comparison-account-20261023-v1',previousAccount=await this.state.storage.get(accountKey),priorComparison=await this.state.storage.get('owner-comparison-20261024-tcp-relay-v1');let selectedAccount,observedSample;const ctx={waitUntil:p=>this.state.waitUntil?.(p)},adapter=ownPlaybackCanaryAdapter({env:this.env,storage:this.state.storage,directory,ownSession,ticket,sessionCall,onSample:sample=>{observedSample=sample},diagnosticExclude:priorComparison?.results?.[0]?.origin?.ok===false&&previousAccount?[previousAccount]:[],onDiagnosticTarget:async(session,target)=>{const d=await unticket(this.env,new URL(target.url).searchParams.get('t')||'');if(d?.comparison&&d.sid===session.sid&&d.lease_id===target.lease_id)selectedAccount=d.provider_id},request:request=>traceRequest(request,trace=>handleRequest(request,this.env,ctx,trace))});const result=await runPlaybackCanary(config,adapter),failedSample=observedSample;if(!result.ok&&result.status!=='busy')await this.state.storage.delete('canary-sample:'+config.type);
  const key='owner-comparison-20261024-tcp-relay-v1',prior=await this.state.storage.get(key)||{attempts:0,results:[]};
  const covered=new Set(prior.results.filter(r=>r.origin&&r.relay).map(r=>r.type)),pending=prior.results[0]?.origin?.ok===false?prior.results[0].type:!covered.has('live')?'live':!covered.has('series')?'series':null;
  if(prior.attempts<3&&pending){const next={...prior,state:'running',attempts:prior.attempts+1};await this.state.storage.put(key,next);const comparison=await compareOwnPlayback(adapter,(session,target,options)=>ownPlaybackControl(this.env,session,target,options),{username:this.env.PLAYBACK_CANARY_USERNAME,type:pending,directCcfEntry:this.env.PLAYBACK_CONTROL_CCF_SOCKET==='true'});if(selectedAccount){comparison.accountChanged=!!previousAccount&&selectedAccount!==previousAccount;await this.state.storage.put(accountKey,selectedAccount)}next.results=[comparison,...prior.results].slice(0,3);next.state=next.attempts>=3||new Set(next.results.filter(r=>r.origin&&r.relay).map(r=>r.type)).size>=2&&comparison.origin?.ok!==false?'complete':'waiting';await this.state.storage.put(key,next)}
  await auditLive404(this.state.storage,result,failedSample,sample=>compareOwnPlayback(adapter,(session,target,options)=>ownPlaybackControl(this.env,session,target,options),{username:this.env.PLAYBACK_CANARY_USERNAME,type:'live',sample,directCcfEntry:this.env.PLAYBACK_CONTROL_CCF_SOCKET==='true'}));
  return Response.json(result)}
 if(path==='/monitor-providers'){const providers=await (await directory(this.env,'/providers')).json();return Response.json(await probeProviders(providers,{decrypt:value=>unticket(this.env,value),readPanel,validateAccount:(username,password,origin,timeout,signal)=>validateAccount(username,password,origin,timeout,signal,this.env.CCF_ENTRY_TRANSPORT==='tcp'),identifier:hashId}))}
 if(path.startsWith('/profile/'))return profileRoute(this.state.storage,req);
 if(path.startsWith('/operations/timing-'))return playbackTimingsRoute(this.state.storage,req);
 if(path==='/operations/monitor'){const [playback,timings]=await Promise.all([operationsRoute(this.state.storage,req),playbackTimingsRoute(this.state.storage,new Request('https://private/operations/timing-read',{method:'POST',body:'{}'}))]);return Response.json({...await playback.json(),timings:(await timings.json()).groups})}
 if(path.startsWith('/operations/'))return operationsRoute(this.state.storage,req);
 if(path.startsWith("/accounts/"))return accountsFetch(this.state,this.env,req);if(path==="/create"){const {exp,identity,sid}=await req.json();await this.state.storage.put("exp",exp);if(sid)await this.state.storage.put("sid",sid);if(identity)await this.state.storage.put("identity",identity);await this.state.storage.setAlarm(exp);return new Response("ok")}
 if(path==="/logout"){await this.state.storage.deleteAll();return new Response("ok")}
 if(path==='/ensure'){const {exp,identity,sid}=await req.json(),oldExp=await this.state.storage.get('exp'),old=await this.state.storage.get('identity');if(oldExp>Date.now()&&old?.uid===identity.uid&&old.version===identity.version&&old.xtreamVersion===identity.xtreamVersion)return Response.json({exp:oldExp});await this.state.storage.put('exp',exp);if(sid)await this.state.storage.put('sid',sid);await this.state.storage.put('identity',identity);await this.state.storage.setAlarm(exp);return Response.json({exp})}
 const exp=await this.state.storage.get("exp");const identity=await this.state.storage.get("identity");if(identity&&!(await directory(this.env,"/check",identity)).ok)return new Response("Inactive",{status:401});if(path.startsWith('/owner-access/'))return ownerAccessState(this.state.storage,path,await req.json(),exp,identity?.admin===true);return new Response(exp>Date.now()?"ok":"expired",{status:exp>Date.now()?200:401})}
 async alarm(){const sid=await this.state.storage.get("sid");if(sid)await directory(this.env,"/release-session",{sid});await this.state.storage.deleteAll()}
}
async function publicCanaryHealth(env){if(!env.PLAYBACK_CANARY_USERNAME)return {configured:false};try{const r=await monitorCall(env,'/status');if(!r.ok)return {configured:true,status:'unknown'};const c=(await r.json()).canary;return {configured:!!c?.configured,enabled:!!c?.enabled,lastCheckedAt:c?.lastCheckedAt||null,status:c?.status||'waiting',results:(c?.results||[]).map(({type,status,at,totalMs,reason,stages,failure})=>({type,status,at,totalMs,reason,stages,...(failure?{failure}:{})}))}}catch{return {configured:true,status:'unknown'}}}
async function publicComparisonHealth(env){if(!env.PLAYBACK_CANARY_USERNAME)return {state:'disabled'};try{const r=await env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_canary_v1')).fetch('https://private/canary-comparison-status');return r.ok?await r.json():{state:'unknown'}}catch{return {state:'unknown'}}}
function envCanaryAllowed(env,config){return env.ENVIRONMENT!=='staging'&&!!env.PLAYBACK_CANARY_USERNAME&&String(config?.username||'').toLowerCase()===String(env.PLAYBACK_CANARY_USERNAME).toLowerCase()&&['live','movie','series'].includes(config?.type)}
async function sessionCall(env,sid,path,body){if(!env.PLAYBACK_SESSIONS||!sid)return new Response("Unauthorized",{status:401});return env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName(sid)).fetch("https://session"+path,{method:body?"POST":"GET",...(body?{body:JSON.stringify({...body,sid})}:{})})}
async function createSession(env,username,password,accountExpiresAt=null){const sid=crypto.randomUUID(),exp=Math.min(Date.now()+12*60*60*1000,accountExpiresAt||Infinity);const r=await sessionCall(env,sid,"/create",{exp});if(!r.ok)throw Error("session_unavailable");return {sid,username,password,exp,accountExpiresAt,kind:"session"}}
async function validateAccount(username,password,origin=ORIGIN,timeout=6000,signal,directCcfEntry=false){const x=new URL(origin+"/player_api.php");x.searchParams.set("username",username);x.searchParams.set("password",password);const a=await readProviderJSON(x,{timeoutMs:timeout,signal,directCcfEntry});if(!['0','1'].includes(String(a?.user_info?.auth)))throw Object.assign(Error('provider_unavailable'),{failureCode:'invalid_reply'});return String(a.user_info.auth)==="1"&&(!a.user_info.status||a.user_info.status==="Active")&&(!(Number(a.user_info.exp_date)>0)||Number(a.user_info.exp_date)*1000>Date.now())?a:null}
async function directory(env,path,body={}){return env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName("__smn_accounts_v1")).fetch("https://private/accounts"+path,{method:"POST",body:JSON.stringify(body)})}
async function boxpanelCall(env,body,scope){return env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_boxpanel_v1')).fetch('https://private/boxpanel/private',{method:'POST',body:JSON.stringify({body,scope})});}
async function registry(env,path,body={}){return env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_xtream_catalog_v1')).fetch('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)})}
async function ownSession(env,user,admin=false){const sid=crypto.randomUUID(),exp=Math.min(Date.now()+(admin?2:12)*3600000,user.expiresAt||Infinity),identity={uid:user.id,username:user.username,version:user.version,admin};const r=await sessionCall(env,sid,"/create",{exp,identity});if(!r.ok)throw Error("session_unavailable");return {kind:admin?"admin":"session",managed:!admin,sid,exp,accountExpiresAt:user.expiresAt||null,permissions:user.permissions,...identity}}
const hashId=async value=>b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const serverId=async origin=>origin===ORIGIN?'ccf':await hashId(origin);
async function encryptedLines(env,raw,origin=ORIGIN){const server=await serverId(origin);return Promise.all(raw.map(async l=>({id:server==='ccf'?l.id:server+':'+l.id,server,key:await hashId(origin+'|'+l.username.toLowerCase()),credentialKey:await hashId(env.TICKET_SECRET+'|'+origin+'|'+l.username+'|'+l.password),username:l.username,expiresAt:l.expiresAt||null,maxConnections:l.maxConnections,external:l.external,encrypted:await ticket(env,{kind:'provider',origin,username:l.username,password:l.password,exp:Date.now()+86400000})})))}
async function safeInventory(env,raw,origin){
 const server=await serverId(origin);
 return Promise.all(raw.map(async l=>({id:server==='ccf'?l.id:server+':'+l.id,server,key:await hashId(origin+'|'+l.username.toLowerCase()),username:l.username,status:l.status||'active',expiresAt:l.expiresAt||null,maxConnections:l.maxConnections,reported:l.reported??l.external??0})));
}
const poolRefreshes=new WeakMap();
async function isolatedPoolRefresh(env,force=false){const response=await env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_provider_refresh_v1')).fetch('https://private/refresh-pool',{method:'POST',body:JSON.stringify({force})});const status=await response.json();if(!response.ok)throw Error(status.error||'provider_unavailable');return status.single?null:(await (await directory(env,'/pool')).json()).lines}
async function providerPool(env,ctx){
 const key=env.PLAYBACK_SESSIONS;
 if(ctx?.waitUntil){const snapshot=await (await directory(env,'/pool')).json();if(snapshot.lines?.length&&snapshot.syncedAt>Date.now()-12*3600000){
  if(snapshot.syncedAt<Date.now()-30000&&!poolRefreshes.has(key)){const work=isolatedPoolRefresh(env);poolRefreshes.set(key,work);ctx.waitUntil(work.catch(()=>{}).finally(()=>poolRefreshes.delete(key)))}
  return snapshot.lines;
 }}
 if(poolRefreshes.has(key))return poolRefreshes.get(key);const work=isolatedPoolRefresh(env);poolRefreshes.set(key,work);try{return await work}finally{poolRefreshes.delete(key)}
}
async function refreshProviderPool(env,force=false){
 const providers=await (await directory(env,'/providers')).json();if(!providers.length)throw Error('provider_not_configured');
 const saved=await (await directory(env,'/provider')).json();if(providers.length===1&&saved.mode!=='panel')return null;
 let pool=await (await directory(env,'/pool')).json();if(!force&&pool.syncedAt>Date.now()-30000)return pool.lines;let transient=false;
 await Promise.all(providers.map(async p=>{let raw=[],inventory=[];const origin=p.origin||ORIGIN;try{const d=await unticket(env,p.encrypted||'');if(!d)throw Error('provider_not_configured');
 if(d.kind==='reseller'){const read=await readPanel(d.username,d.password,p.url||'http://ccf.center:8444/NYzkggyG/',{inventory:true});raw=read.lines;inventory=read.inventory}else{const a=await validateAccount(d.username,d.password,origin,6000,undefined,env.CCF_ENTRY_TRANSPORT==='tcp');if(!a)throw Error('provider_inactive');raw=[{id:'single:'+d.username.toLowerCase(),username:d.username,password:d.password,maxConnections:Math.min(3,Number(a.user_info.max_connections)||3),external:Number(a.user_info.active_cons)||0}];inventory=raw.map(l=>({...l,status:'active',expiresAt:Number(a.user_info.exp_date)>0?Number(a.user_info.exp_date)*1000:null}))}
 }catch(error){if(!['panel_invalid','panel_no_active_lines','provider_inactive','provider_not_configured'].includes(error.message)){transient=true;const retained=await directory(env,'/pool-sync',{source:p.source,retain:true});if(!retained.ok)throw Error('panel_unavailable');return}}
 const response=await directory(env,'/pool-sync',{source:p.source,lines:await encryptedLines(env,raw,origin),inventory:await safeInventory(env,inventory,origin)});if(!response.ok)throw Error('panel_unavailable');}));
 pool=await (await directory(env,'/pool')).json();if(!pool.lines.length)throw Error(transient?'provider_unavailable':'provider_inactive');return pool.lines;
}
async function catalogCredentials(env,server,ctx,limit=1){const pool=await providerPool(env,ctx);if(!pool)return [{...await providerCredentials(env),server:'ccf'}];const counts=new Map(),credentials=[];for(const l of pool){const id=l.server||'ccf';if((server&&server!==id)||(counts.get(id)||0)>=limit)continue;const d=await unticket(env,l.encrypted);if(d){credentials.push({...d,server:id});counts.set(id,(counts.get(id)||0)+1)}}return credentials}
async function providerCredentials(env){const pool=await providerPool(env);if(pool){const d=await unticket(env,pool[0].encrypted);if(!d)throw Error("panel_unavailable");return {...d,maxConnections:pool[0].maxConnections}}
 const p=await (await directory(env,"/provider")).json(),d=await unticket(env,p.encrypted||"");if(d?.kind!=="provider")throw Error("provider_not_configured");return {...d,maxConnections:p.maxConnections}}
async function managedPlayback(env,session,server,ctx,excluded=[],startup=null){const trace=startup?.trace,pool=await timed(trace,'allocation',()=>providerPool(env,ctx));if(!pool){const credentials=await providerCredentials(env);if(startup&&!startup.claim())return {r:json({error:'live_startup_timeout'},504)};const a=await timed(trace,'validation',()=>validateAccount(credentials.username,credentials.password,credentials.origin||ORIGIN,startup?startup.validationTimeout():PROVIDER_VALIDATION_MS,undefined,env.CCF_ENTRY_TRANSPORT==='tcp'));if(!a)throw Error("provider_inactive");const r=await directory(env,"/acquire",{...session,upstreamMax:a.user_info.max_connections,upstreamExternal:session.xtream?a.user_info.active_cons:0});return {r,credentials}}
 let unavailable=false,busy=false,validationFailure;const exclude=[...excluded];for(let i=0;i<Math.min(pool.filter(l=>!server||(l.server||"ccf")===server).length,session.xtream?3:8);i++){if(startup&&(!startup.validationRemaining()||!startup.claim()))break;const r=await timed(trace,'allocation',()=>directory(env,"/acquire",{...session,exclude,server}));if(!r.ok)return {r};const allocation=await r.json(),credentials=await unticket(env,allocation.encrypted);if((allocation.reused||(startup&&allocation.validatedRecently))&&credentials&&!exclude.includes(allocation.provider_id))return {r:json({lease_id:allocation.lease_id}),credentials,provider_id:allocation.provider_id};let a;const checkedAt=Date.now();try{if(credentials)a=await timed(trace,'validation',()=>sharedProviderValidation(env.PLAYBACK_SESSIONS,allocation.provider_id+'|'+allocation.encrypted,(signal,timeout)=>validateAccount(credentials.username,credentials.password,credentials.origin||ORIGIN,timeout,signal,env.CCF_ENTRY_TRANSPORT==='tcp'),{timeoutMs:startup?startup.validationTimeout():PROVIDER_VALIDATION_MS,signal:startup?.signal,ctx}))}catch(error){if(startup?.signal?.aborted||error.message==='playback_superseded'){await directory(env,'/release',{sid:session.sid,lease_id:allocation.lease_id,request_id:session.request_id});throw Error('playback_superseded')}unavailable=true;validationFailure=error.failureCode||comparisonError(error)}finally{startup?.recordValidation(Date.now()-checkedAt)}
 if(a&&Number(a.user_info.max_connections)>=allocation.maxConnections&&Number(a.user_info.active_cons||0)<allocation.maxConnections){if(startup)await reportLiveResult(directory,env,session,allocation,true,Date.now()-checkedAt,'validation');return {r:json({lease_id:allocation.lease_id}),credentials,provider_id:allocation.provider_id};}
 if(a)busy=true;if(startup)await reportLiveResult(directory,env,session,allocation,!!a,Date.now()-checkedAt,'validation',{confirmedInactive:a===null,capacityBusy:!!a});await directory(env,"/release",{sid:session.sid,lease_id:allocation.lease_id,request_id:session.request_id,reason:'upstream_failed'});exclude.push(allocation.provider_id);}
 if(startup&&startup.remaining()<=0)return {r:json({error:'live_startup_timeout'},504)};
 return {r:json({error:unavailable?'provider_unavailable':busy?'ccf_capacity':'provider_inactive',...(session.canary&&unavailable?{validationFailure}:{})},unavailable||!busy?503:409)};
}
function accountInfo(s){return {user_info:{auth:1,status:"Active",username:s.username,exp_date:String(Math.floor(s.exp/1000))},access_token:null,server_time:Date.now(),session_expires_at:s.exp,account_expires_at:s.accountExpiresAt||null,permissions:s.permissions||{movies:true,series:true,tv:true}}}
async function readLimitedJSON(req){
 const max=4000000;if(Number(req.headers.get('Content-Length'))>max)throw Error('body_too_large');
 const reader=req.body?.getReader();if(!reader)throw Error('invalid_json');let bytes=0,text='',decoder=new TextDecoder();
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>max){await reader.cancel();throw Error('body_too_large')}text+=decoder.decode(value,{stream:true})}text+=decoder.decode();const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error('invalid_json');return value}catch(e){if(e.message==='body_too_large')throw e;throw Error('invalid_json')}finally{reader.releaseLock()}
}
async function adminRequest(req,env,ctx){
 const b=await readLimitedJSON(req),action=String(b.action||""),client=req.headers.get("CF-Connecting-IP")||"unknown";
 if(action==="status")return json(await (await directory(env,"/status")).json());
 if(action==="setup"){const r=await directory(env,"/setup",b);return json(await r.json(),r.status)}
 if(action==="login"){const r=await directory(env,"/admin-login",{username:b.username,password:b.password,code:b.code,client});if(!r.ok)return json(await r.json(),r.status);const user=await r.json(),session=await ownSession(env,user,true);const token=await ticket(env,session);return withSessionCookie(json({access_token:b.browser_cookie&&canUseCookie(req,env)?null:token,username:user.username}),req,env,"admin",token,7200)}
 const s=await unticket(env,String(b.access_token||cookieToken(req,env,"admin")));if(s?.kind!=="admin"||!(await sessionCall(env,s.sid,"/check")).ok)return json({error:"admin_required"},401);
 if(action.startsWith('boxpanel-'))return boxpanelCall(env,b,{role:'owner',candidates:TRUSTED_RESELLERS.map(r=>r.accountId)});
 if(action==='reseller-admin-launch'){if(req.headers.get('Origin')!=='https://app.snaptvnow.com')return json({error:'origin_not_allowed'},403);const r=await ownerAdminAccess.issue(env,s);if(r.ok)await directory(env,'/audit-write',{actor:s.username,action:'reseller_admin_launch',target:'owner'});return r;}
 if(action.startsWith('exclusive-')){try{return await exclusives.admin(req,env,b,s.username)||json({error:'operation_not_allowed'},403)}catch(e){return json({error:e.message},e.status||502)}}
 if(action==="logout"){await sessionCall(env,s.sid,"/logout");return withSessionCookie(json({ok:true}),req,env,"admin","",0)}
 if(action==='xtream-settings'||action==='xtream-save'){const r=await directory(env,action==='xtream-save'?'/xtream-save':'/xtream-config',b);if(r.ok&&action==='xtream-save')await directory(env,'/audit-write',{actor:s.username,action:'xtream_changed'});return json({...await r.json(),url:new URL(req.url).origin,host:new URL(req.url).hostname,port:new URL(req.url).port||'443'},r.status)}
 if(action==='xtream-check'){const target=new URL('/player_api.php',req.url);const response=await xtreamRequest(new Request(target,{headers:{'User-Agent':'SnapMovieNow/1.0'}}),env);const body=await response.json();const config=await (await directory(env,'/xtream-config')).json();return json({compatible:response.status===401&&body.error==='credentials_required',enabled:config.enabled,url:new URL(req.url).origin,version:SERVICE_VERSION})}
 if(action==='xtream-series-check'){
  const config=await (await directory(env,'/xtream-config')).json();if(!config.enabled)return json({error:'xtream_disabled'},403);
  return diagnoseSeries({json,users:await (await directory(env,'/users')).json(),catalog:createProviderCatalog(catalogDeps,env,ctx),
   register:async entries=>{const r=await registry(env,'/xtream-register',{entries});if(!r.ok)throw Error('catalog_registration_failed');return r.json()},
   resolve:async id=>(await registry(env,'/xtream-resolve',{id})).json()
  },b,new URL(req.url).origin);
 }
 const security={"admin-password":"/admin-password","mfa-replace-begin":"/mfa-replace-begin","security-status":"/security-status","mfa-begin":"/mfa-begin","mfa-confirm":"/mfa-confirm","mfa-disable":"/mfa-disable","mfa-recovery-renew":"/mfa-recovery-renew","audit":"/audit","backup-list":"/backup-list","backup-status":"/backup-status","backup-verify":"/backup-verify","backup-create":"/backup-create","backup-drill":"/backup-drill","backup-download":"/backup-download","backup-export":"/backup-export","backup-preview":"/backup-preview","backup-restore":"/backup-restore"};
 if(security[action]){const r=await directory(env,security[action],{...b,actor:s.username});return json(await r.json(),r.status)}
 if(action==='playback-diagnostics'){const [providers,timings]=await Promise.all([directory(env,'/provider-health').then(r=>r.json()),env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_operations_v1')).fetch('https://private/operations/timing-read',{method:'POST',body:'{}'}).then(r=>r.json())]);return json({providers,timings})}
 if(['playback-canary-status','playback-canary-settings','playback-canary-run'].includes(action)){const path=action==='playback-canary-settings'?'/canary/settings':action==='playback-canary-run'?'/canary/run':'/status';const result=await monitorCall(env,path,action==='playback-canary-settings'?{enabled:b.enabled,...(b.types?{types:b.types}:{})}:{});if(result.ok&&action!=='playback-canary-status')await directory(env,'/audit-write',{actor:s.username,action});return json(await result.json(),result.status)}
 if(action==='playback-health'){const r=await env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_operations_v1')).fetch('https://private/operations/read',{method:'POST',body:'{}'});return json(await r.json(),r.status)}
 if(['alerts-status','alerts-settings','alerts-check','alerts-test'].includes(action)){
  const paths={'alerts-status':'/status','alerts-settings':'/settings','alerts-check':'/tick','alerts-test':'/test'};
  const result=await monitorCall(env,paths[action],action==='alerts-settings'?{enabled:b.enabled,channel:b.channel,to:b.to,from:b.from,apiKey:b.apiKey}:{});
  if(result.ok&&action==='alerts-settings')await directory(env,'/audit-write',{actor:s.username,action:'alerts_changed'});
  if(action==='alerts-check'&&result.ok){await result.body?.cancel();const status=await monitorCall(env,'/status');return json(await status.json(),status.status)}
  return json(await result.json(),result.status);
 }
 const record=async(action,target=null)=>directory(env,'/audit-write',{actor:s.username,action,target});
 const paths={users:"/users",save:"/save",delete:"/delete",overview:"/overview"};
 if(action==='provider-dashboard'){
  let refreshError=null;const configured=(await (await directory(env,'/providers')).json()).length>0;
  if(configured&&b.refresh===true){try{await isolatedPoolRefresh(env,true)}catch(error){refreshError=error.message==='provider_inactive'?'El proveedor no tiene cuentas activas disponibles.':'No se pudo revalidar el proveedor. Se muestra el último inventario guardado.'}}
  else if(configured&&ctx?.waitUntil)ctx.waitUntil(isolatedPoolRefresh(env).catch(()=>{}));
  const r=await directory(env,'/provider-dashboard');return json({...await r.json(),refreshError},r.status);
 }
 if(action==='connections'){const list=await (await directory(env,'/providers')).json();return json(list.map(p=>({source:p.source,name:p.name||p.username,username:p.username,mode:p.mode,url:p.url||(p.mode==='panel'?'http://ccf.center:8444/NYzkggyG/':ORIGIN),origin:p.origin||ORIGIN})))}
 if(action==='provider-remove'){const r=await directory(env,'/provider-remove',{source:b.source});if(r.ok)await record('provider_removed',b.source);return json(await r.json(),r.status)}
 if(action==='provider-save'){
  try{const list=await (await directory(env,'/providers')).json(),old=b.source?list.find(p=>p.source===b.source):null;if(b.source&&!old)return json({error:'not_found'},404);
  const username=String(b.username||old?.username||'').trim(),mode=b.mode||old?.mode||'single',url=validateServerUrl(b.url||old?.url||(mode==='panel'?'http://ccf.center:8444/NYzkggyG/':ORIGIN),mode==='panel'),origin=validateServerUrl(b.origin|| (mode==='panel'?new URL(url).origin:url));
  let password=String(b.password||'');if(!password&&old){const d=await unticket(env,old.encrypted);password=d?.password||''}if(!username||!password)return json({error:'credentials_required'},400);
  let raw,inventory,kind;if(mode==='panel'){const read=await readPanel(username,password,url,{inventory:true});raw=read.lines;inventory=read.inventory;kind='reseller'}else{const a=await validateAccount(username,password,origin,6000,undefined,env.CCF_ENTRY_TRANSPORT==='tcp');if(!a)return json({error:'provider_invalid'},400);raw=[{id:'single:'+username.toLowerCase(),username,password,maxConnections:Math.min(3,Number(a.user_info.max_connections)||3),external:Number(a.user_info.active_cons)||0}];inventory=raw.map(l=>({...l,status:'active',expiresAt:Number(a.user_info.exp_date)>0?Number(a.user_info.exp_date)*1000:null}));kind='provider'}
  const defaultUrl=mode==='panel'?'http://ccf.center:8444/NYzkggyG/':ORIGIN;const source=old?.source||(url===defaultUrl?mode+':'+username.toLowerCase():mode+':'+await hashId(url+'|'+username.toLowerCase()));
  const encrypted=await ticket(env,{kind,origin,username,password,exp:Date.now()+10*365*86400000});const response=await directory(env,'/provider-add',{source,encrypted,username,mode,url,origin,name:String(b.name||old?.name||username).slice(0,80),lines:await encryptedLines(env,raw,origin),inventory:await safeInventory(env,inventory,origin)});if(response.ok)await record('provider_saved',source);return json(await response.json(),response.status);
  }catch(e){return json({error:e.message==='invalid_server_url'?e.message:e.message.startsWith('panel_')?e.message:'provider_unavailable'},502)}
 }
 if(!paths[action])return json({error:"operation_not_allowed"},403);const r=await directory(env,paths[action],b);if(r.ok&&['save','delete'].includes(action))await record(action==='save'?'user_saved':'user_deleted',b.username);return json(await r.json(),r.status);
}
function publicTitle(x){const {page,episodes,preferredEmbed,...item}=x;return item}
function proxiedMedia(origin,t,url){return origin+"/gnula-media?t="+encodeURIComponent(t)+"&path="+encodeURIComponent(url)}
async function gnulaMedia(req,env,u,ctx){const t=u.searchParams.get("t")||"",d=await unticket(env,t);if(d?.kind!=="gnula"||!(await sessionCall(env,d.sid,"/check")).ok)return json({error:"session_expired"},401);
 if(d.exclusiveId){const row=await directory(env,'/exclusive-item-read',{id:d.parentId});if(!row.ok)return json({error:'title_not_allowed'},410);const current=selectExclusive([await row.json()],d.exclusiveId);if(!current||!current.row.visible||current.row.playbackRevision!==d.playbackRevision)return json({error:'title_not_allowed'},410);}
 const base=new URL(d.source),target=new URL(u.searchParams.get("path")||d.source);const resourceDirectory=base.pathname.slice(0,base.pathname.lastIndexOf("/")+1);
 if(!allowedGnula(target)||target.hostname!==base.hostname||!target.pathname.startsWith(resourceDirectory))return json({error:"media_not_allowed"},403);
 const headers=new Headers({"User-Agent":"Mozilla/5.0"});if(req.headers.has("range"))headers.set("range",req.headers.get("range"));const r=await fetch(target.href,{headers,redirect:"manual"});if(r.status>=300&&r.status<400)return json({error:"media_redirect_not_allowed"},502);
 if(!r.ok)return json({error:"media_unavailable"},r.status===404?404:502);
 const out=new Headers(cors);for(const n of ["content-type","content-length","content-range","accept-ranges"])if(r.headers.has(n))out.set(n,r.headers.get(n));
 if(target.pathname.endsWith(".m3u8")){const text=await r.text();if(!text.startsWith("#EXTM3U"))return json({error:"invalid_playlist"},502);const rewrite=x=>{const url=new URL(x,target);if(!allowedGnula(url)||url.hostname!==base.hostname||!url.pathname.startsWith(resourceDirectory))throw Error("playlist_url_not_allowed");return proxiedMedia(u.origin,t,url.href)};
 const playlist=text.split(/\r?\n/).map(line=>!line.trim()?line:line.startsWith("#")?line.replace(/URI="([^"]+)"/g,(_,url)=>'URI="'+rewrite(url)+'"'):rewrite(line.trim())).join("\n");out.delete("content-length");out.set("content-type","application/vnd.apple.mpegurl");return new Response(req.method==="HEAD"?null:playlist,{headers:out})}
 return guardPlaybackExpiry(new Response(req.method==="HEAD"?null:r.body,{status:r.status,headers:out}),d.exp,req.signal,()=>directory(env,"/release-session",{sid:d.sid}),ctx)
}

async function observedWebStream(object,req,ctx,trace){
 const env=object.env,u=new URL(req.url),d=await unticket(env,u.searchParams.get('t')||'');
 const observe=d?.provider_id&&d.lease_id&&!d.xtream&&!d.resource&&!d.comparison&&(d.type!=='live'||d.ext!=='m3u8')&&req.method==='GET';
 const key=d?.lease_id+':'+d?.request_id,now=Date.now();object.signalReports??=new Map();
 for(const [id,at]of object.signalReports)if(at<now-300000)object.signalReports.delete(id);
 const fresh=observe&&!object.signalReports.has(key);if(fresh){if(object.signalReports.size>=128)object.signalReports.delete(object.signalReports.keys().next().value);object.signalReports.set(key,now)}
 const report=async(ok)=>{if(!fresh)return;await reportLiveResult(directory,env,{sid:d.sid,request_id:d.request_id},{lease_id:d.lease_id,provider_id:d.provider_id},ok,Date.now()-now);if(!ok)await directory(env,'/release',{sid:d.sid,lease_id:d.lease_id,request_id:d.request_id,reason:'upstream_failed'});};
 try{const response=await serverStreamDirect(req,env,u,ctx,trace);if([410,416].includes(response.status)||req.signal.aborted){if(fresh)object.signalReports.delete(key)}else if(response.ok)deferPlaybackReport(ctx,()=>report(true));else await report(false);return response}
 catch(error){if(!req.signal.aborted&&!['playback_superseded','media_origin_unapproved'].includes(error.message))await report(false);throw error}
}
async function serverStream(req,env,u,ctx,trace){
 const d=await unticket(env,u.searchParams.get('t')||'');if(!d?.sid||!['movie','series','live'].includes(d.type))return new Response('Expired',{status:410,headers:cors});
 // Keep video parsing, byte-range recovery and stream callbacks out of the
 // front-door request's small CPU budget. One relay per session avoids a shared
 // bottleneck; control-plane revocation and provider capacity remain separate.
 if(!d.resource)trace?.identify(d.type);const response=await env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_media_v1:'+d.sid)).fetch(new Request(u.href,req));if(trace)trace.merge(response);return response;
}
async function ownPlaybackControl(env,session,target,{signal,deadline}){
 const url=new URL(target.url),d=await unticket(env,url.searchParams.get('t')||'');
 if(url.origin!=='https://api.snaptvnow.com'||url.pathname!=='/stream'||!session.canary||!session.comparison||session.username!==env.PLAYBACK_CANARY_USERNAME||!d?.canary||!d.comparison||d.sid!==session.sid||d.lease_id!==target.lease_id||d.request_id!==target.request_id||!['live','series'].includes(d.type)||!['ts','mp4','mkv','webm','avi','mov','m4v'].includes(d.ext)||d.resource||!/^\d{1,16}$/.test(String(d.id)))throw Error('media_origin_unapproved');
 if(!(await sessionCall(env,session.sid,'/check')).ok||!(await directory(env,'/lease-check',{sid:d.sid,lease_id:d.lease_id,request_id:d.request_id})).ok)throw Object.assign(Error('playback_superseded'),{status:410});
 if(signal.aborted)throw Error('comparison_timeout');
 const source=d.origin||ORIGIN,start=source+'/'+(d.type==='series'?'series':'live')+'/'+encodeURIComponent(d.username)+'/'+encodeURIComponent(d.password)+'/'+d.id+'.'+d.ext;
 const headers=new Headers({'User-Agent':'SnapMovieNow/1.0','Accept-Encoding':'identity'});if(d.type==='series')headers.set('Range','bytes=0-65535');
 const response=await fetchControlMedia(start,headers,source,{deadline,directCcfEntry:env.PLAYBACK_CONTROL_CCF_SOCKET==='true'});
 if(signal.aborted){void response.body?.cancel().catch(()=>{});throw Error('comparison_timeout')}
 return response;
}
async function serverStreamDirect(req,env,u,ctx,trace){
 const d=await unticket(env,u.searchParams.get('t')||'');if(!d||!['movie','series','live'].includes(d.type)||!/^\d+$/.test(String(d.id)))return new Response('Expired',{status:410,headers:cors});
 const [access,lease]=await timed(trace,'auth',()=>Promise.all([sessionCall(env,d.sid,'/check'),d.lease_id?directory(env,d.xtream?'/heartbeat':'/lease-check',{lease_id:d.lease_id,sid:d.sid,request_id:d.request_id}):Promise.resolve({ok:true})]));
 if(!access.ok)return new Response('Expired',{status:410,headers:cors});if(!lease.ok)return json({error:'playback_expired'},410);
 const warm=liveStarts.get(u.href);if(warm){liveStarts.delete(u.href);if(warm.until>Date.now()&&req.method==='GET')return new Response(warm.body,{headers:{...cors,'content-type':'application/vnd.apple.mpegurl'}})}
 const folder=d.type==='series'?'series':d.type==='live'?'live':'movie',start=d.resource||(d.origin||ORIGIN)+'/'+folder+'/'+encodeURIComponent(d.username)+'/'+encodeURIComponent(d.password)+'/'+d.id+'.'+cleanExt(d.ext);
 const sourceOrigin=d.origin||ORIGIN;
 const headers=new Headers({'User-Agent':'SnapMovieNow/1.0','Accept-Encoding':'identity'});for(const n of ['range','if-range'])if(req.headers.has(n))headers.set(n,req.headers.get(n));if(req.method==='HEAD')headers.set('range','bytes=0-0');const maximum=d.type==='live'?8000:VOD_STARTUP_MS,deadline=!d.resource?(startupDeadline(req,Date.now(),maximum)??Date.now()+maximum):null;const fetched=await timed(trace,'origin',()=>fetchValidatedMedia(start,headers,d.type,sourceOrigin,{deadline,directCcfEntry:env.CCF_ENTRY_TRANSPORT==='tcp'}));let response=fetched.response;const next=fetched.url;
 if(d.lease_id&&!(await directory(env,"/lease-check",{sid:d.sid,lease_id:d.lease_id,request_id:d.request_id})).ok){await response.body?.cancel().catch(()=>{});return json({error:"playback_expired"},410)}
 const playlist=response.ok&&(/mpegurl/i.test(response.headers.get('content-type')||'')||new URL(next).pathname.endsWith('.m3u8'));
 if(response.ok&&!playlist&&deadline!==null)response=await timed(trace,'first_byte',()=>readInitialMedia(response,deadline));
 if(response.ok&&d.type==='live'&&d.ext==='m3u8'&&!d.resource&&!playlist){await response.body?.cancel();throw Error('invalid_playlist')}
 // Signed HLS endpoints often have no filename extension. Recover every finite
 // binary playlist resource by its declared byte range, including redirects.
 if(!playlist&&(d.resource||d.type!=='live'))response=recoverMedia(response,async(range,validator)=>{const h=new Headers(headers);h.set('range',range);if(validator)h.set('if-range',validator);return (await fetchValidatedMedia(start,h,d.type,sourceOrigin,{directCcfEntry:env.CCF_ENTRY_TRANSPORT==='tcp'})).response},async()=>(await sessionCall(env,d.sid,'/check')).ok&&(!d.lease_id||(await directory(env,d.xtream?'/heartbeat':'/lease-check',{sid:d.sid,lease_id:d.lease_id,request_id:d.request_id})).ok));
 const out=new Headers(cors);for(const n of ['content-type','content-length','content-range','accept-ranges','etag','last-modified'])if(response.headers.has(n))out.set(n,response.headers.get(n));
 if(req.method==='HEAD'){const total=response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1];if(total)out.set('content-length',total);out.delete('content-range');await response.body?.cancel();return new Response(null,{status:response.status===206?200:response.status,headers:out})}
 if(playlist){const text=await timed(trace,'first_byte',()=>readLivePlaylist(response,deadline));if(!text.startsWith('#EXTM3U'))throw Error('invalid_playlist');const proxy=async value=>{const target=validatedMediaTarget(new URL(value,next),sourceOrigin);return u.origin+'/stream?t='+await ticket(env,{...d,resource:target.href})};
 const lines=await Promise.all(text.split(/\r?\n/).map(async line=>{if(!line.trim())return line;if(!line.startsWith('#'))return proxy(line.trim());const matches=[...line.matchAll(/URI="([^"]+)"/g)];for(const m of matches)line=line.replace(m[0],'URI="'+await proxy(m[1])+'"');return line}));const body=lines.join('\n');if(req.headers.get('X-SMN-Prepare')==='1'&&!d.resource)rememberLiveStart(u.href,body);out.delete('content-length');out.set('content-type','application/vnd.apple.mpegurl');return new Response(body,{headers:out})}
 const result=new Response(response.body,{status:response.status,headers:out});
 if(d.xtream&&!d.resource&&d.ext!=='m3u8')return guardXtreamResponse(result,async()=>(await sessionCall(env,d.sid,'/check')).ok&&(await directory(env,'/heartbeat',{sid:d.sid,lease_id:d.lease_id,request_id:d.request_id})).ok,()=>directory(env,'/release',{sid:d.sid,lease_id:d.lease_id,request_id:d.request_id}),ctx,req.signal,d.exp);
 return guardPlaybackExpiry(result,d.exp,req.signal,()=>directory(env,"/release-session",{sid:d.sid}),ctx);
}

const exclusives=createExclusiveService({directory,sessionCall,ticket,unticket,resolveGnula,requestConnectionClient,guardXtreamResponse});
const catalogDeps={exclusives,directory,registry,sessionCall,ticket,managedPlayback,serverStream,json,catalogCredentials:async(env,server,ctx)=>(await catalogCredentials(env,server,ctx,3)).map(p=>({...p,origin:p.origin||ORIGIN}))};
const xtreamRequest=createXtreamBridge(catalogDeps);
async function sealPortalConfig(env,value){const iv=crypto.getRandomValues(new Uint8Array(12)),data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('reseller-portal:'+PORTAL_ACCOUNT)},await aesKey(env.TICKET_SECRET),new TextEncoder().encode(JSON.stringify(value))),raw=new Uint8Array(12+data.byteLength);raw.set(iv);raw.set(new Uint8Array(data),12);return b64(raw)}
async function openPortalConfig(env,value){try{const raw=unb64(value);return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:raw.slice(0,12),additionalData:new TextEncoder().encode('reseller-portal:'+PORTAL_ACCOUNT)},await aesKey(env.TICKET_SECRET),raw.slice(12))))}catch{return null}}
async function portalRecipient(env){let stored=await (await directory(env,'/reseller-portal-recipient',{accountId:PORTAL_ACCOUNT})).json();if(!stored){const pair=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},true,['deriveBits']),jwk=await crypto.subtle.exportKey('jwk',pair.privateKey),encrypted=await sealPortalConfig(env,{recipientKey:jwk});stored=await (await directory(env,'/reseller-portal-recipient-ensure',{accountId:PORTAL_ACCOUNT,encrypted})).json();}const value=await openPortalConfig(env,stored.encrypted),jwk=value.recipientKey,privateKey=await crypto.subtle.importKey('jwk',jwk,{name:'ECDH',namedCurve:'P-256'},false,['deriveBits']);return {privateKey,publicKey:{kty:'EC',crv:'P-256',x:jwk.x,y:jwk.y,ext:true}}}
const ownerAdminAccess=createOwnerAdminAccess({ticket,unticket,sessionCall});
const ccfExporter=createCcfExporter({directory,unticket,readPanelRecord});
const allOriginConnections=createAllOriginConnections({sources:async env=>(await directory(env,'/providers')).json(),snapshot:async(env,source,key,monitor)=>env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_ccf_origin_all_v1:'+key)).fetch('https://private/ccf-origin-snapshot',{method:'POST',body:JSON.stringify({source,key,...(monitor?{monitor}:{})})})});
const resellerBridgeRequest=createResellerBridge(directory,undefined,{allOriginConnections,ccfExport:(env,body)=>ccfExporter(env,body),ownerAccess:(env,action,body)=>ownerAdminAccess.bridge(env,action,body),sealConfig:(env,body)=>sealPortalConfig(env,body),portalRecipient,mediaProbe:(env,body,ctx)=>probeResellerMedia(env,body,{unticket,sessionCall,directory,origin:ORIGIN,fetchMedia:fetchValidatedMedia,allocate:(env,session,server)=>managedPlayback(env,session,server,ctx),channel:async(env,session,id,server)=>{const permissions=contentPermissions(await (await directory(env,'/permissions',{username:session.username})).json());if(!permissions.tv)throw Error('content_disabled');const catalog=createProviderCatalog(catalogDeps,env,ctx),rows=await catalog('get_live_streams',server),allowed=permissions.adults?rows:await createAdultPolicy(catalog).filter('get_live_streams',rows);return allowed.find(row=>String(row.stream_id)===id&&String(row._server||'ccf')===server);}})});
const portalConfig=async env=>{const stored=await (await directory(env,'/reseller-portal-config',{accountId:PORTAL_ACCOUNT})).json();return stored?.encrypted?openPortalConfig(env,stored.encrypted):null;};
const resellerPortalRequest=createResellerPortal({getConfig:portalConfig,catalog:env=>boxpanelCall(env,{action:'boxpanel-catalog'},{role:'public'}),boxpanel:(env,body,accountId)=>boxpanelCall(env,body,{role:'reseller',accountId})});
const ownerPortalRequest=createOwnerPortal({getConfig:portalConfig});
const telegramTick=createTelegramTick({getConfig:portalConfig});
const boxClientRequest=createBoxClient({call:boxpanelCall});
async function handleRequest(req,env,ctx,trace){
const boxClientResult=await boxClientRequest(req,env);if(boxClientResult)return boxClientResult;
if(matchesOwnerPortal(req))return ownerPortalRequest(req,env);if(matchesResellerPortal(req))return resellerPortalRequest(req,env);const u=new URL(req.url);
if(req.method==='POST'&&req.headers.get('Cookie')?.includes('__Host-smn_')&&!canUseCookie(req,env))return json({error:'origin_not_allowed'},403);
if(req.headers.get('Origin')&&!allowedOrigins(env).has(req.headers.get('Origin'))&&req.method==='POST')return json({error:'origin_not_allowed'},403);
if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
if(u.pathname==="/health")return json({ok:true,service:"snapmovienow-edge",version:SERVICE_VERSION,catalog_maintenance:await catalogMaintenanceStatus(env,directory),playback_canary:await publicCanaryHealth(env),playback_comparison:await publicComparisonHealth(env),capabilities:['reseller-service-monitor-v1','xtream','admin-recovery-renewal','backup-integrity','native-profile','metric-retry','admin-credentials-rotation','isolated-backup-recovery','xtream-series-diagnostic','operational-alerts','rotating-media-origins','admin-user-activity','admin-user-comments','reseller-bridge-v1','private-media-diagnostics-v1','live-startup-budget-v1','native-playback-release-v1','viewer-provider-affinity-v1','persistent-provider-assignment-v1','vod-startup-budget-v1','hedged-detail-catalog-v1','first-media-byte-check-v1','playback-stage-timings-v1','provider-circuit-recovery-v1','own-account-playback-canary-v1','performance-release-gate-v1','bounded-catalog-lookups-v1','shared-provider-validation-v1','customer-priority-playback-v1','indexed-playback-policy-v1','owner-playback-comparison-v1']});
if(u.pathname==='/reseller-bridge')return resellerBridgeRequest(req,env,ctx);
if(u.pathname==='/exclusive-media'&&['GET','HEAD'].includes(req.method)){try{return await exclusives.media(req,env,ctx)}catch(e){return json({error:e.message},e.status||502)}}
if(/^\/exclusive-cover\/[a-f0-9]{64}$/.test(u.pathname)&&['GET','HEAD'].includes(req.method)){const image=await exclusives.cover(env,u.pathname.split('/').at(-1));return req.method==='HEAD'?new Response(null,{status:image.status,headers:image.headers}):image;}
if(matchesXtream(u.pathname))return xtreamRequest(req,env,ctx,trace);
if(u.pathname==="/admin"&&req.method==="POST"){try{return await adminRequest(req,env,ctx)}catch(e){return json({error:["body_too_large","invalid_json"].includes(e.message)?e.message:"admin_unavailable"},e.message==="body_too_large"?413:e.message==="invalid_json"?400:502)}}
if(u.pathname==="/gnula-media"&&["GET","HEAD"].includes(req.method)){try{return await gnulaMedia(req,env,u,ctx)}catch{return json({error:"media_unavailable"},502)}}
if(u.pathname==='/stream'&&['GET','HEAD'].includes(req.method)){const headers=new Headers(req.headers);headers.delete('X-SMN-Prepare');headers.delete('X-SMN-Startup-Deadline');const mediaRequest=new Request(req,{headers});try{return await serverStream(mediaRequest,env,u,ctx,trace)}catch(e){return json({error:e.message==='media_origin_unapproved'?'media_origin_unapproved':'stream_unavailable'},502)}}
if(req.method!=="POST")return json({error:"method_not_allowed"},405);
try{const b=await readLimitedJSON(req),op=String(b.op||"");if(!["auth","logout","gnula_catalog","gnula_series_info","gnula_token","stream_token","session_info","playback_heartbeat","playback_release","playback_cancel","profile_get","profile_patch","playback_metric"].includes(op)&&!Object.hasOwn(actions,op))return json({error:"operation_not_allowed"},403);
if(op==="auth"){
 if(!b.username||!b.password)return json({error:'credentials_required'},400);
 const has=await (await directory(env,"/has",{username:b.username})).json();let session,a;
 if(has.exists){const r=await directory(env,"/login",{username:b.username,password:b.password,client:req.headers.get("CF-Connecting-IP")||"unknown",connection:requestConnectionClient(req)});if(!r.ok)return json(await r.json(),r.status);const user=await r.json();session=await ownSession(env,user);a=accountInfo(session)}
 else{if(env.ENVIRONMENT==='staging')return json({error:'invalid_credentials'},401);a=await validateAccount(String(b.username),String(b.password),ORIGIN,6000,undefined,env.CCF_ENTRY_TRANSPORT==='tcp');if(!a)return json({error:"invalid_credentials"},401);session=await createSession(env,String(b.username),String(b.password),Number(a.user_info.exp_date)>0?Number(a.user_info.exp_date)*1000:null);a={...a,server_time:Date.now(),session_expires_at:session.exp,account_expires_at:session.accountExpiresAt}}
 const old=await unticket(env,String(b.access_token||""));if(old?.kind==="session"&&old.username===session.username){await directory(env,"/release-session",{sid:old.sid});await sessionCall(env,old.sid,"/logout")}
 const token=await ticket(env,session);return withSessionCookie(json({...a,access_token:b.browser_cookie&&canUseCookie(req,env)?null:token}),req,env,"session",token,Math.max(0,Math.floor((session.exp-Date.now())/1000)));
}
let session=await timed(trace,'auth',()=>unticket(env,String(b.access_token||cookieToken(req,env,"session"))));if(session?.kind!=="session"||!(await timed(trace,'auth',()=>sessionCall(env,session.sid,"/check"))).ok)return json({error:"session_required"},401);
const permissions=contentPermissions(session.managed?await (await directory(env,'/permissions',{username:session.username})).json():null);session.permissions=permissions;
const rawCatalog=createProviderCatalog(catalogDeps,env,ctx),catalog=(...args)=>timed(trace,'catalog',()=>rawCatalog(...args)),adultPolicy=createAdultPolicy(catalog,rawCatalog.inspect);
if(op==='session_info')return json(accountInfo(session));
if(op==='playback_metric'){
 if(!session.managed)return json({ok:true,ignored:true});
 const pool=await (await directory(env,'/pool')).json(),servers=new Set(['ccf','gnula','exclusive',...(pool.lines||[]).map(l=>l.server||'ccf')]);
 if(!servers.has(b.metric?.server))return json({error:'invalid_metric'},400);
 const r=await env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_operations_v1')).fetch('https://private/operations/ingest',{method:'POST',body:JSON.stringify({uid:session.uid,metric:b.metric})});const data=await r.json();if(r.ok)try{const context=await playbackQualityContext(session,b,value=>unticket(env,value));if(context){const quality=await directory(env,'/playback-quality',{...context,monitorAccepted:!data.duplicate&&!data.limited}),result=await quality.json();if(quality.ok&&!result.limited)data.qualityHandled=true;}}catch{}return json(data,r.status);
}
if(op==='profile_get'||op==='profile_patch'){
 if(!session.managed)return json({error:'managed_profile_required'},403);
 const r=await env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('profile:'+session.uid)).fetch('https://private/profile/'+(op==='profile_get'?'get':'patch'),{method:'POST',body:JSON.stringify({patches:b.patches})});
 const data=await r.json();if(Array.isArray(data.records))data.records=data.records.filter(p=>p.kind==='preference'||p.deleted||permissions[p.type==='live'?'tv':p.type==='movie'?'movies':'series']);
 return json(data,r.status);
}

const required=op.startsWith('live')||(op==='stream_token'&&b.type==='live')?'tv':op.startsWith('series')||op==='gnula_series_info'||(op==='stream_token'&&b.type==='series')?'series':['vod','vod_info','vod_categories'].includes(op)||(op==='stream_token'&&b.type!=='series')?'movies':null;
if(required&&!permissions[required])return json({error:'content_disabled'},403);

if(op==="playback_cancel"){if(!session.managed)return json({ok:true});const r=await directory(env,"/playback-cancel",{sid:session.sid,request_id:b.request_id,revision:b.revision});return json(await r.json(),r.status)}
if(op==="playback_heartbeat"){if(!session.managed||!b.lease_id)return json({ok:true});const r=await directory(env,"/heartbeat",{sid:session.sid,lease_id:b.lease_id,request_id:b.request_id});return json(await r.json(),r.status)}
if(op==="playback_release"){
 if(!session.managed)return json({ok:true});
 // A native receipt releases only its exact account/version/request. Never
 // accept a caller-supplied Xtream sid, including from a different account.
 if(b.quality_ticket!==undefined){
  const owned=await playbackQualityContext(session,{quality_ticket:b.quality_ticket,observation:{ageMs:0}},value=>unticket(env,value));
  if(!owned)return json({error:'invalid_playback_receipt'},403);
  const r=await directory(env,'/release',owned);return r.status===410?json({ok:true,expired:true}):json(await r.json(),r.status);
 }
 if(!b.lease_id)return json({ok:true});const r=await directory(env,"/release",{sid:session.sid,lease_id:b.lease_id,request_id:b.request_id});return json(await r.json(),r.status);
}
if(op==="logout"){if(session.managed)await directory(env,"/customer-logout",{uid:session.uid,username:session.username,connection:requestConnectionClient(req)}).catch(()=>{});await directory(env,"/release-session",{sid:session.sid});await sessionCall(env,session.sid,"/logout");return withSessionCookie(json({ok:true}),req,env,"session","",0)}
b.username=session.username;b.password=session.password;
if(op==='gnula_catalog')return json((await exclusives.catalog(env,permissions,u.origin,{legacy:!session.managed})).items);
if(op==='gnula_series_info')try{return json(await exclusives.episodes(env,b.series_id,permissions,u.origin))}catch(e){return json({error:e.message},e.status||502)}
if(op==='gnula_token'&&session.managed){try{return json(await exclusives.prepare(req,env,session,b.id,{request_id:b.request_id,revision:b.revision}))}catch(e){return json({error:e.message},e.status||502)}}
if(op==="gnula_token"){
 const selection=selectExclusive((await exclusives.read(env)).items,b.id);if(!selection||!visibleExclusive(selection.row,permissions)||selection.media.mode!=='gnula'||selection.row.type==='series'&&selection.row===selection.media)return json({error:'title_not_allowed'},404);
 const source=await resolveGnula(selection.media.page,selection.media.preferredEmbed),data={kind:'gnula',source,sid:session.sid,exclusiveId:b.id,parentId:selection.row.id,playbackRevision:selection.row.playbackRevision,exp:Math.min(session.exp,Date.now()+3*60*60*1000)};
 const t=await ticket(env,data);return json({url:proxiedMedia(u.origin,t,source)});
}
if(op==="stream_token"){
 trace?.identify(String(b.type||'movie'),req.headers.get('User-Agent')?.includes('SnapTvNow')?'android':'web');
 if(!["movie","series","live"].includes(String(b.type||"movie"))||!/^\d+$/.test(String(b.id||"")))return json({error:"invalid_stream"},400);
 if(!permissions.adults){
  let parentId=b.series_id;
  if(b.type==='series'&&!parentId)parentId=(await (await registry(env,'/xtream-episode',{server:b.server||'ccf',id:b.id})).json())?.parentId;
  if(!await adultPolicy.allowed({kind:b.type==='series'?'episode':b.type||'movie',server:b.server||'ccf',upstreamId:b.id,parentId}))return json({error:'adult_content_disabled'},403);
 }
 return await prepareWebPlayback(b,session,req.url,env,ctx,{trace,directory,managedPlayback,ticket,serverStream,json,cleanExt,origin:ORIGIN,client:requestConnectionClient(req),activity:async item=>{
  if(item.type==='series'&&!item.parentId){const record=await (await registry(env,'/xtream-episode',{server:item.server,id:item.id})).json();if(record?.activity)return record.activity;item.parentId=record?.parentId}
  return cachedPlaybackActivity(rawCatalog,item);
 }});
}
if(session.managed){
 if(op==='live_epg'&&!/^\d+$/.test(String(b.stream_id||'')))return json({error:'invalid_stream'},400);
 const kind=op==='live_epg'?'live':op==='series_info'?'series_list':op==='vod_info'?'movie':null;
 if(kind&&!permissions.adults&&!await adultPolicy.allowed({kind,server:b.server||'ccf',upstreamId:b.series_id||b.vod_id||b.stream_id}))return json({error:'adult_content_disabled'},403);
 const params=op==='series_info'?{series_id:b.series_id}:op==='vod_info'?{vod_id:b.vod_id}:op==='live_epg'?{stream_id:b.stream_id,limit:24}:{};
 if(op==='series_info')trace?.identify('series','web');else if(op==='vod_info')trace?.identify('movie','web');
 let data=await catalog(actions[op],b.server,params);
 if(!permissions.adults){
  if(Array.isArray(data))data=await adultPolicy.filter(actions[op],data);
  else {if(isAdult(data.info)||isAdult(data.movie_data))return json({error:'adult_content_disabled'},403);
   if(data.episodes)data={...data,episodes:Object.fromEntries(Object.entries(data.episodes).map(([season,rows])=>[season,rows.filter(ep=>!isAdult(ep)&&!isAdult(ep.info))]).filter(([,rows])=>rows.length))};
  }
 }
 if(op==='series_info'&&data.episodes){
  const entries=Object.entries(data.episodes).flatMap(([season,rows])=>(Array.isArray(rows)?rows:[]).filter(ep=>/^\d+$/.test(String(ep.id))).map(ep=>({kind:'episode',server:b.server||'ccf',upstreamId:String(ep.id),parentId:String(b.series_id),activity:episodeActivity(data.info,ep,season),ext:cleanExt(ep.container_extension)})));
  if(entries.length)await registry(env,'/xtream-register',{entries});
 }
 return json(data);
}
const x=new URL(ORIGIN+"/player_api.php");x.searchParams.set("username",String(b.username));x.searchParams.set("password",String(b.password));if(op!=="auth")x.searchParams.set("action",actions[op]);if(op==="series_info"&&b.series_id)x.searchParams.set("series_id",String(b.series_id));if(op==="vod_info"&&b.vod_id)x.searchParams.set("vod_id",String(b.vod_id));if(op==="live_epg"){x.searchParams.set("stream_id",String(b.stream_id));x.searchParams.set("limit","24")}const up=await fetch(x,{headers:{"User-Agent":"SnapMovieNow/1.0"},redirect:"follow"});return new Response(await up.text(),{status:up.status,headers:{...cors,"content-type":up.headers.get("content-type")||"application/json"}})}catch(e){return json({error:["body_too_large","invalid_json"].includes(e.message)?e.message:"upstream_unavailable"},e.message==="body_too_large"?413:e.message==="invalid_json"?400:502)}}
export default {scheduled(event,env,ctx){
 if(env.ENVIRONMENT==='staging')return;
 if(event.cron===MONITOR_CRON){ctx.waitUntil(directory(env,'/service-monitor-sample').then(r=>r.body?.cancel()).catch(()=>console.error({event:'service_monitor_sample_failed'})));ctx.waitUntil(isolatedPoolRefresh(env).catch(()=>console.error({event:'provider_inventory_refresh_failed'})));ctx.waitUntil(telegramTick(env).catch(()=>console.error({event:'telegram_tick_failed'})));ctx.waitUntil(monitorCall(env,'/tick').then(async response=>{if(!response.ok)console.error({event:'monitor_failed'});await response.body?.cancel()}).catch(()=>console.error({event:'monitor_failed'})));if(env.CATALOG_MAINTENANCE_ENABLED==='true')ctx.waitUntil(directory(env,'/catalog-maintenance-tick').then(async r=>{await r.body?.cancel()}).catch(()=>console.error({event:'catalog_maintenance_failed'})));return}
 if(event.cron&&event.cron!=='17 5 * * *')return;
 ctx.waitUntil(directory(env,'/backup-automatic').then(async response=>{const result=await response.json();if(result.error)console.error({event:'backup_failed',reason:result.error});if(result.recovery?.error)console.error({event:'backup_drill_failed',reason:result.recovery.error})}).catch(()=>console.error({event:'backup_failed',reason:'backup_service_unavailable'})).finally(async()=>{const response=await monitorCall(env,'/tick');await response.body?.cancel()}));
},async fetch(req, env, ctx) {await markServiceVerification(req);const response=await traceRequest(req, trace => handleRequest(req, env, ctx,trace), {allowedOrigin: SITE,onTiming:timing=>{if(new URL(req.url).pathname!=='/stream'&&ctx?.waitUntil&&env.PLAYBACK_SESSIONS)ctx.waitUntil(env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_operations_v1')).fetch('https://private/operations/timing-ingest',{method:'POST',body:JSON.stringify({timing})}).then(r=>r.body?.cancel()).catch(()=>{}))}});return browserResponse(response,req,env);}};




