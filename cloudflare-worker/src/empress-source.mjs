// Owner-reviewed episode pages only. Fresh anonymous player URLs are resolved at
// every start; this module never persists CDN signatures or executes page code.
const VOE_IDS=['qbx1bmzqqoxm','zhbsadlqzyhb','hcmxykc2a6yu','ifq0dewv8v1u'];
const fail=()=>{throw Error('empress_source_unavailable');};
const safe=value=>{
 if(typeof value!=='string'||value.length>12000||/[\\\u0000-\u0020]/.test(value)||/%(?:2e|2f|5c)/i.test(value.split(/[?#]/,1)[0]))fail();
 let u;try{u=new URL(value)}catch{fail()}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.href.includes('#')||/%(?:2e|2f|5c)/i.test(u.pathname))fail();return u;
};
function definition(value){
 try{
  const u=safe(value instanceof URL?value.href:value);if(u.href.includes('?'))return null;
  const p=u.hostname==='pelisflix200.rest'?u.pathname.match(/^\/episodio\/la-emperatriz-divorciada-1x([1-4])\/$/):null;
  const t=u.hostname==='tudorama.com'?u.pathname.match(/^\/ver\/the-remarried-empress-s1x([1-4])\/$/):null;
  return p||t?{page:u.href,episode:Number((p||t)[1]),provider:p?'nupload':'voe'}:null;
 }catch{return null;}
}
export const isEmpressPage=value=>!!definition(value);
const wrapperAllowed=value=>{try{const u=safe(value);return u.hostname==='nupload.my'&&/^\/watch\/[A-Za-z0-9]{32,100}$/.test(u.pathname)&&!u.search;}catch{return false;}};
const nuploadHost=host=>/^sv(?:2|3|5)\.ibra\.lat$/.test(host||'');
const nuploadMasterPath=path=>/^\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{8,64}\.m3u8$/.test(path||'');
const voeHost=host=>/^ugc-cdn-caching-[a-z0-9]{1,80}\.cloudwindow-route\.com$/.test(host||'');
function validContext(page,context){
 const d=definition(page);if(!d||!context||context.provider!==d.provider||context.episode!==d.episode)return null;
 if(d.provider==='nupload')return wrapperAllowed(context.wrapper)&&nuploadHost(context.host)&&/^\/files\/\d{1,8}\/[a-f0-9]{8,64}\/$/.test(context.prefix||'')&&(!context.masterPath||context.masterPath==='/'||nuploadMasterPath(context.masterPath))?d:null;
 const id=VOE_IDS[d.episode-1],prefix=new RegExp('^/engine/hls2-c/\\d{2}/\\d{1,10}/'+id+'_[a-z0-9_,.-]{1,40}\\.urlset/$');
 return voeHost(context.host)&&prefix.test(context.prefix||'')?d:null;
}
export function empressMediaAllowed(page,value,context={}){
 try{
  const d=validContext(page,context),u=safe(value instanceof URL?value.href:value);if(!d||u.hostname!==context.host)return false;
  if(d.provider==='nupload'&&u.pathname===(context.masterPath||'/'))return u.pathname==='/'?[...u.searchParams.keys()].join(',')==='s'&&/^[A-Za-z0-9]{32,160}$/.test(u.searchParams.get('s')||''):!u.search;
  return u.pathname.startsWith(context.prefix)&&/\.(?:m3u8|ts|m4s|mp4|aac|key|vtt|webvtt)$/.test(u.pathname);
 }catch{return false;}
}
export function empressMediaHeaders(page,context={}){
 const d=validContext(page,context);if(!d)fail();
 return d.provider==='nupload'?{Referer:context.wrapper,Origin:'https://nupload.my'}:{};
}
async function textResponse(response,max){
 if(!response.ok){await response.body?.cancel();fail();}
 if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();fail();}
 const reader=response.body?.getReader();if(!reader)fail();let size=0,text='';const decoder=new TextDecoder();
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)fail();text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function read(value,allowed,{fetcher,signal,headers={},onResolved},max=1000000){
 let u=safe(value);
 for(let hop=0;hop<3;hop++){
  if(signal?.aborted)throw signal.reason;
  if(!allowed(u))fail();
  const response=await fetcher(u.href,{headers:{'User-Agent':'Mozilla/5.0',...headers},redirect:'manual',signal});
  if(response.status<300||response.status>=400){const text=await textResponse(response,max);onResolved?.(u.href);return text;}
  const location=response.headers.get('location');await response.body?.cancel();if(!location||hop===2)fail();u=safe(new URL(location,u).href);
 }fail();
}
const escaped=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function nuploadSource(html){
 const variable=html.match(/\b([A-Za-z_$][\w$]{0,79})\.forEach\(function\s+[A-Za-z_$][\w$]*\(value\)/)?.[1];if(!variable)fail();
 const list=html.match(new RegExp('var\\s+'+escaped(variable)+'\\s*=\\s*(\\[[^;]{1,16000}\\])'))?.[1];
 const offset=Number(html.match(/String\.fromCharCode\(parseInt\(atob\(value\)\.replace\(\/\\D\/g,['"]['"]\)\)\s*-\s*(\d{1,10})/)?.[1]);
 const session=html.match(/\bvar\s+sesz=["']([A-Za-z0-9]{32,160})["']/)?.[1];
 if(!list||!Number.isSafeInteger(offset)||!session)fail();
 let items;try{items=JSON.parse(list)}catch{fail()}
 if(!Array.isArray(items)||items.length<10||items.length>200)fail();
 let base='';for(const item of items){if(typeof item!=='string'||item.length>160)fail();let decoded;try{decoded=atob(item)}catch{fail()}
  const digits=decoded.replace(/\D/g,'');if(!/^\d{1,12}$/.test(digits))fail();const n=Number(digits)-offset;if(n<33||n>126)fail();base+=String.fromCharCode(n);
 }
 const u=safe(base);if(!nuploadHost(u.hostname)||u.pathname!=='/'||u.search)fail();u.search=new URLSearchParams({s:session});return u.href;
}
function decodeVoe(html){
 for(const match of html.matchAll(/<script\b[^>]*\btype=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi)){
  try{
   if(match[1].length>300000)continue;const a=JSON.parse(match[1]);if(!Array.isArray(a)||typeof a[0]!=='string')continue;
   const rot=a[0].replace(/[a-zA-Z]/g,c=>String.fromCharCode(c.charCodeAt(0)+(c.toLowerCase()<='m'?13:-13)));
   const bytes=atob(rot.replace(/[^a-zA-Z0-9+/=]/g,'')),reversed=Array.from(bytes,c=>String.fromCharCode(c.charCodeAt(0)-3)).reverse().join('');
   return JSON.parse(atob(reversed));
  }catch{}
 }fail();
}
function hls(text){
 if(!text.trimStart().startsWith('#EXTM3U')||/KEYFORMAT=|METHOD=SAMPLE-AES|#EXT-X-SESSION-KEY:/i.test(text))fail();
 return text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));
}
export async function resolveEmpressSource(page,{fetcher=fetch,signal}={}){
 const d=definition(page);if(!d)fail();
 const options={fetcher,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(35000)]):AbortSignal.timeout(35000)};
 const html=await read(d.page,u=>u.href===d.page,options);
 if(d.provider==='nupload'){
  const heading=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g,' ').toLowerCase()||'';
  if(!heading.includes('la emperatriz divorciada')||!new RegExp('episodio\\s+'+d.episode+'(?:\\D|$)').test(heading))fail();
  const choices=[];
  for(const m of html.matchAll(/<div\b[^>]*\bdata-url=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi)){
   if(m[1].length>2048||!/\bCASTELLANO\b/.test(m[2].replace(/<[^>]*>/g,' ').toUpperCase()))continue;
   try{const wrapper=atob(m[1]);if(wrapperAllowed(wrapper))choices.push(wrapper);}catch{}
  }
  const wrapper=[...new Set(choices)];if(wrapper.length!==1)fail();
  const player=await read(wrapper[0],u=>u.href===wrapper[0],{...options,headers:{Referer:d.page}}),url=nuploadSource(player);
  // Read the public player's normal manifest once to bind all later requests to
  // this particular file directory. Headers never include customer credentials.
  const host=new URL(url).hostname;let resolvedUrl=url;
  const text=await read(url,u=>u.hostname===host&&(u.href===url||nuploadMasterPath(u.pathname)&&!u.search),{...options,headers:{Referer:wrapper[0],Origin:'https://nupload.my'},onResolved:value=>{resolvedUrl=value;}});
  const child=hls(text)[0];if(!child)fail();const destination=safe(new URL(child,resolvedUrl).href);
  const prefix=destination.pathname.match(/^\/files\/\d{1,8}\/[a-f0-9]{8,64}\//)?.[0];
  const context={provider:d.provider,episode:d.episode,wrapper:wrapper[0],host,prefix,masterPath:new URL(resolvedUrl).pathname};
  if(destination.hostname!==host||!validContext(d.page,context)||!empressMediaAllowed(d.page,destination,context))fail();
  return {url:resolvedUrl,empressPage:d.page,empressContext:context};
 }
 const id=VOE_IDS[d.episode-1],ids=[...new Set([...html.matchAll(/https:\/\/cdn\.tudorama\.com\/sub\/download-6\.php\?id=([a-z0-9]{8,30})(?=["'&<\s])/g)].map(m=>m[1]))];
 if(ids.length!==1||ids[0]!==id)fail();
 const embed='https://voe.sx/'+id,allowed=u=>['voe.sx','shannoncoldalready.com'].includes(u.hostname)&&u.pathname==='/'+id&&!u.search;
 let player=await read(embed,allowed,options,1200000);
 const redirect=player.match(/window\.location\.href\s*=\s*["'](https:\/\/[^"']+)["']/)?.[1];if(redirect)player=await read(redirect,allowed,options,1200000);
 const payload=decodeVoe(player),title=typeof payload.title==='string'?payload.title:'';
 if(!new RegExp('^LED\\s+0?'+d.episode+'\\s+SubEsp(?:\\s|\\[|\\.)','i').test(title)||payload.default_captions_language!=='es'||!Array.isArray(payload.audio_languages)||!payload.audio_languages.some(x=>x?.countryCode==='ko'||x?.language==='Korean')||payload.drm)fail();
 const url=safe(payload.source),prefix=url.pathname.slice(0,url.pathname.lastIndexOf('/')+1),context={provider:d.provider,episode:d.episode,host:url.hostname,prefix};
 if(!validContext(d.page,context)||!empressMediaAllowed(d.page,url,context)||!url.pathname.endsWith('/master.m3u8'))fail();
 const text=await read(url.href,u=>empressMediaAllowed(d.page,u,context),options);if(!hls(text).length)fail();
 return {url:url.href,empressPage:d.page,empressContext:context};
}
