import {isComedyGnulaPage,resolveComedyGnula,comedyGnulaMediaAllowed,comedyGnulaMediaHeaders} from './comedy-gnula-source.mjs';
import {isComedyPelisflixPage,resolveComedyPelisflix,comedyPelisflixMediaAllowed,comedyPelisflixMediaHeaders} from './comedy-pelisflix-source.mjs';
const adapters=[
 {matches:isComedyGnulaPage,resolve:resolveComedyGnula,allowed:comedyGnulaMediaAllowed,headers:comedyGnulaMediaHeaders},
 {matches:isComedyPelisflixPage,resolve:resolveComedyPelisflix,allowed:comedyPelisflixMediaAllowed,headers:comedyPelisflixMediaHeaders}
];
export const isComedySeriesPage=page=>adapters.some(adapter=>adapter.matches(page));
export async function resolveComedySeriesSource(page,options){
 const adapter=adapters.find(adapter=>adapter.matches(page));if(!adapter)throw Error('comedy_source_not_allowed');
 const {url,context}=await adapter.resolve(page,options);
 return {url,comedyPage:String(page),comedyContext:context};
}
export const comedyMediaAllowed=(page,url,context)=>adapters.find(adapter=>adapter.matches(page))?.allowed(page,url,context)===true;
export function comedyMediaHeaders(page,context){
 const adapter=adapters.find(adapter=>adapter.matches(page));if(!adapter)throw Error('comedy_source_not_allowed');return adapter.headers(page,context);
}
