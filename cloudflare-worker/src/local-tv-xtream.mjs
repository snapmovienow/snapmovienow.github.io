import {ALL_TV_CHANNELS as OFFICIAL_CHANNELS} from './official-live.mjs';
import {isAdult} from './content-permissions.mjs';
import {localStartupSummary} from './local-startup-observations.mjs';
import {PUBLIC_TV_FOLDERS} from './public-tv-channels.mjs';

// A separate registry namespace keeps existing provider IDs and bookmarks intact.
export const LOCAL_TV_SERVER='smn-official-local-tv';
export const LOCAL_TV_CATEGORY='LOCAL KANSAS';
export const LOCAL_TV_AFTER='CANALES-NOVELAS';
export const LOCAL_TV_CATEGORIES=[
 {key:'kansas',upstreamId:'1',name:LOCAL_TV_CATEGORY},
 {key:'new-york',upstreamId:'2',name:'LOCAL NEW YORK'},
 {key:'new-jersey',upstreamId:'3',name:'LOCAL NEW JERSEY'},
 {key:'california',upstreamId:'4',name:'LOCAL CALIFORNIA'},
 ...PUBLIC_TV_FOLDERS
];
// Original numeric identities stay fixed. Shared regional feeds get a stable
// additional folder entry, while retaining one saved source and visibility flag.
const entries=OFFICIAL_CHANNELS.flatMap((channel,index)=>(channel.categories||['kansas']).map((category,n)=>({channel,category,upstreamId:channel.xtreamId||String(n?1000000+LOCAL_TV_CATEGORIES.findIndex(c=>c.key===category)*10000+index+1:index+1)})));
const categoryName=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s_-]+/g,'').toUpperCase();
const definition=row=>OFFICIAL_CHANNELS.find(channel=>channel.page===row?.page&&(channel.id===row.id||channel.adapter==='public-hls'));
export const visibleLocalTv=(row,permissions)=>{const channel=definition(row);return !!(channel&&row.type==='movie'&&row.mode===(channel.adapter==='public-hls'?'direct':'gnula')&&row.visible&&permissions.tv&&(permissions.adults||!row.adult&&!isAdult(row)));};
const savedChannel=(rows,channel)=>rows.find(row=>row.id===channel.id&&definition(row)===channel)||rows.find(row=>definition(row)===channel);
const matchesFolder=(folder,row)=>[folder.name,...folder.aliases||[]].some(name=>categoryName(name)===categoryName(row.category_name));
const isLocal=record=>record?.server===LOCAL_TV_SERVER;
const channelFor=record=>record?.kind==='live'?entries.find(e=>e.upstreamId===String(record.upstreamId))?.channel||null:null;

