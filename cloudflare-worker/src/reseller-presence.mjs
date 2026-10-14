// Signed, account-scoped playback telemetry. Reading it never logs in a customer.
const answer=(body,status=200)=>Response.json(body,{status});
const identifier=x=>typeof x==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(x);
export async function recordCustomerActivity(store,uid,now=Date.now()){
 const key='customer-activity:'+uid,old=await store.get(key);
 if(!old||old.lastConnectionAt<now-30000)await store.put(key,{lastConnectionAt:now});
}
export async function resellerPresence(store,leases,b,now=Date.now()){
 if(!identifier(b.accountId)||!Array.isArray(b.lines)||b.lines.length>100||b.lines.some(x=>!identifier(x?.lineId)||typeof x.username!=='string'||!/^[a-z0-9_.@-]{3,80}$/.test(x.username))||new Set(b.lines.map(x=>x.lineId)).size!==b.lines.length)return answer({error:'bridge_input'},400);
 const users=[];
 for(const x of b.lines){const u=await store.get('user:'+x.username);if(!u||u.resellerBridge?.accountId!==b.accountId||u.resellerBridge.lineId!==x.lineId)return answer({error:'bridge_presence_scope'},403);users.push(u);}
 const summaries=await leases.customerSummaries(users.map(u=>u.id),now),lines=[];
 for(let i=0;i<users.length;i++){
  const u=users[i],alive=u.status==='active'&&(!u.expiresAt||u.expiresAt>now),current=(summaries.get(u.id)||[]).filter(x=>x.version===u.version),used=alive?current.reduce((n,x)=>n+x.count,0):0,activity=await store.get('customer-activity:'+u.id),last=activity?.lastConnectionAt||0;
  lines.push({lineId:b.lines[i].lineId,username:u.username,online:used>0,connectionsUsed:used,lastConnectionAt:Number.isSafeInteger(last)&&last>0?last:null});
 }
 return answer({ok:true,checkedAt:now,lines});
}

// Dashboard totals span every owned customer, independently of table pages or
// search filters. Only current, unexpired playback leases count as online.
export async function resellerPlaybackSummary(store,leases,b,now=Date.now()){
 if(!identifier(b.accountId))return answer({error:'bridge_input'},400);
 let startAfter;const users=new Map();
 for(;;){
  const page=await store.list({prefix:'user:',limit:100,...(startAfter?{startAfter}:{})});
  for(const [key,u]of page){startAfter=key;if(u?.resellerBridge?.accountId===b.accountId&&identifier(u.resellerBridge.lineId)&&identifier(u.id)&&u.status==='active'&&(!u.expiresAt||u.expiresAt>now))users.set(u.id,{id:u.id,version:u.version});}
  if(page.size<100)break;
 }
 const owned=[...users.values()];let connectionsUsed=0,linesOnline=0;
 for(let at=0;at<owned.length;at+=100){
  const batch=owned.slice(at,at+100),summaries=await leases.customerSummaries(batch.map(u=>u.id),now);
  for(const u of batch){const used=(summaries.get(u.id)||[]).filter(row=>row.version===u.version).reduce((n,row)=>n+row.count,0);connectionsUsed+=used;if(used)linesOnline++;}
 }
 return answer({ok:true,checkedAt:now,connectionsUsed,linesOnline});
}
