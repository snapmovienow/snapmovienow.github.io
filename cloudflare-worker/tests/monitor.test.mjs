import assert from 'node:assert/strict';
import {OperationsMonitor,applyObservations,observations,MONITOR_CRON} from '../src/monitor.mjs';
import {probeProviders} from '../src/provider-monitor.mjs';
import {readPanel} from '../src/reseller.mjs';
import worker,{PlaybackSession} from '../src/index.js';
class Store{
 constructor(){this.data=new Map();this.queue=Promise.resolve()}
 async get(key){return structuredClone(this.data.get(key))}async put(key,value){this.data.set(key,structuredClone(value))}
 transaction(fn){const work=this.queue.then(()=>fn(this));this.queue=work.catch(()=>{});return work}
}
const realNow=Date.now,realFetch=globalThis.fetch;let now=1800000000000;Date.now=()=>now;
const store=new Store(),goodBackup=()=>({status:'success',automaticStatus:'success',lastAutomaticAt:now,recovery:{status:'success'}});
const sourceId='synthetic-source',providerKey='provider:'+sourceId;
const providerSample=(reason='ok',at=now)=>({id:sourceId,ok:reason==='ok',stage:reason==='credentials_unreadable'?'credentials':'inventory',reason,observedAt:at,durationMs:120,receivedRows:reason==='ok'?2:reason==='no_active_accounts'?0:null,acceptedRows:reason==='ok'?1:reason==='no_active_accounts'?0:null});
const providerEnvelope=(reason='ok',at=now)=>({configuredIds:[sourceId],providers:[providerSample(reason,at)]});
let providers=providerEnvelope(),playback={groups:[],timings:[]},backups=goodBackup(),catalog={references:[],servers:[]},reads=0;
const firstProviderRead=Promise.withResolvers();let blockFirstProviderRead=true;
const env={ENVIRONMENT:'production',PROVIDER_PROBE_EMAIL_ENABLED:'true',TICKET_SECRET:'synthetic-monitor-secret-never-deployed',PLAYBACK_SESSIONS:{idFromName:name=>name,get:name=>({fetch:async url=>{reads++;if(blockFirstProviderRead&&name==='__smn_provider_refresh_v1')await firstProviderRead.promise;return Response.json(name==='__smn_provider_refresh_v1'?providers:name==='__smn_operations_v1'?playback:url.endsWith('/catalog-references-status')?catalog:backups)}})}};
const monitor=new OperationsMonitor({storage:store},env),call=async(path,body={})=>{const response=await monitor.fetch(new Request('https://private'+path,{method:'POST',body:JSON.stringify(body)}));return {status:response.status,data:await response.json()}};
let mailCalls=[];globalThis.fetch=async(url,options)=>{mailCalls.push({url,options});return Response.json({id:'synthetic-email'})};
const next=async()=>{now+=300000;for(const row of providers?.providers||[])row.observedAt=now;return call('/tick')},open=async()=> (await call('/status')).data.incidents.filter(i=>i.status==='open');
try{
 const firstRun=call('/tick');
 await new Promise(resolve=>setImmediate(resolve));
 const running=(await call('/status')).data;
 assert.equal(running.lastStartedAt,now);assert.equal(running.lastCheckedAt,null);assert.equal(running.monitorRunning,true);
 now++;blockFirstProviderRead=false;firstProviderRead.resolve();await firstRun;
 assert.equal((await open()).length,0);assert.equal(reads,4);
 const initialReads=(await call('/status')).data;
 assert.equal(initialReads.lastStartedAt,now-1);assert.equal(initialReads.lastCheckedAt,now);assert.equal(initialReads.monitorRunning,false);
 assert.deepEqual(initialReads.monitorReadings,{
  providers:{status:'valid',received:1,expected:1,lastValidAt:now},
  playback:{status:'empty',lastValidAt:now-1},backups:{status:'valid',lastValidAt:now-1},catalogReferences:{status:'empty',lastValidAt:now}
 });
 providers=providerEnvelope('timeout');await next();assert.equal((await open()).length,0,'one provider timeout cannot send an alarm');
 const failedRead=(await call('/status')).data;
 assert.equal(failedRead.lastCheckedAt,now,'an execution can finish without a valid reading');
 assert.deepEqual(failedRead.monitorReadings.providers,{status:'unavailable',received:0,expected:1,lastValidAt:now-300000});
 const count=reads;await call('/tick');assert.equal(reads,count,'duplicate cron cannot re-probe or amplify a failure');
 await next();assert.equal((await open()).length,1);assert.equal((await call('/status')).data.history.length,1);
 const providerIncident=(await open())[0];
 assert.match(providerIncident.title,/agotó su plazo/);assert.match(providerIncident.detail,/Inventario.*120 ms.*Filas recibidas sin confirmar/);
 assert.ok(providerIncident.detail.includes(new Date(initialReads.lastStartedAt).toISOString()),'failures retain the last valid reading');
 assert.match(providerIncident.detail,/Ejecución [a-f0-9-]{36}/);
 await next();assert.equal((await call('/status')).data.history.length,1,'persistent outage creates one notification');assert.equal(mailCalls.length,0,'default channel never sends to an inferred recipient');
 providers=providerEnvelope();await next();assert.equal((await open()).length,1);await next();assert.equal((await open()).length,1);
 providers=providerEnvelope('timeout');await next();assert.equal((await call('/status')).data.history.length,1,'a brief provider recovery and relapse stay in the same incident');
 providers=providerEnvelope();await next();await next();await next();assert.equal((await open()).length,0);
 assert.equal((await call('/status')).data.history[0].changes[0].kind,'resolved');
 const group={server:'ccf',type:'series',quality:'1080',platform:'android',failedStarts:5,starts:0,reports:5,errors:5,stallPercent:0,startupP95UpperMs:null};
 playback.groups=[group];await next();assert.equal((await open())[0].kind,'playback');playback.groups=[];await next();assert.equal((await open())[0].waitingForSamples,true,'idle clients are not evidence of recovery');
 playback.groups=[{...group,failedStarts:0,starts:5,errors:0,startupP95UpperMs:2000}];await next();await next();await next();assert.equal((await open()).length,0);
 backups={...goodBackup(),automaticStatus:'failed'};await next();assert.ok((await open()).some(i=>i.key==='backup:daily'),'manual success does not hide an automatic failure');
 backups=goodBackup();await next();assert.equal((await open()).length,0);
 const priorValid=now;
 playback={groups:[null],timings:[]};backups={status:'invalid'};catalog={references:{},servers:[null]};await next();
 const partialRead=(await call('/status')).data;
 assert.deepEqual(partialRead.monitorReadings.playback,{status:'partial',lastValidAt:priorValid});
 assert.deepEqual(partialRead.monitorReadings.backups,{status:'unavailable',lastValidAt:priorValid});
 assert.deepEqual(partialRead.monitorReadings.catalogReferences,{status:'unavailable',lastValidAt:priorValid});
 assert.equal(partialRead.lastCheckedAt,now);assert.equal(partialRead.incidents.filter(i=>i.status==='open').length,0);
 providers={configuredIds:[sourceId,'synthetic-other'],providers:[providerSample()]};await next();
 const incompleteRead=(await call('/status')).data;
 assert.deepEqual(incompleteRead.monitorReadings.providers,{status:'partial',received:1,expected:2,lastValidAt:priorValid+300000});
 assert.equal(incompleteRead.incidents.filter(i=>i.status==='open'&&i.key.startsWith('monitor:')).length,2);
 providers=providerEnvelope();playback={groups:[],timings:[]};backups=goodBackup();catalog={references:[],servers:[]};await next();await next();
 assert.equal((await open()).length,0);
 const fresh=observations({providers:{configuredIds:[],providers:[]},playback:{groups:[]},backups:{automaticStatus:'unknown'}},now,now);assert.equal(fresh.find(i=>i.key==='backup:daily').bad,false,'give the first scheduled backup a real opportunity to run');
 const stale=observations({providers:{configuredIds:[],providers:[]},playback:{groups:[]},backups:{automaticStatus:'unknown'}},now+37*3600000,now);assert.equal(stale.find(i=>i.key==='backup:daily').bad,true);
 const runAt=now;
 const state={createdAt:runAt,config:{channel:'email',version:1},checks:{},incidents:{},history:[],outbox:[]};
 const observeProviders=(slot,data)=>applyObservations(state,{providers:data,runId:'synthetic-run'},runAt+slot*300000);
 observeProviders(0,providerEnvelope('timeout',runAt));
 observeProviders(2,providerEnvelope('timeout',runAt+600000));
 assert.equal(state.incidents[providerKey],undefined,'a missed slot breaks persistence');
 observeProviders(2,providerEnvelope('ok',runAt+600000));
 assert.equal(state.checks[providerKey].good,0,'a second sample in the slot cannot change the streak');
 observeProviders(3,providerEnvelope('credentials_unreadable',runAt+900000));
 const outage=state.incidents[providerKey],outageId=outage.id;
 assert.match(state.outbox[0].changes[0].title,/credenciales guardadas/);
 assert.match(state.outbox[0].changes[0].detail,/Credenciales guardadas.*Última lectura válida sin registro/);
 observeProviders(4,{});
 observeProviders(5,{configuredIds:[sourceId],providers:[]});
 observeProviders(6,{configuredIds:[],providers:[providerSample()]});
 observeProviders(7,{configuredIds:[sourceId],providers:[{...providerSample(),acceptedRows:3}]});
 assert.equal(outage.status,'open','missing, inconsistent and malformed samples keep the incident open');
 assert.equal(outage.waitingForSamples,true);assert.equal(outage.id,outageId);
 observeProviders(8,providerEnvelope('ok',runAt+2400000));
 observeProviders(9,providerEnvelope('ok',runAt+2700000));
 observeProviders(10,providerEnvelope('ok',runAt+2700000));
 observeProviders(11,providerEnvelope('ok',runAt+3300000));
 observeProviders(12,providerEnvelope('ok',runAt+3600000));
 assert.equal(outage.status,'open','a replayed reading cannot count and breaks the recovery streak');
 observeProviders(13,providerEnvelope('ok',runAt+3900000));
 assert.equal(outage.status,'resolved');assert.equal(state.history[0].changes[0].kind,'resolved');
 observeProviders(14,providerEnvelope('no_active_accounts',runAt+4200000));
 observeProviders(15,providerEnvelope('no_active_accounts',runAt+4500000));
 const emptyInventory=state.incidents[providerKey];
 assert.match(emptyInventory.title,/Inventario verificado sin cuentas activas/);
 assert.match(emptyInventory.detail,/Filas recibidas 0 · Aceptadas 0/);
 assert.ok(emptyInventory.detail.includes(new Date(runAt+4500000).toISOString()));
 observeProviders(16,{configuredIds:[],providers:[]});
 assert.equal(emptyInventory.status,'resolved');assert.equal(state.history[0].changes[0].kind,'removed');
 observeProviders(17,providerEnvelope('timeout',runAt+5100000));
 assert.equal(state.incidents[providerKey].id,emptyInventory.id,'a re-added source starts with a fresh streak');
 assert.equal((await call('/settings',{enabled:true,channel:'email',to:'invalid',from:'owner@example.com'})).status,400);
 assert.equal((await call('/settings',{enabled:true,channel:'email',to:'owner@example.com',from:'alerts@example.com'})).data.error,'alert_key_required');
 const apiKey='re_synthetic_key_only_for_tests';
 let result=await call('/settings',{enabled:true,channel:'email',to:'owner@example.com',from:'alerts@example.com',apiKey});assert.equal(result.status,200);assert.ok(result.data.settings.keyConfigured);
 assert.ok(!JSON.stringify([...store.data.values()]).includes(apiKey),'API key is encrypted at rest');assert.ok(!JSON.stringify(result).includes(apiKey));
 const legacyStore=new Store(),legacyState=await store.get('monitor');
 legacyState.outbox=[{id:'pending-before-update',createdAt:now,changes:[{id:'legacy-incident',kind:'opened',title:'Falla anterior',detail:'Detalle'}],attempts:1,nextAt:now,version:legacyState.config.version}];
 await legacyStore.put('monitor',legacyState);await new OperationsMonitor({storage:legacyStore},env).flush();
 const legacyDelivery=mailCalls.pop().options;
 assert.equal(legacyDelivery.headers['Idempotency-Key'],'snap-alert/pending-before-update');
 assert.deepEqual(JSON.parse(legacyDelivery.body),{from:'alerts@example.com',to:['owner@example.com'],subject:'SNAPTVNOW · Aviso del sistema',text:'SNAPTVNOW\n'+new Date(now).toISOString()+'\n\nINCIDENCIA: Falla anterior\nDetalle\n\nRevisa el panel: https://app.snaptvnow.com/admin.html'});
 // A grouped startup alarm and a backup failure can occur in the same tick.
 // Both stay in history; only the backup warrants an email.
 const mixedState={createdAt:now,config:{channel:'email',version:1},checks:{},incidents:{},history:[],outbox:[]};
 const slowStart={type:'live',platform:'other',requests:10,failures:0,stages:{total:{p95UpperMs:12000}}};
 applyObservations(mixedState,{playback:{groups:[],timings:[slowStart]},backups:{...goodBackup(),status:'failed'}},now);
 assert.equal(mixedState.history[0].changes.length,2);
 assert.deepEqual(mixedState.outbox[0].changes.map(change=>change.id),[mixedState.incidents['backup:creation'].id]);
 // An old startup-only retry must not delay a pending critical email. Mixed
 // events not yet sent can be filtered while preserving the full history.
 const legacyStartup={kind:'resolved',id:'retired-startup-id',title:'Inicio de contenido',detail:'Reproductor sin identificar'};
 const backupChange={kind:'opened',id:'active-backup',title:'Falló la copia automática',detail:'Detalle'};
 const legacyNotice=(id,changes)=>({id,changes,attempts:0,createdAt:now,nextAt:now,version:legacyState.config.version});
 const queuedAlerts=[legacyNotice('startup-only',[legacyStartup]),legacyNotice('mixed',[legacyStartup,backupChange])];
 queuedAlerts[0].nextAt=now+300000;
 legacyState.history=structuredClone(queuedAlerts);legacyState.outbox=queuedAlerts;
 await legacyStore.put('monitor',legacyState);
 await new OperationsMonitor({storage:legacyStore},env).flush();
 const filteredText=JSON.parse(mailCalls.pop().options.body).text;
 assert.match(filteredText,/Falló la copia automática/);assert.doesNotMatch(filteredText,/Inicio de contenido/);
 const delivered=await legacyStore.get('monitor');
 assert.equal(delivered.outbox.length,0);assert.equal(delivered.history[0].delivery,'panel');
 assert.equal(delivered.history[1].delivery,'accepted');assert.equal(delivered.history[1].changes.length,2);
 // A failed inventory probe can recover during the three-sample closure
 // window. No email is necessary unless a fresh, ongoing failure persists.
 const quietRun=async function(){
  const started=now,isolated=new Store(),quiet=new OperationsMonitor({storage:isolated},env);
  await isolated.put('monitor',{createdAt:now,config:legacyState.config,checks:{},incidents:{},history:[],outbox:[]});
  const probe=async(reason,flush=true)=>{
   const row=await isolated.get('monitor');
   const snapshot=reason===null?{}:{providers:providerEnvelope(reason,now)};
   applyObservations(row,snapshot,now,now,env);await isolated.put('monitor',row);
   if(flush)await quiet.flush();
   now+=300000;
  };
  try{
   await probe('timeout');await probe('timeout');
   for(let n=0;n<3;n++)await probe('ok');
   let row=await isolated.get('monitor');assert.equal(row.incidents[providerKey].status,'resolved');assert.equal(row.history[0].delivery,'panel');assert.equal(mailCalls.length,0);
   for(let n=0;n<5;n++)await probe('timeout');
   await probe(null);assert.equal(mailCalls.length,0,'time without observations cannot trigger a notice');
   for(let n=0;n<5;n++)await probe('timeout',false);
   row=await isolated.get('monitor');assert.equal(row.outbox.length,1);
   await probe('ok');assert.equal(mailCalls.length,0,'a queued first notice is dropped when a new good sample arrives');
   for(let n=0;n<6;n++)await probe('timeout');
   assert.equal(mailCalls.length,1);assert.match(JSON.parse(mailCalls[0].options.body).text,/PERSISTENTE/);
   for(let n=0;n<3;n++)await probe('ok');
   assert.equal(mailCalls.length,2);assert.match(JSON.parse(mailCalls[1].options.body).text,/RECUPERADO/);
   mailCalls.length=0;
   await probe('timeout');await probe('timeout');await probe('credentials_unreadable');
   assert.equal(mailCalls.length,1,'an actionable credential failure is escalated immediately');
   assert.match(JSON.parse(mailCalls[0].options.body).text,/credenciales guardadas/);
  }finally{now=started;mailCalls.length=0}
 };
 await quietRun();
 // Muting is independently reversible. It affects only delivery, including
 // sustained incidents, and never prevents tracking or confirmed recovery.
 for(const [switches,expected]of [
  [{},[]],
  [{STARTUP_INCIDENT_EMAIL_ENABLED:'true'},['startup']],
  [{PROVIDER_PROBE_EMAIL_ENABLED:'true'},['probe']]
 ]){
  const state={createdAt:now,config:legacyState.config,checks:{},incidents:{},history:[],outbox:[]};
  const sample=(slot,bad)=>{
   const at=now+slot*300000;
   applyObservations(state,{providers:providerEnvelope(bad?'timeout':'ok',at),playback:{timings:[bad?slowStart:{...slowStart,stages:{total:{p95UpperMs:1000}}}]}},at,at,switches);
  };
  for(let slot=0;slot<7;slot++)sample(slot,true);
  assert.deepEqual(state.outbox.flatMap(event=>event.changes.map(change=>change.family)),expected);
  assert.equal(Object.values(state.incidents).filter(incident=>incident.status==='open').length,2);
  // A deployment may mute alerts after the earlier opening email was accepted.
  for(const incident of Object.values(state.incidents))incident.notice='sent';
  state.outbox=[];
  for(let slot=7;slot<10;slot++)sample(slot,false);
  assert.deepEqual(state.outbox.flatMap(event=>event.changes.map(change=>change.family)),expected);
  assert.ok(Object.values(state.incidents).every(incident=>incident.status==='resolved'));
 }
 // Previously claimed mixed batches use the original key and omit disabled
 // categories from every outbound retry. Unrelated alerts are still sent.
 const migratedState=await store.get('monitor');
 const persistedChange={id:'old-start',kind:'opened',title:'PERSISTENTE · Demoras al iniciar contenido',confirmKey:'startup:live:other'};
 const oldProbe={id:'old-probe',kind:'opened',title:'Falló la comprobación de una fuente · La comprobación agotó su plazo'};
 const oldRecovery={id:'old-probe',kind:'resolved',title:'Comprobación de la fuente'};
 const oldCritical={id:'old-password',kind:'opened',title:'Falló la comprobación de una fuente · No se pudieron leer las credenciales guardadas'};
 const criticalRecovery={id:'old-password',kind:'resolved',title:'Comprobación de la fuente'};
 migratedState.history=[{id:'prev',changes:[oldProbe,oldCritical],delivery:'accepted'}];
 const pendingMuted=legacyNotice('pre-toggle-persistent',[persistedChange]),mixedRetry=legacyNotice('pre-toggle-retry',[oldRecovery,criticalRecovery,backupChange]);
 mixedRetry.attempts=1;mixedRetry.routed=true;
 migratedState.outbox=[pendingMuted,mixedRetry];
 const migratedStore=new Store();await migratedStore.put('monitor',migratedState);
 await new OperationsMonitor({storage:migratedStore},{...env,PROVIDER_PROBE_EMAIL_ENABLED:'false'}).flush();
 const retryOptions=mailCalls.pop().options;
 assert.equal(retryOptions.headers['Idempotency-Key'],'snap-alert/pre-toggle-retry');
 assert.doesNotMatch(JSON.parse(retryOptions.body).text,/Demoras al iniciar contenido/);
 assert.equal(JSON.parse(retryOptions.body).text.match(/Comprobación de la fuente/g)?.length,1);
 assert.match(JSON.parse(retryOptions.body).text,/Falló la copia automática/);
 assert.equal((await migratedStore.get('monitor')).outbox.length,0);
 const mailGroup={...group,reports:20};playback.groups=[mailGroup];await next();
 const incidentId=(await open()).find(i=>i.kind==='playback').id;
 assert.match(JSON.parse(mailCalls[0].options.body).text,new RegExp('Incidente: '+incidentId));
 playback.groups=[{...mailGroup,errors:6}];await next();assert.equal(mailCalls.length,1,'small fluctuations do not wake Gmail');
 playback.groups=[{...mailGroup,errors:10}];await next();assert.equal(mailCalls.length,2);
 const escalation=JSON.parse(mailCalls[1].options.body);assert.match(escalation.subject,/Aviso del sistema/);assert.match(escalation.text,/EMPEORAMIENTO/);assert.ok(escalation.text.includes(incidentId));
 await next();assert.equal(mailCalls.length,2,'the same severity is only sent once per incident');
 const evidenceState={createdAt:now,config:{channel:'email',version:1},checks:{},incidents:{},history:[],outbox:[]};
 const observe=(id,status,at)=>applyObservations(evidenceState,{playback:{groups:[mailGroup]},mediaFailures:[{server:mailGroup.server,type:mailGroup.type,id,httpStatuses:[status],lastObservedAt:at}]},at);
 observe('123',404,now);observe('123',404,now+300000);assert.equal(evidenceState.outbox.length,1,'a fresh timestamp is not new evidence');
 observe('123',502,now+600000);assert.equal(evidenceState.outbox.length,2);assert.match(evidenceState.history[0].changes[0].title,/EVIDENCIA NUEVA/);
 assert.equal(evidenceState.outbox[1].changes[0].id,evidenceState.outbox[0].changes[0].id);
 playback.groups=[];mailCalls=[];
 let failOnce=true;globalThis.fetch=async(url,options)=>{mailCalls.push({url,options});if(failOnce){failOnce=false;throw Error('private-credential-error')}return Response.json({id:'synthetic-email'})};
 backups={...goodBackup(),automaticStatus:'failed'};await next();assert.equal(mailCalls.length,1);result=await call('/status');assert.equal(result.data.pendingEmails,1);assert.equal(result.data.delivery.status,'email_unavailable');
 assert.ok(!JSON.stringify(result).includes('private-credential'));
 await next();assert.equal(mailCalls.length,2);assert.equal(mailCalls[0].options.headers['Idempotency-Key'],mailCalls[1].options.headers['Idempotency-Key']);assert.equal(mailCalls[0].options.body,mailCalls[1].options.body,'lost acknowledgement retries the same immutable email');
 assert.equal((await call('/status')).data.pendingEmails,0);await next();assert.equal(mailCalls.length,2,'a continuing backup failure does not spam the owner');
 backups=goodBackup();await next();assert.equal(mailCalls.length,3);assert.match(JSON.parse(mailCalls[2].options.body).text,/RECUPERADO/);
 assert.equal((await call('/test')).data.delivery.status,'accepted');assert.equal((await call('/test')).status,429);
 globalThis.fetch=async(url,options)=>{mailCalls.push({url,options});return Response.json({error:'synthetic-private-error'},{status:429,headers:{'Retry-After':'1200'}})};
 backups={...goodBackup(),automaticStatus:'failed'};await next();assert.equal((await call('/status')).data.delivery.status,'email_rate_limited');const mails=mailCalls.length;await next();assert.equal(mailCalls.length,mails,'honour the service retry deadline');
 result=await call('/settings',{enabled:true,channel:'email',to:'another-owner@example.com',from:'alerts@example.com'});assert.equal(result.data.pendingEmails,0,'recipient edits cannot reroute an old pending email');assert.equal(result.data.history[0].delivery,'cancelled');
 assert.equal((await call('/settings',{enabled:false,channel:'panel'})).status,200);const before=reads;await next();assert.equal(reads,before,'paused monitoring does not probe the provider');
 const stage=new OperationsMonitor({storage:new Store()},{...env,ENVIRONMENT:'staging'});assert.equal((await stage.tick()).skipped,true);assert.equal(reads,before);
 let active=0,max=0;
 const probe=await probeProviders(Array.from({length:7},(_,i)=>({source:'source-'+i,encrypted:'private-provider-password'})),{decrypt:async()=>({kind:'provider',username:'private-user',password:'private-password'}),validateAccount:async()=>{active++;max=Math.max(max,active);await Promise.resolve();active--;throw Error('private-provider-secret')},identifier:async source=>source,readPanel:async()=>{throw Error('must not be used')}});
 assert.equal(probe.providers.length,7);assert.ok(max<=3);assert.ok(probe.providers.every(p=>!p.ok));assert.ok(!JSON.stringify(probe).includes('private'));
 const causes=await probeProviders(
  ['decrypt','timeout','empty','partial'].map(source=>({source,encrypted:source})),{
   decrypt:async value=>value==='decrypt'?null:{kind:'reseller',username:value,password:'private-password'},
   readPanel:async (username,password,url,{onProgress})=>{
    if(username==='timeout')throw new DOMException('private-url','TimeoutError');
    if(username==='partial'){onProgress({receivedRows:20,acceptedRows:8});throw Error('panel_inventory_incomplete')}
    return {lines:[],inventory:[]};
   },identifier:async source=>source
  }
 );
 assert.deepEqual(causes.providers.map(({stage,reason,receivedRows,acceptedRows})=>[stage,reason,receivedRows,acceptedRows]),[
  ['credentials','credentials_unreadable',null,null],['panel_login','timeout',null,null],['inventory','no_active_accounts',0,0],['inventory','inventory_incomplete',20,8]
 ]);
 assert.ok(!JSON.stringify(causes).includes('private'));
 assert.deepEqual(causes.configuredIds,['decrypt','timeout','empty','partial']);
 const panelProgress=[];const loginFetch=globalThis.fetch;
 try{
  globalThis.fetch=async url=>String(url).includes('/table?')
   ?Response.json({recordsTotal:2,data:[[1,'synthetic-user','password','','<i title="Active">','','',0,1,'','',''],[]]})
   :new Response('dashboard');
  await assert.rejects(readPanel('synthetic-user','private-password',undefined,{inventory:true,onProgress:evidence=>panelProgress.push(evidence)}),/panel_inventory_incomplete/);
  assert.deepEqual(panelProgress,[{receivedRows:null,acceptedRows:null},{receivedRows:2,acceptedRows:0}]);
 }finally{globalThis.fetch=loginFetch}
 const directoryResponse=async (body,status=200)=>{
  const session=new PlaybackSession({storage:new Store()},{PLAYBACK_SESSIONS:{idFromName:name=>name,get:()=>({fetch:async()=>new Response(body,{status})})}});
  const response=await session.fetch(new Request('https://private/monitor-providers',{method:'POST',body:'{}'}));
  return {status:response.status,body:await response.json()};
 };
 for(const [body,status] of [['[]',503],['{}',200],['[{"encrypted":"private-password"}]',200],['invalid-private-value',200]]){
  assert.deepEqual(await directoryResponse(body,status),{status:503,body:{error:'monitor_provider_directory_unavailable'}});
 }
 assert.deepEqual(await directoryResponse('[]'),{status:200,body:{configuredIds:[],providers:[]}});
 const paths=[],pending=[];const scheduledEnv={ENVIRONMENT:'production',OPERATION_ALERTS:{idFromName:x=>x,get:()=>({fetch:async url=>{paths.push(new URL(url).pathname);return Response.json({ok:true})}})},PLAYBACK_SESSIONS:{idFromName:x=>x,get:()=>({fetch:async url=>{paths.push(new URL(url).pathname);return Response.json({ok:true})}})}};
 worker.scheduled({cron:MONITOR_CRON},scheduledEnv,{waitUntil:p=>pending.push(p)});await Promise.all(pending);assert.deepEqual([...paths].sort(),['/accounts/reseller-portal-config','/accounts/service-monitor-sample','/refresh-pool','/tick'],'scheduled inventory refresh must not fetch a second full pool or trigger daily backups');
 paths.length=0;pending.length=0;worker.scheduled({cron:'17 5 * * *'},scheduledEnv,{waitUntil:p=>pending.push(p)});await Promise.all(pending);assert.deepEqual(paths,['/accounts/backup-automatic','/tick']);
 paths.length=0;worker.scheduled({cron:MONITOR_CRON},{...scheduledEnv,ENVIRONMENT:'staging'},{waitUntil:p=>pending.push(p)});assert.equal(paths.length,0);
 const unauthorised=await worker.fetch(new Request('https://example.test/admin',{method:'POST',body:JSON.stringify({action:'alerts-status'})}),{TICKET_SECRET:env.TICKET_SECRET});assert.equal(unauthorised.status,401);
 console.log('PASS: persistent operational incidents, confirmed recovery, idle-sample uncertainty, encrypted delivery key, idempotent retry, recipient edits, rate limits, staging isolation, metadata probes and separate cron dispatch.');
}finally{Date.now=realNow;globalThis.fetch=realFetch}
