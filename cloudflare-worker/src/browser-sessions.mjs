const names={admin:'__Host-smn_admin',session:'__Host-smn_session'};
export function allowedOrigins(env){return new Set(String(env.WEB_ORIGINS||'https://snapmovienow.github.io').split(',').map(x=>x.trim()).filter(Boolean))}
export function canUseCookie(req,env){
 const origin=req.headers.get('Origin');if(!allowedOrigins(env).has(origin))return false;
 const source=new URL(origin),target=new URL(req.url);
 if(env.ENVIRONMENT==='staging')return source.protocol==='https:'&&source.origin===target.origin;
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
  headers.set('Access-Control-Allow-Origin',origin);
  const vary=headers.get('Vary');if(!vary)headers.set('Vary','Origin');else if(vary!=='*'&&!vary.split(',').some(v=>v.trim().toLowerCase()==='origin'))headers.set('Vary',vary+', Origin');
  if(canUseCookie(req,env))headers.set('Access-Control-Allow-Credentials','true');
 }else if(origin){headers.delete('Access-Control-Allow-Origin');headers.delete('Access-Control-Allow-Credentials')}
 headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','no-referrer');
 // Do not upgrade legacy player URLs or impose document policies on media.
 // Preserve the stricter portal policies and every transport/cookie header.
 if(new URL(req.url).protocol==='https:'&&!headers.has('Strict-Transport-Security'))headers.set('Strict-Transport-Security','max-age=86400');
 if(!headers.has('Permissions-Policy'))headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=(), usb=()');
 if(/^application\/json(?:\s*;|$)/i.test(headers.get('Content-Type')||'')){
  if(!headers.has('Content-Security-Policy'))headers.set('Content-Security-Policy',"frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
  if(!headers.has('X-Frame-Options'))headers.set('X-Frame-Options','DENY');
 }
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
