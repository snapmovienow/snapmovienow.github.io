import {profileRoute} from './profiles.mjs';
import {operationsRoute} from './operations.mjs';
import {allowedOrigins,canUseCookie,cookieToken,withSessionCookie,browserResponse} from './browser-sessions.mjs';
import {traceRequest, SERVICE_VERSION} from './request-diagnostics.mjs';
import {isApprovedMediaIP,fetchApprovedMediaIP} from './ip-media.mjs';
import {readPanel,validateServerUrl} from "./reseller.mjs";
import {accountsFetch} from "./accounts.mjs";
import {matchesXtream} from './xtream.mjs';
import {contentPermissions,createAdultPolicy,isAdult} from './content-permissions.mjs';
import {createProviderCatalog} from './provider-catalog.mjs';
import {createXtreamBridge,guardXtreamResponse} from './xtream-bridge.mjs';
import {fetchMedia,recoverMedia} from './media-fetch.mjs';
import {guardPlaybackExpiry} from './playback-expiry.mjs';
import {prepareWebPlayback} from './web-playback.mjs';
const liveStarts=new Map();
function rememberLiveStart(url,body){const now=Date.now();for(const [key,value] of liveStarts)if(value.until<now)liveStarts.delete(key);if(liveStarts.size>=128)liveStarts.delete(liveStarts.keys().next().value);liveStarts.set(url,{body,until:now+10000})}
const ORIGIN="http://ccf.center:8444";
const SITE="https://snapmovienow.github.io";
const actions={live:"get_live_streams",live_epg:"get_short_epg",live_categories:"get_live_categories",vod_categories:"get_vod_categories",vod:"get_vod_streams",series_categories:"get_series_categories",series:"get_series",series_info:"get_series_info",vod_info:"get_vod_info"};
const cors={"Access-Control-Allow-Origin":SITE,"Access-Control-Allow-Methods":"GET, HEAD, POST, OPTIONS","Access-Control-Allow-Headers":"content-type, range, if-range","Access-Control-Expose-Headers":"Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified","Cache-Control":"no-store"};
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{...cors,"content-type":"application/json"}});
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
 if(path==='/stream'&&['GET','HEAD'].includes(req.method))return serverStreamDirect(req,this.env,new URL(req.url),{waitUntil:promise=>this.state.waitUntil?.(promise)});
 if(path==='/refresh-pool'){const force=req.method==='POST'&&(await req.json()).force===true;if(!this.refreshing)this.refreshing=refreshProviderPool(this.env,force).finally(()=>{this.refreshing=null});try{const lines=await this.refreshing;return Response.json({ok:true,single:lines===null})}catch(e){return Response.json({error:e.message},{status:503})}}
 if(path.startsWith('/profile/'))return profileRoute(this.state.storage,req);
 if(path.startsWith('/operations/'))return operationsRoute(this.state.storage,req);
 if(path.startsWith("/accounts/"))return accountsFetch(this.state,this.env,req);if(path==="/create"){const {exp,identity,sid}=await req.json();await this.state.storage.put("exp",exp);if(sid)await this.state.storage.put("sid",sid);if(identity)await this.state.storage.put("identity",identity);await this.state.storage.setAlarm(exp);return new Response("ok")}
 if(path==="/logout"){await this.state.storage.deleteAll();return new Response("ok")}
 if(path==='/ensure'){const {exp,identity,sid}=await req.json(),oldExp=await this.state.storage.get('exp'),old=await this.state.storage.get('identity');if(oldExp>Date.now()&&old?.uid===identity.uid&&old.version===identity.version&&old.xtreamVersion===identity.xtreamVersion)return Response.json({exp:oldExp});await this.state.storage.put('exp',exp);if(sid)await this.state.storage.put('sid',sid);await this.state.storage.put('identity',identity);await this.state.storage.setAlarm(exp);return Response.json({exp})}
 const exp=await this.state.storage.get("exp");const identity=await this.state.storage.get("identity");if(identity&&!(await directory(this.env,"/check",identity)).ok)return new Response("Inactive",{status:401});return new Response(exp>Date.now()?"ok":"expired",{status:exp>Date.now()?200:401})}
 async alarm(){const sid=await this.state.storage.get("sid");if(sid)await directory(this.env,"/release-session",{sid});await this.state.storage.deleteAll()}
}
async function sessionCall(env,sid,path,body){if(!env.PLAYBACK_SESSIONS||!sid)return new Response("Unauthorized",{status:401});return env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName(sid)).fetch("https://session"+path,{method:body?"POST":"GET",...(body?{body:JSON.stringify({...body,sid})}:{})})}
async function createSession(env,username,password,accountExpiresAt=null){const sid=crypto.randomUUID(),exp=Math.min(Date.now()+12*60*60*1000,accountExpiresAt||Infinity);const r=await sessionCall(env,sid,"/create",{exp});if(!r.ok)throw Error("session_unavailable");return {sid,username,password,exp,accountExpiresAt,kind:"session"}}
async function validateAccount(username,password,origin=ORIGIN){const x=new URL(origin+"/player_api.php");x.searchParams.set("username",username);x.searchParams.set("password",password);const r=await fetch(x,{headers:{"User-Agent":"SnapMovieNow/1.0"},signal:AbortSignal.timeout(6000)});if(!r.ok){await r.body?.cancel();throw Error('provider_unavailable')}const a=await r.json();if(!['0','1'].includes(String(a?.user_info?.auth)))throw Error('provider_unavailable');return String(a.user_info.auth)==="1"&&(!a.user_info.status||a.user_info.status==="Active")&&(!(Number(a.user_info.exp_date)>0)||Number(a.user_info.exp_date)*1000>Date.now())?a:null}
async function directory(env,path,body={}){return env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName("__smn_accounts_v1")).fetch("https://private/accounts"+path,{method:"POST",body:JSON.stringify(body)})}
async function registry(env,path,body={}){return env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_xtream_catalog_v1')).fetch('https://private/accounts'+path,{method:'POST',body:JSON.stringify(body)})}
async function ownSession(env,user,admin=false){const sid=crypto.randomUUID(),exp=Math.min(Date.now()+(admin?2:12)*3600000,user.expiresAt||Infinity),identity={uid:user.id,username:user.username,version:user.version,admin};const r=await sessionCall(env,sid,"/create",{exp,identity});if(!r.ok)throw Error("session_unavailable");return {kind:admin?"admin":"session",managed:!admin,sid,exp,accountExpiresAt:user.expiresAt||null,permissions:user.permissions,...identity}}
const hashId=async value=>b64(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
const serverId=async origin=>origin===ORIGIN?'ccf':await hashId(origin);
async function encryptedLines(env,raw,origin=ORIGIN){const server=await serverId(origin);return Promise.all(raw.map(async l=>({id:server==='ccf'?l.id:server+':'+l.id,server,key:await hashId(origin+'|'+l.username.toLowerCase()),username:l.username,expiresAt:l.expiresAt||null,maxConnections:l.maxConnections,external:l.external,encrypted:await ticket(env,{kind:'provider',origin,username:l.username,password:l.password,exp:Date.now()+86400000})})))}
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
 if(d.kind==='reseller'){const read=await readPanel(d.username,d.password,p.url||'http://ccf.center:8444/NYzkggyG/',{inventory:true});raw=read.lines;inventory=read.inventory}else{const a=await validateAccount(d.username,d.password,origin);if(!a)throw Error('provider_inactive');raw=[{id:'single:'+d.username.toLowerCase(),username:d.username,password:d.password,maxConnections:Math.min(3,Number(a.user_info.max_connections)||3),external:Number(a.user_info.active_cons)||0}];inventory=raw.map(l=>({...l,status:'active',expiresAt:Number(a.user_info.exp_date)>0?Number(a.user_info.exp_date)*1000:null}))}
 }catch(error){if(!['panel_invalid','panel_no_active_lines','provider_inactive','provider_not_configured'].includes(error.message)){transient=true;const retained=await directory(env,'/pool-sync',{source:p.source,retain:true});if(!retained.ok)throw Error('panel_unavailable');return}}
 const response=await directory(env,'/pool-sync',{source:p.source,lines:await encryptedLines(env,raw,origin),inventory:await safeInventory(env,inventory,origin)});if(!response.ok)throw Error('panel_unavailable');}));
 pool=await (await directory(env,'/pool')).json();if(!pool.lines.length)throw Error(transient?'provider_unavailable':'provider_inactive');return pool.lines;
}
async function catalogCredentials(env,server,ctx,limit=1){const pool=await providerPool(env,ctx);if(!pool)return [{...await providerCredentials(env),server:'ccf'}];const counts=new Map(),credentials=[];for(const l of pool){const id=l.server||'ccf';if((server&&server!==id)||(counts.get(id)||0)>=limit)continue;const d=await unticket(env,l.encrypted);if(d){credentials.push({...d,server:id});counts.set(id,(counts.get(id)||0)+1)}}return credentials}
async function providerCredentials(env){const pool=await providerPool(env);if(pool){const d=await unticket(env,pool[0].encrypted);if(!d)throw Error("panel_unavailable");return {...d,maxConnections:pool[0].maxConnections}}
 const p=await (await directory(env,"/provider")).json(),d=await unticket(env,p.encrypted||"");if(d?.kind!=="provider")throw Error("provider_not_configured");return {...d,maxConnections:p.maxConnections}}
