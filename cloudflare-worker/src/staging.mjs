import backend from './index.js';
export {PlaybackSession,BackupRecovery,OperationsMonitor} from './index.js';

// Only this entry point serves test assets. Production keeps its existing entry.
export default {
 scheduled(){},
 async fetch(request,env,ctx){
  if(env.ENVIRONMENT!=='staging'||!env.STAGING_ASSETS)return new Response('Staging configuration required',{status:503});
  const url=new URL(request.url),sameOriginEnv={...env,WEB_ORIGINS:url.origin};
  let response;
  if(url.pathname==='/api'||url.pathname.startsWith('/api/')){
   url.pathname=url.pathname.slice(4)||'/';
   response=await backend.fetch(new Request(url,request),sameOriginEnv,ctx);
  }else if(request.method==='GET'||request.method==='HEAD'){
   // Static assets return a real 404; API/media paths then reach the backend.
   if(url.pathname==='/')url.pathname='/index.html';
   response=await env.STAGING_ASSETS.fetch(new Request(url,request));
   if(response.status===404)response=await backend.fetch(request,sameOriginEnv,ctx);
  }else response=await backend.fetch(request,sameOriginEnv,ctx);
  const headers=new Headers(response.headers);
  headers.set('X-SMN-Environment','staging');
  headers.set('X-Robots-Tag','noindex, nofollow');
  headers.set('Cache-Control','no-store');
  // A missing/stale frontend configuration must not fall back to production.
  headers.set('Content-Security-Policy',"connect-src 'self' https://cdn.jsdelivr.net; form-action 'self'; frame-ancestors 'none'; base-uri 'self'");
  return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
 }
};
