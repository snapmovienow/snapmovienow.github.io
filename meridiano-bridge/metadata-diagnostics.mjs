const LIVE_STATUSES=new Set(['onair','offair','standby']);
const HLS_TYPES=new Set(['application/x-mpegurl','application/vnd.apple.mpegurl','application/mpegurl','audio/mpegurl','audio/x-mpegurl']);
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

function liveStatusOf(data){
  const value=data?.live_status??data?.liveStatus;
  const status=typeof value==='string'?value.trim().toLowerCase():'';
  return LIVE_STATUSES.has(status)?status:'unknown';
}

function candidate(entry){
  if(!record(entry)||typeof entry.url!=='string'||!entry.url)return null;
  try{
    const url=new URL(entry.url);
    if(!['http:','https:'].includes(url.protocol))return null;
    const type=typeof entry.type==='string'?entry.type.split(';')[0].trim().toLowerCase():'';
    return {hls:HLS_TYPES.has(type)||/\.m3u8$/i.test(url.pathname)};
  }catch{return null}
}

// Pure diagnostics only: do not return URLs, raw errors, account data or inferred live status.
export function diagnosePlayerMetadata(data,httpStatus){
  const object=record(data),liveStatus=liveStatusOf(object?data:null);
  const error=object?data.error:undefined;
  const hasError=error!==undefined&&error!==null&&error!==false;
  const rawCode=record(error)&&typeof error.code==='string'?error.code.trim():'';
  const code=rawCode.length<=32?rawCode.toUpperCase():'';
  const playerErrorCode=/^[A-Z][A-Z0-9_]{1,31}$/.test(code)?code:null;
  const qualities=object?data.qualities:undefined;
  let qualitySchemaValid=record(qualities),hlsQualitiesFound=0;
  if(qualitySchemaValid){
    for(const bucket of Object.values(qualities)){
      if(!Array.isArray(bucket)){qualitySchemaValid=false;continue}
      for(const entry of bucket){
        const parsed=candidate(entry);
        if(!parsed){qualitySchemaValid=false;continue}
        if(parsed.hls)hlsQualitiesFound++;
      }
    }
  }
  const recognizable=object&&(qualitySchemaValid||(qualities===undefined&&liveStatus!=='unknown'));
  const metadataShape=hasError?'player_error':recognizable?'player_metadata':'unexpected_json';
  return {completed:httpStatus===200&&metadataShape==='player_metadata',metadataShape,playerErrorCode,liveStatus,
    geoBlocked:playerErrorCode==='DM007',hlsQualitiesFound,liveMediaVerified:false};
}
