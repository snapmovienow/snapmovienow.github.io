export function mountAdminSecurity({api,notice,onSessionChanged,onRestored=()=>{},onFactorEnabled=()=>{},container}){
 const section=document.createElement('section');section.className='wide';
 section.innerHTML=`<h2>Seguridad y recuperación</h2>
 <p id="securityState">Consulta el estado de seguridad.</p>
 <p id="securityNotice" class="status" role="status" aria-live="polite" tabindex="-1"></p>
 <form id="securityForm">
  <label>Contraseña actual<input name="password" type="password" autocomplete="current-password" required></label>
  <label>Código del autenticador o código de recuperación<input name="code" autocomplete="one-time-code" aria-describedby="securityNotice"></label>
  <button type="button" id="mfaBegin">Configurar segundo factor</button>
  <button type="button" id="mfaConfirm" hidden>Confirmar código y activar</button>
  <button type="button" id="mfaRenew" hidden>Renovar códigos de recuperación</button>
  <p id="mfaRenewHelp" hidden>La renovación requiere tu contraseña y un código nuevo de seis dígitos del autenticador. Reemplaza todos los códigos de recuperación anteriores y cierra las sesiones del panel. Conserva el mismo autenticador.</p>
  <button type="button" id="mfaDisable" class="secondary" hidden>Desactivar segundo factor</button>
 </form>
 <div id="mfaEnrollment" hidden>
  <p>En Google Authenticator elige «Enter a setup code». Escribe SNAP Administrador como nombre, pega esta clave en «Your key» y selecciona «Time based». Luego vuelve aquí y confirma los seis dígitos.</p>
  <p>Esta clave es privada. No compartas capturas de la clave ni de los códigos.</p>
  <output id="mfaSeed" style="display:block;overflow-wrap:anywhere"></output>
  <button type="button" id="mfaCopy" class="secondary">Copiar clave</button>
  <p id="mfaExpiry"></p>
 </div>
 <dialog id="mfaRecovery" hidden aria-labelledby="mfaRecoveryTitle">
  <h3 id="mfaRecoveryTitle">Guarda tus códigos de recuperación</h3>
  <p id="mfaRecoveryHelp">Cada código se puede usar una sola vez y solo se muestra ahora. Guárdalos en un lugar seguro. No compartas capturas ni los envíes por chat.</p>
  <textarea id="mfaCodes" readonly rows="8" aria-label="Códigos de recuperación" style="width:100%;min-height:12em;background:#071016;color:#fff;padding:12px;overflow-wrap:anywhere"></textarea>
  <button type="button" id="mfaSaved">Ya guardé los códigos; iniciar sesión</button>
 </dialog>
 <hr><h3>Copia cifrada</h3><p>Incluye usuarios, permisos, vencimientos y servidores. Para restaurarla se necesita la clave del servidor original. No incluye favoritos, progreso, sesiones ni el segundo factor del administrador.</p><p id="backupStatus" role="status">Consultando las copias del servidor…</p><button type="button" id="backupRefresh" class="secondary" hidden>Actualizar estado</button><button type="button" id="backupCreate" hidden>Crear copia en el servidor</button><button type="button" id="backupExport">Descargar copia cifrada</button><label>Copias automáticas diarias<select id="automaticBackups"><option value="">Sin copias disponibles</option></select></label><button type="button" id="backupVerify" class="secondary" hidden>Verificar copia seleccionada</button><button type="button" id="backupDownload" class="secondary">Descargar copia seleccionada</button><p>Se conservan las últimas tres copias diarias en el servidor. Descarga una copia para guardarla fuera del servidor.</p><label>Archivo de copia<input id="backupFile" type="file" accept="application/json,.json"></label><p id="backupPlan"></p><div id="restoreControls" hidden><p>Restaurar reemplaza los usuarios y servidores actuales. Los clientes deberán iniciar sesión nuevamente.</p><label>Escribe RESTAURAR<input id="restoreWord" autocomplete="off"></label><button type="button" id="backupRestore" class="danger">Restaurar esta copia</button></div><h3>Últimos cambios administrativos</h3><button type="button" id="auditRefresh" class="secondary">Actualizar historial</button><div id="auditList"></div>`;
 container.append(section);const $=id=>section.querySelector('#'+id);
 let blob=null,plan=null,epoch=0,busy=false,available=true,enrollmentTimer=null,enrollmentUntil=0;
 const request=api;api=async(...args)=>{const generation=epoch,result=await request(...args);if(generation!==epoch)throw Error('La sesión cambió.');return result};
 const tell=(message,error=false)=>{const status=$('securityNotice');status.textContent=message;status.setAttribute('role',error?'alert':'status');notice(message);if(error){status.focus({preventScroll:true});status.scrollIntoView({block:'center',behavior:'smooth'})}};
 const stopEnrollment=()=>{clearInterval(enrollmentTimer);enrollmentTimer=null;enrollmentUntil=0;$('mfaSeed').textContent='';$('mfaExpiry').textContent='';$('mfaEnrollment').hidden=true;$('mfaConfirm').hidden=true};
 const tickEnrollment=()=>{const seconds=Math.ceil((enrollmentUntil-Date.now())/1000);if(seconds<=0){stopEnrollment();$('securityForm').elements.code.value='';tell('La configuración venció. Pulsa Configurar segundo factor y añade la nueva clave al autenticador.',true);return}$('mfaExpiry').textContent='Confirma antes de '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+' minutos.'};
 const credentials=()=>Object.fromEntries(new FormData($('securityForm')));
 const lock=()=>{for(const button of section.querySelectorAll('button'))button.disabled=busy||!available};
 const run=async(button,fn)=>{if(busy||!available)return;const generation=epoch;busy=true;lock();try{await fn()}catch(e){if(generation===epoch){if(e.code==='mfa_setup_expired')stopEnrollment();tell(e.message,true)}}finally{if(generation===epoch){busy=false;lock()}}};
 $('mfaRecovery').addEventListener('cancel',e=>e.preventDefault());
 async function refreshBackups(){
  const selected=$('automaticBackups').value,backups=await api('backup-list');
  $('automaticBackups').replaceChildren(new Option(backups.length?'Selecciona una copia':'Sin copias disponibles',''));
  for(const item of backups)$('automaticBackups').add(new Option(new Date(item.createdAt).toLocaleString()+(item.verifiedAt?' · verificada':''),item.id));
  if(backups.some(b=>b.id===selected))$('automaticBackups').value=selected;
  try{
   const state=await api('backup-status');for(const id of ['backupRefresh','backupCreate','backupVerify'])$(id).hidden=false;
   const last=state.lastSuccessAt?new Date(state.lastSuccessAt).toLocaleString():'sin copia creada';
   const detail=state.status==='failed'?'El último intento falló.':state.status==='running'?'Hay una copia en curso.':state.stale?'Hace falta una copia reciente.':'La última copia tiene menos de 36 horas.';
   $('backupStatus').textContent='Última copia: '+last+'. '+detail+' La tarea diaria está programada a las '+state.scheduleUTC+' UTC.';
  }catch(e){if(e.code!=='operation_not_allowed')throw e;for(const id of ['backupRefresh','backupCreate','backupVerify'])$(id).hidden=true;$('backupStatus').textContent='El estado y la verificación de las copias estarán disponibles al actualizar el servidor.'}
 }
 async function refresh(){try{
  await refreshBackups();available=true;for(const field of section.querySelectorAll('input,select,textarea'))field.disabled=false;
  const state=await api('security-status');$('securityState').textContent=state.mfaEnabled?'Segundo factor activado · '+state.recoveryRemaining+' códigos de recuperación disponibles.':'Segundo factor desactivado.';
  $('mfaBegin').hidden=state.mfaEnabled;for(const id of ['mfaDisable','mfaRenew','mfaRenewHelp'])$(id).hidden=!state.mfaEnabled;
  if(state.mfaEnabled)stopEnrollment();lock();return state;
 }catch(e){if(e.code!=='operation_not_allowed')throw e;available=false;stopEnrollment();for(const field of section.querySelectorAll('button,input,select,textarea'))field.disabled=true;$('securityState').textContent='Seguridad y recuperación pendientes de actualizar el servidor. La administración de usuarios sigue disponible.';return {available:false}}}
 function showRecovery(result,renewed=false){
  stopEnrollment();$('securityState').textContent='Segundo factor activado · 8 códigos de recuperación disponibles.';
  $('mfaBegin').hidden=true;for(const id of ['mfaDisable','mfaRenew','mfaRenewHelp'])$(id).hidden=false;
  $('mfaCodes').value=result.recoveryCodes.join('\n');$('mfaRecoveryTitle').textContent=renewed?'Guarda los códigos nuevos':'Guarda tus códigos de recuperación';
  $('mfaRecoveryHelp').textContent=(renewed?'Los códigos anteriores dejaron de funcionar. ':'')+'Cada código se puede usar una sola vez y solo se muestra ahora. Guárdalos en un lugar seguro. No compartas capturas ni los envíes por chat.';
  $('securityForm').reset();$('mfaRecovery').hidden=false;$('mfaRecovery').showModal();onFactorEnabled();
  tell(renewed?'Códigos renovados. Guarda los nuevos antes de volver a entrar.':'Segundo factor activado. Guarda los códigos antes de volver a entrar.');
 }
 $('mfaBegin').onclick=e=>run(e.target,async()=>{if(!$('securityForm').reportValidity())return;const result=await api('mfa-begin',credentials());stopEnrollment();$('securityForm').elements.code.value='';$('mfaSeed').textContent=result.seed;$('mfaEnrollment').hidden=false;$('mfaConfirm').hidden=false;enrollmentUntil=Date.now()+Math.min(600,Number(result.expiresInSeconds)||600)*1000;tickEnrollment();enrollmentTimer=setInterval(tickEnrollment,1000);tell('Añade esta nueva clave al autenticador y confirma su código antes de que venza.')});
 $('mfaCopy').onclick=async()=>{if(!$('mfaSeed').textContent)return;const generation=epoch;try{await navigator.clipboard.writeText($('mfaSeed').textContent);if(generation===epoch)tell('Clave copiada. Pégala en Your key de Google Authenticator.')}catch{if(generation===epoch)tell('Mantén pulsada la clave y elige Copiar.')}};
 $('mfaConfirm').onclick=e=>run(e.target,async()=>{if(!$('securityForm').reportValidity())return;if(!/^\d{6}$/.test(credentials().code||''))throw Error('Escribe los seis dígitos actuales de Google Authenticator.');showRecovery(await api('mfa-confirm',credentials()))});
 $('mfaRenew').onclick=e=>run(e.target,async()=>{if(!$('securityForm').reportValidity())return;if(!/^\d{6}$/.test(credentials().code||''))throw Error('Para renovar los códigos utiliza los seis dígitos nuevos de Google Authenticator.');showRecovery(await api('mfa-recovery-renew',credentials()),true)});
 $('mfaSaved').onclick=()=>{$('mfaRecovery').close();$('mfaCodes').value='';$('mfaRecovery').hidden=true;onSessionChanged()};
 $('mfaDisable').onclick=e=>run(e.target,async()=>{if(!$('securityForm').reportValidity())return;await api('mfa-disable',credentials());$('securityForm').reset();onSessionChanged();notice('Segundo factor desactivado. Inicia sesión nuevamente.')});
 $('backupRefresh').onclick=e=>run(e.target,refreshBackups);
 $('backupCreate').onclick=e=>run(e.target,async()=>{if(!$('securityForm').reportValidity())return;const result=await api('backup-create',credentials());$('securityForm').reset();await refreshBackups();$('automaticBackups').value=result.id;tell('Copia creada en el servidor. Verifícala y descarga una copia para guardarla fuera del servidor.')});
 $('backupVerify').onclick=e=>run(e.target,async()=>{const id=$('automaticBackups').value;if(!id)throw Error('Selecciona una copia para verificarla.');const result=await api('backup-verify',{id});await refreshBackups();tell('Integridad comprobada: '+result.users+' usuarios y '+result.providers+' servidores. Esta comprobación no restaura ni modifica usuarios.')});
 $('backupExport').onclick=e=>run(e.target,async()=>{if(!$('securityForm').reportValidity())return;const result=await api('backup-export',credentials()),url=URL.createObjectURL(new Blob([JSON.stringify(result)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='SNAP-backup-'+new Date(result.createdAt).toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('securityForm').reset();tell('Copia cifrada descargada. Conserva también la clave del servidor en un lugar seguro.')});
 $('backupDownload').onclick=e=>run(e.target,async()=>{if(!$('securityForm').reportValidity()||!$('automaticBackups').value)return;const result=await api('backup-download',{...credentials(),id:$('automaticBackups').value}),url=URL.createObjectURL(new Blob([JSON.stringify(result)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download='SNAP-backup-'+$('automaticBackups').value+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('securityForm').reset();tell('Copia cifrada descargada.')});
 $('backupFile').onchange=async e=>{blob=null;plan=null;$('restoreControls').hidden=true;try{const file=e.target.files[0];if(!file)return;if(file.size>4000000)throw Error('El archivo es demasiado grande.');const data=JSON.parse(await file.text());if(data.format!=='SNAP-encrypted-backup-v1'||typeof data.blob!=='string')throw Error('El archivo no es una copia SNAP válida.');plan=await api('backup-preview',{blob:data.blob});blob=data.blob;$('backupPlan').textContent=plan.users+' usuarios · '+plan.providers+' servidores · '+new Date(plan.createdAt).toLocaleString();$('restoreControls').hidden=false}catch(e){tell(e.message)}};
 $('backupRestore').onclick=e=>run(e.target,async()=>{if(!blob||!plan||!$('securityForm').reportValidity())return;await api('backup-restore',{...credentials(),blob,confirmation:plan.confirmation,confirmText:$('restoreWord').value});$('securityForm').reset();$('restoreControls').hidden=true;blob=null;plan=null;tell('Copia restaurada. Los clientes deben iniciar sesión nuevamente.');await onRestored()});
 $('auditRefresh').onclick=e=>run(e.target,async()=>{const events=await api('audit');$('auditList').replaceChildren();const labels={admin_login:'Inicio de sesión',mfa_enabled:'Segundo factor activado',mfa_disabled:'Segundo factor desactivado',mfa_recovery_renewed:'Códigos de recuperación renovados',backup_exported:'Copia descargada',backup_downloaded:'Copia automática descargada',backup_automatic:'Copia automática creada',backup_created:'Copia creada en el servidor',backup_verified:'Integridad de copia comprobada',backup_failed:'La creación de copia falló',backup_restored:'Copia restaurada',user_saved:'Usuario guardado',user_deleted:'Usuario borrado',provider_saved:'Servidor guardado',provider_removed:'Servidor retirado',xtream_changed:'Acceso Xtream cambiado'};for(const event of events){const p=document.createElement('p');p.textContent=new Date(event.at).toLocaleString()+' · '+(labels[event.action]||event.action)+' · '+event.actor+(event.target?' · '+event.target:'');$('auditList').append(p)}if(!events.length)$('auditList').textContent='Aún no hay cambios registrados.'});
 return {refresh,clear(){epoch++;busy=false;available=true;stopEnrollment();$('mfaRecovery').close();blob=null;plan=null;$('securityForm').reset();$('securityNotice').textContent='';$('mfaCodes').value='';for(const id of ['mfaRecovery','restoreControls'])$(id).hidden=true;$('auditList').replaceChildren();$('backupFile').value='';$('backupStatus').textContent='';$('automaticBackups').replaceChildren(new Option('Sin copias disponibles',''));lock()}};
}
