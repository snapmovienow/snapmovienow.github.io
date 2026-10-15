// Resolve a saved episode page at playback time: CDN signatures are temporary.
export const GNULA_PAGE_HOSTS=new Set(['www2.gnula.one','gnula.one','www.gnula.one','ww3.gnulahd.nu']);
const VOE_HOSTS=new Set(['voe.sx','teresapoliticallearn.com','megankiddifference.com']);
const embedPattern=/^https:\/\/(?:voe\.sx\/e\/[a-z0-9]+|uqload\.(?:com|vc)\/embed-[a-z0-9]+\.html)$/;
export function allowedGnula(u){return u.protocol==='https:'&&/^(?:strm\d+\.uqload\.vc|ugc-cdn-caching-[a-z0-9]+\.cloudwindow-route\.com)$/.test(u.hostname)&&!u.port&&!u.username&&!u.password;}
const cleanURL=(value,allowed)=>{const u=new URL(value);if(u.protocol!=='https:'||u.port||u.username||u.password||!allowed(u))throw Error('source_not_allowed');return u;};
async function textResponse(response,max=1000000){
 if(!response.ok){await response.body?.cancel();throw Error('source_unavailable');}
 if(Number(response.headers.get('content-length'))>max){await response.body?.cancel();throw Error('source_too_large');}
 const reader=response.body?.getReader();if(!reader)return '';
 const decoder=new TextDecoder();let result='',size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Error('source_too_large');result+=decoder.decode(value,{stream:true});}return result+decoder.decode();}
 catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
}
async function sourceText(value,allowed,{fetcher,signal,headers={}}){
 let u=cleanURL(value,allowed);
 for(let i=0;i<4;i++){
  const response=await fetcher(u.href,{headers:{'User-Agent':'Mozilla/5.0',...headers},redirect:'manual',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});
  if(response.status<300||response.status>=400)return textResponse(response);
  const location=response.headers.get('location');await response.body?.cancel();
  if(!location||i===3)throw Error('source_redirect');u=cleanURL(new URL(location,u).href,allowed);
 }throw Error('source_redirect');
}
function decodeVoe(text){
 for(const match of text.matchAll(/<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g)){
  try{const a=JSON.parse(match[1]);if(!Array.isArray(a)||typeof a[0]!=='string')continue;
   let v=a[0].replace(/[a-zA-Z]/g,c=>String.fromCharCode(c.charCodeAt(0)+(c.toLowerCase()<='m'?13:-13))).replace(/@\$|\^\^|~@|%\?|\*~|!!|#&/g,'');
   v=Array.from(atob(v),c=>String.fromCharCode(c.charCodeAt(0)-3)).reverse().join('');
   const config=JSON.parse(atob(v));if(typeof config.source==='string')return config.source;
  }catch{}
 }throw Error('unsupported_config');
}
async function episodeEmbeds(page,html,options){
 if(page.hostname!=='ww3.gnulahd.nu'){
  for(const m of html.matchAll(/data-iframe="([^"]+)"/g))try{html+=' '+atob(m[1]);}catch{}
  return html.match(/https:\/\/(?:voe\.sx\/e\/[a-z0-9]+|uqload\.(?:com|vc)\/embed-[a-z0-9]+\.html)/g)||[];
 }
 const config=html.match(/window\.GNRD\s*=\s*\{\s*pid\s*:\s*(\d+)\s*,\s*tok\s*:\s*"([A-Za-z0-9._-]{1,200})"\s*,\s*k\s*:\s*"([A-Za-z0-9+/=]{1,200})"(?:\s*,\s*(?:firstEp|lastEp)\s*:\s*\d+){0,2}\s*\}/);
 if(!config)throw Error('unsupported_source');
 const api=new URL('/wp-json/gnrd/v1/player',page);api.search=new URLSearchParams({id:config[1],t:config[2]});
 const reply=JSON.parse(await sourceText(api.href,u=>u.origin===page.origin,{...options,headers:{'X-Requested-With':'gnrd','Referer':page.href}}));
 const key=atob(config[3]),encoded=atob(reply.p);if(!key.length)throw Error('unsupported_source');
 const bytes=Uint8Array.from(encoded,(c,i)=>c.charCodeAt(0)^key.charCodeAt(i%key.length));
 const data=JSON.parse(new TextDecoder().decode(bytes));if(!Array.isArray(data.langs))throw Error('unsupported_source');
 // Match the site's Latino choice; never fall back to a different dub on failure.
 const language=data.langs.find(x=>String(x.label).toLowerCase()==='latino')||data.langs[0];
 return (language?.servers||[]).map(x=>x.src).filter(x=>typeof x==='string'&&embedPattern.test(x));
}
export async function resolveGnula(pageUrl='https://www2.gnula.one/movie/batman-vs-superman-el-origen-de-la-justicia/',preferredEmbed=null,{signal,fetcher=fetch}={}){
 const options={signal,fetcher},page=cleanURL(pageUrl,u=>GNULA_PAGE_HOSTS.has(u.hostname));
 const html=await sourceText(page.href,u=>GNULA_PAGE_HOSTS.has(u.hostname),options);
 const embeds=[...new Set([...(preferredEmbed&&embedPattern.test(preferredEmbed)?[preferredEmbed]:[]),...await episodeEmbeds(page,html,options)])];
 for(const embed of embeds){
  if(signal?.aborted)throw signal.reason;
  try{
   const voe=new URL(embed).hostname==='voe.sx',allowed=u=>voe?VOE_HOSTS.has(u.hostname)&&/^\/e\/[a-z0-9]+$/.test(u.pathname):['uqload.com','uqload.vc'].includes(u.hostname)&&/^\/embed-[a-z0-9]+\.html$/.test(u.pathname);
   let text=await sourceText(embed,allowed,options),source;
   if(voe){
    const redirect=text.match(/window\.location\.href\s*=\s*['"](https:\/\/[^'"]+)['"]/)?.[1];
    if(redirect){const target=cleanURL(redirect,allowed);if(target.pathname!==new URL(embed).pathname)throw Error('source_redirect');text=await sourceText(target.href,allowed,options);}
    source=decodeVoe(text);
   }else{
    const packed=text.match(/\}\('((?:\\.|[^'])*)',(\d+),(\d+),'([^']*)'\.split\('\|'\)/);
    if(packed){const radix=Number(packed[2]),words=packed[4].split('|');if(radix<2||radix>36)throw Error('unsupported_config');text=packed[1].replace(/\b[0-9a-z]+\b/g,v=>{const i=parseInt(v,radix);return Number.isFinite(i)&&words[i]?words[i]:v;});}
    source=text.match(/file\s*:\s*"(https:[^"]+\.m3u8[^"]*)"/)?.[1];
   }
   if(!source)continue;cleanURL(source,allowedGnula);
   if((await sourceText(source,allowedGnula,options)).trimStart().startsWith('#EXTM3U'))return source;
  }catch(e){if(signal?.aborted)throw signal.reason;}
 }throw Error('media_missing');
}
