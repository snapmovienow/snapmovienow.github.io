import {canaryPresentation,reliabilityDuration,reliabilityReason,reliabilityType} from './admin-reliability.js?v=43.13';
import {channelAccessPresentation} from './admin-channel-observations.js?v=1';
import {mountTargetedCases} from './admin-targeted-cases.js?v=1';
export function initialRangeEvidenceText(value){
 const integer=n=>Number.isSafeInteger(n)&&n>=0;
 const range=(r,multiple=true)=>r?.kind==='absent'?'ausente':r?.kind==='invalid'?'no válido':r?.kind==='bytes'&&integer(r.start)&&(r.end===null||integer(r.end)&&r.end>=r.start)?r.start+'–'+(r.end===null?'fin':r.end):r?.kind==='suffix'&&integer(r.length)?'últimos '+r.length:r?.kind==='multiple'&&multiple&&Array.isArray(r.ranges)&&r.ranges.length>=2&&r.ranges.length<=4?r.ranges.map(part=>range(part,false)).join(', '):'desconocido';
 if(value?.phase!=='initial'||!['GET','HEAD'].includes(value?.method))return '416 inicial: rango no retenido';
 return '416 inicial '+value.method+' · Rango solicitado: '+range(value.incomingRange)+' · Enviado: '+range(value.outgoingRange)+' · Tamaño declarado: '+(integer(value.reportedTotal)?value.reportedTotal+' bytes':'desconocido')+' · If-Range: '+(value.ifRangePresent===true?'presente':value.ifRangePresent===false?'ausente':'desconocido')+' (no determina causa ni acredita la misma representación)';
}
export function mountAdminAlerts({api,container,notice}){
 const section=document.createElement('section');section.className='wide';section.id='automaticAlerts';
 section.innerHTML='<h2>Avisos automáticos</h2><p>El servidor comprueba cada cinco minutos el proveedor, las reproducciones y las copias, aunque este panel esté cerrado. Un fallo persistente abre una incidencia; la recuperación comprobada cierra esa incidencia.</p><p id="alertApiStatus" role="status">Consultando la API del panel…</p><p id="alertSummary" role="status" aria-live="polite">Cargando vigilancia…</p><ul id="alertReadings"></ul><div id="alertIncidents"></div><details><summary>Configurar avisos</summary><form id="alertForm"><label><input name="enabled" type="checkbox" style="width:auto"> Vigilancia activada</label><label>Recibir avisos<select name="channel"><option value="panel">Solo en el panel</option><option value="email">Panel y correo electrónico</option></select></label><div id="alertEmailFields" hidden><label>Correo que recibe los avisos<input name="to" type="email" maxlength="254" autocomplete="email"></label><label>Correo remitente verificado en Resend<input name="from" type="email" maxlength="254" autocomplete="off"></label><label>Clave de envío de Resend<input name="apiKey" type="password" maxlength="253" autocomplete="new-password" placeholder="Vacío: conservar la clave guardada"></label><p>La clave se guarda cifrada y no se vuelve a mostrar. El remitente debe estar autorizado en tu cuenta de Resend.</p><a href="https://resend.com/api-keys" target="_blank" rel="noopener noreferrer">Abrir claves de Resend</a></div><div class="toolbar"><button type="submit">Guardar avisos</button><button type="button" id="alertTest" class="secondary" disabled>Enviar correo de prueba</button></div></form></details><div class="toolbar" style="margin-top:18px"><button type="button" id="alertRefresh" class="secondary">Actualizar estado</button><button type="button" id="alertCheck" class="secondary">Comprobar ahora</button></div><p id="alertDelivery" role="status"></p><details><summary>Historial de incidencias y avisos</summary><div id="alertHistory"></div></details><p>Proveedor: dos comprobaciones fallidas consecutivas. Reproducción: cinco fallos de inicio o errores; con al menos cinco inicios, también demora superior a 10 segundos o más del 2 % del tiempo cargando. Se utiliza una ventana reciente de hasta 15 minutos. Copias automáticas: fallos o más de 36 horas sin una copia nueva. La falta de muestras de reproducción no confirma una recuperación.</p>';
 const reliability=document.createElement('div');reliability.innerHTML='<h3>Prueba automática de reproducción</h3><p>Comprueba el acceso, prepara un canal o una serie y espera los primeros datos de vídeo con tu cuenta propia de prueba. Utiliza una sesión separada y libera su conexión al terminar. Los tiempos hasta la primera imagen se reciben de la app.</p><p id="canarySummary" role="status" aria-live="polite">Cargando prueba automática…</p><p id="canaryAccount"></p><div id="canaryResults"></div><div class="toolbar"><button type="button" id="canaryToggle" class="secondary" disabled>Pausar prueba automática</button><button type="button" id="canaryRun" class="secondary" disabled>Probar reproducción ahora</button></div><details style="margin-top:18px"><summary>Fuentes y tiempos de inicio</summary><p>Las fuentes que fallan repetidamente se apartan temporalmente y se comprueba su recuperación. Una conexión que funciona conserva su cuenta asignada.</p><button type="button" id="diagnosticRefresh" class="secondary">Actualizar mediciones</button><p id="diagnosticSummary" role="status">Actualiza para consultar las mediciones recientes.</p><div id="diagnosticTimings"></div><h4>Contenidos con fallos recientes</h4><p>Hasta 30 contenidos observados en los últimos 30 minutos. No se ejecutan reproducciones nuevas. La ausencia de un contenido no confirma su recuperación.</p><div id="diagnosticFailures"></div></details>';
 const channelAccess=document.createElement('div');channelAccess.innerHTML='<h4>Acceso inicial de canales CCF · Medición pasiva</h4><p id="channelAccessSummary">Actualiza las mediciones para consultar las observaciones.</p><div id="channelAccessRows"></div><p>Clientes y pruebas se muestran por separado; un canal puede aparecer en varias filas. No se suman como canales distintos. Recibir bytes o un manifiesto no confirma audio, vídeo decodificado ni continuidad.</p>';reliability.querySelector('details').append(channelAccess);
 const targetedCases=mountTargetedCases({api,container:reliability.querySelector('details'),notice});
 section.insertBefore(reliability,section.querySelector('details'));container.append(section);const $=id=>section.querySelector('#'+id),form=$('alertForm');let epoch=0,busy=false,dirty=false,canaryBusy=false,lastData=null,lastCanary=null;
 const date=value=>value?new Date(value).toLocaleString():'Todavía sin comprobación';
 const delivery={panel:'Registrado en el panel',pending:'Correo pendiente de envío',accepted:'Correo aceptado por el servicio de envío',failed:'No se pudo enviar el correo',cancelled:'Envío cancelado al cambiar la configuración',expired:'Envío vencido',queue_full:'Cola de correo completa'};
 function deliveryMessage(data){const config=data.settings,outcome=data.delivery;return config.channel==='panel'?'Los avisos están registrados en el panel. El correo está sin conectar.':outcome.status==='accepted'?'Último correo aceptado por el servicio de envío: '+date(outcome.at)+'. Comprueba también tu bandeja de entrada.':outcome.status==='email_backlog_full'?'La cola de correo está llena. Las incidencias siguen visibles en el panel.':outcome.status==='email_rejected'?'El servicio rechazó el envío. Revisa la clave y el remitente.':outcome.status==='email_configuration_failed'?'No se pudo leer la clave de envío. Vuelve a guardarla.':outcome.status==='email_unavailable'?'No se pudo conectar con el servicio de envío. Se reintentará mientras el aviso esté pendiente.':outcome.status==='email_rate_limited'?'El servicio de envío alcanzó su límite. Se reintentará mientras el aviso esté pendiente.':'Correo configurado. Envía una prueba para comprobar que lo recibes.'}
 function emailFields(){const on=form.elements.channel.value==='email';$('alertEmailFields').hidden=!on;for(const name of ['to','from'])form.elements[name].required=on}
 function renderCanary(value){
  lastCanary=value||null;const view=canaryPresentation(value);
  $('canarySummary').textContent=view.summary+(value?.lastCheckedAt?' Última comprobación: '+date(value.lastCheckedAt)+'.':'');
  $('canaryAccount').textContent=view.configured?'Cuenta propia: '+String(value.username||'Configurada')+' · Una prueba cada '+(Number(value.intervalMinutes)||5)+' minutos, alternando canal y serie.':'La cuenta propia de prueba se configura en el servidor.';
  $('canaryResults').replaceChildren();
  for(const type of ['live','series']){
   const row=view.results.find(r=>r.type===type),article=document.createElement('p');
   article.textContent=reliabilityType(type)+': '+(!row?'Todavía sin prueba.':row.ok?'Primeros datos recibidos en '+reliabilityDuration(row.firstMediaByteMs)+' · Total '+reliabilityDuration(row.totalMs)+' · '+date(row.at):reliabilityReason(row.reason)+' · '+date(row.at));
   if(row?.stages){const detail=document.createElement('small');detail.style.display='block';detail.textContent=[['Acceso','authenticationMs'],['Preparación del catálogo','catalogPrepareMs'],['Respuesta del origen','mediaHeadersMs'],['Primeros datos','firstMediaByteMs']].map(([name,key])=>name+': '+reliabilityDuration(row.stages[key])).join(' · ');article.append(detail)}
   $('canaryResults').append(article);
  }
  $('canaryToggle').textContent=view.enabled?'Pausar prueba automática':'Activar prueba automática';
  $('canaryToggle').disabled=canaryBusy||!view.configured;
  $('canaryRun').disabled=canaryBusy||!view.configured||!view.enabled||view.running;
 }
 const readingLabels={providers:'Fuentes configuradas',playback:'Mediciones internas',backups:'Estado de copias',catalogReferences:'Referencias guardadas'};
 const readConfirmed=new Set(['valid','empty','not_configured']);
 const readingStates={valid:'Lectura válida',empty:'Lectura válida sin muestras',not_configured:'Sin fuentes configuradas',partial:'Lectura parcial',unavailable:'Lectura sin confirmar'};
 function renderMonitor(data,retained=false){
  const readings=data?.monitorReadings||{},entries=Object.keys(readingLabels).map(key=>readings[key]),open=data?.incidents.filter(i=>i.status==='open').length;
  const available=entries.some(row=>readConfirmed.has(row?.status)||row?.status==='partial');
  const missing=entries.some(row=>!readConfirmed.has(row?.status));
  const collection=!entries.some(Boolean)?'Lecturas por área pendientes de registrar':!available?'Lecturas sin confirmar':missing?'Lecturas parciales':'Lecturas registradas';
  const execution=data?.lastCheckedAt?'Última ejecución finalizada: '+date(data.lastCheckedAt):'Sin ejecución finalizada registrada';
  const status=!data?'Estado del monitor sin confirmar':!data.settings.enabled?'Vigilancia pausada':retained?'Último estado guardado en esta pantalla':data.monitorRunning?'Comprobación en curso':data.monitorStale?'Sin ejecución reciente':'';
  const attempt=data?.lastStartedAt>(data?.lastCheckedAt||0)?(data.monitorRunning&&!retained?'Inicio de la ejecución en curso: ':'Último intento registrado: ')+date(data.lastStartedAt):'';
  $('alertSummary').textContent=[status,execution,attempt,data?collection:'',open===undefined?'Incidencias abiertas sin confirmar':open===0?'0 incidencias abiertas registradas':open+' incidencias abiertas'].filter(Boolean).join(' · ');
  $('alertReadings').replaceChildren();
  for(const [key,label] of Object.entries(readingLabels)){
   const row=readings[key],item=document.createElement('li');
   const counts=Number.isSafeInteger(row?.expected)&&row.expected>0&&Number.isSafeInteger(row.received)?' · '+row.received+' de '+row.expected+' lecturas válidas':'';
   item.textContent=label+' · '+(readingStates[row?.status]||'Lectura sin registrar')+counts+' · Última lectura válida: '+(row?.lastValidAt?date(row.lastValidAt):'sin registro');
   $('alertReadings').append(item);
  }
  const owner=data?.ownerDiagnostic;
  if(owner){
   const item=document.createElement('li'),status=owner.stale?'Lectura vencida':({ok:'Lectura válida',attention:'Lectura válida con observaciones',running:'Ejecución en curso',failed:'Último intento fallido'}[owner.state]||'Lectura sin registrar');
   item.textContent='Diagnóstico privado del portal · '+status+' · Última lectura válida: '+(owner.lastValidAt?date(owner.lastValidAt):'sin registro');
   $('alertReadings').append(item);
  }
 }
 function renderMonitorError(error){
  const apiResponded=['operation_not_allowed','monitor_unavailable'].includes(error.code);
  $('alertApiStatus').textContent=apiResponded?'API del panel accesible · Estado del monitor no actualizado (HTTP '+error.status+').':error.status?'Respuesta HTTP '+error.status+' · Acceso a la API del panel sin confirmar.':'No se pudo confirmar el acceso a la API del panel.';
  renderMonitor(lastData,true);
 }
 function render(data,fill=false){
  if(typeof data?.settings?.enabled!=='boolean'||!Array.isArray(data.incidents)||data.incidents.some(i=>typeof i?.status!=='string')||!Array.isArray(data.history)||data.history.some(event=>!Array.isArray(event?.changes))||!data.delivery)throw Object.assign(Error('El estado del monitor llegó incompleto.'),{status:200,code:'monitor_status_invalid'});
  lastData=data;renderCanary(data.canary);
  const config=data.settings,open=data.incidents.filter(i=>i.status==='open');
  $('alertApiStatus').textContent='API del panel accesible.';
  renderMonitor(data);
  $('alertIncidents').replaceChildren();for(const incident of open){const article=document.createElement('article');article.style.cssText='border:1px solid #d89337;padding:14px;border-radius:8px;margin:12px 0;overflow-wrap:anywhere';const title=document.createElement('strong'),detail=document.createElement('p');title.textContent=incident.title;detail.textContent=(incident.detail?incident.detail+' · ':'')+'Desde '+date(incident.openedAt)+(incident.waitingForSamples?' · Sin muestras nuevas suficientes para confirmar recuperación.':'');article.append(title,detail);$('alertIncidents').append(article)}
  $('alertHistory').replaceChildren();for(const event of data.history){const p=document.createElement('p');p.textContent=date(event.createdAt)+' · '+event.changes.map(c=>({opened:'Incidencia: ',resolved:'Recuperado: ',removed:'Conexión retirada: ',test:'Prueba: '}[c.kind])+c.title).join(' / ')+' · '+(delivery[event.delivery]||'Registrado');p.style.overflowWrap='anywhere';$('alertHistory').append(p)}
  if(!data.history.length)$('alertHistory').textContent='Todavía no hay incidencias registradas.';
  $('alertDelivery').textContent=deliveryMessage(data);
  if(fill||!dirty){for(const key of ['to','from','channel'])form.elements[key].value=config[key]||'';form.elements.enabled.checked=config.enabled;form.elements.apiKey.value='';emailFields()}
  $('alertTest').disabled=!config.enabled||config.channel!=='email'||!config.keyConfigured||dirty;
 }
 async function canaryAction(action,body={}){
  if(canaryBusy)return;const generation=epoch;canaryBusy=true;renderCanary(lastCanary);
  try{const data=await api(action,body);if(generation!==epoch)return;const value=data.canary||data;if(lastData)lastData={...lastData,canary:value};renderCanary(value)}catch(error){if(generation===epoch)notice(error.message)}finally{if(generation===epoch){canaryBusy=false;renderCanary(lastCanary)}}
 }
 $('canaryToggle').onclick=()=>canaryAction('playback-canary-settings',{enabled:lastCanary?.enabled!==true});
 $('canaryRun').onclick=()=>canaryAction('playback-canary-run');
 $('diagnosticRefresh').onclick=async e=>{
  const generation=epoch,button=e.currentTarget;button.disabled=true;
  try{const data=await api('playback-diagnostics');if(generation!==epoch)return;
   const circuits=data.providers?.circuits||[],isolated=circuits.filter(r=>r.state==='open').reduce((n,r)=>n+(r.count||0),0),probing=circuits.filter(r=>r.state==='probing'||r.state==='ready_to_probe').reduce((n,r)=>n+(r.count||0),0);
   $('diagnosticSummary').textContent=isolated+' aislamientos temporales de cuenta o contenido · '+probing+' comprobaciones de recuperación activas o pendientes. Última observación: '+date(data.providers?.lastObservedAt)+'.';
   $('diagnosticTimings').replaceChildren();const names={total:'Inicio total',auth:'Acceso',catalog:'Catálogo',allocation:'Asignación',validation:'Validación del origen',origin:'Respuesta del origen',first_byte:'Primeros datos'};
   for(const group of data.timings?.groups||[]){const p=document.createElement('p');p.textContent=reliabilityType(group.type)+' · '+(group.platform==='android'?'Android':'Web / reproductor')+' · '+(group.requests||0)+' solicitudes · '+(group.failures||0)+' fallidas';
    for(const [key,row]of Object.entries(group.stages||{})){if(!names[key]||!row.samples)continue;const line=document.createElement('small');line.style.display='block';line.textContent=names[key]+': promedio medido '+reliabilityDuration(row.avgMs)+' · Límite superior del P95 estimado '+reliabilityDuration(row.p95UpperMs)+' · '+row.samples+' muestras';p.append(line)}
    if(group.errorCounts?.range_out_of_bounds>0)p.append(document.createTextNode(' · HTTP 416 con inicio del rango fuera del tamaño declarado: '+group.errorCounts.range_out_of_bounds));
    if(group.type==='movie')for(const row of group.catalogCost||[]){if(!['vod_info','stream_token'].includes(row.operation))continue;const line=document.createElement('small');line.style.display='block';line.textContent='Desglose de catálogo · '+(row.operation==='vod_info'?'Detalle de película':'Preparación de película')+' · '+row.requests+' solicitudes con desglose / '+row.lookups+' consultas: memoria '+row.cache.memory+', caché durable '+row.cache.durable+', sin caché utilizable '+row.cache.miss+'. Promedios: acceso local/caché '+reliabilityDuration(row.avgMs.localCache)+'; lectura API proveedor '+reliabilityDuration(row.avgMs.provider)+'; inventario/espera compartida sin separar '+reliabilityDuration(row.avgMs.unattributed)+'. Intervalos parciales que pueden solaparse: no sumar ni atribuir el tiempo total al servidor propio.';p.append(line)}$('diagnosticTimings').append(p)}
   if(!$('diagnosticTimings').childNodes.length)$('diagnosticTimings').textContent='Todavía no hay muestras de tiempos recientes. Esto no confirma que la reproducción esté funcionando.';
   $('diagnosticFailures').replaceChildren();
   for(const row of (data.providers?.recentMediaFailures||[]).slice(0,30)){
    const p=document.createElement('p');p.textContent=reliabilityType(row.type)+' · '+(row.title||'Nombre no disponible en el catálogo guardado')+' · ID '+row.id+' · Servidor '+row.server+' · '+row.ext+' · HTTP '+(row.httpStatuses||[]).join(', ')+' · Último fallo observado: '+date(row.lastObservedAt);for(const cause of (row.failureCauses||[]).slice(0,3)){if(cause.httpStatus!==504)continue;const label={local_deadline:'límite de espera local',upstream_response:'HTTP recibido del origen',unknown:'procedencia sin distinguir'}[cause.errorOrigin]||'procedencia sin distinguir';p.append(document.createTextNode(' · 504: '+label+' (no determina responsable ni fase)'));}for(const evidence of (row.rangeEvidence||[]).slice(0,3)){const line=document.createElement('small');line.style.display='block';line.textContent=initialRangeEvidenceText(evidence);p.append(line)}if(row.rangeEvidenceIncomplete)p.append(document.createTextNode(' · Evidencia 416 incompleta: datos ausentes o más de tres muestras únicas.'));$('diagnosticFailures').append(p);
   }
   if(!$('diagnosticFailures').childNodes.length)$('diagnosticFailures').textContent='Sin fallos identificables en esta muestra. No confirma recuperación de incidencias anteriores.';
   const access=channelAccessPresentation(data.channels,date);$('channelAccessSummary').textContent=access.summary;$('channelAccessRows').replaceChildren();for(const text of access.rows){const p=document.createElement('p');p.textContent=text;$('channelAccessRows').append(p)}
  }catch(error){if(generation===epoch)notice(error.message)}finally{if(generation===epoch)button.disabled=false}
 };
 async function refresh(){if(busy)return;const generation=epoch;busy=true;try{const data=await api('alerts-status');if(generation===epoch){render(data);await targetedCases.refresh()}}catch(error){if(generation!==epoch)return;renderMonitorError(error);if(!['operation_not_allowed','monitor_unavailable','monitor_status_invalid'].includes(error.code))throw error}finally{if(generation===epoch)busy=false}}
 form.oninput=()=>{dirty=true;$('alertTest').disabled=true;emailFields()};form.onchange=form.oninput;
 async function action(button,run,save=false){button.disabled=true;const generation=epoch;try{const data=await run();if(generation!==epoch)return;if(save)dirty=false;render(data,save)}catch(error){if(generation===epoch){if(button.id==='alertCheck'||error.code==='monitor_status_invalid')renderMonitorError(error);notice(error.message)}}finally{if(generation===epoch)button.disabled=button.id==='alertTest'?dirty||form.elements.channel.value!=='email':false}}
 form.onsubmit=e=>{e.preventDefault();action(form.querySelector('button[type="submit"]'),async()=>{const data=await api('alerts-settings',{enabled:form.elements.enabled.checked,channel:form.elements.channel.value,to:form.elements.to.value,from:form.elements.from.value,apiKey:form.elements.apiKey.value});notice('Configuración de avisos guardada.');return data},true)};
 $('alertRefresh').onclick=()=>refresh().catch(error=>notice(error.message));
 $('alertCheck').onclick=e=>action(e.target,()=>api('alerts-check'));
 $('alertTest').onclick=e=>action(e.target,async()=>{const data=await api('alerts-test');notice(deliveryMessage(data));return data});
 return {refresh,clear(){targetedCases.clear();epoch++;dirty=false;busy=false;canaryBusy=false;lastData=null;lastCanary=null;form.reset();form.elements.apiKey.value='';$('alertIncidents').replaceChildren();$('alertHistory').replaceChildren();$('alertSummary').textContent='';$('alertApiStatus').textContent='';$('alertReadings').replaceChildren();$('alertDelivery').textContent='';$('alertTest').disabled=true;renderCanary(null);$('diagnosticSummary').textContent='Actualiza para consultar las mediciones recientes.';$('diagnosticTimings').replaceChildren();$('diagnosticFailures').replaceChildren();$('channelAccessSummary').textContent='Actualiza las mediciones para consultar las observaciones.';$('channelAccessRows').replaceChildren();emailFields()}};
}