export function createLocalTvXtream({read,prepare,media},env,ctx){
 const localStartedAt=Date.now();
 let snapshot;
 const available=permissions=>(snapshot??=read(env)).then(data=>data.items.filter(row=>visibleLocalTv(row,permissions)));
 return {
  matches:isLocal,
  async list({action,rows,auth,base,categoryId,register,catalog,adultPolicy}){
   if(!['get_live_categories','get_live_streams'].includes(action))return rows;
   const channels=await available(auth.user.permissions);if(!channels.length)return rows;
   const present=entries.filter(entry=>savedChannel(channels,entry.channel));
   const folders=LOCAL_TV_CATEGORIES.filter(category=>present.some(entry=>entry.category===category.key));
   let existing=rows;
   if(action==='get_live_streams'&&folders.some(folder=>folder.aliases)&&catalog){
    existing=await catalog('get_live_categories');if(!Array.isArray(existing))throw Error('invalid_catalog');
    if(auth.user.permissions.adults===false&&adultPolicy)existing=await adultPolicy.filter('get_live_categories',existing);
   }
   const merged=new Map(folders.filter(folder=>folder.aliases).map(folder=>[folder.key,existing.find(row=>matchesFolder(folder,row))]).filter(([,row])=>row));
   const unresolved=folders.filter(folder=>!merged.has(folder.key));
   const ids=await register(unresolved.map(category=>({kind:'live_category',server:LOCAL_TV_SERVER,upstreamId:category.upstreamId})));
   const categoryIds=new Map(unresolved.map((category,index)=>[category.key,String(ids[index])]));
   if(action==='get_live_categories')for(const [key,row]of merged)categoryIds.set(key,String(row.category_id));
   else if(merged.size){
    const matched=[...merged],mapped=await register(matched.map(([,row])=>({kind:'live_category',server:row._server,upstreamId:String(row.category_id)})));
    matched.forEach(([key],index)=>categoryIds.set(key,String(mapped[index])));
   }
   if(action==='get_live_categories'){
    const categories=rows.filter(row=>!ids.some(id=>String(row.category_id)===String(id)));
    const after=categories.findIndex(row=>categoryName(row.category_name)===categoryName(LOCAL_TV_AFTER));
    const row=category=>({category_id:categoryIds.get(category.key),category_name:category.name,parent_id:0});
    categories.splice(after<0?categories.length:after+1,0,...unresolved.filter(c=>!c.aliases).map(row));
    categories.push(...unresolved.filter(c=>c.aliases).map(row));
    return categories;
   }
   const selected=present.filter(entry=>!categoryId||categoryIds.get(entry.category)===String(categoryId));
   if(!selected.length)return rows;
   const streamIds=await register(selected.map(entry=>({kind:'live',server:LOCAL_TV_SERVER,upstreamId:entry.upstreamId,ext:'m3u8',activity:{title:savedChannel(channels,entry.channel).name}})));
   return rows.concat(selected.map((entry,index)=>{const row=savedChannel(channels,entry.channel);return {num:rows.length+index+1,name:row.name,stream_type:'live',stream_id:streamIds[index],stream_icon:row.poster?.startsWith('/')?base+row.poster:row.poster||'',epg_channel_id:'',added:String(Math.floor((row.createdAt||0)/1000)),category_id:categoryIds.get(entry.category),custom_sid:'',tv_archive:0,tv_archive_duration:0,container_extension:'m3u8',direct_source:base+'/live/'+encodeURIComponent(auth.username)+'/'+encodeURIComponent(auth.password)+'/'+streamIds[index]+'.m3u8'};}));
  },
  async play(request,auth,record){
   const channel=channelFor(record);if(!channel)return Response.json({error:'not_found'},{status:404});
   // This route checks TV permission and the current saved visibility/source on
   // every start, and uses the existing session, capacity and signed-media path.
   if(!auth.user.permissions.tv)return Response.json({error:'content_disabled'},{status:403});
   const data=await read(env),row=savedChannel(data.items,channel);
   if(!visibleLocalTv(row,auth.user.permissions))return Response.json({error:'title_not_allowed'},{status:404});
   if(record.ext!=='m3u8'){
    const target=new URL(request.url);target.pathname=target.pathname.replace(/\.[^.\/]+$/,'.m3u8');
    return new Response(null,{status:302,headers:{Location:target.href,'Cache-Control':'no-store'}});
   }
   // HEAD describes this authorized virtual HLS endpoint. A metadata probe must
   // not begin/release playback and invalidate a GET already using its tickets.
   if(request.method==='HEAD')return new Response(null,{status:200,headers:{'Content-Type':'application/vnd.apple.mpegurl','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
   const prepared=await prepare(request,env,auth.session,row.id,{live:true,localRow:row,localStartedAt});
   try{return await media(new Request(prepared.url,request),env,ctx);}
   catch(error){await prepared.release();throw error;}
  }
 };
}

export async function localTvXtreamStatus(store){
 const rows=await Promise.all(OFFICIAL_CHANNELS.map(channel=>store.get('exclusive:item:'+channel.id)));
 const channels=rows.filter(row=>visibleLocalTv(row,{tv:true,adults:true}));
 return {version:3,startup:{version:2,publicDescriptorCacheSeconds:60,anonymousDeviceReuseSeconds:60,compactResourceTickets:true,atomicMediaAuthorization:true,observations:await localStartupSummary(store)},category:LOCAL_TV_CATEGORY,afterCategory:LOCAL_TV_AFTER,channels:channels.map(row=>({id:row.id,name:row.name})),categories:LOCAL_TV_CATEGORIES.filter(c=>entries.some(e=>e.category===c.key&&channels.some(row=>row.id===e.channel.id))).map(c=>({name:c.name,channels:entries.filter(e=>e.category===c.key&&channels.some(row=>row.id===e.channel.id)).map(e=>e.channel.id)}))};
}
