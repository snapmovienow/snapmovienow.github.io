import {boxpanelAsset} from './boxpanel-portal.mjs';
import {PORTAL_SCRIPT,PORTAL_CSS,PORTAL_ICON} from './reseller-panel-assets.mjs';
export const PORTAL_HOST='juanito.resellers.snaptvnow.com';
export const UNIFIED_PORTAL_HOST='resellers.snaptvnow.com';
export const UNIFIED_PORTAL_PREFIX='/resellers';
export const PORTAL_ACCOUNT='be5f1fc0-d772-4683-9c6f-2bcdee5a4e70';
export const PORTAL_SOURCE='https://snaptvnow-resellers.juancanta89.chatgpt.site';
const PREFIX='/panel/juanito',COOKIE='__Host-SNAP_Reseller',UNIFIED_COOKIE='__Host-SNAP_Resellers';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin','Strict-Transport-Security':'max-age=31536000'};
const csp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const json=(body,status=200,extra={})=>Response.json(body,{status,headers:{...headers,...extra}});
const cookie=(token,maxAge=28800,name=COOKIE)=>name+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+maxAge;
function tokenOf(req,name=COOKIE){const values=(req.headers.get('Cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));if(values.length!==1)return null;const value=values[0].slice(name.length+1);return /^[a-f0-9]{64}$/.test(value)?value:null;}
export function matchesResellerPortal(req){const u=new URL(req.url);return u.hostname===PORTAL_HOST||u.hostname===UNIFIED_PORTAL_HOST||u.pathname===PREFIX||u.pathname.startsWith(PREFIX+'/')||u.pathname===UNIFIED_PORTAL_PREFIX||u.pathname.startsWith(UNIFIED_PORTAL_PREFIX+'/');}
export async function readPortalInput(req,max=24000){const length=Number(req.headers.get('content-length')||0);if(length>max)throw Error('input_limit');const reader=req.body?.getReader();if(!reader)return {};let size=0,parts=[];const deadline=AbortSignal.timeout(5000);try{while(true){deadline.throwIfAborted();const next=await new Promise((resolve,reject)=>{const abort=()=>{void reader.cancel();reject(Error('input_timeout'));};deadline.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>deadline.removeEventListener('abort',abort));});if(next.done)break;size+=next.value.byteLength;if(size>max){await reader.cancel();throw Error('input_limit');}parts.push(next.value);}const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||typeof body!=='object'||Array.isArray(body))throw Error('input_invalid');return body;}finally{reader.releaseLock();}}
export function createResellerPortal({getConfig,fetcher=fetch,boxpanel,catalog}){const handle=async(req,env)=>{
 const u=new URL(req.url),unified=u.hostname===UNIFIED_PORTAL_HOST||u.pathname===UNIFIED_PORTAL_PREFIX||u.pathname.startsWith(UNIFIED_PORTAL_PREFIX+'/'),host=unified?UNIFIED_PORTAL_HOST:PORTAL_HOST,prefix=unified?UNIFIED_PORTAL_PREFIX:PREFIX,base=u.hostname===host?'':prefix,path=u.pathname.slice(base.length)||'/',cookieName=unified?UNIFIED_COOKIE:COOKIE;
 if(u.protocol!=='https:')return new Response(null,{status:301,headers:{Location:'https://'+u.host+u.pathname+u.search}});
 // Native phone delivery uses a revocable device credential, never a portal cookie.
 if(path==='/api/sms-device'){
  if(req.method!=='POST')return json({error:'portal_method'},405);
  if(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'portal_format'},415);
  if(req.headers.has('Origin')&&req.headers.get('Origin')!==u.origin)return json({error:'portal_origin'},403);
  try{const cfg=await getConfig(env);if(cfg?.accountId!==PORTAL_ACCOUNT||cfg.sourceOrigin!==PORTAL_SOURCE||!/^\w{64}$/.test(cfg.gatewaySecret)||typeof cfg.siteToken!=='string')throw Error('config_unavailable');
   const input=await readPortalInput(req,8000),authorization=req.headers.get('Authorization');if(authorization&&authorization.length>80)return json({error:'sms_device_auth'},401);
   const reply=await fetcher(PORTAL_SOURCE+'/api/portal',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json','OAI-Sites-Authorization':'Bearer '+cfg.siteToken,'X-SNAP-Portal-Gateway':cfg.gatewaySecret},body:JSON.stringify({accountId:PORTAL_ACCOUNT,action:'sms-device',input,authorization,client:req.headers.get('CF-Connecting-IP')||'unknown'}),signal:AbortSignal.timeout(16000)});
   const raw=await reply.text();if(raw.length>12000||reply.status>=300&&reply.status<400)throw Error('sms_reply');return json(JSON.parse(raw),reply.status);
  }catch{return json({error:'sms_device_unavailable',message:'No se pudo confirmar la entrega. El teléfono conservará el mensaje para reintentar.'},503);}
 }
 if(catalog&&path==='/api/boxpanel/catalog'){if(req.method!=='GET')return json({error:'portal_method'},405);return catalog(env);}
 if(boxpanel&&req.method==='GET'){const asset=boxpanelAsset(path,base,{unified});if(asset)return asset;}
 if(req.method==='GET'&&(path==='/assets/favicon.svg'||path==='/favicon.svg'))return new Response(PORTAL_ICON,{headers:{...headers,'Cache-Control':'public, max-age=300','Content-Type':'image/svg+xml; charset=utf-8'}});
 if(req.method==='GET'&&(path==='/assets/panel.js'||path==='/assets/panel.css'))return new Response(path.endsWith('.js')?PORTAL_SCRIPT:PORTAL_CSS,{headers:{...headers,'Cache-Control':'public, max-age=60','Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'}});
 if(req.method==='GET'&&path==='/')return new Response('<!doctype html><html lang="es" data-portal-base="'+base+'" data-portal-mode="'+(unified?'unified':'fixed')+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#041521"><title>SNAPTVNOW · '+(unified?'Resellers':'Panel de Juanito')+'</title><link rel="icon" type="image/svg+xml" href="'+base+'/assets/favicon.svg?v=unified-1"><link rel="stylesheet" href="'+base+'/assets/panel.css?v=unified-1"></head><body><div id="portal-root"></div><script src="'+base+'/assets/panel.js?v=unified-1" defer></script></body></html>',{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});
 if(!['/api/panel','/api/portal/login','/api/portal/logout',...(boxpanel?['/api/boxpanel']:[])].includes(path))return json({error:'portal_route',message:'Ruta no disponible en este panel.'},404);
 if(path==='/api/boxpanel'&&req.method!=='POST')return json({error:'portal_method'},405);
 if(!['GET','POST'].includes(req.method)||((path!=='/api/panel')&&req.method!=='POST'))return json({error:'portal_method'},405);
 if(req.method==='POST'&&(req.headers.get('Origin')!==u.origin||req.headers.get('Sec-Fetch-Site')==='cross-site'))return json({error:'portal_origin',message:'Abre el formulario desde este panel.'},403);
 if(req.method==='POST'&&req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'portal_format'},415);
 try{
  if(path==='/api/boxpanel'){
   // Revalidate the real portal session on every request. Neither an account
   // ID nor an owner role from the browser can select another workspace.
   const auth=await handle(new Request(u.origin+base+'/api/panel?view=lines',{headers:{Cookie:req.headers.get('Cookie')||''}}),env);
   if(!auth.ok)return auth;
   const value=await auth.json(),actor=value.actor;
   if(actor?.role!=='reseller'||typeof actor.id!=='string'||!/^[A-Za-z0-9_.:-]{1,80}$/.test(actor.id)||value.target?.id!==actor.id||value.overview!==false||!Array.isArray(value.accounts)||value.accounts.length)throw Error('box_scope');
   return await boxpanel(env,await readPortalInput(req,360000),actor.id);
  }
  const cfg=await getConfig(env);if(cfg?.accountId!==PORTAL_ACCOUNT||cfg.sourceOrigin!==PORTAL_SOURCE||!/^\w{64}$/.test(cfg.gatewaySecret)||typeof cfg.siteToken!=='string')throw Error('config_unavailable');
  const session=tokenOf(req,cookieName);let body;
  if(path==='/api/portal/login'){const value=await readPortalInput(req);body={action:'login',...(unified?{username:typeof value.username==='string'&&value.username.length<=63?value.username:''}:{}),password:value.password,client:req.headers.get('CF-Connecting-IP')||'unknown'};}
  else if(path==='/api/portal/logout')body={action:'logout',token:session};
  else if(!session)return json({error:'portal_session',message:'Inicia sesión en tu panel.'},401);
  else if(req.method==='GET'){const allowed=new Set(['lineId','requestId','view','q','filter','page','pageSize','version','sort','direction','paid','lineType','slug','mode','stream','connectionLine','player','connectionSort','connectionDirection','connectionAccount','logAccount','logKind','logFrom','logTo']);if(u.search.length>4000||[...u.searchParams.keys()].some(k=>!allowed.has(k)))return json({error:'portal_query'},400);body={action:'read',token:session,query:Object.fromEntries(u.searchParams)};}
  else body={action:'write',token:session,input:await readPortalInput(req)};
  const response=await fetcher(PORTAL_SOURCE+'/api/portal',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json','OAI-Sites-Authorization':'Bearer '+cfg.siteToken,'X-SNAP-Portal-Gateway':cfg.gatewaySecret},body:JSON.stringify({...body,accountId:PORTAL_ACCOUNT,...(unified?{mode:'unified'}:{})}),signal:AbortSignal.timeout(16000)});
  const raw=await response.text();if(raw.length>1048576||response.status>=300&&response.status<400)throw Error('gateway_reply');const result=JSON.parse(raw);
  if(path==='/api/portal/login'&&response.ok){if(result.ok!==true||(!unified&&result.accountId!==PORTAL_ACCOUNT)||typeof result.accountId!=='string'||!/^[A-Za-z0-9_.:-]{1,80}$/.test(result.accountId)||!/^[a-f0-9]{64}$/.test(result.token))throw Error('login_reply');return json({ok:true},200,{'Set-Cookie':cookie(result.token,28800,cookieName)});}
  if(path==='/api/portal/logout')return json({ok:true},200,{'Set-Cookie':cookie('',0,cookieName)});
  if(result?.actor){if((!unified&&result.actor.id!==PORTAL_ACCOUNT)||result.actor.role!=='reseller'||result.target?.id!==result.actor.id||result.overview!==false||result.accounts?.length||result.lines?.some(line=>line.account_id!==result.actor.id)||result.ledger?.some(entry=>entry.account_id!==result.actor.id))throw Error('gateway_scope');result.portalBase=base;result.target.panelAccess={url:u.origin+base,active:true};}
  const retryAfter=Number(response.headers.get('Retry-After')||0),extra={...([401,403].includes(response.status)&&['portal_session','portal_suspended'].includes(result?.error)?{'Set-Cookie':cookie('',0,cookieName)}:{}),...(response.status===429&&Number.isInteger(retryAfter)&&retryAfter>0&&retryAfter<=120?{'Retry-After':String(retryAfter)}:{})};
  return json(result,response.status,extra);
 }catch{return json({error:'portal_unavailable',message:'No se pudo comprobar el resultado. Conserva la operación pendiente.',final:false},503);}
};return handle;}
