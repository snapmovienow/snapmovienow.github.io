import {isAdult} from './content-permissions.mjs';
const ORIGIN='https://api.snaptvnow.com';
const numeric=value=>/^\d{1,16}$/.test(String(value));
const failure=status=>Object.assign(Error('canary_request_failed'),{status});
const extensions=new Set(['ts','m3u8','mp4','mkv','webm','avi','mov','m4v']);
function cleanSample(value,type){
 if(!value||value.type!==type||!numeric(value.id)||typeof value.server!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(value.server))return null;
 return {type,id:String(value.id),server:value.server,ext:extensions.has(value.ext)?value.ext:type==='live'?'ts':'mp4',...(numeric(value.series_id)?{series_id:String(value.series_id)}:{})};
}
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
   session.canary=true; // Only this private adapter can mint this signed claim.
   // Set the owned object before any additional await so late aborts can clean
   // it even when a session-info request stalls.
   try{session.token=await ticket(env,session);await send(session,'session_info',{},signal);return session}
   catch(error){await Promise.allSettled([directory(env,'/release-session',{sid:session.sid}),sessionCall(env,session.sid,'/logout')]);throw error}
  },
  async select(session,config,{signal}){
   const key='canary-sample:'+config.type,cursorKey='canary-sample-cursor:'+config.type,queue=[],seen=new Set();
   // A recently successful real playback is a better sample than the first
   // catalog row. This is an advisory target only: normal stream_token still
   // enforces this test account's permissions, capacity and media checks.
   try{const response=await directory(env,'/canary-sample',{username:allowed,type:config.type});if(response.ok){const data=await response.json(),sample=cleanSample(data.sample,config.type);if(sample)queue.push(sample)}else void response.body?.cancel().catch(()=>{})}catch{}
   const cached=await storage.get(key);if(cached?.until>Date.now()){const sample=cleanSample(cached,config.type);if(sample)queue.push(sample)}
   let rows,cursor=await storage.get(cursorKey),lastError=failure(404);cursor=Number.isSafeInteger(cursor)&&cursor>=0?cursor:0;
   const nextCatalogSample=async()=>{
    if(rows===undefined){const data=await send(session,config.type==='series'?'series':config.type==='movie'?'vod':'live',{},signal);rows=Array.isArray(data)?data.filter(row=>numeric(config.type==='series'?row.series_id:row.stream_id)&&!isAdult(row)):[]}
    if(!rows.length)return null;
    const row=rows[cursor%rows.length];cursor=(cursor+1)%rows.length;await storage.put(cursorKey,cursor);
    if(config.type==='series'){
     const detail=await send(session,'series_info',{series_id:String(row.series_id),server:row._server||'ccf'},signal);
     const episode=Object.values(detail.episodes||{}).flatMap(rows=>Array.isArray(rows)?rows:[]).find(row=>numeric(row.id)&&!isAdult(row)&&!isAdult(row.info));if(!episode)return null;
     return cleanSample({type:'series',id:String(episode.id),series_id:String(row.series_id),ext:episode.container_extension||'mp4',server:row._server||'ccf'},config.type);
    }
    return cleanSample({type:config.type,id:String(row.stream_id),ext:config.type==='live'?'ts':row.container_extension||'mp4',server:row._server||'ccf'},config.type);
   };
   // Invalid samples rotate immediately, with no more than three preparation
   // requests. Cursor advancement survives a later stream failure and restart.
   for(let scanned=0,attempts=0;scanned<6&&attempts<3;scanned++){
    if(signal.aborted)throw Error('canary_timeout');let sample;
    try{sample=queue.length?queue.shift():await nextCatalogSample()}catch(error){lastError=error;if(![400,403,404].includes(error.status))throw error;continue}
    if(!sample)continue;const identity=sample.type+'|'+sample.server+'|'+sample.id+'|'+sample.ext;if(seen.has(identity))continue;seen.add(identity);attempts++;
    try{const prepared=await send(session,'stream_token',{...sample,request_id:crypto.randomUUID(),revision:attempts},signal);await storage.put(key,{...sample,until:Date.now()+3600000});return {...prepared,type:sample.type}}
    catch(error){lastError=error;await storage.delete(key);if(![400,403,404].includes(error.status))throw error}
   }
   throw lastError;
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
