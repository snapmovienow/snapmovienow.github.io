const TYPES=[['live','TV'],['movie','Películas'],['series','Series']];
const LIST_STATES={delivered:'Respuesta generada',empty:'Lista vacía',failed:'Respuesta con error',restricted:'Acceso restringido',not_observed:'Sin registro'};
const INCIDENT_STATES={open:'En revisión',investigating:'Investigando',fixed_pending:'Corregido · pendiente de validar',resolved:'Resuelto'};
const ERRORS={support_not_found:'Esta cuenta ya no está disponible. Actualiza la lista de usuarios.',support_conflict:'La incidencia cambió en otra sesión. Actualiza la ficha antes de guardar.',invalid_support_input:'Revisa el título y el estado de la incidencia.',invalid_support_note:'Escribe una nota breve sin contraseñas, enlaces ni direcciones IP.',support_unavailable:'La información de soporte no está disponible en este momento.'};
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const text=(value,max=2000)=>typeof value==='string'?value.slice(0,max):'';
const stamp=(value,now)=>Number.isSafeInteger(value)&&value>0&&value<=8640000000000000&&value<=now+60000?value:null;

export function supportTimestamp(value,now=Date.now()){
 const at=stamp(value,now);if(at===null)return 'Sin registro';
 const age=Math.max(0,now-at),relative=age<60000?'hace menos de un minuto':age<3600000?'hace '+Math.floor(age/60000)+' min':age<86400000?'hace '+Math.floor(age/3600000)+' h':'hace '+Math.floor(age/86400000)+' días';
 return new Date(at).toLocaleString('es',{dateStyle:'medium',timeStyle:'short'})+' · '+relative;
}

// Present only the documented facts. Missing or malformed values remain unknown.
export function clientSupportPresentation(data,now=Date.now()){
 const lists=Array.isArray(data?.lists)?data.lists:[],check=data?.check||{},customer=data?.customer||{};
 const access={active:'Cuenta activa',expired:'Cuenta vencida',suspended:'Cuenta suspendida'}[check.access]||'Estado de acceso sin comprobar';
 const permissions=check.permissions&&typeof check.permissions==='object'?check.permissions:null;
 const enabled=permissions?TYPES.filter(([type])=>permissions[{live:'tv',movie:'movies',series:'series'}[type]]===true).map(([,label])=>label):[];
 const source=check.source||{},sourceAt=stamp(source.observedAt,now),sourceState=source.status==='observed'&&sourceAt!==null?'Observación guardada':source.status==='stale'&&sourceAt!==null?'Observación antigua':'Sin comprobar';
 return {customer:{id:text(customer.id,100),username:text(customer.username,80),name:text(customer.name,160)},checkedAt:stamp(data?.checkedAt,now),recordingSince:stamp(data?.recordingSince,now),
  lists:TYPES.map(([type,label])=>{const row=lists.find(row=>row?.type===type)||{},state=Object.hasOwn(LIST_STATES,row.status)?row.status:'not_observed';return {type,label,state,status:LIST_STATES[state],requestedAt:stamp(row.lastRequestedAt,now),respondedAt:stamp(row.lastRespondedAt,now),httpStatus:Number.isInteger(row.httpStatus)&&row.httpStatus>=100&&row.httpStatus<=599?row.httpStatus:null,itemCount:count(row.itemCount),selection:row.selection==='category'?'Categoría solicitada':row.selection==='source'?'Lista de una fuente':row.selection==='all'?'Lista completa':'Alcance sin registrar',access:row.access==='xtream'?'Acceso Xtream':row.access==='api'?'Acceso API':'Acceso sin registrar'};}),
  check:{access,accessState:['active','expired','suspended'].includes(check.access)?check.access:'unknown',checkedAt:stamp(check.checkedAt,now),expiry:stamp(customer.expiresAt,Number.MAX_SAFE_INTEGER),noExpiry:customer.expiresAt===null,permissions:permissions?enabled.length?enabled.join(', '):'Sin secciones habilitadas':'Sin comprobar',connections:check.connections?.status==='observed'&&count(check.connections.reserved)!==null?String(check.connections.reserved)+' reservas registradas · límite '+(count(check.connections.limit)??3):'Reservas: sin comprobar',sourceState,sourceStatus:source.status==='stale'?'stale':sourceState==='Sin comprobar'?'unknown':'observed',sourceAt,usableAccounts:count(source.usableAccounts)},
  incidents:data?.incidents&&typeof data.incidents==='object'?data.incidents:{rows:[],total:0,page:1,pages:1,retentionDays:30}};
}

