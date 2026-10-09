const names={admin:'__Host-smn_admin',session:'__Host-smn_session'};
export function allowedOrigins(env){return new Set(String(env.WEB_ORIGINS||'https://snapmovienow.github.io').split(',').map(x=>x.trim()).filter(Boolean))}
export function canUseCookie(req,env){
 const origin=req.headers.get('Origin');if(!allowedOrigins(env).has(origin))return false;
 const source=new URL(origin),target=new URL(req.url);
 return source.protocol==='https:'&&target.protocol==='https:'&&source.hostname.endsWith('.snaptvnow.com')&&target.hostname==='api.snaptvnow.com';
}
export function cookieToken(req,env,kind){
 if(!canUseCookie(req,env))return '';
 const match=(req.headers.get('Cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(names[kind]+'='));
 return match?match.slice(names[kind].length+1):'';
}
export function withSessionCookie(response,req,env,kind,token,maxAge){
 if(!canUseCookie(req,env))return response;
 const headers=new Headers(response.headers);headers.append('Set-Cookie',`${names[kind]}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`);
 return new Response(response.body,{status:response.status,headers});
}
export function browserResponse(response,req,env){
 const origin=req.headers.get('Origin'),headers=new Headers(response.headers);
 if(allowedOrigins(env).has(origin)){
  headers.set('Access-Control-Allow-Origin',origin);headers.set('Vary','Origin');
  if(canUseCookie(req,env))headers.set('Access-Control-Allow-Credentials','true');
 }else if(origin){headers.delete('Access-Control-Allow-Origin');headers.delete('Access-Control-Allow-Credentials')}
 headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
