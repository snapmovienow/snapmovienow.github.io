import {LOCAL_TV_CHANNELS as OFFICIAL_CHANNELS} from './official-live.mjs';
import {isAdult} from './content-permissions.mjs';

// A separate registry namespace keeps existing provider IDs and bookmarks intact.
export const LOCAL_TV_SERVER='smn-official-local-tv';
export const LOCAL_TV_CATEGORY='LOCAL KANSAS';
export const LOCAL_TV_AFTER='CANALES-NOVELAS';
const categoryName=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s_-]+/g,'').toUpperCase();
const definition=row=>OFFICIAL_CHANNELS.find(channel=>channel.id===row?.id&&channel.page===row.page);
export const visibleLocalTv=(row,permissions)=>!!(definition(row)&&row.type==='movie'&&row.mode==='gnula'&&row.visible&&permissions.tv&&(permissions.adults||!row.adult&&!isAdult(row)));
const isLocal=record=>record?.server===LOCAL_TV_SERVER;
const channelFor=record=>record?.kind==='live'&&/^[1-9]\d{0,2}$/.test(String(record.upstreamId))?OFFICIAL_CHANNELS[Number(record.upstreamId)-1]||null:null;

export function createLocalTvXtream({read,prepare,media},env,ctx){
 let snapshot;
 const available=permissions=>(snapshot??=read(env)).then(data=>data.items.filter(row=>visibleLocalTv(row,permissions)));
 return {
  matches:isLocal,
  async list({action,rows,auth,base,categoryId,register}){
   if(!['get_live_categories','get_live_streams'].includes(action))return rows;
   const channels=await available(auth.user.permissions);if(!channels.length)return rows;
   const [id]=await register([{kind:'live_category',server:LOCAL_TV_SERVER,upstreamId:'1'}]);
   if(action==='get_live_categories'){
    const categories=rows.filter(row=>String(row.category_id)!==String(id));
    const after=categories.findIndex(row=>categoryName(row.category_name)===categoryName(LOCAL_TV_AFTER));
    categories.splice(after<0?categories.length:after+1,0,{category_id:String(id),category_name:LOCAL_TV_CATEGORY,parent_id:0});
    return categories;
   }
   if(categoryId&&String(categoryId)!==String(id))return rows;
   const ids=await register(channels.map(row=>({kind:'live',server:LOCAL_TV_SERVER,upstreamId:String(OFFICIAL_CHANNELS.findIndex(channel=>channel.id===row.id)+1),ext:'m3u8',activity:{title:row.name}})));
   return rows.concat(channels.map((row,index)=>({num:rows.length+index+1,name:row.name,stream_type:'live',stream_id:ids[index],stream_icon:row.poster?.startsWith('/')?base+row.poster:row.poster||'',epg_channel_id:'',added:String(Math.floor((row.createdAt||0)/1000)),category_id:String(id),custom_sid:'',tv_archive:0,tv_archive_duration:0,container_extension:'m3u8',direct_source:base+'/live/'+encodeURIComponent(auth.username)+'/'+encodeURIComponent(auth.password)+'/'+ids[index]+'.m3u8'})));
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
   const prepared=await prepare(request,env,auth.session,channel.id,{live:true});
   try{return await media(new Request(prepared.url,request),env,ctx);}
   catch(error){await prepared.release();throw error;}
  }
 };
}

export async function localTvXtreamStatus(store){
 const rows=await Promise.all(OFFICIAL_CHANNELS.map(channel=>store.get('exclusive:item:'+channel.id)));
 return {version:2,category:LOCAL_TV_CATEGORY,afterCategory:LOCAL_TV_AFTER,channels:rows.filter(row=>visibleLocalTv(row,{tv:true,adults:true})).map(row=>({id:row.id,name:row.name}))};
}
