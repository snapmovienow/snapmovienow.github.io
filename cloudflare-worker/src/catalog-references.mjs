// Advisory evidence only: an account-scoped list is not provider-wide inventory.
// No URLs, credentials, names, customer identities or routing changes are stored.
const ROOT='catalog-references-v1',MAX_SERVERS=8,MAX_IDS=20000,CHUNK=2000;
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const server=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(v);
export function referenceIds(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>MAX_IDS)return null;
 const ids=rows.map(r=>String(r?.stream_id??''));
 if(ids.some(id=>!/^\d{1,16}$/.test(id))||new Set(ids).size!==ids.length)return null;
 return ids.sort();
}
export async function saveCatalogReferences(store,b,now=Date.now()){
 if(!Array.isArray(b.samples)||!b.samples.length||b.samples.length>MAX_SERVERS)return false;
 // Reject the whole observation on malformed/empty/oversized samples.
 if(b.samples.some(s=>!server(s.server)||!hash(s.scope)||!hash(s.keyScope)||!hash(s.origin)||!hash(s.fingerprint)||!Number.isSafeInteger(s.at)||s.at>now||s.at<now-60000||!referenceIds(s.ids?.map(stream_id=>({stream_id})))))return false;
 return store.transaction(async tx=>{
  const index=await tx.get(ROOT)||{};
  for(const s of b.samples){
   const prior=index[s.server];if(prior&&prior.lastSuccessAt>=s.at)continue;
   if(!prior&&Object.keys(index).length>=MAX_SERVERS)continue;
   if(prior?.fingerprint===s.fingerprint&&prior.scope===s.scope&&prior.keyScope===s.keyScope&&prior.origin===s.origin){index[s.server]={...prior,lastSuccessAt:s.at};continue;}
   const ids=[...s.ids].sort(),old=[];
   if(prior)for(let i=0;i<prior.chunks;i++)old.push(...(await tx.get(`${ROOT}:${s.server}:${i}`)||[]));
   const comparable=prior?.keyScope===s.keyScope&&prior?.scope===s.scope&&old.length===prior.count;
   const before=new Set(old),after=new Set(ids),added=comparable?ids.filter(id=>!before.has(id)):[],missing=comparable?old.filter(id=>!after.has(id)):[];
   const originChanged=!!prior&&prior.keyScope===s.keyScope&&prior.origin!==s.origin;
   const changed=originChanged||comparable&&(added.length||missing.length);
   const change=changed?{at:s.at,revision:s.fingerprint,originChanged,addedCount:added.length,missingCount:missing.length,added:added.slice(0,10),missing:missing.slice(0,10),comparison:comparable?'same_account_scope':'scope_changed'}:prior?.change||null;
   const chunks=Math.ceil(ids.length/CHUNK);
   // Rewrite only changed IDs, but preserve the true successful-read timestamp.
   if(!prior||prior.fingerprint!==s.fingerprint){
    for(let i=0;i<chunks;i++)await tx.put(`${ROOT}:${s.server}:${i}`,ids.slice(i*CHUNK,(i+1)*CHUNK));
    for(let i=chunks;i<(prior?.chunks||0);i++)await tx.delete(`${ROOT}:${s.server}:${i}`);
   }
   index[s.server]={lastSuccessAt:s.at,scope:s.scope,keyScope:s.keyScope,origin:s.origin,fingerprint:s.fingerprint,count:ids.length,chunks,change};
  }
  await tx.put(ROOT,index);return true;
 });
}
export async function readCatalogReferences(store,now=Date.now(),queries=[]){
 const index=await store.get(ROOT)||{};
 const references=[];
 for(const q of (Array.isArray(queries)?queries:[]).slice(0,3)){
  if(!server(q?.server)||!/^\d{1,16}$/.test(String(q.id||'')))continue;
  const s=index[q.server];let state='no_catalog_evidence';
  if(s){if(now-s.lastSuccessAt>12*3600000)state='stale_catalog';else{
   const ids=[];for(let i=0;i<s.chunks;i++)ids.push(...(await store.get(`${ROOT}:${q.server}:${i}`)||[]));
   state=ids.length!==s.count?'no_catalog_evidence':ids.includes(String(q.id))?'present_in_observed_catalog':'not_in_observed_catalog';
  }}
  references.push({server:q.server,id:String(q.id),state,lastSuccessAt:s?.lastSuccessAt||null});
 }
 return {references,scope:'observed_account_catalogs',providerInventoryVerified:false,mediaHealthVerified:false,servers:Object.entries(index).map(([server,s])=>({server,lastSuccessAt:s.lastSuccessAt,ageMs:Math.max(0,now-s.lastSuccessAt),state:now-s.lastSuccessAt>12*3600000?'stale_catalog':'reference_observed',count:s.count,fingerprint:s.fingerprint,change:s.change}))};
}
export function catalogReferenceObservations(snapshot){
 const out=[];
 for(const s of snapshot?.servers||[]){
  if(!server(s.server))continue;
  out.push({key:'catalog-stale:'+s.server,kind:'catalog',title:'Catálogo observado sin actualizar durante más de 12 horas',detail:s.server+' · Última respuesta no vacía: '+new Date(s.lastSuccessAt).toISOString()+' · No confirma una caída del proveedor.',bad:s.state==='stale_catalog',confirm:1});
  if(s.change)out.push({key:'catalog-change:'+s.server,kind:'catalog',title:'Cambios observados en referencias de TV',detail:s.server+' · Observado: '+new Date(s.change.at).toISOString()+' · Origen cambiado: '+(s.change.originChanged?'sí':'no')+' · IDs nuevos: '+s.change.addedCount+' · IDs no presentes en esta respuesta: '+s.change.missingCount+(s.change.missing.length?' · Muestra: '+s.change.missing.join(', '):'')+' · Revisar; no confirma retirada ni salud de la fuente.',bad:true,confirm:1,revision:s.change.revision});
 }
 return out;
}

export function catalogFailureContext(snapshot){
 return (snapshot?.references||[]).map(r=>'ID '+r.id+' ('+r.server+'): '+({present_in_observed_catalog:'presente en el catálogo observado; no confirma señal ni dirección final',not_in_observed_catalog:'no aparece en el catálogo observado de esa cuenta; no confirma retirada',stale_catalog:'catálogo antiguo; referencia actual sin verificar',no_catalog_evidence:'sin evidencia reciente del catálogo'}[r.state]||'sin verificar')+(r.lastSuccessAt?' · catálogo '+new Date(r.lastSuccessAt).toISOString():'')).join('\n');
}
