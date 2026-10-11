const limits=[500,1000,2000,5000,10000,20000,60000,120000,300000];
function clean(b){
 const m=b.metric;if(!m||!['live','movie','series'].includes(m.type)||!['1080','720','other'].includes(m.quality)||!/^[a-zA-Z0-9_-]{1,80}$/.test(m.server||'ccf'))return null;
 if(m.report_id!==undefined&&!/^[a-zA-Z0-9_-]{8,80}$/.test(m.report_id)||m.platform!==undefined&&!['web','android'].includes(m.platform))return null;
 const out={type:m.type,quality:m.quality,server:m.server||'ccf',platform:m.platform||'web',reportId:m.report_id||null,attempted:m.attempted===true,failedStart:m.failedStart===true};
 for(const [key,max]of Object.entries({watchMs:300000,stallMs:300000,stalls:100,errors:100,decoded:100000,dropped:100000})){
  if(!Number.isFinite(m[key])||m[key]<0||m[key]>max)return null;out[key]=Math.round(m[key]);
 }
 if(m.stallMs>m.watchMs+1000||m.dropped>m.decoded)return null;
 if(m.startupMs!==null&&(!Number.isFinite(m.startupMs)||m.startupMs<0||m.startupMs>300000))return null;
 out.startupMs=m.startupMs===null?null:Math.round(m.startupMs);out.started=m.started===true;out.bytes=null;if(m.bytes!==null&&m.bytes!==undefined){if(!Number.isFinite(m.bytes)||m.bytes<0||m.bytes>250000000)return null;out.bytes=Math.round(m.bytes)}return out;
}
export async function operationsRoute(store,req){
 const b=await req.json(),path=new URL(req.url).pathname,now=Date.now();
 if(path==='/operations/ingest'){
  const m=clean(b);if(!m||!b.uid)return Response.json({error:'invalid_metric'},{status:400});
  return store.transaction(async tx=>{
   const receipt=m.reportId?'receipt:'+b.uid+':'+m.reportId:null;if(receipt&&await tx.get(receipt))return Response.json({ok:true,duplicate:true});
   const rate='rate:'+b.uid,last=await tx.get(rate)||0;if(now-last<15000)return Response.json({ok:true,limited:true});
   await tx.put(rate,now);const hour=Math.floor(now/3600000),key='qoe:'+hour+':'+m.server+':'+m.type+':'+m.quality+':'+m.platform;
   const row=await tx.get(key)||{hour,server:m.server,type:m.type,quality:m.quality,platform:m.platform,attempts:0,failedStarts:0,reports:0,starts:0,watchMs:0,stallMs:0,stalls:0,errors:0,decoded:0,dropped:0,bytes:0,bytesMeasured:0,startupHistogram:Array(9).fill(0)};
   for(const field of ['watchMs','stallMs','stalls','errors','decoded','dropped'])row[field]+=m[field];row.reports++;row.attempts=(row.attempts||0)+(m.attempted?1:0);row.failedStarts=(row.failedStarts||0)+(m.failedStart?1:0);row.starts+=m.started?1:0;if(m.bytes!==null){row.bytes=(row.bytes||0)+m.bytes;row.bytesMeasured=(row.bytesMeasured||0)+1}
   if(m.startupMs!==null)row.startupHistogram[limits.findIndex(n=>m.startupMs<=n)]++;
   await tx.put(key,row);
   // Separate five-minute buckets prevent a 24-hour warning from becoming a
   // stale operational alarm. Keep the same receipt/rate transaction.
   const bucket=Math.floor(now/300000),recentKey='monitor-qoe:'+bucket+':'+m.server+':'+m.type+':'+m.quality+':'+m.platform;
   const recent=await tx.get(recentKey)||{...row,bucket,reports:0,starts:0,attempts:0,failedStarts:0,watchMs:0,stallMs:0,stalls:0,errors:0,decoded:0,dropped:0,bytes:0,bytesMeasured:0,startupHistogram:Array(9).fill(0)};
   for(const field of ['watchMs','stallMs','stalls','errors','decoded','dropped'])recent[field]+=m[field];recent.reports++;recent.starts+=m.started?1:0;recent.attempts+=m.attempted?1:0;recent.failedStarts+=m.failedStart?1:0;
   if(m.startupMs!==null)recent.startupHistogram[limits.findIndex(n=>m.startupMs<=n)]++;
   await tx.put(recentKey,recent);if(receipt)await tx.put(receipt,now);
   if((await tx.get('monitor-pruned')||0)<now-300000){for(const [key,row]of await tx.list({prefix:'monitor-qoe:'}))if(row.bucket<bucket-3)await tx.delete(key);await tx.put('monitor-pruned',now)}
   if((await tx.get('pruned')||0)<now-3600000){
    for(const [key,row]of await tx.list({prefix:'qoe:'}))if(row.hour<hour-24)await tx.delete(key);
    for(const [key,at]of await tx.list({prefix:'rate:'}))if(at<now-3600000)await tx.delete(key);
    for(const [key,at]of await tx.list({prefix:'receipt:'}))if(at<now-3600000)await tx.delete(key);
    await tx.put('pruned',now);
   }
   return Response.json({ok:true});
  });
 }
 const recent=path==='/operations/monitor',prefix=recent?'monitor-qoe:':'qoe:';
 const rows=[...(await store.list({prefix})).values()].filter(r=>recent?r.bucket>=Math.floor(now/300000)-2:r.hour>=Math.floor(now/3600000)-23),groups=new Map();
 for(const r of rows){const key=r.server+':'+r.type+':'+r.quality+':'+(r.platform||'web');let total=groups.get(key);if(!total){total={server:r.server,type:r.type,quality:r.quality,platform:r.platform||'web',attempts:0,failedStarts:0,reports:0,starts:0,watchMs:0,stallMs:0,stalls:0,errors:0,decoded:0,dropped:0,bytes:0,bytesMeasured:0,startupHistogram:Array(9).fill(0)};groups.set(key,total)}for(const field of ['reports','starts','watchMs','stallMs','stalls','errors','decoded','dropped'])total[field]+=r[field];total.attempts+=(r.attempts||0);total.failedStarts+=(r.failedStarts||0);total.bytes=(total.bytes||0)+(r.bytes||0);total.bytesMeasured=(total.bytesMeasured||0)+(r.bytesMeasured||0);r.startupHistogram.forEach((n,i)=>total.startupHistogram[i]+=n)}
 const data=[...groups.values()].map(r=>{const samples=r.startupHistogram.reduce((a,b)=>a+b,0);let sum=0;const index=r.startupHistogram.findIndex(n=>(sum+=n)>=Math.ceil(samples*.95));return {...r,startupSamples:samples,startupP95UpperMs:samples?limits[index]:null,stallPercent:r.watchMs?Number((100*r.stallMs/r.watchMs).toFixed(2)):0}});
 return Response.json({windowHours:recent?0.25:24,groups:data,alerts:data.filter(r=>r.failedStarts>=5||r.starts>=5&&(r.stallPercent>2||r.startupP95UpperMs>10000)).map(r=>({server:r.server,type:r.type,quality:r.quality,platform:r.platform,message:'Revisar fallos de arranque, demora de inicio o cortes en este grupo.'}))});
}
