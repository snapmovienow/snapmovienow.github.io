import {seal,unseal} from './security.mjs';

export const MONITOR_CRON='*/5 * * * *';
const interval=300000,freshness=36*3600000;
const email=value=>typeof value==='string'&&value.length<=254&&/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/.test(value);
const defaults=()=>({enabled:true,channel:'panel',to:'',from:'',version:1});
function empty(now){return {createdAt:now,config:defaults(),checks:{},incidents:{},history:[],outbox:[],lastCheckedAt:null,delivery:{status:'not_configured'}}}
function settings(config){return {enabled:config.enabled,channel:config.channel,to:config.to,from:config.from,keyConfigured:!!config.key,version:config.version}}
async function putState(store,state){
 // SQLite KV values have a size limit. Keep active incidents, cap historical
 // detail and make a saturated email queue visible instead of losing writes.
 const bytes=()=>new TextEncoder().encode(JSON.stringify(state)).length;
 while(bytes()>100000&&state.history.length>1)state.history.pop();
 while(bytes()>100000&&state.outbox.length){const dropped=state.outbox.pop(),event=state.history.find(e=>e.id===dropped.id);if(event)event.delivery='queue_full';state.delivery={status:'email_backlog_full',at:Date.now()}}
 while(bytes()>100000&&state.history.length)state.history.pop();
 await store.put('monitor',state);
}
const request=(path,body={})=>({method:'POST',body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
function directory(env,path){return env.PLAYBACK_SESSIONS.get(env.PLAYBACK_SESSIONS.idFromName('__smn_accounts_v1')).fetch('https://private/accounts'+path,request(path))}
async function read(response){if(!response.ok)throw Error('monitor_source_unavailable');return response.json()}

// Observations contain only bounded aggregates. Missing playback samples are
// unknown, not proof that a failing stream has recovered.
export function observations(snapshot,now,createdAt){
 const out=[];
 for(const part of ['providers','playback','backups'])if(snapshot[part]===null)out.push({key:'monitor:'+part,kind:'monitor',title:'No se pudo comprobar '+({providers:'el proveedor',playback:'las reproducciones',backups:'las copias'}[part]),bad:true,confirm:2});else out.push({key:'monitor:'+part,kind:'monitor',bad:false,confirm:2});
 if(snapshot.providers)for(const p of snapshot.providers.providers||[])if(/^[a-zA-Z0-9_-]{1,80}$/.test(p.id))out.push({key:'provider:'+p.id,kind:'provider',title:'Proveedor sin respuesta o sin cuentas activas',detail:p.label, bad:p.ok!==true,confirm:2});
 if(snapshot.playback)for(const g of snapshot.playback.groups||[]){
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(g.server)||!['live','movie','series'].includes(g.type)||!['web','android'].includes(g.platform)||!['1080','720','other'].includes(g.quality))continue;
  const bad=g.failedStarts>=5||g.reports>=5&&g.errors>=5||g.starts>=5&&(g.stallPercent>2||g.startupP95UpperMs>10000);
  const healthy=g.starts>=5&&!g.failedStarts&&!g.errors&&g.stallPercent<=2&&(g.startupP95UpperMs===null||g.startupP95UpperMs<=10000);
  if(!bad&&!healthy)continue;
  out.push({key:'playback:'+g.server+':'+g.type+':'+g.quality+':'+g.platform,kind:'playback',title:'Fallos repetidos de reproducción',detail:({live:'TV',movie:'Películas',series:'Series'}[g.type])+' · '+(g.platform==='web'?'Web':'Android')+' · '+g.quality+' · '+g.failedStarts+' fallos de inicio · '+g.errors+' errores · '+g.stallPercent+'% cargando',bad,confirm:1});
 }
 if(snapshot.backups){const b=snapshot.backups;
  const stale=now-(b.lastAutomaticAt||createdAt)>freshness;
  out.push({key:'backup:daily',kind:'backup',title:b.automaticStatus==='failed'?'Falló la copia automática':'Copia automática sin actualizar desde hace más de 36 horas',bad:b.automaticStatus==='failed'||stale,confirm:1});
  if(b.status==='failed'||b.status==='success')out.push({key:'backup:creation',kind:'backup',title:'Falló la creación de una copia',bad:b.status==='failed',confirm:1});
  if(b.recovery?.status==='failed'||b.recovery?.status==='success')out.push({key:'backup:restore',kind:'backup',title:'Falló la comprobación de recuperación de una copia',bad:b.recovery.status==='failed',confirm:1});
 }
 return out;
}

export function applyObservations(state,snapshot,now){
 const changed=[],bucket=Math.floor(now/interval),seen=new Set();
 for(const item of observations(snapshot,now,state.createdAt)){
  if(item.kind==='playback'&&!item.bad&&!state.incidents[item.key])continue;
  seen.add(item.key);const previous=state.checks[item.key]||{bad:0,good:0};
  // A manual check or duplicate cron in the same slot cannot amplify a streak.
  if(previous.bucket!==bucket){previous.bad=item.bad?previous.bad+1:0;previous.good=item.bad?0:previous.good+1;previous.bucket=bucket}
  state.checks[item.key]=previous;const incident=state.incidents[item.key];
  if(item.bad&&previous.bad>=item.confirm){
   if(!incident||incident.status==='resolved'){
    if(Object.values(state.incidents).filter(i=>i.status==='open').length>=80)continue;
    state.incidents[item.key]={id:crypto.randomUUID(),key:item.key,kind:item.kind,title:item.title,detail:item.detail||'',status:'open',openedAt:now,lastObservedAt:now,waitingForSamples:false};
    changed.push({...state.incidents[item.key],kind:'opened'});
   }else Object.assign(incident,{title:item.title,detail:item.detail||'',lastObservedAt:now,waitingForSamples:false});
  }else if(!item.bad&&incident?.status==='open'&&previous.good>=item.confirm){incident.status='resolved';incident.resolvedAt=now;incident.lastObservedAt=now;incident.waitingForSamples=false;changed.push({...incident,kind:'resolved'})}
 }
 for(const [key,incident]of Object.entries(state.incidents)){
  if(incident.status!=='open'||seen.has(key))continue;
  if(incident.kind==='playback')incident.waitingForSamples=true;
  if(incident.kind==='provider'&&snapshot.providers){incident.status='resolved';incident.resolvedAt=now;changed.push({...incident,kind:'removed'})}
 }
 // A small durable outbox, stable notification IDs and a provider idempotency
 // key handle lost acknowledgements and retries without another email.
 if(changed.length){
  const event={id:crypto.randomUUID(),createdAt:now,changes:changed.map(({kind,id,title,detail})=>({kind,id,title,detail})),delivery:state.config.channel==='email'?'pending':'panel'};
  state.history.unshift(event);state.history=state.history.slice(0,50);
  if(state.config.channel==='email'&&state.outbox.length<20)state.outbox.push({...event,attempts:0,nextAt:now,version:state.config.version});
  else if(state.config.channel==='email')event.delivery='queue_full';
 }
 state.lastCheckedAt=now;
 const resolved=Object.values(state.incidents).filter(i=>i.status==='resolved').sort((a,b)=>b.resolvedAt-a.resolvedAt);
 for(const old of resolved.slice(50)){delete state.incidents[old.key];delete state.checks[old.key]}
 // Bound historical checks for providers/groups no longer represented.
 for(const key of Object.keys(state.checks))if(!seen.has(key)&&!state.incidents[key])delete state.checks[key];
 return state;
}

function publicStatus(state){return {settings:settings(state.config),createdAt:state.createdAt,lastCheckedAt:state.lastCheckedAt,intervalMinutes:5,monitorStale:!state.lastCheckedAt||Date.now()-state.lastCheckedAt>15*60000,incidents:Object.values(state.incidents).sort((a,b)=>b.openedAt-a.openedAt),history:state.history,delivery:state.delivery,pendingEmails:state.outbox.length,thresholds:{failedStarts:5,errors:5,minStarts:5,stallPercent:2,startupMs:10000,backupHours:36,playbackWindowMinutes:15}}}
function mail(event,config){return {from:config.from,to:[config.to],subject:'SNAPTVNOW · '+(event.changes.every(c=>c.kind!=='opened')?'Recuperación / comprobación':'Aviso del sistema'),text:'SNAPTVNOW\n'+new Date(event.createdAt).toISOString()+'\n\n'+event.changes.map(c=>({opened:'INCIDENCIA',resolved:'RECUPERADO',removed:'CONEXIÓN RETIRADA',test:'PRUEBA'}[c.kind])+': '+c.title+(c.detail?'\n'+c.detail:'')).join('\n\n')+'\n\nRevisa el panel: https://app.snaptvnow.com/admin.html'} }

export class OperationsMonitor{
 constructor(state,env){this.state=state;this.env=env;this.running=null}
 async fetch(req){
  const path=new URL(req.url).pathname,b=await req.json(),store=this.state.storage;
  if(path==='/tick'){if(!this.running)this.running=this.tick().finally(()=>{this.running=null});return Response.json(await this.running)}
  if(path==='/settings'){
   if(typeof b.enabled!=='boolean'||!['panel','email'].includes(b.channel))return Response.json({error:'invalid_alert_settings'},{status:400});
   const to=String(b.to||'').trim(),from=String(b.from||'').trim(),apiKey=String(b.apiKey||'').trim();
   if(b.channel==='email'&&(!email(to)||!email(from)))return Response.json({error:'invalid_alert_email'},{status:400});
   if(apiKey&&!/^re_[a-zA-Z0-9_-]{10,250}$/.test(apiKey))return Response.json({error:'invalid_alert_key'},{status:400});
   const key=apiKey?await seal(this.env,{kind:'alert-email-key',key:apiKey}):null;
   const result=await store.transaction(async tx=>{
    const state=await tx.get('monitor')||empty(Date.now()),old=state.config;
    if(b.channel==='email'&&!key&&!old.key)return {error:'alert_key_required'};
    state.config={enabled:b.enabled,channel:b.channel,to,from,key:key||old.key||null,version:old.version+1};
    if(!old.enabled&&b.enabled){state.createdAt=Date.now();state.checks={}}
    for(const event of state.history)if(event.delivery==='pending')event.delivery='cancelled';state.outbox=[];
    await putState(tx,state);return publicStatus(state);
   });return Response.json(result,{status:result.error?400:200});
  }
  if(path==='/test'){
   const now=Date.now(),result=await store.transaction(async tx=>{
    const state=await tx.get('monitor')||empty(now);if(state.config.channel!=='email'||!state.config.key)return {error:'alert_key_required'};
    if(!state.config.enabled)return {error:'alerts_paused'};
    if(now-(state.lastTestAt||0)<600000||state.outbox.length>=20)return {error:'alert_test_limited'};
    const event={id:crypto.randomUUID(),createdAt:now,changes:[{kind:'test',title:'El canal de avisos está conectado',detail:'Mensaje de prueba solicitado desde el panel.'}],delivery:'pending'};
    state.lastTestAt=now;state.history.unshift(event);state.history=state.history.slice(0,50);state.outbox.push({...event,attempts:0,nextAt:now,version:state.config.version});await putState(tx,state);return {ok:true};
   });if(result.error)return Response.json(result,{status:result.error==='alert_test_limited'?429:400});await this.flush();return this.status();
  }
  if(path==='/status')return this.status();
  return Response.json({error:'not_found'},{status:404});
 }
 async status(){const state=await this.state.storage.get('monitor')||empty(Date.now());return Response.json(publicStatus(state))}
 async collect(){
  const binding=this.env.PLAYBACK_SESSIONS;
  const responses=await Promise.allSettled([
   binding.get(binding.idFromName('__smn_provider_refresh_v1')).fetch('https://private/monitor-providers',request('/monitor-providers')).then(read),
   binding.get(binding.idFromName('__smn_operations_v1')).fetch('https://private/operations/monitor',request('/operations/monitor')).then(read),
   directory(this.env,'/backup-status').then(read)
  ]);
  return Object.fromEntries(['providers','playback','backups'].map((key,i)=>[key,responses[i].status==='fulfilled'?responses[i].value:null]));
 }
 async tick(){
  if(this.env.ENVIRONMENT==='staging')return {ok:true,skipped:true};
  const store=this.state.storage,now=Date.now(),runId=crypto.randomUUID();
  const claim=await store.transaction(async tx=>{
   const state=await tx.get('monitor')||empty(now);
   if(!state.config.enabled){await putState(tx,state);return null}
   if(state.run&&state.run.at>now-120000||state.lastCheckedAt&&now-state.lastCheckedAt<60000)return null;
   state.run={id:runId,at:now,version:state.config.version};await putState(tx,state);return state.run;
  });
  if(claim){const snapshot=await this.collect();await store.transaction(async tx=>{
   const state=await tx.get('monitor');if(state.run?.id!==runId)return;
   delete state.run;if(state.config.version===claim.version&&state.config.enabled)applyObservations(state,snapshot,Date.now());await putState(tx,state);
  })}
  await this.flush();return {ok:true,checked:!!claim};
 }
 async flush(){
  if(this.env.ENVIRONMENT==='staging')return;
  // Persist a delivery lease before I/O; another invocation may interleave.
  const store=this.state.storage,now=Date.now(),claimId=crypto.randomUUID();
  const claimed=await store.transaction(async tx=>{
   const state=await tx.get('monitor');if(!state||!state.config.enabled||state.config.channel!=='email')return null;
   const event=state.outbox[0];if(!event||event.nextAt>now||event.claimedAt>now-60000)return null;
   if(now-event.createdAt>23*3600000||event.version!==state.config.version){state.outbox.shift();const log=state.history.find(e=>e.id===event.id);if(log)log.delivery='expired';await putState(tx,state);return null}
   event.claimedAt=now;event.claimId=claimId;await putState(tx,state);return {event,config:state.config};
  });if(!claimed)return;
  let status='accepted',retryAfter=0;
  try{
   const secret=await unseal(this.env,claimed.config.key);if(secret?.kind!=='alert-email-key')throw Error('email_configuration_failed');
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+secret.key,'Idempotency-Key':'snap-alert/'+claimed.event.id},body:JSON.stringify(mail(claimed.event,claimed.config)),signal:AbortSignal.timeout(10000),redirect:'error'});
   if(!response.ok){retryAfter=Math.min(3600000,Math.max(0,Number(response.headers.get('Retry-After'))||0)*1000);await response.body?.cancel();throw Error(response.status===429?'email_rate_limited':response.status>=500?'email_unavailable':'email_rejected')}
   const data=await response.json();if(typeof data.id!=='string')throw Error('email_unavailable');
  }catch(error){status=['email_configuration_failed','email_rate_limited','email_unavailable','email_rejected'].includes(error.message)?error.message:'email_unavailable'}
  await store.transaction(async tx=>{
   const state=await tx.get('monitor'),event=state?.outbox.find(e=>e.id===claimed.event.id);if(!event||event.claimId!==claimId)return;
   const log=state.history.find(e=>e.id===event.id);state.delivery={status,at:Date.now()};event.attempts++;delete event.claimedAt;delete event.claimId;
   if(status==='accepted'||event.attempts>=6||status==='email_rejected'||status==='email_configuration_failed'){state.outbox=state.outbox.filter(e=>e.id!==event.id);if(log)log.delivery=status==='accepted'?'accepted':'failed'}
   else{event.nextAt=Date.now()+Math.max(retryAfter,interval*2**(event.attempts-1));if(log)log.delivery='pending'}await putState(tx,state);
  });
 }
}

export function monitorCall(env,path,body={}){if(!env.OPERATION_ALERTS)return Promise.resolve(Response.json({error:'monitor_unavailable'},{status:503}));return env.OPERATION_ALERTS.get(env.OPERATION_ALERTS.idFromName('system-monitor-v1')).fetch('https://private'+path,request(path,body))}
