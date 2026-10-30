// Public station players only. No subscriber accounts, geo overrides or stored CDN URLs.
const GRAY='live-streaming-mcdn.api.graylive.quickplay.com';
export const OFFICIAL_CHANNELS=[
 {id:'local-kwch-news',name:'KWCH 12 · Wichita · EN VIVO',page:'https://www.kwch.com/livestream/',station:'kwch',contentId:'A1C5E6AD-91D3-431C-B2F9-92CCF50E2A67',input:'kwch-xos1-input-1',poster:'https://image-resizer-cloud-cdn.api.graycms.quickplay.com/image/A1C5E6AD-91D3-431C-B2F9-92CCF50E2A67/0-16x9.jpg?width=640',plot:'Noticias locales de Wichita en inglés. Emisiones en vivo, repeticiones y programación informativa; no es la señal completa de CBS.'},
 {id:'local-kwch-weather',name:'Storm Team 12 · Wichita · EN VIVO',page:'https://www.kwch.com/livestream/weather/',station:'kwch',contentId:'62262EE3-C9F3-4698-A6F6-AF3E40BE29A8',input:'kwch-xos1-input-2',poster:'https://image-resizer-cloud-cdn.api.graycms.quickplay.com/image/62262EE3-C9F3-4698-A6F6-AF3E40BE29A8/0-16x9.jpg?width=640',plot:'Tiempo y radar de Kansas las 24 horas, con cobertura de tormentas de Storm Team 12. Inglés.'},
 {id:'local-wibw-news',name:'WIBW 13 · Topeka · EN VIVO',page:'https://www.wibw.com/livestream/',station:'wibw',contentId:'26F5B097-680A-4BA7-8D93-E4FD05413185',input:'wibw-xos1-input-1',poster:'https://image-resizer-cloud-cdn.api.graycms.quickplay.com/image/26F5B097-680A-4BA7-8D93-E4FD05413185/0-16x9.jpg?width=640',plot:'Noticias locales de Topeka y el noreste de Kansas. Fuera de los noticieros puede emitir repeticiones o noticias nacionales. Inglés.'},
 {id:'local-kake-news',name:'KAKE 10 · Wichita · EN VIVO',page:'https://www.kake.com/video/live/',poster:'https://www.kake.com/tncms/assets/v3/editorial/4/cc/4cc9c4cf-75d6-486b-bf6c-6c67d3d6bfdb/697bacf2f340f.image.png',plot:'Emisión oficial por internet de KAKE News, Wichita. Noticias en inglés; la programación puede diferir de la señal completa de ABC.'}
];
const channelFor=value=>{try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||u.hash)return null;return OFFICIAL_CHANNELS.find(c=>c.page===u.href)||null;}catch{return null}};
export const isOfficialLivePage=value=>!!channelFor(value instanceof URL?value.href:value);
const fail=()=>{throw Error('official_live_unavailable')};
const safe=value=>{let u;try{u=new URL(value)}catch{fail()}if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||/[\\\u0000-\u0020]/.test(value))fail();return u;};
export function officialMediaAllowed(page,value){
 try{
  const channel=channelFor(page),u=safe(value instanceof URL?value.href:value);if(!channel)return false;
  if(!channel.station)return u.hostname==='townnews.g-mana.live'&&(/^\/media\/[a-f0-9-]{36}\//.test(u.pathname)||u.pathname==='/mrouter')||u.hostname==='ssai1.field59.com'&&u.pathname.startsWith('/kake1/')||u.hostname==='evrideo.g-mana.online'&&u.pathname.startsWith('/gmana-assets/slates/8a1b14d7-36b9-4901-b333-e62abebbb973/');
  if(u.hostname===GRAY)return u.pathname.startsWith('/'+channel.input+'/'+channel.input+'.isml/');
  if(u.hostname==='pubads.g.doubleclick.net')return /^\/ssai\/event\/[A-Za-z0-9_-]+\/master\.m3u8$/.test(u.pathname);
  if(/^rr\d+---sn-[a-z0-9-]+\.googlevideo\.com$/.test(u.hostname))return u.pathname.startsWith('/videoplayback/');
  return u.hostname==='dai.google.com'&&u.pathname.startsWith('/linear/');
 }catch{return false;}
}
async function small(response,max=1000000){
 if(!response.ok){await response.body?.cancel();fail();}const reader=response.body?.getReader();if(!reader)fail();let size=0,result='';const decoder=new TextDecoder();
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>max)fail();result+=decoder.decode(value,{stream:true});}return result+decoder.decode();}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function request(url,{fetcher=fetch,signal,headers={},body}={}){
 const response=await fetcher(url,{method:body?'POST':'GET',redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000),headers:{'User-Agent':'Mozilla/5.0',...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return small(response);
}
async function json(url,options){try{return JSON.parse(await request(url,options))}catch{fail()}}
const payload=value=>{if(value?.header?.code!==0||!value.data)fail();return value.data;};
const encode=bytes=>btoa(String.fromCharCode(...bytes)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const text64=text=>encode(new TextEncoder().encode(text));
async function graySession(channel,deviceId,options){
 const page='https://www.'+channel.station+'.com/livestream/',baseHeaders={Origin:new URL(page).origin,Referer:page};
 const access=await json(new URL('/pf/api/v3/content/fetch/quickplay-platform-auth-iam?query=%7B%7D',page).href,{...options,headers:baseHeaders});if(typeof access.access_token!=='string'||access.access_token.length>12000)fail();
 const headers={...baseHeaders,Authorization:'Bearer '+access.access_token,'X-Client-Id':'gray-gm-web'};
 const qpat=payload(await json('https://auth-gw.api.gray.quickplay.com/platform/access/token',{...options,headers,body:{deviceId}}));if(typeof qpat.token!=='string'||qpat.token.length>12000)fail();
 return {headers:{...headers,'X-Authorization':qpat.token,'X-Property-Id':'gm|'+channel.station+'|'+channel.station},deviceId};
}
export async function resolveOfficialLive(page,options={}){
 const channel=channelFor(page);if(!channel)fail();
 if(!channel.station){
  const html=await request(channel.page,options),block=html.match(/<iframe[^>]+src="(https:\/\/www\.kake\.com\/tncms\/block\/\d+)"/i)?.[1];if(!block)fail();
  const player=await request(block+'/',{...options,headers:{Referer:channel.page}}),url=player.match(/<source[^>]+src="(https:\/\/townnews\.g-mana\.live\/media\/[a-f0-9-]{36}\/master\.m3u8)"/i)?.[1];if(!url||!officialMediaAllowed(page,url))fail();return {url,officialPage:channel.page};
 }
 // Confirm this exact channel is still advertised on the station's official page.
 const html=await request('https://www.'+channel.station+'.com/livestream/',options);
 if(!html.includes('"id":"'+channel.contentId+'"'))fail();
 const deviceId=crypto.randomUUID(),auth=await graySession(channel,deviceId,options);
 const registered=payload(await json('https://device-register-service.api.gray.quickplay.com/device/app/register',{...options,headers:auth.headers,body:{uniqueId:deviceId}}));
 if(typeof registered.secret!=='string'||registered.secret.length>1000)fail();let bytes;try{bytes=Uint8Array.from(atob(registered.secret),c=>c.charCodeAt(0))}catch{fail()}
 const time=Math.floor(Date.now()/1000),sign=text64(JSON.stringify({alg:'HS256',typ:'JWT'}))+'.'+text64(JSON.stringify({deviceId,aud:'playback-auth-service',iat:time,exp:time+3600}));
 const key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['sign']),deviceToken=sign+'.'+encode(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(sign))));
 const body={deviceName:'web',deviceId,contentId:channel.contentId,contentTypeId:'live',catalogType:'channel',mediaFormat:'hls',drm:'none',delivery:'streaming',disableSsai:'false',urlParameters:{'ads.ltd':'1','ads.npa':'1','ads.rdp':'1','ads.url':channel.page,'ads.vpos':'midroll'},playbackMode:'live',quality:'medium',supportedResolution:'FHD'};
 const data=payload(await json('https://playback-auth-service.api.gray.quickplay.com/media/content/authorize',{...options,headers:{...auth.headers,'X-device-id':deviceToken},body}));
 if(data.pgmBlackout||data.drm!=='none'||!officialMediaAllowed(page,data.contentUrl)||!data.ssaiEnabled||! /^[A-Za-z0-9_-]{8,100}$/.test(data.assetKey||''))fail();
 // Use the same ad-stitched stream as the public player. Do not bypass advertisements.
 const url=new URL('https://pubads.g.doubleclick.net/ssai/event/'+data.assetKey+'/master.m3u8');
 for(const [k,v]of Object.entries(data.custom?.adParams||{}).sort())if(!['an','idtype','is_lat','lat','msid','rdid'].includes(k)&&v!==null&&v!==undefined)url.searchParams.set(k,String(v));
 if(typeof data.heartbeatToken!=='string'||data.heartbeatToken.length>12000)fail();
 return {url:url.href,officialPage:channel.page,officialHeartbeat:{page:channel.page,deviceId,contentId:channel.contentId,token:data.heartbeatToken,startedAt:Date.now()}};
}
// Bounded, in-memory heartbeat coalescing; no public logs or persistent credentials.
const beats=new Map();
export async function officialHeartbeat(state,options={}){
 if(!state)return;const channel=channelFor(state.page);if(!channel?.station||channel.contentId!==state.contentId||! /^[a-f0-9-]{36}$/.test(state.deviceId)||typeof state.token!=='string')fail();
 const now=Date.now();for(const [key,value]of beats)if(now-value.at>3600000)beats.delete(key);
 const previous=beats.get(state.deviceId);if(now-(previous?.at||state.startedAt)<55000)return previous?.promise;
 if(beats.size>=256)beats.delete(beats.keys().next().value);
 const entry={at:now,token:previous?.token||state.token};beats.set(state.deviceId,entry);
 entry.promise=(async()=>{const auth=await graySession(channel,state.deviceId,options),data=payload(await json('https://heartbeat-service.api.gray.quickplay.com/user/heartbeat/update',{...options,headers:{...auth.headers,'X-Heartbeat':entry.token},body:{deviceId:state.deviceId,itemId:state.contentId,offset:Math.max(0,Math.floor((now-state.startedAt)/1000))}}));if(typeof data.heartbeatToken==='string')entry.token=data.heartbeatToken;})();
 try{await entry.promise}catch{entry.at=now-45000;fail();}
}
