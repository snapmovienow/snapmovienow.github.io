// Temporary administrator-only UI. Mounting/refreshing never executes the probe.
export function mountSecurityLogCanary({api,container,document=globalThis.document,confirm=globalThis.confirm,now=Date.now}){
 const expiresAt=Date.parse('2026-10-27T19:39:33Z'),id='snap-public-header-canary-20261026-v1';
 const section=document.createElement('section');section.className='wide';section.id='securityLogCanary';
 const title=document.createElement('h2');title.textContent='Comprobación temporal del registro privado';
 const text=document.createElement('p');text.textContent='Una sola petición con marcadores públicos, sin el secreto gateway. Caduca el 27/10/2026 a las 19:39 UTC. No cambia la autenticación ni comprueba reproducción.';
 const status=document.createElement('p');status.setAttribute('role','status');status.textContent='Consulta el estado antes de ejecutar.';
 const inspect=document.createElement('button');inspect.type='button';inspect.className='secondary';inspect.textContent='Consultar estado del canario';
 const run=document.createElement('button');run.type='button';run.textContent='Ejecutar canario público una sola vez';run.disabled=true;
 let busy=false,ready=false,attempted=false;
 function render(value){
  ready=value?.id===id&&value.state==='ready'&&value.consumed===false&&now()<expiresAt;
  run.disabled=busy||attempted||!ready;
  const states={ready:'Disponible: todavía no ejecutado.',claimed:'Intento consumido; consulta solo el estado. No se volverá a ejecutar.',complete:'Petición terminada. Esto todavía NO demuestra redacción.',uncertain:'Resultado incierto; no se repetirá la petición.',expired:'Plazo vencido; ejecución deshabilitada.',not_started:'Todavía no disponible.',configuration_unavailable:'Acceso no disponible; intento consumido.',storage_unavailable:'No se pudo confirmar el registro durable; ejecución bloqueada.'};
  status.textContent=states[value?.state]||'Estado no verificable; ejecución bloqueada.';
  if(Number.isInteger(value?.httpStatus))status.textContent+=' HTTP '+value.httpStatus+'.';
  if(typeof value?.startedAt==='number')status.textContent+=' Inicio UTC: '+new Date(value.startedAt).toISOString()+'.';
  if(typeof value?.cfRay==='string'&&/^[a-f0-9]{16}(?:-[A-Z]{3})?$/.test(value.cfRay))status.textContent+=' Referencia: '+value.cfRay+'.';
 }
 inspect.onclick=async()=>{
  if(busy)return;busy=true;inspect.disabled=true;run.disabled=true;
  try{render(await api('security-log-canary-status'));}
  catch{ready=false;status.textContent='No se pudo consultar el estado. No se ejecutó ninguna prueba.';}
  finally{busy=false;inspect.disabled=false;run.disabled=attempted||!ready;}
 };
 run.onclick=async()=>{
  if(busy||attempted||!ready||now()>=expiresAt)return;
  if(!confirm('¿Ejecutar UNA petición con marcadores públicos al portal Sites? No enviará el secreto gateway. No habrá reintentos.'))return;
  attempted=true;busy=true;run.disabled=true;inspect.disabled=true;
  try{render(await api('security-log-canary-run',{confirm:id}));}
  catch{ready=false;status.textContent='Resultado no confirmado. El intento no se repetirá: consulta solo el estado.';}
  finally{busy=false;inspect.disabled=false;run.disabled=true;}
 };
 section.append(title,text,status,inspect,run);container.append(section);
 return {clear(){ready=false;run.disabled=true;status.textContent='Consulta el estado antes de ejecutar.';},section,inspect,run,status};
}
