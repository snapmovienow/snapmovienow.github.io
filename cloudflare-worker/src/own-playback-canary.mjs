import {isAdult} from './content-permissions.mjs';
const ORIGIN='https://api.snaptvnow.com';
const numeric=value=>/^\d{1,16}$/.test(String(value));
const failure=status=>Object.assign(Error('canary_request_failed'),{status});
// The configured account is an explicitly authorised owner test account. Every
// run receives a new short-lived signed session; no customer session is reused.
export function ownPlaybackCanaryAdapter({env,storage,directory,ownSession,ticket,sessionCall,request}){
 const allowed=String(env.PLAYBACK_CANARY_USERNAME||'').toLowerCase();
 const send=async(session,op,body,signal)=>{
  const r=await request(new Request(ORIGIN+'/',{method:'POST',headers:{'Content-Type':'application/json','User-Agent':'SNAPTVNOW-Own-Canary/1'},body:JSON.stringify({op,access_token:session.token,...body}),signal}));
  try{if(!r.ok)throw failure(r.status);return await r.json()}finally{void r.body?.cancel().catch(()=>{})}
 };
 return {
  async authenticate(config,{signal}){
   if(!allowed||String(config.username||'').toLowerCase()!==allowed||env.ENVIRONMENT==='staging')throw failure(403);
   const r=await directory(env,'/canary-identity',{username:allowed});if(!r.ok)throw failure(r.status);const user=await r.json();
   if(signal.aborted)throw Error('canary_timeout');
   const session=await ownSession(env,{...user,expiresAt:Math.min(user.expiresAt||Infinity,Date.now()+60000)});
   // Set the owned object before any additional await so late aborts can clean
   // it even when a session-info request stalls.
   try{session.token=await ticket(env,session);await send(session,'session_info',{},signal);return session}
   catch(error){await Promise.allSettled([directory(env,'/release-session',{sid:session.sid}),sessionCall(env,session.sid,'/logout')]);throw error}
  },
  async select(session,config,{signal}){
   const key='canary-sample:'+config.type;let sample=await storage.get(key);
   if(!sample||sample.until<Date.now()){
    if(config.type==='series'){
     const rows=await send(session,'series',{},signal),row=Array.isArray(rows)?rows.find(row=>numeric(row.series_id)&&!isAdult(row)):null;if(!row)throw failure(404);
     const detail=await send(session,'series_info',{series_id:String(row.series_id),server:row._server||'ccf'},signal);
     const episode=Object.values(detail.episodes||{}).flatMap(rows=>Array.isArray(rows)?rows:[]).find(row=>numeric(row.id)&&!isAdult(row)&&!isAdult(row.info));if(!episode)throw failure(404);
     sample={type:'series',id:String(episode.id),series_id:String(row.series_id),ext:episode.container_extension||'mp4',server:row._server||'ccf'};
    }else{
     const type=config.type==='movie'?'movie':'live',rows=await send(session,type==='movie'?'vod':'live',{},signal),row=Array.isArray(rows)?rows.find(row=>numeric(row.stream_id)&&!isAdult(row)):null;if(!row)throw failure(404);
     sample={type,id:String(row.stream_id),ext:type==='live'?'m3u8':row.container_extension||'mp4',server:row._server||'ccf'};
    }
    sample.until=Date.now()+3600000;await storage.put(key,sample);
   }
   try{const prepared=await send(session,'stream_token',{...sample,request_id:crypto.randomUUID(),revision:1},signal);return {...prepared,type:sample.type}}
   catch(error){if(error.status===404)await storage.delete(key);throw error}
  },
  async open(session,target,{signal}){
   const url=new URL(target.url,ORIGIN);if(url.origin!==ORIGIN||url.pathname!=='/stream'||!url.searchParams.get('t'))throw failure(403);
   return request(new Request(url,{headers:{'User-Agent':'SNAPTVNOW-Own-Canary/1',...(target.type==='live'?{}:{Range:'bytes=0-65535'})},signal}));
  },
  async openResource(session,resource,{signal,target}){
   const url=new URL(resource,target.url);if(url.origin!==ORIGIN||url.pathname!=='/stream'||!url.searchParams.get('t'))throw failure(403);
   return request(new Request(url,{headers:{'User-Agent':'SNAPTVNOW-Own-Canary/1',Range:'bytes=0-65535'},signal}));
  },
  async release(session){await Promise.allSettled([directory(env,'/release-session',{sid:session.sid}),sessionCall(env,session.sid,'/logout')]);}
 };
}
