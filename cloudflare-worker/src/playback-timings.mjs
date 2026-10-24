// Request-local timing only. Never retain media URLs, accounts or credentials.
export const PLAYBACK_STAGES=['auth','catalog','allocation','validation','origin','first_byte'];
const stages=new Set(PLAYBACK_STAGES),types=new Set(['live','movie','series']);
const limits=[100,250,500,1000,2000,4000,8000,12000,20000,60000,300000];
const clock=()=>performance.now();
export class PlaybackTimings {
 constructor(now=clock){this.now=now;this.started=now();this.values={};this.active={};this.type=null;this.platform='other';}
 identify(type,platform){if(types.has(type))this.type=type;if(['android','web','other','canary'].includes(platform))this.platform=platform;return this;}
 add(stage,ms,count=1){if(!stages.has(stage)||!Number.isFinite(ms)||ms<0)return;const value=this.values[stage]||{ms:0,count:0};value.ms=Math.min(300000,value.ms+ms);value.count=Math.min(100,value.count+count);this.values[stage]=value;}
 async run(stage,operation){
  if(!stages.has(stage))return operation();
  const span=this.active[stage]||{started:this.now(),depth:0,count:0};this.active[stage]=span;span.depth++;span.count++;
  try{return await operation()}finally{if(!--span.depth){this.add(stage,Math.max(0,this.now()-span.started),span.count);delete this.active[stage]}}
 }
 measured(){const values=structuredClone(this.values);for(const [stage,span]of Object.entries(this.active)){const old=values[stage]||{ms:0,count:0};values[stage]={ms:Math.min(300000,old.ms+Math.max(0,this.now()-span.started)),count:Math.min(100,old.count+span.count)}}return values;}
 merge(response){for(const part of (response.headers.get('Server-Timing')||'').split(',')){const m=part.trim().match(/^smn_(auth|catalog|allocation|validation|origin|first_byte);dur=(\d+(?:\.\d+)?)$/);if(m)this.add(m[1],Number(m[2]));}return response;}
 header(){return Object.entries(this.measured()).map(([stage,v])=>'smn_'+stage+';dur='+Math.round(v.ms)).join(',');}
 snapshot(status=200){return {type:this.type,platform:this.platform,status,totalMs:Math.min(300000,Math.max(0,Math.round(this.now()-this.started))),stages:Object.fromEntries(Object.entries(this.measured()).map(([stage,v])=>[stage,{ms:Math.round(v.ms),count:v.count}]))};}
 response(response){const h=new Headers(response.headers),value=this.header();if(value)h.append('Server-Timing',value);return new Response(response.body,{status:response.status,statusText:response.statusText,headers:h});}
}
export const timed=(trace,stage,operation)=>trace?trace.run(stage,operation):operation();

export function startupTimingObservations(groups){
 const result=[];
 for(const group of Array.isArray(groups)?groups:[]){
  if(!types.has(group.type)||!['android','web','other','canary'].includes(group.platform)||!Number.isInteger(group.requests)||group.requests<5)continue;
  const total=group.stages?.total?.p95UpperMs,budget=group.type==='live'?8000:12000;
  if(!Number.isFinite(total)||total<0||!Number.isInteger(group.failures)||group.failures<0||group.failures>group.requests)continue;
  const repeatedFailures=group.failures>=Math.max(3,Math.ceil(group.requests*.2)),slowStarts=total>budget,bad=repeatedFailures||slowStarts;
  const good=!group.failures&&total<=budget;if(!bad&&!good)continue;
  const labels={auth:'acceso',catalog:'catálogo',allocation:'asignación',validation:'validación del origen',origin:'respuesta del origen',first_byte:'llegada de vídeo'};
  const slow=Object.entries(group.stages||{}).filter(([name,v])=>stages.has(name)&&Number.isFinite(v.p95UpperMs)).sort((a,b)=>b[1].p95UpperMs-a[1].p95UpperMs)[0];
  const title=repeatedFailures&&slowStarts?'Demoras y fallos repetidos al iniciar contenido':repeatedFailures?'Fallos repetidos al iniciar contenido':slowStarts?'Demoras al iniciar contenido':'Inicio de contenido dentro del tiempo esperado';
  const trigger=[...(repeatedFailures?['Alerta por respuestas con error']:[]),...(slowStarts?['Alerta por demora: P95 hasta '+(total/1000)+' s (límite '+(budget/1000)+' s)']:[])].join(' · ');
  result.push({key:'startup:'+group.type+':'+group.platform,kind:'startup',title,detail:({live:'TV',movie:'Películas',series:'Series'}[group.type])+' · '+({other:'Reproductor sin identificar',canary:'Prueba automática',web:'Web',android:'Android'}[group.platform])+' · '+group.failures+' respuestas con error de '+group.requests+' solicitudes'+(trigger?' · '+trigger:'')+(slow?' · Etapa con mayor P95: '+labels[slow[0]]:''),bad,confirm:1});
 }
 return result;
}

