// Account-scoped operational history. Never stores credentials, IPs or titles.
import {cleanPlaybackMetric} from './operations.mjs';
export const MONITOR_BINS=[100,250,500,1000,2000,3000,4000,5000,8000,12000,20000,60000,300000];
const STEP=300000,HOUR=3600000,RETENTION=7*86400000;
const identifier=v=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,80}$/.test(v);
const media=key=>{const [type,server]=String(key||'').split('|');return ['live','movie','series'].includes(type)&&identifier(server)?{type,server}:null;};
const empty=()=>({reports:0,attempts:0,failedStarts:0,errors:0,watchMs:0,stallMs:0,bytes:0,bytesMeasured:0,histogram:MONITOR_BINS.map(()=>0)});
const add=(a,b)=>{for(const k of ['reports','attempts','failedStarts','errors','watchMs','stallMs','bytes','bytesMeasured'])a[k]+=b[k]||0;b.histogram?.forEach((n,i)=>a.histogram[i]+=n);return a;};
export function monitorPercentile(histogram,p=.95){const samples=histogram.reduce((a,b)=>a+b,0);if(!samples)return null;let count=0;return MONITOR_BINS[histogram.findIndex(n=>(count+=n)>=Math.ceil(samples*p))];}
const matches=(row,body)=>(body.content==='all'||row.type===body.content)&&(body.provider==='all'||row.server===body.provider);
const keys=(prefix,account)=>prefix+account+':';
export async function recordServiceMetric(store,lease,user,metric,now=Date.now()){
 const account=user?.resellerBridge?.accountId,info=media(lease.mediaKey),m=cleanPlaybackMetric({metric});
 if(!identifier(account)||!info||!m||lease.monitorReport===m.reportId||lease.monitorReportedAt>now-15000)return false;
 const hour=Math.floor(now/HOUR),bucket=Math.floor(now/STEP),key=keys('service-monitor-quality:',account)+hour;
 const data=await store.get(key)||{},rows=data[bucket]||[],id=info.type+'|'+info.server;
 let row=rows.find(r=>r.key===id);if(!row){if(rows.length>=32)return false;row={key:id,...info,...empty()};rows.push(row);}
 row.reports++;row.attempts+=m.attempted||m.failedStart?1:0;row.failedStarts+=m.failedStart?1:0;row.errors+=m.errors;row.watchMs+=m.watchMs;row.stallMs+=m.stallMs;
 if(m.bytes!==null){row.bytes+=m.bytes;row.bytesMeasured++;}
 if(m.startupMs!==null)row.histogram[MONITOR_BINS.findIndex(n=>m.startupMs<=n)]++;
 data[bucket]=rows;await store.put(key,data);lease.monitorReport=m.reportId;lease.monitorReportedAt=now;return true;
}
async function currentCounts(store,leases,accounts,now){
 const scope=new Set(accounts),users=new Map();let startAfter;
 for(;;){const page=await store.list({prefix:'user:',limit:100,...(startAfter?{startAfter}:{})});for(const [key,u]of page){startAfter=key;if(scope.has(u?.resellerBridge?.accountId)&&u.status==='active'&&(!u.expiresAt||u.expiresAt>now))users.set(u.id,u);}if(page.size<100)break;}
 const byAccount=new Map(accounts.map(id=>[id,new Map()]));
 for(const lease of (await leases.active({},now)).values()){
  const user=users.get(lease.uid),info=media(lease.mediaKey);if(!user||lease.version!==user.version||!info)continue;
  const groups=byAccount.get(user.resellerBridge.accountId);
  for(const type of ['all',info.type])for(const server of ['all',info.server]){const id=type+'|'+server;let row=groups.get(id);if(!row){if(groups.size>=128)continue;row={type,server,connections:0,users:new Set()};groups.set(id,row);}row.connections++;row.users.add(user.id);}
 }
 return new Map([...byAccount].map(([id,groups])=>[id,[...groups.values()].map(r=>({...r,users:r.users.size}))]));
}
export async function sampleServiceMonitor(store,leases,accounts,now=Date.now()){
 const counts=await currentCounts(store,leases,accounts,now),hour=Math.floor(now/HOUR),bucket=Math.floor(now/STEP);
 for(const [account,rows]of counts){const key=keys('service-monitor-counts:',account)+hour,data=await store.get(key)||{};data[bucket]={at:now,rows};await store.put(key,data);}
 // Once per hour, bounded by the seven-day retention and four trusted scopes.
 if((await store.get('service-monitor-pruned')||0)<now-HOUR){
  for(const prefix of ['service-monitor-counts:','service-monitor-quality:']){let startAfter;for(;;){const page=await store.list({prefix,limit:100,...(startAfter?{startAfter}:{})});for(const [key]of page){startAfter=key;if(Number(key.slice(key.lastIndexOf(':')+1))*HOUR<now-RETENTION-HOUR)await store.delete(key);}if(page.size<100)break;}}
  await store.put('service-monitor-pruned',now);
 }
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
 return Response.json({ok:true,checkedAt:now,accountId:account,hours,content,provider,bins:MONITOR_BINS,current:{connections:current.connections,users:current.users},summary,points,providers:[...providers].sort(),retentionDays:7,sampleMinutes:5,trafficSource:'compatible-player-reports',inputMeasured:false});
}
