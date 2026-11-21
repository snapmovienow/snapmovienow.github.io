import {COMEDY_SERIES_DEFINITIONS} from './comedy-series-catalog.mjs';
export const COMEDY_PROVIDER_KEY='comedy-provider-completion:20261121-v1';
const targets=COMEDY_SERIES_DEFINITIONS.filter(d=>d.id!=='comedy-muertos-sl');
const numeric=v=>/^\d{1,16}$/.test(String(v))&&Number(v)>0;
const poster=value=>{try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash?u.href:'';}catch{return '';}};
const server=v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
const fold=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
export function providerComedyTitle(value,def){const clean=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/\b(?:ES|ESP|ESPANOL|CAST|CASTELLANO|SERIE|SERIES|HD|FHD|UHD|4K|1080P|720P)\b/g,'');return new RegExp('^'+fold(def.name)+'(?:'+(def.id==='comedy-cunados'?'2011|2012':def.year)+')?$').test(fold(clean));}
export function providerComedyInventory(def,candidate,detail){
 if(!server(candidate?._server)||!numeric(candidate.series_id)||!providerComedyTitle(candidate.name,def)||!providerComedyTitle(detail?.info?.name||candidate.name,def))return null;
 const groups=detail?.episodes;if(!groups||typeof groups!=='object')return null;
 const result=[],ids=new Set();
 for(const [season,count]of Object.entries(def.seasons)){
  const rows=groups[season];if(!Array.isArray(rows)||rows.length!==count)return null;
  const numbers=new Set();
  for(const ep of rows){const number=Number(ep.episode_num),ext=String(ep.container_extension||'mp4').toLowerCase();
   if(!numeric(ep.id)||ids.has(String(ep.id))||!Number.isInteger(number)||number<1||number>count||numbers.has(number)||!['mp4','mkv','m3u8','webm','avi','mov','m4v'].includes(ext))return null;
   ids.add(String(ep.id));numbers.add(number);result.push({upstreamId:String(ep.id),season:Number(season),episode_num:number,ext,title:String(ep.title||'Episodio '+number).slice(0,180)});
  }
 }
 if(Object.keys(groups).some(s=>!Object.hasOwn(def.seasons,s)&&Array.isArray(groups[s])&&groups[s].length))return null;
 return {id:def.id,name:def.name,year:def.year,server:candidate._server,seriesId:String(candidate.series_id),poster:poster(detail.info?.cover),plot:String(detail.info?.plot||'').replace(/https?:\/\/\S+/gi,'').slice(0,3000),episodes:result.sort((a,b)=>a.season-b.season||a.episode_num-b.episode_num)};
}
function cleanEntry(entry){
 const def=targets.find(d=>d.id===entry?.id);if(!def||entry.verified!==true)return null;
 const groups={};for(const ep of entry.episodes||[])(groups[ep.season]??=[]).push({id:ep.upstreamId,episode_num:ep.episode_num,container_extension:ep.ext,title:ep.title});
 const clean=providerComedyInventory(def,{_server:entry.server,series_id:entry.seriesId,name:entry.name},{info:{name:entry.name,cover:entry.poster,plot:entry.plot},episodes:groups});return clean?{...clean,verified:true}:null;
}
export const verifiedProviderComedies=data=>{const rows=(Array.isArray(data?.entries)?data.entries:[]).slice(0,4).map(cleanEntry).filter(Boolean);return rows.filter(row=>rows.filter(other=>other.id===row.id).length===1).slice(0,2);};
export function providerComedyItems(data){return verifiedProviderComedies(data).map(entry=>({id:entry.id,name:entry.name,year:entry.year,type:'series',mode:'gnula',visible:true,adult:false,profileServer:'exclusive',poster:entry.poster,plot:entry.plot,providerBinding:{server:entry.server,seriesId:entry.seriesId},episodes:entry.episodes.map(ep=>({...ep,id:entry.id+'-s'+ep.season+'e'+ep.episode_num,page:'https://api.snaptvnow.com/provider-comedy/'+entry.id+'/'+ep.season+'-'+ep.episode_num+'.'+ep.ext,container_extension:ep.ext}))}));}
export function providerComedyContent(data,mediaKey){
 const [type,source,id]=String(mediaKey||'').split('|');if(type!=='series')return null;
 for(const item of providerComedyItems(data)){const ep=item.episodes.find(e=>item.providerBinding.server===source&&e.upstreamId===id);if(ep)return {type:'series',id:item.id,name:item.name,episodeId:ep.id,season:ep.season,episode:ep.episode_num,rootServer:'smn-comedy-series',rootSeriesId:item.id};}return null;
}
export function publicProviderComedyStatus(job){
 const entries=verifiedProviderComedies(job);
 return {state:['pending','running','completed','failed'].includes(job?.state)?job.state:'pending',attempts:Math.min(2,Math.max(0,Number(job?.attempts)||0)),series:targets.map(def=>{
  const result=job?.results?.find(r=>r.id===def.id),expected=Object.values(def.seasons).reduce((a,b)=>a+b,0);
  const state=['verified','not_found','incomplete','media_unavailable','account_unavailable'].includes(result?.state)?result.state:'pending';
  return {id:def.id,name:def.name,state:state==='verified'&&(!entries.some(e=>e.id===def.id)||result.verified!==expected)?'media_unavailable':state,expected,verified:Math.min(expected,Math.max(0,Number(result?.verified)||0)),failedEpisodes:(Array.isArray(result?.failedEpisodes)?result.failedEpisodes:[]).filter(e=>Number.isInteger(e.season)&&Number.isInteger(e.episode)&&e.episode>0&&e.episode<=(def.seasons[e.season]||0)).slice(0,expected).map(e=>({season:e.season,episode:e.episode,reason:['timeout','invalid_media','invalid_playlist','media_not_arriving','account_unavailable','capacity_busy','sample_unavailable','playback_unavailable'].includes(e.reason)?e.reason:'playback_unavailable'}))};
 })};
}
export async function comedyProviderRoute(store,path,body={},now=Date.now){
 if(path==='/comedy-provider-read')return Response.json({entries:verifiedProviderComedies(await store.get(COMEDY_PROVIDER_KEY))});
 if(path==='/comedy-provider-status')return Response.json(publicProviderComedyStatus(await store.get(COMEDY_PROVIDER_KEY)));
 if(path==='/comedy-provider-claim')return store.transaction(async tx=>{const old=await tx.get(COMEDY_PROVIDER_KEY);if(old?.state==='completed'||old?.state==='failed'||old?.until>now())return Response.json({claimed:false});if(old?.attempts>=2){await tx.put(COMEDY_PROVIDER_KEY,{...old,state:'failed',until:0});return Response.json({claimed:false});}const job={state:'running',attempts:(old?.attempts||0)+1,claim:crypto.randomUUID(),until:now()+900000,results:old?.results||[],entries:old?.entries||[]};await tx.put(COMEDY_PROVIDER_KEY,job);return Response.json({claimed:true,claim:job.claim});});
 if(path==='/comedy-provider-finish')return store.transaction(async tx=>{const job=await tx.get(COMEDY_PROVIDER_KEY);if(!job||job.state!=='running'||job.until<=now()||job.claim!==body.claim)return Response.json({error:'stale_claim'},{status:409});const entries=verifiedProviderComedies(body).filter(entry=>body.results?.some(r=>r.id===entry.id&&r.state==='verified'&&r.verified===entry.episodes.length));const results=publicProviderComedyStatus(body).series.map(({id,state,verified,failedEpisodes})=>({id,state,verified,failedEpisodes}));await tx.put(COMEDY_PROVIDER_KEY,{...job,state:body.failed?'failed':'completed',until:0,entries,results,finishedAt:now()});return Response.json({ok:true});});
 return Response.json({error:'not_found'},{status:404});
}
export function createComedyProviderCompletion({directory,catalogFactory,probe}){
 let pending=false;
 return (env,ctx)=>{if(pending||env.ENVIRONMENT!=='production'||env.COMEDY_PROVIDER_COMPLETION_ENABLED!=='true'||!env.PLAYBACK_CANARY_USERNAME||env.PLAYBACK_CANARY_ENABLED==='false'||!ctx?.waitUntil)return;
 pending=true;ctx.waitUntil((async()=>{
  const response=await directory(env,'/comedy-provider-claim');if(!response.ok){await response.body?.cancel();return;}const claim=await response.json();if(!claim.claimed)return;
  const entries=[],results=[],deadline=Date.now()+800000;
  try{
   const rows=await catalogFactory(env,ctx)('get_series');if(!Array.isArray(rows)||rows.length>50000)throw Error('catalog_unavailable');
   for(const def of targets){
    const candidates=rows.filter(row=>providerComedyTitle(row.name,def)).slice(0,3);let selected=null;
    for(const candidate of candidates){try{const detail=await catalogFactory(env,ctx)('get_series_info',candidate._server,{series_id:String(candidate.series_id)});selected=providerComedyInventory(def,candidate,detail);if(selected)break;}catch{}}
    if(!selected){results.push({id:def.id,state:candidates.length?'incomplete':'not_found',verified:0});continue;}
    let verified=0,account=false;const failedEpisodes=[];
    for(const ep of selected.episodes){if(Date.now()>deadline)break;const sample={type:'series',server:selected.server,id:ep.upstreamId,series_id:selected.seriesId,ext:ep.ext};let result=await probe(env,ctx,sample);if(result.status==='busy'&&Date.now()<deadline-20000){await new Promise(resolve=>setTimeout(resolve,20000));result=await probe(env,ctx,sample);}if(result.ok)verified++;else failedEpisodes.push({season:ep.season,episode:ep.episode_num,reason:result.reason});if(result.reason==='account_unavailable'||result.status==='busy'){account=true;break;}}
    if(verified===selected.episodes.length){entries.push({...selected,verified:true});results.push({id:def.id,state:'verified',verified});}else results.push({id:def.id,state:account?'account_unavailable':'media_unavailable',verified,failedEpisodes});
   }
   const finished=await directory(env,'/comedy-provider-finish',{claim:claim.claim,entries,results});await finished.body?.cancel();
  }catch{const failed=await directory(env,'/comedy-provider-finish',{claim:claim.claim,entries,results,failed:true});await failed.body?.cancel();}
 })().catch(()=>console.error({event:'comedy_provider_completion',reason:'private_job_unavailable'})).finally(()=>{pending=false;}));
 };
}
