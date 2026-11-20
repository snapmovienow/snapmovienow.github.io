// Finite, owner-reviewed comedy episode pages. Read public player configuration
// as data; never execute its scripts or retain the temporary playback session.
const COUNTS=[10,10,10,6,6];
const HOSTS=new Set(['sv2.ibra.lat','sv3.ibra.lat','sv4.ibra.lat']);
const fail=(reason='comedy_source_unavailable')=>{throw Error(reason);};
function safe(value){
 if(value instanceof URL)value=value.href;
 if(typeof value!=='string'||value.length>12000||/[\\\u0000-\u0020]/.test(value)||/%(?:2e|2f|5c)/i.test(value.split(/[?#]/,1)[0]))fail();
 let u;try{u=new URL(value)}catch{fail()}
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||/%(?:2e|2f|5c)/i.test(u.pathname))fail();return u;
}
function definition(value){
 try{
  const u=safe(value),m=u.pathname.match(/^\/episodio\/machos-alfa-zhmk-([1-5])x([1-9]|10)\/$/);
  return u.hostname==='pelisflix200.date'&&!u.search&&m&&Number(m[2])<=COUNTS[Number(m[1])-1]?{page:u.href,season:Number(m[1]),episode:Number(m[2])}:null;
 }catch{return null;}
}
export const isComedyPelisflixPage=value=>!!definition(value);
const watch=value=>{try{const u=safe(value);return u.hostname==='nupload.my'&&/^\/watch\/[A-Za-z0-9]{32,100}$/.test(u.pathname)&&!u.search;}catch{return false;}};
const masterPath=path=>/^\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{8,64}\.m3u8$/.test(path);
const prefixPattern=/^\/filess?\/[a-f0-9]{1,8}\/[a-f0-9]{8,64}\/$/;
function validContext(page,context){
 const d=definition(page);if(!d||!context||context.provider!=='nupload'||context.page!==d.page||!watch(context.wrapper)||!HOSTS.has(context.host)||!prefixPattern.test(context.prefix||'')||!/^\d{10,13}$/.test(context.expires||'')||!Number.isSafeInteger(context.segmentCount)||context.segmentCount<1||context.segmentCount>20000)return null;
 try{
  const u=safe(context.masterUrl);if(u.hostname!==context.host)return null;
  if(u.pathname==='/'){if([...u.searchParams.keys()].join(',')!=='s'||!/^[A-Za-z0-9]{32,160}$/.test(u.searchParams.get('s')||''))return null;}
  else if(!masterPath(u.pathname)||u.search)return null;
 }catch{return null;}return d;
}
export function comedyPelisflixMediaAllowed(page,value,context={}){
 try{
  if(!validContext(page,context))return false;const u=safe(value);if(u.hostname!==context.host)return false;
  if(u.href===context.masterUrl)return true;
  if(!u.pathname.startsWith(context.prefix))return false;
  const file=u.pathname.slice(context.prefix.length).match(/^video(0|[1-9]\d{0,4})\.ts$/);if(!file||Number(file[1])>=context.segmentCount)return false;
  return [...u.searchParams.keys()].join(',')==='m,e'&&/^[A-Za-z0-9_-]{22,100}$/.test(u.searchParams.get('m')||'')&&u.searchParams.get('e')===context.expires;
 }catch{return false;}
}
export function comedyPelisflixMediaHeaders(page,context={}){
 if(!validContext(page,context))fail();return {Referer:context.wrapper,Origin:'https://nupload.my'};
}
async function bodyText(response,max=1000000){
 if(!response.ok){await response.body?.cancel();fail();}
 if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();fail();}
 const reader=response.body?.getReader();if(!reader)fail();let size=0,text='';const decoder=new TextDecoder();
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)fail();text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
async function request(value,allowed,{fetcher,signal,headers={}}){
 let u=safe(value);
 for(let hop=0;hop<3;hop++){
  if(signal?.aborted)throw signal.reason;if(!allowed(u))fail();
  const response=await fetcher(u.href,{headers:{'User-Agent':'Mozilla/5.0',...headers},redirect:'manual',signal});
  if(response.status<300||response.status>=400)return {response,url:u.href};
  const location=response.headers.get('location');await response.body?.cancel();if(!location||hop===2)fail();u=safe(new URL(location,u).href);
 }fail();
}
async function read(value,allowed,options){const r=await request(value,allowed,options);return {text:await bodyText(r.response),url:r.url};}
const escaped=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function publicPlayerSource(html){
 // Match the narrow decoder currently published in the anonymous JW player.
 const decoder=html.match(/var\s+([A-Za-z_$][\w$]{0,79})\s*=\s*"";\s*([A-Za-z_$][\w$]{0,79})\.forEach\(function\s+[A-Za-z_$][\w$]*\(value\)\s*\{\s*\1\s*\+=\s*String\.fromCharCode\(parseInt\(atob\(value\)\.replace\(\/\\D\/g,['"]['"]\)\)\s*-\s*(\d{1,10})\)/);
 if(!decoder)fail();
 const list=html.match(new RegExp('\\bvar\\s+'+escaped(decoder[2])+'\\s*=\\s*(\\[[^;]{1,16000}\\])'))?.[1];
 const session=html.match(/\bvar\s+sesz=["']([A-Za-z0-9]{32,160})["']/)?.[1];
 if(!list||!session||!new RegExp('\\bfile\\s*:\\s*'+escaped(decoder[1])+'\\s*\\+\\s*["\x27]\\?s=["\x27]\\s*\\+\\s*sesz\\b').test(html))fail();
 let values;try{values=JSON.parse(list)}catch{fail()}
 if(!Array.isArray(values)||values.length<10||values.length>200)fail();let base='';
 for(const item of values){
  if(typeof item!=='string'||item.length>160)fail();let decoded;try{decoded=atob(item)}catch{fail()}
  const digits=decoded.replace(/\D/g,'');if(!/^\d{1,12}$/.test(digits))fail();const code=Number(digits)-Number(decoder[3]);if(code<33||code>126)fail();base+=String.fromCharCode(code);
 }
 const u=safe(base);if(!HOSTS.has(u.hostname)||u.pathname!=='/'||u.search)fail();u.search=new URLSearchParams({s:session});return u.href;
}
function playlist(text){
 if(!text.trimStart().startsWith('#EXTM3U')||!/#EXT-X-ENDLIST(?:\r?\n|$)/.test(text)||/#EXT-X-(?:KEY|SESSION-KEY|STREAM-INF|MEDIA):|KEYFORMAT=|METHOD=SAMPLE-AES/i.test(text))fail();
 const entries=text.split(/\r?\n/).map(x=>x.trim()).filter(x=>x&&!x.startsWith('#'));if(entries.length<1||entries.length>20000)fail();return entries;
}
async function verifyTransportStream(url,allowed,options){
 const {response}=await request(url,allowed,{...options,headers:{...options.headers,Range:'bytes=0-1315'}});
 if(!response.ok){await response.body?.cancel();fail();}const reader=response.body?.getReader();if(!reader)fail();let bytes=new Uint8Array(0);
 try{
  while(bytes.length<1316){const {value,done}=await reader.read();if(done)break;const next=new Uint8Array(Math.min(1316,bytes.length+value.length));next.set(bytes);next.set(value.subarray(0,next.length-bytes.length),bytes.length);bytes=next;}
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const text=new TextDecoder().decode(bytes);if(/File deleted by DMCA request/i.test(text))fail('comedy_media_removed');
 if(bytes.length<377||bytes[0]!==0x47||bytes[188]!==0x47||bytes[376]!==0x47)fail('comedy_media_missing');
}
export async function resolveComedyPelisflix(page,{fetcher=fetch,signal}={}){
 const d=definition(page);if(!d)fail();const options={fetcher,signal:signal?AbortSignal.any([signal,AbortSignal.timeout(35000)]):AbortSignal.timeout(35000)};
 const {text:html}=await read(d.page,u=>u.href===d.page,options);
 const heading=html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim()||'';
 if(!new RegExp('^Ver Machos alfa Episodio '+d.episode+' Temporada '+d.season+'$','i').test(heading))fail();
 const choices=[];
 for(const m of html.matchAll(/<div\b[^>]*\bdata-url=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi)){
  if(m[1].length>2048||!/^\s*(?:\d+\s*)?CASTELLANO\b/i.test(m[2].replace(/<[^>]*>/g,' ')))continue;
  try{const value=atob(m[1]);if(watch(value))choices.push(value);}catch{}
 }
 const wrappers=[...new Set(choices)];if(wrappers.length!==1)fail();const wrapper=wrappers[0];
 const {text:player}=await read(wrapper,u=>u.href===wrapper,{...options,headers:{Referer:d.page}}),source=publicPlayerSource(player),host=new URL(source).hostname;
 const headers={Referer:wrapper,Origin:'https://nupload.my'};
 const {text,url}=await read(source,u=>u.hostname===host&&(u.href===source||masterPath(u.pathname)&&!u.search),{...options,headers});
 const entries=playlist(text),first=safe(new URL(entries[0],url).href),prefix=first.pathname.slice(0,first.pathname.lastIndexOf('/')+1);
 const context={provider:'nupload',page:d.page,wrapper,host,prefix,masterUrl:url,expires:first.searchParams.get('e'),segmentCount:entries.length};
 if(!validContext(d.page,context))fail();
 for(let i=0;i<entries.length;i++){
  const segment=safe(new URL(entries[i],url).href);if(!comedyPelisflixMediaAllowed(d.page,segment,context)||segment.pathname!==prefix+'video'+i+'.ts')fail();
 }
 // Some removed files still return a valid manifest and HTTP 200 HTML segments.
 // Confirm real MPEG-TS bytes before reporting a playable public source.
 await verifyTransportStream(first.href,u=>comedyPelisflixMediaAllowed(d.page,u,context),{...options,headers});
 return {url,context};
}
