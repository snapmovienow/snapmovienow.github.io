// Metadata probes never acquire a slot or open media. Only bounded evidence
// leaves the probe, including when a connector throws.
const idPattern=/^[a-zA-Z0-9_-]{1,80}$/;
const stages={credentials:'Credenciales guardadas',panel_login:'Inicio de sesión del panel',inventory:'Inventario',validation:'Validación de cuenta'};
const reasons={
 ok:'Comprobación correcta',
 credentials_unreadable:'No se pudieron leer las credenciales guardadas',
 invalid_server_url:'La configuración de la fuente tiene una dirección inválida',
 timeout:'La comprobación agotó su plazo',
 panel_invalid:'No se pudo verificar el inicio de sesión del panel',
 inventory_incomplete:'La respuesta del inventario fue incompleta o inválida',
 no_active_accounts:'Inventario verificado sin cuentas activas utilizables',
 account_inactive:'La cuenta comprobada no está habilitada para acceso',
 invalid_reply:'Respuesta de validación inválida',
 http_error:'La comprobación recibió un error HTTP',
 unavailable:'No se pudo completar la solicitud'
};
const validReads=new Set(['ok','no_active_accounts','account_inactive']);
function reasonFor(error,stage){
 if(stage==='credentials')return 'credentials_unreadable';
 if(['TimeoutError','AbortError'].includes(error?.name)||error?.message==='provider_validation_timeout')return 'timeout';
 if(['panel_invalid','invalid_server_url'].includes(error?.message))return error.message;
 if(['panel_inventory_incomplete','panel_format_changed','panel_too_many_lines','panel_response_size'].includes(error?.message))return 'inventory_incomplete';
 if(['http_error','invalid_reply'].includes(error?.failureCode))return error.failureCode;
 return 'unavailable';
}
const count=value=>Number.isSafeInteger(value)&&value>=0?value:null;

export async function probeProviders(providers,{decrypt,readPanel,validateAccount,identifier,share=(_provider,read,onProgress)=>read(onProgress)}){
 if(!Array.isArray(providers)||providers.some(p=>typeof p?.source!=='string'||!p.source.trim())||new Set(providers.map(p=>p.source)).size!==providers.length)throw Error('monitor_provider_directory_invalid');
 const configuredIds=await Promise.all(providers.map(p=>identifier(p.source)));
 const results=new Array(providers.length);let cursor=0;
 await Promise.all(Array.from({length:Math.min(3,providers.length)},async()=>{
  for(;;){
   const i=cursor++;if(i>=providers.length)return;
   const p=providers[i],startedAt=Date.now();
   let stage='credentials',reason='credentials_unreadable',receivedRows=null,acceptedRows=null;
   try{
    const credentials=await decrypt(p.encrypted||'');
    if(typeof credentials?.username!=='string'||!credentials.username||typeof credentials.password!=='string'||!credentials.password)throw Error('credentials_unreadable');
    if(credentials.kind==='reseller'){
     stage='panel_login';
     const {lines,inventory}=await share(p,onProgress=>readPanel(credentials.username,credentials.password,p.url||'http://ccf.center:8444/NYzkggyG/',{inventory:true,retryLoginTimeout:true,onProgress}),
      progress=>{stage='inventory';receivedRows=progress.receivedRows;acceptedRows=progress.acceptedRows});
     stage='inventory';receivedRows=inventory.length;acceptedRows=lines.length;reason=acceptedRows?'ok':'no_active_accounts';
    }else if(credentials.kind==='provider'){
     stage='validation';
     const account=await share(p,()=>validateAccount(credentials.username,credentials.password,p.origin||credentials.origin||'http://ccf.center:8444'));
     receivedRows=1;acceptedRows=account?1:0;reason=account?'ok':'account_inactive';
    }
   }catch(error){reason=reasonFor(error,stage)}
   const observedAt=Date.now();
   results[i]={id:configuredIds[i],ok:reason==='ok',stage,reason,observedAt,durationMs:Math.max(0,observedAt-startedAt),receivedRows,acceptedRows};
  }
 }));
 return {configuredIds,providers:results};
}

export function providerMonitorSnapshot(snapshot){
 const ids=snapshot?.configuredIds,rows=snapshot?.providers;
 if(!Array.isArray(ids)||!Array.isArray(rows)||ids.some(id=>typeof id!=='string'||!idPattern.test(id)))return null;
 const configured=new Set(ids),seen=new Set(),samples=[];
 if(configured.size!==ids.length)return null;
 for(const p of rows){
  if(!configured.has(p?.id)||seen.has(p.id))return null;
  seen.add(p.id);
  if(typeof p.stage!=='string'||typeof p.reason!=='string'||!Object.hasOwn(stages,p.stage)||!Object.hasOwn(reasons,p.reason)||p.ok!==(p.reason==='ok')||!Number.isSafeInteger(p.observedAt)||p.observedAt<=0||p.observedAt>8640000000000000||count(p.durationMs)===null)continue;
  const {id,ok,stage,reason,observedAt,durationMs}=p;
  const receivedRows=count(p.receivedRows),acceptedRows=count(p.acceptedRows),validRead=validReads.has(reason);
  if(validRead&&(!['inventory','validation'].includes(stage)||receivedRows===null||acceptedRows===null||acceptedRows>receivedRows||ok!==(acceptedRows>0)))continue;
  samples.push({id,ok,stage,reason,observedAt,durationMs,receivedRows,acceptedRows,validRead});
 }
 return {configured,samples};
}

export const providerTitle=sample=>'Falló la comprobación de una fuente · '+reasons[sample.reason];

export function providerDetail(sample,lastValidAt,runId){
 const rows=value=>value??'sin confirmar';
 return [
  'Fuente '+sample.id.slice(0,12),stages[sample.stage],
  sample.durationMs+' ms','Filas recibidas '+rows(sample.receivedRows),'Aceptadas '+rows(sample.acceptedRows),
  'Última lectura válida '+(lastValidAt?new Date(lastValidAt).toISOString():'sin registro'),
  ...(runId?['Ejecución '+runId]:[])
 ].join(' · ');
}
