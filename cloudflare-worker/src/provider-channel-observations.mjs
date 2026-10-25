// Passive, administrator-only access observations, independent of routing and
// circuits. No accounts, viewers, leases, URLs, titles or request counts persist.
export const CHANNEL_OBSERVATION_POLICY=Object.freeze({windowMs:86400000,shards:64,maxChannelsPerShard:128,maxShardBytes:86000});
const PREFIX='provider-channel-observations:v1:',META=PREFIX+'meta',COHORTS=['customer','owner_test','canary'],FIELDS=['bytesAt','manifestAt','failureAt'];
const encoder=new TextEncoder(),normal=v=>String(v||'').trim().toLowerCase();
export function canonicalChannelId(value){const raw=String(value??'');return /^\d{1,16}$/.test(raw)?raw.replace(/^0+(?=\d)/,''):null;}
export function observationShard(id){let n=0;for(const c of id)n=(n*31+c.charCodeAt(0))%CHANNEL_OBSERVATION_POLICY.shards;return PREFIX+n;}
const recent=(at,now)=>Number.isSafeInteger(at)&&at>now-CHANNEL_OBSERVATION_POLICY.windowMs&&at<=now;
function cleanChannel(row,now){const clean={};for(const cohort of COHORTS){const values={};for(const field of FIELDS)if(recent(row?.[cohort]?.[field],now))values[field]=row[cohort][field];if(Object.keys(values).length)clean[cohort]=values;}return clean;}
function cleanShard(value,now){const rows={};for(const [id,row]of Object.entries(value?.rows||{})){if(canonicalChannelId(id)!==id)continue;const clean=cleanChannel(row,now);if(Object.keys(clean).length)rows[id]=clean;}return {rows,incompleteUntil:Number.isSafeInteger(value?.incompleteUntil)?value.incompleteUntil:0};}
export function channelObservation(lease,result,env){
 const [type,server,rawId]=String(lease?.mediaKey||'').split('|'),id=canonicalChannelId(rawId);
 if(type!=='live'||server!=='ccf'||!id||!lease.provider_id||result.stage!=='signal')return null;
 const own=!!env?.PLAYBACK_CANARY_USERNAME&&normal(lease.username)===normal(env.PLAYBACK_CANARY_USERNAME);
 const cohort=own?(lease.canary===true?'canary':'owner_test'):'customer';
 // Unknown transport failures and lifecycle/capacity outcomes are not promoted
 // into byte failures. HTTP here is the validated media signal, never auth.
 const field=result.ok===true?({bytes:'bytesAt',manifest:'manifestAt'}[result.evidence]||null):result.ok===false&&Number.isInteger(result.httpStatus)&&result.httpStatus>=400&&result.httpStatus<=599&&![409,410,416,429].includes(result.httpStatus)?'failureAt':null;
 return field?{id,cohort,field}:null;
}
export async function recordChannelObservation(store,lease,result,env,now=Date.now()){
 const observation=channelObservation(lease,result,env);if(!observation)return false;
 const {id,cohort,field}=observation,key=observationShard(id);
 try{
  const shard=cleanShard(await store.get(key),now),row=shard.rows[id]||{};
  const meta=await store.get(META);if(!meta)await store.put(META,{startedAt:now});
  const full=!shard.rows[id]&&Object.keys(shard.rows).length>=CHANNEL_OBSERVATION_POLICY.maxChannelsPerShard;
  if(full){shard.incompleteUntil=now+CHANNEL_OBSERVATION_POLICY.windowMs;await store.put(key,shard);return false;}
  const previous=shard.rows[id];shard.rows[id]={...row,[cohort]:{...row[cohort],[field]:now}};
  if(encoder.encode(JSON.stringify(shard)).byteLength>CHANNEL_OBSERVATION_POLICY.maxShardBytes){
   if(previous)shard.rows[id]=previous;else delete shard.rows[id];shard.incompleteUntil=now+CHANNEL_OBSERVATION_POLICY.windowMs;
   await store.put(key,shard);return false;
  }
  await store.put(key,shard);return true;
 }catch{
  // Advisory failures must not break playback or change circuit decisions.
  // Best effort marker; the report always declares telemetry non-exhaustive.
  try{const meta=await store.get(META)||{startedAt:now};await store.put(META,{...meta,incompleteUntil:now+CHANNEL_OBSERVATION_POLICY.windowMs});}catch{}
  return false;
 }
}
export async function readChannelObservations(store,now=Date.now(),{prune=false}={}){
 const meta=await store.get(META),rows={};let incomplete=(meta?.incompleteUntil||0)>now;
 for(let i=0;i<CHANNEL_OBSERVATION_POLICY.shards;i++){
  const key=PREFIX+i,raw=await store.get(key),shard=cleanShard(raw,now);incomplete||=shard.incompleteUntil>now;Object.assign(rows,shard.rows);
  // The admin route holds the same storage transaction as writers. Expired
  // rows are physically removed on this bounded read or the next shard write.
  if(prune&&raw&&JSON.stringify(raw)!==JSON.stringify(shard))await store.put(key,shard);
 }
 return {status:'available',windowMs:CHANNEL_OBSERVATION_POLICY.windowMs,windowStart:now-CHANNEL_OBSERVATION_POLICY.windowMs,windowEnd:now,collectionStartedAt:Number.isSafeInteger(meta?.startedAt)&&meta.startedAt<=now?meta.startedAt:null,incomplete,rows};
}
export async function loadChannelObservations(read,timeoutMs=1500){
 let timer;
 try{
  const work=Promise.resolve().then(read).then(async response=>{if(!response?.ok)throw Error('observations_unavailable');const value=await response.json();if(value?.status!=='available'||!value.rows||typeof value.rows!=='object'||Array.isArray(value.rows))throw Error('observations_unavailable');return value;});
  return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('observations_timeout')),timeoutMs)})]);
 }catch{return {status:'unavailable',incomplete:true,rows:{},collectionStartedAt:null};}
 finally{clearTimeout(timer);}
}
export async function cachedChannelCatalog(catalog,now=Date.now()){
 const base={scope:'cached_configured_ccf_catalog',providerInventoryVerified:false,savedAt:null,ageMs:null,total:null,ids:null,status:'unavailable'};
 try{
  const saved=await catalog('get_live_streams','ccf',{}, {cachedOnly:true,withMetadata:true});
  if(!saved||!Array.isArray(saved.data)||!Number.isSafeInteger(saved.savedAt)||saved.savedAt>now||saved.savedAt<=now-12*3600000)return base;
  const ids=new Set();for(const row of saved.data){if(String(row?._server||'ccf')!=='ccf')continue;const id=canonicalChannelId(row?.stream_id);if(id===null)return {...base,status:'invalid_snapshot'};ids.add(id);}
  return {...base,status:'available',savedAt:saved.savedAt,ageMs:now-saved.savedAt,total:ids.size,ids:[...ids]};
 }catch{return base;}
}
export function summarizeChannelObservations(observations,catalog,now=Date.now()){
 const ids=Array.isArray(catalog?.ids)?new Set(catalog.ids):null,total=ids?.size??null,unavailable=observations?.status==='unavailable',incomplete=unavailable||observations?.incomplete===true;
 const groups=COHORTS.map(cohort=>{
  const counts={cohort,observed:0,successOnly:0,failureOnly:0,mixed:0,bytesSuccess:0,manifestSuccess:0,outsideCatalog:0};
  for(const [id,row]of Object.entries(observations?.rows||{})){
   const value=row[cohort],bytes=recent(value?.bytesAt,now),manifest=recent(value?.manifestAt,now),failed=recent(value?.failureAt,now),success=bytes||manifest;
   if(!success&&!failed)continue;if(ids&&!ids.has(id)){counts.outsideCatalog++;continue;}
   counts.observed++;if(success&&failed)counts.mixed++;else if(success)counts.successOnly++;else counts.failureOnly++;
   if(bytes)counts.bytesSuccess++;if(manifest)counts.manifestSuccess++;
  }
  if(unavailable)for(const key of Object.keys(counts))if(key!=='cohort')counts[key]=null;
  return {...counts,catalogTotal:total,unobserved:ids&&!incomplete?Math.max(0,total-counts.observed):null,coveragePercent:ids&&total&&!incomplete?Math.round(counts.observed*10000/total)/100:null,successOnlyPercent:ids&&counts.observed&&!incomplete?Math.round(counts.successOnly*10000/counts.observed)/100:null};
 });
 const {ids:ignored,...safeCatalog}=catalog||{status:'unavailable',total:null};
 return {status:unavailable?'unavailable':'available',measurement:'initial_access',attribution:'pending',audioVideoVerified:false,telemetryExhaustive:false,windowHours:24,windowStart:now-CHANNEL_OBSERVATION_POLICY.windowMs,windowEnd:now,collectionStartedAt:observations?.collectionStartedAt??null,incomplete,catalog:safeCatalog,groups};
}
