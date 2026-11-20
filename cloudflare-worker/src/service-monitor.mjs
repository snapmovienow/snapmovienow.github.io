// Account-scoped operational history. Never stores credentials, IPs or titles.
import {cleanPlaybackMetric} from './operations.mjs';
export const MONITOR_BINS=[100,250,500,1000,2000,3000,4000,5000,8000,12000,20000,60000,300000];
const STEP=300000,HOUR=3600000,RETENTION=7*86400000;
const historyPrefixes=['service-monitor-counts:','service-monitor-quality:'];
const knownScopesKey='service-monitor-retention-scopes';
const idleSinceKey='service-monitor-idle-since';
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(v);
const media=key=>{const [type,server]=String(key||'').split('|');return ['live','movie','series'].includes(type)&&identifier(server)?{type,server}:null;};
const empty=()=>({reports:0,attempts:0,failedStarts:0,errors:0,watchMs:0,stallMs:0,bytes:0,bytesMeasured:0,histogram:MONITOR_BINS.map(()=>0)});
const add=(a,b)=>{for(const k of ['reports','attempts','failedStarts','errors','watchMs','stallMs','bytes','bytesMeasured'])a[k]+=b[k]||0;b.histogram?.forEach((n,i)=>a.histogram[i]+=n);return a;};
export function monitorPercentile(histogram,p=.95){const samples=histogram.reduce((a,b)=>a+b,0);if(!samples)return null;let count=0;return MONITOR_BINS[histogram.findIndex(n=>(count+=n)>=Math.ceil(samples*p))];}
const matches=(row,body)=>(body.content==='all'||row.type===body.content)&&(body.provider==='all'||row.server===body.provider);
const keys=(prefix,account)=>prefix+account+':';
async function rememberHistoryScopes(store,accounts){
 if(!accounts.length)return;
 const scopes=await store.get(knownScopesKey);
 if(!Array.isArray(scopes))return; // The first full reconciliation discovers existing records.
 const added=accounts.filter(account=>!scopes.includes(account));
 if(added.length)await store.put(knownScopesKey,[...scopes,...added]);
}
export async function recordServiceMetric(store,lease,user,metric,now=Date.now()){
 const account=user?.resellerBridge?.accountId,info=media(lease.mediaKey),m=cleanPlaybackMetric({metric});
 if(!identifier(account)||!info||!m||lease.monitorReport===m.reportId||lease.monitorReportedAt>now-15000)return false;
 const hour=Math.floor(now/HOUR),bucket=Math.floor(now/STEP),key=keys('service-monitor-quality:',account)+hour;
 const previous=await store.get(key);
 // A retired reseller may still report quality after it leaves the scheduled sample list.
 if(!previous)await rememberHistoryScopes(store,[account]);
 const data=previous||{},rows=data[bucket]||[],id=info.type+'|'+info.server;
 let row=rows.find(r=>r.key===id);if(!row){if(rows.length>=32)return false;row={key:id,...info,...empty()};rows.push(row);}
 row.reports++;row.attempts+=m.attempted||m.failedStart?1:0;row.failedStarts+=m.failedStart?1:0;row.errors+=m.errors;row.watchMs+=m.watchMs;row.stallMs+=m.stallMs;
 if(m.bytes!==null){row.bytes+=m.bytes;row.bytesMeasured++;}
 if(m.startupMs!==null)row.histogram[MONITOR_BINS.findIndex(n=>m.startupMs<=n)]++;
 data[bucket]=rows;await store.put(key,data);lease.monitorReport=m.reportId;lease.monitorReportedAt=now;return true;
}
// Current leases carry a username. Legacy and renamed leases still resolve by stable ID.
async function usersForLeases(store,active){
 const pending=new Set(active.map(lease=>lease.uid));
 const usernames=new Set();
 for(const lease of active){
  const name=typeof lease.username==='string'&&lease.username.trim().toLowerCase();
  if(name&&name.length<=80)usernames.add('user:'+name);
 }
 const users=new Map(),keys=[...usernames];
 function resolve(user){
  if(user&&pending.delete(user.id))users.set(user.id,user);
 }
 for(let i=0;i<keys.length;i+=100){
  const batch=await store.get(keys.slice(i,i+100));
  for(const user of batch.values())resolve(user);
 }
 let startAfter;
 while(pending.size){
  const page=await store.list({prefix:'user:',limit:100,...(startAfter?{startAfter}:{})});
  for(const [key,user]of page){startAfter=key;resolve(user);}
  if(page.size<100)break;
 }
 return users;
}
async function currentCounts(store,leases,accounts,now){
 const active=[...(await leases.active({},now)).values()].filter(lease=>media(lease.mediaKey));
 const users=await usersForLeases(store,active);
 const byAccount=new Map(accounts.map(id=>[id,new Map()]));
 for(const lease of active){
  const user=users.get(lease.uid),groups=byAccount.get(user?.resellerBridge?.accountId);
  if(!groups||user.status!=='active'||(user.expiresAt&&!(user.expiresAt>now))||lease.version!==user.version)continue;
  const info=media(lease.mediaKey);
  for(const type of ['all',info.type])for(const server of ['all',info.server]){const id=type+'|'+server;let row=groups.get(id);if(!row){if(groups.size>=128)continue;row={type,server,connections:0,users:new Set()};groups.set(id,row);}row.connections++;row.users.add(user.id);}
 }
 return new Map([...byAccount].map(([id,groups])=>[id,[...groups.values()].map(r=>({...r,users:r.users.size}))]));
}
async function pruneHistory(store,accounts,now){
 const last=await store.get('service-monitor-pruned');
 if(Number.isFinite(last)&&last<=now&&last>=now-HOUR)return;
 const saved=await store.get(knownScopesKey);
 const firstRetained=at=>Math.ceil((at-RETENTION-HOUR)/HOUR);
 const cutoff=firstRetained(now);
 const scopes=new Set(accounts);
 if(!Array.isArray(saved)||!Number.isFinite(last)||last>now||now-last>24*HOUR){
  // Initial rollout, a long outage or a backwards clock: discover every existing scope.
  for(const prefix of historyPrefixes){
   let startAfter;
   for(;;){
    const page=await store.list({prefix,limit:100,...(startAfter?{startAfter}:{})});
    for(const [key]of page){
     startAfter=key;
     const colon=key.lastIndexOf(':');
     if(Number(key.slice(colon+1))<cutoff)await store.delete(key);
     else scopes.add(key.slice(prefix.length,colon));
    }
    if(page.size<100)break;
   }
  }
 }else{
  for(const scope of saved)scopes.add(scope);
  // Both cursors use the same strict cutoff as the historical full scan.
  // Missing hourly records are normal when there were no quality reports.
  for(let hour=firstRetained(last);hour<cutoff;hour++){
   const expired=[];
   for(const scope of scopes)for(const prefix of historyPrefixes)expired.push(keys(prefix,scope)+hour);
   for(let i=0;i<expired.length;i+=100)await store.delete(expired.slice(i,i+100));
  }
 }
 if(!Array.isArray(saved)||saved.length!==scopes.size||saved.some(scope=>!scopes.has(scope)))await store.put(knownScopesKey,[...scopes]);
 // Sampling runs inside a Durable Object transaction. Advance only after deletion succeeds.
 await store.put('service-monitor-pruned',now);
}
export async function sampleServiceMonitor(store,leases,accounts,now=Date.now()){
 const counts=await currentCounts(store,leases,accounts,now),hour=Math.floor(now/HOUR),bucket=Math.floor(now/STEP);
 const idleSince=await store.get(idleSinceKey),idle=[...counts.values()].every(rows=>!rows.length);
 const continuingIdle=idle&&Number.isSafeInteger(idleSince)&&idleSince<=bucket;
 // Take the first zero after activity, then record only actual checks every
 // 15 minutes. Historical intervals without a sample remain unknown.
 if(continuingIdle&&bucket>idleSince&&bucket%3!==0){await pruneHistory(store,accounts,now);return counts;}
 if(idle&&!continuingIdle)await store.put(idleSinceKey,bucket);
 if(!idle&&idleSince!==undefined)await store.delete(idleSinceKey);
 const created=[];
 for(const [account,rows]of counts){
  const key=keys('service-monitor-counts:',account)+hour,previous=await store.get(key),data=previous||{};
  if(!previous)created.push(account);
  data[bucket]={at:now,rows};await store.put(key,data);
 }
 await rememberHistoryScopes(store,created);
 await pruneHistory(store,accounts,now);
 return counts;
}
export async function readServiceMonitor(store,leases,body,now=Date.now()){
 const account=body.accountId,hours=Number(body.hours??1),content=body.content??'all',provider=body.provider??'all';
 if(!identifier(account)||![1,24,168].includes(hours)||!['all','live','movie','series'].includes(content)||provider!=='all'&&!identifier(provider))return Response.json({error:'bridge_input'},{status:400});
 const query={content,provider},counts=(await currentCounts(store,leases,[account],now)).get(account),current=counts.find(r=>r.type===content&&r.server===provider)||{connections:0,users:0};
 const since=now-hours*HOUR,startHour=Math.floor(since/HOUR),endHour=Math.floor(now/HOUR),countRows=new Map(),qualityRows=new Map(),providers=new Set(counts.filter(r=>r.server!=='all').map(r=>r.server));
 for(let hour=startHour;hour<=endHour;hour++){
  const [c,q]=await Promise.all([store.get(keys('service-monitor-counts:',account)+hour),store.get(keys('service-monitor-quality:',account)+hour)]);
  for(const [bucket,sample]of Object.entries(c||{})){const at=Number(bucket)*STEP;if(at<since-STEP||at>now)continue;for(const r of sample.rows)if(r.server!=='all')providers.add(r.server);const row=sample.rows.find(r=>r.type===content&&r.server===provider);countRows.set(Number(bucket),{at:sample.at,connections:row?.connections||0,users:row?.users||0});}
  for(const [bucket,rows]of Object.entries(q||{})){const at=Number(bucket)*STEP;if(at<since-STEP||at>now)continue;const aggregate=empty();for(const row of rows){providers.add(row.server);if(matches(row,query))add(aggregate,row);}qualityRows.set(Number(bucket),aggregate);}
 }
 // Current values are live; historical holes remain holes, never fabricated zeroes.
 const currentBucket=Math.floor(now/STEP);countRows.set(currentBucket,{at:now,connections:current.connections,users:current.users});
 const stride=hours===168?12:hours===24?3:1,points=[],summary=empty();
 for(let bucket=Math.floor(since/STEP);bucket<=currentBucket;bucket+=stride){
  const end=Math.min(currentBucket,bucket+stride-1),q=empty();let last=null,covered=0;
  for(let n=bucket;n<=end;n++){if(countRows.has(n)){last=countRows.get(n);covered++;}if(qualityRows.has(n))add(q,qualityRows.get(n));}add(summary,q);
  points.push({at:bucket*STEP,connections:last?.connections??null,users:last?.users??null,covered,...q});
 }
 return Response.json({ok:true,checkedAt:now,accountId:account,hours,content,provider,bins:MONITOR_BINS,current:{connections:current.connections,users:current.users},summary,points,providers:[...providers].sort(),retentionDays:7,sampleMinutes:5,idleSampleMinutes:15,trafficSource:'compatible-player-reports',inputMeasured:false});
}
