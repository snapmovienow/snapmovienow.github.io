const encoder=new TextEncoder();
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const base64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
const unbase64=text=>Uint8Array.from(atob(text.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-text.length%4)%4)),c=>c.charCodeAt(0));
export function base32(bytes){let bits=0,value=0,out='';for(const byte of bytes){value=(value<<8)|byte;bits+=8;while(bits>=5){bits-=5;out+=alphabet[(value>>>bits)&31]}}if(bits)out+=alphabet[(value<<(5-bits))&31];return out}
function decode32(text){let bits=0,value=0,bytes=[];for(const c of text.replace(/=+$/,'')){const n=alphabet.indexOf(c);if(n<0)throw Error('invalid_seed');value=(value<<5)|n;bits+=5;if(bits>=8){bits-=8;bytes.push((value>>>bits)&255)}}return new Uint8Array(bytes)}
export async function totp(seed,step,digits=6){
 const key=await crypto.subtle.importKey('raw',decode32(seed),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const counter=new Uint8Array(8);let n=BigInt(step);for(let i=7;i>=0;i--){counter[i]=Number(n&255n);n>>=8n}
 const hash=new Uint8Array(await crypto.subtle.sign('HMAC',key,counter));const off=hash[hash.length-1]&15;
 const code=((hash[off]&127)<<24)|(hash[off+1]<<16)|(hash[off+2]<<8)|hash[off+3];
 return String(code%10**digits).padStart(digits,'0');
}
export async function verifyTotp(seed,code,now=Date.now(),last=-1){
 if(!/^\d{6}$/.test(String(code||'')))return null;const step=Math.floor(now/30000);
 for(const n of [step,step-1,step+1])if(n>last&&await totp(seed,n)===code)return n;return null;
}
async function key(env){if(!env.TICKET_SECRET)throw Error('secret_missing');const digest=await crypto.subtle.digest('SHA-256',encoder.encode('SNAP-security-v1|'+env.TICKET_SECRET));return crypto.subtle.importKey('raw',digest,'AES-GCM',false,['encrypt','decrypt'])}
export async function seal(env,data){const iv=crypto.getRandomValues(new Uint8Array(12)),plain=encoder.encode(JSON.stringify(data)),cipher=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(env),plain));const out=new Uint8Array(iv.length+cipher.length);out.set(iv);out.set(cipher,iv.length);return base64(out)}
export async function unseal(env,text){try{if(typeof text!=='string'||text.length>4000000)return null;const bytes=unbase64(text);if(bytes.length<29)return null;return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12)},await key(env),bytes.slice(12))))}catch{return null}}
export async function hashSecret(text){return base64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(text))))}
function recoveryCodes(){return Array.from({length:8},()=>Array.from(crypto.getRandomValues(new Uint8Array(10)),x=>x.toString(16).padStart(2,'0')).join('').toUpperCase())}
export async function checkFactor(env,admin,code,now=Date.now()){
 if(!admin.mfa?.enabled)return {valid:true,admin};
 const secret=await unseal(env,admin.mfa.secret);if(!secret?.seed)return {valid:false};
 const step=await verifyTotp(secret.seed,String(code||''),now,admin.mfa.lastStep??-1);
 if(step!==null)return {valid:true,admin:{...admin,mfa:{...admin.mfa,lastStep:step}}};
 const recovery=await hashSecret(String(code||'').trim().toUpperCase()),index=(admin.mfa.recovery||[]).indexOf(recovery);
 if(index<0)return {valid:false};
 return {valid:true,admin:{...admin,mfa:{...admin.mfa,recovery:admin.mfa.recovery.filter((_,i)=>i!==index)}}};
}
export async function securityRoute(store,env,path,b,{passwordHash,audit}){
 const answer=(data,status=200)=>Response.json(data,{status});
 const admin=await store.get('admin');if(!admin)return answer({error:'admin_required'},401);
 if(path==='/security-status')return answer({mfaEnabled:admin.mfa?.enabled===true,recoveryRemaining:admin.mfa?.recovery?.length||0});
 // Reauthenticate before changing MFA/recovery or exporting private data.
 const attempt='security-attempt:'+String(b.actor||admin.id),now=Date.now();
 const allowed=await store.transaction(async tx=>{let a=await tx.get(attempt);if(!a||a.until<now)a={count:0,until:now+15*60000};a.count++;await tx.put(attempt,a);return a.count<=10});
 if(!allowed)return answer({error:'try_later'},429);
 if(typeof b.password!=='string'||await passwordHash(b.password.slice(0,256),admin.salt)!==admin.hash)return answer({error:'invalid_credentials'},401);
 if(path==='/mfa-begin'){
  if(admin.mfa?.enabled)return answer({error:'mfa_already_enabled'},409);
  const seed=base32(crypto.getRandomValues(new Uint8Array(20)));
  await store.put('mfa-pending',{actor:b.actor,secret:await seal(env,{seed}),until:now+10*60000});
  return answer({seed,expiresInSeconds:600,uri:'otpauth://totp/'+encodeURIComponent('SNAPTVNOW:'+admin.username)+'?'+new URLSearchParams({secret:seed,issuer:'SNAPTVNOW',algorithm:'SHA1',digits:'6',period:'30'})});
 }
 if(path==='/mfa-confirm')return store.transaction(async tx=>{
  const pending=await tx.get('mfa-pending'),current=await tx.get('admin');
  if(current.mfa?.enabled||!pending||pending.until<=now||pending.actor!==b.actor)return answer({error:'mfa_setup_expired'},409);
  const secret=await unseal(env,pending.secret),step=secret&&await verifyTotp(secret.seed,String(b.code||''),now);
  if(step===null||step===false||step===undefined)return answer({error:'mfa_invalid'},401);
  const codes=recoveryCodes();
  await tx.put('admin',{...current,version:current.version+1,mfa:{enabled:true,secret:pending.secret,lastStep:step,recovery:await Promise.all(codes.map(hashSecret))}});
  await tx.delete('mfa-pending');await tx.delete(attempt);await audit(tx,b.actor,'mfa_enabled');return answer({ok:true,recoveryCodes:codes,signInAgain:true});
 });
 if(path==='/mfa-recovery-renew')return store.transaction(async tx=>{
  const current=await tx.get('admin');
  if(!current?.mfa?.enabled)return answer({error:'mfa_not_enabled'},409);
  if(current.version!==admin.version||current.hash!==admin.hash)return answer({error:'admin_required'},401);
  // A leaked recovery code must never authorize replacing all recovery codes.
  if(!/^\d{6}$/.test(String(b.code||'')))return answer({error:'mfa_authenticator_required'},401);
  const secret=await unseal(env,current.mfa.secret),step=secret&&await verifyTotp(secret.seed,String(b.code),now,current.mfa.lastStep??-1);
  if(!Number.isInteger(step))return answer({error:'mfa_invalid'},401);
  const codes=recoveryCodes();
  await tx.put('admin',{...current,version:current.version+1,mfa:{...current.mfa,lastStep:step,recovery:await Promise.all(codes.map(hashSecret))}});
  await tx.delete(attempt);await audit(tx,b.actor,'mfa_recovery_renewed');
  return answer({ok:true,recoveryCodes:codes,signInAgain:true});
 });
 const factor=await store.transaction(async tx=>{const current=await tx.get('admin');const r=await checkFactor(env,current,b.code,now);if(r.valid&&current.mfa?.enabled)await tx.put('admin',r.admin);return r});
 if(!factor.valid)return answer({error:'mfa_invalid'},401);
 if(path==='/mfa-disable')return store.transaction(async tx=>{const current=await tx.get('admin');await tx.put('admin',{...current,mfa:null,version:current.version+1});await tx.delete(attempt);await audit(tx,b.actor,'mfa_disabled');return answer({ok:true,signInAgain:true})});
 await store.delete(attempt);return null; // verified backup operation continues in accountsFetch
}
export async function writeAudit(store,actor,action,target=null){
 const events=await store.get('security-audit')||[];
 events.push({at:Date.now(),actor:String(actor||'administrator').slice(0,80),action:String(action).slice(0,40),target:target?String(target).slice(0,100):null});
 await store.put('security-audit',events.slice(-300));
}
