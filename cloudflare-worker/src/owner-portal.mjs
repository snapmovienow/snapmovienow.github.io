import {ROTATION_HTML,ROTATION_SCRIPT} from './gateway-rotation-ui.mjs';
import {PORTAL_SCRIPT,PORTAL_CSS,PORTAL_ICON} from './reseller-panel-assets.mjs';
import {readPortalInput,PORTAL_ACCOUNT,PORTAL_SOURCE} from './reseller-portal.mjs';
export const OWNER_PORTAL_BASE='https://api.snaptvnow.com/owner-panel';
const PREFIX='/owner-panel',COOKIE='__Host-SNAP_Owner_Portal';
const headers={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Strict-Transport-Security':'max-age=31536000'};
const csp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const json=(v,status=200,extra={})=>Response.json(v,{status,headers:{...headers,...extra}});
const ticket=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{40,2000}$/.test(v);
const cookie=(v,maxAge=1800)=>`${COOKIE}=${v}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`;
function tokenOf(req){const entries=(req.headers.get('Cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(COOKIE+'='));return entries.length===1&&ticket(entries[0].slice(COOKIE.length+1))?entries[0].slice(COOKIE.length+1):null;}
const blocked=()=>new Response('<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SNAPTVNOW · Acceso protegido</title><h1>Panel admin reseller protegido</h1><p>Entra desde el administrador principal y pulsa Panel admin reseller.</p><a href="https://app.snaptvnow.com/admin.html">Abrir administrador principal</a></html>',{status:403,headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});
export const matchesOwnerPortal=req=>{const u=new URL(req.url);return u.origin==='https://api.snaptvnow.com'&&(u.pathname===PREFIX||u.pathname.startsWith(PREFIX+'/'));};
export function createOwnerPortal({getConfig,fetcher=fetch}){return async(req,env)=>{
 const u=new URL(req.url),path=u.pathname.slice(PREFIX.length)||'/',isEntry=path==='/enter'||path==='/security/enter';if(!matchesOwnerPortal(req))return json({error:'owner_origin'},403);
 if(req.method==='GET'&&['/assets/panel.js','/assets/panel.css','/assets/favicon.svg','/assets/gateway-rotation.js'].includes(path))return new Response(path==='/assets/gateway-rotation.js'?ROTATION_SCRIPT:path.endsWith('.js')?PORTAL_SCRIPT:path.endsWith('.css')?PORTAL_CSS:PORTAL_ICON,{headers:{...headers,'Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':path.endsWith('.css')?'text/css; charset=utf-8':'image/svg+xml; charset=utf-8'}});
 if(!['/','/enter','/security/enter','/api/panel','/api/portal/logout','/security/gateway-rotation'].includes(path))return json({error:'owner_route'},404);
 if(!['GET','POST'].includes(req.method)||isEntry&&req.method!=='GET'||path==='/api/portal/logout'&&req.method!=='POST'||['/','/security/gateway-rotation'].includes(path)&&req.method!=='GET')return json({error:'owner_method'},405);
 if(req.method==='POST'&&(req.headers.get('Origin')!==u.origin||req.headers.get('Sec-Fetch-Site')==='cross-site'))return json({error:'owner_origin'},403);
 if(req.method==='POST'&&req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()!=='application/json')return json({error:'owner_format'},415);
 const session=tokenOf(req);if(!isEntry&&!session)return ['/','/security/gateway-rotation'].includes(path)?blocked():json({error:'owner_entry_required',message:'Entra desde Panel admin reseller.'},401);
 try{
  const cfg=await getConfig(env);if(cfg?.accountId!==PORTAL_ACCOUNT||cfg.sourceOrigin!==PORTAL_SOURCE||!/^[a-f0-9]{64}$/.test(cfg.gatewaySecret||'')||typeof cfg.siteToken!=='string')throw Error('config_unavailable');
  let body;
  if(path==='/security/gateway-rotation')body={action:'read',token:session,query:{gatewayRotation:'1'}};
  else if(isEntry){const code=u.searchParams.get('code');if(u.search.length>2200||!ticket(code)||u.searchParams.size!==1)return blocked();body={action:path==='/security/enter'?'enter-security':'enter',token:code};}
  else if(path==='/api/portal/logout')body={action:'logout',token:session};
  else if(req.method==='POST')body={action:'write',token:session,input:await readPortalInput(req)};
  else {const allowed=new Set(['gatewayRotation','telegram','slug','source','sourceLineId','sourceAccountId','choices','purpose','lineId','requestId','view','q','filter','page','pageSize','version','sort','direction','paid','lineType','mode','stream','connectionLine','player','connectionSort','connectionDirection','connectionAccount','logAccount','logKind','logFrom','logTo','monitorAccount','monitorHours','monitorContent','monitorProvider']);if(u.search.length>4000||[...u.searchParams.keys()].some(k=>!allowed.has(k)))return json({error:'owner_query'},400);body={action:'read',token:session,query:Object.fromEntries(u.searchParams)};}
  const response=await fetcher(PORTAL_SOURCE+'/api/owner-portal',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json','OAI-Sites-Authorization':'Bearer '+cfg.siteToken,'X-SNAP-Portal-Gateway-Token':cfg.gatewaySecret},body:JSON.stringify({...body,accountId:PORTAL_ACCOUNT}),signal:AbortSignal.timeout(16000)}),raw=await response.text();if(raw.length>1048576||response.status>=300&&response.status<400)throw Error('owner_reply');const result=JSON.parse(raw);
  if(path==='/security/gateway-rotation'){if(!response.ok||result.actorId!=='owner'||typeof result.rotation?.enabled!=='boolean')return blocked();return new Response(ROTATION_HTML,{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});}
  if(isEntry){if(!response.ok)return blocked();if(result.ok!==true||!ticket(result.token)||!Number.isSafeInteger(result.exp)||result.exp<=Date.now()||result.exp>Date.now()+1800000)throw Error('owner_reply');return new Response(null,{status:303,headers:{...headers,Location:path==='/security/enter'?PREFIX+'/security/gateway-rotation':PREFIX+'/', 'Set-Cookie':cookie(result.token,Math.floor((result.exp-Date.now())/1000))}});}
  if(path==='/api/portal/logout')return json({ok:response.ok},response.ok?200:503,{'Set-Cookie':cookie('',0)});
  if(result?.actor){if(result.actor.id!=='owner'||result.actor.role!=='owner')throw Error('owner_scope');result.portalBase=PREFIX;result.authMode='owner-portal';}
  if(path==='/'){if(!response.ok)return blocked();if(result.actor?.role!=='owner')throw Error('owner_scope');return new Response('<!doctype html><html lang="es" data-portal-base="'+PREFIX+'" data-portal-mode="owner"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SNAPTVNOW · Panel admin reseller</title><link rel="icon" href="'+PREFIX+'/assets/favicon.svg"><link rel="stylesheet" href="'+PREFIX+'/assets/panel.css"></head><body><div id="portal-root"></div><script src="'+PREFIX+'/assets/panel.js" defer></script></body></html>',{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});}
  const extra={...([401,403].includes(response.status)?{'Set-Cookie':cookie('',0)}:{}),...(response.status===429&&/^\d{1,3}$/.test(response.headers.get('Retry-After')||'')?{'Retry-After':response.headers.get('Retry-After')}:{})};return json(result,response.status,extra);
 }catch{return json({error:'owner_unavailable',message:'No se pudo comprobar el acceso. Vuelve al administrador principal.',final:false},503);}
};}
