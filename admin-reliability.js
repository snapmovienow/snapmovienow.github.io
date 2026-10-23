const labels={live:'Canal',series:'Serie',movie:'Película'};
const reasons={
 timeout:'La prueba superó su tiempo máximo.',
 account_unavailable:'No se pudo comprobar el acceso de la cuenta propia de prueba.',
 capacity_busy:'La cuenta o la fuente no tenía una plaza libre. Se volverá a intentar.',
 sample_unavailable:'El canal o episodio de prueba no está disponible.',
 media_not_arriving:'El origen respondió pero no llegaron datos de vídeo.',
 playback_unavailable:'No se pudo completar el inicio de reproducción.',
 sample_not_configured:'No se encontró un canal o episodio permitido para la prueba.',
 canary_account_missing:'La cuenta de prueba no está disponible.',
 canary_account_inactive:'La cuenta de prueba está inactiva o vencida.',
 canary_not_configured:'Falta configurar la cuenta propia de prueba.',
 canary_disabled:'La prueba automática está pausada.',
 canary_busy:'Ya hay una prueba en curso.',
 user_connection_limit:'La cuenta de prueba tiene sus conexiones ocupadas. Se volverá a intentar.',
 ccf_capacity:'No hay una plaza libre en el origen. Se volverá a intentar.',
 provider_recovering:'Las fuentes están en recuperación. Se volverá a intentar.',
 content_disabled:'Este contenido no está habilitado en la cuenta de prueba.',
 authentication_failed:'No se pudo comprobar el acceso de la cuenta de prueba.',
 catalog_unavailable:'No se pudo preparar el catálogo de prueba.',
 target_unavailable:'No se encontró contenido permitido para la prueba.',
 media_unavailable:'El origen no entregó vídeo para esta prueba.',
 media_empty:'El origen respondió sin datos de vídeo.',
 media_timeout:'El origen superó el tiempo de espera.',
 canary_timeout:'La prueba superó su tiempo máximo.',
 live_startup_timeout:'El origen superó el tiempo de inicio.',
 provider_unavailable:'El origen no respondió correctamente.',
 stream_unavailable:'No se pudo iniciar el vídeo de prueba.',
 session_required:'No se pudo comprobar la sesión de prueba.',
 invalid_media:'El origen respondió sin un formato de vídeo válido.',
 invalid_playlist:'La lista de reproducción no es válida.'
};
export const reliabilityType=value=>labels[value]||'Reproducción';
export const reliabilityReason=value=>reasons[value]||'No se completó la prueba. Revisa el siguiente resultado o las incidencias.';
export function reliabilityDuration(value){return typeof value==='number'&&Number.isFinite(value)&&value>=0?(value<1000?Math.round(value)+' ms':(value/1000).toFixed(2)+' s'):'Sin medición';}
// Unknown/stale results must never be shown as proof that playback is healthy.
export function canaryPresentation(value,now=Date.now()){
 const data=value&&typeof value==='object'?value:{},configured=data.configured===true,enabled=data.enabled===true;
 const interval=Number(data.intervalMinutes),minutes=Number.isFinite(interval)&&interval>=1&&interval<=60?interval:5;
 const checked=Number(data.lastCheckedAt),recent=Number.isFinite(checked)&&checked>0&&checked<=now+60000&&now-checked<=Math.max(15,minutes*3)*60000;
 const result=data.lastResult&&typeof data.lastResult==='object'?data.lastResult:null;
 let summary;
 if(!configured)summary='Prueba de reproducción pendiente de configurar.';
 else if(!enabled)summary='Prueba automática pausada.';
 else if(data.running)summary='Prueba de reproducción en curso.';
 else if(!checked||!result)summary='Esperando la primera prueba de reproducción.';
 else if(!recent)summary='Sin una prueba de reproducción reciente. El último resultado no confirma el estado actual.';
 else if(data.status==='busy')summary='Prueba aplazada: la cuenta o la fuente no tenía una plaza libre.';
 else if(result.ok===true&&data.status==='healthy')summary='Última prueba de reproducción correcta.';
 else if(result.ok===false)summary='La última prueba de reproducción no se completó.';
 else summary='Esperando un resultado de reproducción comprobado.';
 return {summary,configured,enabled,running:data.running===true,recent,result,results:Array.isArray(data.results)?data.results.filter(r=>r&&['live','series','movie'].includes(r.type)).slice(0,3):[]};
}
