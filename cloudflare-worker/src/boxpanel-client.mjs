import {createBoxBuildVerifier} from './boxpanel-build-auth.mjs';
import {BOX_BUILD_REPO} from './boxpanel-delivery.mjs';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
export function createBoxClient({call,verify=createBoxBuildVerifier(),fetcher=fetch}){
 return async(req,env)=>{
  const u=new URL(req.url);if(u.hostname!=='api.snaptvnow.com'||!u.pathname.startsWith('/api/boxpanel/'))return null;
  const client=u.pathname.match(/^\/api\/boxpanel\/client\/([a-f0-9-]{36})\/(config|logo|update|ads\/([a-f0-9-]{36}))$/),build=u.pathname.match(/^\/api\/boxpanel\/builds\/(pending|claim|complete|fail)$/);
  if(!client&&!build)return null;
  try{
   if(client){
    if(req.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405,headers});
    const result=await call(env,{action:'boxpanel-client',appId:client[1],resource:client[3]?'ad':client[2],imageId:client[3]},{role:'app-client'}),data=await result.json();
    if(!result.ok)return Response.json(data,{status:result.status,headers});
    if(client[2]==='logo'||client[3]){const match=data.data?.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);if(!match)throw Error();return new Response(Uint8Array.from(atob(match[2]),x=>x.charCodeAt(0)),{headers:{...headers,'Content-Type':match[1]}});}
    return Response.json(data,{headers});
   }
   const action=build[1];
   if(action==='pending'){if(req.method!=='GET')return Response.json({error:'method_not_allowed'},{status:405,headers});return call(env,{action:'boxpanel-build-pending'},{role:'queue-public'});}
   if(req.method!=='POST'||req.headers.get('Origin')||!req.headers.get('Content-Type')?.startsWith('application/json'))return Response.json({error:'box_build_request'},{status:403,headers});
   const scope=await verify(req.headers.get('Authorization')?.replace(/^Bearer /,''));
   const text=await req.text();if(text.length>4096)return Response.json({error:'box_build_request'},{status:413,headers});const b=JSON.parse(text);
   if(action==='complete'){
    const match=b.url?.match(/^https:\/\/github\.com\/juancanta89-tech\/SnapTvNow\/releases\/download\/(boxpanel-[a-f0-9-]{36}-v[1-9]\d*)\/app-release\.apk$/);if(!match)throw Error();
    const r=await fetcher(`https://api.github.com/repos/${BOX_BUILD_REPO}/releases/tags/${match[1]}`,{headers:{Accept:'application/vnd.github+json','User-Agent':'BOXPANEL-release-verifier','X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error();const release=await r.json();
    const asset=release.assets?.find(a=>a.name==='app-release.apk'&&a.browser_download_url===b.url);
    if(release.draft||release.tag_name!==match[1]||release.target_commitish!==scope.sha||!asset||asset.size!==b.size||asset.digest!=='sha256:'+b.sha256)throw Error();
   }
   return call(env,{...b,action:'boxpanel-build-'+action},scope);
  }catch(e){return Response.json({error:e.status?'box_build_auth':'box_delivery_unavailable'},{status:e.status||503,headers});}
 };
}