export async function playbackTimingsRoute(store,req){
 const path=new URL(req.url).pathname,body=await req.json(),now=Date.now(),bucket=Math.floor(now/300000);
 if(path==='/operations/timing-ingest'){
  const m=body.timing;
  if(!m||!types.has(m.type)||!['android','web','other','canary'].includes(m.platform)||!Number.isInteger(m.status)||m.status<100||m.status>599||!Number.isFinite(m.totalMs)||m.totalMs<0||m.totalMs>300000||!m.stages||Object.keys(m.stages).some(k=>!stages.has(k)))return Response.json({error:'invalid_timing'},{status:400});
  for(const v of Object.values(m.stages))if(!v||!Number.isFinite(v.ms)||v.ms<0||v.ms>300000||!Number.isInteger(v.count)||v.count<1||v.count>100)return Response.json({error:'invalid_timing'},{status:400});
  return store.transaction(async tx=>{
   const key='startup-timing:'+bucket+':'+m.type+':'+m.platform,row=await tx.get(key)||{bucket,type:m.type,platform:m.platform,requests:0,failures:0,stages:{}};
   row.requests++;if(m.status>=400)row.failures++;
   for(const [name,ms]of [['total',m.totalMs],...Object.entries(m.stages).map(([name,v])=>[name,v.ms])]){const v=row.stages[name]||{samples:0,sum:0,histogram:Array(limits.length).fill(0)};v.samples++;v.sum+=ms;v.histogram[limits.findIndex(n=>ms<=n)]++;row.stages[name]=v;}
   await tx.put(key,row);
   if((await tx.get('startup-timing-pruned')||0)<now-300000){for(const [key,value]of await tx.list({prefix:'startup-timing:'}))if(value.bucket<bucket-3)await tx.delete(key);await tx.put('startup-timing-pruned',now);}
   return Response.json({ok:true});
  });
 }
 if(path!=='/operations/timing-read')return Response.json({error:'not_found'},{status:404});
 const groups=new Map();
 for(const row of (await store.list({prefix:'startup-timing:'})).values()){
  if(row.bucket<bucket-2)continue;const key=row.type+':'+row.platform;
  const group=groups.get(key)||{type:row.type,platform:row.platform,requests:0,failures:0,stages:{}};group.requests+=row.requests;group.failures+=row.failures;
  for(const [name,v]of Object.entries(row.stages)){const t=group.stages[name]||{samples:0,sum:0,histogram:Array(limits.length).fill(0)};t.samples+=v.samples;t.sum+=v.sum;v.histogram.forEach((n,i)=>t.histogram[i]+=n);group.stages[name]=t;}groups.set(key,group);
 }
 return Response.json({windowMinutes:15,groups:[...groups.values()].map(g=>({...g,stages:Object.fromEntries(Object.entries(g.stages).map(([name,v])=>{let sum=0;const index=v.histogram.findIndex(n=>(sum+=n)>=Math.ceil(v.samples*.95));return [name,{samples:v.samples,avgMs:Math.round(v.sum/v.samples),p95UpperMs:limits[index]}]}))}))});
}
