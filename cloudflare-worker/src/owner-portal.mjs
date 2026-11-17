import {portalReadDeadline} from './portal-read-deadline.mjs';
import {gatewayDiagnostic} from './portal-gateway-diagnostics.mjs';
import {ROTATION_HTML,ROTATION_SCRIPT} from './gateway-rotation-ui.mjs';
import {PORTAL_SCRIPT,PORTAL_CSS,PORTAL_ICON,PORTAL_ASSET_VERSION} from './reseller-panel-assets.mjs';
import {readPortalInput,PORTAL_ACCOUNT,PORTAL_SOURCE} from './reseller-portal.mjs';
export const OWNER_PORTAL_BASE='https://api.snaptvnow.com/owner-panel';
const PREFIX='/owner-panel',COOKIE='__Host-SNAP_Owner_Portal';
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Strict-Transport-Security':'max-age=31536000'};
const csp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const json=(v,status=200,extra={})=>Response.json(v,{status,headers:{...headers,...extra}});
const ticket=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{40,2000}$/.test(v);
const supportActions=new Set(['client-support-read','client-support-check','client-support-incident-save']);
const supportFields=new Set(['action','accountId','lineId','page','pageSize','id','title','status','note','expectedRevision']);
const supportIdentity=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(v);
const supportUsername=v=>typeof v==='string'&&/^[a-zA-Z0-9_.@!-]{3,80}$/.test(v);
const record=v=>!!v&&typeof v==='object'&&!Array.isArray(v);
const sameUsername=(a,b)=>supportUsername(a)&&supportUsername(b)&&a.toLowerCase()===b.toLowerCase();
function validSupportReply(value,username){
 return record(value)&&value.schema===1&&record(value.customer)&&supportIdentity(value.customer.id)&&sameUsername(value.customer.username,username)&&Array.isArray(value.lists)&&record(value.check)&&record(value.incidents)&&Array.isArray(value.incidents.rows);
}
const supportErrors=new Map([['support_scope',403],['support_conflict',409],['support_not_found',404],['invalid_support_note',400],['invalid_support_input',400],['support_unavailable',503]]);
function validSupportInput(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!supportFields.has(k))||!supportActions.has(v.action)||!supportIdentity(v.accountId)||!supportIdentity(v.lineId))return false;
 if(v.page!==undefined&&(!Number.isSafeInteger(v.page)||v.page<1||v.page>1000000)||v.pageSize!==undefined&&![10,25,50].includes(v.pageSize))return false;
 if(v.action!=='client-support-incident-save')return !['id','title','status','note','expectedRevision'].some(k=>Object.hasOwn(v,k));
 if(!['open','investigating','fixed_pending','resolved'].includes(v.status)||v.note!==undefined&&(typeof v.note!=='string'||v.note.length>2000)||v.title!==undefined&&(typeof v.title!=='string'||v.title.length>160))return false;
 if(v.id!==undefined)return typeof v.id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v.id)&&Number.isSafeInteger(v.expectedRevision)&&v.expectedRevision>=1;
 return v.expectedRevision===undefined&&typeof v.title==='string'&&v.title.trim().length>=3;
}
const cookie=(v,maxAge=1800)=>`${COOKIE}=${v}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
function tokenOf(req){const entries=(req.headers.get('Cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(COOKIE+'='));return entries.length===1&&ticket(entries[0].slice(COOKIE.length+1))?entries[0].slice(COOKIE.length+1):null;}
const blocked=()=>new Response('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SNAPTVNOW · Acceso protegido</title><h1>Panel admin reseller protegido</h1><p>Entra desde el administrador principal y pulsa Panel admin reseller.</p><a href="https://app.snaptvnow.com/admin.html">Abrir administrador principal</a></html>',{status:403,headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});
export const matchesOwnerPortal=req=>{const u=new URL(req.url);return u.origin==='https://api.snaptvnow.com'&&(u.pathname===PREFIX||u.pathname.startsWith(PREFIX+'/'));};
export function createOwnerPortal({getConfig,fetcher=fetch,supportCall}){return async(req,env,ctx)=>{
 const u=new URL(req.url),path=u.pathname.slice(PREFIX.length)||'/',isEntry=path==='/enter'||path==='/security/enter';if(!matchesOwnerPortal(req))return json({error:'owner_origin'},403);
 if(req.method==='GET'&&['/assets/panel.js','/assets/panel.css','/assets/favicon.svg','/assets/gateway-rotation.js'].includes(path))return new Response(path==='/assets/gateway-rotation.js'?ROTATION_SCRIPT:path.endsWith('.js')?PORTAL_SCRIPT:path.endsWith('.css')?PORTAL_CSS:PORTAL_ICON,{headers:{...headers,'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'image/svg+xml; charset=utf-8'}});
 if(!['/','/enter','/security/enter','/api/panel','/api/client-support','/api/portal/logout','/security/gateway-rotation'].includes(path))return json({error:'owner_route'},404);
 if(!['GET','POST'].includes(req.method)||isEntry&&req.method!=='GET'||['/api/portal/logout','/api/client-support'].includes(path)&&req.method!=='POST'||['/','/security/gateway-rotation'].includes(path)&&req.method!=='GET')return json({error:'owner_method'},405);
 if(req.method==='POST'&&(req.headers.get('Origin')!==u.origin||req.headers.get('Sec-Fetch-Site')==='cross-site'))return json({error:'owner_origin'},403);
 if(req.method==='POST'&&req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'owner_format'},415);
 const session=tokenOf(req);if(!isEntry&&!session)return ['/','/security/gateway-rotation'].includes(path)?blocked():json({error:'owner_entry_required',message:'Entra desde Panel admin reseller.'},401);
 let readDeadline,supportInput;
 const diagnostic=gatewayDiagnostic('owner',req);
 const supportFailure=(code,status=503,kind,error,extra={})=>json(diagnostic.failure({error:code},status,error,kind,code),status,extra);
 try{
  if(path==='/api/client-support'){
   diagnostic.phase('input');
   if(u.search)return supportFailure('invalid_support_input',400,'input');
   try{supportInput=await readPortalInput(req);}catch{return supportFailure('invalid_support_input',400,'input');}
   if(!validSupportInput(supportInput))return supportFailure('invalid_support_input',400,'input');
   diagnostic.action({action:supportInput.action});
   if(typeof supportCall!=='function')return supportFailure('support_unavailable',503,'configuration');
  }
  if(supportInput)diagnostic.phase('configuration');
  const cfg=await getConfig(env);if(cfg?.accountId!==PORTAL_ACCOUNT||cfg.sourceOrigin!==PORTAL_SOURCE||!/^[a-f0-9]{64}$/.test(cfg.gatewaySecret||'')||typeof cfg.siteToken!=='string')throw Error('config_unavailable');
  diagnostic.phase('input');let body;
  if(supportInput)body={action:'support-authorize',token:session,input:{accountId:supportInput.accountId,lineId:supportInput.lineId}};
  else if(path==='/security/gateway-rotation')body={action:'read',token:session,query:{gatewayRotation:'1'}};
  else if(isEntry){const code=u.searchParams.get('code');if(u.search.length>2200||!ticket(code)||u.searchParams.size!==1)return blocked();body={action:path==='/security/enter'?'enter-security':'enter',token:code};}
  else if(path==='/api/portal/logout')body={action:'logout',token:session};
  else if(req.method==='POST')body={action:'write',token:session,input:await readPortalInput(req)};
  else {const allowed=new Set(['gatewayRotation','telegram','slug','source','sourceLineId','sourceAccountId','choices','purpose','lineId','requestId','view','q','filter','page','pageSize','version','sort','direction','paid','lineType','mode','stream','connectionLine','player','connectionSort','connectionDirection','connectionAccount','logAccount','logKind','logFrom','logTo','monitorAccount','monitorHours','monitorContent','monitorProvider']);if(u.search.length>4000||[...u.searchParams.keys()].some(k=>!allowed.has(k)))return json({error:'owner_query'},400);body={action:'read',token:session,query:Object.fromEntries(u.searchParams)};}
  diagnostic.action(supportInput?{action:supportInput.action}:body);diagnostic.phase('fetch');
  readDeadline=portalReadDeadline(req,path,body.action);readDeadline.signal.throwIfAborted();
  const response=await fetcher(PORTAL_SOURCE+'/api/owner-portal',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json','OAI-Sites-Authorization':'Bearer '+cfg.siteToken,'X-SNAP-Portal-Gateway-Token':cfg.gatewaySecret},body:JSON.stringify({...body,accountId:PORTAL_ACCOUNT}),signal:readDeadline.signal});diagnostic.status(response.status);diagnostic.phase('body');const raw=await response.text();if(raw.length>1048576||response.status>=300&&response.status<400)throw Error('owner_reply');let result=JSON.parse(raw);diagnostic.phase('scope');
  if(supportInput){
   if(!response.ok){const status=[401,403,404].includes(response.status)?response.status:503;return supportFailure(status===404?'support_not_found':status===503?'support_unavailable':'owner_entry_required',status,'upstream_http',undefined,[401,403].includes(status)?{'Set-Cookie':cookie('',0)}:{});}
   const customer=result?.customer;
   if(result?.ok!==true||result.actor?.id!=='owner'||result.actor.role!=='owner'||customer?.accountId!==supportInput.accountId||customer.lineId!==supportInput.lineId||!supportUsername(customer.username))return supportFailure('support_scope',403,'scope');
   diagnostic.phase('support');
   diagnostic.status(null); // A missing directory reply is not the Site's 200.
   const supported=await supportCall(env,{...supportInput,confirmedUsername:customer.username},ctx);
   diagnostic.status(supported.status);let view;
   try{view=await supported.json();}catch{return supportFailure('support_invalid_response',503,'invalid_response');}
   if(!supported.ok){
    if(supported.status===404&&view?.error==='not_found')return supportFailure('support_initializing',503,'upstream_http',undefined,{'Retry-After':'10'});
    const code=supportErrors.get(view?.error)===supported.status?view.error:'support_unavailable';
    return supportFailure(code,supportErrors.get(code)||503,'upstream_http');
   }
   if(supportInput.action!=='client-support-incident-save'&&!validSupportReply(view,customer.username))return supportFailure('support_invalid_response',503,'invalid_response');
   return json(view,supported.status);
  }
  if(path==='/security/gateway-rotation'){if(!response.ok||result.actorId!=='owner'||typeof result.rotation?.enabled!=='boolean')return blocked();return new Response(ROTATION_HTML,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});}
  if(isEntry){if(!response.ok)return blocked();if(result.ok!==true||!ticket(result.token)||!Number.isSafeInteger(result.exp)||result.exp<=Date.now()||result.exp>Date.now()+1800000)throw Error('owner_reply');return new Response(null,{status:303,headers:{...headers,Location:path==='/security/enter'?PREFIX+'/security/gateway-rotation':PREFIX+'/', 'Set-Cookie':cookie(result.token,Math.floor((result.exp-Date.now())/1000))}});}
  if(path==='/api/portal/logout')return json({ok:response.ok},response.ok?200:503,{'Set-Cookie':cookie('',0)});
  if(result?.actor){if(result.actor.id!=='owner'||result.actor.role!=='owner')throw Error('owner_scope');result.portalBase=PREFIX;result.authMode='owner-portal';}
  if(path==='/'){if(!response.ok)return blocked();if(result.actor?.role!=='owner')throw Error('owner_scope');return new Response('<!doctype html><html lang="es" data-portal-base="'+PREFIX+'" data-portal-mode="owner"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SNAPTVNOW · Panel admin reseller</title><link rel="icon" href="'+PREFIX+'/assets/favicon.svg"><link rel="stylesheet" href="'+PREFIX+'/assets/panel.css?v='+PORTAL_ASSET_VERSION+'"></head><body><div id="portal-root"></div><script src="'+PREFIX+'/assets/panel.js?v='+PORTAL_ASSET_VERSION+'" defer></script></body></html>',{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});}
  diagnostic.phase('response');if(response.status>=500)result=diagnostic.failure(result,response.status,undefined,'upstream_http');
  const extra={...([401,403].includes(response.status)?{'Set-Cookie':cookie('',0)}:{}),...(response.status===429&&/^\d{1,3}$/.test(response.headers.get('Retry-After')||'')?{'Retry-After':response.headers.get('Retry-After')}:{})};return json(result,response.status,extra);
 }catch(error){if(path==='/api/client-support')return supportFailure('support_unavailable',503,undefined,error);return json(diagnostic.failure({error:'owner_unavailable',message:'No se pudo comprobar el acceso. Vuelve al administrador principal.',final:false},503,error),503);}finally{readDeadline?.cleanup();}
};}
