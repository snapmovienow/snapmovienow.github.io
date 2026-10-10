export function mountAdminSeries({api,container}){
  const section=document.createElement('div');let generation=0;
  section.id='seriesDiagnostic';
  section.innerHTML='<h3>Comprobar episodios de una serie</h3><p>Revisa lo que el servidor entrega para ese usuario sin iniciar vídeos.</p><form><label>Usuario SNAP<select name="username" required></select></label><label>Nombre de la serie<input name="query" required minlength="3" maxlength="120" placeholder="El Halcón"></label><button type="submit">Comprobar serie</button></form><p role="status" aria-live="polite"></p><ul></ul>';
  container.append(section);
  const form=section.querySelector('form'),select=form.elements.username,status=section.querySelector('[role=status]'),list=section.querySelector('ul'),button=form.querySelector('button');
  form.onsubmit=async event=>{
    event.preventDefault();const current=++generation;button.disabled=true;list.replaceChildren();status.textContent='Comprobando temporadas y episodios…';
    try{
      const result=await api('xtream-series-check',{username:select.value,query:form.elements.query.value});
      if(current!==generation)return;
      status.textContent=result.results.length?'Comprobación terminada.':'No se encontró esa serie en el catálogo. Prueba una parte del título.';
      for(const item of result.results){const li=document.createElement('li');
        const messages={no_episodes:'No hay episodios disponibles para ese usuario en la respuesta del servidor.',adult_content_disabled:'Los permisos de adultos impiden acceder a esta serie.',upstream_unavailable:'No se pudo obtener una ficha válida del proveedor.',unavailable:'El servidor rechazó la solicitud.'};
        li.textContent=item.name+' · '+(item.state==='ready'?item.seasons.length+' temporadas y '+item.episodes+' episodios disponibles.':messages[item.state]||'No disponible.')+' HTTP '+item.httpStatus+' · ID '+item.publicId;
        list.append(li);
      }
    }catch(error){if(current===generation)status.textContent=error.message}
    finally{if(current===generation)button.disabled=false}
  };
  return {setUsers(users){const previous=select.value;select.replaceChildren();for(const user of users){const option=document.createElement('option');option.value=user.username;option.textContent=user.username;select.append(option)}if(users.some(u=>u.username===previous))select.value=previous},clear(){generation++;select.replaceChildren();form.elements.query.value='';list.replaceChildren();status.textContent='';button.disabled=false}};
}