async function managedPlayback(env,session,server,ctx,excluded=[]){const pool=await providerPool(env,ctx);if(!pool){const credentials=await providerCredentials(env),a=await validateAccount(credentials.username,credentials.password,credentials.origin||ORIGIN);if(!a)throw Error("provider_inactive");const r=await directory(env,"/acquire",{...session,upstreamMax:a.user_info.max_connections,upstreamExternal:session.xtream?a.user_info.active_cons:0});return {r,credentials}}
 let unavailable=false,busy=false;const exclude=[...excluded];for(let i=0;i<Math.min(pool.filter(l=>!server||(l.server||"ccf")===server).length,session.xtream?3:8);i++){const r=await directory(env,"/acquire",{...session,exclude,server});if(!r.ok)return {r};const allocation=await r.json(),credentials=await unticket(env,allocation.encrypted);if(allocation.reused&&credentials&&!exclude.includes(allocation.provider_id))return {r:json({lease_id:allocation.lease_id}),credentials,provider_id:allocation.provider_id};let a;try{if(credentials)a=await validateAccount(credentials.username,credentials.password,credentials.origin||ORIGIN)}catch{unavailable=true}
 if(a&&Number(a.user_info.max_connections)>=allocation.maxConnections&&(allocation.reused||Number(a.user_info.active_cons||0)<allocation.maxConnections))return {r:json({lease_id:allocation.lease_id}),credentials,provider_id:allocation.provider_id};
 if(a)busy=true;await directory(env,"/release",{sid:session.sid,lease_id:allocation.lease_id,request_id:session.request_id});exclude.push(allocation.provider_id);}
 return {r:json({error:unavailable?'provider_unavailable':busy?'ccf_capacity':'provider_inactive'},unavailable||!busy?503:409)};
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
 if(action==="logout"){await sessionCall(env,s.sid,"/logout");return withSessionCookie(json({ok:true}),req,env,"admin","",0)}
 if(action==='xtream-settings'||action==='xtream-save'){const r=await directory(env,action==='xtream-save'?'/xtream-save':'/xtream-config',b);if(r.ok&&action==='xtream-save')await directory(env,'/audit-write',{actor:s.username,action:'xtream_changed'});return json({...await r.json(),url:new URL(req.url).origin,host:new URL(req.url).hostname,port:new URL(req.url).port||'443'},r.status)}
 if(action==='xtream-check'){const target=new URL('/player_api.php',req.url);const response=await xtreamRequest(new Request(target,{headers:{'User-Agent':'SnapMovieNow/1.0'}}),env);const body=await response.json();const config=await (await directory(env,'/xtream-config')).json();return json({compatible:response.status===401&&body.error==='credentials_required',enabled:config.enabled,url:new URL(req.url).origin,version:SERVICE_VERSION})}
 const security={"security-status":"/security-status","mfa-begin":"/mfa-begin","mfa-confirm":"/mfa-confirm","mfa-disable":"/mfa-disable","mfa-recovery-renew":"/mfa-recovery-renew","audit":"/audit","backup-list":"/backup-list","backup-download":"/backup-download","backup-export":"/backup-export","backup-preview":"/backup-preview","backup-restore":"/backup-restore"};
 if(security[action]){const r=await directory(env,security[action],{...b,actor:s.username});return json(await r.json(),r.status)}
 if(action==='playback-health'){const r=await env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_operations_v1')).fetch('https://private/operations/read',{method:'POST',body:'{}'});return json(await r.json(),r.status)}
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
  let raw,inventory,kind;if(mode==='panel'){const read=await readPanel(username,password,url,{inventory:true});raw=read.lines;inventory=read.inventory;kind='reseller'}else{const a=await validateAccount(username,password,origin);if(!a)return json({error:'provider_invalid'},400);raw=[{id:'single:'+username.toLowerCase(),username,password,maxConnections:Math.min(3,Number(a.user_info.max_connections)||3),external:Number(a.user_info.active_cons)||0}];inventory=raw.map(l=>({...l,status:'active',expiresAt:Number(a.user_info.exp_date)>0?Number(a.user_info.exp_date)*1000:null}));kind='provider'}
  const defaultUrl=mode==='panel'?'http://ccf.center:8444/NYzkggyG/':ORIGIN;const source=old?.source||(url===defaultUrl?mode+':'+username.toLowerCase():mode+':'+await hashId(url+'|'+username.toLowerCase()));
  const encrypted=await ticket(env,{kind,origin,username,password,exp:Date.now()+10*365*86400000});const response=await directory(env,'/provider-add',{source,encrypted,username,mode,url,origin,name:String(b.name||old?.name||username).slice(0,80),lines:await encryptedLines(env,raw,origin),inventory:await safeInventory(env,inventory,origin)});if(response.ok)await record('provider_saved',source);return json(await response.json(),response.status);
  }catch(e){return json({error:e.message==='invalid_server_url'?e.message:e.message.startsWith('panel_')?e.message:'provider_unavailable'},502)}
 }
 if(!paths[action])return json({error:"operation_not_allowed"},403);const r=await directory(env,paths[action],b);if(r.ok&&['save','delete'].includes(action))await record(action==='save'?'user_saved':'user_deleted',b.username);return json(await r.json(),r.status);
}
const GNULA_PAGE="https://www2.gnula.one/movie/batman-vs-superman-el-origen-de-la-justicia/";
const GNULA_CATALOG=[{"stream_id":"gnula-batman-v-superman","source":"gnula","type":"movie","name":"Batman vs Superman: El Origen de la Justicia (2016)","year":2016,"container_extension":"m3u8","stream_icon":"//image.tmdb.org/t/p/w92/mS3t9puIjLKgoex82cu9d6G0835.jpg","page":"https://www2.gnula.one/movie/batman-vs-superman-el-origen-de-la-justicia/","preferredEmbed":null},{"stream_id":"gnula-cover-up-un-periodista-en-las-trincheras","source":"gnula","type":"movie","name":"Cover-Up: Un periodista en las trincheras (2025)","year":2025,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/8FAxigDCzdlpoRcYrABeGiesqgQ.jpg","page":"https://www2.gnula.one/movie/cover-up-un-periodista-en-las-trincheras/","preferredEmbed":"https://voe.sx/e/ixuyr53rh1md"},{"stream_id":"gnula-heroe-en-dos-mundos","source":"gnula","type":"movie","name":"Héroe en dos mundos (2021)","year":2021,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/h71zxmiRNK41OfGZt66bHFaeD4F.jpg","page":"https://www2.gnula.one/movie/heroe-en-dos-mundos/","preferredEmbed":"https://voe.sx/e/v8hxayuagvx1"},{"stream_id":"gnula-zootropolis-2","source":"gnula","type":"movie","name":"Zootrópolis 2 (2025)","year":2025,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/oDaWFIrBuOaFrTmBpAlMfmsa81N.jpg","page":"https://www2.gnula.one/movie/zootropolis-2/","preferredEmbed":"https://voe.sx/e/z7i4eybrekkt"},{"stream_id":"gnula-popeye-the-slayer-man","source":"gnula","type":"movie","name":"Popeye the Slayer Man (2025)","year":2025,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/nVwu3mN7hr1yF467pGct3yQFM41.jpg","page":"https://www2.gnula.one/movie/popeye-the-slayer-man/","preferredEmbed":"https://voe.sx/e/woywgxiwleuk"},{"stream_id":"gnula-adios-june","source":"gnula","type":"movie","name":"Adiós, June (2025)","year":2025,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/c6b7JgxtmN1ADVzFPeeY3J11kWt.jpg","page":"https://www2.gnula.one/movie/adios-june/","preferredEmbed":"https://voe.sx/e/oyitlm7lycyk"},{"stream_id":"gnula-santastein","source":"gnula","type":"movie","name":"Santastein (2024)","year":2024,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/zUY57i43vmIbp7xod8BdE3MxQ0c.jpg","page":"https://www2.gnula.one/movie/santastein/","preferredEmbed":"https://voe.sx/e/mk6iwcssanzn"},{"stream_id":"gnula-noche-de-paz-noche-de-muerte","source":"gnula","type":"movie","name":"Noche de Paz, Noche de Muerte (2025)","year":2025,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/oy5UMCnEYxwRz7HCQucZ01kKrSN.jpg","page":"https://www2.gnula.one/movie/noche-de-paz-noche-de-muerte/","preferredEmbed":"https://voe.sx/e/mkg6tyn3no3n"},{"stream_id":"gnula-a-biltmore-christmas","source":"gnula","type":"movie","name":"A Biltmore Christmas (2023)","year":2023,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/gtiimCHYHb31iUPa0P60S2qEoPs.jpg","page":"https://www2.gnula.one/movie/a-biltmore-christmas/","preferredEmbed":"https://voe.sx/e/nqi0ny3zfnjd"},{"stream_id":"gnula-springsteen-deliver-me-from-nowhere","source":"gnula","type":"movie","name":"Springsteen: Deliver Me from Nowhere (2025)","year":2025,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/e5Gl93objIeRZp2V52kd0wNB9qR.jpg","page":"https://www2.gnula.one/movie/springsteen-deliver-me-from-nowhere/","preferredEmbed":"https://voe.sx/e/ul091aghwbea"},{"stream_id":"gnula-blue-sun-palace","source":"gnula","type":"movie","name":"Blue Sun Palace (2025)","year":2025,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/bg8Fi5Vt9DhtuzWmyUn9qkljblu.jpg","page":"https://www2.gnula.one/movie/blue-sun-palace/","preferredEmbed":"https://voe.sx/e/ia3hfebulll9"},{"stream_id":"gnula-el-gran-diluvio","source":"gnula","type":"movie","name":"El gran diluvio (2025)","year":2025,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/qIzSyT2AmDxkcQ0zOAeTbtZR9EQ.jpg","page":"https://www2.gnula.one/movie/el-gran-diluvio/","preferredEmbed":"https://voe.sx/e/xepnnyhsha9r"},{"stream_id":"gnula-die-my-love","source":"gnula","type":"movie","name":"Die My Love (2025)","year":2025,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/u2xyvEmgkXmfMeCQcGf6mERNFfd.jpg","page":"https://www2.gnula.one/movie/die-my-love/","preferredEmbed":"https://voe.sx/e/8wq02ursmxaq"},{"stream_id":"gnula-la-sospecha-de-sofia","source":"gnula","type":"movie","name":"La sospecha de Sofía (2025)","year":2025,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/jt6mm0nqYdn6UFEGoEEI4Xt3VMi.jpg","page":"https://www2.gnula.one/movie/la-sospecha-de-sofia/","preferredEmbed":"https://voe.sx/e/qpt1tigw79gd"},{"stream_id":"gnula-carinena-vino-del-mar","source":"gnula","type":"movie","name":"Cariñena, vino del mar (2025)","year":2025,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/mrcydPLFg2J3I5p56VtetNHMd5A.jpg","page":"https://www2.gnula.one/movie/carinena-vino-del-mar/","preferredEmbed":"https://voe.sx/e/mj8pinec3wnp"},{"stream_id":"gnula-jay-kelly","source":"gnula","type":"movie","name":"Jay Kelly (2025)","year":2025,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/12/vO0cV3886E47tmZo0iJXzMPEEzr.jpg","page":"https://www2.gnula.one/movie/jay-kelly/","preferredEmbed":"https://voe.sx/e/6wlfncyuy7xd"},{"stream_id":"gnula-selena-y-los-dinos","source":"gnula","type":"movie","name":"Selena y Los Dinos (2025)","year":2025,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/11/xkAS2BZ4SZGv9Iq9kqlq5q4rkYI.jpg","page":"https://www2.gnula.one/movie/selena-y-los-dinos/","preferredEmbed":"https://voe.sx/e/wl5yqwhdwkym"},{"stream_id":"gnula-una-navidad-muy-jonas-brothers","source":"gnula","type":"movie","name":"Una Navidad muy Jonas Brothers (2025)","year":2025,"container_extension":"m3u8","stream_icon":"https://www2.gnula.one/wp-content/uploads/2025/11/rQp9P3CigiN3bgNm0NkYoSl3bMv.jpg","page":"https://www2.gnula.one/movie/una-navidad-muy-jonas-brothers/","preferredEmbed":"https://voe.sx/e/kjbmpswnzo2r"}];
const gnulaMovie=GNULA_CATALOG.find(x=>x.stream_id==="gnula-batman-v-superman");
function publicTitle(x){const {page,episodes,preferredEmbed,...item}=x;return item}
async function sourceHtml(url){const r=await fetch(url,{headers:{"User-Agent":"Mozilla/5.0"},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error("source_unavailable");return r.text()}
function decodeVoe(text){for(const match of text.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)){try{const a=JSON.parse(match[1]);if(!Array.isArray(a)||typeof a[0]!=="string")continue;let v=a[0].replace(/[a-zA-Z]/g,c=>String.fromCharCode(c.charCodeAt(0)+(c.toLowerCase()<="m"?13:-13)));v=v.replace(/@\$|\^\^|~@|%\?|\*~|!!|#&/g,"");v=atob(v);v=Array.from(v,c=>String.fromCharCode(c.charCodeAt(0)-3)).reverse().join("");const config=JSON.parse(atob(v));return config.source}catch{}}throw Error("unsupported_config")}
async function resolveGnula(pageUrl=GNULA_PAGE,preferredEmbed=null){let html=await sourceHtml(pageUrl);for(const m of html.matchAll(/data-iframe="([^"]+)"/g)){try{html+=" "+atob(m[1])}catch{}}
const embeds=[...new Set([...(preferredEmbed?[preferredEmbed]:[]),...(html.match(/https:\/\/(?:voe\.sx\/e\/[a-z0-9]+|uqload\.(?:com|vc)\/embed-[a-z0-9]+\.html)/g)||[])])];
for(const embed of embeds){try{let text=await sourceHtml(embed),source;
if(new URL(embed).hostname==="voe.sx"){const redirect=text.match(/window\.location\.href\s*=\s*'(https:\/\/[^']+)'/)?.[1];if(redirect){const dest=new URL(redirect);if(dest.protocol!=="https:"||!VOE_EMBED_HOSTS.has(dest.hostname)||dest.port)throw Error("redirect_not_allowed");text=await sourceHtml(dest.href)}source=decodeVoe(text)}else{let config=text;const packed=text.match(/\}\('((?:\\.|[^'])*)',(\d+),(\d+),'([^']*)'\.split\('\|'\)/);if(packed){const radix=Number(packed[2]),words=packed[4].split("|");if(radix<2||radix>36)throw Error("unsupported_config");config=packed[1].replace(/\b[0-9a-z]+\b/g,v=>{const i=parseInt(v,radix);return Number.isFinite(i)&&words[i]?words[i]:v})}source=config.match(/file\s*:\s*"(https:[^"]+\.m3u8[^"]*)"/)?.[1]}
if(source&&allowedGnula(new URL(source))){const r=await fetch(source,{headers:{"User-Agent":"Mozilla/5.0"},signal:AbortSignal.timeout(15000)});if(r.ok&&(await r.text()).startsWith("#EXTM3U"))return source}
}catch{}}throw Error("media_missing")}
const VOE_EMBED_HOSTS=new Set(["teresapoliticallearn.com"]);
function allowedGnula(u){return u.protocol==="https:"&&(/^(?:strm\d+\.uqload\.vc|ugc-cdn-caching-[a-z0-9]+\.cloudwindow-route\.com)$/.test(u.hostname))&&!u.port&&!u.username&&!u.password}
function proxiedMedia(origin,t,url){return origin+"/gnula-media?t="+encodeURIComponent(t)+"&path="+encodeURIComponent(url)}
async function gnulaMedia(req,env,u,ctx){const t=u.searchParams.get("t")||"",d=await unticket(env,t);if(d?.kind!=="gnula"||!(await sessionCall(env,d.sid,"/check")).ok)return json({error:"session_expired"},401);
 const base=new URL(d.source),target=new URL(u.searchParams.get("path")||d.source);const directory=base.pathname.slice(0,base.pathname.lastIndexOf("/")+1);
 if(!allowedGnula(target)||target.hostname!==base.hostname||!target.pathname.startsWith(directory))return json({error:"media_not_allowed"},403);
 const headers=new Headers({"User-Agent":"Mozilla/5.0"});if(req.headers.has("range"))headers.set("range",req.headers.get("range"));const r=await fetch(target.href,{headers,redirect:"manual"});if(r.status>=300&&r.status<400)return json({error:"media_redirect_not_allowed"},502);
 if(!r.ok)return json({error:"media_unavailable"},r.status===404?404:502);
 const out=new Headers(cors);for(const n of ["content-type","content-length","content-range","accept-ranges"])if(r.headers.has(n))out.set(n,r.headers.get(n));
 if(target.pathname.endsWith(".m3u8")){const text=await r.text();if(!text.startsWith("#EXTM3U"))return json({error:"invalid_playlist"},502);const rewrite=x=>{const url=new URL(x,target);if(!allowedGnula(url)||url.hostname!==base.hostname||!url.pathname.startsWith(directory))throw Error("playlist_url_not_allowed");return proxiedMedia(u.origin,t,url.href)};
 const playlist=text.split(/\r?\n/).map(line=>!line.trim()?line:line.startsWith("#")?line.replace(/URI="([^"]+)"/g,(_,url)=>'URI="'+rewrite(url)+'"'):rewrite(line.trim())).join("\n");out.delete("content-length");out.set("content-type","application/vnd.apple.mpegurl");return new Response(req.method==="HEAD"?null:playlist,{headers:out})}
 return guardPlaybackExpiry(new Response(req.method==="HEAD"?null:r.body,{status:r.status,headers:out}),d.exp,req.signal,()=>directory(env,"/release-session",{sid:d.sid}),ctx)
}

async function fetchValidatedMedia(start,headers,type){
 let next=start,response;
 for(let redirects=0;redirects<6;redirects++){const target=new URL(next);if(target.hostname==='194.76.0.119'&&target.port==='8080'&&target.protocol==='http:')target.hostname='media.snaptvnow.com';if(!isApprovedMediaIP(target)){if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(target.hostname))throw Error('media_origin_unapproved');validateServerUrl(target.origin);}next=target.href;response=isApprovedMediaIP(target)?await fetchApprovedMediaIP(next,headers):await fetchMedia(next,{headers,redirect:'manual'},type==='live'?12000:25000);if(![301,302,303,307,308].includes(response.status))return {response,url:next};const location=response.headers.get('location');await response.body?.cancel();if(!location||redirects===5)throw Error('invalid_redirect');next=new URL(location,next).href}
}
async function serverStream(req,env,u,ctx){
 const d=await unticket(env,u.searchParams.get('t')||'');if(!d?.sid||!['movie','series','live'].includes(d.type))return new Response('Expired',{status:410,headers:cors});
 // Keep video parsing, byte-range recovery and stream callbacks out of the
 // front-door request's small CPU budget. One relay per session avoids a shared
 // bottleneck; control-plane revocation and provider capacity remain separate.
 return env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_media_v1:'+d.sid)).fetch(new Request(u.href,req));
}
async function serverStreamDirect(req,env,u,ctx){
 const d=await unticket(env,u.searchParams.get('t')||'');if(!d||!['movie','series','live'].includes(d.type)||!/^\d+$/.test(String(d.id))||!(await sessionCall(env,d.sid,'/check')).ok)return new Response('Expired',{status:410,headers:cors});
 if(d.lease_id&&!(await directory(env,d.xtream?'/heartbeat':'/lease-check',{lease_id:d.lease_id,sid:d.sid,request_id:d.request_id})).ok)return json({error:'playback_expired'},410);
 const warm=liveStarts.get(u.href);if(warm){liveStarts.delete(u.href);if(warm.until>Date.now()&&req.method==='GET')return new Response(warm.body,{headers:{...cors,'content-type':'application/vnd.apple.mpegurl'}})}
 const folder=d.type==='series'?'series':d.type==='live'?'live':'movie',start=d.resource||(d.origin||ORIGIN)+'/'+folder+'/'+encodeURIComponent(d.username)+'/'+encodeURIComponent(d.password)+'/'+d.id+'.'+cleanExt(d.ext);
 const headers=new Headers({'User-Agent':'SnapMovieNow/1.0','Accept-Encoding':'identity'});for(const n of ['range','if-range'])if(req.headers.has(n))headers.set(n,req.headers.get(n));if(req.method==='HEAD')headers.set('range','bytes=0-0');const fetched=await fetchValidatedMedia(start,headers,d.type);let response=fetched.response;const next=fetched.url;
 if(d.lease_id&&!(await directory(env,"/lease-check",{sid:d.sid,lease_id:d.lease_id,request_id:d.request_id})).ok){await response.body?.cancel().catch(()=>{});return json({error:"playback_expired"},410)}
 const playlist=response.ok&&(/mpegurl/i.test(response.headers.get('content-type')||'')||new URL(next).pathname.endsWith('.m3u8'));
 if(response.ok&&d.type==='live'&&d.ext==='m3u8'&&!d.resource&&!playlist){await response.body?.cancel();throw Error('invalid_playlist')}
 // Signed HLS endpoints often have no filename extension. Recover every finite
 // binary playlist resource by its declared byte range, including redirects.
 if(!playlist&&(d.resource||d.type!=='live'))response=recoverMedia(response,async(range,validator)=>{const h=new Headers(headers);h.set('range',range);if(validator)h.set('if-range',validator);return (await fetchValidatedMedia(start,h,d.type)).response},async()=>(await sessionCall(env,d.sid,'/check')).ok&&(!d.lease_id||(await directory(env,d.xtream?'/heartbeat':'/lease-check',{sid:d.sid,lease_id:d.lease_id,request_id:d.request_id})).ok));
 const out=new Headers(cors);for(const n of ['content-type','content-length','content-range','accept-ranges','etag','last-modified'])if(response.headers.has(n))out.set(n,response.headers.get(n));
 if(req.method==='HEAD'){const total=response.headers.get('content-range')?.match(/\/(\d+)$/)?.[1];if(total)out.set('content-length',total);out.delete('content-range');await response.body?.cancel();return new Response(null,{status:response.status===206?200:response.status,headers:out})}
 if(playlist){const text=await response.text();if(!text.startsWith('#EXTM3U'))throw Error('invalid_playlist');const proxy=async value=>{const target=new URL(value,next);if(target.hostname==='194.76.0.119'&&target.port==='8080'&&target.protocol==='http:')target.hostname='media.snaptvnow.com';if(!isApprovedMediaIP(target)){if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(target.hostname))throw Error('media_origin_unapproved');validateServerUrl(target.origin);}if(target.username||target.password)throw Error('invalid_playlist');return u.origin+'/stream?t='+await ticket(env,{...d,resource:target.href})};
 const lines=await Promise.all(text.split(/\r?\n/).map(async line=>{if(!line.trim())return line;if(!line.startsWith('#'))return proxy(line.trim());const matches=[...line.matchAll(/URI="([^"]+)"/g)];for(const m of matches)line=line.replace(m[0],'URI="'+await proxy(m[1])+'"');return line}));const body=lines.join('\n');if(req.headers.get('X-SMN-Prepare')==='1'&&!d.resource)rememberLiveStart(u.href,body);out.delete('content-length');out.set('content-type','application/vnd.apple.mpegurl');return new Response(body,{headers:out})}
 const result=new Response(response.body,{status:response.status,headers:out});
 if(d.xtream&&!d.resource&&d.ext!=='m3u8')return guardXtreamResponse(result,async()=>(await sessionCall(env,d.sid,'/check')).ok&&(await directory(env,'/heartbeat',{sid:d.sid,lease_id:d.lease_id,request_id:d.request_id})).ok,()=>directory(env,'/release',{sid:d.sid,lease_id:d.lease_id,request_id:d.request_id}),ctx,req.signal,d.exp);
 return guardPlaybackExpiry(result,d.exp,req.signal,()=>directory(env,"/release-session",{sid:d.sid}),ctx);
}

const catalogDeps={directory,registry,sessionCall,ticket,managedPlayback,serverStream,json,catalogCredentials:async(env,server,ctx)=>(await catalogCredentials(env,server,ctx,3)).map(p=>({...p,origin:p.origin||ORIGIN}))};
const xtreamRequest=createXtreamBridge(catalogDeps);
async function handleRequest(req,env,ctx){const u=new URL(req.url);
if(req.method==='POST'&&req.headers.get('Cookie')?.includes('__Host-smn_')&&!canUseCookie(req,env))return json({error:'origin_not_allowed'},403);
if(req.headers.get('Origin')&&!allowedOrigins(env).has(req.headers.get('Origin'))&&req.method==='POST')return json({error:'origin_not_allowed'},403);
if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
if(u.pathname==="/health")return json({ok:true,service:"snapmovienow-edge",version:SERVICE_VERSION,capabilities:['xtream','admin-recovery-renewal']});
if(matchesXtream(u.pathname))return xtreamRequest(req,env,ctx);
if(u.pathname==="/admin"&&req.method==="POST"){try{return await adminRequest(req,env,ctx)}catch(e){return json({error:["body_too_large","invalid_json"].includes(e.message)?e.message:"admin_unavailable"},e.message==="body_too_large"?413:e.message==="invalid_json"?400:502)}}
if(u.pathname==="/gnula-media"&&["GET","HEAD"].includes(req.method)){try{return await gnulaMedia(req,env,u,ctx)}catch{return json({error:"media_unavailable"},502)}}
if(u.pathname==='/stream'&&['GET','HEAD'].includes(req.method)){try{return await serverStream(req,env,u,ctx)}catch(e){return json({error:e.message==='media_origin_unapproved'?'media_origin_unapproved':'stream_unavailable'},502)}}
if(req.method!=="POST")return json({error:"method_not_allowed"},405);
try{const b=await readLimitedJSON(req),op=String(b.op||"");if(!["auth","logout","gnula_catalog","gnula_series_info","gnula_token","stream_token","session_info","playback_heartbeat","playback_release","playback_cancel","profile_get","profile_patch","playback_metric"].includes(op)&&!Object.hasOwn(actions,op))return json({error:"operation_not_allowed"},403);
if(op==="auth"){
 if(!b.username||!b.password)return json({error:'credentials_required'},400);
 const has=await (await directory(env,"/has",{username:b.username})).json();let session,a;
 if(has.exists){const r=await directory(env,"/login",{username:b.username,password:b.password,client:req.headers.get("CF-Connecting-IP")||"unknown"});if(!r.ok)return json(await r.json(),r.status);const user=await r.json();session=await ownSession(env,user);a=accountInfo(session)}
 else{a=await validateAccount(String(b.username),String(b.password));if(!a)return json({error:"invalid_credentials"},401);session=await createSession(env,String(b.username),String(b.password),Number(a.user_info.exp_date)>0?Number(a.user_info.exp_date)*1000:null);a={...a,server_time:Date.now(),session_expires_at:session.exp,account_expires_at:session.accountExpiresAt}}
 const old=await unticket(env,String(b.access_token||""));if(old?.kind==="session"&&old.username===session.username){await directory(env,"/release-session",{sid:old.sid});await sessionCall(env,old.sid,"/logout")}
 const token=await ticket(env,session);return withSessionCookie(json({...a,access_token:b.browser_cookie&&canUseCookie(req,env)?null:token}),req,env,"session",token,Math.max(0,Math.floor((session.exp-Date.now())/1000)));
}
let session=await unticket(env,String(b.access_token||cookieToken(req,env,"session")));if(session?.kind!=="session"||!(await sessionCall(env,session.sid,"/check")).ok)return json({error:"session_required"},401);
const permissions=contentPermissions(session.managed?await (await directory(env,'/permissions',{username:session.username})).json():null);session.permissions=permissions;
const catalog=createProviderCatalog(catalogDeps,env,ctx),adultPolicy=createAdultPolicy(catalog);
if(op==='session_info')return json(accountInfo(session));
if(op==='playback_metric'){
 if(!session.managed)return json({ok:true,ignored:true});
 const pool=await (await directory(env,'/pool')).json(),servers=new Set(['ccf','gnula',...(pool.lines||[]).map(l=>l.server||'ccf')]);
 if(!servers.has(b.metric?.server))return json({error:'invalid_metric'},400);
 const r=await env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_operations_v1')).fetch('https://private/operations/ingest',{method:'POST',body:JSON.stringify({uid:session.uid,metric:b.metric})});return json(await r.json(),r.status);
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
if(op==="playback_release"){if(!session.managed||!b.lease_id)return json({ok:true});const r=await directory(env,"/release",{sid:session.sid,lease_id:b.lease_id,request_id:b.request_id});return json(await r.json(),r.status)}
if(op==="logout"){await directory(env,"/release-session",{sid:session.sid});await sessionCall(env,session.sid,"/logout");return withSessionCookie(json({ok:true}),req,env,"session","",0)}
b.username=session.username;b.password=session.password;
if(op==="gnula_catalog")return json(GNULA_CATALOG.filter(x=>permissions.adults||!isAdult(x)).filter(x=>x.type==="series"?permissions.series:permissions.movies).map(publicTitle));
if(op==="gnula_series_info"){const item=GNULA_CATALOG.find(x=>x.series_id===b.series_id);if(!item)return json({error:"title_not_allowed"},404);if(!permissions.adults&&isAdult(item))return json({error:"adult_content_disabled"},403);const episodes={};for(const ep of item.episodes||[]){if(!permissions.adults&&isAdult(ep))continue;(episodes[ep.season]??=[]).push({id:ep.id,title:"Episodio "+ep.episode_num,episode_num:ep.episode_num,container_extension:"m3u8"})}return json({info:{plot:item.plot,year:item.year},episodes})}
if(op==="gnula_token"){const item=GNULA_CATALOG.find(x=>x.stream_id===b.id);let page=item?.page,preferred=item?.preferredEmbed;if(item&&!permissions.movies)return json({error:"content_disabled"},403);if(!permissions.adults&&isAdult(item))return json({error:"adult_content_disabled"},403);if(!page){const parent=GNULA_CATALOG.find(x=>x.episodes?.some(ep=>ep.id===b.id));const ep=parent?.episodes.find(ep=>ep.id===b.id);if(!permissions.adults&&(isAdult(parent)||isAdult(ep)))return json({error:"adult_content_disabled"},403);if(parent&&!permissions.series)return json({error:"content_disabled"},403);page=ep?.page;preferred=ep?.preferredEmbed}if(!page)return json({error:"title_not_allowed"},404);const source=await resolveGnula(page,preferred);const data={kind:"gnula",source,sid:session.sid,exp:Math.min(session.exp,Date.now()+3*60*60*1000)};const t=await ticket(env,data);return json({url:proxiedMedia(u.origin,t,source)})}
if(op==="stream_token"){
 if(!["movie","series","live"].includes(String(b.type||"movie"))||!/^\d+$/.test(String(b.id||"")))return json({error:"invalid_stream"},400);
 if(!permissions.adults){
  let parentId=b.series_id;
  if(b.type==='series'&&!parentId)parentId=(await (await registry(env,'/xtream-episode',{server:b.server||'ccf',id:b.id})).json())?.parentId;
  if(!await adultPolicy.allowed({kind:b.type==='series'?'episode':b.type||'movie',server:b.server||'ccf',upstreamId:b.id,parentId}))return json({error:'adult_content_disabled'},403);
 }
 return await prepareWebPlayback(b,session,req.url,env,ctx,{directory,managedPlayback,ticket,serverStream,json,cleanExt,origin:ORIGIN});
}
if(session.managed){
 if(op==='live_epg'&&!/^\d+$/.test(String(b.stream_id||'')))return json({error:'invalid_stream'},400);
 const kind=op==='live_epg'?'live':op==='series_info'?'series_list':op==='vod_info'?'movie':null;
 if(kind&&!permissions.adults&&!await adultPolicy.allowed({kind,server:b.server||'ccf',upstreamId:b.series_id||b.vod_id||b.stream_id}))return json({error:'adult_content_disabled'},403);
 const params=op==='series_info'?{series_id:b.series_id}:op==='vod_info'?{vod_id:b.vod_id}:op==='live_epg'?{stream_id:b.stream_id,limit:4}:{};
 let data=await catalog(actions[op],b.server,params);
 if(!permissions.adults){
  if(Array.isArray(data))data=await adultPolicy.filter(actions[op],data);
  else {if(isAdult(data.info)||isAdult(data.movie_data))return json({error:'adult_content_disabled'},403);
   if(data.episodes)data={...data,episodes:Object.fromEntries(Object.entries(data.episodes).map(([season,rows])=>[season,rows.filter(ep=>!isAdult(ep)&&!isAdult(ep.info))]).filter(([,rows])=>rows.length))};
  }
 }
 if(op==='series_info'&&data.episodes){
  const entries=Object.values(data.episodes).flat().filter(ep=>/^\d+$/.test(String(ep.id))).map(ep=>({kind:'episode',server:b.server||'ccf',upstreamId:String(ep.id),parentId:String(b.series_id),ext:cleanExt(ep.container_extension)}));
  if(entries.length)await registry(env,'/xtream-register',{entries});
 }
 return json(data);
}
const x=new URL(ORIGIN+"/player_api.php");x.searchParams.set("username",String(b.username));x.searchParams.set("password",String(b.password));if(op!=="auth")x.searchParams.set("action",actions[op]);if(op==="series_info"&&b.series_id)x.searchParams.set("series_id",String(b.series_id));if(op==="vod_info"&&b.vod_id)x.searchParams.set("vod_id",String(b.vod_id));if(op==="live_epg"){x.searchParams.set("stream_id",String(b.stream_id));x.searchParams.set("limit","4")}const up=await fetch(x,{headers:{"User-Agent":"SnapMovieNow/1.0"},redirect:"follow"});return new Response(await up.text(),{status:up.status,headers:{...cors,"content-type":up.headers.get("content-type")||"application/json"}})}catch(e){return json({error:["body_too_large","invalid_json"].includes(e.message)?e.message:"upstream_unavailable"},e.message==="body_too_large"?413:e.message==="invalid_json"?400:502)}}
export default {scheduled(event,env,ctx){if(env.ENVIRONMENT!=="staging")ctx.waitUntil(directory(env,"/backup-automatic").then(async r=>{const result=await r.json();if(result.error)console.error({event:"backup_failed",reason:result.error})}))},async fetch(req, env, ctx) {const response=await traceRequest(req, () => handleRequest(req, env, ctx), {allowedOrigin: SITE});return browserResponse(response,req,env);}};




