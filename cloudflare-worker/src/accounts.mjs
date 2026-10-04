// Private Durable Object routes. This module is never served as an HTTP endpoint.
const answer=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const normal=x=>String(x||'').trim().toLowerCase();
const validName=x=>/^[a-z0-9_.@-]{3,80}$/.test(x);
const publicUser=u=>({id:u.id,username:u.username,name:u.name,status:u.status,expiresAt:u.expiresAt,createdAt:u.createdAt,updatedAt:u.updatedAt});
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
  await store.delete(bucket);return answer({id:u.id,username:u.username,version:u.version,expiresAt:u.expiresAt});
 }
 if(p==='/check'){
  const u=await store.get(b.admin?'admin':'user:'+normal(b.username));return answer({ok:!!(u&&u.id===b.uid&&u.version===b.version&&(b.admin||alive(u)))},u&&u.id===b.uid&&u.version===b.version&&(b.admin||alive(u))?200:401);
 }
 if(p==='/has')return answer({exists:!!(await store.get('user:'+normal(b.username)))});
 if(p==='/users')return answer(Array.from((await store.list({prefix:'user:'})).values()).map(publicUser));
 if(p==='/save'){
  const username=normal(b.username);if(!validName(username))return answer({error:'invalid_username'},400);
  const old=await store.get('user:'+username);if(b.create&&old)return answer({error:'username_exists'},409);if(!b.create&&!old)return answer({error:'not_found'},404);
  if(!['active','suspended'].includes(b.status))return answer({error:'invalid_status'},400);
  let u={...old,id:old?.id||crypto.randomUUID(),username,name:String(b.name||'').slice(0,120),status:b.status,expiresAt:expiry(b.expiresAt),createdAt:old?.createdAt||Date.now(),updatedAt:Date.now(),version:(old?.version||0)+1};
  if(b.password)u=await withPassword(u,b.password);else if(!old)return answer({error:'password_required'},400);
  return store.transaction(async tx=>{const latest=await tx.get('user:'+username);if((latest?.version||0)!==(old?.version||0))return answer({error:'edit_conflict'},409);await tx.put('user:'+username,u);await removeLeases(tx,l=>l.uid===u.id);return answer(publicUser(u))});
 }
 if(p==='/delete')return store.transaction(async tx=>{const key='user:'+normal(b.username),u=await tx.get(key);if(!u)return answer({error:'not_found'},404);await tx.delete(key);await removeLeases(tx,l=>l.uid===u.id);return answer({ok:true})});
 if(p==='/provider-save'){await store.put('provider',{encrypted:b.encrypted,username:b.username,mode:b.mode||"single",maxConnections:Math.min(3,Math.max(1,Number(b.maxConnections)||3))});await store.delete('leases');await store.delete('pool');return answer({ok:true})}
 if(p==='/provider')return answer(await store.get('provider')||{});
 if(p==='/pool')return answer(await store.get('pool')||{lines:[],syncedAt:0});
 if(p==='/pool-sync')return store.transaction(async tx=>{const lines=b.lines;if(!Array.isArray(lines)||!lines.length)return answer({error:'panel_no_active_lines'},503);await tx.put('pool',{lines,syncedAt:Date.now()});await removeLeases(tx,l=>l.provider_id&&!lines.some(p=>p.id===l.provider_id));return answer({ok:true})});
 if(p==='/overview'){const provider=await store.get('provider'),pool=await store.get('pool'),leases=Object.values(await store.get('leases')||{}).filter(x=>x.until>Date.now());return answer({provider:provider?{username:provider.username,mode:provider.mode||'single',maxConnections:provider.mode==='panel'?(pool?.lines||[]).reduce((n,l)=>n+l.maxConnections,0):provider.maxConnections,activeAccounts:pool?.lines?.length||0}:null,connections:leases.length})}
 if(p==='/acquire')return store.transaction(async tx=>{
  const provider=await tx.get('provider');if(!provider)return answer({error:'provider_not_configured'},503);
  const u=await tx.get('user:'+normal(b.username));if(!alive(u)||u.id!==b.uid||u.version!==b.version)return answer({error:'account_inactive'},401);
  const leases=await tx.get('leases')||{};for(const [id,l]of Object.entries(leases))if(l.until<=Date.now()||l.sid===b.sid)delete leases[id];
  if(provider.mode==='panel'){
   const pool=await tx.get('pool');if(!pool||pool.syncedAt<Date.now()-60000)return answer({error:'panel_unavailable'},503);
   const candidates=pool.lines.filter(p=>!(b.exclude||[]).includes(p.id)).map(p=>({...p,occupied:p.external+Object.values(leases).filter(l=>l.provider_id===p.id).length})).filter(p=>p.occupied<p.maxConnections).sort((a,b)=>a.occupied/a.maxConnections-b.occupied/b.maxConnections);
   const selected=candidates[0];if(!selected)return answer({error:'ccf_capacity'},409);
   const id=crypto.randomUUID();leases[id]={sid:b.sid,uid:b.uid,username:b.username,version:b.version,provider_id:selected.id,until:Date.now()+90000};await tx.put('leases',leases);return answer({lease_id:id,provider_id:selected.id,encrypted:selected.encrypted,maxConnections:selected.maxConnections});
  }
  const max=Math.min(provider.maxConnections,Math.max(1,Number(b.upstreamMax)||3));
  if(Object.keys(leases).length>=max)return answer({error:'ccf_capacity',maxConnections:max},409);
  const id=crypto.randomUUID();leases[id]={sid:b.sid,uid:b.uid,username:b.username,version:b.version,until:Date.now()+90000};await tx.put('leases',leases);return answer({lease_id:id});
 });
 if(p==='/lease-check'||p==='/heartbeat'||p==='/release')return store.transaction(async tx=>{
  const leases=await tx.get('leases')||{},l=leases[b.lease_id];if(!l||l.sid!==b.sid)return answer({error:'playback_expired'},410);
  if(p==='/release'){delete leases[b.lease_id];await tx.put('leases',leases);return answer({ok:true})}
  const u=await tx.get('user:'+normal(l.username));if(l.until<=Date.now()||!alive(u)||u.id!==l.uid||u.version!==l.version){delete leases[b.lease_id];await tx.put('leases',leases);return answer({error:'playback_expired'},410)}
  if(p==='/heartbeat'){l.until=Date.now()+90000;await tx.put('leases',leases)}return answer({ok:true});
 });
 if(p==='/release-session'){await store.transaction(tx=>removeLeases(tx,l=>l.sid===b.sid));return answer({ok:true})}
 return answer({error:'not_found'},404);
 }catch(e){return answer({error:['password_length','invalid_expiry'].includes(e.message)?e.message:'account_operation_failed'},400)}
}
async function removeLeases(tx,predicate){const leases=await tx.get('leases')||{};for(const [id,l]of Object.entries(leases))if(predicate(l)||l.until<=Date.now())delete leases[id];await tx.put('leases',leases)}

