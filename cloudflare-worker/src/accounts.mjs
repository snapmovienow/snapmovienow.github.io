// Private Durable Object routes. This module is never served as an HTTP endpoint.
import {catalogCacheRoute} from './catalog-cache.mjs';
const answer=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const normal=x=>String(x||'').trim().toLowerCase();
const validName=x=>/^[a-z0-9_.@-]{3,80}$/.test(x);
const publicUser=u=>({id:u.id,username:u.username,name:u.name,status:u.status,expiresAt:u.expiresAt,createdAt:u.createdAt,updatedAt:u.updatedAt,permissions:u.permissions||{movies:true,series:true,tv:true}});
const alive=u=>u&&u.status==='active'&&(!u.expiresAt||u.expiresAt>Date.now());
const enc=new TextEncoder();
async function digest(x){return new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(String(x))))}
async function same(a,b){const x=await digest(a),y=await digest(b);let n=0;for(let i=0;i<x.length;i++)n|=x[i]^y[i];return n===0}
export async function passwordHash(password,salt){const key=await crypto.subtle.importKey('raw',enc.encode(password),'PBKDF2',false,['deriveBits']);const bits=await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:enc.encode(salt),iterations:100000},key,256);return Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('')}
async function withPassword(u,password){if(typeof password!=='string'||password.length<12||password.length>256)throw Error('password_length');const salt=crypto.randomUUID();return {...u,salt,hash:await passwordHash(password,salt)}}
function expiry(value){if(value===null||value===''||value===undefined)return null;const n=Number(value);if(!Number.isFinite(n)||n<=Date.now())throw Error('invalid_expiry');return n}
export async function accountsFetch(state,env,req){
 const p=new URL(req.url).pathname.replace('/accounts','');const b=await req.json();const store=state.storage;
 try{
 if(p==='/xtream-cache-get'||p==='/xtream-cache-put')return await catalogCacheRoute(store,p,b);
 if(p==='/xtream-config')return answer(await store.get('xtream-config')||{enabled:true,version:1});
 if(p==='/xtream-save')return store.transaction(async tx=>{if(typeof b.enabled!=='boolean')return answer({error:'invalid_setting'},400);const old=await tx.get('xtream-config')||{enabled:true,version:1};const next={enabled:b.enabled,version:old.version+(old.enabled===b.enabled?0:1)};await tx.put('xtream-config',next);if(!next.enabled)await removeLeases(tx,l=>l.xtream);return answer(next)});
 if(p==='/xtream-register')return registerXtream(store,b.entries);
 if(p==='/xtream-resolve')return answer(/^\d+$/.test(String(b.id))?await store.get('xtream-id:'+b.id)||null:null);
 if(p==='/xtream-count')return answer({connections:Object.values(await store.get('leases')||{}).filter(l=>l.uid===b.uid&&l.until>Date.now()).length});
 if(p==='/xtream-login'){
  const username=normal(b.username),u=await store.get('user:'+username),key='xtream-auth:'+username+':'+b.authKey;
  const cached=await store.get(key);if(cached&&cached.until>Date.now()&&alive(u)&&u.id===cached.uid&&u.version===cached.version)return answer({...publicUser(u),version:u.version});
  const r=await accountsFetch(state,env,new Request('https://private/accounts/login',{method:'POST',body:JSON.stringify(b)}));if(!r.ok)return r;
  const user=await r.json(),current=await store.get('user:'+username);if(!alive(current)||current.version!==user.version)return answer({error:'invalid_credentials'},401);await store.put(key,{uid:user.id,version:user.version,until:Date.now()+15*60000});return answer({...publicUser(current),version:user.version});
 }
 if(p==='/status')return answer({configured:!!(await store.get('admin')),setupAvailable:!!env.ADMIN_SETUP_SECRET});
 if(p==='/setup'){
  if(!env.ADMIN_SETUP_SECRET||env.ADMIN_SETUP_SECRET.length<32||!await same(b.setupSecret,env.ADMIN_SETUP_SECRET))return answer({error:'setup_denied'},403);
  const username=normal(b.username);if(!validName(username))return answer({error:'invalid_username'},400);
  const admin=await withPassword({id:crypto.randomUUID(),username,version:1},b.password);
  return store.transaction(async tx=>{if(await tx.get('admin'))return answer({error:'already_configured'},409);await tx.put('admin',admin);return answer({ok:true})});
 }
 if(p==='/admin-login'||p==='/login'){
  // Bound failed attempts per username and client IP; no password is logged or returned.
  const username=normal(b.username),bucket='attempt:'+String(b.client||'')+':'+username.slice(0,80),now=Date.now();
  const allowed=await store.transaction(async tx=>{let a=await tx.get(bucket);if(!a||a.until<now)a={count:0,until:now+15*60000};a.count++;await tx.put(bucket,a);return a.count<=10});
  if(!allowed)return answer({error:'try_later'},429);
  const u=await store.get(p==='/admin-login'?'admin':'user:'+username);
  const hash=await passwordHash(String(b.password||'').slice(0,256),u?.salt||'missing-account-salt');
  if(!u||!await same(hash,u.hash)||(p==='/login'&&!alive(u)))return answer({error:'invalid_credentials'},401);
  await store.delete(bucket);return answer({id:u.id,username:u.username,version:u.version,expiresAt:u.expiresAt,permissions:u.permissions||{movies:true,series:true,tv:true}});
 }
 if(p==='/check'){
  if(b.xtream){const config=await store.get('xtream-config')||{enabled:true,version:1};if(!config.enabled||config.version!==b.xtreamVersion)return answer({ok:false},401)}
  const u=await store.get(b.admin?'admin':'user:'+normal(b.username));return answer({ok:!!(u&&u.id===b.uid&&u.version===b.version&&(b.admin||alive(u)))},u&&u.id===b.uid&&u.version===b.version&&(b.admin||alive(u))?200:401);
 }
 if(p==='/has')return answer({exists:!!(await store.get('user:'+normal(b.username)))});
 if(p==='/users')return answer(Array.from((await store.list({prefix:'user:'})).values()).map(publicUser));
 if(p==='/save'){
  const username=normal(b.username);if(!validName(username))return answer({error:'invalid_username'},400);
  const old=await store.get('user:'+username);if(b.create&&old)return answer({error:'username_exists'},409);if(!b.create&&!old)return answer({error:'not_found'},404);
  if(!['active','suspended'].includes(b.status))return answer({error:'invalid_status'},400);
  const permissions=b.permissions===undefined?(old?.permissions||{movies:true,series:true,tv:true}):{movies:b.permissions?.movies===true,series:b.permissions?.series===true,tv:b.permissions?.tv===true};
  let u={...old,permissions,id:old?.id||crypto.randomUUID(),username,name:String(b.name||'').slice(0,120),status:b.status,expiresAt:expiry(b.expiresAt),createdAt:old?.createdAt||Date.now(),updatedAt:Date.now(),version:(old?.version||0)+1};
  if(b.password)u=await withPassword(u,b.password);else if(!old)return answer({error:'password_required'},400);
  return store.transaction(async tx=>{const latest=await tx.get('user:'+username);if((latest?.version||0)!==(old?.version||0))return answer({error:'edit_conflict'},409);await tx.put('user:'+username,u);await removeLeases(tx,l=>l.uid===u.id);return answer(publicUser(u))});
 }
 if(p==='/delete')return store.transaction(async tx=>{const key='user:'+normal(b.username),u=await tx.get(key);if(!u)return answer({error:'not_found'},404);await tx.delete(key);await removeLeases(tx,l=>l.uid===u.id);return answer({ok:true})});
 if(p==='/provider-save'){await store.put('provider',{encrypted:b.encrypted,username:b.username,mode:b.mode||"single",maxConnections:Math.min(3,Math.max(1,Number(b.maxConnections)||3))});await store.delete('leases');await store.delete('pool');return answer({ok:true})}
 if(p==='/providers'){const list=await store.get('providers');const old=await store.get('provider');return answer(list|| (old?[{...old,source:old.mode==='panel'?'panel:'+normal(old.username):'single:'+normal(old.username)}]:[]))}
 if(p==='/provider-add')return store.transaction(async tx=>{
  const old=await tx.get('provider');let providers=await tx.get('providers');
  if(!providers){providers=old?[{...old,source:old.mode==='panel'?'panel:'+normal(old.username):'single:'+normal(old.username)}]:[];const pool=await tx.get('pool');if(old)await tx.put('source-pools',{[providers[0].source]:pool||{lines:[{id:'single:'+normal(old.username),external:0,maxConnections:old.maxConnections,encrypted:old.encrypted}],syncedAt:0}})}
  const source=b.source;const previous=providers.find(x=>x.source===source);providers=providers.filter(x=>x.source!==source);providers.push({source,encrypted:b.encrypted,username:b.username,name:b.name||b.username,url:b.url,origin:b.origin,mode:b.mode,maxConnections:b.maxConnections||3});
  const pools=await tx.get('source-pools')||{};pools[source]={lines:b.lines,syncedAt:Date.now()};await tx.put('source-pools',pools);await tx.put('providers',providers);await tx.put('provider',{...providers[0],mode:'panel'});await mergePools(tx,pools);return answer({ok:true,updated:!!previous,sourceCount:providers.length});
 });
 if(p==='/provider-remove')return store.transaction(async tx=>{const providers=await tx.get('providers')||[],next=providers.filter(x=>x.source!==b.source);if(next.length===providers.length)return answer({error:'not_found'},404);const pools=await tx.get('source-pools')||{};delete pools[b.source];await tx.put('providers',next);await tx.put('source-pools',pools);if(next.length)await tx.put('provider',{...next[0],mode:'panel'});else await tx.delete('provider');await mergePools(tx,pools);return answer({ok:true})});
 if(p==='/permissions'){const user=await store.get('user:'+normal(b.username));return answer(user?.permissions||{movies:true,series:true,tv:true})}
 if(p==='/provider')return answer(await store.get('provider')||{});
 if(p==='/pool')return answer(await store.get('pool')||{lines:[],syncedAt:0});
 if(p==='/pool-sync')return store.transaction(async tx=>{const lines=b.lines;if(b.source){const pools=await tx.get('source-pools')||{};if(b.retain){const old=pools[b.source];pools[b.source]=old&&old.syncedAt>Date.now()-12*3600000?{...old,attemptedAt:Date.now()}:{lines:[],syncedAt:Date.now()}}else{if(!Array.isArray(lines))return answer({error:'panel_no_active_lines'},503);pools[b.source]={lines,syncedAt:Date.now()}}await tx.put('source-pools',pools);await mergePools(tx,pools);return answer({ok:true})}if(!Array.isArray(lines))return answer({error:'panel_no_active_lines'},503);await tx.put('pool',{lines,syncedAt:Date.now()});await removeLeases(tx,l=>l.provider_id&&!lines.some(p=>p.id===l.provider_id));return answer({ok:true})});
 if(p==='/overview'){const provider=await store.get('provider'),pool=await store.get('pool'),leases=Object.values(await store.get('leases')||{}).filter(x=>x.until>Date.now());return answer({provider:provider?{username:provider.username,mode:provider.mode||'single',maxConnections:provider.mode==='panel'?(pool?.lines||[]).reduce((n,l)=>n+l.maxConnections,0):provider.maxConnections,activeAccounts:pool?.lines?.length||0,sourceCount:(await store.get('providers'))?.length||1}:null,connections:leases.length})}
 if(p==='/playback-begin'||p==='/playback-cancel')return store.transaction(async tx=>{
  if(typeof b.request_id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(b.request_id))return answer({error:'invalid_playback_request'},400);
  const key='playback:'+b.sid,old=await tx.get(key)||{revision:0,cancelled:{}};
  for(const [id,until]of Object.entries(old.cancelled||{}))if(until<=Date.now())delete old.cancelled[id];
  old.cancelled??={};
  if(p==='/playback-cancel'){
   const previous=old.request_id,supersedes=Number.isSafeInteger(b.revision)&&b.revision>old.revision;
   old.cancelled[b.request_id]=Date.now()+120000;
   if(old.request_id===b.request_id)old.request_id=null;
   if(supersedes){old.revision=b.revision;old.request_id=null}
   await tx.put(key,old);await removeLeases(tx,l=>l.sid===b.sid&&(l.request_id===b.request_id||(supersedes&&l.request_id===previous)));return answer({ok:true});
  }
  if(old.cancelled[b.request_id]||(Number.isSafeInteger(b.revision)&&b.revision<=old.revision&&old.request_id!==b.request_id))return answer({error:'playback_superseded'},410);
  old.request_id=b.request_id;old.revision=Number.isSafeInteger(b.revision)?b.revision:old.revision+1;
  await tx.put(key,old);return answer({ok:true});
 });
 if(p==='/acquire')return store.transaction(async tx=>{
  if(b.request_id&&(await tx.get('playback:'+b.sid))?.request_id!==b.request_id)return answer({error:'playback_superseded'},410);
  const provider=await tx.get('provider');if(!provider)return answer({error:'provider_not_configured'},503);
  const u=await tx.get('user:'+normal(b.username));if(!alive(u)||u.id!==b.uid||u.version!==b.version)return answer({error:'account_inactive'},401);
  const leases=await tx.get('leases')||{};for(const [id,l]of Object.entries(leases))if(l.until<=Date.now())delete leases[id];
  if(b.request_id){const previous=Object.entries(leases).find(([,l])=>l.sid===b.sid&&l.mediaKey===b.mediaKey&&!(b.exclude||[]).includes(l.provider_id));if(previous){const [id,l]=previous;l.until=Date.now()+90000;l.request_id=b.request_id;await tx.put('leases',leases);const pool=await tx.get('pool'),line=pool?.lines?.find(x=>x.id===l.provider_id);return answer({lease_id:id,provider_id:l.provider_id,encrypted:line?.encrypted,maxConnections:line?.maxConnections,reused:true,request_id:b.request_id})}}
  for(const [id,l]of Object.entries(leases))if(l.sid===b.sid)delete leases[id];
  await tx.put('leases',leases);
  if(b.xtream&&Object.values(leases).filter(l=>l.uid===b.uid).length>=3)return answer({error:'user_connection_limit'},409);
  const extra={...(b.xtream?{xtream:true}:{}),...(b.request_id?{mediaKey:b.mediaKey,request_id:b.request_id}:{})};
  if(provider.mode==='panel'){
   // Both clients use the bounded inventory snapshot while it refreshes in
   // the background. New allocations still validate the provider account.
   const pool=await tx.get('pool');if(!pool||pool.syncedAt<Date.now()-12*3600000)return answer({error:'panel_unavailable'},503);
   const candidates=pool.lines.filter(p=>(!b.server||(p.server||'ccf')===b.server)&&!(b.exclude||[]).includes(p.id)).map(p=>({...p,occupied:p.external+Object.values(leases).filter(l=>l.provider_id===p.id).length})).filter(p=>p.occupied<p.maxConnections).sort((a,b)=>a.occupied/a.maxConnections-b.occupied/b.maxConnections);
   const selected=candidates[0];if(!selected)return answer({error:'ccf_capacity'},409);
   const id=crypto.randomUUID();leases[id]={sid:b.sid,uid:b.uid,username:b.username,version:b.version,provider_id:selected.id,until:Date.now()+90000,...extra};await tx.put('leases',leases);return answer({lease_id:id,provider_id:selected.id,encrypted:selected.encrypted,maxConnections:selected.maxConnections});
  }
  const max=Math.min(provider.maxConnections,Math.max(1,Number(b.upstreamMax)||3));
  if(Math.max(Object.keys(leases).length,Number(b.upstreamExternal)||0)>=max)return answer({error:'ccf_capacity',maxConnections:max},409);
  const id=crypto.randomUUID();leases[id]={sid:b.sid,uid:b.uid,username:b.username,version:b.version,until:Date.now()+90000,...extra};await tx.put('leases',leases);return answer({lease_id:id});
 });
 if(p==='/lease-check'||p==='/heartbeat'||p==='/release')return store.transaction(async tx=>{
  const leases=await tx.get('leases')||{},l=leases[b.lease_id];if(!l||l.sid!==b.sid)return answer({error:'playback_expired'},410);
  if(p==='/release'){if(b.request_id&&l.request_id!==b.request_id)return answer({ok:true,reused:true});delete leases[b.lease_id];await tx.put('leases',leases);return answer({ok:true})}
  if(b.request_id&&l.request_id!==b.request_id)return answer({error:'playback_superseded'},410);
  if(b.request_id&&(await tx.get('playback:'+b.sid))?.request_id!==b.request_id)return answer({error:'playback_superseded'},410);
  const u=await tx.get('user:'+normal(l.username));if(l.until<=Date.now()||!alive(u)||u.id!==l.uid||u.version!==l.version){delete leases[b.lease_id];await tx.put('leases',leases);return answer({error:'playback_expired'},410)}
  if(p==='/heartbeat'){l.until=Date.now()+90000;await tx.put('leases',leases)}return answer({ok:true});
 });
 if(p==='/release-session'){await store.transaction(async tx=>{await removeLeases(tx,l=>l.sid===b.sid);await tx.delete('playback:'+b.sid)});return answer({ok:true})}
 return answer({error:'not_found'},404);
 }catch(e){return answer({error:['password_length','invalid_expiry'].includes(e.message)?e.message:'account_operation_failed'},400)}
}
async function removeLeases(tx,predicate){const leases=await tx.get('leases')||{};for(const [id,l]of Object.entries(leases))if(predicate(l)||l.until<=Date.now())delete leases[id];await tx.put('leases',leases)}


