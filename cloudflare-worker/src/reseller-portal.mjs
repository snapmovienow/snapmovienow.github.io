import {PORTAL_SCRIPT,PORTAL_CSS} from './reseller-panel-assets.mjs';
export const PORTAL_HOST='juanito.resellers.snaptvnow.com';
export const PORTAL_ACCOUNT='be5f1fc0-d772-4683-9c6f-2bcdee5a4e70';
export const PORTAL_SOURCE='https://snaptvnow-resellers.juancanta89.chatgpt.site';
const PREFIX='/panel/juanito',COOKIE='__Host-SNAP_Reseller';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin'};
const csp="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";
const json=(body,status=200,extra={})=>Response.json(body,{status,headers:{...headers,...extra}});
const cookie=(token,maxAge=28800)=>COOKIE+'='+token+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age='+maxAge;
function tokenOf(req){const values=(req.headers.get('Cookie')||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(COOKIE+'='));if(values.length!==1)return null;const value=values[0].slice(COOKIE.length+1);return /^[a-f0-9]{64}$/.test(value)?value:null;}
export function matchesResellerPortal(req){const u=new URL(req.url);return u.hostname===PORTAL_HOST||u.pathname===PREFIX||u.pathname.startsWith(PREFIX+'/');}
async function input(req){const length=Number(req.headers.get('content-length')||0);if(length>24000)throw Error('input_limit');const reader=req.body?.getReader();if(!reader)return {};let size=0,parts=[];const deadline=AbortSignal.timeout(5000);try{while(true){deadline.throwIfAborted();const next=await new Promise((resolve,reject)=>{const abort=()=>{void reader.cancel();reject(Error('input_timeout'));};deadline.addEventListener('abort',abort,{once:true});reader.read().then(resolve,reject).finally(()=>deadline.removeEventListener('abort',abort));});if(next.done)break;size+=next.value.byteLength;if(size>24000){await reader.cancel();throw Error('input_limit');}parts.push(next.value);}const bytes=new Uint8Array(size);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}const body=JSON.parse(new TextDecoder().decode(bytes));if(!body||typeof body!=='object'||Array.isArray(body))throw Error('input_invalid');return body;}finally{reader.releaseLock();}}
export function createResellerPortal({getConfig,fetcher=fetch}){return async(req,env)=>{
 const u=new URL(req.url),base=u.hostname===PORTAL_HOST?'':PREFIX,path=u.pathname.slice(base.length)||'/';
 if(u.protocol!=='https:')return new Response(null,{status:301,headers:{Location:'https://'+u.host+u.pathname+u.search}});
 if(req.method==='GET'&&(path==='/assets/panel.js'||path==='/assets/panel.css'))return new Response(path.endsWith('.js')?PORTAL_SCRIPT:PORTAL_CSS,{headers:{...headers,'Cache-Control':'public, max-age=60','Content-Type':path.endsWith('.js')?'text/javascript; charset=utf-8':'text/css; charset=utf-8'}});
 if(req.method==='GET'&&path==='/')return new Response('<!doctype html><html lang="es" data-portal-base="'+base+'"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SNAPTVNOW · Panel de Juanito</title><link rel="stylesheet" href="'+base+'/assets/panel.css"></head><body><div id="portal-root"></div><script src="'+base+'/assets/panel.js" defer></script></body></html>',{headers:{...headers,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':csp}});
 if(!['/api/panel','/api/portal/login','/api/portal/logout'].includes(path))return json({error:'portal_route',message:'Este acceso pertenece al panel de Juanito.'},404);
 if(!['GET','POST'].includes(req.method)||((path!=='/api/panel')&&req.method!=='POST'))return json({error:'portal_method'},405);
 if(req.method==='POST'&&(req.headers.get('Origin')!==u.origin||req.headers.get('Sec-Fetch-Site')==='cross-site'))return json({error:'portal_origin',message:'Abre el formulario desde este panel.'},403);
 try{
  const cfg=await getConfig(env);if(cfg?.accountId!==PORTAL_ACCOUNT||cfg.sourceOrigin!==PORTAL_SOURCE||!/^\w{64}$/.test(cfg.gatewaySecret)||typeof cfg.siteToken!=='string')throw Error('config_unavailable');
  const session=tokenOf(req);let body;
  if(path==='/api/portal/login'){const value=await input(req);body={action:'login',password:value.password,client:req.headers.get('CF-Connecting-IP')||'unknown'};}
  else if(path==='/api/portal/logout')body={action:'logout',token:session};
  else if(!session)return json({error:'portal_session',message:'Inicia sesión en tu panel.'},401);
  else if(req.method==='GET'){const allowed=new Set(['lineId','requestId','view','q','filter','page','pageSize','version','sort','direction','paid','lineType','slug']);if(u.search.length>4000||[...u.searchParams.keys()].some(k=>!allowed.has(k)))return json({error:'portal_query'},400);body={action:'read',token:session,query:Object.fromEntries(u.searchParams)};}
  else body={action:'write',token:session,input:await input(req)};
  const response=await fetcher(PORTAL_SOURCE+'/api/portal',{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json','OAI-Sites-Authorization':'Bearer '+cfg.siteToken,'X-SNAP-Portal-Gateway':cfg.gatewaySecret},body:JSON.stringify({...body,accountId:PORTAL_ACCOUNT}),signal:AbortSignal.timeout(16000)});
  const raw=await response.text();if(raw.length>1048576||response.status>=300&&response.status<400)throw Error('gateway_reply');const result=JSON.parse(raw);
  if(path==='/api/portal/login'&&response.ok){if(result.ok!==true||result.accountId!==PORTAL_ACCOUNT||!/^[a-f0-9]{64}$/.test(result.token))throw Error('login_reply');return json({ok:true},200,{'Set-Cookie':cookie(result.token)});}
  if(path==='/api/portal/logout')return json({ok:true},200,{'Set-Cookie':cookie('',0)});
  if(result?.actor){if(result.actor.id!==PORTAL_ACCOUNT||result.actor.role!=='reseller'||result.overview!==false||result.accounts?.length)throw Error('gateway_scope');result.portalBase=base;result.target.panelAccess={url:u.origin+base,active:true};}
  return json(result,response.status,[401,403].includes(response.status)&&['portal_session','portal_suspended'].includes(result?.error)?{'Set-Cookie':cookie('',0)}:{});
 }catch{return json({error:'portal_unavailable',message:'No se pudo comprobar el resultado. Conserva la operación pendiente.',final:false},503);}
};}
