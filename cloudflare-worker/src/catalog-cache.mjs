// Durable, credential-free snapshots. Each stored chunk stays below the
// Durable Object value limit; readers survive Worker isolate replacement.
const TTL = 12 * 3600000;
export const CATALOG_SNAPSHOT_MAX_BYTES = 2 * 1024 * 1024;
export const CATALOG_LIST_FRESH_MS = 5 * 60 * 1000;
export const CATALOG_CACHE_INDEX = 'catalog-cache-index';
export const MOVIE_PERMISSION_INDEX = 'catalog-movie-permission-index';
const CHUNK = 48000;
const keyValid = key => /^[a-f0-9]{64}$/.test(key);
const chunkKey = (key, generation, i) => `catalog-cache:${key}:${generation}:${i}`;
const join = parts => {
  const bytes = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0; for (const part of parts) {bytes.set(part, offset); offset += part.length}
  return bytes;
};
export async function encodeCatalog(data) {
  return new Uint8Array(await new Response(new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
}
export async function decodeCatalog(response) {
  return new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json();
}
export async function catalogCacheRoute(store, path, body) {
  if (!keyValid(body.key)) return Response.json({error:'invalid_cache_key'},{status:400});
  // Short-lived details have their own quota so many series cannot evict the
  // full live/VOD catalogs that customers need for fast channel changes.
  const detail=body.kind==='detail',permissionsOnly=body.kind==='movie_permissions',movieCatalog=body.kind==='movie_catalog';
  const indexKey=permissionsOnly?MOVIE_PERMISSION_INDEX:detail?'catalog-detail-index':CATALOG_CACHE_INDEX;
  if (path === '/xtream-cache-get') {
    const index = await store.get(indexKey) || {}, saved = index[body.key];
    if (!(saved?.until > Date.now())) return new Response(null,{status:404});
    const keys = Array.from({length:saved.chunks},(_,i)=>chunkKey(body.key,saved.generation,i));
    const found = await store.get(keys), parts = keys.map(key=>found.get(key));
    if (parts.some(part=>!part)) return new Response(null,{status:404});
    return new Response(join(parts),{headers:{'content-type':'application/octet-stream','x-catalog-saved-at':String(saved.savedAt)}});
  }
  if (path !== '/xtream-cache-put') return new Response(null,{status:404});
  let bytes; try {bytes=Uint8Array.from(atob(body.content),c=>c.charCodeAt(0))} catch {return new Response(null,{status:400})}
  if (!bytes.length || bytes.length > CATALOG_SNAPSHOT_MAX_BYTES) return new Response(null,{status:413});
  // Publish the index only after every chunk has been written. Concurrent
  // updates cannot expose a partially written or mixed snapshot.
  return store.transaction(async tx=>{
    const index = await tx.get(indexKey) || {}, generation = crypto.randomUUID();
    const now=Date.now(),sourceTimestamp=detail||permissionsOnly||movieCatalog;
    const savedAt=sourceTimestamp&&body.savedAt!==undefined?body.savedAt:now;
    const ttl=detail?30000:permissionsOnly?CATALOG_LIST_FRESH_MS:TTL;
    if(!Number.isSafeInteger(savedAt)||savedAt>now||savedAt<=now-ttl)return Response.json({error:'invalid_cache_age'},{status:400});
    const relatedKey=permissionsOnly?CATALOG_CACHE_INDEX:movieCatalog?MOVIE_PERMISSION_INDEX:null;
    const relatedIndex=relatedKey?(await tx.get(relatedKey)||{}):null;
    const old=index[body.key],related=relatedIndex?.[body.key];
    // Both representations share one source timestamp. Background writes can
    // finish out of order, including writes into the other index.
    if(old?.savedAt>savedAt||related?.savedAt>savedAt)return Response.json({ok:true});
    const remove=async(entries,key,saved)=>{
      for(let i=0;i<saved.chunks;i++)await tx.delete(chunkKey(key,saved.generation,i));
      delete entries[key];
    };
    if(old)await remove(index,body.key,old);
    for(const [key,saved] of Object.entries(index))if(saved.until<=now)await remove(index,key,saved);
    while(Object.keys(index).length>=(detail||permissionsOnly?32:64)||Object.values(index).reduce((n,s)=>n+s.bytes,0)+bytes.length>(detail||permissionsOnly?4:16)*1024*1024){
      const [key,saved]=Object.entries(index).sort((a,b)=>a[1].savedAt-b[1].savedAt)[0];
      await remove(index,key,saved);
    }
    const chunks=Math.ceil(bytes.length/CHUNK);
    for(let i=0;i<chunks;i++)await tx.put(chunkKey(body.key,generation,i),bytes.slice(i*CHUNK,(i+1)*CHUNK));
    index[body.key]={generation,chunks,bytes:bytes.length,savedAt,until:savedAt+ttl};
    await tx.put(indexKey,index);
    if(related){
      // Keep the older full catalogue available for browsing, but do not
      // let it supersede a newer compact permission snapshot after eviction.
      if(permissionsOnly)relatedIndex[body.key]={...related,permissionObsolete:true};
      else await remove(relatedIndex,body.key,related);
      await tx.put(relatedKey,relatedIndex);
    }
    return Response.json({ok:true});
  });
}
