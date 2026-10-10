// One data model drives the desktop table and the mobile cards.
export function selectAccounts(accounts,{query='',status='all',source='all'}={}){
 const q=query.trim().toLocaleLowerCase();
 return accounts.filter(a=>(source==='all'||a.sources.some(s=>s.source===source))&&
  (status==='all'||status==='active'&&a.eligible||status==='in_use'&&(a.reported>0||a.reserved>0)||status==='free'&&a.eligible&&a.reported===0&&a.reserved===0||status==='inactive'&&!a.eligible)&&
  (!q||[a.username,...a.sources.map(s=>s.name),...a.reservations.map(r=>r.username)].join(' ').toLocaleLowerCase().includes(q)));
}
const labels={active:'Activa',expired:'Vencida',suspended:'Suspendida',unavailable:'No disponible'};
const kinds={live:'TV en vivo',movie:'Película',series:'Serie',unknown:'Reproducción'};
export function createProviderView({document:doc,api,notice,onInventory=()=>{}}){
 const $=id=>doc.getElementById(id),size=25;
 let data=null,page=0,pending=null,epoch=0;
 const node=(tag,text,className)=>{const e=doc.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e};
 const filters=()=>({query:$('providerSearch').value,status:$('providerState').value,source:$('providerSource').value});
 function sources(items){const select=$('providerSource'),previous=select.value;select.replaceChildren();for(const item of [{source:'all',name:'Todos los servidores'},...items]){const option=node('option',item.name);option.value=item.source;select.append(option)}select.value=items.some(s=>s.source===previous)?previous:'all'}
 function state(row){return node('span',labels[row.status]||'No disponible','provider-badge '+(row.eligible?'is-active':'is-inactive'))}
 function users(row){const box=node('div');if(!row.reservations.length)box.append(node('span','Sin usuario SNAP','muted'));else for(const reservation of row.reservations)box.append(node('div',reservation.username+' · '+kinds[reservation.type]+' · '+(reservation.client==='xtream'?'App Xtream':'Web'),'provider-user'));return box}
 function render(){
  if(!data)return;
  const selected=selectAccounts(data.accounts,filters()),pages=Math.max(1,Math.ceil(selected.length/size));page=Math.min(page,pages-1);
  const visible=selected.slice(page*size,(page+1)*size),body=$('providerRows'),cards=$('providerCards');body.replaceChildren();cards.replaceChildren();
  for(const row of visible){
   const tr=node('tr');if(row.reserved)tr.className='is-assigned';
   const title=node('td');title.append(node('strong',row.username),node('small',row.sources.map(s=>s.name).join(' · '),'provider-source-name'));tr.append(title);
   const status=node('td');status.append(state(row));tr.append(status);
   for(const value of [row.maxConnections,row.reported,row.reserved,row.available])tr.append(node('td',String(value),'provider-number'));
   const assigned=node('td');assigned.append(users(row));tr.append(assigned);body.append(tr);
   const card=node('article',undefined,'provider-account-card'+(row.reserved?' is-assigned':'')),heading=node('div',undefined,'provider-card-heading');heading.append(node('strong',row.username),state(row));card.append(heading,node('p',row.sources.map(s=>s.name).join(' · '),'provider-source-name'));
   const counts=node('dl',undefined,'provider-card-counts');for(const [label,value] of [['Límite',row.maxConnections],['Uso proveedor',row.reported],['Reservas SNAP',row.reserved],['Asignables',row.available]]){const group=node('div');group.append(node('dt',label),node('dd',String(value)));counts.append(group)}card.append(counts,users(row));cards.append(card);
  }
  $('providerEmpty').hidden=selected.length!==0;$('providerPrevious').disabled=page===0;$('providerNext').disabled=page>=pages-1;
  $('providerPage').textContent=selected.length?`${page*size+1}–${Math.min((page+1)*size,selected.length)} de ${selected.length} cuentas`:'0 cuentas';
 }
 function show(next){
  data=next;sources(data.sources);
  for(const [id,value] of Object.entries({providerActive:data.summary.activeAccounts,providerCapacity:data.summary.totalCapacity,providerReported:data.summary.reported,providerReserved:data.summary.reserved,providerAvailable:data.summary.available}))$(id).textContent=String(value);
  $('providerTotal').textContent=data.summary.accounts+' cuentas guardadas';
  const assignments=$('providerAssignments');assignments.replaceChildren();
  for(const item of data.assignments){const card=node('div',undefined,'provider-assignment');card.append(node('strong',item.username),node('span','→','muted'),node('strong',item.accountUsername,'account-pill'),node('span',kinds[item.type]+' · '+(item.client==='xtream'?'App Xtream':'Web'),'muted'));assignments.append(card)}
  $('providerNoAssignments').hidden=!!data.assignments.length;
  const times=data.accounts.map(a=>a.syncedAt).filter(Boolean),synced=times.length?Math.min(...times):null;
  $('providerUpdated').textContent=synced?'Inventario comprobado: '+new Date(synced).toLocaleString():'Inventario pendiente de comprobar.';
  const warning=$('providerWarning');warning.textContent=data.refreshError||(data.stale?'El proveedor no confirmó la última actualización. Se muestran datos guardados; los cupos pueden haber cambiado.':'');warning.hidden=!warning.textContent;
  onInventory({summary:data.summary,generatedAt:data.generatedAt,stale:data.stale,refreshError:data.refreshError});
  render();
 }
 async function load(refresh=false){
  if(pending)return pending;
  refresh=refresh||!data;
  const current=epoch,button=$('providerRefresh');button.disabled=true;button.textContent=refresh?'Comprobando…':'Actualizando…';
  const work=(async()=>{try{const next=await api('provider-dashboard',{refresh});if(epoch!==current)return;show(next)}catch(error){if(epoch!==current)return;const warning=$('providerWarning');warning.textContent=data?'No se pudo actualizar. Conservamos la última vista; sus cupos pueden haber cambiado.':'No se pudo cargar el inventario. Pulsa Actualizar para intentarlo de nuevo.';warning.hidden=false;onInventory(data?{summary:data.summary,generatedAt:data.generatedAt,stale:true}:null);if(!data)notice(error.message)}finally{if(epoch===current){pending=null;button.disabled=false;button.textContent='Actualizar'}}})();
  pending=work;return work;
 }
 function clear(){epoch++;pending=null;data=null;page=0;for(const id of ['providerRows','providerCards','providerAssignments'])$(id).replaceChildren();for(const id of ['providerActive','providerCapacity','providerReported','providerReserved','providerAvailable'])$(id).textContent='—';$('providerRefresh').disabled=false;$('providerRefresh').textContent='Actualizar';$('providerSearch').value='';$('providerState').value='all';sources([]);$('providerTotal').textContent='Cargando cuentas…';$('providerUpdated').textContent='Inventario pendiente de comprobar.';$('providerWarning').textContent='';$('providerWarning').hidden=true;$('providerNoAssignments').hidden=false;$('providerPage').textContent='0 cuentas';$('providerPrevious').disabled=true;$('providerNext').disabled=true}
 for(const id of ['providerSearch','providerState','providerSource'])$(id).addEventListener(id==='providerSearch'?'input':'change',()=>{page=0;render()});
 $('providerPrevious').onclick=()=>{page--;render()};$('providerNext').onclick=()=>{page++;render()};$('providerRefresh').onclick=()=>load(true);
 return {load,clear};
}
