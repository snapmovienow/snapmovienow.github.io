// One data model drives the desktop table and the mobile cards.
export function selectAccounts(accounts,{query='',status='all',source='all'}={}){
 const q=query.trim().toLocaleLowerCase();
 return accounts.flatMap(account=>{
  const observed=source==='all'?null:account.sources.find(s=>s.source===source);
  if(source!=='all'&&!observed)return [];
  const row=observed?.status?{...account,status:observed.status,eligible:observed.eligible,available:observed.eligible?account.available:0}:account;
  const matchesState=status==='all'||status==='active'&&row.status==='active'||status==='usable'&&row.eligible||
   status==='in_use'&&(row.reported>0||row.reserved>0)||status==='free'&&row.eligible&&row.reported===0&&row.reserved===0||
   status==='inactive'&&row.status!=='active';
  const matchesQuery=!q||[row.username,...row.sources.map(s=>s.name),...row.reservations.map(r=>r.username)].join(' ').toLocaleLowerCase().includes(q);
  return matchesState&&matchesQuery?[row]:[];
 });
}
const labels={active:'Activa',expired:'Vencida',suspended:'Suspendida',unavailable:'No disponible'};
const kinds={live:'TV en vivo',movie:'Película',series:'Serie',unknown:'Reproducción'};
export function activityLabels(reservation){
 const activity=reservation.activity||{},title=activity.seriesTitle||activity.title||'Título no disponible';
 const episode=reservation.type==='series'?[activity.season?'Temporada '+activity.season:'',activity.episode?'Episodio '+activity.episode:''].filter(Boolean).join(' · '):'';
 return {title,episode,detail:activity.seriesTitle&&activity.title!==activity.seriesTitle?activity.title:''};
}
export function createProviderView({document:doc,api,notice,onInventory=()=>{}}){
 const $=id=>doc.getElementById(id),size=25;
 let data=null,page=0,pending=null,epoch=0;
 const node=(tag,text,className)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e};
 const filters=()=>({query:$('providerSearch').value,status:$('providerState').value,source:$('providerSource').value});
 function sources(items){const select=$('providerSource'),previous=select.value;select.replaceChildren();for(const item of [{source:'all',name:'Todos los servidores'},...items]){const option=node('option',item.name);option.value=item.source;select.append(option)}select.value=items.some(s=>s.source===previous)?previous:'all'}
 function state(row){return node('span',row.status==='active'&&!row.eligible?'Activa · no utilizable':labels[row.status]||'No disponible','provider-badge '+(row.eligible?'is-active':'is-inactive'))}
 function sourceNames(row){
  const conflicting=new Set(row.sources.map(s=>s.status)).size>1;
  return row.sources.map(s=>s.name+(conflicting?' ('+(labels[s.status]||'No disponible')+')':'')).join(' · ');
 }
 function renderSourceInventory(source){
  const list=$('providerSourceInventory');if(!list)return;list.replaceChildren();
  for(const item of data.sources){
   if(!item.inventoryStatus||source!=='all'&&item.source!==source)continue;
   const status=item.inventoryStatus==='missing'?'Sin inventario propio':
    item.inventoryStatus==='partial'?'Inventario parcial · '+item.activeAccounts+' activas registradas · '+item.usableAccounts+' utilizables':
    item.receivedRows+' filas recibidas · '+item.activeAccounts+' activas · '+item.usableAccounts+' utilizables';
   list.append(node('li',item.name+' · '+status));
  }
  list.hidden=!list.childElementCount;
 }
 function users(row){const box=node('div');if(!row.reservations.length)box.append(node('span','Sin usuario SNAP','muted'));else for(const reservation of row.reservations){box.append(node('div',reservation.username+' · '+kinds[reservation.type]+' · '+(reservation.client==='xtream'?'App Xtream':'Web'),'provider-user'));const activity=activityLabels(reservation);box.append(node('span',activity.title+(activity.episode?' · '+activity.episode:''),'provider-user-content'))}return box}
 function render(){
  if(!data)return;
  const scope=filters();renderSourceInventory(scope.source);
  const selected=selectAccounts(data.accounts,scope),pages=Math.max(1,Math.ceil(selected.length/size));page=Math.min(page,pages-1);
  const visible=selected.slice(page*size,(page+1)*size),body=$('providerRows'),cards=$('providerCards');body.replaceChildren();cards.replaceChildren();
  for(const row of visible){
   const tr=node('tr');if(row.reserved)tr.className='is-assigned';
   const title=node('td');title.append(node('strong',row.username),node('small',sourceNames(row),'provider-source-name'));tr.append(title);
   const status=node('td');status.append(state(row));tr.append(status);
   for(const value of [row.maxConnections,row.reported,row.reserved,row.available])tr.append(node('td',String(value),'provider-number'));
   const assigned=node('td');assigned.append(users(row));tr.append(assigned);body.append(tr);
   const card=node('article',undefined,'provider-account-card'+(row.reserved?' is-assigned':'')),heading=node('div',undefined,'provider-card-heading');heading.append(node('strong',row.username),state(row));card.append(heading,node('p',sourceNames(row),'provider-source-name'));
   const counts=node('dl',undefined,'provider-card-counts');for(const [label,value] of [['Límite',row.maxConnections],['Uso proveedor',row.reported],['Reservas SNAP',row.reserved],['Asignables',row.available]]){const group=node('div');group.append(node('dt',label),node('dd',String(value)));counts.append(group)}card.append(counts,users(row));cards.append(card);
  }
  $('providerEmpty').hidden=selected.length!==0;$('providerPrevious').disabled=page===0;$('providerNext').disabled=page>=pages-1;
  $('providerPage').textContent=selected.length?`${page*size+1}–${Math.min((page+1)*size,selected.length)} de ${selected.length} cuentas`:'0 cuentas';
 }
 function show(next){
  data=next;sources(data.sources);
  for(const [id,value] of Object.entries({providerActive:data.summary.usableAccounts??data.summary.activeAccounts,providerCapacity:data.summary.totalCapacity,providerReported:data.summary.reported,providerReserved:data.summary.reserved,providerAvailable:data.summary.available}))$(id).textContent=String(value);
  const {accounts,receivedRows,activeAccounts}=data.summary;
  $('providerTotal').textContent=receivedRows===undefined?accounts+' cuentas guardadas':[
   receivedRows===null?'Total de filas recibidas sin confirmar':receivedRows+' filas recibidas',
   activeAccounts+' cuentas activas registradas',accounts+' cuentas únicas guardadas'
  ].join(' · ');
  const assignments=$('providerAssignments');assignments.replaceChildren();
  for(const item of data.assignments){const card=node('article',undefined,'provider-assignment'),identity=node('div',undefined,'provider-assignment-identity');identity.append(node('strong',item.username),node('span','→','muted'),node('strong',item.accountUsername,'account-pill'),node('span','Reserva activa','provider-badge is-active'));card.append(identity);const content=node('div',undefined,'provider-assignment-content'),activity=activityLabels(item);content.append(node('p',(kinds[item.type]||kinds.unknown)+' · '+(item.client==='xtream'?'App Xtream':'Web'),'muted'),node('strong',activity.title));if(activity.episode)content.append(node('p',activity.episode));if(activity.detail)content.append(node('p',activity.detail,'muted'));if(item.lastSeenAt)content.append(node('span','Última actividad: '+new Date(item.lastSeenAt).toLocaleTimeString(),'provider-assignment-time'));card.append(content);assignments.append(card)}
  $('providerNoAssignments').hidden=!!data.assignments.length;
  const times=[...data.sources,...data.accounts].map(a=>a.syncedAt).filter(Boolean),synced=times.length?Math.min(...times):null;
  $('providerUpdated').textContent=synced?'Lectura guardada más antigua: '+new Date(synced).toLocaleString():'Inventario pendiente de comprobar.';
  const warning=$('providerWarning');warning.textContent=data.refreshError||(data.stale?'Se muestran datos guardados de una o más fuentes. Los cupos pueden haber cambiado.':'');warning.hidden=!warning.textContent;
  onInventory({summary:data.summary,generatedAt:data.generatedAt,stale:data.stale,refreshError:data.refreshError});
  render();
 }
 async function load(refresh=false){
  if(pending)return pending;
  const current=epoch,button=$('providerRefresh');button.disabled=true;button.textContent=refresh?'Comprobando…':'Cargando…';
  const work=(async()=>{try{const next=await api('provider-dashboard',{refresh});if(epoch!==current)return;show(next)}catch(error){if(epoch!==current)return;const warning=$('providerWarning');warning.textContent=data?'No se pudo actualizar. Conservamos la última vista; sus cupos pueden haber cambiado.':'No se pudo cargar el inventario. Pulsa Actualizar para intentarlo de nuevo.';warning.hidden=false;onInventory(data?{summary:data.summary,generatedAt:data.generatedAt,stale:true}:null);if(!data)notice(error.message)}finally{if(epoch===current){pending=null;button.disabled=false;button.textContent='Actualizar'}}})();
  pending=work;return work;
 }
 function clear(){epoch++;pending=null;data=null;page=0;for(const id of ['providerRows','providerCards','providerAssignments'])$(id).replaceChildren();const sourceInventory=$('providerSourceInventory');if(sourceInventory){sourceInventory.replaceChildren();sourceInventory.hidden=true}for(const id of ['providerActive','providerCapacity','providerReported','providerReserved','providerAvailable'])$(id).textContent='—';$('providerRefresh').disabled=false;$('providerRefresh').textContent='Actualizar';$('providerSearch').value='';$('providerState').value='all';sources([]);$('providerTotal').textContent='Cargando cuentas…';$('providerUpdated').textContent='Inventario pendiente de comprobar.';$('providerWarning').textContent='';$('providerWarning').hidden=true;$('providerNoAssignments').hidden=false;$('providerPage').textContent='0 cuentas';$('providerPrevious').disabled=true;$('providerNext').disabled=true}
 for(const id of ['providerSearch','providerState','providerSource'])$(id).addEventListener(id==='providerSearch'?'input':'change',()=>{page=0;render()});
 $('providerPrevious').onclick=()=>{page--;render()};$('providerNext').onclick=()=>{page++;render()};$('providerRefresh').onclick=()=>load(true);
 return {load,clear};
}
