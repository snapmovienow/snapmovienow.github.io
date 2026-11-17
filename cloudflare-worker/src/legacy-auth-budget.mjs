// Private, authentication-only budget. Never use this for catalog/media reads.
// HMAC keys avoid retaining the submitted username or trusted client address.
const BUCKET='legacy-auth-budget:',EXPIRY='legacy-auth-expiry:',MINUTE=60000,PAIR_WINDOW=15*MINUTE,PRUNE=20;
const enc=new TextEncoder(),pad=value=>String(value).padStart(16,'0');
const reply=(status,retry=0)=>Response.json(status===200?{ok:true}:{error:'try_later'},{status,headers:{'Cache-Control':'no-store',...(retry?{'Retry-After':String(retry)}:{})}});
async function identifiers(env,body){
 if(typeof env.TICKET_SECRET!=='string'||!env.TICKET_SECRET)throw Error('secret_missing');
 const key=await crypto.subtle.importKey('raw',enc.encode(env.TICKET_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sign=async value=>Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode(JSON.stringify(value)))),n=>n.toString(16).padStart(2,'0')).join('');
 const client=String(body.client||'unknown'),username=String(body.username||'').trim().toLowerCase();
 // The edge supplies client; neither value below is written to storage.
 return {ip:BUCKET+'ip:'+await sign(['SNAP-legacy-auth-ip-v1',client]),pair:BUCKET+'pair:'+await sign(['SNAP-legacy-auth-pair-v1',client,username])};
}
const expiryKey=(key,until)=>EXPIRY+pad(until)+':'+key.slice(BUCKET.length);
async function prune(tx,now){
 const rows=await tx.list({prefix:EXPIRY,end:EXPIRY+pad(now)+':~',limit:PRUNE});
 let count=0;
 for(const [index,value] of rows){
  if(count++>=PRUNE)break;
  // Validate even private indexes, including fixture/retained storage entries.
  if(!value||typeof value.key!=='string'||!value.key.startsWith(BUCKET)||!Number.isSafeInteger(value.until)||value.until>now)continue;
  const current=await tx.get(value.key);
  if(current?.until===value.until)await tx.delete(value.key);
  await tx.delete(index);
 }
}
async function increment(tx,key,limit,until,now){
 let row=await tx.get(key);
 if(!row||!Number.isSafeInteger(row.until)||row.until<=now){row={count:0,until};await tx.put(expiryKey(key,until),{key,until});}
 if(row.count>=limit)return Math.max(1,Math.ceil((row.until-now)/1000));
 row.count++;await tx.put(key,row);return 0;
}
export async function legacyAuthBudget(store,env,path,body,now=Date.now()){
 const keys=await identifiers(env,body);
 return store.transaction(async tx=>{
  await prune(tx,now);
  if(path==='/legacy-auth-success'){
   const row=await tx.get(keys.pair);
   if(row){await tx.delete(keys.pair);await tx.delete(expiryKey(keys.pair,row.until));}
   return reply(200);
  }
  const ipRetry=await increment(tx,keys.ip,120,(Math.floor(now/MINUTE)+1)*MINUTE,now);
  if(ipRetry)return reply(429,ipRetry);
  const pairRetry=await increment(tx,keys.pair,10,now+PAIR_WINDOW,now);
  return pairRetry?reply(429,pairRetry):reply(200);
 });
}