export function mountAdminSupport({api,notice=()=>{},container=globalThis.document.body}){
 const doc=container.ownerDocument||globalThis.document;
 const node=(tag,value,className)=>{const element=doc.createElement(tag);if(value!==undefined)element.textContent=value;if(className)element.className=className;return element;};
 const action=(label,key,handler,className='secondary')=>{const button=node('button',label,className);button.type='button';button.dataset.action=key;button.onclick=handler;return button;};
 const dialog=node('dialog',undefined,'client-support');dialog.id='clientSupport';dialog.setAttribute('aria-labelledby','clientSupportTitle');dialog.setAttribute('aria-describedby','clientSupportScope');
 const header=node('header',undefined,'support-header'),heading=node('h2','Soporte del cliente');heading.id='clientSupportTitle';
 const close=action('Cerrar','close',()=>clear());close.setAttribute('aria-label','Cerrar soporte');header.append(heading,close);
 const identity=node('p',undefined,'support-identity'),scope=node('p','Datos por cuenta. Las solicitudes pueden proceder de cualquiera de sus aparatos.','support-caption');scope.id='clientSupportScope';
 const status=node('p',undefined,'support-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const toolbar=node('div',undefined,'support-toolbar'),updated=node('p',undefined,'support-caption'),refresh=action('Actualizar ficha','refresh',()=>load('client-support-read'));
 toolbar.append(updated,refresh);
 const body=node('div',undefined,'support-body');
 const card=(title,number)=>{const section=node('section',undefined,'support-card'),h=node('h3');const n=node('span',String(number),'support-number');n.setAttribute('aria-hidden','true');h.append(n,doc.createTextNode(title));section.append(h);return section;};
 const listCard=card('Última solicitud de listas',1),listRows=node('div',undefined,'support-lists'),recording=node('p',undefined,'support-caption');
 listCard.append(listRows,node('p','Registra solicitudes al servidor; no confirma que la app guardó el catálogo.','support-caption'),recording);
 const checkCard=card('Comprobar cuenta',2),checkButton=action('Comprobar ahora','check',()=>load('client-support-check'),'support-primary'),checkRows=node('dl',undefined,'support-check');
 checkCard.append(checkButton,checkRows,node('p','Esta comprobación consulta permisos, vigencia y observaciones guardadas. No inicia reproducción ni valida el televisor o su conexión a Internet.','support-caption'));
 const historyCard=card('Historial de incidencias',3),historyRows=node('div',undefined,'support-incidents'),historyCaption=node('p',undefined,'support-caption'),pagination=node('div',undefined,'support-pagination');
 const previous=action('Anterior','previous',()=>load('client-support-read',Math.max(1,page-1))),next=action('Siguiente','next',()=>load('client-support-read',page+1)),pageLabel=node('span');pagination.append(previous,pageLabel,next);
 const details=node('details',undefined,'support-new'),summary=node('summary','Registrar incidencia'),newForm=node('form'),titleLabel=node('label','Título'),titleInput=node('input');titleInput.name='title';titleInput.required=true;titleInput.minLength=3;titleInput.maxLength=160;titleInput.autocomplete='off';titleLabel.append(titleInput);
 const noteLabel=node('label','Nota opcional'),noteInput=node('textarea');noteInput.name='note';noteInput.maxLength=2000;noteInput.rows=3;noteLabel.append(noteInput);
 const add=node('button','Registrar incidencia','support-primary');add.type='submit';add.dataset.action='add-incident';newForm.append(titleLabel,noteLabel,node('p','Evita contraseñas y enlaces.','support-caption'),add);details.append(summary,newForm);
 historyCard.append(historyRows,historyCaption,pagination,details);
 body.append(listCard,checkCard,historyCard);dialog.append(header,identity,scope,status,toolbar,body);container.append(dialog);
 let generation=0,selected=null,busy=false,page=1,restoreFocus=null;
 const errorMessage=error=>ERRORS[error?.code]||ERRORS[error?.message]||'No se pudo completar la consulta. Los datos anteriores conservan sus fechas.';
 const controls=()=>[refresh,checkButton,previous,next,titleInput,noteInput,add,...historyRows.querySelectorAll('button,input,textarea,select')];
 function setBusy(value){busy=value;for(const control of controls())control.disabled=value;previous.disabled=value||page<=1;next.disabled=value||page>=Number(pagination.dataset.pages||1);dialog.setAttribute('aria-busy',String(value));}
 function resetContent(){identity.textContent='';updated.textContent='';status.textContent='';listRows.replaceChildren();checkRows.replaceChildren();historyRows.replaceChildren();historyCaption.textContent='';recording.textContent='';pageLabel.textContent='';pagination.hidden=true;pagination.dataset.pages='1';titleInput.value='';noteInput.value='';details.open=false;body.hidden=true;}
 function clear(){generation++;selected=null;page=1;setBusy(false);resetContent();heading.textContent='Soporte del cliente';if(dialog.open)dialog.close();if(restoreFocus?.isConnected)restoreFocus.focus();restoreFocus=null;}
 dialog.addEventListener('close',()=>{if(!dialog.open&&selected)clear();});
 dialog.addEventListener('cancel',event=>{event.preventDefault();clear();});
 function keyValue(label,value,state){const term=node('dt',label),detail=node('dd',value);if(state)detail.dataset.state=state;checkRows.append(term,detail);}
 function render(data){
  if(!data||typeof data!=='object'||Array.isArray(data)||!data.customer||String(data.customer.username||'').toLocaleLowerCase()!==selected.username.toLocaleLowerCase()||selected.id&&data.customer.id&&selected.id!==data.customer.id)throw Error('support_invalid_response');
  const view=clientSupportPresentation(data),now=Date.now();body.hidden=false;identity.textContent=view.customer.name||'';updated.textContent='Datos consultados: '+supportTimestamp(view.checkedAt,now);recording.textContent=view.recordingSince?'Registro disponible desde '+supportTimestamp(view.recordingSince,now)+'.':'Las solicitudes se registran a partir de la activación de esta función.';
  listRows.replaceChildren();
  for(const row of view.lists){const entry=node('article',undefined,'support-list-row');entry.dataset.type=row.type;const head=node('div',undefined,'support-list-heading'),name=node('h4',row.label),badge=node('span',row.status,'support-badge');badge.dataset.state=row.state;head.append(name,badge);entry.append(head,node('p','Última solicitud: '+supportTimestamp(row.requestedAt,now)),node('p','Respuesta: '+supportTimestamp(row.respondedAt,now),'support-caption'));
   if(row.requestedAt!==null){const facts=[row.selection,row.access];if(row.httpStatus!==null)facts.push('HTTP '+row.httpStatus);if(row.itemCount!==null)facts.push(row.itemCount+' elementos');entry.append(node('p',facts.join(' · '),'support-caption'));}listRows.append(entry);}
  checkRows.replaceChildren();keyValue('Acceso',view.check.access,view.check.accessState);keyValue('Vigencia',view.check.expiry?new Date(view.check.expiry).toLocaleString('es',{dateStyle:'medium',timeStyle:'short'}):view.check.noExpiry?'Sin vencimiento configurado':'Sin comprobar');keyValue('Contenido habilitado',view.check.permissions);keyValue('Actividad registrada',view.check.connections);keyValue('Fuente',view.check.sourceState,view.check.sourceStatus);keyValue('Última observación guardada',supportTimestamp(view.check.sourceAt,now));if(view.check.usableAccounts!==null)keyValue('Inventario general guardado',view.check.usableAccounts+' cuentas utilizables');keyValue('Comprobación de datos',supportTimestamp(view.check.checkedAt,now));
  renderIncidents(view.incidents,now);status.textContent='';
 }
 function renderIncidents(value,now){
  historyRows.replaceChildren();const rows=Array.isArray(value.rows)?value.rows.slice(0,25):[];
  if(!rows.length)historyRows.append(node('p','No hay incidencias registradas para esta cuenta.','support-empty'));
  for(const row of rows){
   const id=text(row?.id,100);if(!id)continue;
   const article=node('article',undefined,'support-incident'),h=node('h4',text(row.title,160)||'Incidencia registrada'),label=node('span',INCIDENT_STATES[row.status]||'Estado sin comprobar','support-badge');label.dataset.state=Object.hasOwn(INCIDENT_STATES,row.status)?row.status:'unknown';article.append(h,label,node('p','Primera observación: '+supportTimestamp(row.firstSeenAt,now),'support-caption'),node('p','Última observación: '+supportTimestamp(row.lastSeenAt,now),'support-caption'));if(stamp(row.updatedAt,now)!==null)article.append(node('p','Seguimiento actualizado: '+supportTimestamp(row.updatedAt,now),'support-caption'));
   const facts=[];if(row.type==='manual')facts.push('Registro manual');else if(row.type==='catalog')facts.push('Solicitud de catálogo');else if(row.type==='playback')facts.push('Respuesta de reproducción');if(count(row.count)!==null)facts.push(row.count+' observaciones registradas');if(Number.isInteger(row.httpStatus)&&row.httpStatus>=400&&row.httpStatus<=599)facts.push('HTTP '+row.httpStatus);if(/^\d{1,16}$/.test(String(row.publicId||'')))facts.push('Referencia '+row.publicId);if(typeof row.code==='string'&&/^[a-z_]{1,60}$/.test(row.code))facts.push('Código: '+row.code);if(facts.length)article.append(node('p',facts.join(' · '),'support-caption'));
   const form=node('form',undefined,'support-incident-form'),stateLabel=node('label','Estado'),select=node('select');select.setAttribute('aria-label','Estado de incidencia: '+(text(row.title,160)||id));for(const [key,label]of Object.entries(INCIDENT_STATES)){const option=node('option',label);option.value=key;select.append(option);}select.value=Object.hasOwn(INCIDENT_STATES,row.status)?row.status:'open';stateLabel.append(select);
   const labelNote=node('label','Nota opcional'),note=node('textarea');note.value=text(row.note,2000);note.maxLength=2000;note.rows=3;note.setAttribute('aria-label','Nota de incidencia: '+(text(row.title,160)||id));labelNote.append(note);const save=node('button','Guardar seguimiento','secondary');save.type='submit';save.dataset.action='save-incident';form.append(stateLabel,labelNote,node('p','Evita contraseñas y enlaces.','support-caption'),save);
   form.onsubmit=event=>{event.preventDefault();return saveIncident({id,status:select.value,note:note.value,expectedRevision:row.revision},page);};article.append(form);historyRows.append(article);
  }
  const total=count(value.total),pages=Number.isSafeInteger(value.pages)&&value.pages>0?value.pages:1;page=Number.isSafeInteger(value.page)&&value.page>0?Math.min(value.page,pages):1;pagination.dataset.pages=String(pages);pagination.hidden=pages<=1;pageLabel.textContent='Página '+page+' de '+pages;historyCaption.textContent=(total===null?'Total sin comprobar':total+' incidencias registradas')+' · Historial de '+(count(value.retentionDays)??30)+' días. Un éxito en otro contenido no resuelve una incidencia anterior.';
 }
 async function load(action='client-support-read',requestedPage=page){
  if(!selected||busy)return;const epoch=generation,target={...selected};setBusy(true);status.textContent=action==='client-support-check'?'Comprobando datos de la cuenta…':'Consultando ficha…';
  try{const data=await api(action,{username:target.username,page:requestedPage,pageSize:25});if(epoch===generation&&selected)render(data);}catch(error){if(epoch===generation&&selected)status.textContent=errorMessage(error);}finally{if(epoch===generation)setBusy(false);}
 }
 async function saveIncident(value,requestedPage=page){
  if(!selected||busy)return;const epoch=generation,target={...selected};setBusy(true);status.textContent='Guardando seguimiento…';
  try{await api('client-support-incident-save',{username:target.username,...value});if(epoch!==generation||!selected)return;titleInput.value='';noteInput.value='';details.open=false;const data=await api('client-support-read',{username:target.username,page:requestedPage,pageSize:25});if(epoch===generation&&selected){render(data);status.textContent='Seguimiento guardado.';}}catch(error){if(epoch===generation&&selected)status.textContent=errorMessage(error);}finally{if(epoch===generation)setBusy(false);}
 }
 newForm.onsubmit=event=>{event.preventDefault();const title=titleInput.value.trim();if(title.length<3||title.length>160){status.textContent='Escribe un título de entre 3 y 160 caracteres.';titleInput.focus();return;}return saveIncident({title,status:'open',note:noteInput.value},1);};
 resetContent();setBusy(false);
 return {async open(user){if(!user||typeof user.username!=='string'||!user.username)return;generation++;selected={username:user.username,id:user.id};page=1;busy=false;resetContent();heading.textContent='Soporte de '+user.username;if(!dialog.open){restoreFocus=doc.activeElement;dialog.showModal();}return load();},clear};
}
