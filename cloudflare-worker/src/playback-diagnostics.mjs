// Diagnostics are an allowlist, never exception text or an upstream body.
const operations=new Set(['session_info','live','vod','series','series_info','stream_token']);
const errors=new Set(['provider_unavailable','provider_inactive','provider_not_configured','provider_temporarily_unavailable','panel_unavailable','panel_invalid','panel_no_active_lines','server_unavailable','catalog_timeout','upstream_unavailable','ccf_capacity','user_connection_limit','playback_superseded','playback_expired','account_inactive','content_disabled','adult_content_disabled','invalid_stream','live_signal_unavailable','live_startup_timeout','provider_validation_timeout','media_origin_unapproved','playback_preparation_failed']);
export function preparationFailure(error){
 const code=errors.has(error?.message)?error.message:'playback_preparation_failed';
 return {error:code,status:code==='playback_superseded'?410:code==='live_startup_timeout'?504:code==='playback_preparation_failed'?502:503};
}
export function playbackRequestDiagnostic(value){
 return {...(operations.has(value?.operation)?{operation:value.operation}:{}),...(errors.has(value?.serviceError)?{serviceError:value.serviceError}:{})};
}
export function canaryIncident(result){
 const failure=result.failure,phase=failure?.phase;
 const title=phase==='authentication'?'La prueba automática no pudo acceder a la cuenta de prueba':phase==='catalog_prepare'?'La prueba automática no pudo preparar la reproducción':'La prueba automática no recibe vídeo';
 const stages={authentication:'Acceso',catalog_prepare:'Preparación',media_headers:'Apertura del vídeo',first_media_byte:'Llegada del vídeo'};
 const detail=playbackRequestDiagnostic(failure);
 return {title,detail:[({live:'TV',movie:'Películas',series:'Series'}[result.type]),result.status==='healthy'?'Vídeo recibido':result.reason,...(result.status==='healthy'?[]:[stages[phase],Number.isInteger(failure?.httpStatus)?'HTTP '+failure.httpStatus:null,detail.operation,detail.serviceError])].filter(Boolean).join(' · ')};
}
