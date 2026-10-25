// Only reviewed stable pages are accepted; wrapper URLs are parsed, never fetched.
export const PELISFLIX_PAGE_HOSTS=new Set(['pelisflix200.city']);
export const isPelisflixPage=u=>PELISFLIX_PAGE_HOSTS.has(u.hostname)&&/^\/(?:episodio|serie|pelicula)\/[a-z0-9-]+\/$/.test(u.pathname)&&!u.search&&!u.hash;
const embedPattern=/^https:\/\/voe\.sx\/e\/[a-z0-9]+$/;
export function pelisflixEmbeds(html){
 const choices=[];
 for(const match of html.matchAll(/<div\b[^>]*\bdata-url=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi)){
  if(match[1].length>4096)continue;
  const label=match[2].replace(/<[^>]*>/g,' ').toUpperCase();
  const language=/\bLATINO\b/.test(label)?0:/\bCASTELLANO\b/.test(label)?1:/\bSUB(?:TITULADO)?\b/.test(label)?2:null;
  if(language===null)continue;
  try{
   const decoded=atob(match[1]);if(decoded.length>2048)continue;
   const wrapper=new URL(decoded);let embed=decoded;
   if(wrapper.origin==='https://nupload.my'&&wrapper.pathname==='/iframe/'&&!wrapper.username&&!wrapper.password&&!wrapper.hash){
    if([...wrapper.searchParams.keys()].join(',')!=='url')continue;
    embed=wrapper.searchParams.get('url');
   }
   if(embedPattern.test(embed))choices.push({language,embed});
  }catch{}
 }
 const language=Math.min(...choices.map(x=>x.language));
 return [...new Set(choices.filter(x=>x.language===language).map(x=>x.embed))];
}
