export function renderUserCards({document:doc,container,users,query='',edit,toggle,remove,permissions,notice}){
 const node=(tag,text,className)=>{const element=doc.createElement(tag);if(text!==undefined)element.textContent=text;if(className)element.className=className;return element};
 const q=query.trim().toLocaleLowerCase(),selected=users.filter(user=>(user.username+' '+(user.name||'')).toLocaleLowerCase().includes(q));
 container.replaceChildren();
 if(!selected.length){container.append(node('p','No hay usuarios para esta búsqueda.','user-empty'));return;}
 for(const user of selected){
  const card=node('article',undefined,'admin-user-card');card.dataset.username=user.username;
  const heading=node('div',undefined,'admin-user-heading'),identity=node('div'),title=node('h3',user.username);
  identity.append(title);if(user.name)identity.append(node('p',user.name,'admin-user-name'));
  const expired=user.expiresAt&&user.expiresAt<=Date.now(),status=expired?'Vencido':user.status==='active'?'Activo':'Suspendido';
  heading.append(identity,node('span',status,'provider-badge '+(!expired&&user.status==='active'?'is-active':'is-inactive')));card.append(heading);
  card.append(node('p',user.expiresAt?'Vence: '+new Date(user.expiresAt).toLocaleString():'Sin vencimiento','admin-user-expiry'));
  const controls=node('div',undefined,'admin-user-permissions');controls.setAttribute('role','group');controls.setAttribute('aria-label','Contenido habilitado para '+user.username);
  const busy=value=>{for(const control of card.querySelectorAll('button,input'))control.disabled=value};
  for(const [key,label]of [['movies','Películas'],['series','Series'],['tv','TV'],['adults','Adultos (+18)']]){
   const wrap=node('label'),check=node('input');check.type='checkbox';check.checked=(user.permissions||{})[key]!==false;check.dataset.permission=key;check.setAttribute('aria-label',label+' para '+user.username);
   check.onchange=async()=>{const enabled=check.checked;busy(true);try{await permissions(user,key,enabled)}catch(error){check.checked=!enabled;notice(error.message)}finally{busy(false)}};
   wrap.append(check,doc.createTextNode(label));controls.append(wrap);
  }
  card.append(controls);const actions=node('div',undefined,'admin-user-actions');
  for(const [label,action,danger]of [['Editar',edit], [user.status==='active'?'Suspender':'Activar',toggle], ['Borrar',remove,true]]){
   const button=node('button',label,danger?'danger':'secondary');button.type='button';button.setAttribute('aria-label',label+' '+user.username);
   button.onclick=async()=>{busy(true);try{await action(user)}catch(error){notice(error.message)}finally{busy(false)}};actions.append(button);
  }
  card.append(actions);container.append(card);
 }
}
