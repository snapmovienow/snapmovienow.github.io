const CAP=131072,PREFIX=32768;
const fail=code=>Object.assign(Error(code),{proofCode:code});
const ERROR_CODES=new Set(['SOURCE_SCOPE','ABORTED','EMPTY_BODY','RESPONSE_LIMIT','REDIRECT_LIMIT','INVALID_REDIRECT','UPSTREAM_HTTP',
  'PLAYER_ERROR','NO_HLS','INVALID_PLAYLIST','PLAYLIST_DEPTH','INVALID_KEY','UNSUPPORTED_ENCRYPTION','UNSUPPORTED_BYTERANGE',
  'INVALID_INIT','INSUFFICIENT_SEGMENTS','INVALID_MEDIA','SEGMENT_FORMAT_CHANGED','STREAM_ENDED']);
const hostAllowed=host=>['dailymotion.com','dmcdn.net'].some(base=>host===base||host.endsWith('.'+base));
function rawPathSafe(value){
  if(typeof value!=='string'||!value||/[\\\u0000-\u0020#]/.test(value))return false;
  let path=value.split('?')[0];
  if(/^https:\/\//i.test(path))path=path.replace(/^https:\/\/[^/]+/i,'');
  else if(path.startsWith('//'))path=path.replace(/^\/\/[^/]+/,'');
  for(let depth=0;depth<4;depth++){
    if(path.split('/').some(part=>part==='.'||part==='..')||/%(?:2e|2f|5c)/i.test(path))return false;
    if(!/%25/i.test(path))return true;
    try{path=decodeURIComponent(path)}catch{return false}
  }
  return !/%25/i.test(path);
}
export function privateMediaAllowed(value){
  if(!rawPathSafe(value))return false;
  try{const url=new URL(value);return url.protocol==='https:'&&hostAllowed(url.hostname)&&!url.username&&!url.password&&!url.port&&!url.hash}catch{return false}
}
function resolve(reference,base){
  if(!rawPathSafe(reference))throw fail('SOURCE_SCOPE');
  let value;try{value=new URL(reference,base).href}catch{throw fail('SOURCE_SCOPE')}
  if(!privateMediaAllowed(value))throw fail('SOURCE_SCOPE');
  return value;
}
function attributes(line){
  const out={};for(const match of line.matchAll(/([A-Z0-9-]+)=("[^"\r\n]*"|[^,\r\n]*)/g))out[match[1]]=match[2].replace(/^"|"$/g,'');return out;
}
async function aborted(promise,signal){
  if(signal.aborted){Promise.resolve(promise).catch(()=>{});throw fail('ABORTED')}
  let listener;
  try{return await Promise.race([promise,new Promise((_,reject)=>{listener=()=>reject(fail('ABORTED'));signal.addEventListener('abort',listener,{once:true})})])}
  finally{if(listener)signal.removeEventListener('abort',listener)}
}
async function read(response,limit,prefix,signal){
  const reader=response.body?.getReader();if(!reader)throw fail('EMPTY_BODY');
  let size=0;const chunks=[];
  try{
    for(;;){
      const {done,value}=await aborted(reader.read(),signal);if(done)break;
      if(!prefix&&size+value.length>limit)throw fail('RESPONSE_LIMIT');
      const piece=value.subarray(0,limit-size);chunks.push(piece);size+=piece.length;
      if(prefix&&size===limit)break;
    }
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length}return bytes;
  }finally{
    try{await aborted(reader.cancel(),signal)}catch{}
    try{reader.releaseLock()}catch{}
  }
}
async function open(value,fetcher,signal,range=false){
  let url=value;
  for(let redirects=0;redirects<=2;redirects++){
    if(signal.aborted)throw fail('ABORTED');
    if(!privateMediaAllowed(url))throw fail('SOURCE_SCOPE');
    const pending=Promise.resolve().then(()=>fetcher(url,{method:'GET',redirect:'manual',signal,
      headers:{'Accept-Encoding':'identity',...(range?{Range:'bytes=0-32767'}:{})}}));
    pending.then(response=>{if(signal.aborted)response.body?.cancel().catch(()=>{})},()=>{});
    const response=await aborted(pending,signal);
    if([301,302,303,307,308].includes(response.status)){
      const location=response.headers.get('location');try{await aborted(response.body?.cancel(),signal)}catch{}
      if(redirects===2)throw fail('REDIRECT_LIMIT');if(!location)throw fail('INVALID_REDIRECT');
      url=resolve(location,url);continue;
    }
    if(!response.ok){try{await aborted(response.body?.cancel(),signal)}catch{}throw fail('UPSTREAM_HTTP')}
    return {response,url};
  }
  throw fail('REDIRECT_LIMIT');
}
function format(bytes){
  for(let offset=0;offset<188&&offset+376<bytes.length;offset++)if(bytes[offset]===71&&bytes[offset+188]===71&&bytes[offset+376]===71)return 'mpegts';
  if(bytes.length>=8&&['ftyp','styp','moof','moov'].includes(String.fromCharCode(...bytes.subarray(4,8))))return 'fmp4';
  return 'unknown';
}
function hlsCandidate(item){
  if(!item||typeof item.url!=='string')return false;
  try{return /mpegurl/i.test(String(item.type||''))||/\.m3u8$/i.test(new URL(item.url).pathname)}catch{return false}
}
const numberTag=(text,name)=>{const match=new RegExp('^#'+name+':([0-9]+(?:\\.[0-9]+)?)\\s*$','m').exec(text);const value=match?Number(match[1]):NaN;return Number.isFinite(value)&&value>=0&&value<=Number.MAX_SAFE_INTEGER?value:null};

export async function verifyPrivateLiveMedia(metadata,fetcher,{signal=AbortSignal.timeout(20000)}={}){
  const result={liveMediaVerified:false,masterFetched:false,playlistFetched:false,mediaSequence:null,targetDuration:null,ended:false,
    segmentsChecked:0,videoBytesVerified:0,initBytesVerified:0,segmentFormat:'unknown',unsupportedEncryption:false,encryptionMethod:'NONE',keyBytesVerified:0,errorCode:null};
  try{
    if(metadata?.error)throw fail('PLAYER_ERROR');
    const entries=metadata?.qualities&&typeof metadata.qualities==='object'?Object.values(metadata.qualities).flat():[];
    const candidates=entries.filter(hlsCandidate),selected=candidates.find(item=>privateMediaAllowed(item.url));
    if(!selected)throw fail(candidates.length?'SOURCE_SCOPE':'NO_HLS');
    let current=selected.url,lines,text,encryptionRecord=null;
    for(let level=0;level<2;level++){
      const opened=await open(current,fetcher,signal);current=opened.url;
      text=new TextDecoder().decode(await read(opened.response,CAP,false,signal));
      if(!text.startsWith('#EXTM3U'))throw fail('INVALID_PLAYLIST');
      if(level===0)result.masterFetched=true;
      lines=text.split(/\r?\n/).map(line=>line.trim());
      const encryptedLine=lines.find(line=>/^#EXT-X-(?:SESSION-)?KEY:/.test(line)&&attributes(line).METHOD!=='NONE');
      if(encryptedLine)encryptionRecord={line:encryptedLine,base:current};
      const variants=[];
      for(let i=0;i<lines.length;i++)if(lines[i].startsWith('#EXT-X-STREAM-INF:')){
        const attr=attributes(lines[i]);let j=i+1;while(j<lines.length&&!lines[j])j++;
        if(!lines[j]||lines[j].startsWith('#'))throw fail('INVALID_PLAYLIST');
        const bandwidth=Number(attr.BANDWIDTH);variants.push({reference:lines[j],bandwidth:Number.isFinite(bandwidth)&&bandwidth>0?bandwidth:Number.MAX_SAFE_INTEGER});
      }
      if(!variants.length){result.playlistFetched=true;break}
      if(level===1)throw fail('PLAYLIST_DEPTH');
      variants.sort((a,b)=>a.bandwidth-b.bandwidth);current=resolve(variants[0].reference,current);
    }
    if(!result.playlistFetched)throw fail('INVALID_PLAYLIST');
    result.mediaSequence=numberTag(text,'EXT-X-MEDIA-SEQUENCE');result.targetDuration=numberTag(text,'EXT-X-TARGETDURATION');
    if(!Number.isSafeInteger(result.mediaSequence))result.mediaSequence=null;
    if(!result.targetDuration)throw fail('INVALID_PLAYLIST');
    result.ended=lines.includes('#EXT-X-ENDLIST');
    if(encryptionRecord){
      const attr=attributes(encryptionRecord.line);result.unsupportedEncryption=true;result.encryptionMethod=attr.METHOD==='AES-128'?'AES-128':'OTHER';
      if(attr.METHOD==='AES-128'&&(!attr.KEYFORMAT||attr.KEYFORMAT==='identity')){
        if(!attr.URI)throw fail('INVALID_KEY');
        const key=await open(resolve(attr.URI,encryptionRecord.base),fetcher,signal);
        const bytes=await read(key.response,17,false,signal);if(bytes.length!==16)throw fail('INVALID_KEY');result.keyBytesVerified=16;
      }
      throw fail('UNSUPPORTED_ENCRYPTION');
    }
    if(lines.some(line=>line.startsWith('#EXT-X-BYTERANGE:')))throw fail('UNSUPPORTED_BYTERANGE');
    const map=lines.find(line=>line.startsWith('#EXT-X-MAP:'));
    if(map){
      const attr=attributes(map);if(attr.BYTERANGE)throw fail('UNSUPPORTED_BYTERANGE');
      const uri=attr.URI;if(!uri)throw fail('INVALID_INIT');
      const init=await open(resolve(uri,current),fetcher,signal,true),bytes=await read(init.response,PREFIX,true,signal);
      if(format(bytes)!=='fmp4')throw fail('INVALID_INIT');result.initBytesVerified=bytes.length;
    }
    const segments=[];
    for(let i=0;i<lines.length;i++)if(lines[i].startsWith('#EXTINF:')){
      let j=i+1;while(j<lines.length&&(!lines[j]||lines[j].startsWith('#')))j++;
      if(!lines[j])throw fail('INVALID_PLAYLIST');segments.push(lines[j]);
    }
    if(segments.length<2)throw fail('INSUFFICIENT_SEGMENTS');
    for(const reference of segments.slice(0,2)){
      const opened=await open(resolve(reference,current),fetcher,signal,true),bytes=await read(opened.response,PREFIX,true,signal);
      const observed=format(bytes);if(observed==='unknown')throw fail('INVALID_MEDIA');
      if(result.segmentFormat!=='unknown'&&result.segmentFormat!==observed)throw fail('SEGMENT_FORMAT_CHANGED');
      result.segmentFormat=observed;result.segmentsChecked++;result.videoBytesVerified+=bytes.length;
    }
    if(result.ended)throw fail('STREAM_ENDED');
    result.liveMediaVerified=true;
  }catch(error){result.errorCode=ERROR_CODES.has(error?.proofCode)?error.proofCode:(signal.aborted?'ABORTED':'UPSTREAM_FAILED')}
  return result;
}
