// Only server-generated, credential-free codes may enter timing aggregates.
const codes=new Set(['invalid_credentials','credentials_required','account_inactive','account_expired','content_disabled','adult_content_disabled','xtream_disabled','user_connection_limit','playback_superseded','playback_expired','session_expired','try_later','ccf_capacity','provider_unavailable','provider_inactive','provider_not_configured','provider_temporarily_unavailable','panel_unavailable','session_unavailable','upstream_unavailable','xtream_unavailable','live_signal_unavailable','live_startup_timeout','media_origin_unapproved','stream_unavailable','service_unavailable','playback_preparation_failed','invalid_stream','not_found']);
export const playbackErrorCode=value=>codes.has(value)?value:undefined;
export const playbackErrorHeaders=(value,status)=>status>=400&&playbackErrorCode(value?.error)?{'X-SMN-Error-Code':value.error}:{};
export function expectedPlaybackOutcome(status,code){
 if(status===401&&['invalid_credentials','credentials_required','account_inactive','account_expired'].includes(code)||status===403&&['content_disabled','adult_content_disabled','xtream_disabled'].includes(code))return 'accessRejected';
 if(status===410&&['playback_superseded','playback_expired','session_expired'].includes(code))return 'cancelled';
 if(status===409&&code==='user_connection_limit')return 'clientCapacity';
 return null;
}
