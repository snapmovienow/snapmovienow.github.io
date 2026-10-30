import {publicLiveDescriptor,forgetPublicLiveDescriptor,readPublicLiveDescriptor} from './public-live-descriptor.mjs';
// Official public news players, resolved afresh; no TV-provider accounts or saved session URLs.
export const REGIONAL_CHANNELS=[
 {
  "id": "local-nbc-newyork",
  "name": "NBC New York News · NY/NJ · EN VIVO",
  "page": "https://www.nbcnewyork.com/watch/",
  "categories": [
   "new-york"
  ],
  "adapter": "nbcu-fast",
  "streamId": "88889709",
  "mediaHost": "xumo-drct-ch101-8hacu.fast.nbcuni.com",
  "poster": "https://media.nbcnewyork.com/2024/05/Tile-NBC-New-York.png?resize=850%2C478&quality=85&strip=all",
  "plot": "Noticias y clima de New York y su área metropolitana, en inglés. Canal web oficial gratuito; programación distinta de NBC 4 completa."
 },
 {
  "id": "local-cbs-newyork",
  "name": "CBS News New York · NY/NJ · EN VIVO",
  "page": "https://www.cbsnews.com/newyork/live/",
  "categories": [
   "new-york"
  ],
  "adapter": "cbs-local",
  "event": "jeTDC610T-OSPdiWhcl0Pg",
  "mediaHost": "newyo9h67ea3.airspace-cdn.cbsivideo.com",
  "poster": "https://assets2.cbsnewsstatic.com/hub/i/r/2023/11/03/bb781080-52b7-4b09-9369-9a4c735a79a0/thumbnail/1200x630/bc746502e37e91e74f2626d8cba19e45/keyart-newyork-1920x1080.jpg",
  "plot": "Noticias locales en inglés, en vivo y repeticiones. Señal web oficial de CBS News; no incluye toda la programación de la cadena CBS."
 },
 {
  "id": "local-telemundo-noreste",
  "name": "Telemundo Noticias Noreste · NY/NJ · ESPAÑOL",
  "page": "https://www.telemundo47.com/ver/",
  "categories": [
   "new-york",
   "new-jersey"
  ],
  "adapter": "nbcu-fast",
  "streamId": "88889716",
  "mediaHost": "ch115-xumo-drct-em2mv.fast.nbcuni.com",
  "poster": "https://media.telemundo47.com/2022/08/WNJU-tvOS_App-Store-1280x768-1.png?resize=850%2C478&quality=85&strip=all",
  "plot": "Noticias en español de Telemundo para el noreste, incluyendo New York y New Jersey. Canal regional web compartido; no es la programación completa de WNJU 47."
 },
 {
  "id": "local-nbc-philadelphia",
  "name": "NBC10 News · Philadelphia/South Jersey · EN VIVO",
  "page": "https://www.nbcphiladelphia.com/watch/",
  "categories": [
   "new-jersey"
  ],
  "adapter": "nbcu-fast",
  "streamId": "88889705",
  "mediaHost": "xumo-drct-ch104-mnm32.fast.nbcuni.com",
  "poster": "https://media.nbcphiladelphia.com/2024/06/Tile_NEW-NBC10PhilaNewsLogo_DM_v2_001.jpg?quality=85&strip=all&resize=850%2C478",
  "plot": "Noticias y clima de Philadelphia, sur de New Jersey y Delaware, en inglés. Emisión web oficial; no es la programación completa de NBC10."
 },
 {
  "id": "local-cbs-philadelphia",
  "name": "CBS News Philadelphia · South Jersey · EN VIVO",
  "page": "https://www.cbsnews.com/philadelphia/live/",
  "categories": [
   "new-jersey"
  ],
  "adapter": "cbs-local",
  "event": "R2Kw0uvnQIW7fUmOseurzA",
  "mediaHost": "phila5bcfb03.airspace-cdn.cbsivideo.com",
  "poster": "https://assets1.cbsnewsstatic.com/hub/i/r/2023/11/06/a7afdc73-333a-4faf-a06f-e0004e9621d5/thumbnail/1200x630/3d76fa034e255f96498281a4f242387a/keyart-philadelphia-1920x1080.jpg",
  "plot": "Noticias locales en inglés, en vivo y repeticiones. Señal web oficial de CBS News; no incluye toda la programación de la cadena CBS."
 },
 {
  "id": "local-nbc-losangeles",
  "name": "NBC Los Angeles News · EN VIVO",
  "page": "https://www.nbclosangeles.com/watch/",
  "categories": [
   "california"
  ],
  "adapter": "nbcu-fast",
  "streamId": "88889710",
  "mediaHost": "xumo-drct-ch109-8jv1c.fast.nbcuni.com",
  "poster": "https://media.nbclosangeles.com/2024/05/NBC-Los-Angeles-FAST-thumbnail-as-of-6.3.24.png?resize=850%2C478&quality=85&strip=all",
  "plot": "Noticias y clima de Los Angeles y el sur de California, en inglés. Canal web oficial gratuito; programación distinta de NBC 4 completa."
 },
 {
  "id": "local-nbc-bayarea",
  "name": "NBC Bay Area News · EN VIVO",
  "page": "https://www.nbcbayarea.com/watch/",
  "categories": [
   "california"
  ],
  "adapter": "nbcu-fast",
  "streamId": "88889711",
  "mediaHost": "xumo-drct-ch110-as8cj.fast.nbcuni.com",
  "poster": "https://media.nbcbayarea.com/2024/06/KNTV-BayBridge-evening-FAST.png?resize=850%2C478&quality=85&strip=all",
  "plot": "Noticias y clima del área de la Bahía, San Francisco y San Jose, en inglés. Canal web oficial gratuito; no es la programación completa de NBC."
 },
 {
  "id": "local-nbc-sandiego",
  "name": "NBC San Diego News · EN VIVO",
  "page": "https://www.nbcsandiego.com/watch/",
  "categories": [
   "california"
  ],
  "adapter": "nbcu-fast",
  "streamId": "88889712",
  "mediaHost": "xumo-drct-ch108-r9w98.fast.nbcuni.com",
  "poster": "https://media.nbcsandiego.com/2024/06/Tile-NBC-San-Diego.png?resize=850%2C478&quality=85&strip=all",
  "plot": "Noticias y clima de San Diego, en inglés. Canal web oficial gratuito; programación distinta de NBC 7 completa."
 },
 {
  "id": "local-cbs-losangeles",
  "name": "CBS News Los Angeles · EN VIVO",
  "page": "https://www.cbsnews.com/losangeles/live/",
  "categories": [
   "california"
  ],
  "adapter": "cbs-local",
  "event": "K_2aA7OVRTacJJli1oSi8w",
  "mediaHost": "losandd87138.airspace-cdn.cbsivideo.com",
  "poster": "https://assets1.cbsnewsstatic.com/hub/i/r/2023/11/06/5c8af6f5-24f8-4777-9b62-da6a483acaba/thumbnail/1200x630/e8401315b8198895b305b80535f57266/keyart-losangeles-1920x1080.jpg",
  "plot": "Noticias locales en inglés, en vivo y repeticiones. Señal web oficial de CBS News; no incluye toda la programación de la cadena CBS."
 },
 {
  "id": "local-cbs-bayarea",
  "name": "CBS News Bay Area · EN VIVO",
  "page": "https://www.cbsnews.com/sanfrancisco/live/",
  "categories": [
   "california"
  ],
  "adapter": "cbs-local",
  "event": "laLJwH1nS2KQAUQTF8z1Cg",
  "mediaHost": "baya0f96heg.airspace-cdn.cbsivideo.com",
  "poster": "https://assets1.cbsnewsstatic.com/hub/i/r/2023/11/07/ae0d6efc-6c56-42e1-a5d6-bee200328ba6/thumbnail/1200x630/5ea2b55815c24638b7e4cb105c553c11/keyart-bayarea-1920x1080.jpg",
  "plot": "Noticias locales en inglés, en vivo y repeticiones. Señal web oficial de CBS News; no incluye toda la programación de la cadena CBS."
 },
 {
  "id": "local-cbs-sacramento",
  "name": "CBS News Sacramento · EN VIVO",
  "page": "https://www.cbsnews.com/sacramento/live/",
  "categories": [
   "california"
  ],
  "adapter": "cbs-local",
  "event": "e7mp4YVGS7O_e7rqRNjKow",
  "mediaHost": "sacra3hadh4b.airspace-cdn.cbsivideo.com",
  "poster": "https://assets1.cbsnewsstatic.com/hub/i/r/2023/11/08/b2c76bd6-90f8-48a6-8974-d79f5cb44d5a/thumbnail/1200x630/2bddf63b67986ce9320471f7b95407cb/keyart-sacramento-1920x1080.jpg",
  "plot": "Noticias locales en inglés, en vivo y repeticiones. Señal web oficial de CBS News; no incluye toda la programación de la cadena CBS."
 },
 {
  "id": "local-telemundo-california",
  "name": "Telemundo Noticias California · ESPAÑOL",
  "page": "https://www.telemundo52.com/ver/",
  "categories": [
   "california"
  ],
  "adapter": "nbcu-fast",
  "streamId": "88889714",
  "mediaHost": "ch114-xumo-drct-al1ij.fast.nbcuni.com",
  "poster": "https://media.telemundo52.com/2022/08/KVEA-tvOS_App-Store-1280x768-1.png?resize=850%2C478&quality=85&strip=all",
  "plot": "Noticias en español de Telemundo para California, incluyendo Los Angeles y el área de la Bahía. Una señal regional compartida; no es la programación completa de Telemundo 52 o 48."
 }
];
const fail=()=>{throw Error('official_live_unavailable')};
const decode=value=>value.replace(/&quot;/g,'"').replace(/&#(?:0*39|x0*27);/gi,"'").replace(/&amp;/g,'&');
const adVideo=u=>/^rr\d+---sn-[a-z0-9-]+\.googlevideo\.com$/.test(u.hostname)&&u.pathname.startsWith('/videoplayback/');
export function regionalMediaAllowed(channel,u){
 if(channel.adapter==='nbcu-fast')return u.hostname==='d2kowtvrzzi7ps.cloudfront.net'&&(u.pathname.startsWith('/11602/'+channel.streamId+'/hls/')||/^\/manifest\/[a-f0-9]{40}\/prod_default_nbc\/[a-f0-9-]{36}\//.test(u.pathname)||/^\/segment\/[a-f0-9]{40}\/prod_default_nbc\//.test(u.pathname))||u.hostname===channel.mediaHost&&u.pathname.startsWith('/live/');
 if(channel.adapter==='cbs-local')return u.hostname==='dai.google.com'&&(u.pathname.startsWith('/linear/hls/')&&u.pathname.includes('/event/'+channel.event+'/')||u.pathname.startsWith('/linear/pods/v1/p/'+channel.event+'/'))||u.hostname===channel.mediaHost&&(u.pathname.startsWith('/live/')||u.pathname.startsWith('/ad/seg/videoplayback/'))||adVideo(u);
 return false;
}
export function forgetRegionalLive(channel,options={}){return forgetPublicLiveDescriptor('regional:'+channel.page,options);}
export async function resolveRegionalLive(channel,options={}){
 const url=await publicLiveDescriptor('regional:'+channel.page,()=>readPublicLiveDescriptor(channel.page,text=>{
  const html=decode(text),field=channel.adapter==='nbcu-fast'?'m3u8_url':'video';
  const pattern=new RegExp('"'+field+'"\\s*:\\s*("(?:\\\\.|[^"\\\\])*")','g');
  for(const m of html.matchAll(pattern)){
   let u;try{u=new URL(JSON.parse(m[1]))}catch{continue}
   if(channel.adapter==='nbcu-fast'&&u.protocol==='https:'&&u.hostname==='d2kowtvrzzi7ps.cloudfront.net'&&u.pathname==='/11602/'+channel.streamId+'/hls/master.m3u8')return u.href;
   if(channel.adapter==='cbs-local'&&u.protocol==='https:'&&u.hostname==='dai.google.com'&&u.pathname==='/linear/hls/event/'+channel.event+'/master.m3u8')return u.href;
  }return null;
 },options),options);
 if(!regionalMediaAllowed(channel,new URL(url)))fail();return {url,officialPage:channel.page};
}
