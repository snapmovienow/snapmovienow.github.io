import {decodeCatalog} from './catalog-cache.mjs';
import {markAdultRows,isAdult} from './content-permissions.mjs';

// Build once beside durable snapshots. A channel change receives one decision,
// never the complete catalog. Generation keys invalidate both positive and
// negative decisions as soon as either the titles or categories are refreshed.
const caches=new WeakMap(),MAX_BYTES=16*1024*1024;
export async function inspectCatalog(store,body){
  if(!Array.isArray(body.rowKeys)||!Array.isArray(body.categoryKeys)||
    [...body.rowKeys,...body.categoryKeys].some(k=>! /^[a-f0-9]{64}$/.test(k))||
    body.rowKeys.length>2||body.categoryKeys.length>2||
    !['stream_id','series_id'].includes(body.idField)||!/^\d{1,20}$/.test(String(body.id)))return Response.json({error:'invalid_lookup'},{status:400});
  const index=await store.get('catalog-cache-index')||{},now=Date.now();
  const choose=keys=>keys.filter(k=>index[k]?.until>now&&index[k].savedAt>now-300000).sort((a,b)=>index[b].savedAt-index[a].savedAt)[0];
  const rowKey=choose(body.rowKeys),categoryKey=choose(body.categoryKeys);
  if(!rowKey||!categoryKey)return new Response(null,{status:404});
  const key=JSON.stringify([rowKey,index[rowKey].generation,categoryKey,index[categoryKey].generation,body.idField]);
  let cache=caches.get(store);if(!cache)caches.set(store,cache={entries:new Map(),bytes:0});
  let saved=cache.entries.get(key);
  if(saved?.until<=now){cache.entries.delete(key);cache.bytes-=saved.bytes;saved=null}
  if(!saved){
    const load=async k=>{const meta=index[k],keys=Array.from({length:meta.chunks},(_,i)=>`catalog-cache:${k}:${meta.generation}:${i}`),found=await store.get(keys),parts=keys.map(k=>found.get(k));if(parts.some(p=>!p))return null;return decodeCatalog(new Response(new Blob(parts)))};
    const [rows,categories]=await Promise.all([load(rowKey),load(categoryKey)]);
    if(!Array.isArray(rows)||!Array.isArray(categories))return new Response(null,{status:404});
    const decisions=new Map();let bytes=0;
    for(const row of markAdultRows(rows,categories)){const id=String(row._server||'ccf')+':'+String(row[body.idField]);if(!decisions.has(id)){decisions.set(id,isAdult(row));bytes+=id.length*2+48}}
    saved={decisions,bytes,until:Math.min(index[rowKey].until,index[categoryKey].until)};
    if(bytes<=MAX_BYTES){while(cache.entries.size&&(cache.entries.size>=16||cache.bytes+bytes>MAX_BYTES)){const k=cache.entries.keys().next().value;cache.bytes-=cache.entries.get(k).bytes;cache.entries.delete(k)}cache.entries.set(key,saved);cache.bytes+=bytes}
  }
  const id=String(body.server||'ccf')+':'+String(body.id);
  return Response.json({found:saved.decisions.has(id),adult:saved.decisions.get(id)===true});
}
