import {exclusiveURL,exclusiveId,exclusiveSnapshot,exclusiveCatalogRoute} from './exclusive-catalog.mjs';
import {GNULA_PAGE_HOSTS} from './gnula-source.mjs';
import {inspectCatalogSource} from './catalog-source-check.mjs';

export const CATALOG_FEED_BRANCH='catalog-feed';
export const BEERUS_PAGE='https://ww3.gnulahd.nu/ver/dragon-ball-super-beerus/';
const kinds=['beerus','movies'],jobKey=kind=>'catalog-maintenance:'+kind;
const norm=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const managedMovie=row=>row.type==='movie'&&(row.mode==='gnula'||/gnula/i.test(row.source));
const fail=message=>{throw Error(message);};
function page(value){const url=exclusiveURL(value);if(!GNULA_PAGE_HOSTS.has(new URL(url).hostname))fail('unsupported_catalog_source');return url;}
export function validateCatalogFeed(feed,kind){
 if(!kinds.includes(kind)||!feed||feed.version!==1||feed.kind!==kind||typeof feed.requestId!=='string'||!/^[a-zA-Z0-9:_-]{8,100}$/.test(feed.requestId)||!Number.isFinite(Date.parse(feed.generatedAt))||Date.parse(feed.generatedAt)>Date.now()+3600000)fail('invalid_catalog_feed');
 if(kind==='beerus'){
  if(feed.seriesPage!==BEERUS_PAGE||feed.items!==undefined&&!Array.isArray(feed.items)||feed.items?.length>100)fail('invalid_series_page');
  const numbers=new Set(),items=(feed.items||[]).map(ep=>{const key=ep?.season+':'+ep?.episode_num;if(!Number.isInteger(ep?.season)||ep.season<1||ep.season>100||!Number.isInteger(ep?.episode_num)||ep.episode_num<1||ep.episode_num>1000||numbers.has(key))fail('invalid_catalog_episode');numbers.add(key);return {season:ep.season,episode_num:ep.episode_num,page:page(ep.page)};});
  return {...feed,items};
 }
 if(!Array.isArray(feed.items)||feed.items.length>20)fail('invalid_catalog_feed');
 const ids=new Set();const items=feed.items.map(item=>{
  if(!item||!exclusiveId(item.id)||ids.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>180||!Number.isInteger(item.year)||item.year<1880||item.year>2200)fail('invalid_catalog_movie');ids.add(item.id);
  return {id:item.id,name:item.name.trim(),year:item.year,page:page(item.page),poster:item.poster?exclusiveURL(item.poster):'',plot:typeof item.plot==='string'?item.plot.slice(0,3000):''};
 });return {...feed,items};
}
export function discoverBeerusEpisodes(html){
 const found=new Map();for(const match of html.matchAll(/https:\/\/ww3\.gnulahd\.nu\/dragon-ball-super-beerus-(\d{1,3})x(\d{1,4})\//g)){
  const season=Number(match[1]),episode_num=Number(match[2]);if(season<1||season>100||episode_num<1||episode_num>1000)continue;
  found.set(season+':'+episode_num,{season,episode_num,page:match[0]});
 }return [...found.values()].sort((a,b)=>a.season-b.season||a.episode_num-b.episode_num).slice(0,100);
}
function report(job){
 if(!job)return null;return {requestId:job.requestId,hash:job.hash,state:job.state,startedAt:job.startedAt,finishedAt:job.finishedAt||null,total:job.items.length,processed:job.items.filter(x=>x.result).length,
  results:job.items.filter(x=>x.result).map(x=>({id:x.id,title:x.title,...x.result})),...(job.discoveryError?{discoveryError:job.discoveryError}:{})};
}
function complete(job,now){if(job.items.every(x=>x.result)){job.state='completed';job.finishedAt=now;}return job;}
async function save(store,leases,row,revision){
 const response=await exclusiveCatalogRoute(store,'/exclusive-save',{item:row,revision,actor:'catalog-maintenance'});
 if(!response.ok)fail('catalog_save_failed');const {item}=await response.json();
 await leases.in(store).removeMatching(l=>l.exclusiveParentId===item.id&&(!item.visible||l.playbackRevision!==item.playbackRevision));return item;
}
function planMovies(rows,feed){
 const proposals=new Map(feed.items.map(x=>[x.id,x]));const items=[];
 for(const row of rows.filter(x=>managedMovie(x)&&x.visible)){
  const candidate=proposals.get(row.id),proposal=candidate&&candidate.year===row.year&&norm(candidate.name)===norm(row.name)?candidate:null;
  items.push({key:row.id,id:row.id,title:row.name,type:'movie',category:'check',before:row.page,beforeMode:row.mode,page:proposal?.page||row.page,mode:proposal?'gnula':row.mode,preferredEmbed:proposal&&proposal.page!==row.page?null:row.preferredEmbed||null,proposal});proposals.delete(row.id);
 }
 for(const item of proposals.values()){
  if(rows.some(x=>x.id===item.id||x.type==='movie'&&x.year===item.year&&norm(x.name)===norm(item.name)))continue;
  items.push({key:item.id,id:item.id,title:item.name,type:'movie',category:'addition',page:item.page,mode:'gnula',proposal:item});
 }return items;
}
function planEpisodes(rows,discovered){
 const matches=rows.filter(row=>row.type==='series'&&norm(row.name)==='dragon ball super beerus');if(matches.length!==1)fail('beerus_series_not_unique');
 const row=matches[0];if(row.mode!=='gnula'||!row.visible)fail('beerus_series_changed');const byNumber=new Map(discovered.map(ep=>[ep.season+':'+ep.episode_num,ep]));const items=[];
 for(const ep of row.episodes){const fresh=byNumber.get(ep.season+':'+ep.episode_num);items.push({key:ep.id,id:ep.id,title:ep.title,type:'episode',category:'check',parentId:row.id,before:ep.page,page:fresh?.page||ep.page,mode:'gnula',season:ep.season,episode_num:ep.episode_num});byNumber.delete(ep.season+':'+ep.episode_num);}
 for(const ep of [...byNumber.values()].sort((a,b)=>a.season-b.season||a.episode_num-b.episode_num).slice(0,1))items.push({key:row.id+'-s'+ep.season+'e'+ep.episode_num,id:row.id+'-s'+ep.season+'e'+ep.episode_num,title:'Episodio '+ep.episode_num,type:'episode',category:'addition',parentId:row.id,...ep,mode:'gnula'});
 return items.slice(0,100);
}
export async function catalogMaintenanceRoute(store,leases,path,body,{probe=inspectCatalogSource,now=Date.now}={}){
 if(path==='/catalog-maintenance-status')return Response.json({...Object.fromEntries(await Promise.all(kinds.map(async kind=>[kind,report(await store.get(jobKey(kind)))]))),runner:await store.get('catalog-maintenance:runner')||null});
 if(path==='/catalog-maintenance-observe'){
  const phases=new Set(['started','feed','discovery','start','probes','completed','failed']);if(!phases.has(body.phase)||body.kind!==undefined&&!kinds.includes(body.kind))return Response.json({error:'invalid_catalog_observation'},{status:400});
  await store.transaction(async tx=>{const old=await tx.get('catalog-maintenance:runner')||{};await tx.put('catalog-maintenance:runner',{...old,...(body.phase==='started'?{startedAt:now()}:{lastStepAt:now()}),phase:body.phase,...(body.kind?{kind:body.kind}:{}),...(body.reason?{reason:String(body.reason).replace(/[^a-z_]/g,'').slice(0,60)}:body.phase==='started'?{reason:null}:{})});});return Response.json({ok:true});
 }
 const kind=body.kind;if(!kinds.includes(kind))return Response.json({error:'invalid_catalog_kind'},{status:400});
 if(path==='/catalog-maintenance-start')return store.transaction(async tx=>{
  const feed=validateCatalogFeed(body.feed,kind),old=await tx.get(jobKey(kind));
  if(old?.hash===body.hash)return Response.json({report:report(old),pending:old.items.filter(x=>!x.result).map(x=>({key:x.key,category:x.category}))});
  if(typeof body.hash!=='string'||!/^[a-f0-9]{64}$/.test(body.hash)||old&&Date.parse(feed.generatedAt)<=Date.parse(old.generatedAt))return Response.json({error:'stale_catalog_feed'},{status:409});
  const snapshot=await exclusiveSnapshot(tx),discovered=kind==='beerus'?[...(Array.isArray(body.discovered)?body.discovered:[]).filter(ep=>discoverBeerusEpisodes(ep.page||'').some(x=>x.season===ep.season&&x.episode_num===ep.episode_num)),...feed.items]:[];
  const job=complete({requestId:feed.requestId,hash:body.hash,generatedAt:feed.generatedAt,startedAt:now(),state:'running',items:kind==='beerus'?planEpisodes(snapshot.items,discovered):planMovies(snapshot.items,feed),...(body.discoveryError?{discoveryError:'series_listing_unavailable'}:{})},now());
  await tx.put(jobKey(kind),job);return Response.json({report:report(job),pending:job.items.filter(x=>!x.result).map(x=>({key:x.key,category:x.category}))});
 });
 if(path!=='/catalog-maintenance-probe')return Response.json({error:'not_found'},{status:404});
 const claimed=await store.transaction(async tx=>{
  const job=await tx.get(jobKey(kind)),item=job?.items.find(x=>x.key===body.key);
  if(!job||job.hash!==body.hash||!item||item.result||item.claimUntil>now())return null;
  item.claim=crypto.randomUUID();item.claimUntil=now()+120000;await tx.put(jobKey(kind),job);return structuredClone(item);
 });if(!claimed)return Response.json({ok:true,skipped:true});
 let check,fallback=false;try{check=await probe(claimed);if(!check.ok&&claimed.before&&claimed.before!==claimed.page){const original=await probe({...claimed,page:claimed.before,mode:claimed.beforeMode||claimed.mode,preferredEmbed:null});if(original.ok){check=original;fallback=true;}}}catch{check={ok:false};}
 return store.transaction(async tx=>{
  const job=await tx.get(jobKey(kind)),item=job?.items.find(x=>x.key===body.key);
  if(!job||job.hash!==body.hash||!item||item.claim!==claimed.claim||item.result)return Response.json({ok:true,skipped:true});
  const result={status:check.ok?'online':'unavailable',checkedAt:now(),check:check.ok?check.check:'unavailable',...(fallback?{replacementUnavailable:true}:{})};
  if(check.ok&&!fallback){
   const snapshot=await exclusiveSnapshot(tx);let row=snapshot.items.find(x=>x.id===(item.parentId||item.id));
   if(item.type==='episode'){
    const ep=row?.episodes?.find(x=>x.id===item.id);
    if(!row?.visible||row.mode!=='gnula'||item.before&&ep?.page!==item.before||!item.before&&row.episodes.some(x=>x.season===item.season&&x.episode_num===item.episode_num))result.status='catalog_changed';
    else if(!ep||ep.page!==item.page){
     const episode={id:item.id,title:ep?.title||item.title,season:item.season,episode_num:item.episode_num,page:item.page};
     await save(tx,leases,{...row,episodes:ep?row.episodes.map(x=>x.id===ep.id?episode:x):[...row.episodes,episode]},row.revision);result.status=ep?'repaired':'added';
    }
   }else if(item.category==='check'){
    if(!row?.visible||row.page!==item.before||row.mode!==item.beforeMode)result.status='catalog_changed';
    else if(row.page!==item.page||row.mode!==item.mode){await save(tx,leases,{...row,mode:item.mode,page:item.page,poster:row.poster||item.proposal?.poster||''},row.revision);result.status='repaired';}
   }else{
    const visible=snapshot.items.filter(x=>managedMovie(x)&&x.visible);
    const oldest=[...visible].sort((a,b)=>a.createdAt-b.createdAt||snapshot.ids.indexOf(a.id)-snapshot.ids.indexOf(b.id))[0];
    if(row||snapshot.items.some(x=>x.type==='movie'&&x.year===item.proposal.year&&norm(x.name)===norm(item.title)))result.status='already_present';
    else if(visible.length>20)result.status='catalog_over_limit';
    else if(visible.length===20&&!['online','repaired'].includes(job.items.find(x=>x.id===oldest?.id)?.result?.status))result.status='rotation_needs_notice';
    else{
     const added={...item.proposal,type:'movie',source:'GNULA',mode:'gnula',episodes:[],visible:true,adult:false};await save(tx,leases,added,0);
     if(visible.length===20){await save(tx,leases,{...oldest,visible:false},oldest.revision);result.rotatedId=oldest.id;result.rotatedTitle=oldest.name;}
     result.status='added';
    }
   }
  }
  item.result=result;delete item.claim;delete item.claimUntil;complete(job,now());await tx.put(jobKey(kind),job);return Response.json({ok:true,...result});
 });
}
async function boundedText(response,max){
 if(!response.ok){await response.body?.cancel();fail('catalog_feed_unavailable');}const reader=response.body?.getReader();if(!reader)fail('catalog_feed_empty');let bytes=0,text='';const decoder=new TextDecoder();
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>max)fail('catalog_feed_too_large');text+=decoder.decode(value,{stream:true});}return text+decoder.decode();}catch(e){await reader.cancel().catch(()=>{});throw e;}finally{reader.releaseLock();}
}
export async function runCatalogMaintenance(env,{directory,fetcher=fetch}={}){
 if(env.ENVIRONMENT==='staging'||env.CATALOG_MAINTENANCE_ENABLED!=='true')return;
 const observe=async(phase,kind,reason)=>{const r=await directory(env,'/catalog-maintenance-observe',{phase,...(kind?{kind}:{}),...(reason?{reason}:{})});await r.body?.cancel();};await observe('started');
 const stateResponse=await directory(env,'/catalog-maintenance-status'),state=stateResponse.ok?await stateResponse.json():{};
 let failed=false;for(const kind of kinds){let phase='feed';try{
  const url='https://raw.githubusercontent.com/snapmovienow/snapmovienow.github.io/'+CATALOG_FEED_BRANCH+'/catalog-feeds/'+kind+'.json';
  const text=await boundedText(await fetcher(url,{redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(10000)}),64000),feed=validateCatalogFeed(JSON.parse(text),kind);
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(state[kind]?.hash===hash&&state[kind]?.state==='completed')continue;
  phase='discovery';
  let discovered=[],discoveryError=false;
  if(kind==='beerus'&&state[kind]?.hash!==hash)try{discovered=discoverBeerusEpisodes(await boundedText(await fetcher(BEERUS_PAGE,{redirect:'manual',headers:{'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(20000)}),1000000));if(!discovered.length)discoveryError=true;}catch{discoveryError=true;}
  phase='start';const begun=await directory(env,'/catalog-maintenance-start',{kind,feed,hash,discovered,discoveryError});if(!begun.ok){await begun.body?.cancel();throw Error('job_start_failed');}
  const {pending}=await begun.json();
  // Separate private object requests keep each media probe within its own
  // network budget. Checks precede additions so rotation sees actual health.
  phase='probes';const selected=pending.slice(0,kind==='beerus'?8:24);
  for(const category of ['check','addition']){
   const items=selected.filter(x=>x.category===category);
   for(let at=0;at<items.length;at+=4)await Promise.all(items.slice(at,at+4).map(async item=>{const response=await directory(env,'/catalog-maintenance-probe',{kind,hash,key:item.key});await response.body?.cancel();}));
  }
 }catch{failed=true;await observe('failed',kind,phase+'_failed');console.error({event:'catalog_maintenance_failed',kind});}}if(!failed)await observe('completed');
}
export async function catalogMaintenanceStatus(env,directory){
 if(env.CATALOG_MAINTENANCE_ENABLED!=='true')return {enabled:false};
 try{const response=await directory(env,'/catalog-maintenance-status');if(response.ok)return {enabled:true,...await response.json()};await response.body?.cancel();}catch{}
 return {enabled:true,status:'unavailable'};
}
