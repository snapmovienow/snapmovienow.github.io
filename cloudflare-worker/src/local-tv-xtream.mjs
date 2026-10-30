import {LOCAL_TV_CHANNELS as OFFICIAL_CHANNELS} from './official-live.mjs';
import {isAdult} from './content-permissions.mjs';

// A separate registry namespace keeps existing provider IDs and bookmarks intact.
export const LOCAL_TV_SERVER='smn-official-local-tv';
export const LOCAL_TV_CATEGORY='LOCAL KANSAS';
export const LOCAL_TV_AFTER='CANALES-NOVELAS';
export const LOCAL_TV_CATEGORIES=[
 {key:'kansas',upstreamId:'1',name:LOCAL_TV_CATEGORY},
 {key:'new-york',upstreamId:'2',name:'LOCAL NEW YORK'},
 {key:'new-jersey',upstreamId:'3',name:'LOCAL NEW JERSEY'},
 {key:'california',upstreamId:'4',name:'LOCAL CALIFORNIA'}
];
// Original numeric identities stay fixed. Shared regional feeds get a stable
// additional folder entry, while retaining one saved source and visibility flag.
const entries=OFFICIAL_CHANNELS.flatMap((channel,index)=>(channel.categories||['kansas']).map((category,n)=>({channel,category,upstreamId:String(n?1000000+LOCAL_TV_CATEGORIES.findIndex(c=>c.key===category)*10000+index+1:index+1)})));
const categoryName=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s_-]+/g,'').toUpperCase();
const definition=row=>OFFICIAL_CHANNELS.find(channel=>channel.id===row?.id&&channel.page===row.page);
export const visibleLocalTv=(row,permissions)=>!!(definition(row)&&row.type==='movie'&&row.mode==='gnula'&&row.visible&&permissions.tv&&(permissions.adults||!row.adult&&!isAdult(row)));
const isLocal=record=>record?.server===LOCAL_TV_SERVER;
const channelFor=record=>record?.kind==='live'?entries.find(e=>e.upstreamId===String(record.upstreamId))?.channel||null:null;

export function createLocalTvXtream({read,prepare,media},env,ctx){
 let snapshot;
 const available=permissions=>(snapshot??=read(env)).then(data=>data.items.filter(row=>visibleLocalTv(row,permissions)));
 return {
  matches:isLocal,
  async list({action,rows,auth,base,categoryId,register}){
   if(!['get_live_categories','get_live_streams'].includes(action))return rows;
   const channels=await available(auth.user.permissions);if(!channels.length)return rows;
   const present=entries.filter(entry=>channels.some(row=>row.id===entry.channel.id));
   const folders=LOCAL_TV_CATEGORIES.filter(category=>present.some(entry=>entry.category===category.key));
   const ids=await register(folders.map(category=>({kind:'live_category',server:LOCAL_TV_SERVER,upstreamId:category.upstreamId})));
   const categoryIds=new Map(folders.map((category,index)=>[category.key,String(ids[index])]));
   if(action==='get_live_categories'){
    const categories=rows.filter(row=>!ids.some(id=>String(row.category_id)===String(id)));
    const after=categories.findIndex(row=>categoryName(row.category_name)===categoryName(LOCAL_TV_AFTER));
    categories.splice(after<0?categories.length:after+1,0,...folders.map(category=>({category_id:categoryIds.get(category.key),category_name:category.name,parent_id:0})));
    return categories;
   }
   const selected=present.filter(entry=>!categoryId||categoryIds.get(entry.category)===String(categoryId));
   if(!selected.length)return rows;
   const streamIds=await register(selected.map(entry=>({kind:'live',server:LOCAL_TV_SERVER,upstreamId:entry.upstreamId,ext:'m3u8',activity:{title:channels.find(row=>row.id===entry.channel.id).name}})));
   return rows.concat(selected.map((entry,index)=>{const row=channels.find(row=>row.id===entry.channel.id);return {num:rows.length+index+1,name:row.name,stream_type:'live',stream_id:streamIds[index],stream_icon:row.poster?.startsWith('/')?base+row.poster:row.poster||'',epg_channel_id:'',added:String(Math.floor((row.createdAt||0)/1000)),category_id:categoryIds.get(entry.category),custom_sid:'',tv_archive:0,tv_archive_duration:0,container_extension:'m3u8',direct_source:base+'/live/'+encodeURIComponent(auth.username)+'/'+encodeURIComponent(auth.password)+'/'+streamIds[index]+'.m3u8'};}));
  },
  async play(request,auth,record){
   const channel=channelFor(record);if(!channel)return Response.json({error:'not_found'},{status:404});
   // This route checks TV permission and the current saved visibility/source on
   // every start, and uses the existing session, capacity and signed-media path.
   if(!auth.user.permissions.tv)return Response.json({error:'content_disabled'},{status:403});
   const data=await read(env),row=data.items.find(row=>row.id===channel.id);
   if(!visibleLocalTv(row,auth.user.permissions))return Response.json({error:'title_not_allowed'},{status:404});
   if(record.ext!=='m3u8'){
    const target=new URL(request.url);target.pathname=target.pathname.replace(/\.[^.\/]+$/,'.m3u8');
    return new Response(null,{status:302,headers:{Location:target.href,'Cache-Control':'no-store'}});
   }
   const prepared=await prepare(request,env,auth.session,channel.id,{live:true,localRow:row});
   try{return await media(new Request(prepared.url,request),env,ctx);}
   catch(error){await prepared.release();throw error;}
  }
 };
}

export async function localTvXtreamStatus(store){
 const rows=await Promise.all(OFFICIAL_CHANNELS.map(channel=>store.get('exclusive:item:'+channel.id)));
 const channels=rows.filter(row=>visibleLocalTv(row,{tv:true,adults:true}));
 return {version:3,startup:{version:1,publicDescriptorCacheSeconds:60,anonymousDeviceReuseSeconds:60,compactResourceTickets:true},category:LOCAL_TV_CATEGORY,afterCategory:LOCAL_TV_AFTER,channels:channels.map(row=>({id:row.id,name:row.name})),categories:LOCAL_TV_CATEGORIES.filter(c=>entries.some(e=>e.category===c.key&&channels.some(row=>row.id===e.channel.id))).map(c=>({name:c.name,channels:entries.filter(e=>e.category===c.key&&channels.some(row=>row.id===e.channel.id)).map(e=>e.channel.id)}))};
}