async function mergePools(tx,pools){
 const unique=new Map(),keys=new Map();for(const pool of Object.values(pools))for(const line of pool.lines){const id=keys.get(line.key)||line.id,previous=unique.get(id);const next=previous?{...line,id:previous.id,maxConnections:Math.min(previous.maxConnections,line.maxConnections),external:Math.max(previous.external,line.external)}:line;unique.set(id,next);if(line.key)keys.set(line.key,id)}
 const lines=[...unique.values()];await tx.put('pool',{lines,syncedAt:Object.keys(pools).length?Math.min(...Object.values(pools).map(p=>p.attemptedAt||p.syncedAt)):Date.now()});await removeLeases(tx,l=>l.provider_id&&!unique.has(l.provider_id));
}

async function registerXtream(store,entries){
 if(!Array.isArray(entries)||entries.length>50000)return answer({error:'invalid_catalog'},400);
 const kinds=new Set(['live','movie','series_list','episode','live_category','movie_category','series_category']);
 if(entries.some(e=>!kinds.has(e.kind)||typeof e.server!=='string'||e.server.length>100||!/^\d{1,16}$/.test(String(e.upstreamId))))return answer({error:'invalid_catalog'},400);
 return store.transaction(async tx=>{
  let next=await tx.get('xtream-next-id')||1;const result=[];
  for(let offset=0;offset<entries.length;offset+=60){const chunk=entries.slice(offset,offset+60),keys=chunk.map(e=>'xtream-map:'+e.kind+':'+e.server+':'+e.upstreamId),existing=await tx.get(keys),writes={};
   for(let i=0;i<chunk.length;i++){const key=keys[i],e=chunk[i];let id=existing.get(key)||writes[key];if(!id){if(next>2147483647)throw Error('catalog_id_limit');id=next++;writes[key]=id;writes['xtream-id:'+id]={...e,id};}result.push(id)}
   if(Object.keys(writes).length)await tx.put(writes);
  }
  await tx.put('xtream-next-id',next);return answer(result);
 });
}
