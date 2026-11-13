import {DEFAULT_POLICY,validatePolicy} from '../../services/live-processing/policy.mjs';
import {writeAudit} from './security.mjs';
const KEY='live-processing:owner-preparation:v1';
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});

// Private account-directory routes; the HTTP entry point requires a live owner
// session before invoking them. No user, lease, provider or credit record changes.
export async function liveProcessingPreparation(store,path,body) {
  if(path==='/live-processing-read')return json(await store.get(KEY)||{policy:structuredClone(DEFAULT_POLICY),updatedAt:null});
  if(path!=='/live-processing-save')return null;
  let policy;try{policy=validatePolicy(body.policy);}catch{return json({error:'invalid_processing_policy'},400);}
  if(policy.channels.some(id=>!/^l:[a-f0-9]{64}$/.test(id))||policy.categories.some(id=>!/^c:[a-f0-9]{64}$/.test(id)))return json({error:'invalid_processing_policy'},400);
  // Preparation is deliberately unable to activate a customer or pilot stream.
  if(policy.enabled)return json({error:'processing_activation_pending'},409);
  return store.transaction(async tx=>{
    const current=await tx.get(KEY)||{policy:DEFAULT_POLICY};
    if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision!==current.policy.revision||policy.revision!==current.policy.revision)return json({error:'processing_changed'},409);
    const saved={policy:{...policy,revision:policy.revision+1,enabled:false},updatedAt:Date.now()};
    await tx.put(KEY,saved);
    await writeAudit(tx,body.actor,'live_processing_prepared',policy.channels.length+' canales; '+policy.categories.length+' categorías');
    return json({ok:true,...saved});
  });
}

const label=(v,fallback)=>typeof v==='string'&&v.trim()?v.replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,160):fallback;
const numeric=v=>/^\d{1,16}$/.test(String(v??''));
export async function processingSelectionKey(kind,server,id){
  if(!['channel','category'].includes(kind)||typeof server!=='string'||server.length>160||!numeric(id))throw Error('invalid_catalog_reference');
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['live-processing-v1',server,String(id)])));
  return (kind==='channel'?'l:':'c:')+Array.from(new Uint8Array(bytes),n=>n.toString(16).padStart(2,'0')).join('');
}
export async function processingCatalog(rows,categories,{query='',limit=100}={}) {
  if(!Array.isArray(rows)||!Array.isArray(categories))return {state:'cache_missing',channels:[],categories:[],totalMatches:0};
  const names=new Map(),groups=[];
  for(const row of categories){
    if(!numeric(row?.category_id))continue;const server=String(row._server||'ccf'),raw=String(row.category_id),key=server+'|'+raw;
    if(server.length>160||names.has(key))continue;
    const group={id:await processingSelectionKey('category',server,raw),name:label(row.category_name,'Categoría '+raw)};
    names.set(key,group);groups.push(group);
  }
  const q=String(query).normalize('NFKC').toLowerCase(),channels=[],seen=new Set();let totalMatches=0;
  for(const row of rows){
    if(!numeric(row?.stream_id)||!numeric(row?.category_id))continue;
    const server=String(row._server||'ccf'),group=names.get(server+'|'+row.category_id);if(server.length>160||!group)continue;
    const name=label(row.name,'Canal '+row.stream_id);if(q&&!((name+' '+group.name).normalize('NFKC').toLowerCase().includes(q)))continue;
    const reference=server+'|'+row.stream_id;if(seen.has(reference))continue;seen.add(reference);totalMatches++;
    if(channels.length<limit)channels.push({id:await processingSelectionKey('channel',server,row.stream_id),name,categoryId:group.id,categoryName:group.name});
  }
  return {state:'ready',channels,categories:groups,totalMatches};
}

export function processorConnection(env){
  try{
    const url=new URL(env.LIVE_PROCESSING_PILOT_URL),token=env.LIVE_PROCESSING_PILOT_ADMIN_TOKEN;
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/'||!url.hostname.includes('.')||!/^[-_A-Za-z0-9]{32,256}$/.test(token||''))return null;
    return {url,token};
  }catch{return null;}
}
async function processorCheck(env,fetcher){
  const connection=processorConnection(env);if(!connection)return {state:'not_configured'};
  let response;
  try{
    response=await fetcher(new URL('/api/config',connection.url),{method:'GET',headers:{Authorization:'Bearer '+connection.token},redirect:'manual',signal:AbortSignal.timeout(4000)});
    if(!response.ok||response.status>=300)throw Error('unavailable');
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1048576)throw Error('too_large');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
    const raw=JSON.parse(new TextDecoder().decode(await new Blob(chunks).arrayBuffer()));
    validatePolicy(raw.policy);
    if(raw.customerRouting!==false||!Array.isArray(raw.catalog)||raw.catalog.length>2000)throw Error('invalid_processor');
    return {state:'reachable',configuredChannels:raw.catalog.length,checkedAt:Date.now(),activationPending:true};
  }catch{return {state:'unavailable'};}finally{await response?.body?.cancel().catch(()=>{});}
}

export function createLiveProcessingAdmin({directory,catalog,fetcher=fetch}){
  return async(env,ctx,body,owner)=>{
    const action=body.action;
    if(action==='live-processing-status'){
      const response=await directory(env,'/live-processing-read'),saved=await response.json();
      return json({...saved,mode:'preparation',activationAvailable:false,customerRouting:false,serverConfigured:!!processorConnection(env)},response.status);
    }
    if(action==='live-processing-save')return directory(env,'/live-processing-save',{policy:body.policy,expectedRevision:body.expectedRevision,actor:owner});
    if(action==='live-processing-check')return json({...await processorCheck(env,fetcher),activationAvailable:false,customerRouting:false});
    if(action==='live-processing-catalog'){
      if(body.query!==undefined&&(typeof body.query!=='string'||body.query.length>100)||body.refresh!==undefined&&typeof body.refresh!=='boolean')return json({error:'invalid_processing_query'},400);
      try{
        const read=catalog(env,ctx),options={cachedOnly:body.refresh!==true};
        const [rows,groups]=await Promise.all([read('get_live_streams',undefined,{},options),read('get_live_categories',undefined,{},options)]);
        return json(await processingCatalog(rows,groups,{query:body.query||''}));
      }catch{return json({error:'processing_catalog_unavailable'},503);}
    }
    return json({error:'operation_not_allowed'},403);
  };
}
