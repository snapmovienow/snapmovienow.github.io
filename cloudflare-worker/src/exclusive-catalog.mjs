import {isOfficialLivePage} from './official-live.mjs';
import {GNULA_CATALOG} from './exclusive-seed.mjs';
import {supportedSourcePage} from './gnula-source.mjs';
import {isAdult} from './content-permissions.mjs';
import {writeAudit} from './security.mjs';
const INDEX='exclusive:index',ITEM='exclusive:item:',COVER='exclusive:cover:',MAX_ITEMS=300;
export const exclusiveId=value=>typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{1,150}$/.test(value);
const fail=(code='exclusive_input',status=400)=>{throw Object.assign(Error(code),{status})};
export function exclusiveURL(value,{poster=false}={}){
 if(poster&&typeof value==='string'&&/^\/exclusive-cover\/[a-f0-9]{64}$/.test(value))return value;
 if(typeof value!=='string'||value.length>2048||/[\u0000-\u0020\\]/.test(value))fail('exclusive_url');
 let u;try{u=new URL(value.startsWith('//')?'https:'+value:value)}catch{fail('exclusive_url')}
 const host=u.hostname.toLowerCase();
 if(u.protocol!=='https:'||u.username||u.password||u.port&&u.port!=='443'||u.hash||!host.includes('.')||! /^[a-z0-9.-]+$/.test(host)||/^\d+(?:\.\d+)*$/.test(host)||host.includes('..')||/(?:^|\.)(?:localhost|local|internal|test|invalid|example|onion)$/.test(host)||/(?:^|\.)(?:nip\.io|sslip\.io|localtest\.me|metadata\.google\.internal)$/.test(host)||host==='api.snaptvnow.com'||host.endsWith('.chatgpt.site'))fail('exclusive_url');
 return u.href;
}
function address(value,mode){const url=exclusiveURL(value);if(mode==='gnula'&&!supportedSourcePage(new URL(url)))fail('exclusive_source');if(mode==='direct'&&!/\.(?:m3u8|mp4|mkv|webm|m4v|mov)$/i.test(new URL(url).pathname))fail('exclusive_source');return url;}
const plain=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)||required&&!value.trim())fail();return value.trim()};
function clean(input,old){
 if(!input||!exclusiveId(input.id)||!['movie','series'].includes(input.type)||!['gnula','direct'].includes(input.mode)||typeof input.visible!=='boolean'||typeof input.adult!=='boolean')fail();
 const name=plain(input.name,180,true),source=plain(input.source,60,true),plot=plain(input.plot??'',3000),poster=input.poster?exclusiveURL(input.poster,{poster:true}):'';
 const year=input.year===null||input.year===''?null:Number(input.year);if(year!==null&&(!Number.isInteger(year)||year<1880||year>2200))fail();
 const episodes=input.episodes??[];if(!Array.isArray(episodes)||episodes.length>100||input.type==='movie'&&episodes.length)fail();
 const ids=new Set([input.id]),numbers=new Set();
 const parsed=episodes.map(ep=>{if(!ep||!exclusiveId(ep.id)||ids.has(ep.id)||!Number.isInteger(ep.season)||ep.season<1||ep.season>100||!Number.isInteger(ep.episode_num)||ep.episode_num<1||ep.episode_num>1000||numbers.has(ep.season+':'+ep.episode_num))fail();ids.add(ep.id);numbers.add(ep.season+':'+ep.episode_num);return {id:ep.id,title:plain(ep.title,180,true),season:ep.season,episode_num:ep.episode_num,page:address(ep.page,input.mode)};}).sort((a,b)=>a.season-b.season||a.episode_num-b.episode_num);
 const page=input.type==='movie'?address(input.page,input.mode):input.page?address(input.page,input.mode):'';
 if(input.type==='series'&&input.visible&&!parsed.length)fail('exclusive_episodes');
 const row={id:input.id,type:input.type,name,source,mode:input.mode,page,poster,year,plot,visible:input.visible,adult:input.adult,episodes:parsed,profileServer:old?.profileServer||'exclusive',preferredEmbed:old?.mode===input.mode&&old?.page===page?old.preferredEmbed||null:null};
 if(new TextEncoder().encode(JSON.stringify(row)).length>80000)fail('exclusive_size');return row;
}
async function index(store){let value=await store.get(INDEX);if(value)return value;value={revision:1,ids:[],updatedAt:Date.now()};for(const item of GNULA_CATALOG){const id=item.stream_id||item.series_id,row={id,type:item.type,name:item.name,year:item.year||null,source:'GNULA',mode:'gnula',page:item.page,poster:item.stream_icon?.startsWith('//')?'https:'+item.stream_icon:item.stream_icon||item.cover||'',plot:item.plot||'',visible:true,adult:isAdult(item),episodes:item.episodes||[],profileServer:'gnula',preferredEmbed:item.preferredEmbed||null,revision:1,playbackRevision:1,createdAt:Date.now(),updatedAt:Date.now()};value.ids.push(id);await store.put(ITEM+id,row);}await store.put(INDEX,value);return value;}
export async function exclusiveSnapshot(store){const value=await index(store),items=[];for(const id of value.ids){const row=await store.get(ITEM+id);if(row)items.push(row);}return {...value,items};}
export function exclusivePublic(row,origin=''){
 const poster=row.poster?.startsWith('/')?origin+row.poster:row.poster;
 return {exclusive:true,exclusive_id:row.id,...(row.type==='movie'?{stream_id:row.id,stream_icon:poster}:{series_id:row.id,cover:poster}),source:'gnula',_server:row.profileServer,_adult:row.adult||isAdult(row),type:row.type,name:row.name,year:row.year,plot:row.plot,container_extension:row.mode==='gnula'||row.type==='series'?'m3u8':new URL(row.page).pathname.split('.').at(-1),smn_profile:{type:row.type,id:row.id,server:row.profileServer}};
}
export function visibleExclusive(row,permissions){return row?.visible&&(!isOfficialLivePage(row.page)||permissions.tv)&&permissions[row.type==='movie'?'movies':'series']&&(permissions.adults||!row.adult&&!isAdult(row));}
export function selectExclusive(rows,id){for(const row of rows){if(row.id===id)return {row,media:row};for(const episode of row.episodes||[])if(episode.id===id)return {row,media:{...episode,mode:row.mode,type:'series'}};}return null;}
function coverData(data){
 if(typeof data!=='string'||data.length>33000)fail('exclusive_cover');const match=data.match(/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/);if(!match)fail('exclusive_cover');
 let bytes;try{bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0))}catch{fail('exclusive_cover')}
 if(bytes.length<24||bytes.length>24576)fail('exclusive_cover');let w=0,h=0;
 if(match[1]==='png'){if([...bytes.slice(0,8)].join(',')!=='137,80,78,71,13,10,26,10')fail('exclusive_cover');if([...bytes.slice(8,16)].join(',')!=='0,0,0,13,73,72,68,82')fail('exclusive_cover');const view=new DataView(bytes.buffer);w=view.getUint32(16);h=view.getUint32(20);}
 else{if(bytes[0]!==255||bytes[1]!==216)fail('exclusive_cover');for(let p=2;p+8<bytes.length;){if(bytes[p++]!==255)fail('exclusive_cover');const marker=bytes[p++];if(marker===217||marker===218)break;const len=bytes[p]*256+bytes[p+1];if(len<2||p+len>bytes.length)fail('exclusive_cover');if([192,193,194].includes(marker)){h=bytes[p+3]*256+bytes[p+4];w=bytes[p+5]*256+bytes[p+6];break;}p+=len;}}
 if(w<1||h<1||w>2048||h>2048||w*h>3000000)fail('exclusive_cover');return {type:'image/'+match[1],data:match[2],size:bytes.length};
}
export async function exclusiveCatalogRoute(store,path,body){
 try{
  if(path==='/exclusive-item-read'){const row=exclusiveId(body.id)?await store.get(ITEM+body.id):null;return Response.json(row||{error:'not_found'},{status:row?200:404});}
  if(path==='/exclusive-read')return Response.json(await exclusiveSnapshot(store));
  if(path==='/exclusive-cover-read'){const image=/^[a-f0-9]{64}$/.test(body.id||'')?await store.get(COVER+body.id):null;return Response.json(image||{error:'not_found'},{status:image?200:404});}
  if(path==='/exclusive-cover-save'){
   const image=coverData(body.data),id=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(image.type+':'+image.data)))].map(n=>n.toString(16).padStart(2,'0')).join('');
   if(!await store.get(COVER+id)){
    const existing=await store.list({prefix:COVER}),catalog=await exclusiveSnapshot(store),used=new Set(catalog.items.map(row=>row.poster));let size=0,count=0;
    for(const [key,value]of existing)if(!used.has('/exclusive-cover/'+key.slice(COVER.length))&&value.createdAt<Date.now()-86400000)await store.delete(key);else{size+=value.size||0;count++;}
    if(count>=300||size+image.size>512000)fail('exclusive_cover_capacity',409);await store.put(COVER+id,{...image,createdAt:Date.now()});
   }return Response.json({poster:'/exclusive-cover/'+id});
  }
  if(path==='/exclusive-save'){
   const value=await index(store),input=body.item;if(!input||!exclusiveId(input.id)||!Number.isSafeInteger(body.revision)||body.revision<0)fail();
   const old=await store.get(ITEM+input.id);if(old?.revision!==body.revision&&!(old===undefined&&body.revision===0))fail('exclusive_changed',409);
   if(!old&&value.ids.length>=MAX_ITEMS)fail('exclusive_capacity',409);const row=clean(input,old);
   if(row.poster.startsWith('/exclusive-cover/')&&!await store.get(COVER+row.poster.split('/').at(-1)))fail('exclusive_cover');
   const all=await exclusiveSnapshot(store),newIds=new Set([row.id,...row.episodes.map(e=>e.id)]);if(all.items.some(other=>other.id!==row.id&&[other.id,...other.episodes.map(e=>e.id)].some(id=>newIds.has(id))))fail('exclusive_duplicate',409);
   const playbackChanged=!old||JSON.stringify([old.type,old.mode,old.page,old.visible,old.adult,old.episodes])!==JSON.stringify([row.type,row.mode,row.page,row.visible,row.adult,row.episodes]);
   const saved={...row,revision:(old?.revision||0)+1,playbackRevision:(old?.playbackRevision||0)+(playbackChanged?1:0),createdAt:old?.createdAt||Date.now(),updatedAt:Date.now()};
   if(new TextEncoder().encode(JSON.stringify(all.items.filter(x=>x.id!==row.id).concat(saved))).length>500000)fail('exclusive_capacity',409);
   await store.put(ITEM+row.id,saved);if(!old)value.ids.push(row.id);value.revision++;value.updatedAt=Date.now();await store.put(INDEX,value);await writeAudit(store,body.actor,old?'exclusive_edited':'exclusive_added',row.id);return Response.json({ok:true,item:saved,revision:value.revision});
  }
  return Response.json({error:'not_found'},{status:404});
 }catch(error){return Response.json({error:error.status?error.message:'exclusive_unavailable'},{status:error.status||503});}
}
export async function exportExclusives(store){const value=await store.get(INDEX);if(!value)return undefined;const data=await exclusiveSnapshot(store);return {index:value,items:data.items,covers:[...await store.list({prefix:COVER})]};}
export function validExclusiveBackup(data){try{return data&&Array.isArray(data.items)&&data.items.length<=MAX_ITEMS&&data.index&&Array.isArray(data.index.ids)&&data.index.ids.length===data.items.length&&new Set(data.index.ids).size===data.items.length&&data.items.every(row=>{try{return exclusiveId(row.id)&&data.index.ids.includes(row.id)&&Number.isSafeInteger(row.revision)&&row.revision>0&&Number.isSafeInteger(row.playbackRevision)&&row.playbackRevision>0&&!!clean(row,row)}catch{return false}})&&Array.isArray(data.covers)&&data.covers.length<=300&&data.covers.reduce((sum,entry)=>sum+(entry[1]?.size||0),0)<=512000&&data.covers.every(([key,value])=>/^exclusive:cover:[a-f0-9]{64}$/.test(key)&&!!coverData('data:'+value.type+';base64,'+value.data));}catch{return false;}}
export async function restoreExclusives(store,data){for(const prefix of [ITEM,COVER])for(const key of (await store.list({prefix})).keys())await store.delete(key);await store.delete(INDEX);if(!data)return;await store.put(INDEX,data.index);for(const row of data.items)await store.put(ITEM+row.id,row);for(const [key,value]of data.covers)await store.put(key,value);}
